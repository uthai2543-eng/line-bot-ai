import { CACHE_TTL_MS, SHEET_TIMEOUT_MS } from "./constants";

const REQUIRED_COLUMNS = ["category", "question", "answer", "active"];

let cache: { csv: string; fetchedAt: number } | null = null;

/** Returns the active FAQ rows as CSV, or null if no data has ever been loaded. */
export async function getFaqCsv(): Promise<string | null> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.csv;

  try {
    const res = await fetch(process.env.SHEET_CSV_URL as string, {
      cache: "no-store",
      signal: AbortSignal.timeout(SHEET_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const csv = filterActiveRows(await res.text());
    cache = { csv, fetchedAt: Date.now() };
    return csv;
  } catch (err) {
    console.warn(
      JSON.stringify({
        tag: "sheet",
        level: "warning",
        message: err instanceof Error ? err.message : String(err),
        usingStaleCache: cache !== null,
      }),
    );
    return cache?.csv ?? null;
  }
}

function filterActiveRows(rawCsv: string): string {
  const [header, ...rows] = parseCsv(rawCsv);
  const columns = (header ?? []).map((name) => name.trim().toLowerCase());

  // A sheet that isn't published as CSV returns an HTML page with status 200.
  const missing = REQUIRED_COLUMNS.filter((name) => !columns.includes(name));
  if (missing.length > 0) {
    throw new Error(`Sheet is missing columns: ${missing.join(", ")}`);
  }

  const activeIndex = columns.indexOf("active");
  const activeRows = rows.filter(
    (row) => row[activeIndex]?.trim().toUpperCase() === "TRUE",
  );
  return [header, ...activeRows].map(toCsvLine).join("\n");
}

function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char !== '"') {
        field += char;
      } else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = false;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function toCsvLine(row: string[]): string {
  return row
    .map((field) =>
      /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field,
    )
    .join(",");
}
