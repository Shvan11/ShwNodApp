/**
 * Messaging queries (WhatsApp + SMS) — PostgreSQL / Kysely.
 *
 * Phase 5: every stored proc this module used (GetWhatsAppMessagesToSend, ProcSMS, ProcFetch,
 * Procgetsids, GetMessageStatusByDate, UpdateWhatsAppStatus, UpdateWhatsAppDeliveryStatus,
 * UpdateSingleMessageStatus, ProcUpdatesms1/2) is reimplemented here. The Arabic/English message
 * building, relative-day logic, and phone normalisation the procs did in T-SQL now live in TS;
 * the TVP-driven bulk updates (WhatsTableType / SMSStatusType) become PG `unnest($1::int[], …)`
 * set-based updates. `getNewAppointmentMessage` (was GetNewAppointmentMessage) and
 * `resetMessagingForDate` (was ResetMessagingForDate) are added for the route callers.
 *
 * The DatabaseCircuitBreaker wrapper and public function signatures are unchanged.
 */
import { sql } from 'kysely';
import { getKysely, withPgTransaction } from '../kysely.js';
import { arabicDay } from '../../../utils/arabic-day.js';
import { toDateOnly } from '../../../utils/date.js';
import { log } from '../../../utils/logger.js';

// type definitions
interface CircuitBreakerStatus {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failureCount: number;
  lastFailureTime: number | null;
}

interface WhatsAppDeliveryMessage {
  id: number;
  number: string;
  wamid: string;
}

interface StatusUpdateMessage {
  id: number;
  ack: number;
  whatsappMessageId?: string;
}

interface UpdateResult {
  success: boolean;
  updatedCount: number;
  error?: string;
  stats?: {
    totalUpdated: number;
    readCount: number;
    deliveredCount: number;
    serverCount: number;
  } | null;
}

interface SingleMessageResult {
  success: boolean;
  found?: boolean;
  error?: string;
  appointment?: {
    appointmentId: number;
    patientName: string;
    phone: string;
    status: string;
    lastUpdated: Date;
  };
}

interface MessageStatusSummary {
  total: number;
  sent: number;
  pending: number;
  delivered: number;
  read: number;
  failed: number;
}

interface MessageStatusResult {
  date: Date | string;
  summary: MessageStatusSummary;
  messages: Array<{
    appointmentId: number;
    patientName: string;
    phone: string;
    sentStatus: boolean | null;
    deliveryStatus: string | null;
    messageId: string | null;
    sentTimestamp: Date | null;
    lastUpdated: Date | null;
  }>;
  error?: string;
}

interface SmsMessage {
  id: number;
  to: string;
  body: string;
}

interface SmsIdMessage {
  id: number;
  sid: string;
}

interface SmsStatusMessage {
  id: number;
  status: string;
}

/** Result of getNewAppointmentMessage (was the GetNewAppointmentMessage proc). */
interface NewAppointmentMessage {
  result: number; // 0 ok, -1 not found, -2 invalid phone
  phone: string | null;
  message: string | null;
  countryCode: string | null;
}

/** Reset statistics (was the ResetMessagingForDate proc's result set). */
interface ResetResult {
  resetDate: string;
  totalAppointments: number;
  readyForWhatsApp: number;
  readyForSMS: number;
  alreadySentWA: number;
  alreadyNotified: number;
  appointmentsReset: number;
  smsRecordsReset: number;
}

/**
 * Circuit breaker for database operations
 */
class DatabaseCircuitBreaker {
  private failureThreshold: number;
  private timeout: number;
  private failureCount: number;
  private lastFailureTime: number | null;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';

  constructor(threshold = 3, timeout = 30000) {
    this.failureThreshold = threshold;
    this.timeout = timeout;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.state = 'CLOSED';
  }

  async execute<T>(
    operation: () => Promise<T>,
    operationName = 'database-operation'
  ): Promise<T> {
    if (this.state === 'OPEN') {
      if (this.lastFailureTime && Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'HALF_OPEN';
        log.info('Circuit breaker half-open', { operation: operationName });
      } else {
        throw new Error(`Circuit breaker is OPEN for ${operationName}`);
      }
    }

    try {
      const result = await operation();
      this.onSuccess(operationName);
      return result;
    } catch (error) {
      this.onFailure(operationName, error as Error);
      throw error;
    }
  }

