function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Required environment variable ${key} is not set. ` +
      `Check .env.example for required variables.`
    );
  }
  return value;
}

export const config = {
  database: {
    url: requireEnv('DATABASE_URL'),
  },
  auth: {
    jwtSecret: requireEnv('SESSION_SECRET'),
    sessionSecret: requireEnv('SESSION_SECRET'),
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    fromNumber: process.env.TWILIO_FROM_NUMBER || '',
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
  },
  encryption: {
    key: process.env.ENCRYPTION_KEY || '',
  },
  quickbooks: {
    environment: process.env.QB_ENVIRONMENT || 'sandbox',
    clientId: process.env.QB_CLIENT_ID || '',
    clientSecret: process.env.QB_CLIENT_SECRET || '',
    redirectUri: process.env.QB_REDIRECT_URI || '',
  },
  aws: {
    publicSearchPaths: process.env.PUBLIC_OBJECT_SEARCH_PATHS || '',
    privateDir: process.env.PRIVATE_OBJECT_DIR || '',
  },
  app: {
    frontendUrl: process.env.FRONTEND_URL || '',
    onboardingUrl: process.env.ONBOARDING_URL || '',
    appUrl: process.env.APP_URL || '',
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '5000'),
    replitDevDomain: process.env.REPLIT_DEV_DOMAIN || '',
  },
  ops: {
    opsEmail: process.env.OPS_EMAIL || 'ironcrestoperations@ironcrestai.com',
  },
  carrier: {
    webhookSecret: process.env.CARRIER_WEBHOOK_SECRET || '',
  },
  ai: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || '',
    anthropicBaseUrl: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL || '',
  },
  bootstrap: {
    opsRepId: process.env.BOOTSTRAP_OPERATIONS_REPID || '',
    opsPassword: process.env.BOOTSTRAP_OPERATIONS_PASSWORD || '',
    opsName: process.env.BOOTSTRAP_OPERATIONS_NAME || '',
    adminRepId: process.env.BOOTSTRAP_ADMIN_REPID || '',
    adminPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD || '',
    adminName: process.env.BOOTSTRAP_ADMIN_NAME || '',
  },
  revenue: {
    multiplier: parseFloat(process.env.REVENUE_MULTIPLIER || '1'),
  },
  astound: {
    portalBaseUrl: process.env.ASTOUND_PORTAL_BASE_URL || '',
    loginPath: process.env.ASTOUND_LOGIN_PATH || '/login',
    lookupPath: process.env.ASTOUND_LOOKUP_PATH || '/serviceability',
    repId: process.env.ASTOUND_REP_ID || '66116',
    password: process.env.ASTOUND_PASSWORD || '',
    requestTimeoutMs: parseInt(process.env.ASTOUND_REQUEST_TIMEOUT_MS || '20000'),
  },
  googleSheets: {
    serviceAccountJson: process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON || '',
    sweepTurfSheetId: process.env.SWEEP_TURF_SHEET_ID || '',
    sweepTurfSheetTab: process.env.SWEEP_TURF_SHEET_TAB || 'Sheet1',
  },
} as const;
