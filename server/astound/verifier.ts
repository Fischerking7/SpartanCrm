import { config } from '../config';
import { HttpAstoundPortalClient, type AstoundPortalClient } from './portalClient';
import { classifyLookup, type Classification } from './classifier';
import { appendSweepTurfRows, type SweepTurfRow } from './sheetsWriter';

export interface VerificationRecord {
  address: string;
  unit?: string;
  classification: Classification;
}

export interface VerifyResult {
  address: string;
  isMdu: boolean;
  records: VerificationRecord[];
  callIns: VerificationRecord[];
  ignored: VerificationRecord[];
  unknowns: VerificationRecord[];
  writtenToSheet: number;
}

export interface VerifyOptions {
  client?: AstoundPortalClient;
  writeToSheet?: boolean;
  now?: () => Date;
}

export async function verifyAddress(address: string, opts: VerifyOptions = {}): Promise<VerifyResult> {
  const trimmed = address.trim();
  if (!trimmed) throw new Error('Address is required');

  const client = opts.client ?? new HttpAstoundPortalClient();
  const baseLookup = await client.lookupAddress(trimmed);
  const now = (opts.now ?? (() => new Date()))();
  const records: VerificationRecord[] = [];

  if (baseLookup.isMdu && baseLookup.mduUnits.length > 0) {
    for (const unit of baseLookup.mduUnits) {
      const unitLookup = await client.lookupAddress(trimmed, unit);
      records.push({ address: trimmed, unit, classification: classifyLookup(unitLookup) });
    }
  } else {
    records.push({ address: trimmed, classification: classifyLookup(baseLookup) });
  }

  const callIns = records.filter((r) => r.classification.shouldCallIn);
  const ignored = records.filter((r) => r.classification.shouldIgnore);
  const unknowns = records.filter((r) => r.classification.status === 'UNKNOWN');

  let writtenToSheet = 0;
  if (opts.writeToSheet !== false && callIns.length > 0) {
    const rows: SweepTurfRow[] = callIns.map((r) => ({
      address: r.address,
      unit: r.unit,
      status: r.classification.status,
      reason: r.classification.reason,
      checkedAt: now.toISOString(),
      repId: config.astound.repId,
    }));
    await appendSweepTurfRows(rows);
    writtenToSheet = rows.length;
  }

  return {
    address: trimmed,
    isMdu: baseLookup.isMdu,
    records,
    callIns,
    ignored,
    unknowns,
    writtenToSheet,
  };
}

export async function verifyAddresses(addresses: string[], opts: VerifyOptions = {}): Promise<VerifyResult[]> {
  const results: VerifyResult[] = [];
  const client = opts.client ?? new HttpAstoundPortalClient();
  for (const address of addresses) {
    try {
      results.push(await verifyAddress(address, { ...opts, client }));
    } catch (err: any) {
      results.push({
        address,
        isMdu: false,
        records: [
          {
            address,
            classification: {
              status: 'UNKNOWN',
              reason: `Error: ${err.message}`,
              shouldIgnore: false,
              shouldCallIn: false,
            },
          },
        ],
        callIns: [],
        ignored: [],
        unknowns: [],
        writtenToSheet: 0,
      });
    }
  }
  return results;
}