  private onSuccess(operationName: string): void {
    if (this.state === 'HALF_OPEN') {
      log.info('Circuit breaker closed after success', { operation: operationName });
    }
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  private onFailure(operationName: string, error: Error): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    log.error('Circuit breaker failure threshold approaching', {
      operationName,
      failureCount: this.failureCount,
      failureThreshold: this.failureThreshold,
      error: error.message,
    });

    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      log.error('Circuit breaker opened due to threshold exceeded', { operationName });
    }
  }

  isOpen(): boolean {
    return this.state === 'OPEN';
  }

  getStatus(): CircuitBreakerStatus {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
    };
  }

  reset(): void {
    this.failureCount = 0;
    this.state = 'CLOSED';
    this.lastFailureTime = null;
  }
}

const dbCircuitBreaker = new DatabaseCircuitBreaker();

// ── Message-building helpers (replace the T-SQL string assembly inside the procs) ──

const ENGLISH_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Parse a date-only string as LOCAL midnight (avoids the UTC-parse day-shift). */
function parseLocalDate(value: Date | string): Date {
  if (value instanceof Date) return value;
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? new Date(`${value.slice(0, 10)}T00:00:00`) : new Date(value);
}

/** SQL `DATENAME(dw, ...)` — English weekday name. */
function englishDay(value: Date | string): string {
  return ENGLISH_DAYS[parseLocalDate(value).getDay()] ?? '';
}

/** SQL `DATEDIFF(day, GETDATE(), @date)` — whole days from today (local) to the target date. */
function daysFromToday(target: Date | string): number {
  const t = parseLocalDate(target);
  const now = new Date();
  const a = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / 86_400_000);
}

/** SQL `FORMAT(dt, 'h:mm')` / `'h:mm tt'` — 12-hour clock, no leading-zero hour. */
function format12h(date: Date, withMeridiem = false): string {
  const h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, '0');
  const h12 = h % 12 || 12;
  return withMeridiem ? `${h12}:${m} ${h < 12 ? 'AM' : 'PM'}` : `${h12}:${m}`;
}

