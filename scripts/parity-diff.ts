/**
 * Phase 7 — dual-driver parity harness (SQL Server ↔ PostgreSQL).
 *
 * For each curated case we obtain TWO results:
 *   - `ms`: the OLD SQL Server answer, taken from the still-intact `ShwanNew_Test`
 *           sandbox via `getPool()` — either the original proc/view, or SQL that
 *           mirrors the query the converted TS function replaced.
 *   - `pg`: the NEW PostgreSQL answer, by calling the actual converted TS function
 *           (which talks to `shwan_test` via Kysely) — i.e. the real code under test.
 * Both DBs hold the same ~214k ETL'd rows, so a clean diff proves the translation
 * preserved behaviour. Results are CANONICALISED before diffing so the migration's
 * intentional representation changes (bit→boolean, datetime→'YYYY-MM-DD', etc.) don't
 * register as false mismatches — only genuine value differences do.
 *
 * READ-ONLY against both DBs except the cases under the "write-state" group, which run
 * a mutation on PG inside a transaction and ROLL BACK (no persisted change).
 *
 * Run:  npx tsx scripts/parity-diff.ts            (all groups)
 *       npx tsx scripts/parity-diff.ts collation  (filter by group/name substring)
 */
import sql from 'mssql';
import { getPool } from '../services/database/pool.js';
import { getKysely, getPgPool } from '../services/database/kysely.js';
import * as holidayQ from '../services/database/queries/holiday-queries.js';
import * as paymentQ from '../services/database/queries/payment-queries.js';
import * as calendarQ from '../services/database/queries/calendar-queries.js';
import * as alignerQ from '../services/database/queries/aligner-queries.js';
import * as reportQ from '../services/database/queries/report-queries.js';
import { diff, project, stableSort, sortByKeys, ms } from './parity-lib.js';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Replicate the ORIGINAL routes/api/reports.routes.ts SysStartTime mapper: tedious reads the
 * UTC-stored datetime2 with useUTC:false, so its LOCAL components already hold the UTC wall-clock;
 * the app formats those components and appends a literal 'Z'. Mirroring it here lets the OLD raw
 * proc value canon to the same instant as the NEW report's '…Z' string.
 */
