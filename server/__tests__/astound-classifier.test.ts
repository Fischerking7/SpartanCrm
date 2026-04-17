import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DATABASE_URL ||= 'postgres://test';
  process.env.SESSION_SECRET ||= 'test-secret';
  process.env.ASTOUND_PORTAL_BASE_URL ||= 'https://example.invalid';
  process.env.ASTOUND_PASSWORD ||= 'test-password';
});

import { classifyLookup, type PortalLookupResult } from '../astound/classifier';
import { parseLookupHtml } from '../astound/portalClient';
import { verifyAddress } from '../astound/verifier';

function makeResult(partial: Partial<PortalLookupResult> = {}): PortalLookupResult {
  return {
    rawHtml: '',
    hasMovingInButton: false,
    isMdu: false,
    mduUnits: [],
    ...partial,
  };
}

describe('classifyLookup', () => {
  it('classifies Moving In button as ACTIVE and marks shouldIgnore', () => {
    const c = classifyLookup(makeResult({ hasMovingInButton: true }));
    expect(c.status).toBe('ACTIVE');
    expect(c.shouldIgnore).toBe(true);
    expect(c.shouldCallIn).toBe(false);
  });

  it('classifies out-of-service-area messages as OUT_OF_BOUNDS and marks shouldIgnore', () => {
    const c = classifyLookup(makeResult({ detectedMessage: 'Address is outside our service area' }));
    expect(c.status).toBe('OUT_OF_BOUNDS');
    expect(c.shouldIgnore).toBe(true);
    expect(c.shouldCallIn).toBe(false);
  });

  it('classifies non-serviceable / not-a-customer as CALL_IN', () => {
    const c1 = classifyLookup(makeResult({ detectedMessage: 'This address is non-serviceable' }));
    expect(c1.status).toBe('CALL_IN');
    expect(c1.shouldCallIn).toBe(true);

    const c2 = classifyLookup(makeResult({ detectedMessage: "Lead does not exist for this address" }));
    expect(c2.status).toBe('CALL_IN');
    expect(c2.shouldCallIn).toBe(true);
  });

  it('falls back to UNKNOWN when nothing matches', () => {
    const c = classifyLookup(makeResult({ detectedMessage: 'Please try again later' }));
    expect(c.status).toBe('UNKNOWN');
    expect(c.shouldCallIn).toBe(false);
    expect(c.shouldIgnore).toBe(false);
  });

  it('prefers ACTIVE over any other signal when Moving In present', () => {
    const c = classifyLookup(makeResult({
      hasMovingInButton: true,
      detectedMessage: 'out of bounds',
    }));
    expect(c.status).toBe('ACTIVE');
  });
});

describe('parseLookupHtml', () => {
  it('detects the Moving In green button', () => {
    const html = '<button class="btn green">Moving In</button>';
    const r = parseLookupHtml(html);
    expect(r.hasMovingInButton).toBe(true);
  });

  it('extracts MDU unit options', () => {
    const html = `
      <select name="unit">
        <option value="">Select unit</option>
        <option value="101">Apt 101</option>
        <option value="102">Apt 102</option>
        <option value="103">Apt 103</option>
      </select>
    `;
    const r = parseLookupHtml(html);
    expect(r.mduUnits.length).toBe(3);
    expect(r.isMdu).toBe(true);
  });

  it('captures the status message', () => {
    const html = '<div class="alert">Address is outside our service area</div>';
    const r = parseLookupHtml(html);
    expect(r.detectedMessage).toMatch(/outside our service area/i);
  });
});

describe('verifyAddress MDU expansion', () => {
  it('iterates each unit for an MDU address and collects call-ins', async () => {
    const baseHtml = `
      <select name="unit">
        <option value="">Select</option>
        <option value="1A">Apt 1A</option>
        <option value="1B">Apt 1B</option>
        <option value="1C">Apt 1C</option>
      </select>
    `;
    const perUnit: Record<string, PortalLookupResult> = {
      '1A': makeResult({ hasMovingInButton: true }),
      '1B': makeResult({ detectedMessage: 'non-serviceable' }),
      '1C': makeResult({ detectedMessage: 'out of our service area' }),
    };

    const result = await verifyAddress('123 Main St', {
      writeToSheet: false,
      client: {
        async login() {},
        async lookupAddress(_address: string, unit?: string) {
          if (!unit) return parseLookupHtml(baseHtml);
          return perUnit[unit]!;
        },
      },
    });

    expect(result.isMdu).toBe(true);
    expect(result.records).toHaveLength(3);
    expect(result.callIns).toHaveLength(1);
    expect(result.callIns[0].unit).toBe('1B');
    expect(result.ignored).toHaveLength(2);
  });

  it('skips sheet write when all units are ignored (active or out-of-bounds)', async () => {
    const result = await verifyAddress('999 Skip Ln', {
      writeToSheet: false,
      client: {
        async login() {},
        async lookupAddress() {
          return makeResult({ hasMovingInButton: true });
        },
      },
    });
    expect(result.callIns).toHaveLength(0);
    expect(result.writtenToSheet).toBe(0);
  });
});
