export interface PostingStorage {
  getFinanceImportRows(importId: string): Promise<any[]>;
  getOrderById(id: string): Promise<any>;
  setOrderClientAcceptance(orderId: string, status: "ACCEPTED" | "REJECTED" | "PENDING", expectedAmountCents?: number): Promise<any>;
  getArExpectationsByOrderId(orderId: string): Promise<any[]>;
  getCommissionLineItemsByOrderId(orderId: string): Promise<any[]>;
  createArExpectation(data: any): Promise<any>;
  updateOrder(id: string, data: any): Promise<any>;
  setPayrollReady(orderId: string, triggeredBy: string): Promise<any>;
  updateFinanceImport(id: string, data: any): Promise<any>;
  createAuditLog(data: any): Promise<any>;
}

export interface PostingResult {
  arCreated: number;
  ordersAccepted: number;
  ordersRejected: number;
  orderRowGroups: Record<string, any[]>;
}

export async function executeFinanceImportPost(
  importId: string,
  financeImport: any,
  userId: string,
  isAutoPost: boolean,
  storage: PostingStorage,
  extraContext: Record<string, any> = {}
): Promise<PostingResult> {
  const rows = await storage.getFinanceImportRows(importId);
  let arCreated = 0;
  let ordersAccepted = 0;
  let ordersRejected = 0;

  const orderRowGroups: Record<string, typeof rows> = {};
  for (const row of rows) {
    if (row.isDuplicate) continue;
    if (row.matchStatus === 'MATCHED' && row.matchedOrderId) {
      if (!orderRowGroups[row.matchedOrderId]) orderRowGroups[row.matchedOrderId] = [];
      orderRowGroups[row.matchedOrderId].push(row);
    }
  }

  for (const [orderId, groupRows] of Object.entries(orderRowGroups)) {
    const enrolledRows = groupRows.filter((r: any) => {
      const status = (r.clientStatus || '').toUpperCase();
      return status === 'ENROLLED' || status === 'ACCEPTED' || status === 'COMPLETED' || status === 'ACTIVE';
    });
    const rejectedRows = groupRows.filter((r: any) => {
      const status = (r.clientStatus || '').toUpperCase();
      return status === 'REJECTED';
    });

    if (enrolledRows.length > 0) {
      const totalPaidCents = enrolledRows.reduce((sum: number, r: any) => sum + (r.paidAmountCents || 0), 0);
      const order = await storage.getOrderById(orderId);
      const orderBase = Math.round(parseFloat(order?.baseCommissionEarned || "0") * 100);
      const orderIncentive = Math.round(parseFloat(order?.incentiveEarned || "0") * 100);
      const orderOverride = Math.round(parseFloat(order?.overrideDeduction || "0") * 100);
      const expectedCents = orderBase + orderIncentive + orderOverride;

      await storage.setOrderClientAcceptance(orderId, 'ACCEPTED', expectedCents || undefined);
      ordersAccepted++;

      const primaryRow = enrolledRows[0];
      const existingArs = await storage.getArExpectationsByOrderId(orderId);
      if (existingArs.length === 0) {
        const hasMultipleServices = order && (order.tvSold || order.mobileSold);

        if (hasMultipleServices && order) {
          const lineItems = await storage.getCommissionLineItemsByOrderId(orderId);
          const internetItems = lineItems.filter((li: any) => li.serviceCategory === 'INTERNET');
          const videoItems = lineItems.filter((li: any) => li.serviceCategory === 'VIDEO');
          const mobileItems = lineItems.filter((li: any) => li.serviceCategory === 'MOBILE');

          const internetCents = internetItems.reduce((s: number, li: any) => s + Math.round(parseFloat(li.totalAmount || "0") * 100), 0);
          const videoCents = videoItems.reduce((s: number, li: any) => s + Math.round(parseFloat(li.totalAmount || "0") * 100), 0);
          const mobileCents = mobileItems.reduce((s: number, li: any) => s + Math.round(parseFloat(li.totalAmount || "0") * 100), 0);
          const lineItemTotal = internetCents + videoCents + mobileCents;

          if (lineItemTotal > 0 && (videoCents > 0 || mobileCents > 0)) {
            const serviceBreakdown: { type: string; amountCents: number; installDate: string | null }[] = [];
            const internetWithOverride = internetCents + orderOverride;
            if (internetCents > 0) serviceBreakdown.push({ type: 'INTERNET', amountCents: internetWithOverride, installDate: order.installDate });
            if (videoCents > 0) serviceBreakdown.push({ type: 'VIDEO', amountCents: videoCents, installDate: order.tvInstallDate || order.installDate });
            if (mobileCents > 0) serviceBreakdown.push({ type: 'MOBILE', amountCents: mobileCents, installDate: order.mobileInstallDate || order.installDate });

            const noAmountImported = totalPaidCents === 0;
            let paidRemaining = totalPaidCents;
            for (let i = 0; i < serviceBreakdown.length; i++) {
              const svc = serviceBreakdown[i];
              const isFirst = i === 0;
              const allocated = noAmountImported ? 0 : Math.min(paidRemaining, svc.amountCents);
              if (!noAmountImported) paidRemaining -= allocated;
              const svcVariance = noAmountImported ? 0 : allocated - svc.amountCents;
              let svcStatus = noAmountImported ? 'SATISFIED' : 'OPEN';
              if (!noAmountImported && allocated > 0 && allocated >= svc.amountCents) svcStatus = 'SATISFIED';
              else if (!noAmountImported && allocated > 0) svcStatus = 'PARTIAL';

              await storage.createArExpectation({
                clientId: financeImport.clientId,
                orderId,
                financeImportRowId: isFirst ? primaryRow.id : null as any,
                expectedAmountCents: svc.amountCents,
                actualAmountCents: allocated,
                varianceAmountCents: svcVariance,
                expectedFromDate: primaryRow.saleDate || new Date().toISOString().split('T')[0],
                status: svcStatus,
                serviceType: svc.type,
                serviceInstallDate: svc.installDate,
                commissionAmountCents: svc.amountCents,
              });
              arCreated++;
            }

            const freshArs = await storage.getArExpectationsByOrderId(orderId);
            const allArsSatisfied = freshArs.every((ar: any) => ar.status === 'SATISFIED');
            if (allArsSatisfied && order) {
              const orderUpdate: Record<string, any> = { paymentStatus: 'PAID', paidDate: new Date().toISOString().split('T')[0] };
              if (order.jobStatus !== 'COMPLETED') orderUpdate.jobStatus = 'COMPLETED';
              if (order.approvalStatus !== 'APPROVED') orderUpdate.approvalStatus = 'APPROVED';
              await storage.updateOrder(orderId, orderUpdate);
              const freshOrder = await storage.getOrderById(orderId);
              if (freshOrder && freshOrder.approvalStatus === 'APPROVED' && !freshOrder.isPayrollHeld && !freshOrder.payrollReadyAt) {
                await storage.setPayrollReady(orderId, "AR_SATISFIED");
              }
            }
          } else {
            const noAmtFallback = totalPaidCents === 0;
            const varianceCents = noAmtFallback ? 0 : totalPaidCents - expectedCents;
            let arStatus = noAmtFallback ? 'SATISFIED' : 'OPEN';
            if (!noAmtFallback && totalPaidCents > 0 && totalPaidCents >= expectedCents) arStatus = 'SATISFIED';
            else if (!noAmtFallback && totalPaidCents > 0) arStatus = 'PARTIAL';
            await storage.createArExpectation({
              clientId: financeImport.clientId,
              orderId,
              financeImportRowId: primaryRow.id,
              expectedAmountCents: expectedCents,
              actualAmountCents: totalPaidCents,
              varianceAmountCents: varianceCents,
              expectedFromDate: primaryRow.saleDate || new Date().toISOString().split('T')[0],
              status: arStatus,
              serviceType: null,
              serviceInstallDate: order?.installDate || null,
              commissionAmountCents: expectedCents,
            });
            arCreated++;
            if (arStatus === 'SATISFIED' && order) {
              const orderUpdate: Record<string, any> = { paymentStatus: 'PAID', paidDate: new Date().toISOString().split('T')[0] };
              if (order.jobStatus !== 'COMPLETED') orderUpdate.jobStatus = 'COMPLETED';
              if (order.approvalStatus !== 'APPROVED') orderUpdate.approvalStatus = 'APPROVED';
              await storage.updateOrder(orderId, orderUpdate);
              const freshOrder = await storage.getOrderById(orderId);
              if (freshOrder && freshOrder.approvalStatus === 'APPROVED' && !freshOrder.isPayrollHeld && !freshOrder.payrollReadyAt) {
                await storage.setPayrollReady(orderId, "AR_SATISFIED");
              }
            }
          }
        } else {
          const noAmtSimple = totalPaidCents === 0;
          const varianceCents = noAmtSimple ? 0 : totalPaidCents - expectedCents;
          let arStatus = noAmtSimple ? 'SATISFIED' : 'OPEN';
          if (!noAmtSimple && totalPaidCents > 0 && totalPaidCents >= expectedCents) arStatus = 'SATISFIED';
          else if (!noAmtSimple && totalPaidCents > 0) arStatus = 'PARTIAL';
          await storage.createArExpectation({
            clientId: financeImport.clientId,
            orderId,
            financeImportRowId: primaryRow.id,
            expectedAmountCents: expectedCents,
            actualAmountCents: totalPaidCents,
            varianceAmountCents: varianceCents,
            expectedFromDate: primaryRow.saleDate || new Date().toISOString().split('T')[0],
            status: arStatus,
            serviceType: null,
            serviceInstallDate: order?.installDate || null,
            commissionAmountCents: expectedCents,
          });
          arCreated++;
          if (arStatus === 'SATISFIED' && order) {
            const orderUpdate: Record<string, any> = { paymentStatus: 'PAID', paidDate: new Date().toISOString().split('T')[0] };
            if (order.jobStatus !== 'COMPLETED') orderUpdate.jobStatus = 'COMPLETED';
            if (order.approvalStatus !== 'APPROVED') orderUpdate.approvalStatus = 'APPROVED';
            await storage.updateOrder(orderId, orderUpdate);
            const freshOrder = await storage.getOrderById(orderId);
            if (freshOrder && freshOrder.approvalStatus === 'APPROVED' && !freshOrder.isPayrollHeld && !freshOrder.payrollReadyAt) {
              await storage.setPayrollReady(orderId, "AR_SATISFIED");
            }
          }
        }
      }
    } else if (rejectedRows.length > 0) {
      await storage.setOrderClientAcceptance(orderId, 'REJECTED');
      ordersRejected++;
    }
  }

  await storage.updateFinanceImport(importId, { status: 'POSTED' });
  await storage.createAuditLog({
    userId,
    action: isAutoPost ? "finance_import_auto_posted" : "finance_import_posted",
    tableName: "finance_imports",
    recordId: importId,
    afterJson: JSON.stringify({ arCreated, ordersAccepted, ordersRejected, ...extraContext }),
  });

  return { arCreated, ordersAccepted, ordersRejected, orderRowGroups };
}

