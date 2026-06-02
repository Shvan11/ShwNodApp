/**
 * Patient Portal Service
 *
 * Business logic for the patient-facing portal:
 * - PIN derivation (default from phone / date-of-birth), hashing, verification
 * - Failed-attempt lockout bookkeeping
 * - Photo visibility filter (public by default; tblPrivatePhotos stores exceptions)
 * - QR code generation for the portal url
 */
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { sql } from 'kysely';
import { getKysely } from '../database/kysely.js';
import {
  getAuthRow,
  upsertPin,
  recordSuccessfulLogin,
  recordFailedAttempt,
  setEnabled as dbSetEnabled,
  clearLockout as dbClearLockout,
} from '../database/queries/patient-portal-auth-queries.js';
import {
  listPrivateForPatient,
  listPrivateForTimepoint,
  markPrivate,
  markPublic,
} from '../database/queries/private-photos-queries.js';
import { getImageSizes, type ImageDimension } from '../imaging/index.js';
import config from '../../config/config.js';
import { log } from '../../utils/logger.js';

const BCRYPT_ROUNDS = 12;
const LOCKOUT_MINUTES = 30;

export interface PatientPortalProfile {
  person_id: number;
  patient_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  date_of_birth: Date | null;
  language: number | null;
}

export interface PortalLoginResult {
  ok: boolean;
  patientName?: string | null;
  language?: number | null;
  error?: string;
  lockedUntil?: Date | null;
}

export interface PortalStatus {
  enabled: boolean;
  hasPin: boolean;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  failedAttempts: number;
}

/**
 * Fetch the minimal patient profile needed for PIN defaults and portal display.
 */
export async function getPatientProfile(personId: number): Promise<PatientPortalProfile | null> {
  const db = getKysely();
  const { rows } = await sql<PatientPortalProfile>`
    SELECT "person_id", "patient_name", "first_name", "last_name", "phone", "date_of_birth", "language"
     FROM "patients" WHERE "person_id" = ${personId}
     LIMIT 1`.execute(db);
  return rows[0] ?? null;
}

/**
 * Derive a default 4-digit PIN:
 *   1. Last 4 digits of phone (digits only), or
 *   2. DDMM of date_of_birth, or
 *   3. null (staff must set it manually).
 */
export function deriveDefaultPin(profile: PatientPortalProfile): string | null {
  if (profile.phone) {
    const digits = profile.phone.replace(/\D/g, '');
    if (digits.length >= 4) return digits.slice(-4);
  }
  if (profile.date_of_birth) {
    const d = profile.date_of_birth instanceof Date ? profile.date_of_birth : new Date(profile.date_of_birth);
    if (!isNaN(d.getTime())) {
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      return `${dd}${mm}`;
    }
  }
  return null;
}

/**
 * Validate a raw PIN value: 4-6 digits, numeric only.
 */
function isValidPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

/**
 * Reset the patient's PIN to the default derived from phone/DOB.
 * Returns the plaintext PIN exactly once (for staff to share with patient).
 */
export async function resetToDefaultPin(personId: number): Promise<string> {
  const profile = await getPatientProfile(personId);
  if (!profile) throw new Error('Patient not found');
  const pin = deriveDefaultPin(profile);
  if (!pin) {
    throw new Error(
      'Cannot derive default PIN: patient has no phone number (≥4 digits) and no date of birth. Set a PIN manually.'
    );
  }
  await setPin(personId, pin);
  return pin;
}

/**
 * Set (or replace) the patient's PIN. Stored as bcrypt hash.
 */
export async function setPin(personId: number, pin: string): Promise<void> {
  if (!isValidPin(pin)) {
    throw new Error('PIN must be 4-6 digits.');
  }
  const hash = await bcrypt.hash(pin, BCRYPT_ROUNDS);
  await upsertPin(personId, hash);
}

/**
 * Verify a PIN and update lockout/login counters atomically-ish.
 */
