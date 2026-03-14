import { db } from "../db";
import { users, salesOrders, chargebacks, rollingReserves, reserveTransactions, systemExceptions, clients, providers, services } from "@shared/schema";
import { eq, sql, desc, inArray, like } from "drizzle-orm";
import { hashPassword } from "../auth";
import { getOrCreateReserve, calculateWithholding, applyWithholding, applyChargebackToReserve, applyEquipmentRecovery, handleRepSeparation, checkAndReleaseMaturedReserves } from "../reserves/reserveService";
import { getMaturityDays, calculateMaturityDate, isOrderMature } from "../reserves/maturityService";

const ROLES = ["REP", "MDU", "LEAD", "MANAGER", "DIRECTOR", "EXECUTIVE", "ADMIN", "OPERATIONS", "ACCOUNTING"] as const;
const RESERVE_ELIGIBLE = ["REP", "LEAD", "MANAGER"];

interface TestResult {
  test: string;
  role: string;
  passed: boolean;
  detail: string;
}

const results: TestResult[] = [];
let testClientId: string = "";
let testProviderId: string = "";
let testServiceId: string = "";

function log(test: string, role: string, passed: boolean, detail: string) {
  results.push({ test, role, passed, detail });
  const icon = passed ? "✓" : "✗";
  console.log(`  ${icon} [${role}] ${test}: ${detail}`);
}

async function setupTestDeps() {
  const [client] = await db.select({ id: clients.id }).from(clients).limit(1);
  const [provider] = await db.select({ id: providers.id }).from(providers).limit(1);
  const [service] = await db.select({ id: services.id }).from(services).limit(1);
  testClientId = client?.id || "";
  testProviderId = provider?.id || "";
  testServiceId = service?.id || "";
  if (!testClientId || !testProviderId || !testServiceId) {
    throw new Error("Missing test dependencies: need at least one client, provider, and service in the DB");
  }
}

async function cleanupTestData() {
  console.log("\n[CLEANUP] Removing test data...");
  try {
    const testUsers = await db.select({ id: users.id }).from(users).where(like(users.repId, 'TEST_%'));
    const testUserIds = testUsers.map(u => u.id);
    if (testUserIds.length === 0) {
      console.log("[CLEANUP] No test data found\n");
      return;
    }

    for (const uid of testUserIds) {
      try {
        const reserves = await db.select({ id: rollingReserves.id }).from(rollingReserves).where(eq(rollingReserves.userId, uid));
        for (const r of reserves) {
          await db.delete(reserveTransactions).where(eq(reserveTransactions.reserveId, r.id));
        }
        await db.delete(rollingReserves).where(eq(rollingReserves.userId, uid));

        const [userRec] = await db.select({ repId: users.repId }).from(users).where(eq(users.id, uid));
        if (userRec?.repId) {
          const orders = await db.select({ id: salesOrders.id }).from(salesOrders).where(eq(salesOrders.repId, userRec.repId));
          for (const o of orders) {
            await db.delete(chargebacks).where(eq(chargebacks.salesOrderId, o.id));
          }
          await db.delete(salesOrders).where(eq(salesOrders.repId, userRec.repId));
        }
        await db.delete(systemExceptions).where(eq(systemExceptions.relatedUserId, uid));
        await db.delete(users).where(eq(users.id, uid));
      } catch (e: any) {
        console.log(`[CLEANUP] Warning: failed to clean user ${uid}: ${e.message}`);
      }
    }
    console.log(`[CLEANUP] Cleaned ${testUserIds.length} test users\n`);
  } catch (e: any) {
    console.log(`[CLEANUP] Warning: ${e.message}\n`);
  }
}

