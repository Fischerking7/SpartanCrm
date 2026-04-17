export type AstoundStatus = 'ACTIVE' | 'CALL_IN' | 'OUT_OF_BOUNDS' | 'UNKNOWN';

export interface PortalLookupResult {
  rawHtml: string;
  hasMovingInButton: boolean;
  isMdu: boolean;
  mduUnits: string[];
  detectedMessage?: string;
}

export interface Classification {
  status: AstoundStatus;
  reason: string;
  shouldIgnore: boolean;
  shouldCallIn: boolean;
}

const OUT_OF_BOUNDS_PATTERNS = [
  /out\s*of\s*bounds/i,
  /out\s*of\s*(?:our\s*)?service\s*area/i,
  /out\s*of\s*footprint/i,
  /not\s*in\s*our\s*service\s*area/i,
  /address\s*is\s*outside/i,
];

const CALL_IN_PATTERNS = [
  /not\s*a\s*(?:current\s*)?customer/i,
  /non[-\s]?serviceable/i,
  /lead\s*(?:does\s*not|doesn'?t)\s*exist/i,
  /no\s*lead\s*found/i,
  /serviceable[^a-z]*(?:yes|available)/i,
];

const MOVING_IN_PATTERNS = [
  /moving\s*in/i,
  /currently\s*active/i,
  /active\s*customer/i,
];

export function classifyLookup(result: PortalLookupResult): Classification {
  const hay = (result.detectedMessage || result.rawHtml || '').slice(0, 50000);

  if (result.hasMovingInButton || MOVING_IN_PATTERNS.some((re) => re.test(hay))) {
    return {
      status: 'ACTIVE',
      reason: 'Portal shows Moving In (green) button — customer is active',
      shouldIgnore: true,
      shouldCallIn: false,
    };
  }

  if (OUT_OF_BOUNDS_PATTERNS.some((re) => re.test(hay))) {
    return {
      status: 'OUT_OF_BOUNDS',
      reason: 'Address is outside Astound service area',
      shouldIgnore: true,
      shouldCallIn: false,
    };
  }

  if (CALL_IN_PATTERNS.some((re) => re.test(hay))) {
    return {
      status: 'CALL_IN',
      reason: 'Not a current Astound customer, non-serviceable, or lead does not exist',
      shouldIgnore: false,
      shouldCallIn: true,
    };
  }

  return {
    status: 'UNKNOWN',
    reason: 'Portal response did not match any known pattern',
    shouldIgnore: false,
    shouldCallIn: false,
  };
}
