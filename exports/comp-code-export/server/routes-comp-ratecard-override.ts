// ============================================
// EXTRACTED ROUTE HANDLERS: Rate Cards, Overrides, Commissions
// From: server/routes.ts
// ============================================

// --- Lines 2260-2332 ---
  app.get("/api/orders/:id/commission-breakdown", auth, async (req: AuthRequest, res) => {
    try {
      const order = await storage.getOrderById(req.params.id);
      if (!order) return res.status(404).json({ message: "Order not found" });

      const user = req.user!;
      if (["REP", "MDU"].includes(user.role) && order.repId !== user.repId) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (user.role === "LEAD") {
        const supervisedReps = await storage.getSupervisedReps(user.id);
        const allowedRepIds = [user.repId, ...supervisedReps.map(r => r.repId)];
        if (!allowedRepIds.includes(order.repId)) {
          return res.status(403).json({ message: "Access denied" });
        }
      }
      if (user.role === "MANAGER") {
        const scope = await storage.getManagerScope(user.id);
        const allowedRepIds = [user.repId, ...scope.allRepRepIds];
        if (!allowedRepIds.includes(order.repId)) {
          return res.status(403).json({ message: "Access denied" });
        }
      }
      if (user.role === "EXECUTIVE") {
        const scope = await storage.getExecutiveScope(user.id);
        const allowedRepIds = [user.repId, ...scope.allRepRepIds];
        if (!allowedRepIds.includes(order.repId)) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

      const lineItems = await storage.getCommissionLineItemsByOrderId(order.id);
      const overrideEarnings = await storage.getOverrideEarningsByOrder(order.id);

      const directorOverride = overrideEarnings
        .filter(e => e.overrideType === "DIRECTOR_OVERRIDE")
        .reduce((sum, e) => sum + parseFloat(e.amount || "0"), 0);
      const adminOverride = overrideEarnings
        .filter(e => e.overrideType === "ADMIN_OVERRIDE")
        .reduce((sum, e) => sum + parseFloat(e.amount || "0"), 0);
      const accountingOverride = overrideEarnings
        .filter(e => e.overrideType === "ACCOUNTING_OVERRIDE")
        .reduce((sum, e) => sum + parseFloat(e.amount || "0"), 0);

      const rackRate = (order.ironCrestRackRateCents || 0) / 100;
      const repPayout = parseFloat(order.baseCommissionEarned || "0");
      const ironCrestProfit = (order.ironCrestProfitCents || 0) / 100;

      const bundleComponents = lineItems.map(li => ({
        type: li.serviceCategory as "INTERNET" | "VIDEO" | "MOBILE",
        lines: li.quantity || 1,
        unitPayout: parseFloat(li.unitAmount || "0"),
        totalPayout: parseFloat(li.totalAmount || "0"),
      }));

      res.json({
        commissionBreakdown: {
          repRole: order.repRoleAtSale || "REP",
          repPayout,
          directorOverride,
          adminOverride,
          accountingOverride,
          rackRate,
          ironCrestProfit,
          profitMarginPercent: rackRate > 0 ? parseFloat(((ironCrestProfit / rackRate) * 100).toFixed(1)) : 0,
          bundleComponents,
        },
      });
    } catch (error: any) {
      console.error("Commission breakdown error:", error);
      res.status(500).json({ message: "Failed to get commission breakdown" });
    }
  });

// --- Lines 2334-2382 ---
  app.get("/api/orders/:id/commission-lines", auth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const user = req.user!;
      
      // Verify user has access to this order
      const order = await storage.getOrderById(id);
      if (!order) return res.status(404).json({ message: "Order not found" });
      
      // REP and MDU can only view their own orders' commission lines
      if (["REP", "MDU"].includes(user.role) && order.repId !== user.repId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      // LEAD can view their own + their team's orders
      if (user.role === "LEAD") {
        const supervisedReps = await storage.getSupervisedReps(user.id);
        const allowedRepIds = [user.repId, ...supervisedReps.map(r => r.repId)];
        if (!allowedRepIds.includes(order.repId)) {
          return res.status(403).json({ message: "Access denied" });
        }
      }
      
      // MANAGER can view their org tree's orders
      if (user.role === "MANAGER") {
        const scope = await storage.getManagerScope(user.id);
        const allowedRepIds = [user.repId, ...scope.allRepRepIds];
        if (!allowedRepIds.includes(order.repId)) {
          return res.status(403).json({ message: "Access denied" });
        }
      }
      
      // EXECUTIVE can view their org tree's orders
      if (user.role === "EXECUTIVE") {
        const scope = await storage.getExecutiveScope(user.id);
        const allowedRepIds = [user.repId, ...scope.allRepRepIds];
        if (!allowedRepIds.includes(order.repId)) {
          return res.status(403).json({ message: "Access denied" });
        }
      }
      
      // ADMIN and OPERATIONS can view all orders
      
      const lineItems = await storage.getCommissionLineItemsByOrderId(id);
      res.json(lineItems);
    } catch (error) {
      res.status(500).json({ message: "Failed to get commission line items" });
    }
  });

// --- Lines 2385-2491 ---
  app.post("/api/orders/:id/recalculate-commission", auth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const user = req.user!;
      
      const order = await storage.getOrderById(id);
      if (!order) return res.status(404).json({ message: "Order not found" });
      
      // Only admins and executives can recalculate commissions
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role)) {
        return res.status(403).json({ message: "Only admins and executives can recalculate commissions" });
      }
      
      // Delete existing commission line items
      await storage.deleteCommissionLineItemsByOrderId(id);
      
      // Find matching rate card and recalculate
      const rateCard = await storage.findMatchingRateCard(order, order.dateSold);
      let baseCommission = "0";
      let appliedRateCardId: string | null = null;
      let totalDeductions = 0;
      
      if (rateCard) {
        const lineItems = await storage.calculateCommissionLineItemsAsync(rateCard, order);
        await storage.createCommissionLineItems(order.id, lineItems);
        const grossCommission = lineItems.reduce((sum, item) => sum + parseFloat(item.totalAmount || "0"), 0);
        appliedRateCardId = rateCard.id;
        
        // Calculate override deductions based on user's role
        const salesRep = order.repId ? await storage.getUserByRepId(order.repId) : null;
        
        // Look up role-based override for this user's role
        const userRole = salesRep?.role || "REP";
        const roleOverride = await storage.getRoleOverrideForRateCard(rateCard.id, userRole);
        const isMobileOnlyOrder = (order as any).isMobileOrder === true;
        
        if (roleOverride) {
          const overrideAmounts = {
            base: parseFloat(roleOverride.overrideDeduction || "0"),
            tv: parseFloat(roleOverride.tvOverrideDeduction || "0"),
            mobile: parseFloat(roleOverride.mobileOverrideDeduction || "0"),
          };
          
          if (!isMobileOnlyOrder) {
            totalDeductions += overrideAmounts.base;
            if (order.tvSold) {
              totalDeductions += overrideAmounts.tv;
            }
          }
          if (order.mobileSold) {
            totalDeductions += overrideAmounts.mobile;
          }
        } else {
          // Fall back to rate card default overrides if no role-specific override exists
          const overrideAmounts = {
            base: parseFloat(rateCard.overrideDeduction || "0"),
            tv: parseFloat(rateCard.tvOverrideDeduction || "0"),
            mobile: parseFloat((rateCard as any).mobileOverrideDeduction || "0"),
          };
          
          if (!isMobileOnlyOrder) {
            totalDeductions += overrideAmounts.base;
            if (order.tvSold) {
              totalDeductions += overrideAmounts.tv;
            }
          }
          if (order.mobileSold) {
            totalDeductions += overrideAmounts.mobile;
          }
        }
        baseCommission = Math.max(0, grossCommission - totalDeductions).toFixed(2);
      }
      
      // Update order with recalculated commission
      const updatedOrder = await storage.updateOrder(order.id, {
        baseCommissionEarned: baseCommission,
        appliedRateCardId,
        calcAt: new Date(),
        overrideDeduction: totalDeductions.toFixed(2),
      });
      
      await storage.createAuditLog({ action: "recalculate_commission", tableName: "sales_orders", recordId: order.id, afterJson: JSON.stringify(updatedOrder), userId: user.id });
      
      // Cascade commission changes to AR expectation if one exists
      try {
        const arExpectation = await storage.getArExpectationByOrderId(order.id);
        if (arExpectation) {
          const newBase = parseFloat(updatedOrder.baseCommissionEarned || "0");
          const newIncentive = parseFloat(updatedOrder.incentiveEarned || "0");
          const newOverride = parseFloat(updatedOrder.overrideDeduction || "0");
          const newExpectedCents = Math.round((newBase + newIncentive + newOverride) * 100);
          const newVarianceCents = arExpectation.actualAmountCents - newExpectedCents;
          await storage.updateArExpectation(arExpectation.id, {
            expectedAmountCents: newExpectedCents,
            varianceAmountCents: newVarianceCents,
            hasVariance: newVarianceCents !== 0,
          });
        }
      } catch (arErr) {
        console.error("[Recalculate] Failed to cascade commission change to AR:", arErr);
      }

      res.json(updatedOrder);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to recalculate commission" });
    }
  });

