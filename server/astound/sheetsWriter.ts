import { createSign } from 'node:crypto';
import { config } from '../config';

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

function parseServiceAccount(): ServiceAccountKey {
  const raw = config.googleSheets.serviceAccountJson;
  if (!raw) {
    throw new Error('GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON is not configured');
  }
  try {
    const parsed = JSON.parse(raw) as ServiceAccountKey;
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error('Service account JSON is missing client_email or private_key');
    }
    return { ...parsed, private_key: parsed.private_key.replace(/\\n/g, '\n') };
  } catch (err: any) {
    throw new Error(`Invalid GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON: ${err.message}`);
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.accessToken;
  }

  const sa = parseServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }));
  const toSign = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(toSign);
  const signature = base64url(signer.sign(sa.private_key));
  const assertion = `${toSign}.${signature}`;

  const res = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token request failed: HTTP ${res.status} ${text}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return json.access_token;
}

export interface SweepTurfRow {
  address: string;
  unit?: string;
  status: string;
  reason: string;
  checkedAt: string;
  repId: string;
}

export async function appendSweepTurfRows(rows: SweepTurfRow[]): Promise<void> {
  if (rows.length === 0) return;

  const sheetId = config.googleSheets.sweepTurfSheetId;
  if (!sheetId) throw new Error('SWEEP_TURF_SHEET_ID is not configured');
  const tab = config.googleSheets.sweepTurfSheetTab;

  const token = await getAccessToken();
  const range = encodeURIComponent(`${tab}!A:F`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const values = rows.map((r) => [r.checkedAt, r.address, r.unit || '', r.status, r.reason, r.repId]);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets append failed: HTTP ${res.status} ${text}`);
  }
}
