import { config } from '../config';
import type { PortalLookupResult } from './classifier';

interface SessionCookies {
  jar: Map<string, string>;
}

function createJar(): SessionCookies {
  return { jar: new Map() };
}

function updateJarFromResponse(jar: SessionCookies, res: Response): void {
  const setCookieHeaders = (res.headers as any).getSetCookie?.() as string[] | undefined;
  const headers = setCookieHeaders ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie') as string] : []);
  for (const raw of headers) {
    const [kv] = raw.split(';');
    const eq = kv.indexOf('=');
    if (eq > 0) {
      jar.jar.set(kv.slice(0, eq).trim(), kv.slice(eq + 1).trim());
    }
  }
}

function cookieHeader(jar: SessionCookies): string {
  return Array.from(jar.jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function portalFetch(jar: SessionCookies, url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.astound.requestTimeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: 'manual',
      headers: {
        'User-Agent': 'IronCrestCRM/1.0 (+astound-verification)',
        Cookie: cookieHeader(jar),
        ...(init.headers || {}),
      },
    });
    updateJarFromResponse(jar, res);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (loc) {
        const next = new URL(loc, url).toString();
        return portalFetch(jar, next, { method: 'GET' });
      }
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export interface PortalClientOptions {
  baseUrl?: string;
  repId?: string;
  password?: string;
}

export interface AstoundPortalClient {
  login(): Promise<void>;
  lookupAddress(address: string, unit?: string): Promise<PortalLookupResult>;
}

export class HttpAstoundPortalClient implements AstoundPortalClient {
  private readonly baseUrl: string;
  private readonly repId: string;
  private readonly password: string;
  private readonly jar: SessionCookies = createJar();
  private loggedIn = false;

  constructor(opts: PortalClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? config.astound.portalBaseUrl).replace(/\/$/, '');
    this.repId = opts.repId ?? config.astound.repId;
    this.password = opts.password ?? config.astound.password;

    if (!this.baseUrl) throw new Error('ASTOUND_PORTAL_BASE_URL is not configured');
    if (!this.password) throw new Error('ASTOUND_PASSWORD is not configured');
  }

  async login(): Promise<void> {
    if (this.loggedIn) return;

    const loginUrl = this.baseUrl + config.astound.loginPath;
    const body = new URLSearchParams({
      repId: this.repId,
      username: this.repId,
      password: this.password,
    });

    const res = await portalFetch(this.jar, loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      throw new Error(`Astound login failed: HTTP ${res.status}`);
    }
    const html = await res.text();
    if (/invalid|incorrect/i.test(html) && /password|credentials/i.test(html)) {
      throw new Error('Astound login rejected the provided credentials');
    }
    this.loggedIn = true;
  }

  async lookupAddress(address: string, unit?: string): Promise<PortalLookupResult> {
    await this.login();

    const lookupUrl = new URL(this.baseUrl + config.astound.lookupPath);
    lookupUrl.searchParams.set('address', address);
    if (unit) lookupUrl.searchParams.set('unit', unit);

    const res = await portalFetch(this.jar, lookupUrl.toString(), { method: 'GET' });
    if (!res.ok) {
      throw new Error(`Astound lookup failed for ${address}: HTTP ${res.status}`);
    }
    const html = await res.text();
    return parseLookupHtml(html);
  }
}

export function parseLookupHtml(html: string): PortalLookupResult {
  const hasMovingInButton =
    /class="[^"]*(?:green|success)[^"]*"[^>]*>\s*moving\s*in/i.test(html) ||
    /<button[^>]*>\s*moving\s*in\s*<\/button>/i.test(html) ||
    /moving\s*in/i.test(html);

  const mduUnits = extractMduUnits(html);
  const isMdu = mduUnits.length > 1 || /multi[-\s]?dwelling|\bMDU\b|apartment\s*list/i.test(html);

  const messageMatch =
    html.match(/<div[^>]*class="[^"]*(?:message|status|alert)[^"]*"[^>]*>([\s\S]{0,500}?)<\/div>/i) ||
    html.match(/<p[^>]*class="[^"]*(?:message|status|alert)[^"]*"[^>]*>([\s\S]{0,500}?)<\/p>/i);
  const detectedMessage = messageMatch?.[1]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  return { rawHtml: html, hasMovingInButton, isMdu, mduUnits, detectedMessage };
}

function extractMduUnits(html: string): string[] {
  const units = new Set<string>();
  const optionRe = /<option[^>]*value="([^"]*)"[^>]*>\s*(?:apt|unit|#)?\s*([^<]+?)\s*<\/option>/gi;
  let m: RegExpExecArray | null;
  while ((m = optionRe.exec(html))) {
    const label = m[2].trim();
    if (label && !/select|choose/i.test(label)) units.add(label);
  }
  const liRe = /<li[^>]*data-unit="([^"]+)"/gi;
  while ((m = liRe.exec(html))) {
    units.add(m[1].trim());
  }
  return Array.from(units);
}
