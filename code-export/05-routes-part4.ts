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
      
      if (user.role === "ADMIN" || user.role === "OPERATIONS") {
        allOrders = await storage.getOrders({});
        scopedRepIds = allUsers.filter(u => ["REP", "LEAD"].includes(u.role) && u.status === "ACTIVE").map(u => u.repId);
      } else if (user.role === "EXECUTIVE") {
        const scope = await storage.getExecutiveScope(user.id);
        const teamRepIds = [...scope.allRepRepIds, user.repId];
        allOrders = await storage.getOrders({ teamRepIds });
        scopedRepIds = teamRepIds;
      } else if (user.role === "MANAGER") {
        const scope = await storage.getManagerScope(user.id);
        const teamRepIds = [user.repId, ...scope.directRepIds, ...scope.indirectRepIds];
        allOrders = await storage.getOrders({ teamRepIds });
        scopedRepIds = teamRepIds;
      }
      
      const monthOrders = allOrders.filter(o => new Date(o.dateSold) >= monthStart);
      const reps = allUsers.filter(u => ["REP", "LEAD"].includes(u.role) && u.status === "ACTIVE" && scopedRepIds.includes(u.repId));

      const repListing = await Promise.all(reps.map(async (rep) => {
        const repOrders = monthOrders.filter(o => o.repId === rep.repId);
        
        // Service breakdown for this rep
        const serviceBreakdown: Record<string, { sales: number; connected: number; commission: number }> = {};
        for (const order of repOrders) {
          const service = allServices.find(s => s.id === order.serviceId);
          const category = service?.category || service?.name || "Other";
          if (!serviceBreakdown[category]) {
            serviceBreakdown[category] = { sales: 0, connected: 0, commission: 0 };
          }
          serviceBreakdown[category].sales++;
          if (order.jobStatus === "COMPLETED") serviceBreakdown[category].connected++;
          serviceBreakdown[category].commission += parseFloat(order.baseCommissionEarned || "0");
        }

        // Provider breakdown for this rep
        const providerBreakdown: Record<string, { name: string; sales: number; connected: number; commission: number }> = {};
        for (const order of repOrders) {
          const provider = allProviders.find(p => p.id === order.providerId);
          const providerName = provider?.name || "Unknown";
          if (!providerBreakdown[order.providerId]) {
            providerBreakdown[order.providerId] = { name: providerName, sales: 0, connected: 0, commission: 0 };
          }
          providerBreakdown[order.providerId].sales++;
          if (order.jobStatus === "COMPLETED") providerBreakdown[order.providerId].connected++;
          providerBreakdown[order.providerId].commission += parseFloat(order.baseCommissionEarned || "0");
        }

        // Find manager
        const manager = rep.assignedManagerId ? allUsers.find(u => u.id === rep.assignedManagerId) : null;

        return {
          repId: rep.repId,
          userId: rep.id,
          name: rep.name,
          role: rep.role,
          managerName: manager?.name || null,
          totalSales: repOrders.length,
          connectedSales: repOrders.filter(o => o.jobStatus === "COMPLETED").length,
          pendingSales: repOrders.filter(o => o.jobStatus === "PENDING").length,
          pendingCommissions: repOrders
            .filter(o => o.jobStatus === "PENDING")
            .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned || "0"), 0),
          connectedCommissions: repOrders
            .filter(o => o.jobStatus === "COMPLETED" && o.jobStatus === "COMPLETED")
            .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned || "0"), 0),
          serviceBreakdown: Object.entries(serviceBreakdown).map(([category, data]) => ({
            category,
            ...data,
          })),
          providerBreakdown: Object.values(providerBreakdown),
        };
      }));

      // Sort by total sales descending
      repListing.sort((a, b) => b.totalSales - a.totalSales);

      res.json({
        period: { start: monthStart.toISOString().split('T')[0], end: now.toISOString().split('T')[0] },
        reps: repListing,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================================
  // COMMISSION FORECASTING ENDPOINTS
  // =====================================================

  // Get commission forecast for current user (or any user for ADMIN/OPERATOR/EXECUTIVE)
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
      
      const now = new Date();
      let periodStart: Date;
      let periodEnd: Date = now;
      
      switch (period) {
        case "WEEK":
          periodStart = new Date(now);
          periodStart.setDate(periodStart.getDate() - 7);
          break;
        case "QUARTER":
          periodStart = new Date(now);
          periodStart.setMonth(periodStart.getMonth() - 3);
          break;
        case "MONTH":
        default:
          periodStart = new Date(now);
          periodStart.setMonth(periodStart.getMonth() - 1);
          break;
      }
      
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

  // Admin: Get company-wide or team forecasts
  app.get("/api/admin/commission-forecast", auth, managerOrAdmin, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const period = (req.query.period as string) || "MONTH";
      const repId = req.query.repId as string | undefined;
      
      const now = new Date();
      let periodStart: Date;
      
      switch (period) {
        case "WEEK":
          periodStart = new Date(now);
          periodStart.setDate(periodStart.getDate() - 7);
          break;
        case "QUARTER":
          periodStart = new Date(now);
          periodStart.setMonth(periodStart.getMonth() - 3);
          break;
        case "MONTH":
        default:
          periodStart = new Date(now);
          periodStart.setMonth(periodStart.getMonth() - 1);
          break;
      }
      
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

  // =====================================================
  // SCHEDULED PAY RUNS ENDPOINTS
  // =====================================================

  // Get all scheduled pay runs
  app.get("/api/admin/scheduled-pay-runs", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const schedules = await storage.getScheduledPayRuns();
      res.json(schedules);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create scheduled pay run
  app.post("/api/admin/scheduled-pay-runs", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const { name, frequency, dayOfWeek, dayOfMonth, secondDayOfMonth, autoCreatePayRun, autoLinkOrders } = req.body;
      
      // Calculate next run date
      const nextRunAt = calculateNextRunFromNow(frequency, dayOfWeek, dayOfMonth);
      
      const schedule = await storage.createScheduledPayRun({
        name,
        frequency,
        dayOfWeek: dayOfWeek ?? null,
        dayOfMonth: dayOfMonth ?? null,
        secondDayOfMonth: secondDayOfMonth ?? null,
        isActive: true,
        autoCreatePayRun: autoCreatePayRun ?? true,
        autoLinkOrders: autoLinkOrders ?? true,
        createdByUserId: user.id,
        nextRunAt,
      });
      
      await storage.createAuditLog({
        userId: user.id,
        action: "SCHEDULED_PAY_RUN_CREATED",
        tableName: "scheduled_pay_runs",
        recordId: schedule.id,
        afterJson: JSON.stringify({ name, frequency, dayOfWeek, dayOfMonth }),
      });
      
      res.json(schedule);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update scheduled pay run
  app.patch("/api/admin/scheduled-pay-runs/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { name, frequency, dayOfWeek, dayOfMonth, secondDayOfMonth, isActive, autoCreatePayRun, autoLinkOrders } = req.body;
      
      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (frequency !== undefined) updates.frequency = frequency;
      if (dayOfWeek !== undefined) updates.dayOfWeek = dayOfWeek;
      if (dayOfMonth !== undefined) updates.dayOfMonth = dayOfMonth;
      if (secondDayOfMonth !== undefined) updates.secondDayOfMonth = secondDayOfMonth;
      if (isActive !== undefined) updates.isActive = isActive;
      if (autoCreatePayRun !== undefined) updates.autoCreatePayRun = autoCreatePayRun;
      if (autoLinkOrders !== undefined) updates.autoLinkOrders = autoLinkOrders;
      
      // Recalculate next run if frequency changed
      if (frequency !== undefined) {
        updates.nextRunAt = calculateNextRunFromNow(frequency, dayOfWeek, dayOfMonth);
      }
      
      const schedule = await storage.updateScheduledPayRun(id, updates);
      res.json(schedule);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete scheduled pay run
  app.delete("/api/admin/scheduled-pay-runs/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      await storage.deleteScheduledPayRun(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Manually trigger scheduled pay run check
  app.post("/api/admin/scheduled-pay-runs/trigger", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { scheduler } = await import("./scheduler");
      await scheduler.checkScheduledPayRuns();
      res.json({ success: true, message: "Scheduled pay run check triggered" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================================
  // BACKGROUND JOBS & CHARGEBACK PROCESSING
  // =====================================================

  // Get recent background jobs
  app.get("/api/admin/background-jobs", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const jobType = req.query.type as string | undefined;
      const jobs = await storage.getRecentBackgroundJobs(jobType, 50);
      res.json(jobs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Manually trigger chargeback processing
  app.post("/api/admin/chargebacks/process", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { scheduler } = await import("./scheduler");
      await scheduler.processChargebacks();
      res.json({ success: true, message: "Chargeback processing triggered" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/trigger-report", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { scheduler } = await import("./scheduler");
      const { type } = req.body;
      if (type === "DAILY_SALES_REPORT") {
        const result = await scheduler.generateDailySalesReport();
        res.json({ success: true, message: "Daily sales report triggered", result });
      } else if (type === "DAILY_INSTALL_REPORT") {
        const result = await scheduler.generateDailyInstallReport();
        res.json({ success: true, message: "Daily install report triggered", result });
      } else {
        res.status(400).json({ message: "Invalid type. Use DAILY_SALES_REPORT or DAILY_INSTALL_REPORT" });
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================================
  // NOTIFICATION ENDPOINTS
  // =====================================================

  // Get user's notification preferences
  app.get("/api/notification-preferences", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      let prefs = await storage.getNotificationPreferences(user.id);
      
      // Return defaults if no preferences exist
      if (!prefs) {
        prefs = {
          id: "",
          userId: user.id,
          emailOrderApproved: true,
          emailOrderRejected: true,
          emailPayRunFinalized: true,
          emailChargebackApplied: true,
          emailAdvanceUpdates: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
      
      res.json(prefs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update notification preferences
  app.patch("/api/notification-preferences", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const { emailOrderApproved, emailOrderRejected, emailPayRunFinalized, emailChargebackApplied, emailAdvanceUpdates } = req.body;
      
      const updates: any = {};
      if (emailOrderApproved !== undefined) updates.emailOrderApproved = emailOrderApproved;
      if (emailOrderRejected !== undefined) updates.emailOrderRejected = emailOrderRejected;
      if (emailPayRunFinalized !== undefined) updates.emailPayRunFinalized = emailPayRunFinalized;
      if (emailChargebackApplied !== undefined) updates.emailChargebackApplied = emailChargebackApplied;
      if (emailAdvanceUpdates !== undefined) updates.emailAdvanceUpdates = emailAdvanceUpdates;
      
      const prefs = await storage.upsertNotificationPreferences(user.id, updates);
      res.json(prefs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Admin: Get notification logs
  app.get("/api/admin/notifications", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const status = req.query.status as string | undefined;
      const notifications = await storage.getEmailNotifications({ status });
      res.json(notifications);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Admin: Manually trigger notification sending
  app.post("/api/admin/notifications/send", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { emailService } = await import("./email");
      const results = await emailService.sendPendingEmails();
      res.json({ success: true, ...results });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ========== User Activity Tracking ==========

  app.post("/api/activity", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const { page } = req.body;
      if (!page) return res.status(400).json({ message: "Page is required" });
      const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
      const ua = req.headers["user-agent"] || "";
      const deviceType = /Mobile|Android|iPhone|iPad/i.test(ua) ? "Mobile" : "Desktop";
      await storage.createUserActivityLog({
        userId: user.id,
        eventType: "PAGE_VIEW",
        page,
        ipAddress: ip,
        userAgent: ua,
        deviceType,
      });
      await storage.updateUserLastActive(user.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to log activity" });
    }
  });

  app.get("/api/user-activity", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER"].includes(user.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const rangeDays = parseInt(req.query.range as string) || 7;
      const allUsers = await storage.getUsers();
      const logs = await storage.getUserActivityLogs(3000);

      const userMap = new Map(allUsers.map(u => [u.id, {
        name: u.name, repId: u.repId, role: u.role,
        lastLoginAt: u.lastLoginAt, lastLoginIp: u.lastLoginIp,
        lastLoginLocation: u.lastLoginLocation, lastActiveAt: u.lastActiveAt,
        status: u.status,
      }]));

      const enriched = logs.map(log => ({
        ...log,
        userName: userMap.get(log.userId)?.name || "Unknown",
        userRepId: userMap.get(log.userId)?.repId || "",
        userRole: userMap.get(log.userId)?.role || "",
      }));

      const now = new Date();
      const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const rangeStart = new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000);
      const onlineThreshold = new Date(now.getTime() - 5 * 60 * 1000);

      const recentLogins = enriched.filter(l => l.eventType === "LOGIN" && new Date(l.createdAt) >= last24h);
      const uniqueUsersToday = new Set(recentLogins.map(l => l.userId)).size;

      const onlineUsers = allUsers
        .filter(u => u.lastActiveAt && new Date(u.lastActiveAt) >= onlineThreshold && u.status === "ACTIVE")
        .map(u => ({
          id: u.id, name: u.name, repId: u.repId, role: u.role,
          lastActiveAt: u.lastActiveAt,
        }));

      const userSummaries = allUsers
        .filter(u => u.status === "ACTIVE" && !u.deletedAt)
        .map(u => ({
          id: u.id, name: u.name, repId: u.repId, role: u.role,
          lastLoginAt: u.lastLoginAt,
          lastLoginIp: u.lastLoginIp,
          lastLoginLocation: u.lastLoginLocation,
          lastActiveAt: u.lastActiveAt,
          isOnline: u.lastActiveAt ? new Date(u.lastActiveAt) >= onlineThreshold : false,
        }))
        .sort((a, b) => {
          if (a.isOnline && !b.isOnline) return -1;
          if (!a.isOnline && b.isOnline) return 1;
          const aTime = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : 0;
          const bTime = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : 0;
          return bTime - aTime;
        });

      const rangeLogs = enriched.filter(l => new Date(l.createdAt) >= rangeStart);
      const deviceBreakdown: Record<string, number> = {};
      const locationBreakdown: Record<string, number> = {};
      const pageBreakdown: Record<string, number> = {};
      for (const log of rangeLogs) {
        if (log.deviceType) deviceBreakdown[log.deviceType] = (deviceBreakdown[log.deviceType] || 0) + 1;
        if (log.eventType === "LOGIN" && (log.city || log.region)) {
          const loc = [log.city, log.region].filter(Boolean).join(", ");
          locationBreakdown[loc] = (locationBreakdown[loc] || 0) + 1;
        }
        if (log.page) pageBreakdown[log.page] = (pageBreakdown[log.page] || 0) + 1;
      }

      res.json({
        logs: enriched.slice(0, 500),
        stats: {
          uniqueUsersToday,
          totalLogins24h: recentLogins.length,
          totalEventsRange: rangeLogs.length,
          onlineNow: onlineUsers.length,
        },
        onlineUsers,
        userSummaries,
        deviceBreakdown,
        locationBreakdown,
        pageBreakdown,
        rangeDays,
      });
    } catch (error) {
      console.error("User activity error:", error);
      res.status(500).json({ message: "Failed to fetch activity data" });
    }
  });

  // ========== User Notifications (In-App) ==========

  // Get current user's notifications
  app.get("/api/notifications", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const notifications = await storage.getUserNotifications(user.id, limit);
      res.json(notifications);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get unread notification count
  app.get("/api/notifications/unread-count", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const count = await storage.getUnreadNotificationCount(user.id);
      res.json({ count });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Mark a single notification as read
  app.patch("/api/notifications/:id/read", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const notification = await storage.markNotificationRead(req.params.id, user.id);
      if (!notification) {
        return res.status(404).json({ message: "Notification not found" });
      }
      res.json(notification);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Mark all notifications as read
  app.post("/api/notifications/mark-all-read", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const count = await storage.markAllNotificationsRead(user.id);
      res.json({ markedRead: count });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ========== Scheduled Reports ==========

  // Get user's scheduled reports
  app.get("/api/scheduled-reports", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      // ADMIN/OPERATIONS/EXECUTIVE can see all, others see only their own
      const reports = ["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role)
        ? await storage.getScheduledReports()
        : await storage.getScheduledReports(user.id);
      res.json(reports);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create scheduled report
  app.post("/api/scheduled-reports", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER"].includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const { name, reportType, frequency, dayOfWeek, dayOfMonth, timeOfDay, recipients, isActive } = req.body;
      
      // Calculate next send time
      const now = new Date();
      let nextSendAt = new Date();
      const [hours, minutes] = (timeOfDay || "08:00").split(":").map(Number);
      nextSendAt.setHours(hours, minutes, 0, 0);
      
      if (frequency === "daily") {
        if (nextSendAt <= now) nextSendAt.setDate(nextSendAt.getDate() + 1);
      } else if (frequency === "weekly" && dayOfWeek !== undefined) {
        const currentDay = now.getDay();
        let daysUntil = dayOfWeek - currentDay;
        if (daysUntil <= 0 || (daysUntil === 0 && nextSendAt <= now)) daysUntil += 7;
        nextSendAt.setDate(now.getDate() + daysUntil);
      } else if (frequency === "monthly" && dayOfMonth) {
        nextSendAt.setDate(dayOfMonth);
        if (nextSendAt <= now) nextSendAt.setMonth(nextSendAt.getMonth() + 1);
      }
      
      const report = await storage.createScheduledReport({
        userId: user.id,
        name,
        reportType,
        frequency,
        dayOfWeek: dayOfWeek !== undefined ? dayOfWeek : null,
        dayOfMonth: dayOfMonth || null,
        timeOfDay: timeOfDay || "08:00",
        recipients: recipients || [],
        isActive: isActive !== false,
      });
      
      // Update with calculated nextSendAt
      await storage.updateScheduledReport(report.id, { nextSendAt });
      
      res.json({ ...report, nextSendAt });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update scheduled report
  app.patch("/api/scheduled-reports/:id", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const existing = await storage.getScheduledReportById(req.params.id);
      
      if (!existing) {
        return res.status(404).json({ message: "Scheduled report not found" });
      }
      
      // Check ownership or admin/executive
      if (existing.userId !== user.id && !["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const { name, reportType, frequency, dayOfWeek, dayOfMonth, timeOfDay, recipients, isActive } = req.body;
      
      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (reportType !== undefined) updates.reportType = reportType;
      if (frequency !== undefined) updates.frequency = frequency;
      if (dayOfWeek !== undefined) updates.dayOfWeek = dayOfWeek;
      if (dayOfMonth !== undefined) updates.dayOfMonth = dayOfMonth;
      if (timeOfDay !== undefined) updates.timeOfDay = timeOfDay;
      if (recipients !== undefined) updates.recipients = recipients;
      if (isActive !== undefined) updates.isActive = isActive;
      
      const report = await storage.updateScheduledReport(req.params.id, updates);
      res.json(report);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete scheduled report
  app.delete("/api/scheduled-reports/:id", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const existing = await storage.getScheduledReportById(req.params.id);
      
      if (!existing) {
        return res.status(404).json({ message: "Scheduled report not found" });
      }
      
      if (existing.userId !== user.id && !["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      await storage.deleteScheduledReport(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ========== Employee Credentials (Multi-Entry) ==========

  // Get current user's all credential entries
  app.get("/api/my-credentials", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const credentials = await storage.getEmployeeCredentialsByUser(user.id);
      res.json(credentials);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create new credential entry for current user
  app.post("/api/my-credentials", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const {
        entryLabel, peopleSoftNumber, networkId, tempPassword, workEmail, rtr, rtrPassword,
        authenticatorUsername, authenticatorPassword, ipadPin, deviceNumber,
        gmail, gmailPassword, notes
      } = req.body;

      const data: any = { entryLabel: entryLabel || "Primary" };
      if (peopleSoftNumber !== undefined) data.peopleSoftNumber = peopleSoftNumber;
      if (networkId !== undefined) data.networkId = networkId;
      if (tempPassword !== undefined) data.tempPassword = tempPassword;
      if (workEmail !== undefined) data.workEmail = workEmail;
      if (rtr !== undefined) data.rtr = rtr;
      if (rtrPassword !== undefined) data.rtrPassword = rtrPassword;
      if (authenticatorUsername !== undefined) data.authenticatorUsername = authenticatorUsername;
      if (authenticatorPassword !== undefined) data.authenticatorPassword = authenticatorPassword;
      if (ipadPin !== undefined) data.ipadPin = ipadPin;
      if (deviceNumber !== undefined) data.deviceNumber = deviceNumber;
      if (gmail !== undefined) data.gmail = gmail;
      if (gmailPassword !== undefined) data.gmailPassword = gmailPassword;
      if (notes !== undefined) data.notes = notes;

      const credentials = await storage.createEmployeeCredential(user.id, data, user.id);
      
      await storage.createAuditLog({
        userId: user.id,
        action: "CREATE",
        tableName: "employee_credentials",
        recordId: credentials.id,
        afterJson: JSON.stringify({ entryLabel: data.entryLabel }),
      });

      res.json(credentials);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update specific credential entry for current user
  app.patch("/api/my-credentials/:credentialId", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const { credentialId } = req.params;

      // Verify ownership
      const existing = await storage.getEmployeeCredentialById(credentialId);
      if (!existing || existing.userId !== user.id) {
        return res.status(404).json({ message: "Credential not found" });
      }

      const {
        entryLabel, peopleSoftNumber, networkId, tempPassword, workEmail, rtr, rtrPassword,
        authenticatorUsername, authenticatorPassword, ipadPin, deviceNumber,
        gmail, gmailPassword, notes
      } = req.body;

      const updates: any = {};
      if (entryLabel !== undefined) updates.entryLabel = entryLabel;
      if (peopleSoftNumber !== undefined) updates.peopleSoftNumber = peopleSoftNumber;
      if (networkId !== undefined) updates.networkId = networkId;
      if (tempPassword !== undefined) updates.tempPassword = tempPassword;
      if (workEmail !== undefined) updates.workEmail = workEmail;
      if (rtr !== undefined) updates.rtr = rtr;
      if (rtrPassword !== undefined) updates.rtrPassword = rtrPassword;
      if (authenticatorUsername !== undefined) updates.authenticatorUsername = authenticatorUsername;
      if (authenticatorPassword !== undefined) updates.authenticatorPassword = authenticatorPassword;
      if (ipadPin !== undefined) updates.ipadPin = ipadPin;
      if (deviceNumber !== undefined) updates.deviceNumber = deviceNumber;
      if (gmail !== undefined) updates.gmail = gmail;
      if (gmailPassword !== undefined) updates.gmailPassword = gmailPassword;
      if (notes !== undefined) updates.notes = notes;

      const credentials = await storage.updateEmployeeCredential(credentialId, updates, user.id);
      
      await storage.createAuditLog({
        userId: user.id,
        action: "UPDATE",
        tableName: "employee_credentials",
        recordId: credentialId,
        afterJson: JSON.stringify({ fields: Object.keys(updates) }),
      });

      res.json(credentials);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete specific credential entry for current user
  app.delete("/api/my-credentials/:credentialId", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const { credentialId } = req.params;

      // Verify ownership
      const existing = await storage.getEmployeeCredentialById(credentialId);
      if (!existing || existing.userId !== user.id) {
        return res.status(404).json({ message: "Credential not found" });
      }

      const deleted = await storage.deleteEmployeeCredential(credentialId);
      
      if (deleted) {
        await storage.createAuditLog({
          userId: user.id,
          action: "DELETE",
          tableName: "employee_credentials",
          recordId: credentialId,
          beforeJson: JSON.stringify({ entryLabel: deleted.entryLabel }),
        });
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Admin/Executive: Get all employee credentials
  app.get("/api/admin/employee-credentials", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const credentials = await storage.getAllEmployeeCredentials();
      res.json(credentials);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Admin/Executive: Get specific user's credentials (all entries)
  app.get("/api/admin/employee-credentials/user/:userId", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const { userId } = req.params;
      const targetUser = await storage.getUserById(userId);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }

      const credentials = await storage.getEmployeeCredentialsByUser(userId);
      res.json({ user: targetUser, credentials });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Admin/Executive: Create new credential entry for any user
  app.post("/api/admin/employee-credentials/user/:userId", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const { userId } = req.params;
      const targetUser = await storage.getUserById(userId);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }

      const {
        entryLabel, peopleSoftNumber, networkId, tempPassword, workEmail, rtr, rtrPassword,
        authenticatorUsername, authenticatorPassword, ipadPin, deviceNumber,
        gmail, gmailPassword, notes
      } = req.body;

      const data: any = { entryLabel: entryLabel || "Primary" };
      if (peopleSoftNumber !== undefined) data.peopleSoftNumber = peopleSoftNumber;
      if (networkId !== undefined) data.networkId = networkId;
      if (tempPassword !== undefined) data.tempPassword = tempPassword;
      if (workEmail !== undefined) data.workEmail = workEmail;
      if (rtr !== undefined) data.rtr = rtr;
      if (rtrPassword !== undefined) data.rtrPassword = rtrPassword;
      if (authenticatorUsername !== undefined) data.authenticatorUsername = authenticatorUsername;
      if (authenticatorPassword !== undefined) data.authenticatorPassword = authenticatorPassword;
      if (ipadPin !== undefined) data.ipadPin = ipadPin;
      if (deviceNumber !== undefined) data.deviceNumber = deviceNumber;
      if (gmail !== undefined) data.gmail = gmail;
      if (gmailPassword !== undefined) data.gmailPassword = gmailPassword;
      if (notes !== undefined) data.notes = notes;

      const credentials = await storage.createEmployeeCredential(userId, data, user.id);

      await storage.createAuditLog({
        userId: user.id,
        action: "CREATE",
        tableName: "employee_credentials",
        recordId: credentials.id,
        afterJson: JSON.stringify({ targetUserId: userId, entryLabel: data.entryLabel }),
      });

      res.json(credentials);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Admin/Executive: Update specific credential entry
  app.patch("/api/admin/employee-credentials/:credentialId", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const { credentialId } = req.params;
      const existing = await storage.getEmployeeCredentialById(credentialId);
      if (!existing) {
        return res.status(404).json({ message: "Credential not found" });
      }

      const {
        entryLabel, peopleSoftNumber, networkId, tempPassword, workEmail, rtr, rtrPassword,
        authenticatorUsername, authenticatorPassword, ipadPin, deviceNumber,
        gmail, gmailPassword, notes
      } = req.body;

      const updates: any = {};
      if (entryLabel !== undefined) updates.entryLabel = entryLabel;
      if (peopleSoftNumber !== undefined) updates.peopleSoftNumber = peopleSoftNumber;
      if (networkId !== undefined) updates.networkId = networkId;
      if (tempPassword !== undefined) updates.tempPassword = tempPassword;
      if (workEmail !== undefined) updates.workEmail = workEmail;
      if (rtr !== undefined) updates.rtr = rtr;
      if (rtrPassword !== undefined) updates.rtrPassword = rtrPassword;
      if (authenticatorUsername !== undefined) updates.authenticatorUsername = authenticatorUsername;
      if (authenticatorPassword !== undefined) updates.authenticatorPassword = authenticatorPassword;
      if (ipadPin !== undefined) updates.ipadPin = ipadPin;
      if (deviceNumber !== undefined) updates.deviceNumber = deviceNumber;
      if (gmail !== undefined) updates.gmail = gmail;
      if (gmailPassword !== undefined) updates.gmailPassword = gmailPassword;
      if (notes !== undefined) updates.notes = notes;

      const credentials = await storage.updateEmployeeCredential(credentialId, updates, user.id);

      await storage.createAuditLog({
        userId: user.id,
        action: "UPDATE",
        tableName: "employee_credentials",
        recordId: credentialId,
        afterJson: JSON.stringify({ targetUserId: existing.userId, fields: Object.keys(updates) }),
      });

      res.json(credentials);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Admin/Executive: Delete specific credential entry
  app.delete("/api/admin/employee-credentials/:credentialId", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const { credentialId } = req.params;
      const existing = await storage.getEmployeeCredentialById(credentialId);
      if (!existing) {
        return res.status(404).json({ message: "Credential not found" });
      }

      const deleted = await storage.deleteEmployeeCredential(credentialId);
      
      if (deleted) {
        await storage.createAuditLog({
          userId: user.id,
          action: "DELETE",
          tableName: "employee_credentials",
          recordId: credentialId,
          beforeJson: JSON.stringify({ targetUserId: deleted.userId, entryLabel: deleted.entryLabel }),
        });
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ================== MDU STAGING ORDERS ==================

  // MDU middleware - only MDU users can access their own staging orders
  const mduOnly = (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.user?.role !== "MDU") {
      return res.status(403).json({ message: "MDU access required" });
    }
    next();
  };

  // MDU: Get my staging orders
  app.get("/api/mdu/orders", auth, mduOnly, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const orders = await storage.getMduStagingOrders(user.repId);
      // Remove encrypted SSN and add masked display
      const safeOrders = orders.map((order: any) => {
        const { customerSsnEncrypted, ...safeOrder } = order;
        return { ...safeOrder, customerSsnDisplay: safeOrder.customerSsnLast4 ? `***-**-${safeOrder.customerSsnLast4}` : null };
      });
      res.json(safeOrders);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch MDU orders" });
    }
  });

  // MDU: Create new staging order
  app.post("/api/mdu/orders", auth, mduOnly, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const parsed = insertMduStagingOrderSchema.safeParse({ ...req.body, mduRepId: user.repId });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten() });
      }
      
      // Handle SSN encryption
      const { customerSsn, ...orderData } = parsed.data;
      const dataToSave: any = { ...orderData };
      
      // Sanitize empty strings to null for date fields
      const dateFields = ['installDate', 'customerBirthday'];
      dateFields.forEach(field => {
        if (dataToSave[field] === '' || dataToSave[field] === undefined) {
          dataToSave[field] = null;
        }
      });
      
      // Sanitize empty strings to null for optional text fields
      const optionalTextFields = ['installTime', 'accountNumber', 'customerAddress', 'customerPhone', 'customerEmail', 'creditCardLast4', 'creditCardExpiry', 'creditCardName', 'notes', 'clientId', 'providerId', 'serviceId'];
      optionalTextFields.forEach(field => {
        if (dataToSave[field] === '') {
          dataToSave[field] = null;
        }
      });
      if (customerSsn) {
        dataToSave.customerSsnEncrypted = encryptSsn(customerSsn);
        dataToSave.customerSsnLast4 = extractSsnLast4(customerSsn);
      }
      
      const order = await storage.createMduStagingOrder(dataToSave);
      await storage.createAuditLog({
        userId: user.id,
        action: "create_mdu_staging_order",
        tableName: "mdu_staging_orders",
        recordId: order.id,
        afterJson: JSON.stringify({ ...order, customerSsnEncrypted: "[ENCRYPTED]" }),
      });
      
      // Notify Operations and Executive users about new MDU order
      try {
        const [opsUsers, execUsers] = await Promise.all([
          storage.getUsersByRole("OPERATIONS"),
          storage.getUsersByRole("EXECUTIVE"),
        ]);
        const adminUsers = await storage.getUsersByRole("ADMIN");
        const notifyUsers = [...opsUsers, ...execUsers, ...adminUsers];
        
        for (const notifyUser of notifyUsers) {
          await storage.createEmailNotification({
            userId: notifyUser.id,
            notificationType: "MDU_ORDER_SUBMITTED",
            subject: "New MDU Order Submitted",
            body: `${user.name} (${user.repId}) submitted a new MDU order for ${req.body.customerName || "a customer"}. Please review it in the MDU Review queue.`,
            recipientEmail: "", // In-app notification only
            status: "PENDING",
            isRead: false,
          });
        }
      } catch (notifyError) {
        console.error("Failed to send MDU order notifications:", notifyError);
      }
      
      // Return with masked SSN display (never expose encrypted value to client)
      const { customerSsnEncrypted, ...safeOrder } = order;
      res.json({ ...safeOrder, customerSsnDisplay: safeOrder.customerSsnLast4 ? `***-**-${safeOrder.customerSsnLast4}` : null });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to create MDU order" });
    }
  });

  // MDU: Update my staging order (only if PENDING)
  app.put("/api/mdu/orders/:id", auth, mduOnly, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const { id } = req.params;
      const existing = await storage.getMduStagingOrderById(id);
      if (!existing) {
        return res.status(404).json({ message: "Order not found" });
      }
      if (existing.mduRepId !== user.repId) {
        return res.status(403).json({ message: "Not authorized" });
      }
      if (existing.status !== "PENDING") {
        return res.status(400).json({ message: "Can only edit pending orders" });
      }
      // Whitelist only editable fields - prevent privilege escalation
      const allowedFields: any = {
        clientId: req.body.clientId,
        providerId: req.body.providerId,
        serviceId: req.body.serviceId,
        dateSold: req.body.dateSold,
        installDate: req.body.installDate,
        installTime: req.body.installTime,
        installType: req.body.installType,
        accountNumber: req.body.accountNumber,
        tvSold: req.body.tvSold,
        mobileSold: req.body.mobileSold,
        mobileProductType: req.body.mobileProductType,
        mobilePortedStatus: req.body.mobilePortedStatus,
        mobileLinesQty: req.body.mobileLinesQty,
        customerName: req.body.customerName,
        customerAddress: req.body.customerAddress,
        customerPhone: req.body.customerPhone,
        customerEmail: req.body.customerEmail,
        customerBirthday: req.body.customerBirthday,
        creditCardLast4: req.body.creditCardLast4,
        creditCardExpiry: req.body.creditCardExpiry,
        creditCardName: req.body.creditCardName,
        notes: req.body.notes,
      };
      
      // Handle SSN update - encrypt if provided
      if (req.body.customerSsn) {
        allowedFields.customerSsnEncrypted = encryptSsn(req.body.customerSsn);
        allowedFields.customerSsnLast4 = extractSsnLast4(req.body.customerSsn);
      }
      
      // Sanitize empty strings to null for date fields
      const dateFieldsToSanitize = ['installDate', 'customerBirthday'];
      dateFieldsToSanitize.forEach(field => {
        if (allowedFields[field] === '') {
          allowedFields[field] = null;
        }
      });
      
      // Sanitize empty strings to null for optional text/enum fields
      const optionalFieldsToSanitize = ['installTime', 'accountNumber', 'customerAddress', 'customerPhone', 'customerEmail', 'creditCardLast4', 'creditCardExpiry', 'creditCardName', 'notes', 'clientId', 'providerId', 'serviceId', 'installType', 'mobileProductType', 'mobilePortedStatus'];
      optionalFieldsToSanitize.forEach(field => {
        if (allowedFields[field] === '') {
          allowedFields[field] = null;
        }
      });
      
      // Remove undefined values
      const sanitizedData = Object.fromEntries(
        Object.entries(allowedFields).filter(([_, v]) => v !== undefined)
      );
      const updated = await storage.updateMduStagingOrder(id, sanitizedData);
      
      // Return with masked SSN display
      const { customerSsnEncrypted, ...safeOrder } = updated as any;
      res.json({ ...safeOrder, customerSsnDisplay: safeOrder.customerSsnLast4 ? `***-**-${safeOrder.customerSsnLast4}` : null });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to update MDU order" });
    }
  });

  // MDU: Delete my staging order (only if PENDING)
  app.delete("/api/mdu/orders/:id", auth, mduOnly, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const { id } = req.params;
      const existing = await storage.getMduStagingOrderById(id);
      if (!existing) {
        return res.status(404).json({ message: "Order not found" });
      }
      if (existing.mduRepId !== user.repId) {
        return res.status(403).json({ message: "Not authorized" });
      }
      if (existing.status !== "PENDING") {
        return res.status(400).json({ message: "Can only delete pending orders" });
      }
      await storage.deleteMduStagingOrder(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete MDU order" });
    }
  });

  // Admin: Get all pending MDU staging orders for review
  app.get("/api/admin/mdu/pending", auth, executiveOrAdmin, async (req: AuthRequest, res) => {
    try {
      const orders = await storage.getPendingMduStagingOrders();
      // Never send encrypted SSN to client - only masked display
      const safeOrders = orders.map((order: any) => {
        const { customerSsnEncrypted, ...safeOrder } = order;
        const ssnDisplay = safeOrder.customerSsnLast4 ? `***-**-${safeOrder.customerSsnLast4}` : null;
        return { ...safeOrder, customerSsnDisplay: ssnDisplay, hasSsn: !!customerSsnEncrypted };
      });
      res.json(safeOrders);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch pending MDU orders" });
    }
  });

  // Admin: Get all MDU staging orders
  app.get("/api/admin/mdu/orders", auth, executiveOrAdmin, async (req: AuthRequest, res) => {
    try {
      const orders = await storage.getMduStagingOrders();
      // Never send encrypted SSN to client - only masked display
      const safeOrders = orders.map((order: any) => {
        const { customerSsnEncrypted, ...safeOrder } = order;
        const ssnDisplay = safeOrder.customerSsnLast4 ? `***-**-${safeOrder.customerSsnLast4}` : null;
        return { ...safeOrder, customerSsnDisplay: ssnDisplay, hasSsn: !!customerSsnEncrypted };
      });
      res.json(safeOrders);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch MDU orders" });
    }
  });

  // Admin/Executive: View full SSN (explicit request with audit logging)
  app.get("/api/admin/mdu/:id/ssn", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      // Only ADMIN, OPERATIONS, EXECUTIVE can view full SSN
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role)) {
        return res.status(403).json({ message: "Not authorized to view SSN" });
      }
      
      const { id } = req.params;
      const order = await storage.getMduStagingOrderById(id);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }
      
      const orderData = order as any;
      if (!orderData.customerSsnEncrypted) {
        return res.status(404).json({ message: "No SSN on file for this order" });
      }
      
      const decryptedSsn = decryptSsn(orderData.customerSsnEncrypted);
      
      // Audit log SSN access
      await storage.createAuditLog({
        userId: user.id,
        action: "view_ssn",
        tableName: "mdu_staging_orders",
        recordId: id,
        afterJson: JSON.stringify({ accessedBy: user.repId, accessedByRole: user.role }),
      });
      
      res.json({ ssn: decryptedSsn });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to retrieve SSN" });
    }
  });

  // Admin: Get MDU order data for prefilling regular order form (excludes sensitive data)
  app.get("/api/admin/mdu/:id/prefill", auth, executiveOrAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const mduOrder = await storage.getMduStagingOrderById(id);
      if (!mduOrder) {
        return res.status(404).json({ message: "MDU order not found" });
      }
      // Whitelist only non-sensitive fields needed for order creation - explicitly exclude all PII/financial data
      const safeData = {
        id: mduOrder.id,
        mduRepId: mduOrder.mduRepId,
        clientId: mduOrder.clientId,
        providerId: mduOrder.providerId,
        serviceId: mduOrder.serviceId,
        dateSold: mduOrder.dateSold,
        installDate: mduOrder.installDate,
        installTime: mduOrder.installTime,
        installType: mduOrder.installType,
        accountNumber: mduOrder.accountNumber,
        tvSold: mduOrder.tvSold,
        mobileSold: mduOrder.mobileSold,
        mobileProductType: mduOrder.mobileProductType,
        mobilePortedStatus: mduOrder.mobilePortedStatus,
        mobileLinesQty: mduOrder.mobileLinesQty,
        customerName: mduOrder.customerName,
        customerAddress: mduOrder.customerAddress,
        customerPhone: mduOrder.customerPhone,
        customerEmail: mduOrder.customerEmail,
        notes: mduOrder.notes,
        status: mduOrder.status,
        createdAt: mduOrder.createdAt,
      };
      res.json(safeData);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch MDU order" });
    }
  });

  // Admin: Reject MDU staging order
  app.post("/api/admin/mdu/:id/reject", auth, executiveOrAdmin, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const { id } = req.params;
      const { rejectionNote } = req.body;
      const mduOrder = await storage.getMduStagingOrderById(id);
      if (!mduOrder) {
        return res.status(404).json({ message: "MDU order not found" });
      }
      if (mduOrder.status !== "PENDING") {
        return res.status(400).json({ message: "Order is not pending" });
      }

      const updated = await storage.updateMduStagingOrder(id, {
        status: "REJECTED",
        rejectionNote: rejectionNote || "Rejected by admin",
        reviewedByUserId: user.id,
        reviewedAt: new Date(),
      });

      await storage.createAuditLog({
        userId: user.id,
        action: "reject_mdu_order",
        tableName: "mdu_staging_orders",
        recordId: id,
        afterJson: JSON.stringify({ rejectionNote }),
      });

      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to reject MDU order" });
    }
  });

  // ========== COMMISSION DISPUTES ==========

  // Rep can view their own disputes
  app.get("/api/disputes/my", auth, async (req: AuthRequest, res) => {
    try {
      const disputes = await storage.getCommissionDisputesByUser(req.user!.id);
      res.json(disputes);
    } catch (error) {
      res.status(500).json({ message: "Failed to get disputes" });
    }
  });

  // Rep can create a dispute
  app.post("/api/disputes", auth, async (req: AuthRequest, res) => {
    try {
      const { disputeType, title, description, salesOrderId, payStatementId, expectedAmount, actualAmount } = req.body;
      
      if (!disputeType || !title || !description) {
        return res.status(400).json({ message: "Dispute type, title, and description are required" });
      }

      const differenceAmount = expectedAmount && actualAmount 
        ? (parseFloat(expectedAmount) - parseFloat(actualAmount)).toFixed(2)
        : null;

      const dispute = await storage.createCommissionDispute({
        userId: req.user!.id,
        disputeType,
        title,
        description,
        salesOrderId: salesOrderId || null,
        payStatementId: payStatementId || null,
        expectedAmount: expectedAmount || null,
        actualAmount: actualAmount || null,
        differenceAmount,
        status: "PENDING",
      });

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "create_dispute",
        tableName: "commission_disputes",
        recordId: dispute.id,
        afterJson: JSON.stringify({ disputeType, title }),
      });

      res.status(201).json(dispute);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to create dispute" });
    }
  });

  // Rep can get a specific dispute they own
  app.get("/api/disputes/my/:id", auth, async (req: AuthRequest, res) => {
    try {
      const result = await storage.getCommissionDisputeById(req.params.id);
      if (!result) return res.status(404).json({ message: "Dispute not found" });
      if (result.dispute.userId !== req.user!.id) return res.status(403).json({ message: "Access denied" });
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to get dispute" });
    }
  });

  // Admin can view all disputes
  app.get("/api/admin/disputes", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { status, userId } = req.query;
      const disputes = await storage.getCommissionDisputes({
        status: status as string | undefined,
        userId: userId as string | undefined,
      });
      res.json(disputes);
    } catch (error) {
      res.status(500).json({ message: "Failed to get disputes" });
    }
  });

  // Admin can get a specific dispute
  app.get("/api/admin/disputes/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const result = await storage.getCommissionDisputeById(req.params.id);
      if (!result) return res.status(404).json({ message: "Dispute not found" });
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to get dispute" });
    }
  });

  // Admin can update dispute status
  app.patch("/api/admin/disputes/:id/status", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { status } = req.body;
      if (!["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED", "CLOSED"].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }

      const dispute = await storage.updateCommissionDispute(req.params.id, { status });
      if (!dispute) return res.status(404).json({ message: "Dispute not found" });

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "update_dispute_status",
        tableName: "commission_disputes",
        recordId: req.params.id,
        afterJson: JSON.stringify({ status }),
      });

      res.json(dispute);
    } catch (error) {
      res.status(500).json({ message: "Failed to update dispute status" });
    }
  });

  // Admin can resolve a dispute
  app.post("/api/admin/disputes/:id/resolve", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { status, resolution, resolvedAmount } = req.body;
      if (!["APPROVED", "REJECTED", "CLOSED"].includes(status)) {
        return res.status(400).json({ message: "Invalid resolution status" });
      }
      if (!resolution) {
        return res.status(400).json({ message: "Resolution note is required" });
      }

      const dispute = await storage.resolveCommissionDispute(req.params.id, {
        status,
        resolution,
        resolvedAmount: resolvedAmount || null,
        resolvedByUserId: req.user!.id,
      });

      if (!dispute) return res.status(404).json({ message: "Dispute not found" });

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "resolve_dispute",
        tableName: "commission_disputes",
        recordId: req.params.id,
        afterJson: JSON.stringify({ status, resolution, resolvedAmount }),
      });

      res.json(dispute);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to resolve dispute" });
    }
  });

  // Get pending disputes count (for badges)
  app.get("/api/admin/disputes/count/pending", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const count = await storage.getPendingDisputesCount();
      res.json({ count });
    } catch (error) {
      res.status(500).json({ message: "Failed to get count" });
    }
  });

  // ===================== FINANCE MODULE ROUTES =====================

  // Helper function to normalize customer name for matching
  function normalizeCustomerName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  }

  // Helper function to compute file hash
  function computeFileHash(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  // Helper to compute row fingerprint
  function computeRowFingerprint(clientId: string, customerNameNorm: string, saleDate: string, expectedAmountCents: number, serviceType: string): string {
    const data = `${clientId}|${customerNameNorm}|${saleDate}|${expectedAmountCents}|${serviceType}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  function tryAutoDetectColumnMapping(columns: string[], _clientId: string, _storage: any): { customerName: string; repName: string; saleDate: string; serviceType: string; utility: string; status: string; usage: string; rate: string; rejectionReason: string } | null {
    const colLower = columns.map(c => c.toLowerCase().trim());
    const findCol = (patterns: string[]): string => {
      for (const pattern of patterns) {
        const idx = colLower.findIndex(c => c === pattern || c.includes(pattern));
        if (idx >= 0) return columns[idx];
      }
      return '';
    };

    const customerName = findCol(['customer name', 'customer_name', 'customername']);
    const saleDate = findCol(['date sold', 'date_sold', 'datesold', 'sale date', 'sale_date', 'saledate', 'install date']);
    const status = findCol(['status', 'client status', 'client_status']);

    if (!customerName || !saleDate || !status) {
      return null;
    }

    return {
      customerName,
      repName: findCol(['rep name', 'rep_name', 'repname', 'sales rep', 'representative']),
      saleDate,
      serviceType: findCol(['service type', 'service_type', 'servicetype', 'service', 'product']),
      utility: findCol(['utility', 'provider', 'vendor']),
      status,
      usage: findCol(['usage', 'usage units', 'usage_units', 'units']),
      rate: findCol(['rate', 'amount', 'commission', 'price', 'payment']),
      rejectionReason: findCol(['rejection reason', 'rejection_reason', 'reason', 'reject reason']),
    };
  }

  function extractRepNameFromSheet(rows: any[][]): string | null {
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      const row = rows[i];
      if (row && row[0] && typeof row[0] === 'string' && row[0].toLowerCase() === 'name') {
        const val = row[2] || row[1];
        if (val && typeof val === 'string') {
          return val.replace(/^Iron Crest\s*-\s*/i, '').trim();
        }
      }
    }
    return null;
  }

  function extractRepCodeFromSheet(rows: any[][]): string | null {
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      const row = rows[i];
      if (row && row[0] && typeof row[0] === 'string' && row[0].toLowerCase() === 'repcode') {
        const val = row[2] || row[1];
        if (val !== undefined && val !== null) return String(val).split(',')[0].trim();
      }
    }
    return null;
  }

  function findDataTableInSheet(rows: any[][]): { columns: string[]; rows: any[][] } {
    const knownHeaders = ['customer name', 'service type', 'utility', 'client', 'date sold', 'status', 'usage', 'rate'];
    const masterHeaders = ['repcode', 'account number', 'customer name', 'utility', 'service type', 'date sold', 'status', 'client', 'state', 'usage'];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 3) continue;

      const cellValues = row.map((c: any) => (c != null ? String(c).toLowerCase().trim() : ''));

      const matchesKnown = knownHeaders.filter(h => cellValues.includes(h)).length;
      const matchesMaster = masterHeaders.filter(h => cellValues.includes(h)).length;

      if (matchesKnown >= 4 || matchesMaster >= 4) {
        const columns = row.map((c: any) => c != null ? String(c).trim() : `Column ${row.indexOf(c)}`);
        const dataRows: any[][] = [];
        for (let j = i + 1; j < rows.length; j++) {
          const dRow = rows[j];
          if (!dRow || dRow.length === 0 || dRow.every((c: any) => c == null || c === '')) break;
          if (dRow[0] && typeof dRow[0] === 'string' && 
              (dRow[0].toLowerCase().includes('chargeback') || dRow[0].toLowerCase().includes('meter chargeback'))) break;
          dataRows.push(dRow);
        }
        return { columns, rows: dataRows };
      }
    }

    if (rows.length > 1 && rows[0] && rows[0].length >= 2) {
      const firstRowHasNums = rows[1]?.some((c: any) => typeof c === 'number');
      if (firstRowHasNums) {
        const columns = rows[0].map((c: any) => c != null ? String(c).trim() : 'Column');
        return { columns, rows: rows.slice(1).filter(r => r && r.length > 0 && !r.every((c: any) => c == null)) };
      }
    }

    return { columns: [], rows: [] };
  }

  // Get all finance imports
  app.get("/api/finance/imports", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const clientId = req.query.clientId as string | undefined;
      const imports = await storage.getFinanceImports(clientId);
      res.json(imports);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get finance imports" });
    }
  });

  // Get single finance import with summary
  app.get("/api/finance/imports/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const financeImport = await storage.getFinanceImportById(req.params.id);
      if (!financeImport) {
        return res.status(404).json({ message: "Import not found" });
      }
      res.json(financeImport);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get finance import" });
    }
  });

  // Delete finance import and all related data
  app.delete("/api/finance/imports/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const existing = await storage.getFinanceImportById(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Import not found" });
      }
      await storage.deleteFinanceImport(req.params.id);
      res.json({ message: "Import deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete finance import" });
    }
  });

  // Get finance import summary (counts by status)
  app.get("/api/finance/imports/:id/summary", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const counts = await storage.getFinanceImportRowCounts(req.params.id);
      const financeImport = await storage.getFinanceImportById(req.params.id);
      
      // Calculate totals
      let enrolled = 0, rejected = 0, pending = 0;
      let matched = 0, unmatched = 0, ambiguous = 0, ignored = 0;
      let totalExpectedCents = 0;

      for (const row of counts) {
        const status = row.clientStatus?.toUpperCase();
        if (status === 'ENROLLED' || status === 'ACCEPTED') enrolled += row.count;
        else if (status === 'REJECTED') rejected += row.count;
        else pending += row.count;

        if (row.matchStatus === 'MATCHED') matched += row.count;
        else if (row.matchStatus === 'UNMATCHED') unmatched += row.count;
        else if (row.matchStatus === 'AMBIGUOUS') ambiguous += row.count;
        else if (row.matchStatus === 'IGNORED') ignored += row.count;
      }

      res.json({
        financeImport,
        counts: {
          byClientStatus: { enrolled, rejected, pending },
          byMatchStatus: { matched, unmatched, ambiguous, ignored },
          totalRows: financeImport?.totalRows || 0,
          totalExpectedCents: financeImport?.totalAmountCents || 0
        }
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get import summary" });
    }
  });

  // List sheets in an Excel file
  app.post("/api/finance/import/sheets", auth, adminOnly, upload.single("file"), async (req: AuthRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      const fileName = req.file.originalname;
      const isXlsx = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
      if (!isXlsx) {
        return res.json({ sheets: [] });
      }

      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const masterSheetNames = ['master', 'master report', 'summary', 'all reps', 'combined'];
      const sheets = workbook.SheetNames.map((name: string) => {
        const ws = workbook.Sheets[name];
        const allRows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
        let repName = extractRepNameFromSheet(allRows);
        const repCode = extractRepCodeFromSheet(allRows);
        const dataInfo = findDataTableInSheet(allRows);
        const isMasterSheet = masterSheetNames.includes(name.toLowerCase().trim());
        if (!repName && !isMasterSheet) {
          repName = name.trim();
        }
        return {
          name,
          repName,
          repCode,
          repNameSource: repName ? (extractRepNameFromSheet(allRows) ? 'header' : 'tab_name') : null,
          rowCount: dataInfo.rows.length,
          hasData: dataInfo.rows.length > 0,
          preview: dataInfo.rows.slice(0, 3),
          columns: dataInfo.columns,
        };
      });
      res.json({ sheets });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to read sheets" });
    }
  });

  // Upload and import a finance file
  app.post("/api/finance/import", auth, adminOnly, upload.single("file"), async (req: AuthRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { clientId, periodStart, periodEnd, forceReimport, sheetName: selectedSheet, repNameOverride } = req.body;
      if (!clientId) {
        return res.status(400).json({ message: "Client ID is required" });
      }

      // Determine source type
      const fileName = req.file.originalname;
      const isXlsx = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
      const sourceType = isXlsx ? 'XLSX' : 'CSV';

      // Compute file hash (include sheet name for uniqueness)
      const hashInput = selectedSheet ? req.file.buffer.toString('base64') + '::' + selectedSheet : req.file.buffer.toString('base64');
      const fileHash = crypto.createHash('sha256').update(hashInput).digest('hex');

      // Check for duplicate import
      const existingImport = await storage.getFinanceImportByClientAndHash(clientId, fileHash);
      if (existingImport && !forceReimport) {
        return res.status(409).json({ 
          message: "This file has already been imported for this client",
          existingImportId: existingImport.id
        });
      }

      // Parse file
      let rows: any[] = [];
      let detectedRepName: string | null = repNameOverride || null;
      if (isXlsx) {
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = selectedSheet || workbook.SheetNames[0];
        if (!workbook.SheetNames.includes(sheetName)) {
          return res.status(400).json({ message: `Sheet "${sheetName}" not found in file` });
        }
        const ws = workbook.Sheets[sheetName];
        const allRows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
        
        if (!detectedRepName) {
          detectedRepName = extractRepNameFromSheet(allRows);
        }
        if (!detectedRepName && selectedSheet) {
          const masterSheetNames = ['master', 'master report', 'summary', 'all reps', 'combined'];
          if (!masterSheetNames.includes(selectedSheet.toLowerCase().trim())) {
            detectedRepName = selectedSheet.trim();
          }
        }
        
        const dataInfo = findDataTableInSheet(allRows);
        if (dataInfo.columns.length > 0 && dataInfo.rows.length > 0) {
          rows = dataInfo.rows.map(row => {
            const obj: any = {};
            dataInfo.columns.forEach((col, i) => {
              obj[col] = row[i] ?? null;
            });
            return obj;
          });
        } else {
          rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
        }
      } else {
        const csvParse = await import('csv-parse/sync');
        rows = csvParse.parse(req.file.buffer, { columns: true, skip_empty_lines: true });
      }

      if (rows.length === 0) {
        return res.status(400).json({ message: "File contains no data rows" });
      }

      // Inject rep name into rows if detected from sheet header
      if (detectedRepName) {
        rows.forEach(row => {
          if (!row['Rep Name'] && !row['rep_name']) {
            row['Rep Name'] = detectedRepName;
          }
        });
      }

      const importFileName = selectedSheet ? `${fileName} [${selectedSheet}]` : fileName;

      // Create finance import record
      const financeImport = await storage.createFinanceImport({
        clientId,
        periodStart: periodStart || null,
        periodEnd: periodEnd || null,
        sourceType: sourceType as any,
        fileName: importFileName,
        fileHash,
        importedByUserId: req.user!.id,
        status: 'IMPORTED',
        totalRows: rows.length,
        totalAmountCents: 0
      });

      // Store raw rows
      const rawRows = rows.map((row, index) => ({
        financeImportId: financeImport.id,
        rowIndex: index,
        rawJson: JSON.stringify(row),
        rawTextFingerprint: computeRowFingerprint(
          clientId,
          normalizeCustomerName(row['Customer Name'] || row['customer_name'] || ''),
          row['Date Sold'] || row['date_sold'] || '',
          0,
          row['Service Type'] || row['service_type'] || ''
        )
      }));

      await storage.createFinanceImportRowsRaw(rawRows);

      const columns = Object.keys(rows[0]);
      const preview = rows.slice(0, 20);

      const autoMapping = tryAutoDetectColumnMapping(columns, clientId, storage);
      let autoMapped = false;
      let normalizedCount = 0;

      if (autoMapping) {
        const createdRawRows = await storage.getFinanceImportRowsRaw(financeImport.id);
        const normalizedRows: any[] = [];
        let totalAmountCents = 0;
        const seenFingerprints = new Set<string>();

        for (const rawRow of createdRawRows) {
          const data = JSON.parse(rawRow.rawJson);
          const customerName = data[autoMapping.customerName] || '';
          const customerNameNorm = normalizeCustomerName(customerName);
          const repName = autoMapping.repName ? (data[autoMapping.repName] || '') : '';
          const repNameNorm = repName ? normalizeCustomerName(repName) : '';
          const serviceType = data[autoMapping.serviceType] || '';
          const utility = data[autoMapping.utility] || '';
          const saleDate = data[autoMapping.saleDate] || '';
          const clientStatus = data[autoMapping.status] || '';
          const usageUnits = parseFloat(data[autoMapping.usage]) || null;
          const rate = parseFloat(String(data[autoMapping.rate] || '0').replace(/[$,]/g, '')) || 0;
          const paidAmountCents = Math.round(rate * 100);
          const rejectionReason = data[autoMapping.rejectionReason] || null;

          const fingerprint = computeRowFingerprint(
            clientId,
            customerNameNorm,
            saleDate,
            paidAmountCents,
            serviceType
          );

          const isDuplicate = seenFingerprints.has(fingerprint);
          seenFingerprints.add(fingerprint);

          const statusUpper = clientStatus.toUpperCase();
          if (!isDuplicate && (statusUpper === 'ENROLLED' || statusUpper === 'ACCEPTED' || statusUpper === 'COMPLETED' || statusUpper === 'ACTIVE')) {
            totalAmountCents += paidAmountCents;
          }

          normalizedRows.push({
            financeImportId: financeImport.id,
            rawRowId: rawRow.id,
            customerName,
            customerNameNorm,
            repName: repName || null,
            repNameNorm: repNameNorm || null,
            serviceType,
            utility,
            saleDate: saleDate || null,
            clientStatus,
            usageUnits: usageUnits?.toString() || null,
            expectedAmountCents: 0,
            paidAmountCents,
            rejectionReason,
            matchStatus: 'UNMATCHED',
            matchConfidence: 0,
            isDuplicate
          });
        }

        await storage.createFinanceImportRows(normalizedRows);
        await storage.updateFinanceImport(financeImport.id, {
          status: 'MAPPED',
          totalAmountCents,
          columnMapping: JSON.stringify(autoMapping)
        });

        autoMapped = true;
        normalizedCount = normalizedRows.length;
      }

      const updatedImport = autoMapped ? await storage.getFinanceImportById(financeImport.id) : financeImport;

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "finance_import_created",
        tableName: "finance_imports",
        recordId: financeImport.id,
        afterJson: JSON.stringify({ fileName: importFileName, totalRows: rows.length, clientId, sheetName: selectedSheet || null, detectedRepName, autoMapped })
      });

      res.json({
        import: updatedImport || financeImport,
        columns,
        preview,
        totalRows: rows.length,
        detectedRepName,
        autoMapped,
        normalizedCount,
      });
    } catch (error: any) {
      console.error("Finance import error:", error);
      res.status(500).json({ message: error.message || "Failed to import file" });
    }
  });

  // Map columns and normalize rows
  app.post("/api/finance/imports/:id/map", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { mapping, saveAsDefault } = req.body;
      // mapping: { customerName: 'Customer Name', saleDate: 'Date Sold', ... }

      const financeImport = await storage.getFinanceImportById(req.params.id);
      if (!financeImport) {
        return res.status(404).json({ message: "Import not found" });
      }

      if (financeImport.status === 'POSTED' || financeImport.status === 'LOCKED') {
        return res.status(400).json({ message: "Cannot remap a posted or locked import" });
      }

      // Delete existing processed rows if re-mapping
      if (financeImport.status !== 'IMPORTED') {
        await storage.deleteFinanceImportRows(req.params.id);
      }

      // Get raw rows
      const rawRows = await storage.getFinanceImportRowsRaw(req.params.id);

      // Normalize rows based on mapping
      const normalizedRows: any[] = [];
      let totalAmountCents = 0;
      const seenFingerprints = new Set<string>();

      for (const rawRow of rawRows) {
        const data = JSON.parse(rawRow.rawJson);
        
        const customerName = data[mapping.customerName] || '';
        const customerNameNorm = normalizeCustomerName(customerName);
        const repName = mapping.repName ? (data[mapping.repName] || '') : '';
        const repNameNorm = repName ? normalizeCustomerName(repName) : '';
        const serviceType = data[mapping.serviceType] || '';
        const utility = data[mapping.utility] || '';
        const saleDate = data[mapping.saleDate] || '';
        const clientStatus = data[mapping.status] || '';
        const usageUnits = parseFloat(data[mapping.usage]) || null;
        const rate = parseFloat(String(data[mapping.rate] || '0').replace(/[$,]/g, '')) || 0;
        const paidAmountCents = Math.round(rate * 100);
        const rejectionReason = data[mapping.rejectionReason] || null;

        // Dedupe by fingerprint
        const fingerprint = computeRowFingerprint(
          financeImport.clientId,
          customerNameNorm,
          saleDate,
          paidAmountCents,
          serviceType
        );

        const isDuplicate = seenFingerprints.has(fingerprint);
        seenFingerprints.add(fingerprint);

        const statusUpper = clientStatus.toUpperCase();
        if (!isDuplicate && (statusUpper === 'ENROLLED' || statusUpper === 'ACCEPTED' || statusUpper === 'COMPLETED' || statusUpper === 'ACTIVE')) {
          totalAmountCents += paidAmountCents;
        }

        normalizedRows.push({
          financeImportId: req.params.id,
          rawRowId: rawRow.id,
          customerName,
          customerNameNorm,
          repName: repName || null,
          repNameNorm: repNameNorm || null,
          serviceType,
          utility,
          saleDate: saleDate || null,
          clientStatus,
          usageUnits: usageUnits?.toString() || null,
          expectedAmountCents: 0,
          paidAmountCents,
          rejectionReason,
          matchStatus: 'UNMATCHED',
          matchConfidence: 0,
          isDuplicate
        });
      }

      await storage.createFinanceImportRows(normalizedRows);

      // Update import status and total
      await storage.updateFinanceImport(req.params.id, {
        status: 'MAPPED',
        totalAmountCents,
        columnMapping: JSON.stringify(mapping)
      });

      // Save mapping as default if requested
      if (saveAsDefault) {
        // Clear existing default for this client
        const existingMappings = await storage.getClientColumnMappings(financeImport.clientId);
        for (const m of existingMappings) {
          if (m.isDefault) {
            await storage.updateClientColumnMapping(m.id, { isDefault: false });
          }
        }
        
        await storage.createClientColumnMapping({
          clientId: financeImport.clientId,
          name: 'Default',
          mappingJson: JSON.stringify(mapping),
          isDefault: true
        });
      }

      res.json({ success: true, normalizedCount: normalizedRows.length, totalAmountCents });
    } catch (error: any) {
      console.error("Finance mapping error:", error);
      res.status(500).json({ message: error.message || "Failed to map columns" });
    }
  });

  app.get("/api/finance/imports/:id/raw-rows", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const rows = await storage.getFinanceImportRowsRaw(req.params.id);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get raw rows" });
    }
  });

  // Get normalized rows for an import
  app.get("/api/finance/imports/:id/rows", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const matchStatus = req.query.matchStatus as string | undefined;
      const rows = await storage.getFinanceImportRows(req.params.id, matchStatus);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get rows" });
    }
  });

  // Run auto-matching for an import
  app.post("/api/finance/imports/:id/auto-match", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const financeImport = await storage.getFinanceImportById(req.params.id);
      if (!financeImport) {
        return res.status(404).json({ message: "Import not found" });
      }

      if (financeImport.status === 'POSTED' || financeImport.status === 'LOCKED') {
        return res.status(400).json({ message: "Cannot match a posted or locked import" });
      }

      if (financeImport.status === 'IMPORTED') {
        return res.status(400).json({ message: "Columns have not been mapped yet. Please map columns before running auto-match." });
      }

      const rows = await storage.getFinanceImportRows(req.params.id);

      if (rows.length === 0) {
        return res.status(400).json({ message: "No processed rows found. Please use 'Map Columns' first to create processed rows." });
      }

      const { force } = req.body || {};

      // Reset rows for re-matching
      for (const row of rows) {
        if (force || row.matchStatus === 'UNMATCHED' || row.matchStatus === 'AMBIGUOUS') {
          if (row.matchStatus !== 'IGNORED') {
            await storage.updateFinanceImportRow(row.id, { matchStatus: 'UNMATCHED', matchConfidence: 0, matchedOrderId: null, matchReason: null });
          }
        }
      }

      // Re-fetch after reset
      const freshRows = await storage.getFinanceImportRows(req.params.id);

      let matchedCount = 0;
      let ambiguousCount = 0;

      console.log(`[AutoMatch] Starting auto-match for import ${req.params.id} with ${freshRows.length} processed rows`);

      for (const row of freshRows) {
        if (row.matchStatus === 'MATCHED' || row.matchStatus === 'IGNORED' || row.isDuplicate) {
          continue;
        }

        if (!row.saleDate) continue;

        // Find candidate orders within date range (±30 days for flexibility)
        const saleDate = new Date(row.saleDate);
        if (isNaN(saleDate.getTime())) continue;
        const startDate = new Date(saleDate);
        startDate.setDate(startDate.getDate() - 30);
        const endDate = new Date(saleDate);
        endDate.setDate(endDate.getDate() + 30);

        const candidates = await storage.findOrdersForMatching(
          null,
          startDate.toISOString().split('T')[0],
          endDate.toISOString().split('T')[0]
        );

        console.log(`[AutoMatch] Row "${row.customerName}" (${row.saleDate}) -> ${candidates.length} candidate orders in range ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);

        if (candidates.length === 0) continue;

        // Token-based name similarity helper
        const nameTokenOverlap = (a: string, b: string): number => {
          if (!a || !b) return 0;
          const tokensA = a.split(' ').filter(Boolean);
          const tokensB = b.split(' ').filter(Boolean);
          if (tokensA.length === 0 || tokensB.length === 0) return 0;
          const matched = tokensA.filter(t => tokensB.includes(t)).length;
          return matched / Math.max(tokensA.length, tokensB.length);
        };

        // Score candidates
        const scored = candidates.map(order => {
          let score = 0;
          const reasons: string[] = [];

          // Account number matching (max 25 pts) - strong unique identifier
          if (row.customerName && order.accountNumber) {
            const rowAccount = (row.customerName || '').match(/\b\d{6,}\b/)?.[0];
            if (rowAccount && order.accountNumber.includes(rowAccount)) {
              score += 25;
              reasons.push('account_match:+25');
            }
          }

          // Customer name matching (max 40 pts) - token-based for better flexibility
          const orderNameNorm = normalizeCustomerName(order.customerName);
          const rowNameNorm = row.customerNameNorm || '';
          if (orderNameNorm && rowNameNorm) {
            if (orderNameNorm === rowNameNorm) {
              score += 40;
              reasons.push('exact_name_match:+40');
            } else {
              const overlap = nameTokenOverlap(orderNameNorm, rowNameNorm);
              if (overlap >= 0.8) {
                score += 35;
                reasons.push('strong_name_match:+35');
              } else if (overlap >= 0.5) {
                score += 25;
                reasons.push('good_name_match:+25');
              } else if (orderNameNorm.includes(rowNameNorm) || rowNameNorm.includes(orderNameNorm)) {
                score += 20;
                reasons.push('partial_name_match:+20');
              } else if (overlap > 0) {
                score += 10;
                reasons.push('weak_name_match:+10');
              }
            }
          }

          // Rep name matching (max 15 pts)
          if (row.repNameNorm && order.repName) {
            const orderRepNorm = normalizeCustomerName(order.repName);
            if (orderRepNorm === row.repNameNorm) {
              score += 15;
              reasons.push('exact_rep_match:+15');
            } else {
              const repOverlap = nameTokenOverlap(orderRepNorm, row.repNameNorm);
              if (repOverlap >= 0.5) {
                score += 10;
                reasons.push('partial_rep_match:+10');
              }
            }
          }

          // Rate/amount matching (max 15 pts)
          const rowAmount = row.paidAmountCents || row.expectedAmountCents || 0;
          if (rowAmount > 0) {
            const orderGrossCents = Math.round(
              (parseFloat(order.baseCommissionEarned || '0') + parseFloat(order.incentiveEarned || '0') + parseFloat(order.overrideDeduction || '0')) * 100
            );
            if (order.expectedAmountCents && order.expectedAmountCents === rowAmount) {
              score += 15;
              reasons.push('exact_amount_match:+15');
            } else if (orderGrossCents > 0 && Math.abs(orderGrossCents - rowAmount) <= 50) {
              score += 12;
              reasons.push('close_amount_match:+12');
            } else if (orderGrossCents > 0 && Math.abs(orderGrossCents - rowAmount) <= 200) {
              score += 7;
              reasons.push('near_amount_match:+7');
            }
          }

          // Date proximity (max 10 pts) - graduated scoring
          const orderDate = new Date(order.dateSold);
          const diffDays = Math.abs(saleDate.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24);
          if (diffDays <= 1) {
            score += 10;
            reasons.push('same_date:+10');
          } else if (diffDays <= 3) {
            score += 8;
            reasons.push('close_date:+8');
          } else if (diffDays <= 7) {
            score += 5;
            reasons.push('near_date:+5');
          } else if (diffDays <= 14) {
            score += 2;
            reasons.push('within_2wk:+2');
          }

          // Service type matching (max 5 pts) - actually compare against order service
          if (row.serviceType && order.serviceName) {
            const rowSvc = row.serviceType.toLowerCase();
            const orderSvc = (order.serviceName as string).toLowerCase();
            if (rowSvc === orderSvc) {
              score += 5;
              reasons.push('exact_service_match:+5');
            } else if (rowSvc.includes(orderSvc) || orderSvc.includes(rowSvc)) {
              score += 3;
              reasons.push('partial_service_match:+3');
            } else {
              const svcKeywords: Record<string, string[]> = {
                internet: ['internet', 'fiber', 'data', 'broadband', 'gig', 'wifi'],
                tv: ['tv', 'television', 'video', 'cable'],
                mobile: ['mobile', 'phone', 'wireless', 'cell'],
                voice: ['voice', 'phone', 'landline'],
                bundle: ['bundle', 'package', 'combo'],
              };
              for (const [, keywords] of Object.entries(svcKeywords)) {
                const rowHit = keywords.some(k => rowSvc.includes(k));
                const orderHit = keywords.some(k => orderSvc.includes(k));
                if (rowHit && orderHit) {
                  score += 3;
                  reasons.push('category_service_match:+3');
                  break;
                }
              }
            }
          }

          // Address matching (max 5 pts) - compare city/zip if available
          if (order.city && row.customerName) {
            const orderCityNorm = (order.city as string).toLowerCase().trim();
            const rowText = (row.customerName || '').toLowerCase();
            if (rowText.includes(orderCityNorm)) {
              score += 2;
              reasons.push('city_hint:+2');
            }
          }
          if (order.zipCode && row.customerName) {
            const rowText = (row.customerName || '').toLowerCase();
            if (rowText.includes(order.zipCode as string)) {
              score += 3;
              reasons.push('zip_hint:+3');
            }
          }

          return { order, score, reasons };
        });

        // Sort by score descending
        scored.sort((a, b) => b.score - a.score);

        if (scored.length > 0 && scored[0].score >= 50) {
          const topScore = scored[0].score;
          const closeMatches = scored.filter(s => s.score >= 50 && topScore - s.score <= 10);

          if (closeMatches.length > 1) {
            // Ambiguous
            await storage.updateFinanceImportRow(row.id, {
              matchStatus: 'AMBIGUOUS',
              matchConfidence: topScore,
              matchReason: JSON.stringify({
                candidates: closeMatches.slice(0, 5).map(c => ({
                  orderId: c.order.id,
                  score: c.score,
                  reasons: c.reasons
                }))
              })
            });
            ambiguousCount++;
          } else {
            // Matched - set expectedAmountCents from matched order's gross commission
            const matchedOrder = scored[0].order;
            const grossCommissionCents = Math.round(
              (parseFloat(matchedOrder.baseCommissionEarned || '0') + parseFloat(matchedOrder.incentiveEarned || '0') + parseFloat(matchedOrder.overrideDeduction || '0')) * 100
            );
            await storage.updateFinanceImportRow(row.id, {
              matchedOrderId: matchedOrder.id,
              matchStatus: 'MATCHED',
              matchConfidence: scored[0].score,
              expectedAmountCents: grossCommissionCents,
              matchReason: JSON.stringify({
                orderId: matchedOrder.id,
                score: scored[0].score,
                reasons: scored[0].reasons
              })
            });
            matchedCount++;
          }
        }
      }

      // Update import status
      await storage.updateFinanceImport(req.params.id, { status: 'MATCHED' });

      res.json({ matchedCount, ambiguousCount });
    } catch (error: any) {
      console.error("Auto-match error:", error);
      res.status(500).json({ message: error.message || "Failed to run auto-match" });
    }
  });

  // Manual match a row to an order
  app.post("/api/finance/imports/:id/manual-match", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { rowId, orderId } = req.body;
      if (!rowId || !orderId) {
        return res.status(400).json({ message: "Row ID and Order ID are required" });
      }

      const row = await storage.getFinanceImportRowById(rowId);
      if (!row || row.financeImportId !== req.params.id) {
        return res.status(404).json({ message: "Row not found" });
      }

      const order = await storage.getOrderById(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      const grossCommissionCents = Math.round(
        (parseFloat(order.baseCommissionEarned || '0') + parseFloat(order.incentiveEarned || '0') + parseFloat(order.overrideDeduction || '0')) * 100
      );
      await storage.updateFinanceImportRow(rowId, {
        matchedOrderId: orderId,
        matchStatus: 'MATCHED',
        matchConfidence: 100,
        expectedAmountCents: grossCommissionCents,
        matchReason: JSON.stringify({ manual: true, matchedBy: req.user!.id })
      });

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to manual match" });
    }
  });

  // Get matched order details for reconciliation review
  app.get("/api/finance/imports/:id/matched-order/:rowId", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const row = await storage.getFinanceImportRowById(req.params.rowId);
      if (!row || row.financeImportId !== req.params.id) {
        return res.status(404).json({ message: "Row not found" });
      }
      if (!row.matchedOrderId) {
        return res.status(400).json({ message: "Row is not matched to an order" });
      }

      const order = await storage.getOrderById(row.matchedOrderId);
      if (!order) {
        return res.status(404).json({ message: "Matched order not found" });
      }

      const allProviders = await storage.getProviders();
      const allServices = await storage.getServices();
      const rep = order.repId ? await storage.getUserByRepId(order.repId) : null;

      const baseComm = parseFloat(order.baseCommissionEarned as string || '0') || 0;
      const incEarned = parseFloat(order.incentiveEarned as string || '0') || 0;
      const overrideDed = parseFloat(order.overrideDeduction as string || '0') || 0;
      const grossCommission = baseComm + incEarned;
      const netCommission = grossCommission - overrideDed;

      res.json({
        order: {
          id: order.id,
          customerName: order.customerName,
          invoiceNumber: order.invoiceNumber,
          dateSold: order.dateSold,
          serviceId: order.serviceId,
          providerId: order.providerId,
          repId: order.repId,
          repName: rep?.name || null,
          baseCommissionEarned: baseComm,
          incentiveEarned: incEarned,
          overrideDeduction: overrideDed,
          grossCommission,
          netCommission,
        },
        providers: allProviders,
        services: allServices,
        importRow: {
          customerName: row.customerName,
          repName: row.repName,
          serviceType: row.serviceType,
          expectedAmountCents: row.expectedAmountCents,
          paidAmountCents: row.paidAmountCents,
        }
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get matched order details" });
    }
  });

  // Reconciliation adjustment - adjust order fields during matching
  app.patch("/api/finance/imports/:id/reconcile-order", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { rowId, orderId, adjustments } = req.body;
      if (!rowId || !orderId) {
        return res.status(400).json({ message: "Row ID and Order ID are required" });
      }

      const row = await storage.getFinanceImportRowById(rowId);
      if (!row || row.financeImportId !== req.params.id) {
        return res.status(404).json({ message: "Row not found in this import" });
      }

      const order = await storage.getOrderById(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      const updateData: any = { updatedAt: new Date() };
      let commissionChanged = false;

      if (adjustments.serviceId && adjustments.serviceId !== order.serviceId) {
        updateData.serviceId = adjustments.serviceId;
      }
      if (adjustments.providerId && adjustments.providerId !== order.providerId) {
        updateData.providerId = adjustments.providerId;
      }
      if (adjustments.baseCommissionEarned !== undefined) {
        const val = parseFloat(adjustments.baseCommissionEarned);
        if (isNaN(val) || val < 0) return res.status(400).json({ message: "Invalid base commission value" });
        updateData.baseCommissionEarned = val.toString();
        commissionChanged = true;
      }
      if (adjustments.incentiveEarned !== undefined) {
        const val = parseFloat(adjustments.incentiveEarned);
        if (isNaN(val) || val < 0) return res.status(400).json({ message: "Invalid incentive value" });
        updateData.incentiveEarned = val.toString();
        commissionChanged = true;
      }
      if (adjustments.overrideDeduction !== undefined) {
        const val = parseFloat(adjustments.overrideDeduction);
        if (isNaN(val) || val < 0) return res.status(400).json({ message: "Invalid override deduction value" });
        updateData.overrideDeduction = val.toString();
        commissionChanged = true;
      }

      if (commissionChanged) {
        updateData.commissionSource = 'MANUAL_OVERRIDE';
        updateData.calcAt = new Date();

        if (order.paymentStatus === "PAID") {
          const newBase = updateData.baseCommissionEarned !== undefined
            ? parseFloat(updateData.baseCommissionEarned)
            : parseFloat(order.baseCommissionEarned);
          const newIncentive = updateData.incentiveEarned !== undefined
            ? parseFloat(updateData.incentiveEarned)
            : parseFloat(order.incentiveEarned);
          updateData.commissionPaid = (newBase + newIncentive).toFixed(2);
        }
      }

      if (Object.keys(updateData).length > 1) {
        await storage.updateOrder(orderId, updateData);

        if (commissionChanged && order.paymentStatus === "PAID") {
          const lineItems = await storage.getPayStatementLineItemsBySourceId("sales_order", orderId);
          const newBase = updateData.baseCommissionEarned !== undefined
            ? updateData.baseCommissionEarned
            : order.baseCommissionEarned;
          const newIncentive = updateData.incentiveEarned !== undefined
            ? updateData.incentiveEarned
            : order.incentiveEarned;

          const affectedStatementIds = new Set<string>();

          for (const item of lineItems) {
            if (item.category === "Commission") {
              await storage.updatePayStatementLineItem(item.id, { amount: newBase });
              affectedStatementIds.add(item.payStatementId);
            } else if (item.category === "Incentive") {
              await storage.updatePayStatementLineItem(item.id, { amount: newIncentive });
              affectedStatementIds.add(item.payStatementId);
            }
          }

          for (const statementId of affectedStatementIds) {
            const allItems = await storage.getPayStatementLineItems(statementId);
            let grossCommission = 0;
            let incentivesTotal = 0;
            let chargebacksTotal = 0;

            for (const item of allItems) {
              const amt = parseFloat(item.amount);
              if (item.category === "Commission") grossCommission += amt;
              else if (item.category === "Incentive") incentivesTotal += amt;
              else if (item.category === "Chargeback") chargebacksTotal += Math.abs(amt);
            }

            const statement = await storage.getPayStatementById(statementId);
            if (statement) {
              const overrideEarningsTotal = parseFloat(statement.overrideEarningsTotal || "0");
              const deductionsTotal = parseFloat(statement.deductionsTotal || "0");
              const advancesApplied = parseFloat(statement.advancesApplied || "0");
              const taxWithheld = parseFloat(statement.taxWithheld || "0");
              const netPay = grossCommission + incentivesTotal + overrideEarningsTotal - chargebacksTotal - deductionsTotal - advancesApplied - taxWithheld;

              await storage.updatePayStatement(statementId, {
                grossCommission: grossCommission.toFixed(2),
                incentivesTotal: incentivesTotal.toFixed(2),
                chargebacksTotal: chargebacksTotal.toFixed(2),
                netPay: netPay.toFixed(2),
              });
            }
          }
        }

        await storage.createAuditLog({
          userId: req.user!.id,
          action: 'RECONCILIATION_ADJUSTMENT',
          entityType: 'ORDER',
          entityId: orderId,
          details: JSON.stringify({
            financeImportId: req.params.id,
            rowId,
            adjustments,
            previousValues: {
              serviceId: order.serviceId,
              providerId: order.providerId,
              baseCommissionEarned: order.baseCommissionEarned,
              incentiveEarned: order.incentiveEarned,
              overrideDeduction: order.overrideDeduction,
              commissionPaid: order.commissionPaid,
              paymentStatus: order.paymentStatus,
            }
          })
        });

        // Cascade commission changes to AR expectation
        if (commissionChanged) {
          try {
            const arExpectation = await storage.getArExpectationByOrderId(orderId);
            if (arExpectation) {
              const updatedOrder = await storage.getOrderById(orderId);
              const newBase = parseFloat(updatedOrder?.baseCommissionEarned || "0");
              const newIncentive = parseFloat(updatedOrder?.incentiveEarned || "0");
              const newOverride = parseFloat(updatedOrder?.overrideDeduction || "0");
              const newExpectedCents = Math.round((newBase + newIncentive + newOverride) * 100);
              const newVarianceCents = arExpectation.actualAmountCents - newExpectedCents;
              await storage.updateArExpectation(arExpectation.id, {
                expectedAmountCents: newExpectedCents,
                varianceAmountCents: newVarianceCents,
                hasVariance: newVarianceCents !== 0,
              });
            }
          } catch (arErr) {
            console.error("[Reconcile] Failed to cascade commission change to AR:", arErr);
          }
        }
      }

      res.json({ success: true, updatedOrder: await storage.getOrderById(orderId) });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to apply reconciliation adjustment" });
    }
  });

  // Create order from unmatched finance import row
  app.post("/api/finance/imports/:id/create-order", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { rowId, providerId, serviceId, repId } = req.body;
      if (!rowId || !providerId || !serviceId) {
        return res.status(400).json({ message: "Row ID, Provider ID, and Service ID are required" });
      }

      const row = await storage.getFinanceImportRowById(rowId);
      if (!row || row.financeImportId !== req.params.id) {
        return res.status(404).json({ message: "Row not found in this import" });
      }

      if (row.matchStatus === 'MATCHED') {
        return res.status(400).json({ message: "Row is already matched to an order" });
      }

      const financeImport = await storage.getFinanceImportById(req.params.id);
      if (!financeImport) {
        return res.status(404).json({ message: "Import not found" });
      }

      const rateCents = row.paidAmountCents || row.expectedAmountCents || 0;
      const rateDecimal = (rateCents / 100).toFixed(2);

      let assignedRepId: string | null = null;
      if (repId) {
        const rep = await storage.getUserByRepId(repId);
        if (rep) {
          assignedRepId = repId;
        }
      }

      const orderData: any = {
        clientId: financeImport.clientId,
        providerId,
        serviceId,
        dateSold: row.saleDate || new Date().toISOString().split('T')[0],
        customerName: row.customerName || 'Unknown Customer',
        repId: assignedRepId,
        baseCommissionEarned: rateDecimal,
        incentiveEarned: "0",
        overrideDeduction: "0",
        commissionPaid: "0",
        commissionSource: 'MANUAL_OVERRIDE',
        jobStatus: 'COMPLETED',
        approvalStatus: 'APPROVED',
        approvedByUserId: req.user!.id,
        approvedAt: new Date(),
        calcAt: new Date(),
        paymentStatus: 'UNPAID',
        exportedToAccounting: false,
        tvSold: false,
        mobileSold: false,
        isMobileOrder: false,
        mobileLinesQty: 0,
        notes: `Created from finance import row. Service: ${row.serviceType || 'N/A'}`,
      };

      const newOrder = await storage.createOrder(orderData);

      await storage.updateFinanceImportRow(rowId, {
        matchedOrderId: newOrder.id,
        matchStatus: 'MATCHED',
        matchConfidence: 100,
        matchReason: JSON.stringify(['created_from_import:+100']),
      });

      await storage.createAuditLog({
        userId: req.user!.id,
        action: 'ORDER_CREATED_FROM_IMPORT',
        entityType: 'ORDER',
        entityId: newOrder.id,
        details: JSON.stringify({
          financeImportId: req.params.id,
          rowId,
          customerName: row.customerName,
          rateCents,
        })
      });

      res.json({ success: true, order: newOrder });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to create order from import row" });
    }
  });

  // Ignore a row
  app.post("/api/finance/imports/:id/ignore-row", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { rowId, reason } = req.body;
      if (!rowId) {
        return res.status(400).json({ message: "Row ID is required" });
      }

      await storage.updateFinanceImportRow(rowId, {
        matchStatus: 'IGNORED',
        ignoreReason: reason || 'Manually ignored'
      });

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to ignore row" });
    }
  });

  // Post an import (create AR expectations and update orders)
  app.post("/api/finance/imports/:id/post", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const financeImport = await storage.getFinanceImportById(req.params.id);
      if (!financeImport) {
        return res.status(404).json({ message: "Import not found" });
      }

      if (financeImport.status === 'POSTED' || financeImport.status === 'LOCKED') {
        return res.status(400).json({ message: "Import has already been posted" });
      }

      const rows = await storage.getFinanceImportRows(req.params.id);
      let arCreated = 0;
      let ordersAccepted = 0;
      let ordersRejected = 0;

      const orderRowGroups: Record<string, typeof rows> = {};
      for (const row of rows) {
        if (row.isDuplicate) continue;
        if (row.matchStatus === 'MATCHED' && row.matchedOrderId) {
          if (!orderRowGroups[row.matchedOrderId]) {
            orderRowGroups[row.matchedOrderId] = [];
          }
          orderRowGroups[row.matchedOrderId].push(row);
        }
      }

      for (const [orderId, groupRows] of Object.entries(orderRowGroups)) {
        const enrolledRows = groupRows.filter(r => {
          const status = (r.clientStatus || '').toUpperCase();
          return status === 'ENROLLED' || status === 'ACCEPTED' || status === 'COMPLETED' || status === 'ACTIVE';
        });
        const rejectedRows = groupRows.filter(r => {
          const status = (r.clientStatus || '').toUpperCase();
          return status === 'REJECTED';
        });

        if (enrolledRows.length > 0) {
          const totalPaidCents = enrolledRows.reduce((sum, r) => sum + (r.paidAmountCents || 0), 0);

          const order = await storage.getOrderById(orderId);
          const orderBase = Math.round(parseFloat(order?.baseCommissionEarned || "0") * 100);
          const orderIncentive = Math.round(parseFloat(order?.incentiveEarned || "0") * 100);
          const orderOverride = Math.round(parseFloat(order?.overrideDeduction || "0") * 100);
          const expectedCents = orderBase + orderIncentive + orderOverride;

          await storage.setOrderClientAcceptance(
            orderId,
            'ACCEPTED',
            expectedCents || undefined
          );
          ordersAccepted++;

          const primaryRow = enrolledRows[0];
          const existingArByRow = await storage.getArExpectationByRowId(primaryRow.id);
          const existingArByOrder = existingArByRow ? existingArByRow : await storage.getArExpectationByOrderId(orderId);
          if (!existingArByOrder) {
            const varianceCents = totalPaidCents - expectedCents;
            let arStatus: string = 'OPEN';
            if (totalPaidCents > 0 && totalPaidCents >= expectedCents) {
              arStatus = 'SATISFIED';
            } else if (totalPaidCents > 0) {
              arStatus = 'PARTIAL';
            }
            await storage.createArExpectation({
              clientId: financeImport.clientId,
              orderId: orderId,
              financeImportRowId: primaryRow.id,
              expectedAmountCents: expectedCents,
              actualAmountCents: totalPaidCents,
              varianceAmountCents: varianceCents,
              expectedFromDate: primaryRow.saleDate || new Date().toISOString().split('T')[0],
              status: arStatus
            });
            arCreated++;
            
            // When AR is created as satisfied, mark order completed, approved, and paid
            if (arStatus === 'SATISFIED' && order) {
              const orderUpdate: Record<string, any> = {
                paymentStatus: 'PAID',
                paidDate: new Date().toISOString().split('T')[0],
              };
              if (order.jobStatus !== 'COMPLETED') orderUpdate.jobStatus = 'COMPLETED';
              if (order.approvalStatus !== 'APPROVED') orderUpdate.approvalStatus = 'APPROVED';
              await storage.updateOrder(orderId, orderUpdate);
            }
          }
        } else if (rejectedRows.length > 0) {
          await storage.setOrderClientAcceptance(orderId, 'REJECTED');
          ordersRejected++;
        }
      }

      // Update import status
      await storage.updateFinanceImport(req.params.id, { status: 'POSTED' });

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "finance_import_posted",
        tableName: "finance_imports",
        recordId: req.params.id,
        afterJson: JSON.stringify({ arCreated, ordersAccepted, ordersRejected })
      });

      res.json({ success: true, arCreated, ordersAccepted, ordersRejected });
    } catch (error: any) {
      console.error("Post error:", error);
      res.status(500).json({ message: error.message || "Failed to post import" });
    }
  });

  // Lock an import
  app.post("/api/finance/imports/:id/lock", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const financeImport = await storage.getFinanceImportById(req.params.id);
      if (!financeImport) {
        return res.status(404).json({ message: "Import not found" });
      }

      if (financeImport.status !== 'POSTED') {
        return res.status(400).json({ message: "Only posted imports can be locked" });
      }

      await storage.updateFinanceImport(req.params.id, { status: 'LOCKED' });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to lock import" });
    }
  });

  // AR Expectations endpoints
  app.get("/api/finance/ar", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const clientId = req.query.clientId as string | undefined;
      const status = req.query.status as string | undefined;
      const hasVariance = req.query.hasVariance === 'true' ? true : req.query.hasVariance === 'false' ? false : undefined;
      const expectations = await storage.getArExpectations(clientId, status, hasVariance);
      const enriched = await Promise.all(expectations.map(async (ar: any) => {
        let repName: string | null = null;
        if (ar.order?.repId) {
          const repUser = await storage.getUserByRepId(ar.order.repId);
          repName = repUser?.name || ar.order.repId;
        }
        return { ...ar, order: ar.order ? { ...ar.order, repName } : ar.order };
      }));
      res.json(enriched);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get AR expectations" });
    }
  });

  app.get("/api/finance/ar/export", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const clientId = req.query.clientId as string | undefined;
      const status = req.query.status as string | undefined;
      const hasVariance = req.query.hasVariance === 'true' ? true : req.query.hasVariance === 'false' ? false : undefined;
      const expectations = await storage.getArExpectations(clientId, status, hasVariance);

      const header = "Client,Invoice Number,Customer Name,Status,Expected Amount,Amount Paid,Balance,Variance,Variance Reason,Has Variance,Expected From Date,Satisfied At,Written Off At,Written Off Reason,Created At\n";
      const rows = expectations.map((ar: any) => {
        const expectedDollars = (ar.expectedAmountCents / 100).toFixed(2);
        const actualDollars = (ar.actualAmountCents / 100).toFixed(2);
        const balanceDollars = ((ar.expectedAmountCents - ar.actualAmountCents) / 100).toFixed(2);
        const varianceDollars = (ar.varianceAmountCents / 100).toFixed(2);
        const esc = (v: string | null | undefined) => {
          if (!v) return '';
          return `"${v.replace(/"/g, '""')}"`;
        };
        return [
          esc(ar.client?.name || ar.clientId),
          esc(ar.order?.invoiceNumber || ''),
          esc(ar.order?.customerName || ''),
          ar.status,
          expectedDollars,
          actualDollars,
          balanceDollars,
          varianceDollars,
          esc(ar.varianceReason),
          ar.hasVariance ? 'Yes' : 'No',
          ar.expectedFromDate || '',
          ar.satisfiedAt ? new Date(ar.satisfiedAt).toISOString().split('T')[0] : '',
          ar.writtenOffAt ? new Date(ar.writtenOffAt).toISOString().split('T')[0] : '',
          esc(ar.writtenOffReason),
          ar.createdAt ? new Date(ar.createdAt).toISOString().split('T')[0] : '',
        ].join(',');
      });

      const csv = header + rows.join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="ar-export-${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csv);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to export AR" });
    }
  });

  app.get("/api/finance/ar/summary", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const summary = await storage.getArSummaryByClient();
      res.json(summary);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get AR summary" });
    }
  });

  // Get single AR expectation with payments
  app.get("/api/finance/ar/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const ar = await storage.getArExpectationById(req.params.id);
      if (!ar) return res.status(404).json({ message: "AR expectation not found" });
      let repName: string | null = null;
      if (ar.order?.repId) {
        const repUser = await storage.getUserByRepId(ar.order.repId);
        repName = repUser?.name || ar.order.repId;
      }
      res.json({ ...ar, order: ar.order ? { ...ar.order, repName } : ar.order });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get AR expectation" });
    }
  });

  // Record a payment against an AR expectation
  app.post("/api/finance/ar/:id/payments", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { amountCents: rawAmountCents, paymentDate, paymentReference, paymentMethod, notes } = req.body;
      
      // Strict numeric validation
      const amountCents = typeof rawAmountCents === 'number' ? rawAmountCents : parseInt(rawAmountCents, 10);
      if (isNaN(amountCents) || amountCents <= 0) {
        return res.status(400).json({ message: "Valid positive payment amount is required" });
      }
      
      const ar = await storage.getArExpectationById(req.params.id);
      if (!ar) return res.status(404).json({ message: "AR expectation not found" });
      
      // Create the payment
      const payment = await storage.createArPayment({
        arExpectationId: req.params.id,
        amountCents,
        paymentDate: paymentDate || new Date().toISOString().split('T')[0],
        paymentReference,
        paymentMethod,
        notes,
        recordedByUserId: req.user!.id,
      });
      
      // Calculate new totals
      const allPayments = await storage.getArPaymentsByExpectationId(req.params.id);
      const totalPaidCents = allPayments.reduce((sum, p) => sum + p.amountCents, 0);
      const varianceCents = totalPaidCents - ar.expectedAmountCents;
      const hasVariance = varianceCents !== 0;
      
      // Determine new status
      let newStatus = ar.status;
      if (totalPaidCents === 0) {
        newStatus = 'OPEN';
      } else if (totalPaidCents >= ar.expectedAmountCents) {
        newStatus = 'SATISFIED';
      } else if (totalPaidCents > 0) {
        newStatus = 'PARTIAL';
      }
      
      // Update the AR expectation
      await storage.updateArExpectation(req.params.id, {
        actualAmountCents: totalPaidCents,
        varianceAmountCents: varianceCents,
        hasVariance,
        status: newStatus,
        satisfiedAt: newStatus === 'SATISFIED' ? new Date() : null,
      });
      
      // When AR is satisfied, mark the linked order as completed, approved, and paid
      if (newStatus === 'SATISFIED' && ar.orderId) {
        const order = await storage.getOrderById(ar.orderId);
        if (order) {
          const orderUpdate: Record<string, any> = {
            paymentStatus: 'PAID',
            paidDate: new Date().toISOString().split('T')[0],
          };
          if (order.jobStatus !== 'COMPLETED') orderUpdate.jobStatus = 'COMPLETED';
          if (order.approvalStatus !== 'APPROVED') orderUpdate.approvalStatus = 'APPROVED';
          
          await storage.updateOrder(ar.orderId, orderUpdate);
          
          await storage.createAuditLog({
            action: "order_payment_status_updated",
            tableName: "sales_orders",
            recordId: ar.orderId,
            afterJson: JSON.stringify({ ...orderUpdate, reason: 'AR satisfied', arId: req.params.id }),
            userId: req.user!.id,
          });
        }
      } else if (newStatus === 'PARTIAL' && ar.orderId) {
        const order = await storage.getOrderById(ar.orderId);
        if (order && order.paymentStatus !== 'PAID') {
          await storage.updateOrder(ar.orderId, {
            paymentStatus: 'PARTIALLY_PAID',
          });
        }
      }
      
      await storage.createAuditLog({
        action: "ar_payment_recorded",
        tableName: "ar_payments",
        recordId: payment.id,
        afterJson: JSON.stringify({ payment, totalPaidCents, varianceCents, newStatus }),
        userId: req.user!.id,
      });
      
      res.json({ payment, totalPaidCents, varianceCents, newStatus });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to record payment" });
    }
  });

  // Delete an AR payment
  app.delete("/api/finance/ar/payments/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      // Find the payment to get its AR expectation ID
      const payment = await db.query.arPayments.findFirst({
        where: eq(arPayments.id, req.params.id)
      });
      
      if (!payment) return res.status(404).json({ message: "Payment not found" });
      
      const arId = payment.arExpectationId;
      await storage.deleteArPayment(req.params.id);
      
      // Recalculate totals for the AR expectation
      const ar = await storage.getArExpectationById(arId);
      if (ar) {
        const allPayments = await storage.getArPaymentsByExpectationId(arId);
        const totalPaidCents = allPayments.reduce((sum, p) => sum + p.amountCents, 0);
        const varianceCents = totalPaidCents - ar.expectedAmountCents;
        const hasVariance = varianceCents !== 0;
        
        let newStatus = 'OPEN';
        if (totalPaidCents >= ar.expectedAmountCents) {
          newStatus = 'SATISFIED';
        } else if (totalPaidCents > 0) {
          newStatus = 'PARTIAL';
        }
        
        await storage.updateArExpectation(arId, {
          actualAmountCents: totalPaidCents,
          varianceAmountCents: varianceCents,
          hasVariance,
          status: newStatus,
          satisfiedAt: newStatus === 'SATISFIED' ? new Date() : null,
        });
        
        // Update linked order's status based on new AR status
        if (ar.orderId) {
          const order = await storage.getOrderById(ar.orderId);
          if (order) {
            const orderUpdate: Record<string, any> = {};
            if (newStatus === 'SATISFIED') {
              orderUpdate.paymentStatus = 'PAID';
              orderUpdate.paidDate = new Date().toISOString().split('T')[0];
              if (order.jobStatus !== 'COMPLETED') orderUpdate.jobStatus = 'COMPLETED';
              if (order.approvalStatus !== 'APPROVED') orderUpdate.approvalStatus = 'APPROVED';
            } else if (newStatus === 'PARTIAL') {
              orderUpdate.paymentStatus = 'PARTIALLY_PAID';
            } else if (newStatus === 'OPEN') {
              orderUpdate.paymentStatus = 'UNPAID';
            }
            
            if (Object.keys(orderUpdate).length > 0 && orderUpdate.paymentStatus !== order.paymentStatus) {
              await storage.updateOrder(ar.orderId, orderUpdate);
              
              await storage.createAuditLog({
                action: "order_payment_status_updated",
                tableName: "sales_orders",
                recordId: ar.orderId,
                afterJson: JSON.stringify({ ...orderUpdate, reason: 'AR payment deleted', arId }),
                userId: req.user!.id,
              });
            }
          }
        }
      }
      
      await storage.createAuditLog({
        action: "ar_payment_deleted",
        tableName: "ar_payments",
        recordId: req.params.id,
        beforeJson: JSON.stringify(payment),
        userId: req.user!.id,
      });
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete payment" });
    }
  });

  // Update variance reason for an AR expectation
  app.patch("/api/finance/ar/:id/variance", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { varianceReason } = req.body;
      
      const ar = await storage.getArExpectationById(req.params.id);
      if (!ar) return res.status(404).json({ message: "AR expectation not found" });
      
      const updated = await storage.updateArExpectation(req.params.id, {
        varianceReason,
      });
      
      await storage.createAuditLog({
        action: "ar_variance_reason_updated",
        tableName: "ar_expectations",
        recordId: req.params.id,
        beforeJson: JSON.stringify({ varianceReason: ar.varianceReason }),
        afterJson: JSON.stringify({ varianceReason }),
        userId: req.user!.id,
      });
      
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to update variance reason" });
    }
  });

  // Update expected amount for an AR expectation
  app.patch("/api/finance/ar/:id/expected-amount", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { expectedAmountCents, reason } = req.body;
      
      if (typeof expectedAmountCents !== 'number' || expectedAmountCents < 0) {
        return res.status(400).json({ message: "Valid expected amount is required" });
      }
      
      const ar = await storage.getArExpectationById(req.params.id);
      if (!ar) return res.status(404).json({ message: "AR expectation not found" });
      
      if (ar.status === 'WRITTEN_OFF') {
        return res.status(400).json({ message: "Cannot edit written off AR expectations" });
      }
      
      const oldExpected = ar.expectedAmountCents;
      const varianceCents = ar.actualAmountCents - expectedAmountCents;
      const hasVariance = varianceCents !== 0;
      
      // Determine new status based on updated expected
      let newStatus = ar.status;
      if (ar.actualAmountCents === 0) {
        newStatus = 'OPEN';
      } else if (ar.actualAmountCents >= expectedAmountCents) {
        newStatus = 'SATISFIED';
      } else if (ar.actualAmountCents > 0) {
        newStatus = 'PARTIAL';
      }
      
      const updated = await storage.updateArExpectation(req.params.id, {
        expectedAmountCents,
        varianceAmountCents: varianceCents,
        hasVariance,
        status: newStatus,
        satisfiedAt: newStatus === 'SATISFIED' ? new Date() : null,
      });
      
      // If now satisfied, mark order as completed, approved, and paid
      if (newStatus === 'SATISFIED' && ar.orderId) {
        const order = await storage.getOrderById(ar.orderId);
        if (order) {
          const orderUpdate: Record<string, any> = {
            paymentStatus: 'PAID',
            paidDate: new Date().toISOString().split('T')[0],
          };
          if (order.jobStatus !== 'COMPLETED') orderUpdate.jobStatus = 'COMPLETED';
          if (order.approvalStatus !== 'APPROVED') orderUpdate.approvalStatus = 'APPROVED';
          await storage.updateOrder(ar.orderId, orderUpdate);
        }
      }
      
      await storage.createAuditLog({
        action: "ar_expected_amount_updated",
        tableName: "ar_expectations",
        recordId: req.params.id,
        beforeJson: JSON.stringify({ expectedAmountCents: oldExpected }),
        afterJson: JSON.stringify({ expectedAmountCents, reason, newStatus }),
        userId: req.user!.id,
      });
      
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to update expected amount" });
    }
  });

  // Write off an AR expectation
  app.post("/api/finance/ar/:id/write-off", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { reason } = req.body;
      if (!reason) return res.status(400).json({ message: "Write-off reason is required" });
      
      const ar = await storage.getArExpectationById(req.params.id);
      if (!ar) return res.status(404).json({ message: "AR expectation not found" });
      
      const updated = await storage.updateArExpectation(req.params.id, {
        status: 'WRITTEN_OFF',
        writtenOffAt: new Date(),
        writtenOffByUserId: req.user!.id,
        writtenOffReason: reason,
      });
      
      await storage.createAuditLog({
        action: "ar_written_off",
        tableName: "ar_expectations",
        recordId: req.params.id,
        afterJson: JSON.stringify({ reason }),
        userId: req.user!.id,
      });
      
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to write off AR" });
    }
  });

  // Finance Reports
  app.get("/api/finance/reports/enrolled", auth, executiveOrAdmin, async (req: AuthRequest, res) => {
    try {
      const groupBy = req.query.groupBy as string || 'global';
      const period = req.query.period as string || 'month';
      
      // Calculate date range
      const now = new Date();
      let startDate: string;
      let endDate = now.toISOString().split('T')[0];

      switch (period) {
        case 'week':
          const weekStart = new Date(now);
          const wDay = now.getDay();
          weekStart.setDate(now.getDate() + (wDay === 0 ? -6 : 1 - wDay)); // Monday start
          startDate = weekStart.toISOString().split('T')[0];
          break;
        case 'ytd':
          startDate = `${now.getFullYear()}-01-01`;
          break;
        case 'month':
        default:
          startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      }

      if (groupBy === 'rep') {
        const data = await storage.getEnrolledReportByRep(startDate, endDate);
        res.json(data);
      } else {
        const data = await storage.getEnrolledReportGlobal(startDate, endDate);
        res.json(data);
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get report" });
    }
  });

  // Get client column mappings
  app.get("/api/finance/column-mappings", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const clientId = req.query.clientId as string;
      if (!clientId) {
        return res.status(400).json({ message: "Client ID is required" });
      }
      const mappings = await storage.getClientColumnMappings(clientId);
      res.json(mappings);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get column mappings" });
    }
  });

  // Get default column mapping for a client
  app.get("/api/finance/column-mappings/default", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const clientId = req.query.clientId as string;
      if (!clientId) {
        return res.status(400).json({ message: "Client ID is required" });
      }
      const mapping = await storage.getDefaultClientColumnMapping(clientId);
      res.json(mapping || null);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get default mapping" });
    }
  });

  // ============ INSTALL SYNC ROUTES ============

  app.get("/api/admin/install-sync/history", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      if (!["ADMIN", "OPERATIONS"].includes(user.role)) {
        return res.status(403).json({ message: "Only ADMIN or OPERATIONS can access install sync" });
      }
      const runs = await storage.getInstallSyncRuns(50);
      const enriched = await Promise.all(runs.map(async (run) => {
        const runByUser = await storage.getUserById(run.runByUserId);
        return { ...run, runByName: runByUser?.name || "Unknown" };
      }));
      res.json(enriched);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch sync history" });
    }
  });

  app.post("/api/admin/install-sync/reverse-approvals", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      if (!["ADMIN", "OPERATIONS"].includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { orderIds } = req.body;
      if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ message: "orderIds array is required" });
      }

      let reversedCount = 0;
      for (const orderId of orderIds) {
        const order = await storage.getOrderById(orderId);
        if (!order || order.approvalStatus !== "APPROVED") continue;

        const beforeJson = JSON.stringify(order);
        const updatedOrder = await storage.updateOrder(orderId, {
          approvalStatus: "UNAPPROVED",
          approvedByUserId: null,
          approvedAt: null,
          jobStatus: "PENDING",
        });

        await storage.createAuditLog({
          action: "install_sync_reverse_approval",
          tableName: "sales_orders",
          recordId: orderId,
          beforeJson,
          afterJson: JSON.stringify(updatedOrder),
          userId: user.id,
        });

        reversedCount++;
      }

      res.json({ message: `Reversed ${reversedCount} approvals`, reversedCount });
    } catch (error: any) {
      console.error("[Install Sync] Reversal error:", error.message);
      res.status(500).json({ message: error.message });
    }
  });

  const syncUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

  app.post("/api/admin/install-sync/run", auth, syncUpload.single("file"), async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      if (!["ADMIN", "OPERATIONS"].includes(user.role)) {
        return res.status(403).json({ message: "Only ADMIN or OPERATIONS can run install sync" });
      }

      const { sheetUrl, emailTo, autoApprove } = req.body;
      const shouldAutoApprove = autoApprove === "true" || autoApprove === true;

      const syncRun = await storage.createInstallSyncRun({
        sheetUrl: sheetUrl || null,
        sourceType: req.file ? "csv_upload" : "google_sheet",
        emailTo: emailTo || null,
        runByUserId: user.id,
        status: "RUNNING",
      });

      try {
        let sheetData;
        if (req.file) {
          const csvContent = req.file.buffer.toString("utf-8");
          sheetData = await parseUploadedCsv(csvContent);
        } else if (sheetUrl) {
          sheetData = await fetchGoogleSheet(sheetUrl);
        } else {
          throw new Error("Please provide either a Google Sheet URL or upload a CSV file.");
        }

        await storage.updateInstallSyncRun(syncRun.id, { totalSheetRows: sheetData.rows.length });

        const pendingOrders = await storage.getPendingUnapprovedOrders();

        const allProviders = await storage.getProviders();
        const providerMap = new Map(allProviders.map(p => [p.id, p.name]));

        const orderSummaries: OrderSummary[] = await Promise.all(
          pendingOrders.map(async (order) => {
            const rep = await storage.getUserByRepId(order.repId);
            const providerName = order.providerId ? (providerMap.get(order.providerId) || "") : "";
            return {
              id: order.id,
              invoiceNumber: order.invoiceNumber || "",
              customerName: order.customerName,
              houseNumber: order.houseNumber || "",
              streetName: order.streetName || "",
              aptUnit: order.aptUnit || "",
              city: order.city || "",
              zipCode: order.zipCode || "",
              serviceType: order.serviceType || "",
              providerName,
              repName: rep?.name || "",
              dateSold: order.dateSold || "",
              jobStatus: order.jobStatus,
              approvalStatus: order.approvalStatus,
            };
          })
        );

        const matchResult = await matchInstallationsToOrders(sheetData.rows, orderSummaries);

        let approvedCount = 0;
        const approvedOrders: any[] = [];
        const statusUpdatedOrders: any[] = [];

        if (matchResult.matches.length > 0) {
          const now = new Date();
          for (const match of matchResult.matches) {
            const woStatus = (match.sheetData?.WO_STATUS || "").trim().toUpperCase();

            const order = await storage.getOrderById(match.orderId);
            if (!order) continue;

            const beforeJson = JSON.stringify(order);
            const updates: Record<string, any> = {};

            if (woStatus === "CP") {
              if (order.jobStatus !== "COMPLETED") {
                updates.jobStatus = "COMPLETED";
              }
              if (shouldAutoApprove && match.confidence >= 70 && order.approvalStatus !== "APPROVED") {
                updates.approvalStatus = "APPROVED";
                updates.approvedByUserId = user.id;
                updates.approvedAt = now;
              }
            } else if (woStatus === "CN") {
              if (order.jobStatus !== "CANCELED") {
                updates.jobStatus = "CANCELED";
              }
              if (order.approvalStatus === "APPROVED") {
                updates.approvalStatus = "UNAPPROVED";
                updates.approvedByUserId = null;
                updates.approvedAt = null;
              }
            } else if (woStatus === "OP") {
              if (order.jobStatus !== "PENDING") {
                updates.jobStatus = "PENDING";
              }
              if (order.approvalStatus === "APPROVED") {
                updates.approvalStatus = "UNAPPROVED";
                updates.approvedByUserId = null;
                updates.approvedAt = null;
              }
            } else if (woStatus === "ND") {
              if (order.jobStatus !== "PENDING") {
                updates.jobStatus = "PENDING";
              }
              if (order.approvalStatus === "APPROVED") {
                updates.approvalStatus = "UNAPPROVED";
                updates.approvedByUserId = null;
                updates.approvedAt = null;
              }
            }

            if (Object.keys(updates).length === 0) continue;

            const updatedOrder = await storage.updateOrder(match.orderId, updates);

            if (updatedOrder && updates.approvalStatus === "APPROVED") {
              const overrideEarnings = await generateOverrideEarnings(order, updatedOrder);
              for (const earning of overrideEarnings) {
                await storage.createOverrideEarning(earning);
              }
              approvedOrders.push(updatedOrder);
              approvedCount++;
            } else if (updatedOrder) {
              statusUpdatedOrders.push(updatedOrder);
            }

            await storage.createAuditLog({
              action: updates.approvalStatus === "APPROVED" ? "install_sync_approve" : "install_sync_status_update",
              tableName: "sales_orders",
              recordId: match.orderId,
              beforeJson,
              afterJson: JSON.stringify(updatedOrder),
              userId: user.id,
            });
          }
        }

        let emailSent = false;
        if (emailTo && approvedOrders.length > 0) {
          const allServices = await storage.getServices();
          const serviceMap = new Map(allServices.map(s => [s.id, s.name]));
          const allClients = await storage.getClients();
          const clientMap = new Map(allClients.map(c => [c.id, c.name]));

          const csvHeaders = [
            "Invoice #", "Rep ID", "Rep Name", "Customer Name", "Customer Address",
            "House Number", "Street Name", "Apt/Unit", "City", "Zip Code",
            "Customer Phone", "Customer Email", "Account Number",
            "Client", "Provider", "Service Type",
            "Date Sold", "Install Date", "Install Time", "Install Type",
            "Job Status", "Approval Status", "Approved At",
            "TV Sold", "Mobile Sold", "Mobile Lines Qty",
            "Base Commission", "Incentive", "Override Deduction",
            "Gross Commission", "Net Commission",
            "Payment Status", "Paid Date", "Commission Paid",
            "Notes", "Created At",
          ];

          const csvRows = await Promise.all(approvedOrders.map(async (o) => {
            const rep = o.repId ? await storage.getUserByRepId(o.repId) : null;
            const grossCommission = parseFloat(o.baseCommissionEarned || "0") + parseFloat(o.incentiveEarned || "0");
            const netCommission = grossCommission - parseFloat(o.overrideDeduction || "0");
            return [
              o.invoiceNumber || "",
              o.repId || "",
              rep?.name || "",
              o.customerName || "",
              o.customerAddress || "",
              o.houseNumber || "",
              o.streetName || "",
              o.aptUnit || "",
              o.city || "",
              o.zipCode || "",
              o.customerPhone || "",
              o.customerEmail || "",
              o.accountNumber || "",
              o.clientId ? (clientMap.get(o.clientId) || "") : "",
              o.providerId ? (providerMap.get(o.providerId) || "") : "",
              o.serviceId ? (serviceMap.get(o.serviceId) || "") : "",
              o.dateSold || "",
              o.installDate || "",
              o.installTime || "",
              o.installType || "",
              o.jobStatus || "",
              o.approvalStatus || "",
              o.approvedAt ? new Date(o.approvedAt).toLocaleString() : "",
              o.tvSold ? "Yes" : "No",
              o.mobileSold ? "Yes" : "No",
              String(o.mobileLinesQty || 0),
              o.baseCommissionEarned || "0",
              o.incentiveEarned || "0",
              o.overrideDeduction || "0",
              grossCommission.toFixed(2),
              netCommission.toFixed(2),
              o.paymentStatus || "",
              o.paidDate || "",
              o.commissionPaid || "0",
              o.notes || "",
              o.createdAt ? new Date(o.createdAt).toLocaleString() : "",
            ];
          }));

          const csvContent = [csvHeaders, ...csvRows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
          const d = new Date();
          const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          const filename = `install-sync-approved-${dateStr}.csv`;

          const statusSummary = statusUpdatedOrders.length > 0
            ? `\n- Orders with status updated (not approved): ${statusUpdatedOrders.length}`
            : "";

          emailSent = await emailService.sendCsvExportEmail(
            emailTo,
            `Install Sync: ${approvedCount} Orders Approved - ${dateStr}`,
            `The automated install sync has approved ${approvedCount} orders based on installation confirmation data.\n\nPlease find the CSV export attached.\n\nSync Summary:\n- Sheet rows processed: ${sheetData.rows.length}\n- Orders matched: ${matchResult.matches.length}\n- Orders approved: ${approvedCount}${statusSummary}\n- Unmatched records: ${matchResult.unmatched.length}`,
            csvContent,
            filename
          );
        }

        await storage.updateInstallSyncRun(syncRun.id, {
          totalSheetRows: sheetData.rows.length,
          matchedCount: matchResult.matches.length,
          approvedCount,
          unmatchedCount: matchResult.unmatched.length,
          emailSent,
          status: "COMPLETED",
          summary: matchResult.summary,
          matchDetails: JSON.stringify({
            matches: matchResult.matches.map((m) => ({
              sheetRowIndex: m.sheetRowIndex,
              sheetData: m.sheetData,
              orderId: m.orderId,
              orderInvoice: m.orderInvoice,
              orderCustomerName: m.orderCustomerName,
              confidence: m.confidence,
              reasoning: m.reasoning,
            })),
            unmatched: matchResult.unmatched,
          }),
          completedAt: new Date(),
        });

        res.json({
          syncRunId: syncRun.id,
          totalSheetRows: sheetData.rows.length,
          matchedCount: matchResult.matches.length,
          approvedCount,
          unmatchedCount: matchResult.unmatched.length,
          emailSent,
          summary: matchResult.summary,
          matches: matchResult.matches,
          unmatched: matchResult.unmatched,
        });
      } catch (innerError: any) {
        await storage.updateInstallSyncRun(syncRun.id, {
          status: "FAILED",
          errorMessage: innerError.message,
          completedAt: new Date(),
        });
        throw innerError;
      }
    } catch (error: any) {
      console.error("[Install Sync] Error:", error.message);
      res.status(500).json({ message: error.message || "Install sync failed" });
    }
  });

  return httpServer;
}

// Helper function for scheduled pay runs
function calculateNextRunFromNow(frequency: string, dayOfWeek?: number | null, dayOfMonth?: number | null): Date {
  const now = new Date();
  let next = new Date(now);
  
  switch (frequency) {
    case "WEEKLY":
      next.setDate(next.getDate() + 7);
      if (dayOfWeek !== null && dayOfWeek !== undefined) {
        const currentDay = next.getDay();
        const daysUntil = (dayOfWeek - currentDay + 7) % 7;
        if (daysUntil === 0) next.setDate(next.getDate() + 7);
        else next.setDate(next.getDate() + daysUntil);
      }
      break;
    case "BIWEEKLY":
      next.setDate(next.getDate() + 14);
      break;
    case "SEMIMONTHLY":
      if (now.getDate() < 15) {
        next.setDate(15);
      } else {
        next.setMonth(next.getMonth() + 1);
        next.setDate(1);
      }
      break;
    case "MONTHLY":
    default:
      next.setMonth(next.getMonth() + 1);
      if (dayOfMonth !== null && dayOfMonth !== undefined) {
        const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
        next.setDate(Math.min(dayOfMonth, lastDay));
      }
      break;
  }
  
  return next;
}