// --- Lines 3623-3625 ---
  app.get("/api/admin/rate-cards", auth, requirePermission("system:ratecards:view"), async (req, res) => {
    try { res.json(await storage.getRateCards()); } catch (error) { res.status(500).json({ message: "Failed" }); }
  });

// --- Lines 3628-3634 ---
  app.get("/api/rate-cards/for-overrides", auth, async (req: AuthRequest, res) => {
    try {
      res.json(await storage.getRateCards());
    } catch (error) {
      res.status(500).json({ message: "Failed to get rate cards" });
    }
  });

// --- Lines 3637-3667 ---
  app.get("/api/rate-cards/mobile-check", auth, async (req, res) => {
    try {
      const { providerId, clientId, serviceId } = req.query;
      if (!providerId) return res.status(400).json({ hasMobileRates: false });
      
      // Find any active rate cards with non-zero mobile per-line amounts
      const allRateCards = await storage.getActiveRateCards();
      const mobileRateCards = allRateCards.filter(rc => {
        // Must match provider
        if (rc.providerId !== providerId) return false;
        // Client match (or no client specified on rate card = applies to all)
        if (rc.clientId && clientId && rc.clientId !== clientId) return false;
        // Service match (or no service specified on rate card = applies to all)
        if (rc.serviceId && serviceId && rc.serviceId !== serviceId) return false;
        // Must have mobile rate configured
        const mobileAmount = parseFloat(rc.mobilePerLineAmount || "0");
        return mobileAmount > 0 || rc.mobileProductType;
      });
      
      // Get distinct mobile product types from matching rate cards
      const mobileProductTypes = Array.from(new Set(mobileRateCards.filter(rc => rc.mobileProductType).map(rc => rc.mobileProductType))) as string[];
      
      res.json({ 
        hasMobileRates: mobileRateCards.length > 0,
        mobileProductTypes,
        rateCardCount: mobileRateCards.length
      });
    } catch (error) { 
      res.status(500).json({ hasMobileRates: false }); 
    }
  });

