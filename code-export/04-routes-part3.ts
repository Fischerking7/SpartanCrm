      const scopeDescription = "All Reps";
      
      // Filter orders by date range AND scope
      const periodOrders = allOrders.filter(o => {
        const orderDate = new Date(o.dateSold);
        return orderDate >= start && orderDate < end && scopedRepIds.includes(o.repId);
      });
      
      // Build detailed metrics per rep
      const repMetrics: Array<{
        userId: string;
        repId: string;
        name: string;
        role: string;
        supervisorName: string | null;
        ordersSold: number;
        ordersConnected: number;
        ordersPending: number;
        ordersApproved: number;
        earned: number;
        paid: number;
        outstanding: number;
        mobileLines: number;
        tvSold: number;
        internetSold: number;
        avgOrderValue: number;
        approvalRate: number;
        connectionRate: number;
        leadsConverted: number;
        leadsTotal: number;
        conversionRate: number;
      }> = [];
      
      const scopeInfo = {
        role: user.role,
        scopeDescription,
        repCount: scopedRepIds.length,
      };
      
      for (const repId of scopedRepIds) {
        const repUser = allUsers.find(u => u.repId === repId && !u.deletedAt);
        if (!repUser) continue;
        
        const repOrders = periodOrders.filter(o => o.repId === repId);
        const ordersSold = repOrders.length;
        const ordersConnected = repOrders.filter(o => o.jobStatus === "COMPLETED").length;
        const ordersPending = repOrders.filter(o => o.jobStatus === "PENDING").length;
        const ordersApproved = repOrders.filter(o => o.jobStatus === "COMPLETED").length;
        
        const earned = repOrders
          .filter(o => o.jobStatus === "COMPLETED" && o.jobStatus === "COMPLETED")
          .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
        
        const paid = repOrders
          .filter(o => o.paidDate)
          .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
        
        const mobileLines = repOrders.reduce((sum, o) => sum + (o.mobileLinesQty || 0), 0);
        const tvSold = repOrders.filter(o => o.tvSold).length;
        const internetSold = repOrders.length - tvSold; // Orders without TV as proxy for internet
        
        const avgOrderValue = ordersSold > 0 ? earned / ordersConnected || 0 : 0;
        const approvalRate = ordersSold > 0 ? (ordersApproved / ordersSold) * 100 : 0;
        const connectionRate = ordersSold > 0 ? (ordersConnected / ordersSold) * 100 : 0;
        
        // Get leads for this rep in period
        const repLeads = await storage.getLeadsByRepId(repId, {
          dateFrom: start.toISOString().split("T")[0],
          dateTo: end.toISOString().split("T")[0],
          includeDisposed: true,
        });
        const leadsConverted = repLeads.filter(l => l.disposition === "SOLD").length;
        const leadsTotal = repLeads.length;
        const conversionRate = leadsTotal > 0 ? (leadsConverted / leadsTotal) * 100 : 0;
        
        // Find supervisor name
        let supervisorName: string | null = null;
        if (repUser.assignedSupervisorId) {
          const supervisor = allUsers.find(u => u.id === repUser.assignedSupervisorId);
          supervisorName = supervisor?.name || null;
        }
        
        repMetrics.push({
          userId: repUser.id,
          repId: repUser.repId,
          name: repUser.name,
          role: repUser.role,
          supervisorName,
          ordersSold,
          ordersConnected,
          ordersPending,
          ordersApproved,
          earned,
          paid,
          outstanding: earned - paid,
          mobileLines,
          tvSold,
          internetSold,
          avgOrderValue,
          approvalRate,
          connectionRate,
          leadsConverted,
          leadsTotal,
          conversionRate,
        });
      }
      
      // Sort by earned descending
      repMetrics.sort((a, b) => b.earned - a.earned);
      
      const totals = repMetrics.reduce((acc, rep) => ({
        totalOrders: acc.totalOrders + rep.ordersSold,
        totalConnected: acc.totalConnected + rep.ordersConnected,
        totalEarned: acc.totalEarned + rep.earned,
        totalPaid: acc.totalPaid + rep.paid,
        totalMobileLines: acc.totalMobileLines + rep.mobileLines,
        totalLeads: acc.totalLeads + rep.leadsTotal,
        totalConverted: acc.totalConverted + rep.leadsConverted,
      }), { totalOrders: 0, totalConnected: 0, totalEarned: 0, totalPaid: 0, totalMobileLines: 0, totalLeads: 0, totalConverted: 0 });
      
      res.json({ 
        data: repMetrics, 
        totals,
        scopeInfo,
      });
    } catch (error) {
      console.error("Rep leaderboard error:", error);
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

  // Override Earnings by Invoice
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

  // Provider/Client Profitability Analysis
  app.get("/api/reports/profitability", auth, async (req: AuthRequest, res) => {
    try {
      const { period = "this_month", startDate, endDate, type = "provider", viewMode } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER"].includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const allOrders = await storage.getOrders({});
      const providers = await storage.getProviders();
      const clients = await storage.getClients();
      const rateCards = await storage.getRateCards();
      const { filteredOrders: orders } = await applyRoleBasedOrderFilter(allOrders, user, viewMode as string | undefined);
      
      const periodOrders = orders.filter(o => {
        const orderDate = new Date(o.dateSold);
        return orderDate >= start && orderDate < end;
      });
      
      const entityStats: Record<string, {
        name: string;
        orders: number;
        revenue: number;
        commissionCost: number;
        overrideCost: number;
        margin: number;
        marginPercent: number;
      }> = {};
      
      for (const order of periodOrders) {
        if (order.jobStatus !== "COMPLETED") continue;
        
        const entityId = type === "provider" ? order.providerId : order.clientId || "unknown";
        const entity = type === "provider" 
          ? providers.find(p => p.id === entityId)
          : clients.find(c => c.id === entityId);
        
        if (!entityStats[entityId]) {
          entityStats[entityId] = {
            name: entity?.name || "Unknown",
            orders: 0,
            revenue: 0,
            commissionCost: 0,
            overrideCost: 0,
            margin: 0,
            marginPercent: 0,
          };
        }
        
        const baseEarned = parseFloat(order.baseCommissionEarned) || 0;
        const incentiveEarned = parseFloat(order.incentiveEarned || "0") || 0;
        const overrideDeduction = parseFloat(order.overrideDeduction || "0") || 0;
        const totalCommissionCost = baseEarned + incentiveEarned;
        
        // Calculate estimated revenue (estimate as 5x commission since MRC is not tracked)
        const estimatedRevenue = totalCommissionCost * 5;
        
        entityStats[entityId].orders++;
        entityStats[entityId].revenue += estimatedRevenue;
        entityStats[entityId].commissionCost += totalCommissionCost;
        entityStats[entityId].overrideCost += overrideDeduction;
      }
      
      // Calculate margins
      for (const stats of Object.values(entityStats)) {
        const totalCost = stats.commissionCost + stats.overrideCost;
        stats.margin = stats.revenue - totalCost;
        stats.marginPercent = stats.revenue > 0 ? (stats.margin / stats.revenue) * 100 : 0;
      }
      
      const data = Object.entries(entityStats)
        .map(([id, stats]) => ({ id, ...stats }))
        .sort((a, b) => b.margin - a.margin);
      
      const totals = data.reduce((acc, item) => ({
        totalOrders: acc.totalOrders + item.orders,
        totalRevenue: acc.totalRevenue + item.revenue,
        totalCommissionCost: acc.totalCommissionCost + item.commissionCost,
        totalOverrideCost: acc.totalOverrideCost + item.overrideCost,
        totalMargin: acc.totalMargin + item.margin,
      }), { totalOrders: 0, totalRevenue: 0, totalCommissionCost: 0, totalOverrideCost: 0, totalMargin: 0 });
      
      res.json({ 
        data, 
        totals: {
          ...totals,
          avgMarginPercent: totals.totalRevenue > 0 ? (totals.totalMargin / totals.totalRevenue) * 100 : 0,
        },
        period: { start: start.toISOString(), end: end.toISOString() },
      });
    } catch (error) {
      console.error("Profitability report error:", error);
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

  // Commission Cost Analysis by Product Mix
  app.get("/api/reports/product-mix", auth, async (req: AuthRequest, res) => {
    try {
      const { period = "this_month", startDate, endDate, viewMode } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER"].includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const allOrders = await storage.getOrders({});
      const services = await storage.getServices();
      const providers = await storage.getProviders();
      const { filteredOrders: orders } = await applyRoleBasedOrderFilter(allOrders, user, viewMode as string | undefined);
      
      const periodOrders = orders.filter(o => {
        const orderDate = new Date(o.dateSold);
        return orderDate >= start && orderDate < end;
      });
      
      // Product mix by service type
      const serviceStats: Record<string, {
        name: string;
        provider: string;
        orders: number;
        baseCommission: number;
        incentiveCommission: number;
        overrideCommission: number;
        totalCommission: number;
        avgCommissionPerOrder: number;
        percentOfTotal: number;
      }> = {};
      
      let grandTotalCommission = 0;
      
      for (const order of periodOrders) {
        if (order.jobStatus !== "COMPLETED") continue;
        
        const serviceId = order.serviceId;
        const service = services.find(s => s.id === serviceId);
        const provider = providers.find(p => p.id === order.providerId);
        
        if (!serviceStats[serviceId]) {
          serviceStats[serviceId] = {
            name: service?.name || "Unknown",
            provider: provider?.name || "Unknown",
            orders: 0,
            baseCommission: 0,
            incentiveCommission: 0,
            overrideCommission: 0,
            totalCommission: 0,
            avgCommissionPerOrder: 0,
            percentOfTotal: 0,
          };
        }
        
        const baseEarned = parseFloat(order.baseCommissionEarned) || 0;
        const incentiveEarned = parseFloat(order.incentiveEarned || "0") || 0;
        const overrideDeduction = parseFloat(order.overrideDeduction || "0") || 0;
        const totalCommission = baseEarned + incentiveEarned;
        
        serviceStats[serviceId].orders++;
        serviceStats[serviceId].baseCommission += baseEarned;
        serviceStats[serviceId].incentiveCommission += incentiveEarned;
        serviceStats[serviceId].overrideCommission += overrideDeduction;
        serviceStats[serviceId].totalCommission += totalCommission;
        grandTotalCommission += totalCommission;
      }
      
      // Calculate averages and percentages
      for (const stats of Object.values(serviceStats)) {
        stats.avgCommissionPerOrder = stats.orders > 0 ? stats.totalCommission / stats.orders : 0;
        stats.percentOfTotal = grandTotalCommission > 0 ? (stats.totalCommission / grandTotalCommission) * 100 : 0;
      }
      
      const data = Object.entries(serviceStats)
        .map(([id, stats]) => ({ id, ...stats }))
        .sort((a, b) => b.totalCommission - a.totalCommission);
      
      const totals = data.reduce((acc, item) => ({
        totalOrders: acc.totalOrders + item.orders,
        totalBaseCommission: acc.totalBaseCommission + item.baseCommission,
        totalIncentiveCommission: acc.totalIncentiveCommission + item.incentiveCommission,
        totalOverrideCommission: acc.totalOverrideCommission + item.overrideCommission,
        grandTotalCommission: acc.grandTotalCommission + item.totalCommission,
      }), { totalOrders: 0, totalBaseCommission: 0, totalIncentiveCommission: 0, totalOverrideCommission: 0, grandTotalCommission: 0 });
      
      // Also break down by provider
      const providerBreakdown: Record<string, { name: string; orders: number; totalCommission: number; percentOfTotal: number }> = {};
      for (const order of periodOrders) {
        if (order.jobStatus !== "COMPLETED") continue;
        const provider = providers.find(p => p.id === order.providerId);
        if (!providerBreakdown[order.providerId]) {
          providerBreakdown[order.providerId] = {
            name: provider?.name || "Unknown",
            orders: 0,
            totalCommission: 0,
            percentOfTotal: 0,
          };
        }
        providerBreakdown[order.providerId].orders++;
        providerBreakdown[order.providerId].totalCommission += 
          (parseFloat(order.baseCommissionEarned) || 0) + (parseFloat(order.incentiveEarned || "0") || 0);
      }
      for (const stats of Object.values(providerBreakdown)) {
        stats.percentOfTotal = grandTotalCommission > 0 ? (stats.totalCommission / grandTotalCommission) * 100 : 0;
      }
      
      res.json({ 
        data, 
        totals,
        providerBreakdown: Object.entries(providerBreakdown)
          .map(([id, stats]) => ({ id, ...stats }))
          .sort((a, b) => b.totalCommission - a.totalCommission),
        period: { start: start.toISOString(), end: end.toISOString() },
      });
    } catch (error) {
      console.error("Product mix report error:", error);
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

  app.get("/api/reports/sales-tracker", auth, executiveOrAdmin, async (req: AuthRequest, res) => {
    try {
      const { viewMode, view } = req.query;
      const user = req.user!;
      const now = new Date();

      const allowedGlobal = ["ADMIN", "OPERATIONS", "EXECUTIVE"];
      const allOrders = await storage.getOrders({});
      const allUsers = await storage.getUsers();
      const allServices = await storage.getServices();

      let effectiveViewMode = viewMode as string | undefined;
      if (allowedGlobal.includes(user.role) && !effectiveViewMode) {
        effectiveViewMode = "global";
      }
      const { filteredOrders: orders } = await applyRoleBasedOrderFilter(allOrders, user, effectiveViewMode);

      const dow = now.getDay();
      const mondayOffset = dow === 0 ? -6 : 1 - dow;
      const thisWeekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);
      const thisWeekEnd = new Date(thisWeekStart);
      thisWeekEnd.setDate(thisWeekEnd.getDate() + 7);
      const lastWeekStart = new Date(thisWeekStart);
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);
      const lastWeekEnd = new Date(thisWeekStart);

      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(thisMonthStart);
      const priorMonthStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      const priorMonthEnd = new Date(lastMonthStart);

      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd = new Date(todayStart);
      todayEnd.setDate(todayEnd.getDate() + 1);
      const yesterdayStart = new Date(todayStart);
      yesterdayStart.setDate(yesterdayStart.getDate() - 1);
      const yesterdayEnd = new Date(todayStart);

      const inRange = (o: any, s: Date, e: Date) => {
        const d = new Date(o.dateSold);
        return d >= s && d < e;
      };

      const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const getWeekLabel = (d: Date) => {
        const m = d.toLocaleString("default", { month: "short" });
        return `${m} ${d.getDate()}`;
      };

      const repIds = [...new Set(orders.map(o => o.repId))];
      const trackerData = repIds.map(repId => {
        const repUser = allUsers.find(u => u.repId === repId && !u.deletedAt);
        const repOrders = orders.filter(o => o.repId === repId);

        const todayOrders = repOrders.filter(o => inRange(o, todayStart, todayEnd));
        const yesterdayOrders = repOrders.filter(o => inRange(o, yesterdayStart, yesterdayEnd));
        const tw = repOrders.filter(o => inRange(o, thisWeekStart, thisWeekEnd));
        const lw = repOrders.filter(o => inRange(o, lastWeekStart, lastWeekEnd));
        const tm = repOrders.filter(o => inRange(o, thisMonthStart, thisMonthEnd));
        const lm = repOrders.filter(o => inRange(o, lastMonthStart, lastMonthEnd));
        const pm = repOrders.filter(o => inRange(o, priorMonthStart, priorMonthEnd));

        const stats = (arr: typeof repOrders) => ({
          submitted: arr.length,
          connected: arr.filter(o => o.jobStatus === "COMPLETED").length,
          approved: arr.filter(o => o.approvalStatus === "APPROVED").length,
        });

        const dailyBreakdown = dayLabels.map((label, i) => {
          const dayStart = new Date(thisWeekStart);
          dayStart.setDate(dayStart.getDate() + i);
          const dayEnd = new Date(dayStart);
          dayEnd.setDate(dayEnd.getDate() + 1);
          const dayOrders = repOrders.filter(o => inRange(o, dayStart, dayEnd));
          return { day: label, date: dayStart.toISOString().split("T")[0], ...stats(dayOrders) };
        });

        const prevDailyBreakdown = dayLabels.map((label, i) => {
          const dayStart = new Date(lastWeekStart);
          dayStart.setDate(dayStart.getDate() + i);
          const dayEnd = new Date(dayStart);
          dayEnd.setDate(dayEnd.getDate() + 1);
          const dayOrders = repOrders.filter(o => inRange(o, dayStart, dayEnd));
          return { day: label, date: dayStart.toISOString().split("T")[0], ...stats(dayOrders) };
        });

        const twStats = stats(tw);
        const lwStats = stats(lw);
        const tmStats = stats(tm);
        const lmStats = stats(lm);
        const pmStats = stats(pm);
        const todayStats = stats(todayOrders);
        const yesterdayStats = stats(yesterdayOrders);

        const delta = (curr: number, prev: number) => ({
          value: curr - prev,
          percent: prev > 0 ? Math.round(((curr - prev) / prev) * 100) : (curr > 0 ? 100 : 0),
        });

        return {
          repId,
          name: repUser?.name || repId,
          role: repUser?.role || "REP",
          today: todayStats,
          yesterday: yesterdayStats,
          dayOverDay: {
            submitted: delta(todayStats.submitted, yesterdayStats.submitted),
            connected: delta(todayStats.connected, yesterdayStats.connected),
          },
          thisWeek: twStats,
          lastWeek: lwStats,
          weekOverWeek: {
            submitted: delta(twStats.submitted, lwStats.submitted),
            connected: delta(twStats.connected, lwStats.connected),
          },
          thisMonth: tmStats,
          lastMonth: lmStats,
          priorMonth: pmStats,
          monthOverMonth: {
            submitted: delta(lmStats.submitted, pmStats.submitted),
            connected: delta(lmStats.connected, pmStats.connected),
          },
          dailyBreakdown,
          prevDailyBreakdown,
        };
      }).filter(u => u.today.submitted > 0 || u.yesterday.submitted > 0 || u.thisWeek.submitted > 0 || u.lastWeek.submitted > 0 || u.thisMonth.submitted > 0 || u.lastMonth.submitted > 0)
        .sort((a, b) => b.thisWeek.submitted - a.thisWeek.submitted);

      type TrackerKeys = "today" | "yesterday" | "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth" | "priorMonth";
      const sumStats = (arr: typeof trackerData, key: TrackerKeys) => ({
        submitted: arr.reduce((s, u) => s + u[key].submitted, 0),
        connected: arr.reduce((s, u) => s + u[key].connected, 0),
        approved: arr.reduce((s, u) => s + u[key].approved, 0),
      });

      const totals = {
        today: sumStats(trackerData, "today"),
        yesterday: sumStats(trackerData, "yesterday"),
        thisWeek: sumStats(trackerData, "thisWeek"),
        lastWeek: sumStats(trackerData, "lastWeek"),
        thisMonth: sumStats(trackerData, "thisMonth"),
        lastMonth: sumStats(trackerData, "lastMonth"),
        priorMonth: sumStats(trackerData, "priorMonth"),
      };

      const dailyTotals = dayLabels.map((label, i) => {
        const submitted = trackerData.reduce((s, u) => s + u.dailyBreakdown[i].submitted, 0);
        const connected = trackerData.reduce((s, u) => s + u.dailyBreakdown[i].connected, 0);
        const approved = trackerData.reduce((s, u) => s + u.dailyBreakdown[i].approved, 0);
        const date = trackerData.length > 0 ? trackerData[0].dailyBreakdown[i].date : "";
        return { day: label, date, submitted, connected, approved };
      });

      const prevDailyTotals = dayLabels.map((label, i) => {
        const submitted = trackerData.reduce((s, u) => s + u.prevDailyBreakdown[i].submitted, 0);
        const connected = trackerData.reduce((s, u) => s + u.prevDailyBreakdown[i].connected, 0);
        const approved = trackerData.reduce((s, u) => s + u.prevDailyBreakdown[i].approved, 0);
        const date = trackerData.length > 0 ? trackerData[0].prevDailyBreakdown[i].date : "";
        return { day: label, date, submitted, connected, approved };
      });

      const serviceMap = new Map(allServices.map(s => [s.id, s.name]));
      const serviceMixByDay = dayLabels.map((label, i) => {
        const dayStart = new Date(thisWeekStart);
        dayStart.setDate(dayStart.getDate() + i);
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);
        const dayOrders = orders.filter(o => inRange(o, dayStart, dayEnd));
        const mix: Record<string, number> = {};
        dayOrders.forEach(o => {
          const sName = serviceMap.get(o.serviceId) || "Unknown";
          mix[sName] = (mix[sName] || 0) + 1;
        });
        return { day: label, date: dayStart.toISOString().split("T")[0], mix };
      });

      const thisWeekOrders = orders.filter(o => inRange(o, thisWeekStart, thisWeekEnd));
      const weekServiceMix: Record<string, number> = {};
      thisWeekOrders.forEach(o => {
        const sName = serviceMap.get(o.serviceId) || "Unknown";
        weekServiceMix[sName] = (weekServiceMix[sName] || 0) + 1;
      });

      const periods = {
        today: todayStart.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }),
        yesterday: yesterdayStart.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }),
        thisWeek: { start: getWeekLabel(thisWeekStart), end: getWeekLabel(new Date(thisWeekEnd.getTime() - 86400000)) },
        lastWeek: { start: getWeekLabel(lastWeekStart), end: getWeekLabel(new Date(lastWeekEnd.getTime() - 86400000)) },
        thisMonth: now.toLocaleString("default", { month: "long", year: "numeric" }),
        lastMonth: new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleString("default", { month: "long", year: "numeric" }),
        priorMonth: new Date(now.getFullYear(), now.getMonth() - 2, 1).toLocaleString("default", { month: "long", year: "numeric" }),
      };

      res.json({ data: trackerData, totals, dailyTotals, prevDailyTotals, periods, serviceMixByDay, weekServiceMix });
    } catch (error) {
      console.error("Sales tracker report error:", error);
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

  app.get("/api/reports/user-activity", auth, async (req: AuthRequest, res) => {
    try {
      const { viewMode } = req.query;
      const user = req.user!;
      const now = new Date();

      const allOrders = await storage.getOrders({});
      const allUsers = await storage.getUsers();
      const { filteredOrders: orders } = await applyRoleBasedOrderFilter(allOrders, user, viewMode as string | undefined);

      const dow = now.getDay();
      const mondayOffset = dow === 0 ? -6 : 1 - dow;
      const thisWeekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);
      const thisWeekEnd = new Date(thisWeekStart);
      thisWeekEnd.setDate(thisWeekEnd.getDate() + 7);
      const lastWeekStart = new Date(thisWeekStart);
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);
      const lastWeekEnd = new Date(thisWeekStart);

      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(thisMonthStart);

      const getWeekLabel = (d: Date) => {
        const m = d.toLocaleString("default", { month: "short" });
        return `${m} ${d.getDate()}`;
      };

      const periods = {
        thisWeek: { start: getWeekLabel(thisWeekStart), end: getWeekLabel(new Date(thisWeekEnd.getTime() - 86400000)) },
        lastWeek: { start: getWeekLabel(lastWeekStart), end: getWeekLabel(new Date(lastWeekEnd.getTime() - 86400000)) },
        thisMonth: now.toLocaleString("default", { month: "long", year: "numeric" }),
        lastMonth: new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleString("default", { month: "long", year: "numeric" }),
      };

      const inRange = (o: any, s: Date, e: Date) => {
        const d = new Date(o.dateSold);
        return d >= s && d < e;
      };

      const repIds = [...new Set(orders.map(o => o.repId))];
      const userData = repIds.map(repId => {
        const repUser = allUsers.find(u => u.repId === repId && !u.deletedAt);
        const repOrders = orders.filter(o => o.repId === repId);

        const tw = repOrders.filter(o => inRange(o, thisWeekStart, thisWeekEnd));
        const lw = repOrders.filter(o => inRange(o, lastWeekStart, lastWeekEnd));
        const tm = repOrders.filter(o => inRange(o, thisMonthStart, thisMonthEnd));
        const lm = repOrders.filter(o => inRange(o, lastMonthStart, lastMonthEnd));

        const stats = (arr: typeof repOrders) => ({
          submitted: arr.length,
          connected: arr.filter(o => o.jobStatus === "COMPLETED").length,
        });

        const twStats = stats(tw);
        const lwStats = stats(lw);
        const tmStats = stats(tm);
        const lmStats = stats(lm);

        const delta = (curr: number, prev: number) => ({
          value: curr - prev,
          percent: prev > 0 ? Math.round(((curr - prev) / prev) * 100) : (curr > 0 ? 100 : 0),
        });

        return {
          repId,
          name: repUser?.name || repId,
          role: repUser?.role || "REP",
          thisWeek: twStats,
          lastWeek: lwStats,
          weekOverWeek: {
            submitted: delta(twStats.submitted, lwStats.submitted),
            connected: delta(twStats.connected, lwStats.connected),
          },
          thisMonth: tmStats,
          lastMonth: lmStats,
          monthOverMonth: {
            submitted: delta(tmStats.submitted, lmStats.submitted),
            connected: delta(tmStats.connected, lmStats.connected),
          },
        };
      }).filter(u => u.thisWeek.submitted > 0 || u.lastWeek.submitted > 0 || u.thisMonth.submitted > 0 || u.lastMonth.submitted > 0)
        .sort((a, b) => b.thisWeek.submitted - a.thisWeek.submitted);

      const totals = {
        thisWeek: { submitted: userData.reduce((s, u) => s + u.thisWeek.submitted, 0), connected: userData.reduce((s, u) => s + u.thisWeek.connected, 0) },
        lastWeek: { submitted: userData.reduce((s, u) => s + u.lastWeek.submitted, 0), connected: userData.reduce((s, u) => s + u.lastWeek.connected, 0) },
        thisMonth: { submitted: userData.reduce((s, u) => s + u.thisMonth.submitted, 0), connected: userData.reduce((s, u) => s + u.thisMonth.connected, 0) },
        lastMonth: { submitted: userData.reduce((s, u) => s + u.lastMonth.submitted, 0), connected: userData.reduce((s, u) => s + u.lastMonth.connected, 0) },
      };

      res.json({ data: userData, totals, periods });
    } catch (error) {
      console.error("User activity report error:", error);
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

  // Register object storage routes
  registerObjectStorageRoutes(app);

  // === Knowledge Documents API ===
  
  // Role hierarchy for access control
  const ROLE_HIERARCHY: Record<string, number> = {
    "REP": 1,
    "LEAD": 2,
    "MANAGER": 3,
    "EXECUTIVE": 4,
    "ADMIN": 5,
    "OPERATIONS": 6,
  };

  // Get all knowledge documents (filtered by user's role)
  app.get("/api/knowledge-documents", auth, async (req: AuthRequest, res) => {
    try {
      const userRole = req.user!.role;
      const userRoleLevel = ROLE_HIERARCHY[userRole] || 1;
      
      const allDocs = await storage.getKnowledgeDocuments();
      
      // Filter documents based on minimumRole requirement
      const visibleDocs = allDocs.filter(doc => {
        const docMinRole = doc.minimumRole || "REP";
        const docRoleLevel = ROLE_HIERARCHY[docMinRole] || 1;
        return userRoleLevel >= docRoleLevel;
      });
      
      res.json(visibleDocs);
    } catch (error) {
      console.error("Get knowledge documents error:", error);
      res.status(500).json({ message: "Failed to get documents" });
    }
  });

  // Get single knowledge document
  app.get("/api/knowledge-documents/:id", auth, async (req: AuthRequest, res) => {
    try {
      const doc = await storage.getKnowledgeDocumentById(req.params.id);
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }
      res.json(doc);
    } catch (error) {
      console.error("Get knowledge document error:", error);
      res.status(500).json({ message: "Failed to get document" });
    }
  });

  // Create knowledge document (after file is uploaded to object storage) - Manager+ only
  app.post("/api/knowledge-documents", auth, managerOrAdmin, async (req: AuthRequest, res) => {
    try {
      const validatedData = insertKnowledgeDocumentSchema.parse({
        ...req.body,
        uploadedById: req.user!.id,
      });
      
      const doc = await storage.createKnowledgeDocument(validatedData);
      
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "CREATE",
        tableName: "knowledge_documents",
        recordId: doc.id,
        afterJson: JSON.stringify({ title: doc.title, fileName: doc.fileName }),
      });
      
      res.status(201).json(doc);
    } catch (error) {
      console.error("Create knowledge document error:", error);
      res.status(500).json({ message: "Failed to create document" });
    }
  });

  // Update knowledge document metadata
  app.patch("/api/knowledge-documents/:id", auth, async (req: AuthRequest, res) => {
    try {
      const existing = await storage.getKnowledgeDocumentById(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      const { title, description, category, tags, minimumRole } = req.body;
      const doc = await storage.updateKnowledgeDocument(req.params.id, {
        title: title !== undefined ? title : existing.title,
        description: description !== undefined ? description : existing.description,
        category: category !== undefined ? category : existing.category,
        tags: tags !== undefined ? tags : existing.tags,
        minimumRole: minimumRole !== undefined ? minimumRole : existing.minimumRole,
      });
      
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "UPDATE",
        tableName: "knowledge_documents",
        recordId: doc!.id,
        afterJson: JSON.stringify({ title: doc!.title }),
      });
      
      res.json(doc);
    } catch (error) {
      console.error("Update knowledge document error:", error);
      res.status(500).json({ message: "Failed to update document" });
    }
  });

  // Seed reference data from bundled JSON (OPERATIONS only) - one-click sync
  app.post("/api/admin/seed-reference-data", auth, async (req: AuthRequest, res) => {
    try {
      if (req.user?.role !== "OPERATIONS") {
        return res.status(403).json({ message: "Only OPERATIONS can seed reference data" });
      }

      const referenceData = await import("./reference-data.json");
      const results = { users: 0, providers: 0, clients: 0, services: 0, rateCards: 0, errors: [] as string[] };

      // Step 0: Upsert users by repId (only sales roles, skip if already exists to preserve passwords)
      if (referenceData.users) {
        for (const u of referenceData.users) {
          try {
            // Only sync REP, LEAD, MANAGER, EXECUTIVE roles
            const salesRoles = ["REP", "LEAD", "MANAGER", "EXECUTIVE"];
            if (!salesRoles.includes(u.role)) continue;
            
            // Check if user exists by repId
            const existing = await db.select().from(users).where(eq(users.repId, u.repId)).limit(1);
            
            if (existing.length > 0) {
              // User exists - only update name and status, preserve password
              await db.update(users).set({ 
                name: u.name, 
                status: u.status as any,
                deletedAt: null, // Reactivate if soft-deleted
              }).where(eq(users.id, existing[0].id));
            } else {
              // Create new user with specified password hash
              await db.insert(users).values({
                id: u.id,
                name: u.name,
                repId: u.repId,
                role: u.role as any,
                status: u.status as any,
                passwordHash: u.passwordHash,
                mustChangePassword: u.mustChangePassword,
              });
            }
            results.users++;
          } catch (e) {
            results.errors.push(`User ${u.repId}: ${e}`);
          }
        }
      }

      // Build lookup maps for names -> IDs (to handle UUID mismatches between dev/prod)
      const providerNameToId: Record<string, string> = {};
      const clientNameToId: Record<string, string> = {};
      const serviceCodeToId: Record<string, string> = {};

      // Step 1: Upsert providers by name, track their IDs
      for (const p of referenceData.providers) {
        try {
          // Check if provider exists by name
          const existing = await db.select().from(providers).where(eq(providers.name, p.name)).limit(1);
          let providerId: string;
          
          if (existing.length > 0) {
            // Update existing provider
            await db.update(providers).set({ active: p.active }).where(eq(providers.id, existing[0].id));
            providerId = existing[0].id;
          } else {
            // Insert new provider with specified ID
            await db.insert(providers).values({ id: p.id, name: p.name, active: p.active });
            providerId = p.id;
          }
          providerNameToId[p.name] = providerId;
          results.providers++;
        } catch (e) {
          results.errors.push(`Provider ${p.name}: ${e}`);
        }
      }

      // Step 2: Upsert clients by name
      for (const c of referenceData.clients) {
        try {
          const existing = await db.select().from(clients).where(eq(clients.name, c.name)).limit(1);
          let clientId: string;
          
          if (existing.length > 0) {
            await db.update(clients).set({ active: c.active }).where(eq(clients.id, existing[0].id));
            clientId = existing[0].id;
          } else {
            await db.insert(clients).values({ id: c.id, name: c.name, active: c.active });
            clientId = c.id;
          }
          clientNameToId[c.name] = clientId;
          results.clients++;
        } catch (e) {
          results.errors.push(`Client ${c.name}: ${e}`);
        }
      }

      // Step 3: Upsert services by code
      for (const s of referenceData.services) {
        try {
          const existing = await db.select().from(services).where(eq(services.code, s.code)).limit(1);
          let serviceId: string;
          
          if (existing.length > 0) {
            await db.update(services).set({ 
              name: s.name, 
              category: s.category,
              unitType: s.unitType,
              active: s.active 
            }).where(eq(services.id, existing[0].id));
            serviceId = existing[0].id;
          } else {
            await db.insert(services).values({ 
              id: s.id, 
              code: s.code, 
              name: s.name, 
              category: s.category,
              unitType: s.unitType,
              active: s.active 
            });
            serviceId = s.id;
          }
          serviceCodeToId[s.code] = serviceId;
          results.services++;
        } catch (e) {
          results.errors.push(`Service ${s.code}: ${e}`);
        }
      }

      // Build reverse lookups from reference data to resolve foreign keys
      const refProviderIdToName: Record<string, string> = {};
      const refClientIdToName: Record<string, string> = {};
      const refServiceIdToCode: Record<string, string> = {};
      
      for (const p of referenceData.providers) refProviderIdToName[p.id] = p.name;
      for (const c of referenceData.clients) refClientIdToName[c.id] = c.name;
      for (const s of referenceData.services) refServiceIdToCode[s.id] = s.code;

      // Step 4: Insert rate cards with resolved foreign keys
      for (const r of referenceData.rateCards) {
        try {
          // Resolve foreign keys using name-based lookups
          const providerName = refProviderIdToName[r.providerId];
          const clientName = r.clientId ? refClientIdToName[r.clientId] : null;
          const serviceCode = r.serviceId ? refServiceIdToCode[r.serviceId] : null;
          
          const resolvedProviderId = providerName ? providerNameToId[providerName] : null;
          const resolvedClientId = clientName ? clientNameToId[clientName] : null;
          const resolvedServiceId = serviceCode ? serviceCodeToId[serviceCode] : null;
          
          if (!resolvedProviderId) {
            results.errors.push(`Rate card skipped: missing provider ${providerName}`);
            continue;
          }

          // Create unique key for upsert matching
          const rateCardData = {
            providerId: resolvedProviderId,
            clientId: resolvedClientId,
            serviceId: resolvedServiceId,
            mobileProductType: r.mobileProductType as any,
            mobilePortedStatus: r.mobilePortedStatus as any,
            effectiveStart: r.effectiveStart,
            active: r.active,
            baseAmount: String(r.baseAmount),
            tvAddonAmount: String(r.tvAddonAmount),
            mobilePerLineAmount: String(r.mobilePerLineAmount),
            overrideDeduction: String(r.overrideDeduction),
            tvOverrideDeduction: String(r.tvOverrideDeduction),
            mobileOverrideDeduction: String(r.mobileOverrideDeduction),
          };

          // Check for existing rate card with same key combination
          let whereConditions = [eq(rateCards.providerId, resolvedProviderId)];
          if (resolvedClientId) {
            whereConditions.push(eq(rateCards.clientId, resolvedClientId));
          } else {
            whereConditions.push(sql`${rateCards.clientId} IS NULL`);
          }
          if (resolvedServiceId) {
            whereConditions.push(eq(rateCards.serviceId, resolvedServiceId));
          } else {
            whereConditions.push(sql`${rateCards.serviceId} IS NULL`);
          }
          if (r.mobileProductType) {
            whereConditions.push(eq(rateCards.mobileProductType, r.mobileProductType as any));
          } else {
            whereConditions.push(sql`${rateCards.mobileProductType} IS NULL`);
          }
          if (r.mobilePortedStatus) {
            whereConditions.push(eq(rateCards.mobilePortedStatus, r.mobilePortedStatus as any));
          } else {
            whereConditions.push(sql`${rateCards.mobilePortedStatus} IS NULL`);
          }

          const existing = await db.select().from(rateCards).where(and(...whereConditions)).limit(1);
          
          if (existing.length > 0) {
            // Update existing rate card
            await db.update(rateCards).set({
              effectiveStart: r.effectiveStart,
              active: r.active,
              baseAmount: String(r.baseAmount),
              tvAddonAmount: String(r.tvAddonAmount),
              mobilePerLineAmount: String(r.mobilePerLineAmount),
              overrideDeduction: String(r.overrideDeduction),
              tvOverrideDeduction: String(r.tvOverrideDeduction),
              mobileOverrideDeduction: String(r.mobileOverrideDeduction),
            }).where(eq(rateCards.id, existing[0].id));
          } else {
            // Insert new rate card
            await db.insert(rateCards).values(rateCardData);
          }
          results.rateCards++;
        } catch (e) {
          results.errors.push(`Rate card: ${e}`);
        }
      }

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "SEED",
        tableName: "reference_data",
        recordId: "all",
        afterJson: JSON.stringify(results),
      });

      res.json({ message: "Reference data seeded successfully", results });
    } catch (error) {
      console.error("Seed reference data error:", error);
      res.status(500).json({ message: "Failed to seed reference data", error: String(error) });
    }
  });

  // Export reference data as SQL (OPERATIONS only) - for syncing to production
  app.get("/api/admin/export-reference-data", auth, async (req: AuthRequest, res) => {
    try {
      if (req.user?.role !== "OPERATIONS") {
        return res.status(403).json({ message: "Only OPERATIONS can export reference data" });
      }

      const providers = await storage.getProviders();
      const clients = await storage.getClients();
      const services = await storage.getServices();
      const rateCards = await storage.getRateCards();

      // Helper to escape SQL strings
      const esc = (val: string | null | undefined): string => {
        if (val === null || val === undefined) return '';
        return val.replace(/'/g, "''");
      };

      let sql = "-- Iron Crest CRM Reference Data Export\n";
      sql += `-- Generated: ${new Date().toISOString()}\n\n`;

      // Providers (omit timestamps - let target DB set them)
      sql += "-- PROVIDERS\n";
      for (const p of providers) {
        sql += `INSERT INTO providers (id, name, active) VALUES ('${p.id}', '${esc(p.name)}', ${p.active}) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, active = EXCLUDED.active;\n`;
      }

      // Clients
      sql += "\n-- CLIENTS\n";
      for (const c of clients) {
        sql += `INSERT INTO clients (id, name, active) VALUES ('${c.id}', '${esc(c.name)}', ${c.active}) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, active = EXCLUDED.active;\n`;
      }

      // Services
      sql += "\n-- SERVICES\n";
      for (const s of services) {
        sql += `INSERT INTO services (id, code, name, category, unit_type, active) VALUES ('${s.id}', '${esc(s.code)}', '${esc(s.name)}', '${esc(s.category)}', '${esc(s.unitType)}', ${s.active}) ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, category = EXCLUDED.category, unit_type = EXCLUDED.unit_type, active = EXCLUDED.active;\n`;
      }

      // Rate Cards - include ALL rate cards (active and deleted) with full metadata
      sql += "\n-- RATE CARDS (including deleted)\n";
      for (const r of rateCards) {
        const serviceId = r.serviceId ? `'${r.serviceId}'` : 'NULL';
        const clientId = r.clientId ? `'${r.clientId}'` : 'NULL';
        const mobileProductType = r.mobileProductType ? `'${esc(r.mobileProductType)}'` : 'NULL';
        const mobilePortedStatus = r.mobilePortedStatus ? `'${esc(r.mobilePortedStatus)}'` : 'NULL';
        const deletedAt = r.deletedAt ? `'${new Date(r.deletedAt).toISOString()}'` : 'NULL';
        const deletedByUserId = r.deletedByUserId ? `'${r.deletedByUserId}'` : 'NULL';
        sql += `INSERT INTO rate_cards (id, provider_id, client_id, service_id, effective_start, active, base_amount, tv_addon_amount, mobile_per_line_amount, mobile_product_type, mobile_ported_status, override_deduction, tv_override_deduction, mobile_override_deduction, deleted_at, deleted_by_user_id) VALUES ('${r.id}', '${r.providerId}', ${clientId}, ${serviceId}, '${r.effectiveStart}', ${r.active}, ${r.baseAmount}, ${r.tvAddonAmount}, ${r.mobilePerLineAmount}, ${mobileProductType}, ${mobilePortedStatus}, ${r.overrideDeduction}, ${r.tvOverrideDeduction}, ${r.mobileOverrideDeduction}, ${deletedAt}, ${deletedByUserId}) ON CONFLICT (id) DO UPDATE SET service_id = EXCLUDED.service_id, client_id = EXCLUDED.client_id, effective_start = EXCLUDED.effective_start, active = EXCLUDED.active, base_amount = EXCLUDED.base_amount, tv_addon_amount = EXCLUDED.tv_addon_amount, mobile_per_line_amount = EXCLUDED.mobile_per_line_amount, mobile_product_type = EXCLUDED.mobile_product_type, mobile_ported_status = EXCLUDED.mobile_ported_status, override_deduction = EXCLUDED.override_deduction, tv_override_deduction = EXCLUDED.tv_override_deduction, mobile_override_deduction = EXCLUDED.mobile_override_deduction, deleted_at = EXCLUDED.deleted_at, deleted_by_user_id = EXCLUDED.deleted_by_user_id;\n`;
      }

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "EXPORT",
        tableName: "reference_data",
        recordId: "all",
        afterJson: JSON.stringify({ providers: providers.length, clients: clients.length, services: services.length, rateCards: rateCards.length }),
      });

      res.setHeader("Content-Type", "text/plain");
      res.setHeader("Content-Disposition", "attachment; filename=reference-data-export.sql");
      res.send(sql);
    } catch (error) {
      console.error("Export reference data error:", error);
      res.status(500).json({ message: "Failed to export reference data" });
    }
  });

  // Soft delete knowledge document (Admin/Manager only)
  app.delete("/api/knowledge-documents/:id", auth, managerOrAdmin, async (req: AuthRequest, res) => {
    try {
      const existing = await storage.getKnowledgeDocumentById(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      await storage.softDeleteKnowledgeDocument(req.params.id, req.user!.id);
      
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "DELETE",
        tableName: "knowledge_documents",
        recordId: req.params.id,
        beforeJson: JSON.stringify({ title: existing.title, fileName: existing.fileName }),
      });
      
      res.json({ message: "Document deleted" });
    } catch (error) {
      console.error("Delete knowledge document error:", error);
      res.status(500).json({ message: "Failed to delete document" });
    }
  });

  // ================== PAYROLL SYSTEM API ==================

  // Payroll Schedules
  app.get("/api/admin/payroll/schedules", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const schedules = await storage.getPayrollSchedules();
      res.json(schedules);
    } catch (error) { res.status(500).json({ message: "Failed to get schedules" }); }
  });

  app.post("/api/admin/payroll/schedules", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const schedule = await storage.createPayrollSchedule(req.body);
      await storage.createAuditLog({ action: "create_payroll_schedule", tableName: "payroll_schedules", recordId: schedule.id, afterJson: JSON.stringify(req.body), userId: req.user!.id });
      res.json(schedule);
    } catch (error) { res.status(500).json({ message: "Failed to create schedule" }); }
  });

  app.put("/api/admin/payroll/schedules/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const schedule = await storage.updatePayrollSchedule(req.params.id, req.body);
      await storage.createAuditLog({ action: "update_payroll_schedule", tableName: "payroll_schedules", recordId: req.params.id, afterJson: JSON.stringify(req.body), userId: req.user!.id });
      res.json(schedule);
    } catch (error) { res.status(500).json({ message: "Failed to update schedule" }); }
  });

  app.delete("/api/admin/payroll/schedules/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      await storage.deletePayrollSchedule(req.params.id);
      await storage.createAuditLog({ action: "delete_payroll_schedule", tableName: "payroll_schedules", recordId: req.params.id, userId: req.user!.id });
      res.json({ message: "Schedule deleted" });
    } catch (error) { res.status(500).json({ message: "Failed to delete schedule" }); }
  });

  // Deduction Types
  app.get("/api/admin/payroll/deduction-types", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const types = await storage.getDeductionTypes();
      res.json(types);
    } catch (error) { res.status(500).json({ message: "Failed to get deduction types" }); }
  });

  app.post("/api/admin/payroll/deduction-types", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const type = await storage.createDeductionType(req.body);
      await storage.createAuditLog({ action: "create_deduction_type", tableName: "deduction_types", recordId: type.id, afterJson: JSON.stringify(req.body), userId: req.user!.id });
      res.json(type);
    } catch (error) { res.status(500).json({ message: "Failed to create deduction type" }); }
  });

  app.put("/api/admin/payroll/deduction-types/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const type = await storage.updateDeductionType(req.params.id, req.body);
      await storage.createAuditLog({ action: "update_deduction_type", tableName: "deduction_types", recordId: req.params.id, afterJson: JSON.stringify(req.body), userId: req.user!.id });
      res.json(type);
    } catch (error) { res.status(500).json({ message: "Failed to update deduction type" }); }
  });

  app.delete("/api/admin/payroll/deduction-types/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      await storage.deleteDeductionType(req.params.id);
      await storage.createAuditLog({ action: "delete_deduction_type", tableName: "deduction_types", recordId: req.params.id, userId: req.user!.id });
      res.json({ message: "Deduction type deleted" });
    } catch (error) { res.status(500).json({ message: "Failed to delete deduction type" }); }
  });

  // User Deductions
  app.get("/api/admin/payroll/user-deductions", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const userId = req.query.userId as string | undefined;
      if (userId) {
        const deductions = await storage.getUserDeductions(userId);
        res.json(deductions);
      } else {
        const deductions = await storage.getAllActiveUserDeductions();
        res.json(deductions);
      }
    } catch (error) { res.status(500).json({ message: "Failed to get user deductions" }); }
  });

  app.post("/api/admin/payroll/user-deductions", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const deduction = await storage.createUserDeduction(req.body);
      await storage.createAuditLog({ action: "create_user_deduction", tableName: "user_deductions", recordId: deduction.id, afterJson: JSON.stringify(req.body), userId: req.user!.id });
      res.json(deduction);
    } catch (error) { res.status(500).json({ message: "Failed to create user deduction" }); }
  });

  app.put("/api/admin/payroll/user-deductions/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const deduction = await storage.updateUserDeduction(req.params.id, req.body);
      await storage.createAuditLog({ action: "update_user_deduction", tableName: "user_deductions", recordId: req.params.id, afterJson: JSON.stringify(req.body), userId: req.user!.id });
      res.json(deduction);
    } catch (error) { res.status(500).json({ message: "Failed to update user deduction" }); }
  });

  app.delete("/api/admin/payroll/user-deductions/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      await storage.deleteUserDeduction(req.params.id);
      await storage.createAuditLog({ action: "delete_user_deduction", tableName: "user_deductions", recordId: req.params.id, userId: req.user!.id });
      res.json({ message: "User deduction deleted" });
    } catch (error) { res.status(500).json({ message: "Failed to delete user deduction" }); }
  });

  // Advances
  app.get("/api/admin/payroll/advances", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const status = req.query.status as string | undefined;
      if (status === "pending") {
        const advances = await storage.getPendingAdvances();
        res.json(advances);
      } else {
        const advances = await storage.getAdvances();
        res.json(advances);
      }
    } catch (error) { res.status(500).json({ message: "Failed to get advances" }); }
  });

  app.get("/api/admin/payroll/advances/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const advance = await storage.getAdvanceById(req.params.id);
      if (!advance) return res.status(404).json({ message: "Advance not found" });
      const repayments = await storage.getAdvanceRepayments(req.params.id);
      res.json({ ...advance, repayments });
    } catch (error) { res.status(500).json({ message: "Failed to get advance" }); }
  });

  app.post("/api/admin/payroll/advances", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const advance = await storage.createAdvance(req.body);
      await storage.createAuditLog({ action: "create_advance", tableName: "advances", recordId: advance.id, afterJson: JSON.stringify(req.body), userId: req.user!.id });
      res.json(advance);
    } catch (error) { res.status(500).json({ message: "Failed to create advance" }); }
  });

  app.post("/api/admin/payroll/advances/:id/approve", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { approvedAmount, notes } = req.body;
      const advance = await storage.approveAdvance(req.params.id, req.user!.id, approvedAmount, notes);
      await storage.createAuditLog({ action: "approve_advance", tableName: "advances", recordId: req.params.id, afterJson: JSON.stringify({ approvedAmount, notes }), userId: req.user!.id });
      res.json(advance);
    } catch (error) { res.status(500).json({ message: "Failed to approve advance" }); }
  });

  app.post("/api/admin/payroll/advances/:id/reject", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { notes } = req.body;
      const advance = await storage.rejectAdvance(req.params.id, req.user!.id, notes);
      await storage.createAuditLog({ action: "reject_advance", tableName: "advances", recordId: req.params.id, afterJson: JSON.stringify({ notes }), userId: req.user!.id });
      res.json(advance);
    } catch (error) { res.status(500).json({ message: "Failed to reject advance" }); }
  });

  app.post("/api/admin/payroll/advances/:id/mark-paid", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const advance = await storage.markAdvancePaid(req.params.id);
      await storage.createAuditLog({ action: "mark_advance_paid", tableName: "advances", recordId: req.params.id, userId: req.user!.id });
      res.json(advance);
    } catch (error) { res.status(500).json({ message: "Failed to mark advance paid" }); }
  });

  // Rep can request an advance
  app.post("/api/payroll/advances/request", auth, async (req: AuthRequest, res) => {
    try {
      const advance = await storage.createAdvance({ 
        userId: req.user!.id, 
        requestedAmount: req.body.requestedAmount,
        reason: req.body.reason,
        repaymentPercentage: req.body.repaymentPercentage || "100"
      });
      await storage.createAuditLog({ action: "request_advance", tableName: "advances", recordId: advance.id, afterJson: JSON.stringify(req.body), userId: req.user!.id });
      res.json(advance);
    } catch (error) { res.status(500).json({ message: "Failed to request advance" }); }
  });

  // Rep can view their own advances
  app.get("/api/payroll/my-advances", auth, async (req: AuthRequest, res) => {
    try {
      const advances = await storage.getAdvancesByUser(req.user!.id);
      res.json(advances);
    } catch (error) { res.status(500).json({ message: "Failed to get advances" }); }
  });

  // User Tax Profiles
  app.get("/api/admin/payroll/tax-profiles", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const profiles = await storage.getAllUserTaxProfiles();
      res.json(profiles);
    } catch (error) { res.status(500).json({ message: "Failed to get tax profiles" }); }
  });

  app.get("/api/admin/payroll/tax-profiles/:userId", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const profile = await storage.getUserTaxProfile(req.params.userId);
      res.json(profile || {});
    } catch (error) { res.status(500).json({ message: "Failed to get tax profile" }); }
  });

  app.put("/api/admin/payroll/tax-profiles/:userId", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const profile = await storage.updateUserTaxProfile(req.params.userId, req.body);
      await storage.createAuditLog({ action: "update_tax_profile", tableName: "user_tax_profiles", recordId: req.params.userId, afterJson: JSON.stringify(req.body), userId: req.user!.id });
      res.json(profile);
    } catch (error) { res.status(500).json({ message: "Failed to update tax profile" }); }
  });

  // User Payment Methods
  app.get("/api/admin/payroll/payment-methods/:userId", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const methods = await storage.getUserPaymentMethods(req.params.userId);
      res.json(methods);
    } catch (error) { res.status(500).json({ message: "Failed to get payment methods" }); }
  });

  app.post("/api/admin/payroll/payment-methods", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const method = await storage.createUserPaymentMethod(req.body);
      await storage.createAuditLog({ action: "create_payment_method", tableName: "user_payment_methods", recordId: method.id, afterJson: JSON.stringify({ ...req.body, accountLastFour: req.body.accountLastFour }), userId: req.user!.id });
      res.json(method);
    } catch (error) { res.status(500).json({ message: "Failed to create payment method" }); }
  });

  app.put("/api/admin/payroll/payment-methods/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const method = await storage.updateUserPaymentMethod(req.params.id, req.body);
      await storage.createAuditLog({ action: "update_payment_method", tableName: "user_payment_methods", recordId: req.params.id, afterJson: JSON.stringify(req.body), userId: req.user!.id });
      res.json(method);
    } catch (error) { res.status(500).json({ message: "Failed to update payment method" }); }
  });

  app.delete("/api/admin/payroll/payment-methods/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      await storage.deleteUserPaymentMethod(req.params.id);
      await storage.createAuditLog({ action: "delete_payment_method", tableName: "user_payment_methods", recordId: req.params.id, userId: req.user!.id });
      res.json({ message: "Payment method deleted" });
    } catch (error) { res.status(500).json({ message: "Failed to delete payment method" }); }
  });

  // Rep can manage their own payment methods
  app.get("/api/payroll/my-payment-methods", auth, async (req: AuthRequest, res) => {
    try {
      const methods = await storage.getUserPaymentMethods(req.user!.id);
      res.json(methods);
    } catch (error) { res.status(500).json({ message: "Failed to get payment methods" }); }
  });

  app.post("/api/payroll/my-payment-methods", auth, async (req: AuthRequest, res) => {
    try {
      const method = await storage.createUserPaymentMethod({ ...req.body, userId: req.user!.id });
      res.json(method);
    } catch (error) { res.status(500).json({ message: "Failed to create payment method" }); }
  });

  // Pay Statements
  app.get("/api/admin/payroll/statements", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const payRunId = req.query.payRunId as string | undefined;
      const statements = await storage.getPayStatements(payRunId);
      res.json(statements);
    } catch (error) { res.status(500).json({ message: "Failed to get statements" }); }
  });

  app.get("/api/admin/payroll/statements/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const statement = await storage.getPayStatementById(req.params.id);
      if (!statement) return res.status(404).json({ message: "Statement not found" });
      const lineItems = await storage.getPayStatementLineItems(req.params.id);
      const deductions = await storage.getPayStatementDeductions(req.params.id);
      res.json({ ...statement, lineItems, deductions });
    } catch (error) { res.status(500).json({ message: "Failed to get statement" }); }
  });

  // Generate pay statements for a pay run
  app.post("/api/admin/payroll/payruns/:payRunId/generate-statements", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const payRun = await storage.getPayRunById(req.params.payRunId);
      if (!payRun) return res.status(404).json({ message: "Pay run not found" });
      
      // Delete existing statements for this pay run (allows regeneration)
      const existingStatements = await storage.getPayStatements(req.params.payRunId);
      for (const stmt of existingStatements) {
        if (stmt.status === "PAID" || stmt.status === "ISSUED") continue;
        await storage.deletePayStatementLineItems(stmt.id);
        await storage.deletePayStatementDeductions(stmt.id);
        await storage.deletePayStatement(stmt.id);
      }

      // Get all orders in this pay run grouped by repId
      const orders = await storage.getOrdersByPayRunId(req.params.payRunId);
      const chargebacks = await storage.getChargebacksByPayRun(req.params.payRunId);
      
      // Group by repId
      const ordersByRep = new Map<string, any[]>();
      const chargebacksByRep = new Map<string, any[]>();
      
      for (const order of orders) {
        if (!ordersByRep.has(order.repId)) ordersByRep.set(order.repId, []);
        ordersByRep.get(order.repId)!.push(order);
      }
      
      for (const cb of chargebacks) {
        if (!chargebacksByRep.has(cb.repId)) chargebacksByRep.set(cb.repId, []);
        chargebacksByRep.get(cb.repId)!.push(cb);
      }
      
      const allRepIds = new Set([...Array.from(ordersByRep.keys()), ...Array.from(chargebacksByRep.keys())]);
      const statements: any[] = [];
      const currentYear = new Date().getFullYear();
      
      for (const repId of Array.from(allRepIds)) {
        const user = await storage.getUserByRepId(repId);
        if (!user) continue;
        
        const repOrders = ordersByRep.get(repId) || [];
        const repChargebacks = chargebacksByRep.get(repId) || [];
        
        // Calculate totals
        let grossCommission = 0;
        let incentivesTotal = 0;
        let chargebacksTotal = 0;
        
        for (const order of repOrders) {
          grossCommission += parseFloat(order.baseCommissionEarned || "0");
          incentivesTotal += parseFloat(order.incentiveEarned || "0");
        }
        
        for (const cb of repChargebacks) {
          chargebacksTotal += parseFloat(cb.amount || "0");
        }
        
        // Get override earnings for this user in this pay run
        const overrideEarnings = await storage.getOverrideEarningsByPayRun(req.params.payRunId, user.id);
        let overrideEarningsTotal = 0;
        for (const oe of overrideEarnings) {
          overrideEarningsTotal += parseFloat(oe.amount || "0");
        }
        
        // Get active deductions for this user
        const userDeductions = await storage.getActiveUserDeductions(user.id);
        let deductionsTotal = 0;
        const deductionDetails: { userDeductionId?: string; deductionTypeName: string; amount: string }[] = [];
        
        for (const ud of userDeductions) {
          const deductionType = await storage.getDeductionTypeById(ud.deductionTypeId);
          const deductionAmount = parseFloat(ud.amount || "0");
          deductionsTotal += deductionAmount;
          deductionDetails.push({
            userDeductionId: ud.id,
            deductionTypeName: deductionType?.name || "Unknown",
            amount: deductionAmount.toFixed(2)
          });
        }
        
        // Get active advances to apply
        const activeAdvances = await storage.getActiveAdvancesForUser(user.id);
        let advancesApplied = 0;
        
        // Get YTD totals
        const ytd = await storage.getYTDTotalsForUser(user.id, currentYear);
        
        // Calculate net pay
        const grossTotal = grossCommission + incentivesTotal + overrideEarningsTotal;
        const netPay = grossTotal - chargebacksTotal - deductionsTotal - advancesApplied;
        
        // Calculate pay period start (7 days before week ending)
        const weekEnd = new Date(payRun.weekEndingDate + "T00:00:00");
        const weekStart = new Date(weekEnd);
        weekStart.setDate(weekStart.getDate() - 6);
        const periodStartStr = weekStart.toISOString().split("T")[0];

        // Create pay statement
        const statement = await storage.createPayStatement({
          payRunId: req.params.payRunId,
          userId: user.id,
          periodStart: periodStartStr,
          periodEnd: payRun.weekEndingDate,
          grossCommission: grossCommission.toFixed(2),
          overrideEarningsTotal: overrideEarningsTotal.toFixed(2),
          incentivesTotal: incentivesTotal.toFixed(2),
          chargebacksTotal: chargebacksTotal.toFixed(2),
          adjustmentsTotal: "0",
          deductionsTotal: deductionsTotal.toFixed(2),
          advancesApplied: advancesApplied.toFixed(2),
          taxWithheld: "0",
          netPay: netPay.toFixed(2),
          ytdGross: (parseFloat(ytd.totalGross) + grossTotal).toFixed(2),
          ytdDeductions: (parseFloat(ytd.totalDeductions) + deductionsTotal).toFixed(2),
          ytdNetPay: (parseFloat(ytd.totalNetPay) + netPay).toFixed(2),
        });
        
        // Create line items for orders
        for (const order of repOrders) {
          await storage.createPayStatementLineItem({
            payStatementId: statement.id,
            category: "Commission",
            description: `Order ${order.invoiceNumber || order.id} - ${order.customerName || ""}`.trim(),
            sourceType: "sales_order",
            sourceId: order.id,
            amount: order.baseCommissionEarned,
          });
          
          const incentiveAmt = parseFloat(order.incentiveEarned || "0");
          if (incentiveAmt > 0) {
            await storage.createPayStatementLineItem({
              payStatementId: statement.id,
              category: "Incentive",
              description: `Incentive - Order ${order.invoiceNumber || order.id}`,
              sourceType: "sales_order",
              sourceId: order.id,
              amount: order.incentiveEarned,
            });
          }
        }
        
        // Create line items for chargebacks
        for (const cb of repChargebacks) {
          await storage.createPayStatementLineItem({
            payStatementId: statement.id,
            category: "Chargeback",
            description: `Chargeback ${cb.invoiceNumber}`,
            sourceType: "chargeback",
            sourceId: cb.id,
            amount: `-${cb.amount}`,
          });
        }
        
        // Create deduction records
        for (const ded of deductionDetails) {
          await storage.createPayStatementDeduction({
            payStatementId: statement.id,
            userDeductionId: ded.userDeductionId,
            deductionTypeName: ded.deductionTypeName,
            amount: ded.amount,
          });
        }
        
        statements.push(statement);
      }
      
      await storage.createAuditLog({ 
        action: "generate_pay_statements", 
        tableName: "pay_statements", 
        recordId: req.params.payRunId, 
        afterJson: JSON.stringify({ count: statements.length }), 
        userId: req.user!.id 
      });
      
      res.json({ generated: statements.length, statements });
    } catch (error: any) {
      console.error("Generate statements error:", error);
      res.status(500).json({ message: error.message || "Failed to generate statements" });
    }
  });

  // Generate weekly pay stubs from PAID orders
  app.post("/api/admin/payroll/generate-weekly-stubs", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const bodySchema = z.object({
        weekEndingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format, expected YYYY-MM-DD")
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }
      const { weekEndingDate } = parsed.data;
      
      // Calculate week start (7 days before week ending)
      const endDate = new Date(weekEndingDate);
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 6);
      
      const periodStart = startDate.toISOString().split("T")[0];
      const periodEnd = endDate.toISOString().split("T")[0];
      
      // Get all PAID orders with install date within this date range
      const allOrders = await storage.getOrders({});
      const paidOrders = allOrders.filter(order => {
        if (order.paymentStatus !== "PAID") return false;
        if (!order.installDate) return false;
        const installDate = new Date(order.installDate);
        return installDate >= startDate && installDate <= endDate;
      });
      
      if (paidOrders.length === 0) {
        return res.json({ generated: 0, message: "No paid orders found in this period", statements: [] });
      }
      
      // Create a pay run for these weekly stubs
      const payRun = await storage.createPayRun({
        name: `Weekly Pay Stubs - ${periodEnd}`,
        weekEndingDate: periodEnd,
        payDate: periodEnd,
        status: "FINALIZED",
        createdByUserId: req.user!.id,
      });
      
      // Group orders by rep
      const ordersByRep: Record<string, typeof paidOrders> = {};
      for (const order of paidOrders) {
        if (!ordersByRep[order.repId]) ordersByRep[order.repId] = [];
        ordersByRep[order.repId].push(order);
      }
      
      const statements: any[] = [];
      const currentYear = new Date().getFullYear();
      
      for (const [repId, repOrders] of Object.entries(ordersByRep)) {
        const user = await storage.getUserByRepId(repId);
        if (!user) continue;
        
        // Calculate gross commission from paid orders
        let grossCommission = 0;
        let incentivesTotal = 0;
        for (const order of repOrders) {
          grossCommission += parseFloat(order.baseCommissionEarned);
          incentivesTotal += parseFloat(order.incentiveEarned || "0");
        }
        
        // Get chargebacks in this period for this rep
        const allChargebacks = await storage.getChargebacks();
        let chargebacksTotal = 0;
        for (const cb of allChargebacks) {
          if (cb.repId !== repId) continue;
          const cbDate = cb.chargebackDate ? new Date(cb.chargebackDate) : null;
          if (cbDate && cbDate >= startDate && cbDate <= endDate) {
            chargebacksTotal += parseFloat(cb.amount || "0");
          }
        }
        
        // Weekly pay stubs exclude override earnings - they are handled separately
        // Override deductions were already applied when calculating baseCommissionEarned on orders
        
        // Get active deductions
        const userDeductions = await storage.getActiveUserDeductions(user.id);
        let deductionsTotal = 0;
        const deductionDetails: { userDeductionId?: string; deductionTypeName: string; amount: string }[] = [];
        for (const ud of userDeductions) {
          const deductionType = await storage.getDeductionTypeById(ud.deductionTypeId);
          const deductionAmount = parseFloat(ud.amount || "0");
          deductionsTotal += deductionAmount;
          deductionDetails.push({
            userDeductionId: ud.id,
            deductionTypeName: deductionType?.name || "Unknown",
            amount: deductionAmount.toFixed(2)
          });
        }
        
        // Get YTD totals
        const ytd = await storage.getYTDTotalsForUser(user.id, currentYear);
        
        // Calculate net pay (excluding override earnings - they are handled separately)
        const grossTotal = grossCommission + incentivesTotal;
        const netPay = grossTotal - chargebacksTotal - deductionsTotal;
        
        // Create pay statement (override earnings excluded from weekly stubs)
        const statement = await storage.createPayStatement({
          payRunId: payRun.id,
          userId: user.id,
          periodStart,
          periodEnd,
          grossCommission: grossCommission.toFixed(2),
          overrideEarningsTotal: "0",
          incentivesTotal: incentivesTotal.toFixed(2),
          chargebacksTotal: chargebacksTotal.toFixed(2),
          adjustmentsTotal: "0",
          deductionsTotal: deductionsTotal.toFixed(2),
          advancesApplied: "0",
          taxWithheld: "0",
          netPay: netPay.toFixed(2),
          status: "ISSUED",
          ytdGross: (parseFloat(ytd.totalGross) + grossTotal).toFixed(2),
          ytdDeductions: (parseFloat(ytd.totalDeductions) + deductionsTotal).toFixed(2),
          ytdNetPay: (parseFloat(ytd.totalNetPay) + netPay).toFixed(2),
        });
        
        // Issue the statement immediately
        await storage.issuePayStatement(statement.id);
        
        // Create line items for each paid order
        for (const order of repOrders) {
          await storage.createPayStatementLineItem({
            payStatementId: statement.id,
            category: "Commission",
            description: `Order ${order.invoiceNumber || order.id} - ${order.customerName}`,
            sourceType: "sales_order",
            sourceId: order.id,
            amount: order.baseCommissionEarned,
          });
          
          if (parseFloat(order.incentiveEarned || "0") > 0) {
            await storage.createPayStatementLineItem({
              payStatementId: statement.id,
              category: "Incentive",
              description: `Incentive for ${order.invoiceNumber || order.id}`,
              sourceType: "sales_order",
              sourceId: order.id,
              amount: order.incentiveEarned,
            });
          }
        }
        
        // Create deduction records
        for (const ded of deductionDetails) {
          await storage.createPayStatementDeduction({
            payStatementId: statement.id,
            userDeductionId: ded.userDeductionId,
            deductionTypeName: ded.deductionTypeName,
            amount: ded.amount,
          });
        }
        
        statements.push({
          ...statement,
          user: { id: user.id, name: user.name, repId: user.repId }
        });
      }
      
      await storage.createAuditLog({
        action: "generate_weekly_pay_stubs",
        tableName: "pay_statements",
        recordId: payRun.id,
        afterJson: JSON.stringify({ count: statements.length, periodStart, periodEnd }),
        userId: req.user!.id,
      });
      
      res.json({ 
        generated: statements.length, 
        payRunId: payRun.id,
        periodStart,
        periodEnd,
        statements 
      });
    } catch (error: any) {
      console.error("Generate weekly stubs error:", error);
      res.status(500).json({ message: error.message || "Failed to generate weekly pay stubs" });
    }
  });

  // Export pay stub as Excel in the specific format
  app.get("/api/admin/payroll/statements/:id/export-excel", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const statement = await storage.getPayStatementById(req.params.id);
      if (!statement) return res.status(404).json({ message: "Statement not found" });
      
      const user = await storage.getUserById(statement.userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      
      const lineItems = await storage.getPayStatementLineItems(req.params.id);
      const deductions = await storage.getPayStatementDeductions(req.params.id);
      
      // Get orders from line items (they store sourceId = order.id)
      const orders: SalesOrder[] = [];
      for (const item of lineItems) {
        if (item.sourceType === "sales_order" && item.sourceId) {
          const order = await storage.getOrderById(item.sourceId);
          if (order && !orders.find(o => o.id === order.id)) {
            orders.push(order);
          }
        }
      }
      
      // Get clients, providers, services for order details
      const clients = await storage.getClients();
      const services = await storage.getServices();
      const providers = await storage.getProviders();
      
      // Build Excel content as CSV
      const rows: string[][] = [];
      
      // Header section
      rows.push(["Pay Statement"]);
      rows.push(["Rep Name", user.name]);
      rows.push(["Rep ID", user.repId]);
      rows.push(["Period", `${statement.periodStart} - ${statement.periodEnd}`]);
      rows.push(["Company", "Iron Crest"]);
      rows.push([]);
      
      // Summary section
      rows.push(["Summary"]);
      const grossCommission = parseFloat(statement.grossCommission);
      const incentives = parseFloat(statement.incentivesTotal);
      const chargebacks = parseFloat(statement.chargebacksTotal);
      const deductionTotal = parseFloat(statement.deductionsTotal);
      const netPay = parseFloat(statement.netPay);
      
      rows.push(["Gross Commission", "$" + grossCommission.toFixed(2)]);
      rows.push(["Incentives", "$" + incentives.toFixed(2)]);
      rows.push(["Chargebacks", "-$" + chargebacks.toFixed(2)]);
      rows.push(["Deductions", "-$" + deductionTotal.toFixed(2)]);
      rows.push(["Net Pay", "$" + netPay.toFixed(2)]);
      rows.push([]);
      
      // Deductions breakdown
      if (deductions.length > 0) {
        rows.push(["Deductions Breakdown"]);
        rows.push(["Reason", "Amount"]);
        for (const ded of deductions) {
          rows.push([ded.deductionTypeName || "Deduction", "-$" + parseFloat(ded.amount).toFixed(2)]);
        }
        rows.push([]);
      }
      
      // Order Details section
      rows.push(["Order Details"]);
      rows.push(["Invoice Number", "Rep ID", "Account Number", "Service", "Provider", "Install Date", "Net Commission"]);
      
      for (const order of orders) {
        const service = services.find(s => s.id === order.serviceId);
        const provider = providers.find(p => p.id === order.providerId);
        const netCommission = parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned || "0") - parseFloat(order.overrideDeduction || "0");
        
        rows.push([
          order.invoiceNumber,
          user.repId,
          order.accountNumber || "",
          service?.name || "N/A",
          provider?.name || "N/A",
          order.installDate || order.dateSold,
          "$" + netCommission.toFixed(2)
        ]);
      }
      
      // Convert to CSV
      const csvContent = rows.map(row => row.map(cell => `"${(cell || "").toString().replace(/"/g, '""')}"`).join(",")).join("\n");
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="pay_statement_${user.repId}_${statement.periodEnd}.csv"`);
      res.send(csvContent);
    } catch (error: any) {
      console.error("Export pay stub error:", error);
      res.status(500).json({ message: error.message || "Failed to export pay stub" });
    }
  });

  // Issue a pay statement
  app.post("/api/admin/payroll/statements/:id/issue", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const statement = await storage.issuePayStatement(req.params.id);
      await storage.createAuditLog({ action: "issue_pay_statement", tableName: "pay_statements", recordId: req.params.id, userId: req.user!.id });
      res.json(statement);
    } catch (error) { res.status(500).json({ message: "Failed to issue statement" }); }
  });

  // Mark statement as paid
  app.post("/api/admin/payroll/statements/:id/mark-paid", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { paymentMethodId, paymentReference } = req.body;
      const statement = await storage.markPayStatementPaid(req.params.id, paymentMethodId, paymentReference);
      await storage.createAuditLog({ action: "mark_statement_paid", tableName: "pay_statements", recordId: req.params.id, afterJson: JSON.stringify({ paymentMethodId, paymentReference }), userId: req.user!.id });
      res.json(statement);
    } catch (error) { res.status(500).json({ message: "Failed to mark statement paid" }); }
  });

  // Void a pay statement
  app.post("/api/admin/payroll/statements/:id/void", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const statement = await storage.voidPayStatement(req.params.id);
      await storage.createAuditLog({ action: "void_pay_statement", tableName: "pay_statements", recordId: req.params.id, userId: req.user!.id });
      res.json(statement);
    } catch (error) { res.status(500).json({ message: "Failed to void statement" }); }
  });

  // Rep can view their own pay statements
  app.get("/api/payroll/my-statements", auth, async (req: AuthRequest, res) => {
    try {
      const statements = await storage.getPayStatementsByUser(req.user!.id);
      res.json(statements);
    } catch (error) { res.status(500).json({ message: "Failed to get statements" }); }
  });

  app.get("/api/payroll/my-statements/:id", auth, async (req: AuthRequest, res) => {
    try {
      const statement = await storage.getPayStatementById(req.params.id);
      if (!statement) return res.status(404).json({ message: "Statement not found" });
      if (statement.userId !== req.user!.id) return res.status(403).json({ message: "Access denied" });
      const lineItems = await storage.getPayStatementLineItems(req.params.id);
      const deductions = await storage.getPayStatementDeductions(req.params.id);
      res.json({ ...statement, lineItems, deductions });
    } catch (error) { res.status(500).json({ message: "Failed to get statement" }); }
  });

  // PDF download for pay statement
  app.get("/api/payroll/my-statements/:id/pdf", auth, async (req: AuthRequest, res) => {
    try {
      const { generatePayStatementPdf } = await import("./pdf-generator");
      const statement = await storage.getPayStatementById(req.params.id);
      if (!statement) return res.status(404).json({ message: "Statement not found" });
      if (statement.userId !== req.user!.id) return res.status(403).json({ message: "Access denied" });
      
      const lineItems = await storage.getPayStatementLineItems(req.params.id);
      const deductions = await storage.getPayStatementDeductions(req.params.id);
      const user = await storage.getUserById(req.user!.id);
      if (!user) return res.status(404).json({ message: "User not found" });

      const pdfBuffer = await generatePayStatementPdf({
        statement,
        lineItems,
        deductions,
        user,
        companyName: "Iron Crest CRM",
      });

      const periodStart = new Date(statement.periodStart).toISOString().split("T")[0];
      const periodEnd = new Date(statement.periodEnd).toISOString().split("T")[0];
      const filename = `PayStatement_${user.repId}_${periodStart}_${periodEnd}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (error) {
      console.error("PDF generation error:", error);
      res.status(500).json({ message: "Failed to generate PDF" });
    }
  });

  // Excel download for pay statement (rep can download their own)
  app.get("/api/payroll/my-statements/:id/excel", auth, async (req: AuthRequest, res) => {
    try {
      const statement = await storage.getPayStatementById(req.params.id);
      if (!statement) return res.status(404).json({ message: "Statement not found" });
      if (statement.userId !== req.user!.id) return res.status(403).json({ message: "Access denied" });
      
      const user = await storage.getUserById(req.user!.id);
      if (!user) return res.status(404).json({ message: "User not found" });
      
      const lineItems = await storage.getPayStatementLineItems(req.params.id);
      const deductions = await storage.getPayStatementDeductions(req.params.id);
      
      // Get orders from line items (they store sourceId = order.id)
      const orders: SalesOrder[] = [];
      for (const item of lineItems) {
        if (item.sourceType === "sales_order" && item.sourceId) {
          const order = await storage.getOrderById(item.sourceId);
          if (order && !orders.find(o => o.id === order.id)) {
            orders.push(order);
          }
        }
      }
      
      // Get clients, providers, services for order details
      const clients = await storage.getClients();
      const services = await storage.getServices();
      const providers = await storage.getProviders();
      
      // Build Excel content as CSV
      const rows: string[][] = [];
      
      // Header section
      rows.push(["Pay Statement"]);
      rows.push(["Rep Name", user.name]);
      rows.push(["Rep ID", user.repId]);
      rows.push(["Period", `${statement.periodStart} - ${statement.periodEnd}`]);
      rows.push(["Company", "Iron Crest"]);
      rows.push([]);
      
      // Summary section
      rows.push(["Summary"]);
      const grossCommission = parseFloat(statement.grossCommission);
      const incentives = parseFloat(statement.incentivesTotal);
      const chargebacks = parseFloat(statement.chargebacksTotal);
      const deductionTotal = parseFloat(statement.deductionsTotal);
      const netPay = parseFloat(statement.netPay);
      
      rows.push(["Gross Commission", "$" + grossCommission.toFixed(2)]);
      rows.push(["Incentives", "$" + incentives.toFixed(2)]);
      rows.push(["Chargebacks", "-$" + chargebacks.toFixed(2)]);
      rows.push(["Deductions", "-$" + deductionTotal.toFixed(2)]);
      rows.push(["Net Pay", "$" + netPay.toFixed(2)]);
      rows.push([]);
      
      // Deductions breakdown
      if (deductions.length > 0) {
        rows.push(["Deductions Breakdown"]);
        rows.push(["Reason", "Amount"]);
        for (const ded of deductions) {
          rows.push([ded.deductionTypeName || "Deduction", "-$" + parseFloat(ded.amount).toFixed(2)]);
        }
        rows.push([]);
      }
      
      // Order Details section
      rows.push(["Order Details"]);
      rows.push(["Invoice Number", "Rep ID", "Account Number", "Service", "Provider", "Install Date", "Net Commission"]);
      
      for (const order of orders) {
        const service = services.find(s => s.id === order.serviceId);
        const provider = providers.find(p => p.id === order.providerId);
        const netCommission = parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned || "0") - parseFloat(order.overrideDeduction || "0");
        
        rows.push([
          order.invoiceNumber,
          user.repId,
          order.accountNumber || "",
          service?.name || "N/A",
          provider?.name || "N/A",
          order.installDate || order.dateSold,
          "$" + netCommission.toFixed(2)
        ]);
      }
      
      // Convert to CSV
      const csvContent = rows.map(row => row.map(cell => `"${(cell || "").toString().replace(/"/g, '""')}"`).join(",")).join("\n");
      
      const periodEnd = new Date(statement.periodEnd).toISOString().split("T")[0];
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="PayStatement_${user.repId}_${periodEnd}.csv"`);
      res.send(csvContent);
    } catch (error: any) {
      console.error("Excel export error:", error);
      res.status(500).json({ message: error.message || "Failed to export Excel" });
    }
  });

  // Rep can view their YTD totals
  app.get("/api/payroll/my-ytd", auth, async (req: AuthRequest, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const ytd = await storage.getYTDTotalsForUser(req.user!.id, year);
      res.json(ytd);
    } catch (error) { res.status(500).json({ message: "Failed to get YTD totals" }); }
  });

  // Payroll Reports
  app.get("/api/admin/payroll/reports/summary", auth, executiveOrAdmin, async (req: AuthRequest, res) => {
    try {
      const statements = await storage.getPayStatements();
      const totalGross = statements.reduce((sum, s) => sum + parseFloat(s.grossCommission || "0"), 0);
      const totalNet = statements.reduce((sum, s) => sum + parseFloat(s.netPay || "0"), 0);
      const totalDeductions = statements.reduce((sum, s) => sum + parseFloat(s.deductionsTotal || "0"), 0);
      const paid = statements.filter(s => s.status === "PAID").length;
      const pending = statements.filter(s => s.status === "DRAFT" || s.status === "ISSUED").length;
      
      res.json({
        totalStatements: statements.length,
        totalGross: totalGross.toFixed(2),
        totalNet: totalNet.toFixed(2),
        totalDeductions: totalDeductions.toFixed(2),
        paidCount: paid,
        pendingCount: pending,
      });
    } catch (error) { res.status(500).json({ message: "Failed to get summary" }); }
  });

  app.get("/api/admin/payroll/reports/by-user", auth, executiveOrAdmin, async (req: AuthRequest, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const users = await storage.getActiveUsers();
      const report = [];
      
      for (const user of users) {
        const ytd = await storage.getYTDTotalsForUser(user.id, year);
        report.push({
          userId: user.id,
          repId: user.repId,
          name: user.name,
          role: user.role,
          ytdGross: ytd.totalGross,
          ytdDeductions: ytd.totalDeductions,
          ytdNetPay: ytd.totalNetPay,
        });
      }
      
      res.json(report);
    } catch (error) { res.status(500).json({ message: "Failed to get report" }); }
  });

  // Pay Run Approvals
  app.get("/api/admin/payroll/payruns/:payRunId/approvals", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const approvals = await storage.getPayRunApprovals(req.params.payRunId);
      res.json(approvals);
    } catch (error) { res.status(500).json({ message: "Failed to get approvals" }); }
  });

  app.post("/api/admin/payroll/payruns/:payRunId/approvals", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const approval = await storage.createPayRunApproval({
        payRunId: req.params.payRunId,
        roleRequired: req.body.roleRequired,
      });
      res.json(approval);
    } catch (error) { res.status(500).json({ message: "Failed to create approval" }); }
  });

  app.post("/api/admin/payroll/approvals/:id/decide", auth, managerOrAdmin, async (req: AuthRequest, res) => {
    try {
      const { status, notes } = req.body;
      const approval = await storage.updatePayRunApproval(req.params.id, {
        approverId: req.user!.id,
        status,
        notes,
      });
      await storage.createAuditLog({ 
        action: `payrun_approval_${status.toLowerCase()}`, 
        tableName: "pay_run_approvals", 
        recordId: req.params.id, 
        afterJson: JSON.stringify({ status, notes }), 
        userId: req.user!.id 
      });
      res.json(approval);
    } catch (error) { res.status(500).json({ message: "Failed to update approval" }); }
  });

  // ============ QuickBooks Integration Routes ============
  
  // Get QuickBooks connection status
  app.get("/api/admin/quickbooks/status", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const connection = await qb.getConnection();
      const mappings = await qb.getAccountMappings();
      
      res.json({
        isConnected: connection?.isConnected || false,
        companyName: connection?.companyName || null,
        realmId: connection?.realmId || null,
        lastSyncAt: connection?.lastSyncAt || null,
        accessTokenExpiresAt: connection?.accessTokenExpiresAt || null,
        accountMappings: mappings,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get QuickBooks status" });
    }
  });

  // Get QuickBooks OAuth authorization URL (returns JSON)
  app.get("/api/admin/quickbooks/authorize", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const userId = req.user!.id;
      const nonce = crypto.randomBytes(8).toString("hex");
      const payload = `${userId}:${nonce}`;
      const secret = process.env.QB_CLIENT_SECRET;
      if (!secret) {
        return res.status(500).json({ message: "QuickBooks not configured" });
      }
      const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex").substring(0, 16);
      const state = Buffer.from(`${payload}:${signature}`).toString("base64url");
      const authUrl = qb.getAuthorizationUrl(state);
      res.json({ authUrl, state });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get authorization URL" });
    }
  });

  // Direct redirect to QuickBooks OAuth (no auth required for redirect)
  app.get("/api/quickbooks/connect", async (req, res) => {
    try {
      const qb = await import("./quickbooks");
      const state = crypto.randomBytes(16).toString("hex");
      const authUrl = qb.getAuthorizationUrl(state);
      res.redirect(authUrl);
    } catch (error: any) {
      res.status(500).send("Failed to connect to QuickBooks: " + error.message);
    }
  });

  // QuickBooks OAuth callback
  app.get("/api/auth/quickbooks/callback", async (req, res) => {
    try {
      const { code, realmId, state } = req.query;
      console.log("QuickBooks callback received:", { code: code ? "present" : "missing", realmId, state });
      
      if (!code || !realmId || !state) {
        return res.status(400).send("Missing authorization code, realm ID, or state");
      }

      const secret = process.env.QB_CLIENT_SECRET;
      if (!secret) {
        return res.status(500).send("QuickBooks not configured");
      }

      let userId: string;
      try {
        const decoded = Buffer.from(state as string, "base64url").toString();
        console.log("Decoded state:", decoded);
        const parts = decoded.split(":");
        if (parts.length !== 3) {
          throw new Error("Invalid state format");
        }
        const [uid, nonce, receivedSig] = parts;
        const payload = `${uid}:${nonce}`;
        const expectedSig = crypto.createHmac("sha256", secret).update(payload).digest("hex").substring(0, 16);
        console.log("State validation:", { uid, receivedSig, expectedSig, match: receivedSig === expectedSig });
        if (receivedSig !== expectedSig) {
          throw new Error("Invalid state signature");
        }
        userId = uid;
      } catch (e: any) {
        console.error("State validation error:", e.message);
        return res.status(400).send("Invalid or tampered state parameter");
      }

      console.log("Calling exchangeCodeForTokens with userId:", userId);
      const qb = await import("./quickbooks");
      await qb.exchangeCodeForTokens(code as string, realmId as string, userId);
      
      // Redirect back to QuickBooks admin page
      res.redirect("/admin/quickbooks?connected=true");
    } catch (error: any) {
      console.error("QuickBooks callback error:", error);
      res.status(500).send(`QuickBooks connection failed: ${error.message}`);
    }
  });

  // Disconnect QuickBooks
  app.post("/api/admin/quickbooks/disconnect", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      await qb.disconnectQuickBooks();
      await storage.createAuditLog({
        action: "quickbooks_disconnected",
        tableName: "quickbooks_connection",
        recordId: "system",
        userId: req.user!.id,
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to disconnect" });
    }
  });

  // Get QuickBooks accounts for mapping
  app.get("/api/admin/quickbooks/accounts", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const accounts = await qb.fetchQBAccounts();
      res.json(accounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch accounts" });
    }
  });

  // Save account mapping
  app.post("/api/admin/quickbooks/mappings", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { mappingType, qbAccountId, qbAccountName, qbAccountType } = req.body;
      
      if (!mappingType || !qbAccountId || !qbAccountName) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const qb = await import("./quickbooks");
      await qb.saveAccountMapping(mappingType, qbAccountId, qbAccountName, qbAccountType || "");
      
      await storage.createAuditLog({
        action: "quickbooks_mapping_saved",
        tableName: "quickbooks_account_mappings",
        recordId: mappingType,
        afterJson: JSON.stringify({ mappingType, qbAccountId, qbAccountName }),
        userId: req.user!.id,
      });
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to save mapping" });
    }
  });

  // Sync order invoice to QuickBooks
  app.post("/api/admin/quickbooks/sync-invoice/:orderId", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const result = await qb.syncInvoiceToQuickBooks(req.params.orderId, req.user!.id);
      
      if (result.success) {
        await storage.createAuditLog({
          action: "quickbooks_invoice_synced",
          tableName: "sales_orders",
          recordId: req.params.orderId,
          afterJson: JSON.stringify({ qbInvoiceId: result.qbInvoiceId }),
          userId: req.user!.id,
        });
      }
      
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Post pay run journal entry to QuickBooks
  app.post("/api/admin/quickbooks/post-journal/:payRunId", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const result = await qb.postPayRunJournalEntry(req.params.payRunId, req.user!.id);
      
      if (result.success) {
        await storage.createAuditLog({
          action: "quickbooks_journal_posted",
          tableName: "pay_runs",
          recordId: req.params.payRunId,
          afterJson: JSON.stringify({ qbJournalEntryId: result.qbJournalEntryId }),
          userId: req.user!.id,
        });
      }
      
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get QuickBooks sync logs
  app.get("/api/admin/quickbooks/sync-logs", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const entityType = req.query.entityType as string | undefined;
      const limit = parseInt(req.query.limit as string) || 50;
      const logs = await qb.getSyncLogs(entityType, limit);
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get sync logs" });
    }
  });

  // Retry failed sync
  app.post("/api/admin/quickbooks/retry/:syncLogId", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const result = await qb.retryFailedSync(req.params.syncLogId, req.user!.id);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Bulk sync approved orders to QuickBooks
  app.post("/api/admin/quickbooks/bulk-sync-invoices", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      
      // Get all approved orders without QB invoice ID
      const ordersToSync = await db.query.salesOrders.findMany({
        where: and(
          eq(salesOrders.jobStatus, "COMPLETED"),
          sql`${salesOrders.qbInvoiceId} IS NULL`
        ),
      });
      
      const results = {
        total: ordersToSync.length,
        synced: 0,
        failed: 0,
        errors: [] as string[],
      };
      
      for (const order of ordersToSync) {
        const result = await qb.syncInvoiceToQuickBooks(order.id, req.user!.id);
        if (result.success) {
          results.synced++;
        } else {
          results.failed++;
          results.errors.push(`Order ${order.invoiceNumber}: ${result.error}`);
        }
      }
      
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get exception queue (failed syncs with enriched details)
  app.get("/api/admin/quickbooks/exception-queue", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const limit = parseInt(req.query.limit as string) || 50;
      const exceptions = await qb.getExceptionQueue(limit);
      res.json(exceptions);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get exception queue" });
    }
  });

  // Get reconciliation data
  app.get("/api/admin/quickbooks/reconciliation", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const data = await qb.getReconciliationData();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get reconciliation data" });
    }
  });

  // Get sync health metrics
  app.get("/api/admin/quickbooks/health", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const metrics = await qb.getSyncHealthMetrics();
      res.json(metrics);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get health metrics" });
    }
  });

  // Get environment info
  app.get("/api/admin/quickbooks/environment", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const envInfo = qb.getEnvironmentInfo();
      res.json(envInfo);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get environment info" });
    }
  });

  // Get audit logs
  app.get("/api/admin/quickbooks/audit-logs", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const limit = parseInt(req.query.limit as string) || 100;
      const logs = qb.getQBAuditLogs(limit);
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get audit logs" });
    }
  });

  // Fetch QB classes
  app.get("/api/admin/quickbooks/classes", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const classes = await qb.fetchQBClasses();
      res.json(classes);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch QB classes" });
    }
  });

  // Fetch QB departments
  app.get("/api/admin/quickbooks/departments", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const departments = await qb.fetchQBDepartments();
      res.json(departments);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch QB departments" });
    }
  });

  // Fetch QB items
  app.get("/api/admin/quickbooks/items", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const items = await qb.fetchQBItems();
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch QB items" });
    }
  });

  // Sync payment statuses
  app.post("/api/admin/quickbooks/sync-payments", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const result = await qb.syncPaymentStatuses();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Save advanced mapping
  app.post("/api/admin/quickbooks/advanced-mappings", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const { mappingType, qbId, qbName, qbAccountType } = req.body;
      await qb.saveAdvancedMapping(mappingType, qbId, qbName, { qbAccountType });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ========== NEW PAYROLL FEATURES ROUTES ==========

  // Tax Documents (1099s)
  app.get("/api/admin/tax-documents", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const filters: any = {};
      if (req.query.userId) filters.userId = req.query.userId as string;
      if (req.query.taxYear) filters.taxYear = parseInt(req.query.taxYear as string);
      if (req.query.status) filters.status = req.query.status as string;
      const docs = await storage.getTaxDocuments(filters);
      res.json(docs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/tax-documents/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const doc = await storage.getTaxDocumentById(req.params.id);
      if (!doc) return res.status(404).json({ message: "Tax document not found" });
      res.json(doc);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/tax-documents/generate-data/:year", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const taxYear = parseInt(req.params.year);
      const data = await storage.generate1099DataForYear(taxYear);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/tax-documents", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const doc = await storage.createTaxDocument({
        ...req.body,
        createdByUserId: req.user!.id,
      });
      await storage.createAuditLog({
        action: "tax_document_created",
        tableName: "tax_documents",
        recordId: doc.id,
        afterJson: JSON.stringify(doc),
        userId: req.user!.id,
      });
      res.status(201).json(doc);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/tax-documents/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const doc = await storage.updateTaxDocument(req.params.id, req.body);
      await storage.createAuditLog({
        action: "tax_document_updated",
        tableName: "tax_documents",
        recordId: req.params.id,
        afterJson: JSON.stringify(doc),
        userId: req.user!.id,
      });
      res.json(doc);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Bulk generate 1099s for a tax year
  app.post("/api/admin/tax-documents/bulk-generate/:year", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const taxYear = parseInt(req.params.year);
      const data = await storage.generate1099DataForYear(taxYear);
      const results = { created: 0, skipped: 0, errors: [] as string[] };

      for (const row of data) {
        try {
          const existing = await storage.getTaxDocuments({ userId: row.userId, taxYear });
          if (existing.length > 0) {
            results.skipped++;
            continue;
          }

          const taxProfile = await storage.getUserTaxProfile(row.userId);
          
          await storage.createTaxDocument({
            userId: row.userId,
            taxYear,
            documentType: "1099_NEC",
            status: "DRAFT",
            totalEarnings: row.totalEarnings,
            recipientName: row.userName,
            recipientTin: taxProfile?.taxIdLastFour || null,
            recipientAddress: taxProfile?.businessAddress || null,
            recipientCity: null,
            recipientState: null,
            recipientZip: null,
            createdByUserId: req.user!.id,
          });
          results.created++;
        } catch (err: any) {
          results.errors.push(`${row.userName}: ${err.message}`);
        }
      }

      res.json(results);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // User Bank Accounts (ACH)
  app.get("/api/admin/bank-accounts", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const userId = req.query.userId as string;
      if (!userId) return res.status(400).json({ message: "userId required" });
      const accounts = await storage.getUserBankAccounts(userId);
      res.json(accounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/bank-accounts", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { userId, accountHolderName, bankName, accountType, routingNumber, accountNumber, isPrimary } = req.body;
      
      if (!userId || !accountHolderName || !bankName || !accountType || !routingNumber || !accountNumber) {
        return res.status(400).json({ message: "All fields are required" });
      }
      
      if (routingNumber.length !== 9) {
        return res.status(400).json({ message: "Routing number must be 9 digits" });
      }
      
      const accountNumberLast4 = accountNumber.slice(-4);
      const accountNumberEncrypted = accountNumber;
      
      const account = await storage.createUserBankAccount({
        userId,
        accountHolderName,
        bankName,
        accountType,
        routingNumber,
        accountNumberLast4,
        accountNumberEncrypted,
        isPrimary: isPrimary !== false,
      });
      
      await storage.createAuditLog({
        action: "bank_account_created",
        tableName: "user_bank_accounts",
        recordId: account.id,
        userId: req.user!.id,
      });
      res.status(201).json(account);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/admin/bank-accounts/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      await storage.deactivateUserBankAccount(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ACH Exports
  app.get("/api/admin/ach-exports", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const filters: any = {};
      if (req.query.status) filters.status = req.query.status;
      if (req.query.payRunId) filters.payRunId = req.query.payRunId;
      const exports = await storage.getAchExports(filters);
      res.json(exports);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/ach-exports/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const exp = await storage.getAchExportById(req.params.id);
      if (!exp) return res.status(404).json({ message: "ACH export not found" });
      const items = await storage.getAchExportItems(req.params.id);
      res.json({ ...exp, items });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/ach-exports/generate/:payRunId", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const payRun = await storage.getPayRunById(req.params.payRunId);
      if (!payRun) return res.status(404).json({ message: "Pay run not found" });
      if (payRun.status !== "FINALIZED") return res.status(400).json({ message: "Pay run must be finalized" });

      const statements = await storage.getPayStatements(req.params.payRunId);
      
      let totalAmount = 0;
      const validStatements = [];

      for (const stmt of statements) {
        const bankAccount = await storage.getPrimaryBankAccount(stmt.userId);
        if (bankAccount) {
          totalAmount += parseFloat(stmt.netPay);
          validStatements.push({ statement: stmt, bankAccount });
        }
      }

      if (validStatements.length === 0) {
        return res.status(400).json({ message: "No users with bank accounts found" });
      }

      const batchNumber = await storage.generateAchBatchNumber();
      const effectiveDate = new Date();
      effectiveDate.setDate(effectiveDate.getDate() + 2);

      const achExport = await storage.createAchExport({
        payRunId: req.params.payRunId,
        batchNumber,
        status: "PENDING",
        totalAmount: totalAmount.toFixed(2),
        transactionCount: validStatements.length,
        effectiveDate: effectiveDate.toISOString().slice(0, 10),
        createdByUserId: req.user!.id,
      });

      for (const { statement, bankAccount } of validStatements) {
        await storage.createAchExportItem({
          achExportId: achExport.id,
          payStatementId: statement.id,
          userId: statement.userId,
          bankAccountId: bankAccount.id,
          amount: statement.netPay,
          status: "PENDING",
        });
      }

      await storage.createAuditLog({
        action: "ach_export_created",
        tableName: "ach_exports",
        recordId: achExport.id,
        afterJson: JSON.stringify({ batchNumber, totalAmount, count: validStatements.length }),
        userId: req.user!.id,
      });

      res.status(201).json(achExport);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/ach-exports/:id/status", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { status } = req.body;
      const exp = await storage.updateAchExport(req.params.id, { 
        status,
        ...(status === "SENT" && { sentAt: new Date() }),
        ...(status === "COMPLETED" && { completedAt: new Date() }),
      });
      res.json(exp);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Payment Reconciliation
  app.get("/api/admin/payment-reconciliations", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const filters: any = {};
      if (req.query.status) filters.status = req.query.status;
      if (req.query.userId) filters.userId = req.query.userId;
      const recs = await storage.getPaymentReconciliations(filters);
      res.json(recs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/payment-reconciliations", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const rec = await storage.createPaymentReconciliation(req.body);
      res.status(201).json(rec);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/payment-reconciliations/:id/match", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { paidAmount, paymentReference } = req.body;
      const rec = await storage.matchPaymentReconciliation(
        req.params.id, 
        paidAmount, 
        paymentReference,
        req.user!.id
      );
      res.json(rec);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Bonuses/SPIFFs
  app.get("/api/admin/bonuses", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const filters: any = {};
      if (req.query.userId) filters.userId = req.query.userId;
      if (req.query.status) filters.status = req.query.status;
      if (req.query.bonusType) filters.bonusType = req.query.bonusType;
      const bonusList = await storage.getBonuses(filters);
      res.json(bonusList);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/bonuses/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const bonus = await storage.getBonusById(req.params.id);
      if (!bonus) return res.status(404).json({ message: "Bonus not found" });
      res.json(bonus);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/bonuses", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const bonus = await storage.createBonus({
        ...req.body,
        createdByUserId: req.user!.id,
      });
      await storage.createAuditLog({
        action: "bonus_created",
        tableName: "bonuses",
        recordId: bonus.id,
        afterJson: JSON.stringify(bonus),
        userId: req.user!.id,
      });
      res.status(201).json(bonus);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/bonuses/:id/approve", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const bonus = await storage.approveBonus(req.params.id, req.user!.id);
      await storage.createAuditLog({
        action: "bonus_approved",
        tableName: "bonuses",
        recordId: req.params.id,
        userId: req.user!.id,
      });
      res.json(bonus);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/bonuses/:id/cancel", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { reason } = req.body;
      const bonus = await storage.cancelBonus(req.params.id, reason);
      res.json(bonus);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Draw Accounts
  app.get("/api/admin/draw-accounts", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const filters: any = {};
      if (req.query.userId) filters.userId = req.query.userId;
      if (req.query.status) filters.status = req.query.status;
      const accounts = await storage.getDrawAccounts(filters);
      res.json(accounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/draw-accounts/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const account = await storage.getDrawAccountById(req.params.id);
      if (!account) return res.status(404).json({ message: "Draw account not found" });
      const transactions = await storage.getDrawTransactions(req.params.id);
      res.json({ ...account, transactions });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/draw-accounts", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const account = await storage.createDrawAccount({
        ...req.body,
        createdByUserId: req.user!.id,
      });
      await storage.createAuditLog({
        action: "draw_account_created",
        tableName: "draw_accounts",
        recordId: account.id,
        afterJson: JSON.stringify(account),
        userId: req.user!.id,
      });
      res.status(201).json(account);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/draw-accounts/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const account = await storage.updateDrawAccount(req.params.id, req.body);
      res.json(account);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Split Commission Agreements
  app.get("/api/admin/split-agreements", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const filters: any = {};
      if (req.query.primaryRepId) filters.primaryRepId = req.query.primaryRepId;
      if (req.query.isActive !== undefined) filters.isActive = req.query.isActive === "true";
      const agreements = await storage.getSplitAgreements(filters);
      res.json(agreements);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/split-agreements/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const agreement = await storage.getSplitAgreementById(req.params.id);
      if (!agreement) return res.status(404).json({ message: "Agreement not found" });
      const recipients = await storage.getSplitRecipients(req.params.id);
      res.json({ ...agreement, recipients });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/split-agreements", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { recipients, ...agreementData } = req.body;
      const agreement = await storage.createSplitAgreement({
        ...agreementData,
        createdByUserId: req.user!.id,
      });

      if (recipients && Array.isArray(recipients)) {
        for (const recipient of recipients) {
          await storage.createSplitRecipient({
            agreementId: agreement.id,
            userId: recipient.userId,
            splitType: recipient.splitType,
            splitValue: recipient.splitValue,
          });
        }
      }

      await storage.createAuditLog({
        action: "split_agreement_created",
        tableName: "split_commission_agreements",
        recordId: agreement.id,
        afterJson: JSON.stringify({ ...agreement, recipients }),
        userId: req.user!.id,
      });

      res.status(201).json(agreement);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/split-agreements/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { recipients, ...agreementData } = req.body;
      const agreement = await storage.updateSplitAgreement(req.params.id, agreementData);

      if (recipients && Array.isArray(recipients)) {
        await storage.deleteSplitRecipients(req.params.id);
        for (const recipient of recipients) {
          await storage.createSplitRecipient({
            agreementId: req.params.id,
            userId: recipient.userId,
            splitType: recipient.splitType,
            splitValue: recipient.splitValue,
          });
        }
      }

      res.json(agreement);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Commission Tiers
  app.get("/api/admin/commission-tiers", auth, adminOnly, async (req: AuthRequest, res) => {
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

  app.get("/api/admin/commission-tiers/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const tier = await storage.getCommissionTierById(req.params.id);
      if (!tier) return res.status(404).json({ message: "Tier not found" });
      const levels = await storage.getTierLevels(req.params.id);
      res.json({ ...tier, levels });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/commission-tiers", auth, adminOnly, async (req: AuthRequest, res) => {
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

  app.patch("/api/admin/commission-tiers/:id", auth, adminOnly, async (req: AuthRequest, res) => {
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

  // Rep Tier Assignments
  app.get("/api/admin/rep-tier-assignments/:userId", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const assignments = await storage.getRepTierAssignments(req.params.userId);
      res.json(assignments);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/rep-tier-assignments", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const assignment = await storage.createRepTierAssignment({
        ...req.body,
        createdByUserId: req.user!.id,
      });
      res.status(201).json(assignment);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/admin/rep-tier-assignments/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      await storage.deleteRepTierAssignment(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Scheduled Pay Runs
  app.get("/api/admin/scheduled-pay-runs", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const schedules = await storage.getScheduledPayRuns();
      res.json(schedules);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/scheduled-pay-runs/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const schedule = await storage.getScheduledPayRunById(req.params.id);
      if (!schedule) return res.status(404).json({ message: "Schedule not found" });
      res.json(schedule);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/scheduled-pay-runs", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const schedule = await storage.createScheduledPayRun({
        ...req.body,
        createdByUserId: req.user!.id,
      });
      await storage.createAuditLog({
        action: "scheduled_pay_run_created",
        tableName: "scheduled_pay_runs",
        recordId: schedule.id,
        afterJson: JSON.stringify(schedule),
        userId: req.user!.id,
      });
      res.status(201).json(schedule);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/scheduled-pay-runs/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const schedule = await storage.updateScheduledPayRun(req.params.id, req.body);
      res.json(schedule);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/admin/scheduled-pay-runs/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      await storage.deleteScheduledPayRun(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Commission Forecasts
  app.get("/api/admin/commission-forecasts", auth, executiveOrAdmin, async (req: AuthRequest, res) => {
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

  app.get("/api/admin/commission-forecasts/calculate/:userId", auth, executiveOrAdmin, async (req: AuthRequest, res) => {
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

  // Payroll Reports Dashboard
  app.get("/api/admin/payroll-reports/summary", auth, executiveOrAdmin, async (req: AuthRequest, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const startOfYear = `${year}-01-01`;
      const endOfYear = `${year}-12-31`;

      const monthlyTotals = await db.select({
        month: sql<number>`EXTRACT(MONTH FROM ${payStatements.periodEnd})`,
        totalGross: sql<string>`COALESCE(SUM(${payStatements.grossCommission} + ${payStatements.overrideEarningsTotal} + ${payStatements.incentivesTotal}), 0)`,
        totalDeductions: sql<string>`COALESCE(SUM(${payStatements.deductionsTotal}), 0)`,
        totalNetPay: sql<string>`COALESCE(SUM(${payStatements.netPay}), 0)`,
        statementCount: sql<number>`COUNT(*)`,
      })
      .from(payStatements)
      .where(and(
        gte(payStatements.periodEnd, startOfYear),
        lte(payStatements.periodEnd, endOfYear),
        inArray(payStatements.status, ["ISSUED", "PAID"])
      ))
      .groupBy(sql`EXTRACT(MONTH FROM ${payStatements.periodEnd})`)
      .orderBy(sql`EXTRACT(MONTH FROM ${payStatements.periodEnd})`);

      const topEarners = await db.select({
        userId: payStatements.userId,
        userName: users.name,
        totalNetPay: sql<string>`COALESCE(SUM(${payStatements.netPay}), 0)`,
      })
      .from(payStatements)
      .innerJoin(users, eq(payStatements.userId, users.id))
      .where(and(
        gte(payStatements.periodEnd, startOfYear),
        lte(payStatements.periodEnd, endOfYear),
        inArray(payStatements.status, ["ISSUED", "PAID"])
      ))
      .groupBy(payStatements.userId, users.name)
      .orderBy(sql`SUM(${payStatements.netPay}) DESC`)
      .limit(10);

      const ytdTotals = await db.select({
        totalGross: sql<string>`COALESCE(SUM(${payStatements.grossCommission} + ${payStatements.overrideEarningsTotal} + ${payStatements.incentivesTotal}), 0)`,
        totalDeductions: sql<string>`COALESCE(SUM(${payStatements.deductionsTotal}), 0)`,
        totalNetPay: sql<string>`COALESCE(SUM(${payStatements.netPay}), 0)`,
        totalBonuses: sql<string>`COALESCE(SUM(${payStatements.adjustmentsTotal}), 0)`,
        statementCount: sql<number>`COUNT(*)`,
      })
      .from(payStatements)
      .where(and(
        gte(payStatements.periodEnd, startOfYear),
        lte(payStatements.periodEnd, endOfYear),
        inArray(payStatements.status, ["ISSUED", "PAID"])
      ));

      res.json({
        year,
        monthlyTotals,
        topEarners,
        ytdTotals: ytdTotals[0],
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/payroll-reports/deductions", auth, executiveOrAdmin, async (req: AuthRequest, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const startOfYear = `${year}-01-01`;
      const endOfYear = `${year}-12-31`;

      const deductionsByType = await db.select({
        deductionTypeName: payStatementDeductions.deductionTypeName,
        totalAmount: sql<string>`COALESCE(SUM(${payStatementDeductions.amount}), 0)`,
        count: sql<number>`COUNT(*)`,
      })
      .from(payStatementDeductions)
      .innerJoin(payStatements, eq(payStatementDeductions.payStatementId, payStatements.id))
      .where(and(
        gte(payStatements.periodEnd, startOfYear),
        lte(payStatements.periodEnd, endOfYear)
      ))
      .groupBy(payStatementDeductions.deductionTypeName)
      .orderBy(sql`SUM(${payStatementDeductions.amount}) DESC`);

      res.json({ year, deductionsByType });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Executive Reports - Sales Overview
  app.get("/api/executive/sales-overview", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      // EXECUTIVE, ADMIN, OPERATIONS, MANAGER access
      if (!["EXECUTIVE", "ADMIN", "OPERATIONS", "MANAGER"].includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthStartStr = monthStart.toISOString().split('T')[0];

      // Role-based order scoping
      let allOrders: any[] = [];
      if (user.role === "ADMIN" || user.role === "OPERATIONS") {
        allOrders = await storage.getOrders({});
      } else if (user.role === "EXECUTIVE") {
        const scope = await storage.getExecutiveScope(user.id);
        const teamRepIds = [...scope.allRepRepIds, user.repId];
        allOrders = await storage.getOrders({ teamRepIds });
      } else if (user.role === "MANAGER") {
        const scope = await storage.getManagerScope(user.id);
        const teamRepIds = [user.repId, ...scope.directRepIds, ...scope.indirectRepIds];
        allOrders = await storage.getOrders({ teamRepIds });
      }
      const monthOrders = allOrders.filter(o => new Date(o.dateSold) >= monthStart);

      // Company totals
      const totalSales = monthOrders.length;
      const connectedSales = monthOrders.filter(o => o.jobStatus === "COMPLETED").length;
      const pendingSales = monthOrders.filter(o => o.jobStatus === "PENDING").length;

      // Commission totals
      const pendingCommissions = monthOrders
        .filter(o => o.jobStatus === "PENDING")
        .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned || "0"), 0);
      const connectedCommissions = monthOrders
        .filter(o => o.jobStatus === "COMPLETED" && o.jobStatus === "COMPLETED")
        .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned || "0"), 0);

      // Get services and providers for breakdown
      const allServices = await storage.getServices();
      const allProviders = await storage.getProviders();

      // Service type breakdown
      const serviceBreakdown: Record<string, { sales: number; connected: number; pending: number; commission: number }> = {};
      for (const order of monthOrders) {
        const service = allServices.find(s => s.id === order.serviceId);
        const category = service?.category || service?.name || "Other";
        if (!serviceBreakdown[category]) {
          serviceBreakdown[category] = { sales: 0, connected: 0, pending: 0, commission: 0 };
        }
        serviceBreakdown[category].sales++;
        if (order.jobStatus === "COMPLETED") serviceBreakdown[category].connected++;
        if (order.jobStatus === "PENDING") serviceBreakdown[category].pending++;
        serviceBreakdown[category].commission += parseFloat(order.baseCommissionEarned || "0");
      }

      // Provider breakdown
      const providerBreakdown: Record<string, { name: string; sales: number; connected: number; pending: number; commission: number }> = {};
      for (const order of monthOrders) {
        const provider = allProviders.find(p => p.id === order.providerId);
        const providerName = provider?.name || "Unknown";
        if (!providerBreakdown[order.providerId]) {
          providerBreakdown[order.providerId] = { name: providerName, sales: 0, connected: 0, pending: 0, commission: 0 };
        }
        providerBreakdown[order.providerId].sales++;
        if (order.jobStatus === "COMPLETED") providerBreakdown[order.providerId].connected++;
        if (order.jobStatus === "PENDING") providerBreakdown[order.providerId].pending++;
        providerBreakdown[order.providerId].commission += parseFloat(order.baseCommissionEarned || "0");
      }

      // Get managers and their teams
      const allUsers = await storage.getUsers();
      const managers = allUsers.filter(u => u.role === "MANAGER" && u.status === "ACTIVE");
      
      const teamBreakdown = await Promise.all(managers.map(async (manager) => {
        const teamMembers = await storage.getTeamMembers(manager.id);
        const teamRepIds = [manager.repId, ...teamMembers.map(m => m.repId)];
        const teamOrders = monthOrders.filter(o => teamRepIds.includes(o.repId));
        
        return {
          managerId: manager.id,
          managerName: manager.name,
          teamSize: teamMembers.length,
          totalSales: teamOrders.length,
          connectedSales: teamOrders.filter(o => o.jobStatus === "COMPLETED").length,
          pendingSales: teamOrders.filter(o => o.jobStatus === "PENDING").length,
          pendingCommissions: teamOrders
            .filter(o => o.jobStatus === "PENDING")
            .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned || "0"), 0),
          connectedCommissions: teamOrders
            .filter(o => o.jobStatus === "COMPLETED" && o.jobStatus === "COMPLETED")
            .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned || "0"), 0),
        };
      }));

      res.json({
        period: { start: monthStartStr, end: now.toISOString().split('T')[0] },
        companyTotals: {
          totalSales,
          connectedSales,
          pendingSales,
          pendingCommissions,
          connectedCommissions,
        },
        serviceBreakdown: Object.entries(serviceBreakdown).map(([category, data]) => ({
          category,
          ...data,
        })),
        providerBreakdown: Object.values(providerBreakdown),
        teamBreakdown,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Executive Reports - Rep Listing
  app.get("/api/executive/rep-listing", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      if (!["EXECUTIVE", "ADMIN", "OPERATIONS", "MANAGER"].includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const allUsers = await storage.getUsers();
      const allServices = await storage.getServices();
      const allProviders = await storage.getProviders();

      // Role-based order and rep scoping
      let allOrders: any[] = [];
      let scopedRepIds: string[] = [];
      