export async function verifyPin(personId: number, pin: string): Promise<PortalLoginResult> {
  const profile = await getPatientProfile(personId);
  if (!profile) {
    return { ok: false, error: 'Invalid credentials' };
  }

  const auth = await getAuthRow(personId);
  if (!auth) {
    return { ok: false, error: 'Portal access is not enabled for this patient.' };
  }
  if (!auth.enabled) {
    return { ok: false, error: 'Portal access is disabled for this patient.' };
  }
  if (auth.locked_until && auth.locked_until.getTime() > Date.now()) {
    return {
      ok: false,
      error: 'Too many failed attempts. Please try again later.',
      lockedUntil: auth.locked_until,
    };
  }

  const match = await bcrypt.compare(pin, auth.pin_hash);
  if (!match) {
    const { lockedUntil } = await recordFailedAttempt(personId);
    return {
      ok: false,
      error: lockedUntil
        ? `Account locked for ${LOCKOUT_MINUTES} minutes due to too many failed attempts.`
        : 'Invalid credentials',
      lockedUntil,
    };
  }

  await recordSuccessfulLogin(personId);
  return {
    ok: true,
    patientName: profile.patient_name,
    language: profile.language,
  };
}

export async function getStatus(personId: number): Promise<PortalStatus> {
  const auth = await getAuthRow(personId);
  if (!auth) {
    return {
      enabled: false,
      hasPin: false,
      lockedUntil: null,
      lastLoginAt: null,
      failedAttempts: 0,
    };
  }
  return {
    enabled: auth.enabled,
    hasPin: true,
    lockedUntil:
      auth.locked_until && auth.locked_until.getTime() > Date.now() ? auth.locked_until : null,
    lastLoginAt: auth.last_login_at,
    failedAttempts: auth.failed_attempts,
  };
}

export async function setEnabled(personId: number, enabled: boolean): Promise<void> {
  await dbSetEnabled(personId, enabled);
}

export async function unlock(personId: number): Promise<void> {
  await dbClearLockout(personId);
}

/**
 * Build the portal url for this patient's QR code.
 */
export function portalUrlFor(personId: number): string {
  const publicUrl = config.urls.publicUrl || 'https://remote.shwan-orthodontics.com';
  return `${publicUrl}/portal?pid=${personId}`;
}

/**
 * Render a QR code (data url) that points to the patient's portal login page.
 */
export async function getQrDataUrl(personId: number): Promise<{ qr: string; url: string }> {
  const url = portalUrlFor(personId);
  try {
    const qr = await QRCode.toDataURL(url, {
      width: 300,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });
    return { qr, url };
  } catch (err) {
    log.error('Failed to generate portal QR code', {
      error: (err as Error).message,
      personId,
    });
    throw err;
  }
}

/**
 * Return the photos at a timepoint that the patient may see.
 * Removes entries whose filenames appear in tblPrivatePhotos for (personId, tp).
 * Always filters out the 'logo.png' slot (not a patient photo).
 */
export async function getVisiblePhotos(
  personId: number,
  tp: string
): Promise<ImageDimension[]> {
  const [sizes, privateRows] = await Promise.all([
    getImageSizes(String(personId), tp),
    listPrivateForTimepoint(personId, tp),
  ]);
  const privateSet = new Set(privateRows.map((r) => r.image_name.toLowerCase()));
  const visible: ImageDimension[] = [];
  for (const entry of sizes) {
    if (!entry) continue;
    if (entry.name === 'logo.png') continue;
    if (privateSet.has(entry.name.toLowerCase())) continue;
    visible.push(entry);
  }
  return visible;
}

export async function getPrivateList(personId: number) {
  return listPrivateForPatient(personId);
}

export async function togglePhotoPrivacy(
  personId: number,
  tp: string,
  name: string,
  isPrivate: boolean,
  byUserId: number | null
): Promise<void> {
  if (isPrivate) {
    await markPrivate(personId, tp, name, byUserId);
  } else {
    await markPublic(personId, tp, name);
  }
}