// --- Lines 3668-3684 ---
  app.post("/api/admin/rate-cards", auth, requirePermission("system:ratecards:edit"), async (req: AuthRequest, res) => {
    try {
      let { customServiceName, serviceId, ...rateCardData } = req.body;
      
      // If customServiceName provided but no serviceId, create a new service
      if (customServiceName && !serviceId) {
        const code = customServiceName.toUpperCase().replace(/[^A-Z0-9]/g, '_').substring(0, 20);
        const newService = await storage.createService({ name: customServiceName, code, active: true });
        await storage.createAuditLog({ action: "create_service", tableName: "services", recordId: newService.id, afterJson: JSON.stringify(newService), userId: req.user!.id });
        serviceId = newService.id;
      }
      
      const rateCard = await storage.createRateCard({ ...rateCardData, serviceId });
      await storage.createAuditLog({ action: "create_rate_card", tableName: "rate_cards", recordId: rateCard.id, afterJson: JSON.stringify(rateCard), userId: req.user!.id });
      res.json(rateCard);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });

// --- Lines 3685-3702 ---
  app.patch("/api/admin/rate-cards/:id", auth, requirePermission("system:ratecards:edit"), async (req: AuthRequest, res) => {
    try {
      let { customServiceName, serviceId, ...rateCardData } = req.body;
      
      // If customServiceName provided but no serviceId, create a new service
      if (customServiceName && !serviceId) {
        const code = customServiceName.toUpperCase().replace(/[^A-Z0-9]/g, '_').substring(0, 20);
        const newService = await storage.createService({ name: customServiceName, code, active: true });
        await storage.createAuditLog({ action: "create_service", tableName: "services", recordId: newService.id, afterJson: JSON.stringify(newService), userId: req.user!.id });
        serviceId = newService.id;
      }
      
      const updateData = serviceId ? { ...rateCardData, serviceId } : rateCardData;
      const rateCard = await storage.updateRateCard(req.params.id, updateData);
      await storage.createAuditLog({ action: "update_rate_card", tableName: "rate_cards", recordId: req.params.id, afterJson: JSON.stringify(rateCard), userId: req.user!.id });
      res.json(rateCard);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });

// --- Lines 3703-3716 ---
  app.delete("/api/admin/rate-cards/:id", auth, requirePermission("system:ratecards:edit"), async (req: AuthRequest, res) => {
    try {
      const depCount = await storage.getRateCardDependencyCount(req.params.id);
      const rateCard = await storage.softDeleteRateCard(req.params.id, req.user!.id);
      await storage.createAuditLog({ 
        action: "RATECARD_REMOVED", 
        tableName: "rate_cards", 
        recordId: req.params.id, 
        afterJson: JSON.stringify({ ...rateCard, dependenciesArchived: depCount }),
        userId: req.user!.id 
      });
      res.json({ success: true, archived: true, dependencyCount: depCount });
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed to remove rate card" }); }
  });

// --- Lines 3719-3723 ---
  app.get("/api/admin/rate-cards/:id/lead-overrides", auth, requirePermission("system:ratecards:view"), async (req, res) => {
    try {
      res.json(await storage.getRateCardLeadOverrides(req.params.id));
    } catch (error) { res.status(500).json({ message: "Failed to get lead overrides" }); }
  });

// --- Lines 3725-3738 ---
  app.post("/api/admin/rate-cards/:id/lead-overrides", auth, requirePermission("system:ratecards:edit"), async (req: AuthRequest, res) => {
    try {
      const { leadId, overrideDeduction, tvOverrideDeduction, mobileOverrideDeduction } = req.body;
      const override = await storage.upsertRateCardLeadOverride({
        rateCardId: req.params.id,
        leadId,
        overrideDeduction: overrideDeduction || "0",
        tvOverrideDeduction: tvOverrideDeduction || "0",
        mobileOverrideDeduction: mobileOverrideDeduction || "0",
      });
      await storage.createAuditLog({ action: "upsert_lead_override", tableName: "rate_card_lead_overrides", recordId: override.id, afterJson: JSON.stringify(override), userId: req.user!.id });
      res.json(override);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed to save lead override" }); }
  });

// --- Lines 3740-3746 ---
  app.delete("/api/admin/rate-cards/:rateCardId/lead-overrides/:id", auth, requirePermission("system:ratecards:edit"), async (req: AuthRequest, res) => {
    try {
      await storage.deleteRateCardLeadOverride(req.params.id);
      await storage.createAuditLog({ action: "delete_lead_override", tableName: "rate_card_lead_overrides", recordId: req.params.id, userId: req.user!.id });
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed to delete lead override" }); }
  });

// --- Lines 3749-3753 ---
  app.get("/api/admin/rate-cards/:id/role-overrides", auth, requirePermission("system:ratecards:view"), async (req, res) => {
    try {
      res.json(await storage.getRateCardRoleOverrides(req.params.id));
    } catch (error) { res.status(500).json({ message: "Failed to get role overrides" }); }
  });

// --- Lines 3755-3775 ---
  app.post("/api/admin/rate-cards/:id/role-overrides", auth, requirePermission("system:ratecards:edit"), async (req: AuthRequest, res) => {
    try {
      const validRoles = ["REP", "MDU", "LEAD", "MANAGER", "EXECUTIVE"];
      const { roleOverrides } = req.body;
      if (!Array.isArray(roleOverrides)) {
        return res.status(400).json({ message: "roleOverrides must be an array" });
      }
      const validatedOverrides = roleOverrides.filter((ro: any) => 
        ro && typeof ro === "object" && validRoles.includes(ro.role)
      ).map((ro: any) => ({
        role: ro.role,
        overrideDeduction: String(ro.overrideDeduction || "0"),
        tvOverrideDeduction: String(ro.tvOverrideDeduction || "0"),
        mobileOverrideDeduction: String(ro.mobileOverrideDeduction || "0"),
        isAdditive: ro.isAdditive === true,
      }));
      await storage.saveRateCardRoleOverrides(req.params.id, validatedOverrides);
      await storage.createAuditLog({ action: "update_role_overrides", tableName: "rate_card_role_overrides", recordId: req.params.id, userId: req.user!.id, afterJson: JSON.stringify(validatedOverrides) });
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed to save role overrides" }); }
  });

// --- Lines 3797-3799 ---
  app.get("/api/admin/overrides", auth, requirePermission("admin:overrides:manage"), async (req, res) => {
    try { res.json(await storage.getOverrideAgreements()); } catch (error) { res.status(500).json({ message: "Failed to fetch override agreements" }); }
  });

// --- Lines 3800-3810 ---
  app.post("/api/admin/overrides", auth, requirePermission("admin:overrides:manage"), async (req: AuthRequest, res) => {
    try {
      const validated = insertOverrideAgreementSchema.parse(req.body);
      const override = await storage.createOverrideAgreement(validated);
      await storage.createAuditLog({ action: "create_override_agreement", tableName: "override_agreements", recordId: override.id, afterJson: JSON.stringify(override), userId: req.user!.id });
      res.json(override);
    } catch (error: any) { 
      if (error.name === "ZodError") return res.status(400).json({ message: "Validation failed", errors: error.errors });
      res.status(500).json({ message: error.message || "Failed to create override agreement" }); 
    }
  });

// --- Lines 3811-3821 ---
  app.patch("/api/admin/overrides/:id", auth, requirePermission("admin:overrides:manage"), async (req: AuthRequest, res) => {
    try {
      const validated = insertOverrideAgreementSchema.partial().parse(req.body);
      const override = await storage.updateOverrideAgreement(req.params.id, validated);
      await storage.createAuditLog({ action: "update_override_agreement", tableName: "override_agreements", recordId: req.params.id, afterJson: JSON.stringify(override), userId: req.user!.id });
      res.json(override);
    } catch (error: any) { 
      if (error.name === "ZodError") return res.status(400).json({ message: "Validation failed", errors: error.errors });
      res.status(500).json({ message: error.message || "Failed to update override agreement" }); 
    }
  });

// --- Lines 3822-3828 ---
  app.delete("/api/admin/overrides/:id", auth, requirePermission("admin:overrides:manage"), async (req: AuthRequest, res) => {
    try {
      const override = await storage.updateOverrideAgreement(req.params.id, { active: false });
      await storage.createAuditLog({ action: "soft_delete_override_agreement", tableName: "override_agreements", recordId: req.params.id, afterJson: JSON.stringify(override), userId: req.user!.id });
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed to delete override agreement" }); }
  });

// --- Lines 4382-4402 ---
  app.get("/api/admin/override-pool", auth, requirePermission("admin:overridepool"), async (req: AuthRequest, res) => {
    try {
      const status = req.query.status as "PENDING" | "DISTRIBUTED" | undefined;
      const entries = await storage.getOverrideDeductionPoolEntries(status);
      
      // Enrich with order and rate card details
      const enrichedEntries = await Promise.all(entries.map(async (entry) => {
        const order = await storage.getOrderById(entry.salesOrderId);
        const rateCard = await storage.getRateCardById(entry.rateCardId);
        return {
          ...entry,
          invoiceNumber: order?.invoiceNumber,
          repId: order?.repId,
          dateSold: order?.dateSold,
          rateCardName: rateCard ? `${rateCard.providerId ? "Provider" : "General"} Rate` : "Unknown",
        };
      }));
      
      res.json(enrichedEntries);
    } catch (error) { res.status(500).json({ message: "Failed to fetch pool entries" }); }
  });

// --- Lines 4404-4409 ---
  app.get("/api/admin/override-pool/total", auth, requirePermission("admin:overridepool"), async (req: AuthRequest, res) => {
    try {
      const total = await storage.getPendingPoolTotal();
      res.json({ total });
    } catch (error) { res.status(500).json({ message: "Failed to fetch pool total" }); }
  });

// --- Lines 4412-4449 ---
  app.get("/api/admin/payruns/:id/override-pool", auth, requirePermission("admin:overridepool"), async (req: AuthRequest, res) => {
    try {
      const orders = await storage.getOrdersByPayRunId(req.params.id);
      if (orders.length === 0) return res.json([]);
      
      const orderIds = orders.map(o => o.id);
      const poolEntries = await storage.getOverrideDeductionPoolByOrderIds(orderIds);
      
      // Enrich with order details and existing distributions
      const enrichedEntries = await Promise.all(poolEntries.map(async (entry) => {
        const order = orders.find(o => o.id === entry.salesOrderId);
        const distributions = await storage.getOverrideDistributionsByPoolEntry(entry.id);
        const distributedTotal = distributions.reduce((sum, d) => sum + parseFloat(d.calculatedAmount), 0);
        
        // Enrich distributions with recipient names
        const enrichedDistributions = await Promise.all(distributions.map(async (dist) => {
          const recipient = await storage.getUserById(dist.recipientUserId);
          return {
            ...dist,
            recipientName: recipient?.name || "Unknown",
            recipientRepId: recipient?.repId || "Unknown",
          };
        }));
        
        return {
          ...entry,
          invoiceNumber: order?.invoiceNumber,
          repId: order?.repId,
          dateSold: order?.dateSold,
          distributions: enrichedDistributions,
          distributedTotal: distributedTotal.toFixed(2),
          remainingAmount: (parseFloat(entry.amount) - distributedTotal).toFixed(2),
        };
      }));
      
      res.json(enrichedEntries);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });

// --- Lines 4795-4932 ---
  app.post("/api/admin/recalculate-commissions", auth, requirePermission("admin:recalculate"), async (req: AuthRequest, res) => {
    try {
      const { orderIds, providerId, clientId, dateFrom, dateTo, recalculateAll } = req.body;
      
      let orders: SalesOrder[];
      
      if (recalculateAll) {
        orders = await storage.getOrders({});
      } else if (orderIds && orderIds.length > 0) {
        orders = await Promise.all(orderIds.map((id: string) => storage.getOrderById(id)));
        orders = orders.filter((o): o is SalesOrder => o !== undefined);
      } else {
        const allOrders = await storage.getOrders({});
        orders = allOrders.filter((o: SalesOrder) => {
          if (providerId && o.providerId !== providerId) return false;
          if (clientId && o.clientId !== clientId) return false;
          if (dateFrom && new Date(o.dateSold) < new Date(dateFrom)) return false;
          if (dateTo && new Date(o.dateSold) > new Date(dateTo)) return false;
          return true;
        });
      }

      let recalculated = 0;
      let errors = 0;
      const errorDetails: string[] = [];

      for (const order of orders) {
        try {
          await storage.deleteCommissionLineItemsByOrderId(order.id);
          
          const rateCard = await storage.findMatchingRateCard(order, order.dateSold);
          let baseCommission = "0";
          let appliedRateCardId: string | null = null;
          let totalDeductions = 0;
          
          if (rateCard) {
            const lineItems = await storage.calculateCommissionLineItemsAsync(rateCard, order);
            await storage.createCommissionLineItems(order.id, lineItems);
            const grossCommission = lineItems.reduce((sum, item) => sum + parseFloat(item.totalAmount || "0"), 0);
            appliedRateCardId = rateCard.id;
            
            // Calculate override deductions based on user's role
            const salesRep = order.repId ? await storage.getUserByRepId(order.repId) : null;
            
            // Look up role-based override for this user's role
            const userRole = salesRep?.role || "REP";
            const roleOverride = await storage.getRoleOverrideForRateCard(rateCard.id, userRole);
            const isMobileOnlyOrder = (order as any).isMobileOrder === true;
            
            if (roleOverride) {
              const overrideAmounts = {
                base: parseFloat(roleOverride.overrideDeduction || "0"),
                tv: parseFloat(roleOverride.tvOverrideDeduction || "0"),
                mobile: parseFloat(roleOverride.mobileOverrideDeduction || "0"),
              };
              
              if (!isMobileOnlyOrder) {
                totalDeductions += overrideAmounts.base;
                if (order.tvSold) {
                  totalDeductions += overrideAmounts.tv;
                }
              }
              if (order.mobileSold) {
                totalDeductions += overrideAmounts.mobile;
              }
            } else {
              // Fall back to rate card default overrides if no role-specific override exists
              const overrideAmounts = {
                base: parseFloat(rateCard.overrideDeduction || "0"),
                tv: parseFloat(rateCard.tvOverrideDeduction || "0"),
                mobile: parseFloat((rateCard as any).mobileOverrideDeduction || "0"),
              };
              
              if (!isMobileOnlyOrder) {
                totalDeductions += overrideAmounts.base;
                if (order.tvSold) {
                  totalDeductions += overrideAmounts.tv;
                }
              }
              if (order.mobileSold) {
                totalDeductions += overrideAmounts.mobile;
              }
            }
            baseCommission = Math.max(0, grossCommission - totalDeductions).toFixed(2);
          }
          
          const updatedOrder = await storage.updateOrder(order.id, {
            baseCommissionEarned: baseCommission,
            appliedRateCardId,
            calcAt: new Date(),
            overrideDeduction: totalDeductions.toFixed(2),
          });
          
          // Cascade to AR expectation
          try {
            const arExp = await storage.getArExpectationByOrderId(order.id);
            if (arExp) {
              const nb = parseFloat(updatedOrder.baseCommissionEarned || "0");
              const ni = parseFloat(updatedOrder.incentiveEarned || "0");
              const no = parseFloat(updatedOrder.overrideDeduction || "0");
              const expCents = Math.round((nb + ni + no) * 100);
              const varCents = arExp.actualAmountCents - expCents;
              await storage.updateArExpectation(arExp.id, {
                expectedAmountCents: expCents,
                varianceAmountCents: varCents,
                hasVariance: varCents !== 0,
              });
            }
          } catch (arErr) {
            console.error("[BulkRecalc] AR cascade error for order", order.id, arErr);
          }

          recalculated++;
        } catch (err: any) {
          errors++;
          errorDetails.push(`Order ${order.invoiceNumber || order.id}: ${err.message}`);
        }
      }

      await storage.createAuditLog({
        action: "bulk_recalculate_commissions",
        tableName: "sales_orders",
        afterJson: JSON.stringify({ recalculated, errors, filters: { providerId, clientId, dateFrom, dateTo, recalculateAll } }),
        userId: req.user!.id,
      });

      res.json({ 
        recalculated, 
        errors, 
        total: orders.length,
        errorDetails: errorDetails.slice(0, 10),
        message: `Recalculated ${recalculated} orders${errors > 0 ? `, ${errors} errors` : ""}` 
      });
    } catch (error: any) {
      console.error("Bulk recalculation error:", error);
      res.status(500).json({ message: error.message || "Recalculation failed" });
    }
  });

// --- Lines 7139-7334 ---
  app.get("/api/commissions", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const viewMode = req.query.viewMode as string | undefined; // "own", "team", "global" for EXECUTIVE
      const isRep = user.role === "REP";
      
      // Get orders based on role and viewMode
      let ordersToQuery: SalesOrder[];
      if (user.role === "EXECUTIVE" && viewMode === "global") {
        ordersToQuery = await storage.getOrders();
      } else if (user.role === "EXECUTIVE" && viewMode === "team") {
        const scope = await storage.getExecutiveScope(user.id);
        const teamRepIds = [...scope.allRepRepIds, user.repId];
        ordersToQuery = await storage.getOrders({ teamRepIds });
      } else {
        ordersToQuery = await storage.getOrders();
      }
      
      // For "own" view or default behavior, filter to user's own orders
      // For "own" view, filter to user's own orders only; for team/global, include all from the queried set
      const allOrders = ordersToQuery;
      const showGlobalOrTeam = (user.role === "EXECUTIVE" && (viewMode === "global" || viewMode === "team")) ||
                               user.role === "ADMIN" || user.role === "OPERATIONS";
      const myOrders = showGlobalOrTeam
        ? allOrders.filter((o: SalesOrder) => o.jobStatus === "COMPLETED")
        : allOrders.filter((o: SalesOrder) => o.repId === user.repId && o.jobStatus === "COMPLETED");
      
      // Batch fetch all commission line items in a single query
      const allLineItems = await storage.getCommissionLineItemsByOrderIds(myOrders.map(o => o.id));
      const lineItemsByOrder: Record<string, any[]> = {};
      for (const item of allLineItems) {
        if (!lineItemsByOrder[item.salesOrderId]) lineItemsByOrder[item.salesOrderId] = [];
        lineItemsByOrder[item.salesOrderId].push(item);
      }
      
      const ownSoldCommissions = myOrders.map((o: SalesOrder) => {
        const lines = lineItemsByOrder[o.id] || [];
        return {
          id: o.id,
          dateSold: o.dateSold,
          customerName: o.customerName,
          accountNumber: o.accountNumber,
          baseCommission: parseFloat(o.baseCommissionEarned),
          incentive: parseFloat(o.incentiveEarned),
          total: parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned),
          serviceBreakdown: {
            internet: lines.filter((l: any) => l.serviceCategory === "INTERNET").reduce((sum: number, l: any) => sum + parseFloat(l.totalAmount), 0),
            mobile: lines.filter((l: any) => l.serviceCategory === "MOBILE").reduce((sum: number, l: any) => sum + parseFloat(l.totalAmount), 0),
            video: lines.filter((l: any) => l.serviceCategory === "VIDEO").reduce((sum: number, l: any) => sum + parseFloat(l.totalAmount), 0),
          },
        };
      });
      
      // Calculate service totals
      const serviceTotals = {
        internet: myOrders.reduce((sum: number, o: SalesOrder) => {
          const lines = lineItemsByOrder[o.id] || [];
          return sum + lines.filter((l: any) => l.serviceCategory === "INTERNET").reduce((s: number, l: any) => s + parseFloat(l.totalAmount), 0);
        }, 0),
        mobile: myOrders.reduce((sum: number, o: SalesOrder) => {
          const lines = lineItemsByOrder[o.id] || [];
          return sum + lines.filter((l: any) => l.serviceCategory === "MOBILE").reduce((s: number, l: any) => s + parseFloat(l.totalAmount), 0);
        }, 0),
        video: myOrders.reduce((sum: number, o: SalesOrder) => {
          const lines = lineItemsByOrder[o.id] || [];
          return sum + lines.filter((l: any) => l.serviceCategory === "VIDEO").reduce((s: number, l: any) => s + parseFloat(l.totalAmount), 0);
        }, 0),
      };
      
      const ownTotalConnected = myOrders.length;
      const ownTotalEarned = myOrders.reduce((sum: number, o: SalesOrder) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
      
      // Calculate weekly and MTD earnings (America/New_York timezone)
      const now = new Date();
      const nyOffset = -5 * 60; // EST offset in minutes
      const nyNow = new Date(now.getTime() + (now.getTimezoneOffset() + nyOffset) * 60000);
      
      // Week start (Monday)
      const dayOfWeek = nyNow.getDay();
      const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const weekStart = new Date(nyNow);
      weekStart.setDate(nyNow.getDate() - daysFromMonday);
      weekStart.setHours(0, 0, 0, 0);
      
      // Month start
      const monthStart = new Date(nyNow.getFullYear(), nyNow.getMonth(), 1);
      
      const weeklyEarned = myOrders
        .filter((o: SalesOrder) => o.approvedAt && new Date(o.approvedAt) >= weekStart)
        .reduce((sum: number, o: SalesOrder) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
      
      const mtdEarned = myOrders
        .filter((o: SalesOrder) => o.approvedAt && new Date(o.approvedAt) >= monthStart)
        .reduce((sum: number, o: SalesOrder) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
      
      // Get pending orders (not yet completed but still active) based on view mode
      const pendingOrders = showGlobalOrTeam
        ? allOrders.filter((o: SalesOrder) => 
            o.jobStatus !== "COMPLETED" && o.jobStatus !== "CANCELED"
          )
        : allOrders.filter((o: SalesOrder) => 
            o.repId === user.repId && 
            o.jobStatus !== "COMPLETED" &&
            o.jobStatus !== "CANCELED"
          );
      
      // Calculate pending commissions (estimated from baseCommissionEarned which is pre-calculated)
      const pendingWeekly = pendingOrders
        .filter((o: SalesOrder) => new Date(o.dateSold) >= weekStart)
        .reduce((sum: number, o: SalesOrder) => sum + parseFloat(o.baseCommissionEarned || "0") + parseFloat(o.incentiveEarned || "0"), 0);
      
      const pendingMtd = pendingOrders
        .filter((o: SalesOrder) => new Date(o.dateSold) >= monthStart)
        .reduce((sum: number, o: SalesOrder) => sum + parseFloat(o.baseCommissionEarned || "0") + parseFloat(o.incentiveEarned || "0"), 0);
      
      // Calculate 30-day rolling average for connected commissions
      const thirtyDaysAgo = new Date(nyNow);
      thirtyDaysAgo.setDate(nyNow.getDate() - 30);
      
      const last30DaysConnected = myOrders
        .filter((o: SalesOrder) => o.approvedAt && new Date(o.approvedAt) >= thirtyDaysAgo)
        .reduce((sum: number, o: SalesOrder) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
      
      const rollingAverage30Days = last30DaysConnected / 30;
      
      // Generate daily data for charts (last 7 days for weekly, current month for MTD)
      const weeklyChartData: { day: string; amount: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date(nyNow);
        date.setDate(nyNow.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
        const dayTotal = myOrders
          .filter((o: SalesOrder) => o.approvedAt && new Date(o.approvedAt).toISOString().split('T')[0] === dateStr)
          .reduce((sum: number, o: SalesOrder) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
        weeklyChartData.push({ day: dayName, amount: dayTotal });
      }
      
      const mtdChartData: { day: string; amount: number }[] = [];
      const daysInMonth = new Date(nyNow.getFullYear(), nyNow.getMonth() + 1, 0).getDate();
      for (let d = 1; d <= Math.min(nyNow.getDate(), daysInMonth); d++) {
        const date = new Date(nyNow.getFullYear(), nyNow.getMonth(), d);
        const dateStr = date.toISOString().split('T')[0];
        const dayTotal = myOrders
          .filter((o: SalesOrder) => o.approvedAt && new Date(o.approvedAt).toISOString().split('T')[0] === dateStr)
          .reduce((sum: number, o: SalesOrder) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
        mtdChartData.push({ day: d.toString(), amount: dayTotal });
      }
      
      // For non-REP roles, also get override earnings
      let overrideEarnings: any[] = [];
      let overrideTotalEarned = 0;
      
      if (!isRep) {
        const rawOverrides = await storage.getOverrideEarningsByRecipient(user.id);
        
        // Get order details for each override
        for (const override of rawOverrides) {
          const order = allOrders.find((o: SalesOrder) => o.id === override.salesOrderId);
          if (order) {
            overrideEarnings.push({
              id: override.id,
              salesOrderId: override.salesOrderId,
              sourceRepId: override.sourceRepId,
              sourceLevelUsed: override.sourceLevelUsed,
              amount: parseFloat(override.amount),
              dateSold: order.dateSold,
              customerName: order.customerName,
            });
            overrideTotalEarned += parseFloat(override.amount);
          }
        }
      }
      
      res.json({
        role: user.role,
        ownSoldCommissions,
        ownTotalConnected,
        ownTotalEarned,
        serviceTotals,
        weeklyEarned,
        mtdEarned,
        pendingWeekly,
        pendingMtd,
        rollingAverage30Days,
        weeklyChartData,
        mtdChartData,
        overrideEarnings: isRep ? null : overrideEarnings,
        overrideTotalEarned: isRep ? null : overrideTotalEarned,
        grandTotal: ownTotalEarned + overrideTotalEarned,
      });
    } catch (error) {
      console.error("Commissions error:", error);
      res.status(500).json({ message: "Failed to fetch commissions" });
    }
  });

// --- Lines 7818-7866 ---
  app.get("/api/reports/commission-summary", auth, async (req: AuthRequest, res) => {
    try {
      const { period = "this_month", startDate, endDate, viewMode } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      const allOrders = await storage.getOrders({});
      const users = await storage.getUsers();
      const { filteredOrders: orders } = await applyRoleBasedOrderFilter(allOrders, user, viewMode as string | undefined);
      
      const periodOrders = orders.filter(o => {
        const orderDate = new Date(o.dateSold);
        return orderDate >= start && orderDate < end;
      });
      
      const repSummary: Record<string, { name: string; earned: number; paid: number; outstanding: number; orders: number }> = {};
      
      for (const order of periodOrders) {
        if (!repSummary[order.repId]) {
          const repUser = users.find(u => u.repId === order.repId);
          repSummary[order.repId] = { name: repUser?.name || order.repId, earned: 0, paid: 0, outstanding: 0, orders: 0 };
        }
        repSummary[order.repId].orders++;
        if (order.jobStatus === "COMPLETED") {
          const earned = parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned);
          const paid = parseFloat(order.commissionPaid);
          repSummary[order.repId].earned += earned;
          repSummary[order.repId].paid += paid;
          repSummary[order.repId].outstanding += (earned - paid);
        }
      }
      
      const data = Object.entries(repSummary)
        .map(([repId, stats]) => ({ repId, ...stats }))
        .sort((a, b) => b.earned - a.earned);
      
      const totals = data.reduce((acc, rep) => ({
        totalEarned: acc.totalEarned + rep.earned,
        totalPaid: acc.totalPaid + rep.paid,
        totalOutstanding: acc.totalOutstanding + rep.outstanding,
        totalOrders: acc.totalOrders + rep.orders,
      }), { totalEarned: 0, totalPaid: 0, totalOutstanding: 0, totalOrders: 0 });
      
      res.json({ data, totals });
    } catch (error) {
      console.error("Commission summary error:", error);
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

// --- Lines 8152-8245 ---
  app.get("/api/reports/override-invoices", auth, async (req: AuthRequest, res) => {
    try {
      const { period = "this_month", startDate, endDate, recipientId } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      // ADMIN, OPERATIONS, and EXECUTIVE can see all override earnings
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const overrideEarnings = await storage.getOverrideEarnings();
      const orders = await storage.getOrders({});
      const users = await storage.getUsers();
      const overrideAgreements = await storage.getOverrideAgreements();
      
      // Filter by date and optionally by recipient
      const filteredEarnings = overrideEarnings.filter(e => {
        const order = orders.find(o => o.id === e.salesOrderId);
        if (!order) return false;
        const orderDate = new Date(order.dateSold);
        if (orderDate < start || orderDate >= end) return false;
        if (recipientId && e.recipientUserId !== recipientId) return false;
        return true;
      });
      
      // Group by invoice/order
      const invoiceMap: Record<string, {
        orderId: string;
        invoiceNumber: string | null;
        customerName: string;
        dateSold: string;
        repName: string;
        totalOverride: number;
        overrides: Array<{
          recipientName: string;
          recipientRole: string;
          amount: string;
          agreementId: string | null;
        }>;
      }> = {};
      
      for (const earning of filteredEarnings) {
        const order = orders.find(o => o.id === earning.salesOrderId);
        if (!order) continue;
        
        const recipient = users.find(u => u.id === earning.recipientUserId);
        const rep = users.find(u => u.repId === order.repId);
        
        if (!invoiceMap[order.id]) {
          invoiceMap[order.id] = {
            orderId: order.id,
            invoiceNumber: order.invoiceNumber,
            customerName: order.customerName,
            dateSold: order.dateSold,
            repName: rep?.name || order.repId,
            totalOverride: 0,
            overrides: [],
          };
        }
        
        const amount = parseFloat(earning.amount);
        invoiceMap[order.id].totalOverride += amount;
        invoiceMap[order.id].overrides.push({
          recipientName: recipient?.name || earning.recipientUserId,
          recipientRole: earning.sourceLevelUsed,
          amount: earning.amount,
          agreementId: earning.overrideAgreementId,
        });
      }
      
      const data = Object.values(invoiceMap).sort((a, b) => 
        new Date(b.dateSold).getTime() - new Date(a.dateSold).getTime()
      );
      
      // Get totals
      const totalOverrides = data.reduce((sum, inv) => sum + inv.totalOverride, 0);
      const invoiceCount = data.length;
      
      // Get eligible recipients for filter dropdown
      const recipients = users
        .filter(u => ["LEAD", "MANAGER", "EXECUTIVE", "ADMIN"].includes(u.role) && !u.deletedAt)
        .map(u => ({ id: u.id, name: u.name, role: u.role }));
      
      res.json({ 
        data, 
        totals: { totalOverrides: totalOverrides.toFixed(2), invoiceCount },
        recipients,
      });
    } catch (error) {
      console.error("Override invoices error:", error);
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

// --- Lines 11120-11130 ---
  app.get("/api/admin/commission-tiers", auth, requirePermission("admin:bonuses"), async (req: AuthRequest, res) => {
    try {
      const filters: any = {};
      if (req.query.providerId) filters.providerId = req.query.providerId;
      if (req.query.isActive !== undefined) filters.isActive = req.query.isActive === "true";
      const tiers = await storage.getCommissionTiers(filters);
      res.json(tiers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

// --- Lines 11132-11141 ---
  app.get("/api/admin/commission-tiers/:id", auth, requirePermission("admin:bonuses"), async (req: AuthRequest, res) => {
    try {
      const tier = await storage.getCommissionTierById(req.params.id);
      if (!tier) return res.status(404).json({ message: "Tier not found" });
      const levels = await storage.getTierLevels(req.params.id);
      res.json({ ...tier, levels });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

// --- Lines 11143-11176 ---
  app.post("/api/admin/commission-tiers", auth, requirePermission("admin:bonuses"), async (req: AuthRequest, res) => {
    try {
      const { levels, ...tierData } = req.body;
      const tier = await storage.createCommissionTier({
        ...tierData,
        createdByUserId: req.user!.id,
      });

      if (levels && Array.isArray(levels)) {
        for (const level of levels) {
          await storage.createTierLevel({
            tierId: tier.id,
            minVolume: level.minVolume,
            maxVolume: level.maxVolume,
            bonusPercentage: level.bonusPercentage,
            bonusFlat: level.bonusFlat,
            multiplier: level.multiplier,
          });
        }
      }

      await storage.createAuditLog({
        action: "commission_tier_created",
        tableName: "commission_tiers",
        recordId: tier.id,
        afterJson: JSON.stringify({ ...tier, levels }),
        userId: req.user!.id,
      });

      res.status(201).json(tier);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

// --- Lines 11178-11201 ---
  app.patch("/api/admin/commission-tiers/:id", auth, requirePermission("admin:bonuses"), async (req: AuthRequest, res) => {
    try {
      const { levels, ...tierData } = req.body;
      const tier = await storage.updateCommissionTier(req.params.id, tierData);

      if (levels && Array.isArray(levels)) {
        await storage.deleteTierLevels(req.params.id);
        for (const level of levels) {
          await storage.createTierLevel({
            tierId: req.params.id,
            minVolume: level.minVolume,
            maxVolume: level.maxVolume,
            bonusPercentage: level.bonusPercentage,
            bonusFlat: level.bonusFlat,
            multiplier: level.multiplier,
          });
        }
      }

      res.json(tier);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

// --- Lines 11292-11302 ---
  app.get("/api/admin/commission-forecasts", auth, requirePermission("reports:financial"), async (req: AuthRequest, res) => {
    try {
      const filters: any = {};
      if (req.query.userId) filters.userId = req.query.userId;
      if (req.query.forecastPeriod) filters.forecastPeriod = req.query.forecastPeriod;
      const forecasts = await storage.getCommissionForecasts(filters);
      res.json(forecasts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

// --- Lines 11304-11318 ---
  app.get("/api/admin/commission-forecasts/calculate/:userId", auth, requirePermission("reports:financial"), async (req: AuthRequest, res) => {
    try {
      const { periodType = "MONTH", periodStart, periodEnd } = req.query as any;
      const now = new Date();
      const start = periodStart || now.toISOString().slice(0, 10);
      const endDate = new Date(now);
      endDate.setMonth(endDate.getMonth() + 1);
      const end = periodEnd || endDate.toISOString().slice(0, 10);

      const forecast = await storage.calculateCommissionForecast(req.params.userId, periodType, start, end);
      res.json(forecast);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

// --- Lines 11638-11693 ---
  app.get("/api/commission-forecast", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const period = (req.query.period as string) || "MONTH";
      const requestedUserId = req.query.userId as string | undefined;
      
      // Determine target user ID
      let targetUserId = user.id;
      
      // ADMIN, OPERATOR, and EXECUTIVE can view any user's forecast
      if (requestedUserId && ["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role)) {
        targetUserId = requestedUserId;
      }
      
      const { start: periodStart, end: periodEnd } = getPeriodRange(period);
      
      const forecast = await storage.calculateCommissionForecast(
        targetUserId,
        period,
        periodStart.toISOString().split("T")[0],
        periodEnd.toISOString().split("T")[0]
      );
      
      // Calculate projected commission based on historical average and pending
      const projectedCommission = (
        parseFloat(forecast.pendingCommission) + 
        (parseFloat(forecast.historicalAverage) * forecast.projectedOrders)
      ).toFixed(2);
      
      // Confidence score based on data availability
      const hasHistory = parseFloat(forecast.historicalAverage) > 0;
      const confidenceScore = hasHistory ? 75 : 40;
      
      res.json({
        period: {
          type: period,
          start: periodStart.toISOString().split("T")[0],
          end: periodEnd.toISOString().split("T")[0],
        },
        pending: {
          orders: forecast.pendingOrders,
          commission: forecast.pendingCommission,
        },
        projected: {
          orders: forecast.projectedOrders,
          commission: projectedCommission,
        },
        historical: {
          averageCommission: forecast.historicalAverage,
        },
        confidenceScore,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

// --- Lines 11696-11770 ---
  app.get("/api/admin/commission-forecast", auth, managerOrAdmin, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const period = (req.query.period as string) || "MONTH";
      const repId = req.query.repId as string | undefined;
      
      const { start: periodStart } = getPeriodRange(period);
      const now = new Date();
      
      // Get scoped users based on role
      let scopedUsers: any[] = [];
      const allUsers = await storage.getActiveUsers();
      
      if (user.role === "ADMIN" || user.role === "OPERATIONS") {
        scopedUsers = allUsers.filter(u => ["REP", "LEAD"].includes(u.role));
      } else if (user.role === "EXECUTIVE") {
        const scope = await storage.getExecutiveScope(user.id);
        scopedUsers = allUsers.filter(u => scope.allRepRepIds.includes(u.repId));
      } else if (user.role === "MANAGER") {
        const scope = await storage.getManagerScope(user.id);
        const teamRepIds = [...scope.directRepIds, ...scope.indirectRepIds];
        scopedUsers = allUsers.filter(u => teamRepIds.includes(u.repId));
      }
      
      // Filter to specific rep if requested
      if (repId) {
        scopedUsers = scopedUsers.filter(u => u.repId === repId);
      }
      
      // Calculate forecasts for each rep
      const forecasts = await Promise.all(scopedUsers.map(async (rep) => {
        const forecast = await storage.calculateCommissionForecast(
          rep.id,
          period,
          periodStart.toISOString().split("T")[0],
          now.toISOString().split("T")[0]
        );
        
        const projectedCommission = (
          parseFloat(forecast.pendingCommission) + 
          (parseFloat(forecast.historicalAverage) * forecast.projectedOrders)
        ).toFixed(2);
        
        return {
          repId: rep.repId,
          repName: rep.name,
          pendingOrders: forecast.pendingOrders,
          pendingCommission: forecast.pendingCommission,
          projectedOrders: forecast.projectedOrders,
          projectedCommission,
          historicalAverage: forecast.historicalAverage,
        };
      }));
      
      // Company totals
      const totals = {
        pendingOrders: forecasts.reduce((sum, f) => sum + f.pendingOrders, 0),
        pendingCommission: forecasts.reduce((sum, f) => sum + parseFloat(f.pendingCommission), 0).toFixed(2),
        projectedOrders: forecasts.reduce((sum, f) => sum + f.projectedOrders, 0),
        projectedCommission: forecasts.reduce((sum, f) => sum + parseFloat(f.projectedCommission), 0).toFixed(2),
      };
      
      res.json({
        period: {
          type: period,
          start: periodStart.toISOString().split("T")[0],
          end: now.toISOString().split("T")[0],
        },
        totals,
        byRep: forecasts.sort((a, b) => parseFloat(b.projectedCommission) - parseFloat(a.projectedCommission)),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

// --- Lines 15213-15262 ---
  app.get("/api/admin/override-earnings/pending", auth, overrideApprovalAccess, async (req: AuthRequest, res) => {
    try {
      const { overrideType, recipientUserId, orderId } = req.query;
      const filters: { overrideType?: string; recipientUserId?: string; orderId?: string } = {};
      if (overrideType) filters.overrideType = overrideType as string;
      if (recipientUserId) filters.recipientUserId = recipientUserId as string;
      if (orderId) filters.orderId = orderId as string;

      const pending = await storage.getPendingOverrideEarnings(filters);
      const users = await storage.getUsers();
      const userMap = new Map(users.map(u => [u.id, u]));
      const allServices = await storage.getServices();
      const serviceMap = new Map(allServices.map(s => [s.id, s.name]));
      const allClients = await storage.getClients();
      const clientMap = new Map(allClients.map(c => [c.id, c.name]));

      const enriched = await Promise.all(pending.map(async (e) => {
        const order = await storage.getOrderById(e.salesOrderId);
        const recipient = userMap.get(e.recipientUserId);
        const rep = order ? userMap.get(Array.from(userMap.values()).find(u => u.repId === order.repId)?.id || "") : null;
        return {
          id: e.id,
          salesOrderId: e.salesOrderId,
          orderInvoiceNumber: order?.invoiceNumber || "",
          orderCustomerName: order?.customerName || "",
          orderDateSold: order?.dateSold || "",
          recipientUserId: e.recipientUserId,
          recipientName: recipient?.fullName || recipient?.name || "Unknown",
          recipientRole: recipient?.role || "Unknown",
          overrideType: e.overrideType || "STANDARD",
          amount: e.amount,
          approvalStatus: e.approvalStatus || "PENDING_APPROVAL",
          createdAt: e.createdAt,
          order: order ? {
            repId: order.repId,
            repName: rep?.fullName || rep?.name || order.repId,
            repRole: order.repRoleAtSale || rep?.role || "REP",
            serviceName: order.serviceId ? (serviceMap.get(order.serviceId) || "") : "",
            providerName: order.clientId ? (clientMap.get(order.clientId) || "") : "",
            jobStatus: order.jobStatus,
            approvalStatus: order.approvalStatus,
          } : null,
        };
      }));
      res.json(enriched);
    } catch (error: any) {
      console.error("Get pending override earnings error:", error);
      res.status(500).json({ message: "Failed to get pending override earnings" });
    }
  });

// --- Lines 15264-15271 ---
  app.get("/api/admin/override-earnings/pending/count", auth, overrideApprovalAccess, async (req: AuthRequest, res) => {
    try {
      const count = await storage.getPendingOverrideEarningsCount();
      res.json({ count });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get pending count" });
    }
  });

// --- Lines 15273-15318 ---
  app.post("/api/admin/override-earnings/:id/approve", auth, overrideApprovalAccess, async (req: AuthRequest, res) => {
    try {
      const earning = await storage.getOverrideEarningById(req.params.id);
      if (!earning) {
        return res.status(404).json({ message: "Override earning not found" });
      }
      if (earning.approvalStatus !== "PENDING_APPROVAL") {
        return res.status(400).json({ message: `Cannot approve: status is ${earning.approvalStatus}` });
      }
      if (earning.recipientUserId === req.user!.id) {
        return res.status(403).json({ message: "Cannot approve your own override earning (self-approval not allowed)" });
      }
      if (!canApproveOverrideType(req.user!.role, earning.overrideType || "STANDARD")) {
        return res.status(403).json({ message: `Your role (${req.user!.role}) cannot approve ${earning.overrideType} overrides` });
      }
      const { note } = req.body || {};
      const updated = await storage.approveOverrideEarning(req.params.id, req.user!.id, note);
      const users = await storage.getUsers();
      const recipientUser = users.find(u => u.id === earning.recipientUserId);
      const order = await storage.getOrderById(earning.salesOrderId);
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "OVERRIDE_EARNING_APPROVED",
        tableName: "override_earnings",
        recordId: req.params.id,
        afterJson: JSON.stringify({ approvedBy: req.user!.name, overrideType: earning.overrideType, amount: earning.amount, recipientName: recipientUser?.fullName || recipientUser?.name }),
      });
      if (recipientUser) {
        try {
          await storage.createEmailNotification({
            userId: recipientUser.id,
            notificationType: "OVERRIDE_APPROVED",
            subject: "Override Earning Approved",
            body: `Your ${earning.overrideType} override of $${earning.amount} for order ${order?.invoiceNumber || earning.salesOrderId} has been approved and will be included in your next pay run.`,
            recipientEmail: "",
            status: "PENDING",
            isRead: false,
          });
        } catch (e) {}
      }
      res.json(updated);
    } catch (error: any) {
      console.error("Approve override earning error:", error);
      res.status(500).json({ message: "Failed to approve override earning" });
    }
  });

// --- Lines 15320-15368 ---
  app.post("/api/admin/override-earnings/:id/reject", auth, overrideApprovalAccess, async (req: AuthRequest, res) => {
    try {
      const earning = await storage.getOverrideEarningById(req.params.id);
      if (!earning) {
        return res.status(404).json({ message: "Override earning not found" });
      }
      if (earning.approvalStatus !== "PENDING_APPROVAL") {
        return res.status(400).json({ message: `Cannot reject: status is ${earning.approvalStatus}` });
      }
      if (earning.recipientUserId === req.user!.id) {
        return res.status(403).json({ message: "Cannot reject your own override earning" });
      }
      if (!canApproveOverrideType(req.user!.role, earning.overrideType || "STANDARD")) {
        return res.status(403).json({ message: `Your role (${req.user!.role}) cannot reject ${earning.overrideType} overrides` });
      }
      const { reason } = req.body || {};
      if (!reason) {
        return res.status(400).json({ message: "reason is required" });
      }
      const updated = await storage.rejectOverrideEarning(req.params.id, req.user!.id, reason);
      const users = await storage.getUsers();
      const recipientUser = users.find(u => u.id === earning.recipientUserId);
      const order = await storage.getOrderById(earning.salesOrderId);
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "OVERRIDE_EARNING_REJECTED",
        tableName: "override_earnings",
        recordId: req.params.id,
        afterJson: JSON.stringify({ rejectedBy: req.user!.name, reason, overrideType: earning.overrideType, amount: earning.amount, recipientName: recipientUser?.fullName || recipientUser?.name }),
      });
      if (recipientUser) {
        try {
          await storage.createEmailNotification({
            userId: recipientUser.id,
            notificationType: "OVERRIDE_REJECTED",
            subject: "Override Earning Rejected",
            body: `Your ${earning.overrideType} override of $${earning.amount} for order ${order?.invoiceNumber || earning.salesOrderId} was rejected. Reason: ${reason}`,
            recipientEmail: "",
            status: "PENDING",
            isRead: false,
          });
        } catch (e) {}
      }
      res.json(updated);
    } catch (error: any) {
      console.error("Reject override earning error:", error);
      res.status(500).json({ message: "Failed to reject override earning" });
    }
  });

// --- Lines 15370-15437 ---
  app.post("/api/admin/override-earnings/bulk-approve", auth, overrideApprovalAccess, async (req: AuthRequest, res) => {
    try {
      const { ids, note } = req.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids array is required" });
      }
      const pendingEarnings = await storage.getPendingOverrideEarnings();
      const userRole = req.user!.role;
      const userId = req.user!.id;

      const skippedIds: string[] = [];
      const skippedReasons: Record<string, string> = {};
      const approvableIds: string[] = [];

      for (const id of ids) {
        const earning = pendingEarnings.find(e => e.id === id);
        if (!earning) {
          skippedIds.push(id);
          skippedReasons[id] = "Not found or not pending";
          continue;
        }
        if (earning.recipientUserId === userId) {
          skippedIds.push(id);
          skippedReasons[id] = "Self-approval not allowed";
          continue;
        }
        if (!canApproveOverrideType(userRole, earning.overrideType || "STANDARD")) {
          skippedIds.push(id);
          skippedReasons[id] = `Role ${userRole} cannot approve ${earning.overrideType}`;
          continue;
        }
        approvableIds.push(id);
      }

      if (approvableIds.length === 0) {
        return res.json({ approved: 0, skipped: skippedIds.length, skippedIds, skippedReasons });
      }

      const updated = await storage.bulkApproveOverrideEarnings(approvableIds, userId, note);
      await storage.createAuditLog({
        userId,
        action: "BULK_APPROVE_OVERRIDE_EARNINGS",
        tableName: "override_earnings",
        recordId: approvableIds.join(","),
        afterJson: JSON.stringify({ count: updated.length, skipped: skippedIds.length }),
      });

      for (const earning of updated) {
        try {
          const order = await storage.getOrderById(earning.salesOrderId);
          await storage.createEmailNotification({
            userId: earning.recipientUserId,
            notificationType: "OVERRIDE_APPROVED",
            subject: "Override Earning Approved",
            body: `Your ${earning.overrideType} override of $${earning.amount} for order ${order?.invoiceNumber || earning.salesOrderId} has been approved and will be included in your next pay run.`,
            recipientEmail: "",
            status: "PENDING",
            isRead: false,
          });
        } catch (e) {}
      }

      res.json({ approved: updated.length, skipped: skippedIds.length, skippedIds, skippedReasons });
    } catch (error: any) {
      console.error("Bulk approve override earnings error:", error);
      res.status(500).json({ message: "Failed to bulk approve" });
    }
  });

// --- Lines 15439-15496 ---
  app.post("/api/admin/override-earnings/bulk-reject", auth, overrideApprovalAccess, async (req: AuthRequest, res) => {
    try {
      const { ids, reason } = req.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids array is required" });
      }
      if (!reason) {
        return res.status(400).json({ message: "reason is required" });
      }
      const pendingEarnings = await storage.getPendingOverrideEarnings();
      const userRole = req.user!.role;
      const userId = req.user!.id;

      const rejectableIds: string[] = [];
      const skippedIds: string[] = [];

      for (const id of ids) {
        const earning = pendingEarnings.find(e => e.id === id);
        if (!earning) { skippedIds.push(id); continue; }
        if (earning.recipientUserId === userId) { skippedIds.push(id); continue; }
        if (!canApproveOverrideType(userRole, earning.overrideType || "STANDARD")) { skippedIds.push(id); continue; }
        rejectableIds.push(id);
      }

      if (rejectableIds.length === 0) {
        return res.json({ rejected: 0, skipped: skippedIds.length });
      }

      const updated = await storage.bulkRejectOverrideEarnings(rejectableIds, userId, reason);
      await storage.createAuditLog({
        userId,
        action: "BULK_REJECT_OVERRIDE_EARNINGS",
        tableName: "override_earnings",
        recordId: rejectableIds.join(","),
        afterJson: JSON.stringify({ count: updated.length, reason }),
      });

      for (const earning of updated) {
        try {
          const order = await storage.getOrderById(earning.salesOrderId);
          await storage.createEmailNotification({
            userId: earning.recipientUserId,
            notificationType: "OVERRIDE_REJECTED",
            subject: "Override Earning Rejected",
            body: `Your ${earning.overrideType} override of $${earning.amount} for order ${order?.invoiceNumber || earning.salesOrderId} was rejected. Reason: ${reason}`,
            recipientEmail: "",
            status: "PENDING",
            isRead: false,
          });
        } catch (e) {}
      }

      res.json({ rejected: updated.length, skipped: skippedIds.length });
    } catch (error: any) {
      console.error("Bulk reject override earnings error:", error);
      res.status(500).json({ message: "Failed to bulk reject" });
    }
  });

// --- Lines 18229-18295 ---
  app.post("/api/admin/reserves/:userId/override-cap", auth, requirePermission("reserves:override:cap"), async (req: AuthRequest, res) => {
    try {
      const { userId } = req.params;
      const { newCapCents, newWithholdingPercent, reason } = req.body;
      const adminUser = req.user!;

      if (!newCapCents || newCapCents < 250000) {
        return res.status(400).json({ message: "Cap cannot be less than $2,500 (250000 cents)" });
      }
      if (newWithholdingPercent !== undefined && (newWithholdingPercent < 15 || newWithholdingPercent > 50)) {
        return res.status(400).json({ message: "Withholding percent must be between 15 and 50" });
      }
      if (!reason) {
        return res.status(400).json({ message: "reason is required" });
      }

      const reserve = await getOrCreateReserve(userId);

      const updates: any = {
        capCents: newCapCents,
        capOverrideReason: reason,
        capOverrideByUserId: adminUser.id,
        capOverrideAt: new Date(),
        updatedAt: new Date(),
      };
      if (newWithholdingPercent !== undefined) {
        updates.withholdingPercent = newWithholdingPercent.toFixed(2);
      }

      if (reserve.currentBalanceCents < newCapCents && reserve.status === "AT_CAP") {
        updates.status = "ACTIVE";
      }

      await db
        .update(rollingReserves)
        .set(updates)
        .where(eq(rollingReserves.id, reserve.id));

      if (updates.status) {
        await db.update(users).set({ reserveStatus: updates.status }).where(eq(users.id, userId));
      }

      await storage.createAuditLog({
        action: "RESERVE_CAP_OVERRIDE",
        tableName: "rolling_reserves",
        recordId: reserve.id,
        afterJson: JSON.stringify({ newCapCents, newWithholdingPercent, reason }),
        userId: adminUser.id,
      });

      const [targetUser] = await db.select({ name: users.name, repId: users.repId }).from(users).where(eq(users.id, userId));
      await db.insert(systemExceptions).values({
        exceptionType: "RESERVE_CAP_OVERRIDE_ACTIVE",
        severity: "INFO",
        title: `Cap override applied: ${targetUser?.name || userId}`,
        detail: `New cap: $${(newCapCents / 100).toFixed(2)}, withholding: ${newWithholdingPercent ?? parseFloat(reserve.withholdingPercent)}%. Reason: ${reason}`,
        relatedUserId: userId,
        relatedEntityId: reserve.id,
        relatedEntityType: "rolling_reserve",
      });

      res.json({ message: "Cap override applied", newCap: newCapCents / 100, withholdingPercent: newWithholdingPercent ?? parseFloat(reserve.withholdingPercent) });
    } catch (error: any) {
      console.error("Reserve cap override error:", error);
      res.status(500).json({ message: "Failed to override cap" });
    }
  });

