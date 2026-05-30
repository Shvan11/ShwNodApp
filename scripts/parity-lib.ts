/**
 * Shared helpers for the Phase-7 parity scripts (parity-diff.ts = reads, parity-write.ts = writes).
 * Canonicalises values so the migration's intentional representation changes (bit→boolean,
 * datetime→'YYYY-MM-DD', char-padding, numeric type) don't register as false diffs.
 */
import sql from 'mssql';
import { getPool } from '../services/database/pool.js';

const pad = (n: number) => String(n).padStart(2, '0');
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TS = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const TIME_ONLY = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;

const d1970 = (d: Date) => d.getFullYear() === 1970 && d.getMonth() === 0 && d.getDate() === 1;

export function fmtDate(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
  );
}

function fmtTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Reduce a value to a backend-agnostic canonical form. */
export function canon(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    // SQL Server `time` (via tedious) arrives as a JS Date on the 1970-01-01 epoch; PG `time`
    // arrives as a 'HH:MM:SS' string. Canon both to 'HH:MM:SS' so they compare equal.
    if (d1970(v)) return fmtTime(v);
    return fmtDate(v);
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return Number.isInteger(v) ? v : Math.round(v * 1e6) / 1e6;
  if (typeof v === 'string') {
    const s = v.replace(/\s+$/, '');
    if (DATE_ONLY.test(s)) return `${s} 00:00:00.000`;
    if (ISO_TS.test(s)) {
      const d = new Date(s.replace(' ', 'T'));
      if (!Number.isNaN(d.getTime())) return fmtDate(d);
    }
    const tm = TIME_ONLY.exec(s);
    if (tm) return `${pad(Number(tm[1]))}:${tm[2]}:${tm[3] ?? '00'}`;
    return s;
  }
  if (Array.isArray(v)) return v.map(canon);
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) out[k] = canon((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

export function project<T extends Record<string, unknown>>(rows: T[], keys?: string[]): unknown[] {
  if (!keys) return rows;
  return rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k]])));
}

export function stableSort(rows: unknown[], key?: string): unknown[] {
  if (!key) return rows;
  return [...rows].sort((a, b) => {
    const av = (a as Record<string, unknown>)[key];
    const bv = (b as Record<string, unknown>)[key];
    return av === bv ? 0 : (av as number) > (bv as number) ? 1 : -1;
  });
}

export function sortByKeys(rows: unknown[], keys?: string[]): unknown[] {
  if (!keys) return rows;
  return [...rows].sort((x, y) => {
    const kx = keys.map((k) => JSON.stringify(canon((x as Record<string, unknown>)[k]))).join('|');
    const ky = keys.map((k) => JSON.stringify(canon((y as Record<string, unknown>)[k]))).join('|');
    return kx.localeCompare(ky);
  });
}

/** Deep-diff two values (canonicalised); returns up to `cap` human-readable mismatch lines. */
export function diff(a: unknown, b: unknown, path = '', out: string[] = [], cap = 14): string[] {
  if (out.length >= cap) return out;
  const ca = canon(a);
  const cb = canon(b);
  const sa = JSON.stringify(ca);
  const sb = JSON.stringify(cb);
  if (sa === sb) return out;
  if (Array.isArray(ca) && Array.isArray(cb)) {
    if (ca.length !== cb.length) out.push(`${path}: length ms=${ca.length} pg=${cb.length}`);
    const n = Math.min(ca.length, cb.length);
    for (let i = 0; i < n && out.length < cap; i++) diff(ca[i], cb[i], `${path}[${i}]`, out, cap);
    return out;
  }
  if (ca && cb && typeof ca === 'object' && typeof cb === 'object') {
    const keys = new Set([...Object.keys(ca), ...Object.keys(cb)]);
    for (const k of keys) {
      if (out.length >= cap) break;
      diff((ca as Record<string, unknown>)[k], (cb as Record<string, unknown>)[k], path ? `${path}.${k}` : k, out, cap);
    }
    return out;
  }
  out.push(`${path}: ms=${sa} pg=${sb}`);
  return out;
}

export type Input = [name: string, type: sql.ISqlType | (() => sql.ISqlType), value: unknown];

/** Run a read-only SQL Server query and return its first recordset. */
export async function ms(query: string, inputs: Input[] = []): Promise<Record<string, unknown>[]> {
  const pool = await getPool();
  const req = pool.request();
  for (const [n, t, val] of inputs) req.input(n, t as sql.ISqlType, val);
  const r = await req.query(query);
  return r.recordset ?? [];
}
