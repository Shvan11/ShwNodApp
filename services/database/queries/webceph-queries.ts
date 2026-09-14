/**
 * WebCeph patient link (`patients.web_ceph_*`) — the single owner of that SQL.
 *
 * The three columns (`web_ceph_patient_id` / `web_ceph_link` /
 * `web_ceph_created_at`) live on `patients` but are touched only by the WebCeph
 * integration, so they get their own module rather than swelling
 * `patient-queries.ts`. Extracted from `routes/api/media.routes.ts` (R9(b)).
 */
import { sql } from 'kysely';
import { getKysely } from '../kysely.js';

/**
 * The stored link. `type` (not `interface`) so it feeds `sendData` — the
 * index-signature rule (CLAUDE.md / TS2345). `createdAt` is a `Date` (the
 * `timestamp` parser).
 */
export type WebCephPatientLink = {
  webcephPatientId: string | null;
  link: string | null;
  createdAt: Date | null;
};

/**
 * Look up a patient's stored WebCeph id. `undefined` = no such patient;
 * `{ webcephPatientId: null }` = patient exists but isn't in WebCeph yet.
 */
export async function findPatientWebcephId(
  personId: number
): Promise<{ webcephPatientId: string | null } | undefined> {
  const { rows } = await sql<{ webcephPatientId: string | null }>`
    SELECT "web_ceph_patient_id" AS "webcephPatientId"
    FROM "patients"
    WHERE "person_id" = ${personId}
  `.execute(getKysely());
  return rows[0];
}

/**
 * Record the WebCeph id + share link on a patient after a successful create.
 *
 * Both values are optional on the WebCeph service's response type, so an absent
 * one is stored as NULL rather than being dropped — which is what the raw
 * binding did before this moved out of the route.
 */
export async function setPatientWebcephLink(
  personId: number,
  webcephPatientId: string | null | undefined,
  link: string | null | undefined
): Promise<void> {
  // LOCALTIMESTAMP, not now()/CURRENT_TIMESTAMP: the column is `timestamp`
  // WITHOUT time zone (clinic wall-clock) — see CLAUDE.md's date gotchas.
  await sql`
    UPDATE "patients"
    SET "web_ceph_patient_id" = ${webcephPatientId ?? null},
        "web_ceph_link" = ${link ?? null},
        "web_ceph_created_at" = LOCALTIMESTAMP
    WHERE "person_id" = ${personId}
  `.execute(getKysely());
}

/**
 * The full stored link for a patient, or undefined when the patient row is
 * missing. A row whose `webcephPatientId` is null means "not in WebCeph yet" —
 * the caller decides how to report that.
 */
export async function getPatientWebcephLink(
  personId: number
): Promise<WebCephPatientLink | undefined> {
  const { rows } = await sql<WebCephPatientLink>`
    SELECT "web_ceph_patient_id" AS "webcephPatientId", "web_ceph_link" AS "link", "web_ceph_created_at" AS "createdAt"
    FROM "patients"
    WHERE "person_id" = ${personId}
  `.execute(getKysely());
  return rows[0];
}