async function createTestUser(role: string): Promise<string> {
  const repId = `TEST_${role}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const pw = await hashPassword("TestPass123!");
  const [user] = await db.insert(users).values({
    name: `Test ${role}`,
    repId,
    role: role as any,
    status: "ACTIVE",
    passwordHash: pw,
    onboardingStatus: "COMPLETED",
  }).returning();
  return user.id;
}

async function createTestOrder(userId: string): Promise<string> {
  const [user] = await db.select({ repId: users.repId }).from(users).where(eq(users.id, userId));
  const [order] = await db.insert(salesOrders).values({
    customerName: "Test Customer",
    customerAddress: "123 Test St",
    approvalStatus: "APPROVED",
    repId: user?.repId || "UNKNOWN",
    clientId: testClientId,
    providerId: testProviderId,
    serviceId: testServiceId,
    dateSold: new Date().toISOString().split("T")[0],
    carrierMaturityType: "VOLUNTARY",
  } as any).returning();
  return order.id;
}

async function testMaturityService() {
  console.log("\n═══════════════════════════════════════");
  console.log("TEST SUITE 1: Maturity Service (Section 5)");
  console.log("═══════════════════════════════════════");

  const optimumVoluntary = getMaturityDays("Optimum", "VOLUNTARY_CANCELLATION");
  log("Optimum voluntary maturity", "SYSTEM", optimumVoluntary === 120, `Expected 120, got ${optimumVoluntary}`);

  const optimumNonPay = getMaturityDays("Optimum", "NON_PAY_DISCONNECT");
  log("Optimum non-pay maturity", "SYSTEM", optimumNonPay === 180, `Expected 180, got ${optimumNonPay}`);

  const astoundVoluntary = getMaturityDays("Astound", "VOLUNTARY_CANCELLATION");
  log("Astound voluntary maturity", "SYSTEM", astoundVoluntary === 120, `Expected 120, got ${astoundVoluntary}`);

  const astoundNonPay = getMaturityDays("Astound", "NON_PAY_DISCONNECT");
  log("Astound non-pay maturity", "SYSTEM", astoundNonPay === 120, `Expected 120, got ${astoundNonPay}`);

  const matDate = calculateMaturityDate("2025-01-01", "Optimum", "VOLUNTARY_CANCELLATION");
  const expected = new Date("2025-05-01");
  log("Calculate maturity date", "SYSTEM", matDate.toDateString() === expected.toDateString(), `Expected ${expected.toDateString()}, got ${matDate.toDateString()}`);

  const matureOrder = isOrderMature("2024-01-01", "Optimum");
  log("Old order is mature", "SYSTEM", matureOrder === true, `Expected true, got ${matureOrder}`);

  const immatureOrder = isOrderMature(new Date().toISOString(), "Optimum");
  log("New order is immature", "SYSTEM", immatureOrder === false, `Expected false, got ${immatureOrder}`);
}

async function testReserveCreationByRole() {
  console.log("\n═══════════════════════════════════════");
  console.log("TEST SUITE 2: Reserve Creation Per Role (Section 1)");
  console.log("═══════════════════════════════════════");

  for (const role of ROLES) {
    const userId = await createTestUser(role);
    try {
      const reserve = await getOrCreateReserve(userId);
      if (RESERVE_ELIGIBLE.includes(role)) {
        log("Reserve created", role, reserve !== null && reserve.currentBalanceCents === 0, `Balance: ${reserve?.currentBalanceCents}, Status: ${reserve?.status}`);
      } else {
        log("Reserve should NOT be created", role, false, `Reserve was created for non-eligible role ${role}`);
      }
    } catch (err: any) {
      if (!RESERVE_ELIGIBLE.includes(role)) {
        log("Reserve correctly rejected", role, true, `Error: ${err.message.substring(0, 60)}`);
      } else {
        log("Reserve creation failed", role, false, `Unexpected error: ${err.message}`);
      }
    }
  }
}

async function testWithholdingCalculation() {
  console.log("\n═══════════════════════════════════════");
  console.log("TEST SUITE 3: Withholding Calculation (Section 1)");
  console.log("═══════════════════════════════════════");

  const userId = await createTestUser("REP");
  const reserve = await getOrCreateReserve(userId);

  const withholding1 = calculateWithholding(100000, reserve);
  log("15% of $1000", "REP", withholding1 === 15000, `Expected 15000, got ${withholding1}`);

  const withholding2 = calculateWithholding(50000, reserve);
  log("15% of $500", "REP", withholding2 === 7500, `Expected 7500, got ${withholding2}`);

  const almostFullReserve = { ...reserve, currentBalanceCents: 240000, capCents: 250000 };
  const withholdingCapped = calculateWithholding(100000, almostFullReserve);
  log("Cap-limited withholding", "REP", withholdingCapped === 10000, `Expected 10000 (cap gap), got ${withholdingCapped}`);

  const fullReserve = { ...reserve, currentBalanceCents: 250000, capCents: 250000, status: "AT_CAP" };
  const withholdingZero = calculateWithholding(100000, fullReserve);
  log("No withholding at cap", "REP", withholdingZero === 0, `Expected 0, got ${withholdingZero}`);
}

async function testApplyWithholding() {
  console.log("\n═══════════════════════════════════════");
  console.log("TEST SUITE 4: Apply Withholding to Orders (Section 1)");
  console.log("═══════════════════════════════════════");

  for (const role of RESERVE_ELIGIBLE) {
    const userId = await createTestUser(role);
    const orderId = await createTestOrder(userId);

    const result = await applyWithholding(userId, orderId, "PENDING", 100000);
    log("Withholding applied", role, result.withheldCents === 15000, `Withheld: ${result.withheldCents}, NewBalance: ${result.newBalance}`);

    const [reserve] = await db.select().from(rollingReserves).where(eq(rollingReserves.userId, userId));
    log("Reserve balance updated", role, reserve.currentBalanceCents === 15000, `Balance: ${reserve.currentBalanceCents}`);

    const txns = await db.select().from(reserveTransactions).where(eq(reserveTransactions.reserveId, reserve.id));
    log("Transaction recorded", role, txns.length === 1 && txns[0].transactionType === "WITHHOLDING", `Txns: ${txns.length}, Type: ${txns[0]?.transactionType}`);
  }
}

async function testReplenishment() {
  console.log("\n═══════════════════════════════════════");
  console.log("TEST SUITE 5: Replenishment After Chargeback (Section 3)");
  console.log("═══════════════════════════════════════");

  const userId = await createTestUser("REP");
  const [userRec] = await db.select({ repId: users.repId }).from(users).where(eq(users.id, userId));

  for (let i = 0; i < 17; i++) {
    const oid = await createTestOrder(userId);
    await applyWithholding(userId, oid, "PENDING", 100000);
  }

  let [reserve] = await db.select().from(rollingReserves).where(eq(rollingReserves.userId, userId));
  const balanceBeforeChargeback = reserve.currentBalanceCents;
  log("Reserve built up", "REP", balanceBeforeChargeback >= 250000, `Balance: $${(balanceBeforeChargeback / 100).toFixed(2)}`);
  log("Status at cap", "REP", reserve.status === "AT_CAP", `Status: ${reserve.status}`);

  const orderId = await createTestOrder(userId);
  const [cb] = await db.insert(chargebacks).values({
    salesOrderId: orderId,
    invoiceNumber: `TEST-CB-${Date.now()}`,
    repId: userRec!.repId,
    amount: "500.00",
    reason: "CANCELLATION",
    chargebackDate: new Date().toISOString().split("T")[0],
    chargebackType: "VOLUNTARY_CANCELLATION",
    providerName: "optimum",
    createdByUserId: userId,
  } as any).returning();

  await applyChargebackToReserve(userId, cb.id, orderId, 50000, "VOLUNTARY_CANCELLATION", "optimum");

  [reserve] = await db.select().from(rollingReserves).where(eq(rollingReserves.userId, userId));
  log("Balance reduced by chargeback", "REP", reserve.currentBalanceCents === balanceBeforeChargeback - 50000, `Balance: $${(reserve.currentBalanceCents / 100).toFixed(2)}`);
  log("Status back to ACTIVE", "REP", reserve.status === "ACTIVE", `Status: ${reserve.status}`);

  const oid2 = await createTestOrder(userId);
  const result = await applyWithholding(userId, oid2, "PENDING", 100000);
  log("Replenishment withholding resumed", "REP", result.withheldCents > 0, `Withheld: $${(result.withheldCents / 100).toFixed(2)}`);
}

async function testEquipmentRecovery() {
  console.log("\n═══════════════════════════════════════");
  console.log("TEST SUITE 6: Equipment Recovery - iPad (Section 6)");
  console.log("═══════════════════════════════════════");

  const userId = await createTestUser("REP");

  for (let i = 0; i < 4; i++) {
    const oid = await createTestOrder(userId);
    await applyWithholding(userId, oid, "PENDING", 100000);
  }

  let [reserve] = await db.select().from(rollingReserves).where(eq(rollingReserves.userId, userId));
  const balanceBefore = reserve.currentBalanceCents;
  log("Balance before iPad recovery", "REP", balanceBefore === 60000, `Balance: $${(balanceBefore / 100).toFixed(2)}`);

  const adminId = await createTestUser("ADMIN");
  await applyEquipmentRecovery(userId, "IPAD", 50000, adminId, "iPad recovery test");
  [reserve] = await db.select().from(rollingReserves).where(eq(rollingReserves.userId, userId));
  log("iPad cost deducted ($500)", "REP", reserve.currentBalanceCents === balanceBefore - 50000, `Balance: $${(reserve.currentBalanceCents / 100).toFixed(2)}`);

  const txns = await db.select().from(reserveTransactions).where(eq(reserveTransactions.reserveId, reserve.id)).orderBy(desc(reserveTransactions.createdAt));
  const equipTxn = txns.find(t => t.transactionType === "EQUIPMENT_RECOVERY");
  log("Equipment recovery transaction", "REP", equipTxn !== undefined && equipTxn.amountCents === 50000, `Type: ${equipTxn?.transactionType}, Amount: ${equipTxn?.amountCents}`);
}

async function testSeparation() {
  console.log("\n═══════════════════════════════════════");
  console.log("TEST SUITE 7: Separation Handling (Section 7)");
  console.log("═══════════════════════════════════════");

  for (const sepType of ["VOLUNTARY", "TERMINATED"] as const) {
    const userId = await createTestUser("REP");
    for (let i = 0; i < 5; i++) {
      const oid = await createTestOrder(userId);
      await applyWithholding(userId, oid, "PENDING", 100000);
    }

    let [reserve] = await db.select().from(rollingReserves).where(eq(rollingReserves.userId, userId));
    log(`Pre-separation balance (${sepType})`, "REP", reserve.currentBalanceCents > 0, `Balance: $${(reserve.currentBalanceCents / 100).toFixed(2)}`);

    const sepAdminId = await createTestUser("ADMIN");
    await handleRepSeparation(userId, sepType, sepAdminId);
    [reserve] = await db.select().from(rollingReserves).where(eq(rollingReserves.userId, userId));
    log(`Status after ${sepType} separation`, "REP", reserve.status === "HELD", `Status: ${reserve.status}`);
    log(`Separation type recorded`, "REP", reserve.separationType === sepType, `Type: ${reserve.separationType}`);
    log(`Separation date set`, "REP", reserve.separatedAt !== null, `Date: ${reserve.separatedAt}`);
  }
}

async function testNonEligibleRoles() {
  console.log("\n═══════════════════════════════════════");
  console.log("TEST SUITE 8: Non-Eligible Roles Cannot Have Reserves");
  console.log("═══════════════════════════════════════");

  const nonEligible = ROLES.filter(r => !RESERVE_ELIGIBLE.includes(r));
  for (const role of nonEligible) {
    const userId = await createTestUser(role);
    try {
      await getOrCreateReserve(userId);
      log("Should have been rejected", role, false, "Reserve was created for non-eligible role");
    } catch (err: any) {
      log("Correctly rejected", role, true, err.message.substring(0, 60));
    }
  }
}

async function testDeficitStatus() {
  console.log("\n═══════════════════════════════════════");
  console.log("TEST SUITE 9: Deficit Status (Section 2-3)");
  console.log("═══════════════════════════════════════");

  const userId = await createTestUser("REP");
  const [userRec] = await db.select({ repId: users.repId }).from(users).where(eq(users.id, userId));
  const oid1 = await createTestOrder(userId);
  await applyWithholding(userId, oid1, "PENDING", 100000);

  let [reserve] = await db.select().from(rollingReserves).where(eq(rollingReserves.userId, userId));
  log("Initial balance", "REP", reserve.currentBalanceCents === 15000, `Balance: $${(reserve.currentBalanceCents / 100).toFixed(2)}`);

  const oid2 = await createTestOrder(userId);
  const [cb] = await db.insert(chargebacks).values({
    salesOrderId: oid2,
    invoiceNumber: `TEST-CB-DEF-${Date.now()}`,
    repId: userRec!.repId,
    amount: "200.00",
    reason: "NON_PAYMENT",
    chargebackDate: new Date().toISOString().split("T")[0],
    chargebackType: "NON_PAY_DISCONNECT",
    providerName: "optimum",
    createdByUserId: userId,
  } as any).returning();

  await applyChargebackToReserve(userId, cb.id, oid2, 20000, "NON_PAY_DISCONNECT", "optimum");
  [reserve] = await db.select().from(rollingReserves).where(eq(rollingReserves.userId, userId));
  log("Deficit after large chargeback", "REP", reserve.currentBalanceCents === 0 && reserve.status === "DEFICIT", `Balance: $${(reserve.currentBalanceCents / 100).toFixed(2)}, Status: ${reserve.status}`);
  log("Status is DEFICIT", "REP", reserve.status === "DEFICIT", `Status: ${reserve.status}`);
}

async function testCapOverrideWithholding() {
  console.log("\n═══════════════════════════════════════");
  console.log("TEST SUITE 10: Custom Cap + Withholding (Section 4)");
  console.log("═══════════════════════════════════════");

  const userId = await createTestUser("LEAD");
  const reserve = await getOrCreateReserve(userId);

  await db.update(rollingReserves).set({
    capCents: 500000,
    withholdingPercent: "25.00",
    capOverrideReason: "Excessive chargebacks",
  }).where(eq(rollingReserves.id, reserve.id));

  const [updatedReserve] = await db.select().from(rollingReserves).where(eq(rollingReserves.id, reserve.id));
  log("Custom cap set to $5000", "LEAD", updatedReserve.capCents === 500000, `Cap: $${(updatedReserve.capCents / 100).toFixed(2)}`);
  log("Custom withholding 25%", "LEAD", updatedReserve.withholdingPercent === "25.00", `Rate: ${updatedReserve.withholdingPercent}%`);

  const oid = await createTestOrder(userId);
  const result = await applyWithholding(userId, oid, "PENDING", 100000);
  log("25% withholding applied", "LEAD", result.withheldCents === 25000, `Withheld: $${(result.withheldCents / 100).toFixed(2)}`);
}

async function testTransactionHistory() {
  console.log("\n═══════════════════════════════════════");
  console.log("TEST SUITE 11: Transaction History Audit Trail");
  console.log("═══════════════════════════════════════");

  const userId = await createTestUser("MANAGER");

  const oid1 = await createTestOrder(userId);
  await applyWithholding(userId, oid1, "PENDING", 100000);

  const oid2 = await createTestOrder(userId);
  await applyWithholding(userId, oid2, "PENDING", 200000);

  const [reserve] = await db.select().from(rollingReserves).where(eq(rollingReserves.userId, userId));
  const txns = await db.select().from(reserveTransactions).where(eq(reserveTransactions.reserveId, reserve.id)).orderBy(reserveTransactions.createdAt);

  log("Two transactions recorded", "MANAGER", txns.length === 2, `Count: ${txns.length}`);
  log("First withholding correct", "MANAGER", txns[0]?.amountCents === 15000, `Amount: ${txns[0]?.amountCents}`);
  log("Second withholding correct", "MANAGER", txns[1]?.amountCents === 30000, `Amount: ${txns[1]?.amountCents}`);
  log("All are WITHHOLDING type", "MANAGER", txns.every(t => t.transactionType === "WITHHOLDING"), `Types: ${txns.map(t => t.transactionType).join(", ")}`);
  log("isCredit is true for withholdings", "MANAGER", txns.every(t => t.isCredit === true), `Credits: ${txns.map(t => t.isCredit).join(", ")}`);

  const totalBalance = reserve.currentBalanceCents;
  log("Running balance matches", "MANAGER", totalBalance === 45000, `Balance: $${(totalBalance / 100).toFixed(2)}`);
}

async function testLifetimeTotals() {
  console.log("\n═══════════════════════════════════════");
  console.log("TEST SUITE 12: Lifetime Totals Tracking");
  console.log("═══════════════════════════════════════");

  const userId = await createTestUser("REP");

  for (let i = 0; i < 3; i++) {
    const oid = await createTestOrder(userId);
    await applyWithholding(userId, oid, "PENDING", 100000);
  }

  const [reserve] = await db.select().from(rollingReserves).where(eq(rollingReserves.userId, userId));
  log("Total withheld tracked", "REP", reserve.totalWithheldCents === 45000, `Total: $${(reserve.totalWithheldCents / 100).toFixed(2)}`);
}

async function runAllTests() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  IRON CREST ROLLING RESERVE TEST SUITE       ║");
  console.log("║  Testing all roles x all reserve operations   ║");
  console.log("╚══════════════════════════════════════════════╝");

  await setupTestDeps();
  console.log(`[SETUP] Client: ${testClientId}, Provider: ${testProviderId}, Service: ${testServiceId}`);

  await cleanupTestData();

  try {
    await testMaturityService();
    await testReserveCreationByRole();
    await testWithholdingCalculation();
    await testApplyWithholding();
    await testReplenishment();
    await testEquipmentRecovery();
    await testSeparation();
    await testNonEligibleRoles();
    await testDeficitStatus();
    await testCapOverrideWithholding();
    await testTransactionHistory();
    await testLifetimeTotals();
  } catch (err) {
    console.error("\n[FATAL] Test suite crashed:", err);
  }

  await cleanupTestData();

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║                  RESULTS                      ║");
  console.log("╚══════════════════════════════════════════════╝");

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  console.log(`\n  Total: ${total}  |  Passed: ${passed}  |  Failed: ${failed}`);
  console.log(`  Pass Rate: ${((passed / total) * 100).toFixed(1)}%\n`);

  if (failed > 0) {
    console.log("  FAILURES:");
    for (const r of results.filter(r => !r.passed)) {
      console.log(`    ✗ [${r.role}] ${r.test}: ${r.detail}`);
    }
  }

  console.log("");
  process.exit(failed > 0 ? 1 : 0);
}

runAllTests();
