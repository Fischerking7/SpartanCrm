import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { scheduler } from "./scheduler";
import { initForceLogoutFromDb } from "./auth";
import { storage } from "./storage";

const app = express();
const httpServer = createServer(app);

// Trust proxy for rate limiting to work correctly behind reverse proxies
app.set('trust proxy', 1);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  if (req.path.startsWith("/api")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    
    // Production error logging with context
    const errorLog = {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      status,
      message: err.message,
      stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
    };
    console.error('[ERROR]', JSON.stringify(errorLog));

    res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    async () => {
      log(`serving on port ${port}`);

      try {
        console.log('[STARTUP] Running Iron Crest health checks...');
        const { db: dbConn } = await import("./db");
        const { sql: sqlTag } = await import("drizzle-orm");
        
        const checks: { name: string; fn: () => Promise<void> }[] = [
          { name: 'Database connection', fn: async () => { await dbConn.execute(sqlTag`SELECT 1`); } },
          { name: 'JWT_SECRET configured', fn: async () => { if (!process.env.SESSION_SECRET && !process.env.JWT_SECRET) throw new Error('Missing'); } },
          { name: 'Rate cards configured', fn: async () => {
            const cards = await storage.getActiveRateCards();
            if (cards.length === 0) console.warn('[STARTUP] WARNING: No active rate cards');
          }},
          { name: 'Permissions system loaded', fn: async () => {
            const { PERMISSIONS } = await import("./permissions");
            const permCount = Object.keys(PERMISSIONS).length;
            if (permCount < 10) throw new Error(`Only ${permCount} permissions defined`);
          }},
        ];

        let passed = 0, failed = 0;
        for (const check of checks) {
          try { await check.fn(); console.log(`[STARTUP] ✓ ${check.name}`); passed++; }
          catch (err: any) { console.error(`[STARTUP] ✗ ${check.name}: ${err.message}`); failed++; }
        }
        console.log(`[STARTUP] Health check complete: ${passed} passed, ${failed} failed`);
      } catch (err: any) {
        console.error('[STARTUP] Health check error:', err.message);
      }

      try {
        const { seedSystemSettings } = await import("./seedSystemSettings");
        await seedSystemSettings();
      } catch (err: any) {
        console.error('[STARTUP] system_settings seed warning:', err.message);
      }

      await initForceLogoutFromDb(storage);
      scheduler.start();
    },
  );
})();