function legacyZ(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}Z`
  );
}

// ── Cases ─────────────────────────────────────────────────────────────────--
interface Case {
  group: string;
  name: string;
  ms: () => Promise<unknown[]>;
  pg: () => Promise<unknown[]>;
  pick?: string[];        // compare only these row keys
  sortKey?: string;       // sort both sides by this key before diffing (order-insensitive)
  sortByKeys?: string[];  // sort both sides by these keys in order (composite alignment)
}

const CASES: Case[] = [
  // ── Collation (Arabic_CI_AS → citext): name LIKE must return the SAME PersonIDs ──
  {
    group: 'collation',
    name: 'Arabic name LIKE %زيان%',
    ms: () => ms(`SELECT PersonID FROM dbo.tblpatients WHERE PatientName LIKE @p ORDER BY PersonID`, [['p', sql.NVarChar, '%زيان%']]),
    pg: async () => (await getPgPool().query({ text: `SELECT "PersonID" FROM "tblpatients" WHERE "PatientName" LIKE $1 ORDER BY "PersonID"`, values: ['%زيان%'] })).rows,
  },
  {
    group: 'collation',
    name: 'case-insensitive Latin FirstName LIKE %AHM% (upper)',
    ms: () => ms(`SELECT PersonID FROM dbo.tblpatients WHERE FirstName LIKE @p ORDER BY PersonID`, [['p', sql.NVarChar, '%AHM%']]),
    pg: async () => (await getPgPool().query({ text: `SELECT "PersonID" FROM "tblpatients" WHERE "FirstName" LIKE $1 ORDER BY "PersonID"`, values: ['%AHM%'] })).rows,
  },

  // ── Date-only fields: holidays ──
  {
    group: 'dates',
    name: 'getAllHolidays',
    ms: () => ms(`SELECT ID, Holidaydate, HolidayName, Description FROM dbo.tblHolidays ORDER BY Holidaydate DESC`),
    pg: () => holidayQ.getAllHolidays() as Promise<unknown[]>,
    pick: ['ID', 'Holidaydate', 'HolidayName', 'Description'],
    sortKey: 'ID',
  },

  // ── Payment amounts + dates ──
  {
    group: 'payments',
    name: 'getPaymentHistoryByWorkId(2)',
    ms: () => ms(
      `SELECT InvoiceID, workid, Amountpaid, Dateofpayment, ActualAmount, ActualCur, Change
       FROM dbo.tblInvoice WHERE workid = @w ORDER BY Dateofpayment DESC`,
      [['w', sql.Int, 2]]
    ),
    pg: () => paymentQ.getPaymentHistoryByWorkId(2) as Promise<unknown[]>,
    sortKey: 'InvoiceID',
  },
  {
    group: 'payments',
    name: 'getActiveWorkForInvoice(5) — active works + TotalPaid',
    ms: () => ms(
      `SELECT w.workid, w.PersonID, w.TotalRequired, w.Currency, w.Typeofwork, w.StartDate,
              p.PatientName, p.Phone, COALESCE(SUM(i.Amountpaid), 0) as TotalPaid
       FROM dbo.tblpatients p
       INNER JOIN dbo.tblwork w ON p.PersonID = w.PersonID
       LEFT JOIN dbo.tblInvoice i ON w.workid = i.workid
       WHERE w.Status = 1 AND p.PersonID = @p
       GROUP BY w.workid, w.PersonID, w.TotalRequired, w.Currency, w.Typeofwork, w.StartDate, p.PatientName, p.Phone`,
      [['p', sql.Int, 5]]
    ),
    pg: () => paymentQ.getActiveWorkForInvoice(5) as Promise<unknown[]>,
    sortKey: 'workid',
  },

  // ── Boolean fields (bit → boolean): employee flags must compare equal after canon ──
  {
    group: 'booleans',
    name: 'tblEmployees flags (receiveEmail/getAppointments/Percentage)',
    ms: () => ms(`SELECT ID, receiveEmail, getAppointments, Percentage FROM dbo.tblEmployees ORDER BY ID`),
    pg: async () => (await getPgPool().query(`SELECT "ID", "receiveEmail", "getAppointments", "Percentage" FROM "tblEmployees" ORDER BY "ID"`)).rows,
    sortKey: 'ID',
  },

  // ── Financial totals (dual-currency cash-box math): ProcYearlyMonthlyTotals ──
  {
    group: 'totals',
    name: 'getYearlyMonthlyTotals(1,2024,1450)',
    ms: () => ms(`EXEC dbo.ProcYearlyMonthlyTotals @m, @y, @e`, [['m', sql.Int, 1], ['y', sql.Int, 2024], ['e', sql.Int, 1450]]),
    pg: () => reportQ.getYearlyMonthlyTotals(1, 2024, 1450) as Promise<unknown[]>,
    sortByKeys: ['Year', 'Month'],
  },

  // ── Calendar day (mirror of the converted getCalendarDay query) ──
  {
    group: 'calendar',
    name: 'getCalendarDay(2027-02-01)',
    ms: () => ms(
      `SELECT a.appointmentID AS [appointmentID], a.AppDetail AS [appDetail], a.DrID AS [drID],
              p.PatientName AS [patientName], tc.AppDate AS [appDate], FORMAT(tc.AppDate,'hh:mm') AS [appTime]
       FROM dbo.tblCalender tc
       LEFT JOIN dbo.tblappointments a ON a.AppDate = tc.AppDate
       LEFT JOIN dbo.tblpatients p ON a.PersonID = p.PersonID
       WHERE tc.AppDate >= @d AND tc.AppDate < DATEADD(day, 1, @d)
       ORDER BY tc.AppDate`,
      [['d', sql.Date, '2027-02-01']]
    ),
    pg: () => calendarQ.getCalendarDay('2027-02-01') as Promise<unknown[]>,
    pick: ['appointmentID', 'appDetail', 'drID', 'patientName', 'appTime'],
    sortKey: 'appointmentID',
  },

  // ── Daily invoices (ProDailyInvoices reimplementation): FORMAT'd amount + UTC SysStartTime ──
  {
    group: 'totals',
    name: 'getDailyInvoices(2017-11-27)',
    // SysStartTime carries UTC semantics (Phase-2 deviation #1: tblInvoice was a SYSTEM_VERSIONED
    // temporal column defaulted from sysutcdatetime(); kept as a plain UTC-wall-clock timestamp in
    // PG). The OLD raw proc returns it as a tedious `Date` (useUTC:false → local components ARE the
    // stored UTC wall-clock); the NEW report emits a '…Z' ISO string. To compare like-for-like we
    // apply the SAME mapping routes/api/reports.routes.ts applied — format the Date's local
    // components and append 'Z' — so both sides canon to the same instant. (Verified byte-identical
    // end-to-end across 81 invoices by scripts/probe-sysstarttime.ts; no ETL/report change needed.)
    ms: async () => {
      const rows = await ms(`EXEC dbo.ProDailyInvoices @iDate=@d`, [['d', sql.Date, '2017-11-27']]);
      return rows.map((r) => ({ ...r, SysStartTime: legacyZ(r.SysStartTime as Date) }));
    },
    pg: () => reportQ.getDailyInvoices('2017-11-27') as Promise<unknown[]>,
    pick: ['invoiceID', 'PatientName', 'Amountpaid', 'workid', 'currency', 'SysStartTime'],
    sortKey: 'invoiceID',
  },

  // ── Aligner read (inlined v_allsets) — compare core columns the view shares ──
  {
    group: 'aligner',
    name: 'getAllAlignerSets vs v_allsets (core cols)',
    ms: () => ms(`SELECT * FROM dbo.v_allsets`),
    pg: () => alignerQ.getAllAlignerSets() as Promise<unknown[]>,
    pick: ['AlignerSetID', 'WorkID', 'SetSequence', 'BatchSequence', 'ManufactureDate', 'DeliveredToPatientDate', 'NextDueDate', 'IsLast'],
    sortKey: 'AlignerSetID',
  },
];

// ── Runner ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const filter = process.argv[2]?.toLowerCase();
  const cases = filter ? CASES.filter((c) => (c.group + ' ' + c.name).toLowerCase().includes(filter)) : CASES;

  let pass = 0;
  let fail = 0;
  console.log(`\nPhase-7 parity diff — ${cases.length} case(s)${filter ? ` (filter: ${filter})` : ''}\n`);

  for (const c of cases) {
    try {
      const [msRows, pgRows] = await Promise.all([c.ms(), c.pg()]);
      const a = sortByKeys(stableSort(project(msRows as Record<string, unknown>[], c.pick), c.sortKey), c.sortByKeys);
      const b = sortByKeys(stableSort(project(pgRows as Record<string, unknown>[], c.pick), c.sortKey), c.sortByKeys);
      const d = diff(a, b);
      if (d.length === 0) {
        console.log(`  ✅ [${c.group}] ${c.name}  (ms=${msRows.length}, pg=${pgRows.length} rows)`);
        pass++;
      } else {
        console.log(`  ❌ [${c.group}] ${c.name}  (ms=${msRows.length}, pg=${pgRows.length} rows)`);
        for (const line of d) console.log(`       • ${line}`);
        fail++;
      }
    } catch (err) {
      console.log(`  ⚠️  [${c.group}] ${c.name} — ERROR: ${(err as Error).message}`);
      fail++;
    }
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} parity: ${pass} passed, ${fail} failed.\n`);
  await getPgPool().end();
  const msPool = await getPool();
  await msPool.close();
  process.exit(fail === 0 ? 0 : 1);
}

void main();