export interface ArRow {
  id: string;
  clientId: string;
  orderId: string | null;
  expectedAmountCents: number;
  actualAmountCents: number;
  varianceAmountCents: number;
  serviceType: string | null;
}

export interface VarianceExceptionDeps {
  getOrderById(id: string): Promise<any>;
  insertException(data: {
    exceptionType: string;
    severity: string;
    title: string;
    detail: string;
    relatedEntityId: string;
    relatedEntityType: string;
    status: string;
  }): Promise<void>;
}

export interface VarianceExceptionResult {
  exceptionsCreated: number;
  skippedNoAmount: number;
  skippedBelowThreshold: number;
  skippedExisting: number;
  skippedZeroVariance: number;
}

export async function evaluateVarianceExceptions(
  importId: string,
  orderRowGroups: Record<string, any[]>,
  allNewArRows: ArRow[],
  existingEntityIds: Set<string | null>,
  varianceThresholdPct: number,
  varianceThresholdCents: number,
  deps: VarianceExceptionDeps,
): Promise<VarianceExceptionResult> {
  const noAmountOrderIds = new Set<string>();
  for (const [oid, groupRows] of Object.entries(orderRowGroups)) {
    const enrolledRows = groupRows.filter((r: any) => {
      const s = (r.clientStatus || '').toUpperCase();
      return s === 'ENROLLED' || s === 'ACCEPTED' || s === 'COMPLETED' || s === 'ACTIVE';
    });
    const total = enrolledRows.reduce((sum: number, r: any) => sum + (r.paidAmountCents || 0), 0);
    if (total === 0) noAmountOrderIds.add(oid);
  }

  const result: VarianceExceptionResult = {
    exceptionsCreated: 0,
    skippedNoAmount: 0,
    skippedBelowThreshold: 0,
    skippedExisting: 0,
    skippedZeroVariance: 0,
  };

  for (const ar of allNewArRows) {
    if (!ar.orderId || !ar.varianceAmountCents || ar.varianceAmountCents === 0) {
      result.skippedZeroVariance++;
      continue;
    }
    if (noAmountOrderIds.has(ar.orderId)) {
      result.skippedNoAmount++;
      continue;
    }
    if (existingEntityIds.has(ar.id)) {
      result.skippedExisting++;
      continue;
    }

    const varPct = ar.expectedAmountCents > 0
      ? Math.abs(ar.varianceAmountCents / ar.expectedAmountCents * 100)
      : 0;
    if (Math.abs(ar.varianceAmountCents) < varianceThresholdCents && varPct < varianceThresholdPct) {
      result.skippedBelowThreshold++;
      continue;
    }

    const order = await deps.getOrderById(ar.orderId);
    const direction = ar.varianceAmountCents < 0 ? "underpaid" : "overpaid";
    const severity = Math.abs(ar.varianceAmountCents) >= 10000 || varPct >= 20 ? "HIGH" : "WARNING";

    await deps.insertException({
      exceptionType: "PAYMENT_VARIANCE",
      severity,
      title: `Payment ${direction} by $${(Math.abs(ar.varianceAmountCents) / 100).toFixed(2)} (${Math.round(varPct)}%)`,
      detail: `Import: ${importId}${order?.invoiceNumber ? `, Invoice: ${order.invoiceNumber}` : ""}${order?.customerName ? `, Customer: ${order.customerName}` : ""}${ar.serviceType ? `, Service: ${ar.serviceType}` : ""}. Expected: $${(ar.expectedAmountCents / 100).toFixed(2)}, Actual: $${(ar.actualAmountCents / 100).toFixed(2)}.`,
      relatedEntityId: ar.id,
      relatedEntityType: "ar_expectation",
      status: "OPEN",
    });
    result.exceptionsCreated++;
  }

  return result;
}