/** SQL `FORMAT(d, 'dd/MM/yyyy')`. */
function formatDMY(value: Date | string): string {
  const d = parseLocalDate(value);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Normalise a local phone to `country_code + number` (no '+'), matching the procs' CASE ladder. */
function formatPhone(phone: string, countryCode: string): string {
  const p = phone.trim();
  if (p.startsWith(`+${countryCode}`)) return p.slice(1);
  if (p.startsWith(`00${countryCode}`)) return p.slice(2);
  if (p.startsWith(countryCode)) return p;
  if (p.startsWith('0')) return countryCode + p.slice(1);
  return countryCode + p;
}

/** The procs' phone validation: non-empty, digits/'+' only, at least one digit. */
function isValidPhone(phone: string | null | undefined): phone is string {
  if (!phone) return false;
  const p = phone.trim();
  return p.length > 0 && /^[0-9+]+$/.test(p) && /[0-9]/.test(p);
}

/**
 * Helper function to convert WhatsApp acknowledgment status codes to text
 */
function convertAckStatus(ack: number): string {
  switch (ack) {
    case -1:
      return 'ERROR';
    case 0:
      return 'PENDING';
    case 1:
      return 'SERVER';
    case 2:
      return 'DEVICE';
    case 3:
      return 'READ';
    case 4:
      return 'PLAYED';
    default:
      log.warn('Unknown WhatsApp status code encountered', { statusCode: ack });
      return `UNKNOWN_${ack}`;
  }
}

/** trg_MessageStatusHistory's status-text → numeric code mapping. */
function statusTextToCode(status: string): number {
  switch (status) {
    case 'ERROR': return -1;
    case 'SERVER': return 1;
    case 'DEVICE': return 2;
    case 'READ': return 3;
    case 'PLAYED': return 4;
    default: return 0; // PENDING / unknown
  }
}

/**
 * Replaces trg_MessageStatusHistory: append a history row for each appointment whose delivered_wa
 * actually changed (new value <> old, treating old NULL as ''). Runs inside the caller's trx.
 */
async function insertStatusHistory(
  trx: import('kysely').Transaction<import('../kysely.js').Database>,
  changes: Array<{ appointment_id: number; waMessageID: string | null; delivered: string }>,
  when: Date
): Promise<void> {
  if (changes.length === 0) return;
  await trx
    .insertInto('message_status_history')
    .values(
      changes.map((c) => ({
        appointment_id: c.appointment_id,
        wa_message_id: c.waMessageID ?? '',
        status_code: statusTextToCode(c.delivered),
        status_text: c.delivered,
        timestamp: when,
      }))
    )
    .execute();
}

/**
 * Enhanced updateWhatsAppDeliveryStatus with transaction management and circuit breaker.
 * (was: UpdateWhatsAppDeliveryStatus TVP proc → set-based UPDATE … FROM unnest.)
 */
export async function updateWhatsAppDeliveryStatus(
  messages: StatusUpdateMessage[]
): Promise<UpdateResult> {
  const operationName = 'updateWhatsAppDeliveryStatus';

  return dbCircuitBreaker
    .execute(async () => {
      if (!messages || messages.length === 0) {
        return { success: true, updatedCount: 0 };
      }

      const ids = messages.map((m) => m.id);
      const statuses = messages.map((m) => convertAckStatus(m.ack));
      const wamids = messages.map((m) => m.whatsappMessageId || '');
      const now = new Date();

      const c = await withPgTransaction(async (trx) => {
        // Old delivered_wa per appointment (to drive the trg_MessageStatusHistory equivalent).
        const oldRows = await trx
          .selectFrom('appointments')
          .select(['appointment_id', 'delivered_wa'])
          .where('appointment_id', 'in', ids)
          .execute();
        const oldById = new Map(oldRows.map((r) => [r.appointment_id, (r.delivered_wa as string | null) ?? '']));

        await sql`
          UPDATE "appointments" AS a SET
            "delivered_wa" = w.delivered,
            "wa_message_id" = w.wamid,
            "want_notify" = CASE WHEN w.delivered IN ('READ','DEVICE','SERVER') THEN false ELSE a."want_notify" END,
            "delivered_timestamp" = CASE
              WHEN w.delivered IN ('DEVICE','SERVER') AND a."delivered_timestamp" IS NULL THEN ${now}::timestamp
              ELSE a."delivered_timestamp" END,
            "read_timestamp" = CASE
              WHEN w.delivered = 'READ' AND a."read_timestamp" IS NULL THEN ${now}::timestamp
              ELSE a."read_timestamp" END
          FROM unnest(${ids}::int[], ${statuses}::text[], ${wamids}::text[]) AS w(appointmentid, delivered, wamid)
          WHERE a."appointment_id" = w.appointmentid
        `.execute(trx);

        const changed = messages
          .map((m) => ({ appointment_id: m.id, waMessageID: m.whatsappMessageId || '', delivered: convertAckStatus(m.ack) }))
          .filter((m) => m.delivered !== oldById.get(m.appointment_id));
        await insertStatusHistory(trx, changed, now);

        const { rows } = await sql<{ total: number; read: number; delivered: number; server: number }>`
          SELECT
            COUNT(*)::int AS total,
            COALESCE(SUM(CASE WHEN "delivered_wa" = 'READ'   THEN 1 ELSE 0 END), 0)::int AS read,
            COALESCE(SUM(CASE WHEN "delivered_wa" = 'DEVICE' THEN 1 ELSE 0 END), 0)::int AS delivered,
            COALESCE(SUM(CASE WHEN "delivered_wa" = 'SERVER' THEN 1 ELSE 0 END), 0)::int AS server
          FROM "appointments" WHERE "appointment_id" = ANY(${ids}::int[])
        `.execute(trx);
        return rows[0] ?? { total: messages.length, read: 0, delivered: 0, server: 0 };
      });
      const stats = {
        totalUpdated: c.total,
        readCount: c.read,
        deliveredCount: c.delivered,
        serverCount: c.server,
      };
      log.info('WhatsApp status update completed', stats);
      return { success: true, updatedCount: stats.totalUpdated, stats };
    }, operationName)
    .catch((error: Error) => {
      log.error('WhatsApp delivery status update failed', { operationName, error: error.message });
      return { success: false, error: error.message, updatedCount: 0 };
    });
}

/**
 * Enhanced getWhatsAppMessages with circuit breaker. (was: GetWhatsAppMessagesToSend)
 * Only returns rows when the date is tomorrow or the day after (else an empty payload), then
 * marks tblsms.smssent for that date — matching the proc.
 */
export async function getWhatsAppMessages(
  date: Date | string
): Promise<[string[], string[], number[], string[]]> {
  const operationName = 'getWhatsAppMessages';

  return dbCircuitBreaker
    .execute(async () => {
      const dd = daysFromToday(date);
      if (dd !== 1 && dd !== 2) return [[], [], [], []] as [string[], string[], number[], string[]];

      const dateStr = typeof date === 'string' ? date.slice(0, 10) : toDateOnly(date);
      const aDay = arabicDay(dateStr);
      const eDay = englishDay(dateStr);
      const aMes =
        dd === 1
          ? `غدا ${aDay} موعدك مع عيادة د.شوان لتقويم الاسنان الساعة`
          : `بعد غد ${aDay} موعدك مع عيادة د.شوان لتقويم الاسنان الساعة`;
      const eMes =
        dd === 1
          ? `Tomorrow "${eDay}" is your appointment with Dr. Shwan orthodontic clinic at`
          : `The day after tomorrow "${eDay}" is your appointment with Dr. Shwan orthodontic clinic at`;

      const candidates = await getKysely()
        .selectFrom('appointments as a')
        .innerJoin('patients as p', 'p.person_id', 'a.person_id')
        .where('a.app_day', '=', sql<string>`${dateStr}::date`)
        .where('a.want_wa', '=', true)
        .where((eb) => eb.or([eb('a.notified', 'is', null), eb('a.notified', '=', false)]))
        .where((eb) => eb.or([eb('a.sent_wa', 'is', null), eb('a.sent_wa', '=', false)]))
        .where('p.phone', 'is not', null)
        .orderBy('a.app_time')
        .select([
          'a.appointment_id as id',
          'p.phone as phone',
          'p.country_code as countryCode',
          'p.patient_name as patientName',
          'p.first_name as firstName',
          'p.language as language',
          'a.app_date as appDate',
        ])
        .execute();

      const numbers: string[] = [];
      const messages: string[] = [];
      const ids: number[] = [];
      const names: string[] = [];

      for (const r of candidates) {
        if (!isValidPhone(r.phone)) continue;
        const cc = r.countryCode || '964';
        const appDate = r.appDate as unknown as Date;
        const time = format12h(appDate);
        const message =
          r.language === 1
            ? `Hello ${r.firstName || r.patientName}. ${eMes} ${time}`
            : `السلام عليك ${r.patientName}. ${aMes} ${time}`;
        numbers.push(formatPhone(r.phone, cc));
        messages.push(message);
        ids.push(r.id);
        names.push(r.patientName || '');
      }

      log.debug('WhatsApp messages retrieved successfully', { messageCount: ids.length, date });
      return [numbers, messages, ids, names] as [string[], string[], number[], string[]];
    }, operationName)
    .catch((error: Error) => {
      log.error('Failed to retrieve WhatsApp messages', { operationName, error: error.message });
      return [[], [], [], []] as [string[], string[], number[], string[]];
    });
}

/**
 * Mark a date's per-day messaging row (`sms`) as processed.
 *
 * This was previously a side effect baked into `getWhatsAppMessages`, which
 * meant merely *previewing* a date's messages (the /count and /details GET
 * endpoints) flipped the flag. The flag belongs to the actual send flow, so it
 * now lives here and is called only after messages are dispatched.
 */
export async function markWhatsAppBatchSent(date: Date | string): Promise<void> {
  const dateStr = typeof date === 'string' ? date.slice(0, 10) : toDateOnly(date);
  await sql`UPDATE "sms" SET "sms_sent" = true WHERE "date" = ${dateStr}::date`.execute(getKysely());
}

/**
 * Enhanced updateWhatsAppStatus — mark a batch as sent. (was: UpdateWhatsAppStatus TVP proc.)
 */
export async function updateWhatsAppStatus(
  appointmentIds: number[],
  messageIds: string[]
): Promise<UpdateResult> {
  const operationName = 'updateWhatsAppStatus';

  if (!appointmentIds || !appointmentIds.length) {
    return { success: true, updatedCount: 0 };
  }

  return dbCircuitBreaker
    .execute(async () => {
      const now = new Date();
      const result = await sql`
        UPDATE "appointments" AS a SET
          "sent_wa" = true,
          "wa_message_id" = w.wamid,
          "want_wa" = false,
          "sent_timestamp" = ${now}::timestamp
        FROM unnest(${appointmentIds}::int[], ${messageIds}::text[]) AS w(appointmentid, wamid)
        WHERE a."appointment_id" = w.appointmentid
      `.execute(getKysely());

      const updatedCount = Number(result.numAffectedRows ?? appointmentIds.length);
      log.info('WhatsApp status update completed successfully', { updatedCount });
      return { success: true, updatedCount };
    }, operationName)
    .catch((error: Error) => {
      log.error('WhatsApp status update failed', { operationName, error: error.message });
      return { success: false, error: error.message, updatedCount: 0 };
    });
}

/**
 * Enhanced updateSingleMessageStatus. (was: UpdateSingleMessageStatus proc + @Result OUTPUT.)
 */
export async function updateSingleMessageStatus(
  messageId: string,
  status: number
): Promise<SingleMessageResult> {
  const operationName = 'updateSingleMessageStatus';

  return dbCircuitBreaker
    .execute(async () => {
      const statusText = convertAckStatus(status);
      const now = new Date();

      return withPgTransaction(async (trx) => {
        const existing = await trx
          .selectFrom('appointments')
          .select(['appointment_id', 'delivered_wa'])
          .where('wa_message_id', '=', messageId)
          .executeTakeFirst();

        if (!existing) {
          log.warn('Message id not found in database', { messageId });
          return { success: true, found: false };
        }

        const oldDelivered = (existing.delivered_wa as string | null) ?? '';

        await sql`
          UPDATE "appointments" SET
            "delivered_wa" = ${statusText},
            "want_notify" = CASE WHEN ${statusText} IN ('READ','DEVICE','SERVER') THEN false ELSE "want_notify" END,
            "delivered_timestamp" = CASE
              WHEN ${statusText} IN ('DEVICE','SERVER') AND "delivered_timestamp" IS NULL THEN ${now}::timestamp
              ELSE "delivered_timestamp" END,
            "read_timestamp" = CASE
              WHEN ${statusText} = 'READ' AND "read_timestamp" IS NULL THEN ${now}::timestamp
              ELSE "read_timestamp" END
          WHERE "appointment_id" = ${existing.appointment_id}
        `.execute(trx);

        if (statusText !== oldDelivered) {
          await insertStatusHistory(trx, [{ appointment_id: existing.appointment_id, waMessageID: messageId, delivered: statusText }], now);
        }

        const info = await trx
          .selectFrom('appointments as a')
          .innerJoin('patients as p', 'p.person_id', 'a.person_id')
          .where('a.appointment_id', '=', existing.appointment_id)
          .select(['a.appointment_id', 'p.patient_name', 'p.phone', 'a.delivered_wa', 'a.updated_at'])
          .executeTakeFirst();

        log.info('Single message status updated successfully', { messageId, appointmentId: existing.appointment_id });
        return {
          success: true,
          found: true,
          appointment: info
            ? {
                appointmentId: info.appointment_id,
                patientName: info.patient_name,
                phone: info.phone ?? '',
                status: info.delivered_wa ?? '',
                lastUpdated: info.updated_at as Date,
              }
            : undefined,
        };
      });
    }, operationName)
    .catch((error: Error) => {
      log.error('Single message status update failed', { operationName, error: error.message });
      return { success: false, error: error.message };
    });
}

/**
 * Enhanced getWhatsAppDeliveryStatus — sent WA messages with a wamid for status polling.
 * (was: ProcFetch — note it returns the `@c.us`-suffixed chat id as `number`.)
 */
export async function getWhatsAppDeliveryStatus(
  date: Date | string
): Promise<WhatsAppDeliveryMessage[]> {
  const operationName = 'getWhatsAppDeliveryStatus';

  return dbCircuitBreaker
    .execute(async () => {
      const dateStr = typeof date === 'string' ? date.slice(0, 10) : toDateOnly(date);
      const rows = await getKysely()
        .selectFrom('appointments as a')
        .innerJoin('patients as p', 'p.person_id', 'a.person_id')
        .where('a.app_day', '=', sql<string>`${dateStr}::date`)
        .where('a.sent_wa', '=', true)
        .select([
          'a.appointment_id as id',
          sql<string>`COALESCE(p."country_code", '964') || p."phone" || '@c.us'`.as('number'),
          'a.wa_message_id as wamid',
        ])
        .execute();

      log.info('WhatsApp messages retrieved for status checking', { messageCount: rows.length, date });
      return rows.map((r) => ({ id: r.id, number: r.number, wamid: (r.wamid as string) ?? '' }));
    }, operationName)
    .catch((error: Error) => {
      log.error('Failed to retrieve WhatsApp delivery status', { operationName, error: error.message });
      return [];
    });
}

/**
 * SMS messages to send for a date. (was: ProcSMS) Returns nothing when the date is outside
 * [today, today+3]. Uses '+964' + raw phone, matching the proc.
 */
export async function getSmsMessages(date: Date | string): Promise<SmsMessage[]> {
  const operationName = 'getSmsMessages';

  return dbCircuitBreaker
    .execute(async () => {
      const dd = daysFromToday(date);
      if (dd < 0 || dd > 3) return [];

      const dateStr = typeof date === 'string' ? date.slice(0, 10) : toDateOnly(date);
      const aDay = arabicDay(dateStr);
      const eDay = englishDay(dateStr);
      // A_Mes is only set for DD 1/2 (else NULL → Arabic message empty, as in the proc).
      const aMes = dd === 1
        ? `غدا ${aDay} موعدك مع عيادة د.شوان الساعة`
        : dd === 2
          ? `بعد غد ${aDay} موعدك مع عيادة د.شوان الساعة`
          : null;
      const eMes = dd === 2
        ? `The day after tommorow "${eDay}" is your appointment with Dr. Shwan orthodontic clinic at `
        : `Tommorow "${eDay}" is your appointment with Dr. Shwan orthodontic clinic at `;

      const rows = await getKysely()
        .selectFrom('appointments as a')
        .innerJoin('patients as p', 'p.person_id', 'a.person_id')
        .where('a.app_day', '=', sql<string>`${dateStr}::date`)
        .where('a.want_notify', '=', true)
        .where((eb) => eb.or([eb('a.notified', 'is', null), eb('a.notified', '=', false)]))
        .select([
          'a.appointment_id as id',
          'p.phone as phone',
          'p.patient_name as patientName',
          'p.first_name as firstName',
          'p.language as language',
          'a.app_date as appDate',
        ])
        .execute();

      const out: SmsMessage[] = [];
      for (const r of rows) {
        const time = format12h(r.appDate as unknown as Date);
        let body: string;
        if (r.language === 1) {
          body = `Hello ${r.firstName ?? ''}. ${eMes} ${time}`;
        } else {
          body = aMes ? `مرحبا ${r.patientName}. ${aMes} ${time}` : '';
        }
        out.push({ id: r.id, to: `+964${r.phone ?? ''}`, body });
      }
      log.info('SMS messages retrieved successfully', { messageCount: out.length, date });
      return out;
    }, operationName)
    .catch((error: Error) => {
      log.error('Failed to retrieve SMS messages', { operationName, error: error.message });
      return [];
    });
}

/**
 * Store Twilio SIDs + mark notified. (was: ProcUpdatesms1 TVP proc.)
 */
export async function updateSmsIds(
  messages: Array<{ id: number; sid: string }>
): Promise<UpdateResult> {
  const operationName = 'updateSmsIds';

  return dbCircuitBreaker
    .execute(async () => {
      if (messages.length === 0) return { success: true, updatedCount: 0 };
      const ids = messages.map((m) => m.id);
      const sids = messages.map((m) => m.sid);
      await sql`
        UPDATE "appointments" AS a SET "sms_sid" = w.sid, "notified" = true, "want_wa" = false
        FROM unnest(${ids}::int[], ${sids}::text[]) AS w(appointmentid, sid)
        WHERE a."appointment_id" = w.appointmentid
      `.execute(getKysely());
      log.info('SMS IDs updated successfully', { updatedCount: messages.length });
      return { success: true, updatedCount: messages.length };
    }, operationName)
    .catch((error: Error) => {
      log.error('SMS id update failed', { operationName, error: error.message });
      return { success: false, error: error.message, updatedCount: 0 };
    });
}

/**
 * Sent SMS ids for status polling. (was: Procgetsids)
 */
export async function getSmsIds(date: Date | string): Promise<SmsIdMessage[]> {
  const operationName = 'getSmsIds';

  return dbCircuitBreaker
    .execute(async () => {
      const dateStr = typeof date === 'string' ? date.slice(0, 10) : toDateOnly(date);
      const rows = await getKysely()
        .selectFrom('appointments')
        .where('app_day', '=', sql<string>`${dateStr}::date`)
        .where('sms_sid', 'is not', null)
        .select(['appointment_id as id', 'sms_sid as sid'])
        .execute();
      log.info('SMS IDs retrieved for status checking', { idCount: rows.length });
      return rows.map((r) => ({ id: r.id, sid: (r.sid as string) ?? '' }));
    }, operationName)
    .catch((error: Error) => {
      log.error('Failed to retrieve SMS IDs', { operationName, error: error.message });
      return [];
    });
}

/**
 * Persist SMS delivery status. (was: ProcUpdatesms2 TVP proc.)
 */
export async function updateSmsStatus(messages: SmsStatusMessage[]): Promise<UpdateResult> {
  const operationName = 'updateSmsStatus';

  return dbCircuitBreaker
    .execute(async () => {
      if (messages.length === 0) return { success: true, updatedCount: 0 };
      const ids = messages.map((m) => m.id);
      const statuses = messages.map((m) => m.status);
      await sql`
        UPDATE "appointments" AS a SET "sms_status" = w.status
        FROM unnest(${ids}::int[], ${statuses}::text[]) AS w(appointmentid, status)
        WHERE a."appointment_id" = w.appointmentid
      `.execute(getKysely());
      log.info('SMS status update completed successfully', { updatedCount: messages.length });
      return { success: true, updatedCount: messages.length };
    }, operationName)
    .catch((error: Error) => {
      log.error('SMS status update failed', { operationName, error: error.message });
      return { success: false, error: error.message, updatedCount: 0 };
    });
}

/**
 * Per-date message status list + summary. (was: GetMessageStatusByDate)
 */
export async function getMessageStatusByDate(date: Date | string): Promise<MessageStatusResult> {
  const operationName = 'getMessageStatusByDate';

  return dbCircuitBreaker
    .execute(async () => {
      const dateStr = typeof date === 'string' ? date.slice(0, 10) : toDateOnly(date);
      const rows = await getKysely()
        .selectFrom('appointments as a')
        .innerJoin('patients as p', 'p.person_id', 'a.person_id')
        .where('a.app_day', '=', sql<string>`${dateStr}::date`)
        .orderBy('a.app_time')
        .select([
          'a.appointment_id as appointmentId',
          'p.patient_name as patientName',
          'p.phone as phone',
          'a.sent_wa as sentStatus',
          'a.delivered_wa as deliveryStatus',
          'a.wa_message_id as messageId',
          'a.sent_timestamp as sentTimestamp',
          'a.updated_at as lastUpdated',
        ])
        .execute();

      const messages = rows.map((r) => ({
        appointmentId: r.appointmentId,
        patientName: r.patientName ?? '',
        phone: r.phone ?? '',
        sentStatus: r.sentStatus ?? null,
        deliveryStatus: (r.deliveryStatus as string | null) ?? null,
        messageId: (r.messageId as string | null) ?? null,
        sentTimestamp: (r.sentTimestamp as Date | null) ?? null,
        lastUpdated: (r.lastUpdated as Date | null) ?? null,
      }));

      const summary: MessageStatusSummary = {
        total: messages.length,
        sent: messages.filter((r) => r.sentStatus).length,
        pending: messages.filter((r) => r.sentStatus && !r.deliveryStatus).length,
        delivered: messages.filter((r) => r.deliveryStatus === 'DEVICE' || r.deliveryStatus === 'SERVER').length,
        read: messages.filter((r) => r.deliveryStatus === 'READ' || r.deliveryStatus === 'PLAYED').length,
        failed: messages.filter((r) => r.deliveryStatus === 'ERROR').length,
      };

      log.debug('Message status summary retrieved', { date, total: summary.total, sent: summary.sent, read: summary.read });
      return { date, summary, messages };
    }, operationName)
    .catch((error: Error) => {
      log.error('Failed to retrieve message status summary', { operationName, error: error.message });
      return {
        date,
        error: error.message,
        summary: { total: 0, sent: 0, pending: 0, delivered: 0, read: 0, failed: 0 },
        messages: [],
      };
    });
}

/**
 * Build the reminder message for a single appointment. (was: GetNewAppointmentMessage)
 * Returns result=-1 (not found) / -2 (invalid phone) / 0 (ok), mirroring the proc's codes.
 */
export async function getNewAppointmentMessage(
  personId: number,
  appointmentId: number
): Promise<NewAppointmentMessage | null> {
  const row = await getKysely()
    .selectFrom('patients as p')
    .innerJoin('appointments as a', 'a.person_id', 'p.person_id')
    .where('p.person_id', '=', personId)
    .where('a.appointment_id', '=', appointmentId)
    .select([
      'p.patient_name as patientName',
      'p.first_name as firstName',
      'p.phone as phone',
      'p.country_code as countryCode',
      'p.language as language',
      'a.app_day as appDay',
      'a.app_date as appDate',
    ])
    .executeTakeFirst();

  if (!row || !row.patientName) {
    return { result: -1, phone: null, message: null, countryCode: null };
  }

  // The message text doesn't depend on the phone, so an invalid phone still
  // yields the built message (result -2, phone null) — the copy-to-clipboard
  // fallback needs the text precisely when the number can't be sent to.
  const phoneValid = isValidPhone(row.phone);
  const cc = row.countryCode || '964';
  const formattedPhone = phoneValid ? formatPhone(row.phone!, cc) : null;
  const appDay = row.appDay as unknown as string;
  const appDate = row.appDate as unknown as Date;
  const dd = daysFromToday(appDay);
  const time = format12h(appDate);
  const timeTt = format12h(appDate, true);
  const aDay = arabicDay(appDay);
  const eDay = englishDay(appDay);

  let message: string;
  if (row.language === 1) {
    if (dd === 1) {
      message = `Hello ${row.firstName || row.patientName}. Tomorrow "${eDay}" is your appointment with Dr. Shwan orthodontic clinic at ${timeTt}`;
    } else if (dd === 2) {
      message = `Hello ${row.firstName || row.patientName}. The day after tomorrow "${eDay}" is your appointment with Dr. Shwan orthodontic clinic at ${timeTt}`;
    } else {
      message = `Hello ${row.firstName || row.patientName}. Your appointment with Dr. Shwan orthodontic clinic is on ${eDay} ${formatDMY(appDay)} at ${timeTt}`;
    }
  } else {
    if (dd === 1) {
      message = `السلام عليك ${row.patientName}. غدا ${aDay} موعدك مع عيادة د.شوان لتقويم الاسنان الساعة ${time}`;
    } else if (dd === 2) {
      message = `السلام عليك ${row.patientName}. بعد غد ${aDay} موعدك مع عيادة د.شوان لتقويم الاسنان الساعة ${time}`;
    } else {
      message = `السلام عليك ${row.patientName}. موعدك مع عيادة د.شوان لتقويم الاسنان يوم ${aDay} ${formatDMY(appDay)} الساعة ${time}`;
    }
  }

  return { result: phoneValid ? 0 : -2, phone: formattedPhone, message, countryCode: cc };
}

/**
 * Reset all messaging state for a date. (was: ResetMessagingForDate, default full reset.)
 * Deletes that date's message-status history, clears the appointments' WA/SMS/notify fields, and
 * resets tblsms.smssent — all in one transaction.
 */
export async function resetMessagingForDate(date: string): Promise<ResetResult> {
  return withPgTransaction(async (trx) => {
    // Snapshot the pre-reset state FIRST. These counts describe what is about to
    // be cleared (already-sent/notified, what was wanted); measuring them after
    // the UPDATE below would read the just-reset values and report a constant
    // (sent_wa/notified → 0, want_wa/want_notify → total).
    const stats = await trx
      .selectFrom('appointments')
      .where('app_day', '=', sql<string>`${date}::date`)
      .select((eb) => [
        eb.fn.countAll<number>().as('total'),
        eb.fn.sum<number>(sql`CASE WHEN "want_wa" = true THEN 1 ELSE 0 END`).as('readyWa'),
        eb.fn.sum<number>(sql`CASE WHEN "want_notify" = true THEN 1 ELSE 0 END`).as('readySms'),
        eb.fn.sum<number>(sql`CASE WHEN "sent_wa" = true THEN 1 ELSE 0 END`).as('sentWa'),
        eb.fn.sum<number>(sql`CASE WHEN "notified" = true THEN 1 ELSE 0 END`).as('notified'),
      ])
      .executeTakeFirst();

    await sql`
      DELETE FROM "message_status_history"
      WHERE "appointment_id" IN (SELECT "appointment_id" FROM "appointments" WHERE "app_day" = ${date}::date)
    `.execute(trx);

    const upd = await sql`
      UPDATE "appointments" SET
        "notified" = false, "sent_wa" = false, "delivered_wa" = NULL, "want_wa" = true,
        "wa_message_id" = NULL, "sent_timestamp" = NULL,
        "delivered_timestamp" = NULL, "read_timestamp" = NULL, "want_notify" = true
      WHERE "app_day" = ${date}::date
    `.execute(trx);
    const appointmentsReset = Number(upd.numAffectedRows ?? 0);

    const smsUpd = await sql`UPDATE "sms" SET "sms_sent" = false WHERE "date" = ${date}::date`.execute(trx);
    const smsRecordsReset = Number(smsUpd.numAffectedRows ?? 0);

    return {
      resetDate: date,
      totalAppointments: Number(stats?.total ?? 0),
      readyForWhatsApp: Number(stats?.readyWa ?? 0),
      readyForSMS: Number(stats?.readySms ?? 0),
      alreadySentWA: Number(stats?.sentWa ?? 0),
      alreadyNotified: Number(stats?.notified ?? 0),
      appointmentsReset,
      smsRecordsReset,
    };
  });
}

