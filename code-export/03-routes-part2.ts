        o.paymentStatus === "UNPAID" && 
        !o.payRunId
      );

      if (payRun.weekEndingDate) {
        const weekEnd = new Date(payRun.weekEndingDate);
        weekEnd.setHours(23, 59, 59, 999);
        const weekStart = new Date(payRun.weekEndingDate);
        weekStart.setDate(weekStart.getDate() - 6);
        weekStart.setHours(0, 0, 0, 0);
        
        eligible = eligible.filter(o => {
          if (!o.approvedAt) return false;
          const approvedAt = new Date(o.approvedAt);
          return approvedAt >= weekStart && approvedAt <= weekEnd;
        });
      }

      if (eligible.length === 0) {
        return res.json({ linked: 0, message: "No eligible orders found for this pay period" });
      }

      const orderIds = eligible.map(o => o.id);
      const orders = await storage.linkOrdersToPayRun(orderIds, req.params.id);
      await storage.updateOverrideEarningsPayRunId(orderIds, req.params.id);

      await storage.createAuditLog({ 
        action: "link_all_orders_to_payrun", 
        tableName: "pay_runs", 
        recordId: req.params.id, 
        afterJson: JSON.stringify({ count: orders.length }), 
        userId: req.user!.id 
      });
      res.json({ linked: orders.length, message: `Linked ${orders.length} orders to pay run` });
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });

  app.post("/api/admin/payruns/:id/unlink-orders", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { orderIds } = req.body;
      if (!orderIds?.length) return res.status(400).json({ message: "No orders to unlink" });
      
      const payRun = await storage.getPayRunById(req.params.id);
      if (!payRun) return res.status(404).json({ message: "Pay run not found" });
      if (payRun.status === "FINALIZED") return res.status(400).json({ message: "Cannot unlink from finalized pay runs" });
      
      // Unlink specified orders using storage method
      await storage.unlinkSpecificOrders(orderIds);
      
      // Also unlink override earnings for these orders
      await storage.updateOverrideEarningsPayRunId(orderIds, null);
      
      await storage.createAuditLog({ 
        action: "unlink_orders_from_payrun", 
        tableName: "pay_runs", 
        recordId: req.params.id, 
        afterJson: JSON.stringify({ orderIds }), 
        userId: req.user!.id 
      });
      res.json({ unlinked: orderIds.length });
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });

  // Get approved orders not yet linked to a pay run
  // If weekEndingDate is provided, filter orders by approval date falling within that pay week
  app.get("/api/admin/payruns/unlinked-orders", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const weekEndingDate = req.query.weekEndingDate as string | undefined;
      const orders = await storage.getOrders();
      
      let unlinked = orders.filter(o => 
        o.jobStatus === "COMPLETED" && 
        o.approvalStatus === "APPROVED" &&
        o.paymentStatus === "UNPAID" && 
        !o.payRunId
      );
      
      // If weekEndingDate is provided, filter by approval date within the pay week
      // Pay week is 7 days ending on weekEndingDate (inclusive)
      if (weekEndingDate) {
        const weekEnd = new Date(weekEndingDate);
        weekEnd.setHours(23, 59, 59, 999);
        const weekStart = new Date(weekEndingDate);
        weekStart.setDate(weekStart.getDate() - 6);
        weekStart.setHours(0, 0, 0, 0);
        
        unlinked = unlinked.filter(o => {
          if (!o.approvedAt) return false;
          const approvedAt = new Date(o.approvedAt);
          return approvedAt >= weekStart && approvedAt <= weekEnd;
        });
      }
      
      res.json(unlinked);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });

  // Adjustments
  app.get("/api/adjustments", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      if (user.role === "ADMIN") {
        res.json(await storage.getAdjustments());
      } else {
        res.json(await storage.getAdjustmentsByUser(user.id));
      }
    } catch (error) { res.status(500).json({ message: "Failed" }); }
  });
  app.post("/api/adjustments", auth, async (req: AuthRequest, res) => {
    try {
      const adjustment = await storage.createAdjustment({ ...req.body, createdByUserId: req.user!.id });
      await storage.createAuditLog({ action: "create_adjustment", tableName: "adjustments", recordId: adjustment.id, afterJson: JSON.stringify(adjustment), userId: req.user!.id });
      res.json(adjustment);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });
  const canApproveAdjustments = (req: AuthRequest, res: any, next: any) => {
    if (req.user?.role === "ADMIN" || req.user?.role === "OPERATIONS" || req.user?.role === "EXECUTIVE") {
      next();
    } else {
      res.status(403).json({ message: "Only Admin and Executive can approve adjustments" });
    }
  };

  app.post("/api/admin/adjustments/:id/approve", auth, canApproveAdjustments, async (req: AuthRequest, res) => {
    try {
      const adjustment = await storage.updateAdjustment(req.params.id, { approvalStatus: "APPROVED", approvedByUserId: req.user!.id, approvedAt: new Date() });
      await storage.createAuditLog({ action: "approve_adjustment", tableName: "adjustments", recordId: req.params.id, afterJson: JSON.stringify(adjustment), userId: req.user!.id });
      res.json(adjustment);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });
  app.post("/api/admin/adjustments/:id/reject", auth, canApproveAdjustments, async (req: AuthRequest, res) => {
    try {
      const adjustment = await storage.updateAdjustment(req.params.id, { approvalStatus: "REJECTED", approvedByUserId: req.user!.id, approvedAt: new Date() });
      await storage.createAuditLog({ action: "reject_adjustment", tableName: "adjustments", recordId: req.params.id, afterJson: JSON.stringify(adjustment), userId: req.user!.id });
      res.json(adjustment);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });

  // Override Deduction Pool
  app.get("/api/admin/override-pool", auth, adminOnly, async (req: AuthRequest, res) => {
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

  app.get("/api/admin/override-pool/total", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const total = await storage.getPendingPoolTotal();
      res.json({ total });
    } catch (error) { res.status(500).json({ message: "Failed to fetch pool total" }); }
  });

  // Override Distribution Management (Manual Distribution)
  app.get("/api/admin/payruns/:id/override-pool", auth, adminOnly, async (req: AuthRequest, res) => {
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

  app.get("/api/admin/payruns/:id/distributions", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const distributions = await storage.getOverrideDistributionsByPayRun(req.params.id);
      
      // Enrich with recipient names and pool entry details
      const enriched = await Promise.all(distributions.map(async (dist) => {
        const recipient = await storage.getUserById(dist.recipientUserId);
        const poolEntry = await storage.getOverrideDeductionPoolByOrderId(dist.poolEntryId);
        return {
          ...dist,
          recipientName: recipient?.name || "Unknown",
          recipientRepId: recipient?.repId || "Unknown",
        };
      }));
      
      res.json(enriched);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });

  app.post("/api/admin/payruns/:id/distributions", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { poolEntryId, recipientUserId, allocationType, allocationValue } = req.body;
      
      // Get pool entry to validate and calculate amount
      const poolEntries = await storage.getOverrideDeductionPoolByOrderId(poolEntryId);
      const poolEntry = poolEntries.find(e => e.id === poolEntryId);
      if (!poolEntry) {
        // Try to get by ID directly
        const allEntries = await storage.getOverrideDeductionPoolEntries();
        const entry = allEntries.find(e => e.id === poolEntryId);
        if (!entry) return res.status(404).json({ message: "Pool entry not found" });
      }
      
      const poolAmount = parseFloat(poolEntry?.amount || "0");
      let calculatedAmount = 0;
      
      if (allocationType === "PERCENT") {
        calculatedAmount = poolAmount * (parseFloat(allocationValue) / 100);
      } else {
        calculatedAmount = parseFloat(allocationValue);
      }
      
      // Check if distribution would exceed pool amount
      const existingDistributions = await storage.getOverrideDistributionsByPoolEntry(poolEntryId);
      const existingTotal = existingDistributions.reduce((sum, d) => sum + parseFloat(d.calculatedAmount), 0);
      
      if (existingTotal + calculatedAmount > poolAmount + 0.01) {
        return res.status(400).json({ 
          message: `Distribution exceeds pool amount. Available: $${(poolAmount - existingTotal).toFixed(2)}` 
        });
      }
      
      const distribution = await storage.createOverrideDistribution({
        payRunId: req.params.id,
        poolEntryId,
        recipientUserId,
        allocationType,
        allocationValue: allocationValue.toString(),
        calculatedAmount: calculatedAmount.toFixed(2),
        status: "PENDING",
        createdByUserId: req.user!.id,
      });
      
      await storage.createAuditLog({
        action: "create_override_distribution",
        tableName: "override_distributions",
        recordId: distribution.id,
        afterJson: JSON.stringify(distribution),
        userId: req.user!.id,
      });
      
      res.json(distribution);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });

  app.delete("/api/admin/payruns/:payRunId/distributions/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      await storage.deleteOverrideDistribution(req.params.id);
      await storage.createAuditLog({
        action: "delete_override_distribution",
        tableName: "override_distributions",
        recordId: req.params.id,
        userId: req.user!.id,
      });
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });

  // Accounting Export/Import
  app.post("/api/admin/accounting/export-approved", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { reexport } = req.body;
      const orders = reexport ? await storage.getAllApproved() : await storage.getApprovedUnexported();
      if (orders.length === 0) {
        return res.status(400).json({ message: reexport ? "No approved orders to export" : "No new orders to export" });
      }

      const batch = await storage.createExportBatch(req.user!.id, orders.length, `export-${new Date().toISOString()}.csv`);
      
      for (const order of orders) {
        await storage.updateOrder(order.id, { exportedToAccounting: true, exportBatchId: batch.id, exportedAt: new Date() });
      }

      // Helper to format date as MM/DD/YYYY
      const formatDate = (dateStr: string | null | undefined): string => {
        if (!dateStr) return "";
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        const year = d.getFullYear();
        return `${month}/${day}/${year}`;
      };

      // Build CSV data with override deduction info
      const csvData = await Promise.all(orders.map(async (o: any) => {
        // Base commission from rate card
        const baseCommission = parseFloat(o.baseCommissionEarned || "0");
        const incentive = parseFloat(o.incentiveEarned || "0");
        
        // Get commission line items for TV commission
        const commissionLines = await storage.getCommissionLineItemsByOrderId(o.id);
        const tvCommission = commissionLines
          .filter((line: any) => line.serviceCategory === "VIDEO")
          .reduce((sum: number, line: any) => sum + parseFloat(line.totalAmount || "0"), 0);
        
        // Get mobile line items for mobile quantity and commission
        const mobileLines = await storage.getMobileLineItemsByOrderId(o.id);
        const mobileQuantitySold = mobileLines.length;
        const mobileCommission = mobileLines
          .reduce((sum: number, line: any) => sum + parseFloat(line.commissionAmount || "0"), 0);
        
        // Calculate overall combined commission (Base + TV + Mobile)
        const combinedCommission = baseCommission + tvCommission + mobileCommission;
        
        const grossCommission = baseCommission + incentive;
        
        // Get override deductions for this order from the pool
        const poolEntries = await storage.getOverrideDeductionPoolByOrderId(o.id);
        const totalOverrideDeduction = poolEntries.reduce((sum, entry) => sum + parseFloat(entry.amount || "0"), 0);
        
        // Net commission after override deduction
        const netCommission = grossCommission - totalOverrideDeduction;

        // Install type labels
        const typeLabels: Record<string, string> = {
          "AGENT_INSTALL": "Agent Install",
          "DIRECT_SHIP": "Direct Ship",
          "TECH_INSTALL": "Tech Install",
        };
        
        // Look up user name by repId
        const user = await storage.getUserByRepId(o.repId);
        
        return {
          "Invoice #": o.invoiceNumber || "",
          "Rep ID": o.repId,
          "User Name": user?.name || "",
          "Customer Name": o.customerName || "",
          "Account #": o.accountNumber || "",
          "House #/Bldg": o.houseNumber || "",
          "Street": o.streetName || "",
          "Apt/Unit": o.aptUnit || "",
          "City": o.city || "",
          "Zip Code": o.zipCode || "",
          "Address": o.customerAddress || "",
          "Date Sold": formatDate(o.dateSold),
          "Install Date": formatDate(o.installDate),
          "Install Type": o.installType ? (typeLabels[o.installType] || o.installType) : "",
          "Base Commission": baseCommission.toFixed(2),
          "TV Commission": tvCommission.toFixed(2),
          "Mobile Qty Sold": mobileQuantitySold.toString(),
          "Mobile Commission": mobileCommission.toFixed(2),
          "Combined Commission": combinedCommission.toFixed(2),
          "Incentive": incentive.toFixed(2),
          "Gross Commission": grossCommission.toFixed(2),
          "Override": totalOverrideDeduction.toFixed(2),
          "Net Commission": netCommission.toFixed(2),
          "Client": o.client?.name || "",
          "Provider": o.provider?.name || "",
        };
      }));

      const csv = stringify(csvData, { header: true });
      await storage.createAuditLog({ action: "export_accounting", tableName: "sales_orders", afterJson: JSON.stringify({ count: orders.length, batchId: batch.id }), userId: req.user!.id });
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="export-${new Date().toISOString().split("T")[0]}.csv"`);
      res.send(csv);
    } catch (error) { res.status(500).json({ message: "Export failed" }); }
  });

  app.post("/api/admin/accounting/import-payments", auth, adminOnly, upload.single("file"), async (req: AuthRequest, res) => {
    try {
      // Validate file upload
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      if (req.file.size > MAX_FILE_SIZE) {
        return res.status(413).json({ message: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` });
      }
      // Validate file extension
      if (!req.file.originalname.toLowerCase().endsWith('.csv')) {
        return res.status(415).json({ message: "Invalid file type. Only CSV files are allowed for payment imports" });
      }

      const payRunId = req.body.payRunId || null;
      const csvContent = req.file.buffer.toString("utf-8");
      const records = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, any>[];
      
      if (!validateRowCount(records, res)) return;

      let matched = 0;
      let unmatched = 0;
      const unmatchedRows: any[] = [];

      for (const row of records) {
        const invoiceNumber = row.invoiceNumber || row.invoice_number || row.Invoice || row["Invoice Number"] || row.InvoiceNumber;
        const amount = parseFloat(row.amount || row.Amount || row.payment || row.Payment || "0");
        const paidDate = row.paidDate || row.paid_date || row.PaidDate || row.date || row.Date || new Date().toISOString().split("T")[0];
        const quickbooksRefId = row.refId || row.ref_id || row.RefId || row.reference || row.Reference || null;

        if (!invoiceNumber) {
          unmatchedRows.push({ row, reason: "Missing invoice number" });
          unmatched++;
          continue;
        }

        const order = await storage.getOrderByInvoiceNumber(invoiceNumber);
        if (order) {
          await storage.updateOrder(order.id, {
            paidDate: paidDate,
            commissionPaid: amount.toString(),
            paymentStatus: "PAID",
            quickbooksRefId: quickbooksRefId,
            payRunId: payRunId,
          });
          matched++;
        } else {
          await storage.createUnmatchedPayment({
            payRunId: payRunId,
            rawRowJson: JSON.stringify(row),
            reason: `No order found with invoice number: ${invoiceNumber}`,
          });
          unmatched++;
        }
      }

      await storage.createAuditLog({
        action: "import_payments",
        tableName: "sales_orders",
        afterJson: JSON.stringify({ matched, unmatched, payRunId }),
        userId: req.user!.id,
      });

      res.json({ matched, unmatched, message: `Imported ${matched} payments, ${unmatched} unmatched` });
    } catch (error: any) {
      console.error("Payment import error:", error);
      res.status(500).json({ message: error.message || "Import failed" });
    }
  });

  // Chargeback import
  app.post("/api/admin/chargebacks/import", auth, adminOnly, upload.single("file"), async (req: AuthRequest, res) => {
    try {
      // Validate file upload
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      if (req.file.size > MAX_FILE_SIZE) {
        return res.status(413).json({ message: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` });
      }
      // Validate file extension
      if (!req.file.originalname.toLowerCase().endsWith('.csv')) {
        return res.status(415).json({ message: "Invalid file type. Only CSV files are allowed for chargeback imports" });
      }

      const payRunId = req.body.payRunId || null;
      const csvContent = req.file.buffer.toString("utf-8");
      const records = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, any>[];
      
      if (!validateRowCount(records, res)) return;

      let matched = 0;
      let unmatched = 0;

      for (const row of records) {
        const invoiceNumber = row.invoiceNumber || row.invoice_number || row.Invoice || row["Invoice Number"] || row.InvoiceNumber;
        const amount = parseFloat(row.amount || row.Amount || row.chargeback || row.Chargeback || "0");
        const chargebackDate = row.chargebackDate || row.chargeback_date || row.date || row.Date || new Date().toISOString().split("T")[0];
        const reason = row.reason || row.Reason || "CANCELLATION";
        const notes = row.notes || row.Notes || null;
        const quickbooksRefId = row.refId || row.ref_id || row.RefId || row.reference || row.Reference || null;

        if (!invoiceNumber) {
          await storage.createUnmatchedChargeback({
            payRunId: payRunId,
            rawRowJson: JSON.stringify(row),
            reason: "Missing invoice number",
          });
          unmatched++;
          continue;
        }

        const order = await storage.getOrderByInvoiceNumber(invoiceNumber);
        if (order) {
          await storage.createChargeback({
            invoiceNumber: invoiceNumber,
            salesOrderId: order.id,
            repId: order.repId,
            amount: Math.abs(amount).toString(),
            reason: reason as any,
            chargebackDate: chargebackDate,
            quickbooksRefId: quickbooksRefId,
            payRunId: payRunId,
            notes: notes,
            createdByUserId: req.user!.id,
          });
          matched++;
        } else {
          await storage.createUnmatchedChargeback({
            payRunId: payRunId,
            rawRowJson: JSON.stringify(row),
            reason: `No order found with invoice number: ${invoiceNumber}`,
          });
          unmatched++;
        }
      }

      await storage.createAuditLog({
        action: "import_chargebacks",
        tableName: "chargebacks",
        afterJson: JSON.stringify({ matched, unmatched, payRunId }),
        userId: req.user!.id,
      });

      res.json({ matched, unmatched, message: `Imported ${matched} chargebacks, ${unmatched} unmatched` });
    } catch (error: any) {
      console.error("Chargeback import error:", error);
      res.status(500).json({ message: error.message || "Import failed" });
    }
  });

  // Bulk commission recalculation
  app.post("/api/admin/recalculate-commissions", auth, adminOnly, async (req: AuthRequest, res) => {
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

  // Reports API
  app.get("/api/admin/reports/summary", auth, executiveOrAdmin, async (req: AuthRequest, res) => {
    try {
      const { dateFrom, dateTo, providerId, clientId } = req.query as Record<string, string>;
      
      let orders: SalesOrder[] = await storage.getOrders({});
      
      if (dateFrom) orders = orders.filter((o: SalesOrder) => new Date(o.dateSold) >= new Date(dateFrom));
      if (dateTo) orders = orders.filter((o: SalesOrder) => new Date(o.dateSold) <= new Date(dateTo));
      if (providerId) orders = orders.filter((o: SalesOrder) => o.providerId === providerId);
      if (clientId) orders = orders.filter((o: SalesOrder) => o.clientId === clientId);

      const users = await storage.getUsers();
      const providers = await storage.getProviders();
      const clients = await storage.getClients();

      const totalOrders = orders.length;
      const completedOrders = orders.filter((o: SalesOrder) => o.jobStatus === "COMPLETED").length;
      const pendingOrders = orders.filter((o: SalesOrder) => o.jobStatus === "PENDING").length;
      
      const totalEarned = orders
        .filter((o: SalesOrder) => o.jobStatus === "COMPLETED")
        .reduce((sum: number, o: SalesOrder) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
      
      const totalPaid = orders
        .filter((o: SalesOrder) => o.paymentStatus === "PAID")
        .reduce((sum: number, o: SalesOrder) => sum + parseFloat(o.commissionPaid), 0);

      const repPerformance = users
        .filter((u: User) => ["REP", "LEAD", "MANAGER", "EXECUTIVE"].includes(u.role))
        .map((rep: User) => {
          const repOrders = orders.filter((o: SalesOrder) => o.repId === rep.repId);
          const repEarned = repOrders
            .filter((o: SalesOrder) => o.jobStatus === "COMPLETED")
            .reduce((sum: number, o: SalesOrder) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
          return {
            repId: rep.repId,
            name: rep.name,
            role: rep.role,
            orderCount: repOrders.length,
            approvedCount: repOrders.filter((o: SalesOrder) => o.jobStatus === "COMPLETED").length,
            totalEarned: repEarned,
          };
        })
        .filter((r: { orderCount: number }) => r.orderCount > 0)
        .sort((a: { totalEarned: number }, b: { totalEarned: number }) => b.totalEarned - a.totalEarned);

      const providerBreakdown = providers.map((provider: Provider) => {
        const providerOrders = orders.filter((o: SalesOrder) => o.providerId === provider.id);
        const earned = providerOrders
          .filter((o: SalesOrder) => o.jobStatus === "COMPLETED")
          .reduce((sum: number, o: SalesOrder) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
        return {
          id: provider.id,
          name: provider.name,
          orderCount: providerOrders.length,
          totalEarned: earned,
        };
      }).filter((p: { orderCount: number }) => p.orderCount > 0).sort((a: { totalEarned: number }, b: { totalEarned: number }) => b.totalEarned - a.totalEarned);

      const clientBreakdown = clients.map((client: Client) => {
        const clientOrders = orders.filter((o: SalesOrder) => o.clientId === client.id);
        const earned = clientOrders
          .filter((o: SalesOrder) => o.jobStatus === "COMPLETED")
          .reduce((sum: number, o: SalesOrder) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
        return {
          id: client.id,
          name: client.name,
          orderCount: clientOrders.length,
          totalEarned: earned,
        };
      }).filter((c: { orderCount: number }) => c.orderCount > 0).sort((a: { totalEarned: number }, b: { totalEarned: number }) => b.totalEarned - a.totalEarned);

      const monthlyTrend = orders.reduce((acc: Record<string, { month: string; orders: number; earned: number }>, order: SalesOrder) => {
        const month = order.dateSold.substring(0, 7);
        if (!acc[month]) {
          acc[month] = { month, orders: 0, earned: 0 };
        }
        acc[month].orders++;
        if (order.jobStatus === "COMPLETED") {
          acc[month].earned += parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned);
        }
        return acc;
      }, {} as Record<string, { month: string; orders: number; earned: number }>);

      res.json({
        summary: {
          totalOrders,
          approvedOrders,
          pendingOrders,
          completedOrders,
          totalEarned,
          totalPaid,
          outstandingBalance: totalEarned - totalPaid,
        },
        repPerformance,
        providerBreakdown,
        clientBreakdown,
        monthlyTrend: Object.values(monthlyTrend).sort((a, b) => a.month.localeCompare(b.month)),
      });
    } catch (error: any) {
      console.error("Reports error:", error);
      res.status(500).json({ message: error.message || "Failed to generate reports" });
    }
  });

  // Export Batches
  app.get("/api/admin/accounting/export-batches", auth, executiveOrAdmin, async (req, res) => {
    try {
      const batches = await storage.getExportBatches();
      res.json(batches);
    } catch (error) { res.status(500).json({ message: "Failed to get export batches" }); }
  });

  app.get("/api/admin/accounting/export-batches/:id", auth, executiveOrAdmin, async (req, res) => {
    try {
      const batch = await storage.getExportBatchById(req.params.id);
      if (!batch) return res.status(404).json({ message: "Batch not found" });
      const orders = await storage.getOrdersByExportBatch(req.params.id);
      res.json({ batch, orders });
    } catch (error) { res.status(500).json({ message: "Failed to get export batch" }); }
  });

  app.delete("/api/admin/accounting/export-batches/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      await storage.deleteExportBatch(req.params.id);
      await storage.createAuditLog({ action: "delete_export_batch", tableName: "export_batches", recordId: req.params.id, userId: req.user!.id });
      res.json({ message: "Export batch deleted" });
    } catch (error) { res.status(500).json({ message: "Failed to delete export batch" }); }
  });

  app.get("/api/admin/accounting/exported-orders", auth, adminOnly, async (req, res) => {
    try {
      const orders = await storage.getExportedOrders();
      res.json(orders);
    } catch (error) { res.status(500).json({ message: "Failed to get exported orders" }); }
  });

  // Exception Queues
  app.get("/api/admin/queues/unmatched-payments", auth, executiveOrAdmin, async (req, res) => {
    try { res.json(await storage.getUnmatchedPayments()); } catch (error) { res.status(500).json({ message: "Failed" }); }
  });
  app.get("/api/admin/queues/unmatched-chargebacks", auth, executiveOrAdmin, async (req, res) => {
    try { res.json(await storage.getUnmatchedChargebacks()); } catch (error) { res.status(500).json({ message: "Failed" }); }
  });
  app.get("/api/admin/queues/rate-issues", auth, executiveOrAdmin, async (req, res) => {
    try { res.json(await storage.getRateIssues()); } catch (error) { res.status(500).json({ message: "Failed" }); }
  });
  app.post("/api/admin/queues/:type/:id/resolve", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { type, id } = req.params;
      const { resolutionNote } = req.body;
      let result;
      if (type === "unmatched-payments") {
        result = await storage.resolveUnmatchedPayment(id, req.user!.id, resolutionNote);
      } else if (type === "unmatched-chargebacks") {
        result = await storage.resolveUnmatchedChargeback(id, req.user!.id, resolutionNote);
      } else if (type === "rate-issues") {
        result = await storage.resolveRateIssue(id, req.user!.id, resolutionNote);
      } else if (type === "order-exceptions") {
        result = await storage.resolveOrderException(id, req.user!.id, resolutionNote);
      }
      await storage.createAuditLog({ action: `resolve_${type}`, tableName: type.replace(/-/g, "_"), recordId: id, afterJson: JSON.stringify(result), userId: req.user!.id });
      res.json(result);
    } catch (error) { res.status(500).json({ message: "Failed to resolve" }); }
  });

  // Order Exceptions (flagged orders)
  app.get("/api/admin/queues/order-exceptions", auth, executiveOrAdmin, async (req, res) => {
    try {
      const exceptions = await storage.getOrderExceptions();
      const enriched = await Promise.all(exceptions.map(async (exc: any) => {
        const order = await storage.getOrderById(exc.salesOrderId);
        const flagger = await storage.getUser(exc.flaggedByUserId);
        return {
          ...exc,
          invoiceNumber: order?.invoiceNumber || null,
          customerName: order?.customerName || null,
          repId: order?.repId || null,
          flaggedByName: flagger?.name || null,
        };
      }));
      res.json(enriched);
    } catch (error) { res.status(500).json({ message: "Failed" }); }
  });

  app.post("/api/orders/:id/flag", auth, async (req: AuthRequest, res) => {
    try {
      const { reason } = req.body;
      const user = req.user!;
      if (!reason || typeof reason !== "string") {
        return res.status(400).json({ message: "Reason is required" });
      }
      const order = await storage.getOrderById(req.params.id);
      if (!order) return res.status(404).json({ message: "Order not found" });
      
      // REP and MDU can only flag their own orders
      if (["REP", "MDU"].includes(user.role) && order.repId !== user.repId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const exception = await storage.createOrderException({
        salesOrderId: req.params.id,
        reason,
        flaggedByUserId: req.user!.id,
      });
      await storage.createAuditLog({ action: "flag_order", tableName: "order_exceptions", recordId: exception.id, afterJson: JSON.stringify(exception), userId: req.user!.id });
      res.json(exception);
    } catch (error) { res.status(500).json({ message: "Failed to flag order" }); }
  });

  // Audit Log
  app.get("/api/admin/audit", auth, executiveOrAdmin, async (req, res) => {
    try { res.json(await storage.getAuditLogs()); } catch (error) { res.status(500).json({ message: "Failed" }); }
  });

  // Leads - accessible by all authenticated users for their own leads
  app.get("/api/leads", auth, async (req: AuthRequest, res) => {
    try {
      const { zipCode, street, city, dateFrom, dateTo, houseNumber, streetName, viewRepId, customerName, disposition, page: pageStr, limit: limitStr } = req.query as {
        zipCode?: string;
        street?: string;
        city?: string;
        dateFrom?: string;
        dateTo?: string;
        houseNumber?: string;
        streetName?: string;
        viewRepId?: string;
        customerName?: string;
        disposition?: string;
        page?: string;
        limit?: string;
      };
      const page = Math.max(1, parseInt(pageStr || "1", 10) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(limitStr || "50", 10) || 50));
      
      // Determine which rep's leads to fetch
      let targetRepId = req.user!.repId;
      const canViewOthers = ["LEAD", "MANAGER", "EXECUTIVE", "ADMIN", "OPERATIONS"].includes(req.user!.role);
      
      // Handle "All Team" option - fetch leads from all visible reps
      let leads: Awaited<ReturnType<typeof storage.getLeadsByRepId>> = [];
      
      if (viewRepId === "__all_team__" && canViewOthers) {
        // Fetch leads from all team members
        const users = await storage.getUsers();
        const callerLevel = ROLE_HIERARCHY[req.user!.role] || 0;
        const callerId = req.user!.id;
        
        // Collect repIds that this user can view
        const visibleRepIds: string[] = [];
        for (const u of users) {
          if (u.deletedAt || u.status !== "ACTIVE" || !u.repId) continue;
          
          if (req.user!.role === "LEAD") {
            // LEAD sees self and direct reports
            if (u.id === callerId || u.managerId === callerId) {
              visibleRepIds.push(u.repId);
            }
          } else {
            // MANAGER+ sees users at or below their level
            const userLevel = ROLE_HIERARCHY[u.role] || 0;
            if (userLevel <= callerLevel) {
              visibleRepIds.push(u.repId);
            }
          }
        }
        
        // Fetch leads for all visible reps
        const allLeads = await storage.getAllLeadsForReporting({ zipCode, city, dateFrom, dateTo, houseNumber, streetName, customerName, disposition });
        leads = allLeads.filter(l => visibleRepIds.includes(l.repId));
      } else if (viewRepId && canViewOthers) {
        // Verify caller can view this rep's leads
        const users = await storage.getUsers();
        const targetUser = users.find(u => u.repId === viewRepId && !u.deletedAt);
        if (targetUser) {
          const callerLevel = ROLE_HIERARCHY[req.user!.role] || 0;
          const targetLevel = ROLE_HIERARCHY[targetUser.role] || 0;
          
          // For LEAD role: can only view direct reports or self
          if (req.user!.role === "LEAD") {
            const isDirectReport = targetUser.managerId === req.user!.id;
            const isSelf = targetUser.id === req.user!.id;
            if (isSelf || isDirectReport) {
              targetRepId = viewRepId;
            }
          } else if (targetLevel <= callerLevel) {
            // For MANAGER+: use role hierarchy
            targetRepId = viewRepId;
          }
        }
        leads = await storage.getLeadsByRepId(targetRepId, { zipCode, street, city, dateFrom, dateTo, houseNumber, streetName, customerName, disposition });
      } else {
        leads = await storage.getLeadsByRepId(targetRepId, { zipCode, street, city, dateFrom, dateTo, houseNumber, streetName, customerName, disposition });
      }
      
      // When LEAD+ is viewing another rep's leads, include SOLD/REJECTED leads
      // Otherwise filter them out (for own leads view)
      if (!viewRepId || !canViewOthers) {
        leads = leads.filter(l => !["SOLD", "REJECT"].includes(l.disposition || ""));
      }
      
      const total = leads.length;
      const totalPages = Math.ceil(total / limit);
      const offset = (page - 1) * limit;
      const paginatedLeads = leads.slice(offset, offset + limit);
      
      res.json({ leads: paginatedLeads, total, page, totalPages, limit });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch leads" });
    }
  });
  
  // Get lead counts per rep for LEAD+ roles
  app.get("/api/leads/counts", auth, async (req: AuthRequest, res) => {
    try {
      const canViewOthers = ["LEAD", "MANAGER", "EXECUTIVE", "ADMIN", "OPERATIONS"].includes(req.user!.role);
      if (!canViewOthers) {
        return res.status(403).json({ message: "Only supervisors and above can view lead counts" });
      }
      
      const users = await storage.getUsers();
      const callerLevel = ROLE_HIERARCHY[req.user!.role] || 0;
      const callerId = req.user!.id;
      
      // Get all leads
      const allLeads = await storage.getAllLeadsForReporting({});
      
      // Helper to check if a user is in the caller's org tree
      const isInOrgTree = (userId: string, visited = new Set<string>()): boolean => {
        if (visited.has(userId)) return false;
        visited.add(userId);
        const u = users.find(x => x.id === userId);
        if (!u) return false;
        if (u.id === callerId) return true;
        if (u.managerId) return isInOrgTree(u.managerId, visited);
        return false;
      };
      
      // Count leads per rep for users visible to caller
      const counts: { repId: string; name: string; role: string; count: number }[] = [];
      
      for (const user of users) {
        if (user.deletedAt || user.status !== "ACTIVE" || !user.repId) continue;
        
        // For LEAD role: show self and direct reports only
        if (req.user!.role === "LEAD") {
          const isDirectReport = user.managerId === callerId;
          const isSelf = user.id === callerId;
          if (!isSelf && !isDirectReport) continue;
        } else {
          // For MANAGER+: use role hierarchy and org tree
          const userLevel = ROLE_HIERARCHY[user.role] || 0;
          if (userLevel > callerLevel) continue;
        }
        
        const userLeads = allLeads.filter(l => l.repId === user.repId && !["SOLD", "REJECT"].includes(l.disposition || ""));
        counts.push({
          repId: user.repId,
          name: user.name,
          role: user.role,
          count: userLeads.length,
        });
      }
      
      // Sort by count descending
      counts.sort((a, b) => b.count - a.count);
      
      res.json(counts);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch lead counts" });
    }
  });

  // Get Sales Pipeline data - disposition funnel for MANAGER+ and OPERATIONS
  app.get("/api/leads/pipeline", auth, async (req: AuthRequest, res) => {
    try {
      const allowedRoles = ["MANAGER", "EXECUTIVE", "ADMIN", "OPERATIONS"];
      if (!allowedRoles.includes(req.user!.role)) {
        return res.status(403).json({ message: "Only managers and above can view sales pipeline" });
      }
      
      const users = await storage.getUsers();
      const callerLevel = ROLE_HIERARCHY[req.user!.role] || 0;
      
      // Get all leads
      const allLeads = await storage.getAllLeadsForReporting({});
      
      // Filter to leads from users at or below caller's level
      const accessibleLeads = allLeads.filter(lead => {
        const leadOwner = users.find(u => u.repId === lead.repId);
        if (!leadOwner) return false;
        const ownerLevel = ROLE_HIERARCHY[leadOwner.role] || 0;
        return ownerLevel <= callerLevel;
      });
      
      // Aggregate by disposition
      const dispositionCounts: Record<string, number> = {};
      for (const lead of accessibleLeads) {
        const dispo = lead.disposition || "NONE";
        dispositionCounts[dispo] = (dispositionCounts[dispo] || 0) + 1;
      }
      
      // Aggregate by rep with disposition breakdown
      const repData: Record<string, { repId: string; name: string; role: string; dispositions: Record<string, number>; total: number }> = {};
      for (const lead of accessibleLeads) {
        const rep = users.find(u => u.repId === lead.repId);
        if (!rep) continue;
        
        if (!repData[lead.repId]) {
          repData[lead.repId] = {
            repId: lead.repId,
            name: rep.name,
            role: rep.role,
            dispositions: {},
            total: 0,
          };
        }
        
        const dispo = lead.disposition || "NONE";
        repData[lead.repId].dispositions[dispo] = (repData[lead.repId].dispositions[dispo] || 0) + 1;
        repData[lead.repId].total++;
      }
      
      // Calculate conversion metrics
      const totalLeads = accessibleLeads.length;
      const soldCount = dispositionCounts["SOLD"] || 0;
      const negotiationCount = dispositionCounts["NEGOTIATION"] || 0;
      const returnCount = dispositionCounts["RETURN"] || 0;
      const rejectCount = dispositionCounts["DOOR_SLAM_REJECT"] || 0;
      
      res.json({
        totalLeads,
        dispositionCounts,
        repBreakdown: Object.values(repData).sort((a, b) => b.total - a.total),
        metrics: {
          conversionRate: totalLeads > 0 ? ((soldCount / totalLeads) * 100).toFixed(1) : "0.0",
          negotiationRate: totalLeads > 0 ? ((negotiationCount / totalLeads) * 100).toFixed(1) : "0.0",
          returnRate: totalLeads > 0 ? ((returnCount / totalLeads) * 100).toFixed(1) : "0.0",
          rejectRate: totalLeads > 0 ? ((rejectCount / totalLeads) * 100).toFixed(1) : "0.0",
        },
      });
    } catch (error) {
      console.error("Sales pipeline error:", error);
      res.status(500).json({ message: "Failed to fetch sales pipeline data" });
    }
  });

  // Create a single lead (EXECUTIVE, OPERATIONS, ADMIN only)
  app.post("/api/leads", auth, async (req: AuthRequest, res) => {
    try {
      const { 
        repId: requestedRepId, customerName, houseNumber, aptUnit, streetName, street, 
        city, state, zipCode, customerPhone, customerEmail, accountNumber, 
        customerStatus, discoReason, notes 
      } = req.body;
      
      const canAssignToOthers = ["LEAD", "MANAGER", "EXECUTIVE", "ADMIN", "OPERATIONS"].includes(req.user!.role);
      const repId = canAssignToOthers && requestedRepId ? requestedRepId : req.user!.repId;
      
      const users = await storage.getUsers();
      const targetUser = users.find(u => u.repId === repId && !u.deletedAt && u.status === "ACTIVE");
      if (!targetUser) {
        return res.status(400).json({ message: `Rep '${repId}' not found` });
      }
      
      const lead = await storage.createLead({
        repId,
        customerName: customerName || null,
        houseNumber: houseNumber || null,
        aptUnit: aptUnit || null,
        streetName: streetName || null,
        street: street || null,
        city: city || null,
        state: state || null,
        zipCode: zipCode || null,
        customerPhone: customerPhone || null,
        customerEmail: customerEmail || null,
        accountNumber: accountNumber || null,
        customerStatus: customerStatus || null,
        discoReason: discoReason || null,
        notes: notes || null,
        customerAddress: null,
        importedBy: req.user!.id,
        disposition: "NONE",
      });
      
      res.status(201).json(lead);
    } catch (error) {
      console.error("Create lead error:", error);
      res.status(500).json({ message: "Failed to create lead" });
    }
  });

  app.patch("/api/leads/:id/notes", auth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { notes } = req.body;
      
      // Verify the lead belongs to this user
      const lead = await storage.getLeadById(id);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      if (lead.repId !== req.user!.repId) {
        return res.status(403).json({ message: "Not authorized to update this lead" });
      }
      
      const updated = await storage.updateLeadNotes(id, notes || "");
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update lead notes" });
    }
  });

  app.patch("/api/leads/:id/disposition", auth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { disposition, lostReason, lostNotes } = req.body;
      
      if (!disposition || !leadDispositions.includes(disposition)) {
        return res.status(400).json({ message: "Invalid disposition" });
      }
      
      // Verify the lead belongs to this user or user is admin
      const lead = await storage.getLeadById(id);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      const isAdmin = ["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER", "LEAD"].includes(req.user!.role);
      if (!isAdmin && lead.repId !== req.user!.repId) {
        return res.status(403).json({ message: "Not authorized to update this lead" });
      }
      
      // Get the mapped pipeline stage from disposition
      const mappedStage = dispositionToPipelineStage[disposition as LeadDisposition];
      
      // Update disposition (with history tracking)
      const updated = await storage.updateLeadDisposition(id, disposition, req.user!.id);
      
      // Auto-update pipeline stage if disposition maps to one
      if (mappedStage) {
        await storage.updateLeadPipelineStage(id, mappedStage, 
          mappedStage === "LOST" ? lostReason : null,
          mappedStage === "LOST" ? lostNotes : null
        );
      }
      
      // Audit log
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "lead_disposition_update",
        tableName: "leads",
        recordId: id,
        beforeJson: JSON.stringify({ disposition: lead.disposition, pipelineStage: lead.pipelineStage }),
        afterJson: JSON.stringify({ disposition, pipelineStage: mappedStage || lead.pipelineStage }),
      });
      
      // Fetch updated lead with new pipeline stage
      const finalLead = await storage.getLeadById(id);
      res.json(finalLead);
    } catch (error) {
      res.status(500).json({ message: "Failed to update lead disposition" });
    }
  });

  // Reverse disposition (LEAD+ only) - clears SOLD/REJECT status
  app.patch("/api/leads/:id/reverse-disposition", auth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      
      // Only LEAD+ can reverse dispositions
      const canReverse = ["LEAD", "MANAGER", "EXECUTIVE", "ADMIN", "OPERATIONS"].includes(req.user!.role);
      if (!canReverse) {
        return res.status(403).json({ message: "Only supervisors and above can reverse dispositions" });
      }
      
      const lead = await storage.getLeadById(id);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      // Only allow reversing terminal dispositions (SOLD or loss-related)
      if (!terminalDispositions.includes(lead.disposition as LeadDisposition)) {
        return res.status(400).json({ message: "Can only reverse terminal dispositions (SOLD, REJECTED, NOT_INTERESTED, etc.)" });
      }
      
      // Verify caller can manage this lead's rep (target must be at or below caller's level)
      const users = await storage.getUsers();
      const leadOwner = users.find(u => u.repId === lead.repId && !u.deletedAt);
      if (leadOwner) {
        const callerLevel = ROLE_HIERARCHY[req.user!.role] || 0;
        const ownerLevel = ROLE_HIERARCHY[leadOwner.role] || 0;
        if (ownerLevel > callerLevel) {
          return res.status(403).json({ message: "Cannot reverse dispositions for users above your role level" });
        }
      }
      
      const previousDisposition = lead.disposition;
      const updated = await storage.updateLeadDisposition(id, "NONE");
      
      // Audit log
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "lead_disposition_reversed",
        tableName: "leads",
        recordId: id,
        beforeJson: JSON.stringify({ disposition: previousDisposition, repId: lead.repId }),
        afterJson: JSON.stringify({ disposition: "NONE" }),
      });
      
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to reverse lead disposition" });
    }
  });

  // Assign/reassign a lead to another user (LEAD+ only)
  app.patch("/api/leads/:id/assign", auth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { targetRepId } = req.body;
      
      if (!targetRepId) {
        return res.status(400).json({ message: "targetRepId is required" });
      }
      
      // Only LEAD+ can assign leads to others
      const canAssign = ["LEAD", "MANAGER", "EXECUTIVE", "ADMIN", "OPERATIONS"].includes(req.user!.role);
      if (!canAssign) {
        return res.status(403).json({ message: "Only supervisors and above can assign leads to other users" });
      }
      
      // Verify lead exists
      const lead = await storage.getLeadById(id);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      // Verify target user exists and is a valid lead assignee
      const users = await storage.getUsers();
      const targetUser = users.find(u => u.repId === targetRepId && !u.deletedAt && u.status === "ACTIVE");
      if (!targetUser) {
        return res.status(400).json({ message: `User with rep ID '${targetRepId}' not found` });
      }
      // Users can only assign leads to users at or below their role level
      const callerLevel = ROLE_HIERARCHY[req.user!.role] || 0;
      const targetLevel = ROLE_HIERARCHY[targetUser.role] || 0;
      if (targetLevel > callerLevel) {
        return res.status(400).json({ message: "You can only assign leads to users at or below your role level" });
      }
      
      const oldRepId = lead.repId;
      
      // Update the lead's repId
      const updated = await storage.updateLead(id, { repId: targetRepId });
      
      // Audit log
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "lead_assign",
        tableName: "leads",
        recordId: id,
        beforeJson: JSON.stringify({ repId: oldRepId }),
        afterJson: JSON.stringify({ repId: targetRepId, assignedBy: req.user!.repId }),
      });
      
      res.json(updated);
    } catch (error) {
      console.error("Lead assign error:", error);
      res.status(500).json({ message: "Failed to assign lead" });
    }
  });

  // Get lead pool - all leads with filtering and pagination (LEAD+ for all, REP for own)
  app.get("/api/leads/pool", auth, async (req: AuthRequest, res) => {
    try {
      const { repId, disposition, search, hasNotes, page, limit } = req.query;
      const isAdmin = ["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER", "LEAD"].includes(req.user!.role);
      
      const filters: { repId?: string; disposition?: string; search?: string; hasNotes?: boolean; page?: number; limit?: number } = {
        disposition: typeof disposition === "string" ? disposition : undefined,
        search: typeof search === "string" ? search : undefined,
        hasNotes: hasNotes === "true",
        page: typeof page === "string" ? parseInt(page, 10) : 1,
        limit: typeof limit === "string" ? Math.min(parseInt(limit, 10), 100) : 50, // Max 100 per page
      };
      
      // REPs can only see their own leads, LEAD+ can see all or filter by rep
      if (!isAdmin) {
        filters.repId = req.user!.repId;
      } else if (typeof repId === "string" && repId !== "ALL") {
        filters.repId = repId;
      }
      
      const result = await storage.getLeadPool(filters);
      res.json(result);
    } catch (error) {
      console.error("Lead pool error:", error);
      res.status(500).json({ message: "Failed to fetch lead pool" });
    }
  });

  // Export lead pool with history (OPERATIONS and EXECUTIVE only)
  app.get("/api/leads/pool/export", auth, async (req: AuthRequest, res) => {
    try {
      if (!["OPERATIONS", "EXECUTIVE"].includes(req.user!.role)) {
        return res.status(403).json({ message: "Export requires OPERATIONS or EXECUTIVE role" });
      }

      const { repId, disposition, search } = req.query;
      const filters: { repId?: string; disposition?: string; search?: string; limit?: number } = {
        disposition: typeof disposition === "string" ? disposition : undefined,
        search: typeof search === "string" ? search : undefined,
        limit: 10000, // Export up to 10k leads at once
      };
      if (typeof repId === "string" && repId !== "ALL") {
        filters.repId = repId;
      }

      const result = await storage.getLeadPool(filters);
      const leadPool = result.data;
      const users = await storage.getUsers();
      const getUserName = (userId: string) => users.find(u => u.id === userId)?.name || userId;
      const getRepName = (repId: string | null) => {
        if (!repId) return "";
        const user = users.find(u => u.repId === repId);
        return user ? `${user.name} (${repId})` : repId;
      };
      
      // Prepare leads sheet data
      // Build full address from available fields (some imports use customerAddress, others use houseNumber/streetName)
      const buildAddress = (lead: any) => {
        // If customerAddress exists, use it
        if (lead.customerAddress) return lead.customerAddress;
        // Otherwise build from individual fields
        const parts = [lead.houseNumber, lead.street, lead.streetName, lead.aptUnit, lead.city, lead.state].filter(Boolean);
        return parts.join(" ");
      };
      
      const leadsData = leadPool.map(lead => ({
        "Lead ID": lead.id,
        "Customer Name": lead.customerName || "",
        "Phone": lead.customerPhone || "",
        "Email": lead.customerEmail || "",
        "Address": buildAddress(lead),
        "Zip Code": lead.zipCode || "",
        "Disposition": lead.disposition,
        "Rep ID": lead.repId || "",
        "Rep Name": getRepName(lead.repId),
        "Notes": lead.notes || "",
        "Created At": lead.createdAt ? new Date(lead.createdAt).toISOString() : "",
        "Updated At": lead.updatedAt ? new Date(lead.updatedAt).toISOString() : "",
      }));

      // Get all history for these leads
      const allHistory: any[] = [];
      for (const lead of leadPool) {
        const history = await storage.getLeadDispositionHistory(lead.id);
        for (const h of history) {
          allHistory.push({
            "Lead ID": lead.id,
            "Customer Name": lead.customerName || "",
            "Previous Disposition": h.previousDisposition || "NONE",
            "New Disposition": h.disposition,
            "Changed By": getUserName(h.changedByUserId || ""),
            "Notes": h.notes || "",
            "Changed At": h.createdAt ? new Date(h.createdAt).toISOString() : "",
          });
        }
      }

      const wb = XLSX.utils.book_new();
      const leadsWs = XLSX.utils.json_to_sheet(leadsData);
      XLSX.utils.book_append_sheet(wb, leadsWs, "Leads");
      
      if (allHistory.length > 0) {
        const historyWs = XLSX.utils.json_to_sheet(allHistory);
        XLSX.utils.book_append_sheet(wb, historyWs, "Disposition History");
      }

      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      
      // Audit log the export
      await storage.createAuditLog({
        action: "lead_pool_export",
        tableName: "leads",
        recordId: "bulk",
        userId: req.user!.id,
        afterJson: JSON.stringify({
          filters,
          leadsExported: leadPool.length,
          historyRecords: allHistory.length,
        }),
      });

      res.setHeader("Content-Disposition", `attachment; filename="lead-pool-export.xlsx"`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buffer);
    } catch (error) {
      console.error("Lead pool export error:", error);
      res.status(500).json({ message: "Failed to export lead pool" });
    }
  });

  // Get lead disposition history
  app.get("/api/leads/:id/history", auth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      
      // Verify lead exists
      const lead = await storage.getLeadById(id);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      // REP can only see history for own leads, LEAD+ can see all
      const isAdmin = ["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER", "LEAD"].includes(req.user!.role);
      if (!isAdmin && lead.repId !== req.user!.repId) {
        return res.status(403).json({ message: "Not authorized to view this lead's history" });
      }
      
      const history = await storage.getLeadDispositionHistory(id);
      
      // Enrich history with user names
      const users = await storage.getUsers();
      const enrichedHistory = history.map(h => ({
        ...h,
        changedByName: users.find(u => u.id === h.changedByUserId)?.name || "System",
      }));
      
      res.json(enrichedHistory);
    } catch (error) {
      console.error("Lead history error:", error);
      res.status(500).json({ message: "Failed to fetch lead history" });
    }
  });

  // Import leads from Excel (REP and above can import) - with file validation
  // LEAD+ can use ?targetRepId=X to import leads for another user
  app.post("/api/leads/import", auth, (req: AuthRequest, res, next) => {
    upload.single("file")(req, res, (err: any) => {
      if (err) {
        console.error("Multer upload error:", err);
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ message: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` });
        }
        return res.status(400).json({ message: err.message || "File upload failed" });
      }
      next();
    });
  }, async (req: AuthRequest, res) => {
    try {
      console.log(`[Leads Import] User ${req.user?.repId} uploading file: ${req.file?.originalname} (${req.file?.size} bytes)`);
      // Validate file upload
      const validation = validateFileUpload(req.file, res);
      if (!validation.valid) return;
      
      const workbook = validation.workbook;
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { blankrows: false }) as Record<string, any>[];

      if (rows.length === 0) {
        return res.status(400).json({ message: "Excel file is empty" });
      }
      
      // Validate row count
      if (!validateRowCount(rows, res)) return;

      // Determine total column count from header row for complete-row validation
      // xlsx sheet_to_json only includes keys for cells with data, so we need
      // to know the total columns to detect rows with blank cells
      const allHeaderKeys = new Set<string>();
      for (const row of rows) {
        for (const key of Object.keys(row)) {
          allHeaderKeys.add(key);
        }
      }
      const totalColumnCount = allHeaderKeys.size;

      const errors: string[] = [];
      let success = 0;
      let failed = 0;
      let skipped = 0;

      // Get users for validation
      const users = await storage.getUsers();
      const currentUser = req.user!;
      const isRep = currentUser.role === "REP";
      const canAssignToOthers = ["LEAD", "MANAGER", "EXECUTIVE", "ADMIN", "OPERATIONS"].includes(currentUser.role);
      
      // Check for targetRepId query parameter (LEAD+ only)
      const targetRepId = req.query.targetRepId as string | undefined;
      if (targetRepId && !canAssignToOthers) {
        return res.status(403).json({ message: "Only supervisors and above can import leads for other users" });
      }
      
      // Validate targetRepId if provided - allow assigning to users at or below caller's role level
      if (targetRepId) {
        const targetUser = users.find(u => u.repId === targetRepId && !u.deletedAt && u.status === "ACTIVE");
        if (!targetUser) {
          return res.status(400).json({ message: `Target rep '${targetRepId}' not found` });
        }
        // Users can only assign leads to users at or below their role level
        const callerLevel = ROLE_HIERARCHY[currentUser.role] || 0;
        const targetLevel = ROLE_HIERARCHY[targetUser.role] || 0;
        if (targetLevel > callerLevel) {
          return res.status(400).json({ message: "You can only assign leads to users at or below your role level" });
        }
      }

      // Helper to get value from row with case-insensitive column matching
      // Handles trailing/leading spaces, non-breaking spaces (NBSP), and normalizes whitespace
      const normalizeColumnName = (name: string): string => {
        return name
          .replace(/\u00A0/g, ' ')  // Replace non-breaking spaces
          .replace(/\s+/g, ' ')      // Normalize multiple spaces to single
          .trim()
          .toLowerCase();
      };
      
      const getRowValue = (row: Record<string, any>, ...keys: string[]): string => {
        for (const key of keys) {
          // Try exact match first
          if (row[key] !== undefined && row[key] !== null) {
            return row[key].toString().trim();
          }
          // Try normalized match
          const normalizedKey = normalizeColumnName(key);
          for (const rowKey of Object.keys(row)) {
            const normalizedRowKey = normalizeColumnName(rowKey);
            if (normalizedRowKey === normalizedKey && row[rowKey] !== undefined && row[rowKey] !== null) {
              return row[rowKey].toString().trim();
            }
          }
        }
        return "";
      };

      // Debug: Log column names found in first row (helpful for troubleshooting)
      if (rows.length > 0) {
        const colNames = Object.keys(rows[0]);
        console.log("Excel import - columns found:", colNames);
        console.log("Excel import - normalized columns:", colNames.map(normalizeColumnName));
      }

      console.log(`[Leads Import] Total rows parsed from Excel: ${rows.length}, total columns detected: ${totalColumnCount}`);

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;

        // Skip rows that are completely empty (no filled cells at all)
        const filledCount = Object.values(row).filter(v => {
          const s = v?.toString().trim();
          return s && s.length > 0;
        }).length;
        if (filledCount === 0) {
          skipped++;
          continue;
        }

        try {
          // Determine repId for this lead:
          // 1. If targetRepId is provided (LEAD+ importing for specific user), use it
          // 2. If REP, always use their own repId
          // 3. Otherwise, use from file or default to current user's repId
          let repId: string;
          
          if (targetRepId) {
            // LEAD+ importing for a specific user - all leads go to that user
            repId = targetRepId;
          } else if (isRep) {
            // REPs can only import leads for themselves
            repId = currentUser.repId;
          } else {
            // Non-REPs: check file for repId or default to their own
            repId = getRowValue(row, "repId", "rep_id", "RepId", "Rep ID") || currentUser.repId;
          }

          // Address fields - houseNumber, aptUnit, and streetName, or combined address/street
          let houseNumber = getRowValue(row, 
            "houseNumber", "house_number", "House Number", "HouseNumber", "House #",
            "Bld No.", "Bld No", "BldNo", "Bld#", "Bld #",
            "Bldg No.", "Bldg No", "BldgNo", "Bldg#", "Bldg #",
            "Building No.", "Building No", "Building Number", "Building #",
            "Address No", "Address Number", "Street No", "Street Number"
          );
          let aptUnit = getRowValue(row, "apt", "Apt", "Apt.", "Apt #", "Apartment", "Unit", "Unit #", "Suite", "Ste", "Basement", "Bsmt", "apt_unit", "aptUnit",
            "ADDR2", "Addr2", "addr2", "Address 2", "Address2"
          );
          
          let streetName = getRowValue(row, "streetName", "street_name", "Street Name", "StreetName");
          const customerAddress = getRowValue(row, "customerAddress", "customer_address", "Address", "Full Address");
          const street = getRowValue(row, "street", "Street");
          const addr1 = getRowValue(row, "ADDR1", "Addr1", "addr1", "Address 1", "Address1");
          const customerName = getRowValue(row, "customerName", "customer_name", "Customer Name", "Name", "Customer");
          
          // Skip rows that have no meaningful lead data (no address AND no customer name)
          if (!houseNumber && !streetName && !customerAddress && !street && !addr1 && !customerName) {
            skipped++;
            continue;
          }
          
          // Parse ADDR1-style combined street address (e.g., "101 W 147TH ST")
          if (!houseNumber && !streetName && addr1) {
            const fullAddr = addr1.trim();
            const match = fullAddr.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
            if (match) {
              houseNumber = match[1];
              streetName = match[2];
            } else {
              streetName = fullAddr;
            }
          }
          
          // Parse ADDR2 for apartment - strip "APT" prefix if present
          if (aptUnit) {
            aptUnit = aptUnit.replace(/^(APT\.?|APARTMENT|UNIT|STE\.?|SUITE)\s*/i, "").trim();
          }
          
          // If no separate fields, try to parse from combined address
          if (!houseNumber && !streetName && (customerAddress || street)) {
            const fullAddr = (customerAddress || street).trim();
            let match = fullAddr.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
            if (match) {
              houseNumber = match[1];
              streetName = match[2];
            } else {
              match = fullAddr.match(/^(.+)\s+(\d+[A-Za-z]?)$/);
              if (match) {
                streetName = match[1];
                houseNumber = match[2];
              } else {
                streetName = fullAddr;
              }
            }
          }
          
          if (!houseNumber && !streetName && !customerAddress && !street && !addr1) {
            errors.push(`Row ${rowNum}: Missing address (houseNumber/streetName or address required)`);
            failed++;
            continue;
          }
          const customerPhone = getRowValue(row, "customerPhone", "customer_phone", "Phone", "Phone Number", "Telephone");
          const customerEmail = getRowValue(row, "customerEmail", "customer_email", "Email", "E-mail");
          let city = getRowValue(row, "city", "City");
          let state = getRowValue(row, "state", "State");
          let zipCode = getRowValue(row, "zipCode", "zip_code", "Zip", "Zip Code", "ZIP", "Postal Code");
          const notes = getRowValue(row, "notes", "Notes", "Comments");
          
          // Parse ADDR3 for combined city/state/zip (e.g., "NEW YORK, NY 10039-436")
          if (!city && !state && !zipCode) {
            const addr3 = getRowValue(row, "ADDR3", "Addr3", "addr3", "Address 3", "Address3", "City State Zip", "CityStateZip");
            if (addr3) {
              const cityStateZipMatch = addr3.match(/^(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{1,4})?)$/i);
              if (cityStateZipMatch) {
                city = cityStateZipMatch[1].trim();
                state = cityStateZipMatch[2].trim().toUpperCase();
                zipCode = cityStateZipMatch[3].trim();
              } else {
                const cityStateMatch = addr3.match(/^(.+?),\s*([A-Z]{2})$/i);
                if (cityStateMatch) {
                  city = cityStateMatch[1].trim();
                  state = cityStateMatch[2].trim().toUpperCase();
                } else {
                  city = addr3;
                }
              }
            }
          }
          
          // Additional fields from file
          const accountNumber = getRowValue(row, "accountNumber", "account_number", "Account Number", "Account No", "Account #", "Account", "Acct", "Acct No", "Acct #",
            "ACCOUNT", "ACCOUNT#", "ACCOUNT #", "ACCT", "ACCT#", "ACCT #");
          const customerStatus = getRowValue(row, "customerStatus", "customer_status", "Customer Status", "Status", "Cust Status",
            "STAT", "Stat");
          const discoReason = getRowValue(row, "discoReason", "disco_reason", "Disco Reason", "Disconnect Reason", "Disconnection Reason", "Disco", "DC Reason");

          // Verify rep exists (for non-REPs importing for other reps)
          const rep = users.find(u => u.repId === repId);
          if (!rep) {
            errors.push(`Row ${rowNum}: Rep '${repId}' not found`);
            failed++;
            continue;
          }

          // Create the lead
          await storage.createLead({
            repId,
            customerName: customerName || null,
            customerAddress: customerAddress || null,
            customerPhone: customerPhone || null,
            customerEmail: customerEmail || null,
            houseNumber: houseNumber || null,
            aptUnit: aptUnit || null,
            streetName: streetName || null,
            street: street || null,
            city: city || null,
            state: state || null,
            zipCode: zipCode || null,
            accountNumber: accountNumber || null,
            customerStatus: customerStatus || null,
            discoReason: discoReason || null,
            notes: notes || null,
            importedBy: req.user!.id,
            status: "NEW",
          });

          success++;
        } catch (rowError: any) {
          errors.push(`Row ${rowNum}: ${rowError.message}`);
          failed++;
        }
      }

      console.log(`[Leads Import] Results: ${success} imported, ${failed} failed, ${skipped} empty rows skipped, ${rows.length} total rows parsed`);

      // Audit log
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "leads_import",
        tableName: "leads",
        afterJson: JSON.stringify({ success, failed, skipped, totalRows: rows.length }),
      });

      res.json({ success, failed, skipped, errors: errors.slice(0, 20) });
    } catch (error: any) {
      console.error("Lead import error:", error);
      res.status(500).json({ message: error.message || "Failed to import leads" });
    }
  });

  async function saveLeadExportToStorage(buffer: Buffer, filename: string): Promise<string | null> {
    try {
      const privateDir = process.env.PRIVATE_OBJECT_DIR;
      if (!privateDir) return null;
      const parts = privateDir.replace(/^\//, "").split("/");
      const bucketName = parts[0];
      const prefix = parts.slice(1).join("/");
      const objectName = `${prefix}/lead-exports/${filename}`;
      const { objectStorageClient } = await import("./replit_integrations/object_storage");
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);
      await file.save(buffer, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      console.log(`[Leads] Export saved to object storage: ${objectName}`);
      return objectName;
    } catch (err) {
      console.error("[Leads] Failed to save export to object storage:", err);
      return null;
    }
  }

  async function generateLeadExportBuffer(leadsToExport: any[]): Promise<Buffer> {
    const users = await storage.getUsers();
    const getUserName = (userId: string) => users.find(u => u.id === userId)?.name || userId;
    const getRepName = (rid: string | null) => {
      if (!rid) return "";
      const user = users.find(u => u.repId === rid);
      return user ? `${user.name} (${rid})` : rid;
    };
    const buildAddress = (lead: any) => {
      if (lead.customerAddress) return lead.customerAddress;
      const parts = [lead.houseNumber, lead.street, lead.streetName, lead.aptUnit, lead.city, lead.state].filter(Boolean);
      return parts.join(" ");
    };

    const leadsData = leadsToExport.map(lead => ({
      "Lead ID": lead.id,
      "Customer Name": lead.customerName || "",
      "Phone": lead.customerPhone || "",
      "Email": lead.customerEmail || "",
      "Address": buildAddress(lead),
      "Zip Code": lead.zipCode || "",
      "Last Disposition": lead.disposition || "NONE",
      "Disposition Date": lead.dispositionAt ? new Date(lead.dispositionAt).toISOString() : "",
      "Rep ID": lead.repId || "",
      "Rep Name": getRepName(lead.repId),
      "Notes": lead.notes || "",
      "Pipeline Stage": lead.pipelineStage || "",
      "Lost Reason": lead.lostReason || "",
      "Lost Notes": lead.lostNotes || "",
      "Follow-Up Notes": lead.followUpNotes || "",
      "Contact Attempts": lead.contactAttempts || 0,
      "Imported At": lead.importedAt ? new Date(lead.importedAt).toISOString() : "",
      "Created At": lead.createdAt ? new Date(lead.createdAt).toISOString() : "",
    }));

    const leadIds = leadsToExport.map(l => l.id);
    const allHistory = await storage.getLeadDispositionHistoryBulk(leadIds);

    const historyData = allHistory.map(h => {
      const lead = leadsToExport.find(l => l.id === h.leadId);
      return {
        "Lead ID": h.leadId,
        "Customer Name": lead?.customerName || "",
        "Previous Disposition": h.previousDisposition || "NONE",
        "New Disposition": h.disposition,
        "Changed By": getUserName(h.changedByUserId || ""),
        "Notes": h.notes || "",
        "Changed At": h.createdAt ? new Date(h.createdAt).toISOString() : "",
      };
    });

    const wb = XLSX.utils.book_new();
    const leadsWs = XLSX.utils.json_to_sheet(leadsData);
    XLSX.utils.book_append_sheet(wb, leadsWs, "Deleted Leads");

    if (historyData.length > 0) {
      const historyWs = XLSX.utils.json_to_sheet(historyData);
      XLSX.utils.book_append_sheet(wb, historyWs, "Disposition History");
    }

    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  }

  // Export leads before deletion - generates XLSX with lead data, disposition history, and notes
  app.post("/api/leads/export-for-delete", auth, leadOrAbove, async (req: AuthRequest, res) => {
    try {
      const { ids, mode, importDate, importedBy, repId, dateFrom, dateTo } = req.body;
      let leadsToExport: any[] = [];

      if (mode === "ids" && ids && Array.isArray(ids) && ids.length > 0) {
        leadsToExport = await storage.getLeadsByIds(ids);
      } else if (mode === "sort" && importDate && repId) {
        const allLeads = await storage.getAllLeadsForAdmin();
        const importTime = new Date(importDate).getTime();
        leadsToExport = allLeads.filter(l => {
          if (l.repId !== repId) return false;
          const leadImportTime = new Date(l.importedAt).getTime();
          return Math.abs(leadImportTime - importTime) < 60000;
        });
      } else if (mode === "by-user" && repId) {
        const allLeads = await storage.getAllLeadsForAdmin();
        leadsToExport = allLeads.filter(l => l.repId === repId);
      } else if (mode === "by-date" && dateFrom && dateTo) {
        const allLeads = await storage.getAllLeadsForAdmin();
        const from = new Date(dateFrom).getTime();
        const to = new Date(dateTo + "T23:59:59").getTime();
        leadsToExport = allLeads.filter(l => {
          const t = new Date(l.importedAt).getTime();
          return t >= from && t <= to;
        });
      } else if (mode === "all") {
        leadsToExport = await storage.getAllLeadsForAdmin();
      } else {
        return res.status(400).json({ message: "Invalid export mode or missing parameters" });
      }

      if (leadsToExport.length === 0) {
        return res.status(404).json({ message: "No leads found to export" });
      }

      const buffer = await generateLeadExportBuffer(leadsToExport);

      await storage.createAuditLog({
        action: "lead_export_before_delete",
        tableName: "leads",
        recordId: "bulk",
        userId: req.user!.id,
        afterJson: JSON.stringify({
          mode,
          leadsExported: leadsToExport.length,
        }),
      });

      res.setHeader("Content-Disposition", `attachment; filename="deleted-leads-export-${new Date().toISOString().split("T")[0]}.xlsx"`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buffer);
    } catch (error: any) {
      console.error("Lead export-for-delete error:", error);
      res.status(500).json({ message: error.message || "Failed to export leads" });
    }
  });

  // Admin delete leads by date range (auto-exports before deletion)
  app.delete("/api/admin/leads/by-date", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { dateFrom, dateTo } = req.query;
      if (!dateFrom || !dateTo) {
        return res.status(400).json({ message: "dateFrom and dateTo required" });
      }
      const allLeads = await storage.getAllLeadsForAdmin();
      const from = new Date(dateFrom as string).getTime();
      const to = new Date(dateTo + "T23:59:59").getTime();
      const leadsToDelete = allLeads.filter(l => {
        const t = new Date(l.importedAt).getTime();
        return t >= from && t <= to;
      });

      if (leadsToDelete.length > 0) {
        const exportBuffer = await generateLeadExportBuffer(leadsToDelete);
        const filename = `deleted-leads-by-date-${dateFrom}-to-${dateTo}-${Date.now()}.xlsx`;
        const storagePath = await saveLeadExportToStorage(exportBuffer, filename);
        await storage.createAuditLog({
          action: "lead_export_before_delete",
          tableName: "leads",
          recordId: "bulk",
          userId: req.user!.id,
          afterJson: JSON.stringify({ mode: "by-date", dateFrom, dateTo, leadsExported: leadsToDelete.length, storagePath: storagePath || "local-only" }),
        });
      }

      const count = await storage.deleteLeadsByDateRange(dateFrom as string, dateTo as string);
      await storage.createAuditLog({ 
        action: "bulk_delete_leads", 
        tableName: "leads", 
        afterJson: JSON.stringify({ dateFrom, dateTo, count }),
        userId: req.user!.id 
      });
      res.json({ message: `Deleted ${count} leads`, count });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete leads" });
    }
  });

  // Admin delete all leads (auto-exports before deletion)
  app.delete("/api/admin/leads/all", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const allLeads = await storage.getAllLeadsForAdmin();

      if (allLeads.length > 0) {
        const exportBuffer = await generateLeadExportBuffer(allLeads);
        const filename = `deleted-leads-all-${Date.now()}.xlsx`;
        const storagePath = await saveLeadExportToStorage(exportBuffer, filename);
        await storage.createAuditLog({
          action: "lead_export_before_delete",
          tableName: "leads",
          recordId: "bulk",
          userId: req.user!.id,
          afterJson: JSON.stringify({ mode: "all", leadsExported: allLeads.length, storagePath: storagePath || "local-only" }),
        });
      }

      const count = await storage.deleteAllLeads();
      await storage.createAuditLog({ 
        action: "delete_all_leads", 
        tableName: "leads", 
        afterJson: JSON.stringify({ count }),
        userId: req.user!.id 
      });
      res.json({ message: `Deleted ${count} leads`, count });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete leads" });
    }
  });

  // Admin fix leads with building numbers in wrong position (street suffix)
  app.post("/api/admin/leads/fix-addresses", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      // Get all leads
      const allLeads = await storage.getAllLeadsForAdmin();
      let fixed = 0;
      const fixedLeads: { id: string; before: string; after: string }[] = [];
      
      for (const lead of allLeads) {
        // Skip if already has houseNumber populated
        if (lead.houseNumber) continue;
        
        // Check if streetName or street has a number at the end (e.g. "WOODLAND AVE 12")
        const addrToCheck = lead.streetName || lead.street || lead.customerAddress;
        if (!addrToCheck) continue;
        
        const match = addrToCheck.trim().match(/^(.+)\s+(\d+[A-Za-z]?)$/);
        if (match) {
          const newStreetName = match[1];
          const newHouseNumber = match[2];
          
          // Update the lead
          await storage.updateLead(lead.id, {
            houseNumber: newHouseNumber,
            streetName: newStreetName,
          });
          
          fixedLeads.push({
            id: lead.id,
            before: addrToCheck,
            after: `${newHouseNumber} ${newStreetName}`
          });
          fixed++;
        }
      }
      
      await storage.createAuditLog({ 
        action: "fix_lead_addresses", 
        tableName: "leads", 
        afterJson: JSON.stringify({ count: fixed, samples: fixedLeads.slice(0, 10) }),
        userId: req.user!.id 
      });
      
      res.json({ message: `Fixed ${fixed} leads`, count: fixed, fixed: fixedLeads });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fix leads" });
    }
  });

  // Admin delete single lead
  app.delete("/api/admin/leads/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const lead = await storage.getLeadById(id);
      if (!lead) return res.status(404).json({ message: "Lead not found" });
      
      await storage.deleteLead(id);
      await storage.createAuditLog({ 
        action: "delete_lead", 
        tableName: "leads", 
        recordId: id,
        beforeJson: JSON.stringify(lead),
        userId: req.user!.id 
      });
      res.json({ message: "Lead deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete lead" });
    }
  });

  // Get import sorts/batches for leads management
  app.get("/api/leads/sorts", auth, leadOrAbove, async (req: AuthRequest, res) => {
    try {
      const { viewRepId } = req.query as { viewRepId?: string };
      const callerLevel = ROLE_HIERARCHY[req.user!.role] || 0;
      const users = await storage.getUsers();
      
      let repIdFilter: string | undefined;
      
      if (viewRepId && viewRepId !== "__all_team__") {
        repIdFilter = viewRepId;
      } else if (!["ADMIN", "OPERATIONS"].includes(req.user!.role) && viewRepId !== "__all_team__") {
        repIdFilter = req.user!.repId;
      }
      
      const sorts = await storage.getLeadImportSorts(repIdFilter);
      
      // Filter by visibility based on role
      const visibleSorts = sorts.filter(s => {
        const owner = users.find(u => u.repId === s.repId);
        if (!owner) return true;
        if (req.user!.role === "LEAD") {
          return owner.id === req.user!.id || owner.managerId === req.user!.id;
        }
        const ownerLevel = ROLE_HIERARCHY[owner.role] || 0;
        return ownerLevel <= callerLevel;
      });
      
      // Enrich with user names
      const enriched = visibleSorts.map(s => {
        const importer = users.find(u => u.id === s.importedBy);
        const rep = users.find(u => u.repId === s.repId);
        return {
          ...s,
          importerName: importer ? `${importer.firstName} ${importer.lastName}` : "Unknown",
          repName: rep ? `${rep.firstName} ${rep.lastName}` : s.repId,
        };
      });
      
      res.json(enriched);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch import sorts" });
    }
  });

  // Delete all leads in a specific import sort/batch
  app.post("/api/leads/sort-delete", auth, leadOrAbove, async (req: AuthRequest, res) => {
    try {
      const { importDate, importedBy, repId } = req.body;
      if (!importDate || !repId) {
        return res.status(400).json({ message: "importDate and repId are required" });
      }
      
      // Verify caller has permission for this rep's leads
      const users = await storage.getUsers();
      const callerLevel = ROLE_HIERARCHY[req.user!.role] || 0;
      const targetUser = users.find(u => u.repId === repId);
      
      if (targetUser) {
        const targetLevel = ROLE_HIERARCHY[targetUser.role] || 0;
        if (req.user!.role === "LEAD") {
          const isDirectReport = targetUser.managerId === req.user!.id;
          const isSelf = targetUser.id === req.user!.id;
          if (!isSelf && !isDirectReport) {
            return res.status(403).json({ message: "Not authorized to delete these leads" });
          }
        } else if (targetLevel > callerLevel) {
          return res.status(403).json({ message: "Not authorized to delete these leads" });
        }
      }
      
      const deleted = await storage.softDeleteLeadsBySort(importDate, importedBy || null, repId, req.user!.id);
      res.json({ deleted: deleted.length });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete sort" });
    }
  });

  // Bulk soft delete leads (LEAD+)
  // Enforces hierarchy: caller can only delete leads owned by users at or below their role level
  app.post("/api/leads/bulk-delete", auth, leadOrAbove, async (req: AuthRequest, res) => {
    try {
      const { ids } = req.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids array required" });
      }
      
      const callerLevel = ROLE_HIERARCHY[req.user!.role] || 0;
      const users = await storage.getUsers();
      const usersByRepId: Record<string, typeof users[0]> = {};
      users.forEach(u => { if (u.repId) usersByRepId[u.repId] = u; });
      
      // Validate each lead's ownership is within caller's authority
      const allowedIds: string[] = [];
      const deniedIds: string[] = [];
      
      for (const leadId of ids) {
        const lead = await storage.getLeadById(leadId);
        if (!lead || lead.deletedAt) {
          deniedIds.push(leadId);
          continue;
        }
        
        const leadOwner = usersByRepId[lead.repId];
        const ownerLevel = leadOwner ? (ROLE_HIERARCHY[leadOwner.role] || 0) : 0;
        
        if (ownerLevel > callerLevel) {
          deniedIds.push(leadId);
        } else {
          allowedIds.push(leadId);
        }
      }
      
      if (allowedIds.length === 0) {
        return res.status(403).json({ message: "You don't have permission to delete any of the selected leads" });
      }
      
      const deletedLeads = await storage.softDeleteLeads(allowedIds, req.user!.id);
      
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "bulk_soft_delete_leads",
        tableName: "leads",
        afterJson: JSON.stringify({ count: deletedLeads.length, ids: allowedIds, denied: deniedIds.length }),
      });
      
      const message = deniedIds.length > 0 
        ? `Deleted ${deletedLeads.length} leads (${deniedIds.length} skipped due to permissions)`
        : `Deleted ${deletedLeads.length} leads`;
      
      res.json({ message, count: deletedLeads.length, skipped: deniedIds.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete leads" });
    }
  });

  // Bulk delete all leads for a specific user (ADMIN/OPERATIONS/EXECUTIVE only)
  app.delete("/api/leads/by-user/:repId", auth, executiveOrAdmin, async (req: AuthRequest, res) => {
    try {
      const { repId } = req.params;
      if (!repId) {
        return res.status(400).json({ message: "repId required" });
      }
      
      // Verify the rep exists
      const targetRep = await storage.getUserByRepId(repId);
      if (!targetRep) {
        return res.status(404).json({ message: "User not found" });
      }
      
      const deletedLeads = await storage.softDeleteLeadsByRepId(repId, req.user!.id);
      
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "bulk_delete_leads_by_user",
        tableName: "leads",
        afterJson: JSON.stringify({ repId, count: deletedLeads.length, targetUserName: targetRep.name }),
      });
      
      res.json({ 
        message: `Deleted ${deletedLeads.length} leads for ${targetRep.name}`, 
        count: deletedLeads.length 
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete leads" });
    }
  });

  // Bulk assign leads to a different rep (LEAD+)
  // Enforces hierarchy: caller can only assign leads owned by users at or below their role level
  // and can only assign to users at or below their role level
  app.post("/api/leads/bulk-assign", auth, leadOrAbove, async (req: AuthRequest, res) => {
    try {
      const { ids, newRepId } = req.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids array required" });
      }
      if (!newRepId) {
        return res.status(400).json({ message: "newRepId required" });
      }
      
      const callerLevel = ROLE_HIERARCHY[req.user!.role] || 0;
      
      // Verify target rep exists and is active
      const targetRep = await storage.getUserByRepId(newRepId);
      if (!targetRep || targetRep.status !== "ACTIVE") {
        return res.status(400).json({ message: "Target rep not found or inactive" });
      }
      
      // Verify caller can assign to target (target role at or below caller role)
      const targetLevel = ROLE_HIERARCHY[targetRep.role] || 0;
      if (targetLevel > callerLevel) {
        return res.status(403).json({ message: "You can only assign leads to users at or below your role level" });
      }
      
      const users = await storage.getUsers();
      const usersByRepId: Record<string, typeof users[0]> = {};
      users.forEach(u => { if (u.repId) usersByRepId[u.repId] = u; });
      
      // Validate each lead's ownership is within caller's authority
      const allowedIds: string[] = [];
      const deniedIds: string[] = [];
      
      for (const leadId of ids) {
        const lead = await storage.getLeadById(leadId);
        if (!lead || lead.deletedAt) {
          deniedIds.push(leadId);
          continue;
        }
        
        const leadOwner = usersByRepId[lead.repId];
        const ownerLevel = leadOwner ? (ROLE_HIERARCHY[leadOwner.role] || 0) : 0;
        
        if (ownerLevel > callerLevel) {
          deniedIds.push(leadId);
        } else {
          allowedIds.push(leadId);
        }
      }
      
      if (allowedIds.length === 0) {
        return res.status(403).json({ message: "You don't have permission to assign any of the selected leads" });
      }
      
      const assignedLeads = await storage.assignLeadsToRep(allowedIds, newRepId);
      
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "bulk_assign_leads",
        tableName: "leads",
        afterJson: JSON.stringify({ count: assignedLeads.length, ids: allowedIds, newRepId, denied: deniedIds.length }),
      });
      
      const message = deniedIds.length > 0
        ? `Assigned ${assignedLeads.length} leads to ${targetRep.name} (${deniedIds.length} skipped due to permissions)`
        : `Assigned ${assignedLeads.length} leads to ${targetRep.name}`;
      
      res.json({ message, count: assignedLeads.length, skipped: deniedIds.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to assign leads" });
    }
  });

  // Update lead pipeline stage
  app.put("/api/leads/:id/stage", auth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { pipelineStage, lostReason, lostNotes } = req.body;
      
      if (!pipelineStage || typeof pipelineStage !== "string") {
        return res.status(400).json({ message: "pipelineStage is required" });
      }
      
      const validStages = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"];
      if (!validStages.includes(pipelineStage)) {
        return res.status(400).json({ message: "Invalid pipeline stage" });
      }
      
      const lead = await storage.getLeadById(id);
      if (!lead || lead.deletedAt) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      const isAdmin = ["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER"].includes(req.user!.role);
      if (!isAdmin && lead.repId !== req.user!.repId) {
        return res.status(403).json({ message: "You can only update your own leads" });
      }
      
      const sanitizedLostReason = typeof lostReason === "string" ? lostReason : null;
      const sanitizedLostNotes = typeof lostNotes === "string" ? lostNotes : null;
      
      const updated = await storage.updateLeadPipelineStage(id, pipelineStage, sanitizedLostReason, sanitizedLostNotes);
      
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "update_lead_stage",
        tableName: "leads",
        recordId: id,
        afterJson: JSON.stringify({ pipelineStage, lostReason: sanitizedLostReason }),
      });
      
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to update lead stage" });
    }
  });

  // Schedule follow-up for a lead
  app.put("/api/leads/:id/follow-up", auth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { scheduledFollowUp, followUpNotes } = req.body;
      
      const lead = await storage.getLeadById(id);
      if (!lead || lead.deletedAt) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      const isAdmin = ["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER"].includes(req.user!.role);
      if (!isAdmin && lead.repId !== req.user!.repId) {
        return res.status(403).json({ message: "You can only update your own leads" });
      }
      
      let parsedDate: Date | null = null;
      if (scheduledFollowUp) {
        const d = new Date(scheduledFollowUp);
        if (isNaN(d.getTime())) {
          return res.status(400).json({ message: "Invalid date format for scheduledFollowUp" });
        }
        parsedDate = d;
      }
      
      const sanitizedNotes = typeof followUpNotes === "string" ? followUpNotes : null;
      const updated = await storage.updateLeadFollowUp(id, parsedDate, sanitizedNotes);
      
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to schedule follow-up" });
    }
  });

  // Log contact attempt
  app.post("/api/leads/:id/contact", auth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { notes } = req.body;
      
      const lead = await storage.getLeadById(id);
      if (!lead || lead.deletedAt) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      const isAdmin = ["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER"].includes(req.user!.role);
      if (!isAdmin && lead.repId !== req.user!.repId) {
        return res.status(403).json({ message: "You can only update your own leads" });
      }
      
      const sanitizedNotes = typeof notes === "string" ? notes : undefined;
      const updated = await storage.logLeadContact(id, lead, sanitizedNotes);
      
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to log contact" });
    }
  });

  // Get leads with follow-ups due (for reminders)
  app.get("/api/leads/follow-ups", auth, async (req: AuthRequest, res) => {
    try {
      const isAdmin = ["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER"].includes(req.user!.role);
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const repId = isAdmin ? undefined : req.user!.repId || undefined;
      const followUps = await storage.getLeadsWithFollowUpsDue(repId, tomorrow);
      
      // Categorize follow-ups
      const overdue = followUps.filter(f => f.scheduledFollowUp && f.scheduledFollowUp < now);
      const today = followUps.filter(f => {
        if (!f.scheduledFollowUp) return false;
        const followUpDate = new Date(f.scheduledFollowUp);
        return followUpDate.toDateString() === now.toDateString();
      });
      const upcoming = followUps.filter(f => {
        if (!f.scheduledFollowUp) return false;
        const followUpDate = new Date(f.scheduledFollowUp);
        return followUpDate > now && followUpDate.toDateString() !== now.toDateString();
      });
      
      res.json({ overdue, today, upcoming, total: followUps.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get follow-ups" });
    }
  });

  // Pipeline analytics - funnel data
  app.get("/api/pipeline/funnel", auth, leadOrAbove, async (req: AuthRequest, res) => {
    try {
      const { startDate, endDate, repId, providerId } = req.query;
      
      const filters = {
        startDate: typeof startDate === "string" ? startDate : undefined,
        endDate: typeof endDate === "string" ? endDate : undefined,
        repId: typeof repId === "string" && repId !== "all" ? repId : undefined,
        providerId: typeof providerId === "string" ? providerId : undefined,
      };
      
      const stageCounts = await storage.getPipelineFunnelData(filters);
      
      // Build funnel data with proper stage ordering
      const stages = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"];
      const stageMap: Record<string, number> = {};
      for (const sc of stageCounts) {
        stageMap[sc.pipelineStage || "NEW"] = sc.count;
      }
      
      const funnelData = stages.map(stage => ({
        stage,
        count: stageMap[stage] || 0,
      }));
      
      // Calculate totals
      const total = funnelData.reduce((sum, f) => sum + f.count, 0);
      const won = stageMap["WON"] || 0;
      const lost = stageMap["LOST"] || 0;
      const active = total - won - lost;
      
      res.json({
        funnel: funnelData,
        summary: {
          total,
          won,
          lost,
          active,
          winRate: (won + lost) > 0 ? ((won / (won + lost)) * 100).toFixed(1) : "0",
          conversionRate: total > 0 ? ((won / total) * 100).toFixed(1) : "0",
        }
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get funnel data" });
    }
  });

  // Lead aging report
  app.get("/api/pipeline/aging", auth, leadOrAbove, async (req: AuthRequest, res) => {
    try {
      const { repId } = req.query;
      const repFilter = typeof repId === "string" && repId !== "all" ? repId : undefined;
      
      const activeLeads = await storage.getActiveLeadsForAging(repFilter, 100);
      
      const now = new Date();
      const agingBuckets = {
        "0-7 days": 0,
        "8-14 days": 0,
        "15-30 days": 0,
        "31-60 days": 0,
        "60+ days": 0,
      };
      
      const agingDetails: any[] = [];
      
      for (const lead of activeLeads) {
        const createdAt = new Date(lead.createdAt);
        const ageDays = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
        
        if (ageDays <= 7) agingBuckets["0-7 days"]++;
        else if (ageDays <= 14) agingBuckets["8-14 days"]++;
        else if (ageDays <= 30) agingBuckets["15-30 days"]++;
        else if (ageDays <= 60) agingBuckets["31-60 days"]++;
        else agingBuckets["60+ days"]++;
        
        agingDetails.push({
          id: lead.id,
          customerName: lead.customerName,
          repId: lead.repId,
          pipelineStage: lead.pipelineStage,
          createdAt: lead.createdAt,
          ageDays,
          lastContactedAt: lead.lastContactedAt,
          scheduledFollowUp: lead.scheduledFollowUp,
        });
      }
      
      // Sort by age descending
      agingDetails.sort((a, b) => b.ageDays - a.ageDays);
      
      const avgAge = activeLeads.length > 0
        ? agingDetails.reduce((sum, l) => sum + l.ageDays, 0) / activeLeads.length
        : 0;
      
      res.json({
        buckets: agingBuckets,
        details: agingDetails.slice(0, 50),
        summary: {
          totalActive: activeLeads.length,
          averageAgeDays: avgAge.toFixed(1),
          oldestLead: agingDetails[0] || null,
        }
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get aging report" });
    }
  });

  // Win/Loss analysis
  app.get("/api/pipeline/win-loss", auth, leadOrAbove, async (req: AuthRequest, res) => {
    try {
      const { startDate, endDate, groupBy } = req.query;
      const groupByField = (typeof groupBy === "string" ? groupBy : "rep");
      
      const filters = {
        startDate: typeof startDate === "string" ? startDate : undefined,
        endDate: typeof endDate === "string" ? endDate : undefined,
      };
      
      const closedLeads = await storage.getClosedLeadsForWinLoss(filters);
      
      // Group analysis
      const analysis: Record<string, { wins: number; losses: number; lossReasons: Record<string, number> }> = {};
      
      for (const lead of closedLeads) {
        let key: string;
        switch (groupByField) {
          case "provider":
            key = lead.interestedProviderId || "Unknown";
            break;
          case "service":
            key = lead.interestedServiceId || "Unknown";
            break;
          default:
            key = lead.repId || "Unknown";
        }
        
        if (!analysis[key]) {
          analysis[key] = { wins: 0, losses: 0, lossReasons: {} };
        }
        
        if (lead.pipelineStage === "WON") {
          analysis[key].wins++;
        } else {
          analysis[key].losses++;
          const reason = lead.lostReason || "Not specified";
          analysis[key].lossReasons[reason] = (analysis[key].lossReasons[reason] || 0) + 1;
        }
      }
      
      // Convert to array and calculate rates
      const results = Object.entries(analysis).map(([key, data]) => ({
        [groupByField]: key,
        wins: data.wins,
        losses: data.losses,
        total: data.wins + data.losses,
        winRate: data.wins + data.losses > 0 ? ((data.wins / (data.wins + data.losses)) * 100).toFixed(1) : "0",
        topLossReasons: Object.entries(data.lossReasons)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([reason, count]) => ({ reason, count })),
      }));
      
      results.sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate));
      
      // Overall loss reasons
      const overallLossReasons: Record<string, number> = {};
      for (const lead of closedLeads.filter(l => l.pipelineStage === "LOST")) {
        const reason = lead.lostReason || "Not specified";
        overallLossReasons[reason] = (overallLossReasons[reason] || 0) + 1;
      }
      
      res.json({
        byGroup: results,
        summary: {
          totalWins: closedLeads.filter(l => l.pipelineStage === "WON").length,
          totalLosses: closedLeads.filter(l => l.pipelineStage === "LOST").length,
          overallWinRate: closedLeads.length > 0 
            ? ((closedLeads.filter(l => l.pipelineStage === "WON").length / closedLeads.length) * 100).toFixed(1)
            : "0",
          topLossReasons: Object.entries(overallLossReasons)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([reason, count]) => ({ reason, count })),
        }
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get win/loss analysis" });
    }
  });

  // Commissions - role-based view
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
      
      // Get commission line items for service breakdown
      const allLineItems = await Promise.all(
        myOrders.map(async (o: SalesOrder) => {
          const lineItems = await storage.getCommissionLineItemsByOrderId(o.id);
          return { orderId: o.id, lineItems };
        })
      );
      
      // Map line items by order for quick lookup
      const lineItemsByOrder: Record<string, any[]> = {};
      for (const { orderId, lineItems } of allLineItems) {
        lineItemsByOrder[orderId] = lineItems;
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

  // ==================== REPORTS ====================
  
  // Helper to apply role-based filtering to orders
  // viewMode is optional and only applies to EXECUTIVE users: "own" | "team" | "global"
  async function applyRoleBasedOrderFilter(orders: SalesOrder[], user: User, viewMode?: string): Promise<{ filteredOrders: SalesOrder[]; scopeInfo: { role: string; scopeDescription: string; repCount: number } }> {
    let filteredOrders = orders;
    let scopeDescription = "All data";
    let repCount = 0;
    
    if (user.role === "REP") {
      filteredOrders = orders.filter(o => o.repId === user.repId);
      scopeDescription = "Your personal data";
      repCount = 1;
    } else if (user.role === "LEAD") {
      const supervisedReps = await storage.getSupervisedReps(user.id);
      const repIds = [user.repId, ...supervisedReps.map(r => r.repId)];
      filteredOrders = orders.filter(o => repIds.includes(o.repId));
      scopeDescription = `Your team (${supervisedReps.length} direct reports)`;
      repCount = repIds.length;
    } else if (user.role === "MANAGER") {
      const scope = await storage.getManagerScope(user.id);
      filteredOrders = orders.filter(o => scope.allRepRepIds.includes(o.repId));
      scopeDescription = `Your organization (${scope.supervisorIds.length} supervisors, ${scope.allRepRepIds.length} total reps)`;
      repCount = scope.allRepRepIds.length;
    } else if (user.role === "EXECUTIVE") {
      // EXECUTIVE users can switch between own/team/global views
      if (viewMode === "own") {
        filteredOrders = orders.filter(o => o.repId === user.repId);
        scopeDescription = "Your personal sales";
        repCount = 1;
      } else if (viewMode === "global") {
        const allUsers = await storage.getUsers();
        const salesReps = allUsers.filter(u => ["REP", "LEAD", "MANAGER", "EXECUTIVE"].includes(u.role) && !u.deletedAt);
        scopeDescription = `Company-wide (${salesReps.length} total sales reps)`;
        repCount = salesReps.length;
        // No filtering - show all orders
      } else {
        // Default to "team" - their organizational tree
        const scope = await storage.getExecutiveScope(user.id);
        filteredOrders = orders.filter(o => scope.allRepRepIds.includes(o.repId));
        scopeDescription = `Your division (${scope.managerIds.length} managers, ${scope.allRepRepIds.length} total reps)`;
        repCount = scope.allRepRepIds.length;
      }
    } else if (user.role === "ADMIN" || user.role === "OPERATIONS") {
      const allUsers = await storage.getUsers();
      const salesReps = allUsers.filter(u => ["REP", "LEAD", "MANAGER", "EXECUTIVE"].includes(u.role) && !u.deletedAt);
      scopeDescription = `Company-wide (${salesReps.length} total sales reps)`;
      repCount = salesReps.length;
    }
    
    return {
      filteredOrders,
      scopeInfo: {
        role: user.role,
        scopeDescription,
        repCount,
      }
    };
  }
  
  // Helper to get date ranges
  function getDateRange(period: string, customStart?: string, customEnd?: string) {
    const now = new Date();
    let start: Date, end: Date;
    
    switch (period) {
      case "today":
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        end = new Date(start);
        end.setDate(end.getDate() + 1);
        break;
      case "yesterday":
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case "this_week":
        const dayOfWeek = now.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);
        end = new Date(start);
        end.setDate(end.getDate() + 7);
        break;
      case "last_week":
        const currentDayOfWeek = now.getDay();
        const lastMondayOffset = currentDayOfWeek === 0 ? -13 : -6 - currentDayOfWeek;
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + lastMondayOffset);
        end = new Date(start);
        end.setDate(end.getDate() + 7);
        break;
      case "this_month":
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        break;
      case "last_month":
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        end = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case "this_quarter":
        const currentQuarter = Math.floor(now.getMonth() / 3);
        start = new Date(now.getFullYear(), currentQuarter * 3, 1);
        end = new Date(now.getFullYear(), (currentQuarter + 1) * 3, 1);
        break;
      case "last_quarter":
        const lastQuarter = Math.floor(now.getMonth() / 3) - 1;
        const year = lastQuarter < 0 ? now.getFullYear() - 1 : now.getFullYear();
        const adjustedQuarter = lastQuarter < 0 ? 3 : lastQuarter;
        start = new Date(year, adjustedQuarter * 3, 1);
        end = new Date(year, (adjustedQuarter + 1) * 3, 1);
        break;
      case "this_year":
        start = new Date(now.getFullYear(), 0, 1);
        end = new Date(now.getFullYear() + 1, 0, 1);
        break;
      case "last_year":
        start = new Date(now.getFullYear() - 1, 0, 1);
        end = new Date(now.getFullYear(), 0, 1);
        break;
      case "custom":
        start = customStart ? new Date(customStart) : new Date(now.getFullYear(), now.getMonth(), 1);
        end = customEnd ? new Date(customEnd) : new Date();
        end.setDate(end.getDate() + 1);
        break;
      default:
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    }
    
    return { start, end };
  }

  // Production metrics - weekly and MTD pending/connected dollars
  app.get("/api/reports/production", auth, async (req: AuthRequest, res) => {
    try {
      const { viewMode } = req.query;
      const user = req.user!;
      const now = new Date();
      
      const allOrders = await storage.getOrders({});
      const { filteredOrders: orders, scopeInfo } = await applyRoleBasedOrderFilter(allOrders, user, viewMode as string | undefined);
      
      // Calculate week start (Monday)
      const dayOfWeek = now.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);
      const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1); // Today end
      
      // Calculate MTD (calendar month-to-date)
      const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const mtdEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      
      // Weekly orders
      const weeklyOrders = orders.filter(o => {
        const orderDate = new Date(o.dateSold);
        return orderDate >= weekStart && orderDate < weekEnd;
      });
      
      // MTD orders
      const mtdOrders = orders.filter(o => {
        const orderDate = new Date(o.dateSold);
        return orderDate >= mtdStart && orderDate < mtdEnd;
      });
      
      // Calculate metrics
      const calcMetrics = (orderSet: SalesOrder[]) => {
        const totalSold = orderSet.length;
        const pendingOrders = orderSet.filter(o => o.jobStatus === "PENDING");
        const connectedOrders = orderSet.filter(o => o.jobStatus === "COMPLETED");
        const approvedOrders = orderSet.filter(o => o.jobStatus === "COMPLETED");
        
        const pendingDollars = pendingOrders.reduce((sum, o) => 
          sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
        const connectedDollars = connectedOrders.reduce((sum, o) => 
          sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
        const totalEarned = approvedOrders.reduce((sum, o) => 
          sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
        
        const mobileLines = orderSet.reduce((sum, o) => sum + (o.mobileLinesQty || 0), 0);
        const tvSold = orderSet.filter(o => o.tvSold).length;
        
        return {
          totalSold,
          pending: pendingOrders.length,
          connected: connectedOrders.length,
          approved: approvedOrders.length,
          pendingDollars: pendingDollars.toFixed(2),
          connectedDollars: connectedDollars.toFixed(2),
          totalEarned: totalEarned.toFixed(2),
          mobileLines,
          tvSold,
        };
      };
      
      const weekly = calcMetrics(weeklyOrders);
      const mtd = calcMetrics(mtdOrders);
      
      res.json({
        scopeInfo,
        periods: {
          weekly: {
            start: weekStart.toISOString().split("T")[0],
            end: weekEnd.toISOString().split("T")[0],
            label: "This Week",
          },
          mtd: {
            start: mtdStart.toISOString().split("T")[0],
            end: mtdEnd.toISOString().split("T")[0],
            label: `MTD (${now.toLocaleString("default", { month: "short" })})`,
          },
        },
        weekly,
        mtd,
      });
    } catch (error) {
      console.error("Production metrics error:", error);
      res.status(500).json({ message: "Failed to get production metrics" });
    }
  });

  // Reports Summary - KPIs
  app.get("/api/reports/summary", auth, async (req: AuthRequest, res) => {
    try {
      const { period = "this_month", startDate, endDate, viewMode } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      const allOrders = await storage.getOrders({});
      const { filteredOrders: orders, scopeInfo } = await applyRoleBasedOrderFilter(allOrders, user, viewMode as string | undefined);
      
      // Filter by date range (using dateSold)
      const periodOrders = orders.filter(o => {
        const orderDate = new Date(o.dateSold);
        return orderDate >= start && orderDate < end;
      });
      
      const totalOrders = periodOrders.length;
      const completedOrders = periodOrders.filter(o => o.jobStatus === "COMPLETED").length;
      const approvedOrders = periodOrders.filter(o => o.jobStatus === "COMPLETED").length;
      const pendingOrders = periodOrders.filter(o => o.jobStatus === "PENDING").length;
      
      const totalEarned = periodOrders
        .filter(o => o.jobStatus === "COMPLETED")
        .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
      
      const totalPaid = periodOrders
        .filter(o => o.paymentStatus === "PAID")
        .reduce((sum, o) => sum + parseFloat(o.commissionPaid), 0);
      
      // Pending dollars: commission from orders with jobStatus = PENDING
      const pendingDollars = periodOrders
        .filter(o => o.jobStatus === "PENDING")
        .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
      
      // Connected dollars: commission from orders with jobStatus = COMPLETED
      const connectedDollars = periodOrders
        .filter(o => o.jobStatus === "COMPLETED")
        .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
      
      const avgCommission = approvedOrders > 0 ? totalEarned / approvedOrders : 0;
      const approvalRate = totalOrders > 0 ? (approvedOrders / totalOrders) * 100 : 0;
      const completionRate = totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 0;
      
      // Get previous period for comparison
      const periodLength = end.getTime() - start.getTime();
      const prevStart = new Date(start.getTime() - periodLength);
      const prevEnd = new Date(start);
      
      const prevOrders = orders.filter(o => {
        const orderDate = new Date(o.dateSold);
        return orderDate >= prevStart && orderDate < prevEnd;
      });
      
      const prevTotalOrders = prevOrders.length;
      const prevTotalEarned = prevOrders
        .filter(o => o.jobStatus === "COMPLETED")
        .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
      
      res.json({
        period: { start: start.toISOString(), end: end.toISOString() },
        scopeInfo,
        totalOrders,
        completedOrders,
        approvedOrders,
        pendingOrders,
        totalEarned: totalEarned.toFixed(2),
        totalPaid: totalPaid.toFixed(2),
        outstanding: (totalEarned - totalPaid).toFixed(2),
        pendingDollars: pendingDollars.toFixed(2),
        connectedDollars: connectedDollars.toFixed(2),
        avgCommission: avgCommission.toFixed(2),
        approvalRate: approvalRate.toFixed(1),
        completionRate: completionRate.toFixed(1),
        comparison: {
          ordersTrend: prevTotalOrders > 0 ? ((totalOrders - prevTotalOrders) / prevTotalOrders * 100).toFixed(1) : "0",
          earnedTrend: prevTotalEarned > 0 ? ((totalEarned - prevTotalEarned) / prevTotalEarned * 100).toFixed(1) : "0",
        },
      });
    } catch (error) {
      console.error("Report summary error:", error);
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

  // Sales by Rep
  app.get("/api/reports/sales-by-rep", auth, async (req: AuthRequest, res) => {
    try {
      const { period = "this_month", startDate, endDate, viewMode } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      const allOrders = await storage.getOrders({});
      const users = await storage.getUsers();
      const { filteredOrders: orders, scopeInfo } = await applyRoleBasedOrderFilter(allOrders, user, viewMode as string | undefined);
      
      const periodOrders = orders.filter(o => {
        const orderDate = new Date(o.dateSold);
        return orderDate >= start && orderDate < end;
      });
      
      const repStats: Record<string, { name: string; orders: number; earned: number; approved: number }> = {};
      
      for (const order of periodOrders) {
        if (!repStats[order.repId]) {
          const repUser = users.find(u => u.repId === order.repId);
          repStats[order.repId] = { name: repUser?.name || order.repId, orders: 0, earned: 0, approved: 0 };
        }
        repStats[order.repId].orders++;
        if (order.jobStatus === "COMPLETED") {
          repStats[order.repId].approved++;
          repStats[order.repId].earned += parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned);
        }
      }
      
      const data = Object.entries(repStats)
        .map(([repId, stats]) => ({ repId, ...stats }))
        .sort((a, b) => b.earned - a.earned);
      
      res.json({ data });
    } catch (error) {
      console.error("Sales by rep error:", error);
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

  // Sales by Provider
  app.get("/api/reports/sales-by-provider", auth, async (req: AuthRequest, res) => {
    try {
      const { period = "this_month", startDate, endDate, viewMode } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      const allOrders = await storage.getOrders({});
      const providers = await storage.getProviders();
      const { filteredOrders: orders } = await applyRoleBasedOrderFilter(allOrders, user, viewMode as string | undefined);
      
      const periodOrders = orders.filter(o => {
        const orderDate = new Date(o.dateSold);
        return orderDate >= start && orderDate < end;
      });
      
      const providerStats: Record<string, { name: string; orders: number; earned: number }> = {};
      
      for (const order of periodOrders) {
        const providerId = order.providerId;
        if (!providerStats[providerId]) {
          const provider = providers.find(p => p.id === providerId);
          providerStats[providerId] = { name: provider?.name || "Unknown", orders: 0, earned: 0 };
        }
        providerStats[providerId].orders++;
        if (order.jobStatus === "COMPLETED") {
          providerStats[providerId].earned += parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned);
        }
      }
      
      const data = Object.entries(providerStats)
        .map(([id, stats]) => ({ id, ...stats }))
        .sort((a, b) => b.orders - a.orders);
      
      res.json({ data });
    } catch (error) {
      console.error("Sales by provider error:", error);
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

  // Sales by Service
  app.get("/api/reports/sales-by-service", auth, async (req: AuthRequest, res) => {
    try {
      const { period = "this_month", startDate, endDate, viewMode } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      const allOrders = await storage.getOrders({});
      const services = await storage.getServices();
      const { filteredOrders: orders } = await applyRoleBasedOrderFilter(allOrders, user, viewMode as string | undefined);
      
      const periodOrders = orders.filter(o => {
        const orderDate = new Date(o.dateSold);
        return orderDate >= start && orderDate < end;
      });
      
      const serviceStats: Record<string, { name: string; orders: number; earned: number }> = {};
      
      for (const order of periodOrders) {
        const serviceId = order.serviceId;
        if (!serviceStats[serviceId]) {
          const service = services.find(s => s.id === serviceId);
          serviceStats[serviceId] = { name: service?.name || "Unknown", orders: 0, earned: 0 };
        }
        serviceStats[serviceId].orders++;
        if (order.jobStatus === "COMPLETED") {
          serviceStats[serviceId].earned += parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned);
        }
      }
      
      const data = Object.entries(serviceStats)
        .map(([id, stats]) => ({ id, ...stats }))
        .sort((a, b) => b.orders - a.orders);
      
      res.json({ data });
    } catch (error) {
      console.error("Sales by service error:", error);
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

  // Trend Data
  app.get("/api/reports/trend", auth, async (req: AuthRequest, res) => {
    try {
      const { period = "this_month", startDate, endDate, groupBy = "day", viewMode } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      const allOrders = await storage.getOrders({});
      const { filteredOrders: orders } = await applyRoleBasedOrderFilter(allOrders, user, viewMode as string | undefined);
      
      const periodOrders = orders.filter(o => {
        const orderDate = new Date(o.dateSold);
        return orderDate >= start && orderDate < end;
      });
      
      const trendData: Record<string, { label: string; orders: number; earned: number }> = {};
      
      for (const order of periodOrders) {
        const orderDate = new Date(order.dateSold);
        let key: string, label: string;
        
        if (groupBy === "day") {
          key = orderDate.toISOString().split("T")[0];
          label = orderDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        } else if (groupBy === "week") {
          const weekStart = new Date(orderDate);
          const day = weekStart.getDay();
          const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1);
          weekStart.setDate(diff);
          key = weekStart.toISOString().split("T")[0];
          label = `Week of ${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
        } else {
          key = `${orderDate.getFullYear()}-${String(orderDate.getMonth() + 1).padStart(2, "0")}`;
          label = orderDate.toLocaleDateString("en-US", { month: "short", year: "numeric" });
        }
        
        if (!trendData[key]) {
          trendData[key] = { label, orders: 0, earned: 0 };
        }
        trendData[key].orders++;
        if (order.jobStatus === "COMPLETED") {
          trendData[key].earned += parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned);
        }
      }
      
      const data = Object.entries(trendData)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, stats]) => ({ key, ...stats }));
      
      res.json({ data });
    } catch (error) {
      console.error("Trend error:", error);
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

  // Commission Summary - Earned vs Paid
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

  // Team Production Report - For LEAD+ to view team leader production (within their scope)
  app.get("/api/reports/team-production", auth, async (req: AuthRequest, res) => {
    try {
      const { period = "this_month", startDate, endDate } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      // REPs cannot access this report - need LEAD or higher
      if (user.role === "REP") {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const allOrders = await storage.getOrders({});
      const allUsers = await storage.getUsers();
      
      // Filter orders by date range
      const periodOrders = allOrders.filter(o => {
        const orderDate = new Date(o.dateSold);
        return orderDate >= start && orderDate < end;
      });
      
      // Determine which team leaders to show based on user's role
      let teamLeaders: typeof allUsers = [];
      let userScope: { supervisorIds?: string[]; managerIds?: string[]; allRepRepIds: string[] } = { allRepRepIds: [] };
      
      if (user.role === "ADMIN" || user.role === "OPERATIONS") {
        // Full access - show all team leaders
        teamLeaders = allUsers.filter(u => 
          ["EXECUTIVE", "MANAGER", "LEAD"].includes(u.role) && !u.deletedAt
        );
      } else if (user.role === "EXECUTIVE") {
        // Show managers and supervisors under this executive
        userScope = await storage.getExecutiveScope(user.id);
        teamLeaders = allUsers.filter(u => 
          (["MANAGER", "LEAD"].includes(u.role) && !u.deletedAt) &&
          (userScope.managerIds?.includes(u.id) || userScope.supervisorIds?.includes(u.id))
        );
        // Also include self
        teamLeaders.unshift(user);
      } else if (user.role === "MANAGER") {
        // Show supervisors under this manager
        userScope = await storage.getManagerScope(user.id);
        teamLeaders = allUsers.filter(u => 
          u.role === "LEAD" && !u.deletedAt && userScope.supervisorIds?.includes(u.id)
        );
        // Also include self
        teamLeaders.unshift(user);
      } else if (user.role === "LEAD") {
        // Supervisor only sees their own team production
        teamLeaders = [user];
        const supervisedReps = await storage.getSupervisedReps(user.id);
        userScope = { allRepRepIds: [user.repId, ...supervisedReps.map(r => r.repId)] };
      }
      
      const teamData: Array<{
        leaderId: string;
        leaderName: string;
        leaderRepId: string;
        role: string;
        sold: number;
        connected: number;
        mobileLines: number;
        pendingDollars: number;
        connectedDollars: number;
        teamSize: number;
      }> = [];
      
      for (const leader of teamLeaders) {
        let teamRepIds: string[] = [];
        
        if (leader.role === "EXECUTIVE") {
          const scope = await storage.getExecutiveScope(leader.id);
          teamRepIds = scope.allRepRepIds;
        } else if (leader.role === "MANAGER") {
          const scope = await storage.getManagerScope(leader.id);
          teamRepIds = scope.allRepRepIds;
        } else if (leader.role === "LEAD") {
          const supervisedReps = await storage.getSupervisedReps(leader.id);
          teamRepIds = [leader.repId, ...supervisedReps.map(r => r.repId)];
        }
        
        // Calculate team stats
        const teamOrders = periodOrders.filter(o => teamRepIds.includes(o.repId));
        const sold = teamOrders.length;
        const connected = teamOrders.filter(o => o.jobStatus === "COMPLETED").length;
        const mobileLines = teamOrders.reduce((sum, o) => sum + (o.mobileLinesQty || 0), 0);
