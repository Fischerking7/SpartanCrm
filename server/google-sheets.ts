import { parse } from "csv-parse/sync";

export interface SheetRow {
  rowIndex: number;
  data: Record<string, string>;
}

export interface SheetData {
  headers: string[];
  rows: SheetRow[];
  sheetTitle: string;
}

function extractSheetId(urlOrId: string): string {
  const match = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9-_]+$/.test(urlOrId)) return urlOrId;
  throw new Error("Invalid Google Sheet URL or ID. Please provide a valid Google Sheets URL or sheet ID.");
}

function extractGid(url: string): string {
  const match = url.match(/gid=(\d+)/);
  return match ? match[1] : "0";
}

export async function fetchGoogleSheet(urlOrId: string): Promise<SheetData> {
  const sheetId = extractSheetId(urlOrId);
  const gid = extractGid(urlOrId);

  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;

  const response = await fetch(csvUrl, {
    headers: {
      "User-Agent": "IronCrestCRM/1.0",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Google Sheet not found. Make sure the URL is correct.");
    }
    if (response.status === 403 || response.status === 401) {
      throw new Error(
        'Cannot access this Google Sheet. Please make sure the sheet is shared as "Anyone with the link can view".'
      );
    }
    throw new Error(`Failed to fetch Google Sheet: HTTP ${response.status}`);
  }

  const csvText = await response.text();

  if (csvText.includes("<!DOCTYPE html>") || csvText.includes("<html")) {
    throw new Error(
      'Cannot access this Google Sheet. Please make sure the sheet is shared as "Anyone with the link can view".'
    );
  }

  const records: string[][] = parse(csvText, {
    skip_empty_lines: true,
    relax_column_count: true,
  });

  if (records.length === 0) {
    throw new Error("The Google Sheet appears to be empty.");
  }

  const headers = records[0].map((h: string) => h.trim());
  const rows: SheetRow[] = records.slice(1).map((record: string[], idx: number) => {
    const data: Record<string, string> = {};
    headers.forEach((header, i) => {
      data[header] = (record[i] || "").trim();
    });
    return { rowIndex: idx + 2, data };
  });

  return {
    headers,
    rows,
    sheetTitle: `Sheet (${rows.length} rows)`,
  };
}

export async function parseUploadedCsv(csvContent: string): Promise<SheetData> {
  const records: string[][] = parse(csvContent, {
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
  });

  if (records.length === 0) {
    throw new Error("The uploaded file appears to be empty.");
  }

  const headers = records[0].map((h: string) => h.trim());
  const rows: SheetRow[] = records.slice(1).map((record: string[], idx: number) => {
    const data: Record<string, string> = {};
    headers.forEach((header, i) => {
      data[header] = (record[i] || "").trim();
    });
    return { rowIndex: idx + 2, data };
  });

  return {
    headers,
    rows,
    sheetTitle: `Upload (${rows.length} rows)`,
  };
}
