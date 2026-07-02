/**
 * API contract — the lab case tracker (`lab_cases` header + `lab_case_events`
 * append-only timeline; see migrations/pg/1782700000000_lab-cases.sql). Both
 * tables are FAILOVER-MIRRORED, forward-only (local -> Supabase) — no
 * `updated_at`, never reverse-synced; see the migration header comment.
 *
 * Imported by BOTH the Express routes (relative `.js`) and the React app
 * (`@shared` alias). One `export const <action> = { … } as const` per endpoint;
 * types via `z.infer`.
 *
 * `LAB_STAGE_META` is the stage-machine SSoT — an ORDERED array of
 * `{ key, location }`. Order encodes the pipeline sequence the service's
 * lenient forward-skip walks (`index(to) > index(from)`); `location` tells the
 * backend (the remake-default walk-back-to-the-nearest-lab-stage rule) AND the
 * frontend (the board's At Lab / In Clinic column grouping) where a case
 * physically sits — it lives here, not in a frontend-only config, because the
 * backend needs it too.
 */
import { z } from 'zod';
import { idParams, timestampString, optionalDateString, optionalPositiveIntQuery } from '../validation.js';

export type LabStageLocation = 'lab' | 'clinic' | 'done';

// The ordered pipeline — a real tuple literal (not derived from LAB_STAGE_META)
// so `z.enum(LAB_STAGES)` gets the tuple type it needs.
export const LAB_STAGES = [
  'sent_to_lab',
  'wax_up_tryin',
  'pattern_fab',
  'plastic_check',
  'framework_fab',
  'framework_tryin',
  'ceramic_buildup',
  'bisque_tryin',
  'glaze',
  'ready',
  'delivered',
] as const;
export type LabStage = (typeof LAB_STAGES)[number];

const LAB_STAGE_LOCATIONS: Record<LabStage, LabStageLocation> = {
  sent_to_lab: 'lab',
  wax_up_tryin: 'clinic',
  pattern_fab: 'lab',
  plastic_check: 'clinic',
  framework_fab: 'lab',
  framework_tryin: 'clinic',
  ceramic_buildup: 'lab',
  bisque_tryin: 'clinic',
  glaze: 'lab',
  ready: 'clinic',
  delivered: 'done',
};

// Derived from LAB_STAGES (the tuple is the SSoT for order); location is looked
// up per key. Consumed by both sides: the backend's remake-default walk-back rule
// and the frontend's board column grouping / stage labels.
export const LAB_STAGE_META: { key: LabStage; location: LabStageLocation }[] = LAB_STAGES.map((key) => ({
  key,
  location: LAB_STAGE_LOCATIONS[key],
}));

export const LAB_CASE_STATUSES = [...LAB_STAGES, 'cancelled'] as const;
export type LabCaseStatus = (typeof LAB_CASE_STATUSES)[number];

export const LAB_CASE_EVENT_TYPES = ['stage_change', 'remake', 'hold', 'resume', 'note', 'cancel'] as const;
export type LabCaseEventType = (typeof LAB_CASE_EVENT_TYPES)[number];

// ── Rows ─────────────────────────────────────────────────────────────────────

// Raw `lab_cases` row (create/advance/remake/hold/resume/cancel/patch all
// RETURNING * a plain row) — the container default is loose.
export const labCaseRow = z.looseObject({
  id: z.number(),
  work_item_id: z.number(),
  person_id: z.number(),
  lab_id: z.number().nullable(),
  material: z.string().nullable(),
  status: z.enum(LAB_CASE_STATUSES),
  is_on_hold: z.boolean(),
  is_rush: z.boolean(),
  due_date: z.string().nullable(),
  sent_at: timestampString,
  delivered_at: timestampString.nullable(),
  remake_count: z.number(),
  status_changed_at: timestampString,
  note: z.string().nullable(),
  created_at: timestampString,
  created_by: z.string().nullable(),
  delivered_by: z.string().nullable(),
});
export type LabCaseRow = z.infer<typeof labCaseRow>;

// Assembled board/detail row — a server-side join (patient, work type, teeth,
// lab name), so it's a CLOSED z.object (fully modeled), not a D2 marker.
export const labCaseBoardRow = z.object({
  id: z.number(),
  work_id: z.number(),
  work_item_id: z.number(),
  person_id: z.number(),
  patient_name: z.string(),
  restoration: z.string(),
  teeth: z.string().nullable(),
  lab_id: z.number().nullable(),
  lab_name: z.string().nullable(),
  material: z.string().nullable(),
  shade_system: z.string().nullable(),
  shade: z.string().nullable(),
  status: z.enum(LAB_CASE_STATUSES),
  is_on_hold: z.boolean(),
  is_rush: z.boolean(),
  due_date: z.string().nullable(),
  sent_at: timestampString,
  delivered_at: timestampString.nullable(),
  remake_count: z.number(),
  status_changed_at: timestampString,
  note: z.string().nullable(),
  created_at: timestampString,
  created_by: z.string().nullable(),
  delivered_by: z.string().nullable(),
});
export type LabCaseBoardRow = z.infer<typeof labCaseBoardRow>;

// Raw `lab_case_events` row — fully modeled (small, fixed column set), closed.
export const labCaseEventRow = z.object({
  id: z.number(),
  lab_case_id: z.number(),
  event_type: z.enum(LAB_CASE_EVENT_TYPES),
  from_status: z.string().nullable(),
  to_status: z.string().nullable(),
  occurred_at: timestampString,
  note: z.string().nullable(),
  created_by: z.string().nullable(),
  created_at: timestampString,
});
export type LabCaseEventRow = z.infer<typeof labCaseEventRow>;

// ── Endpoints ────────────────────────────────────────────────────────────────

// GET /api/lab-cases — board/list.
export const listLabCases = {
  query: z.object({
    status: z.enum(LAB_CASE_STATUSES).optional(),
    labId: optionalPositiveIntQuery,
    overdue: z.enum(['true', 'false']).optional(),
    q: z.string().optional(),
    from: optionalDateString,
    to: optionalDateString,
  }),
  response: z.array(labCaseBoardRow),
} as const;
export type ListLabCasesQuery = z.infer<typeof listLabCases.query>;

// GET /api/lab-cases/:id — one case + its lab_case_events timeline.
export const getLabCase = {
  params: idParams('id'),
  response: z.object({
    case: labCaseBoardRow,
    events: z.array(labCaseEventRow),
  }),
} as const;

// POST /api/lab-cases — Start Lab Flow (or reactivate a cancelled case).
export const createLabCase = {
  body: z.object({
    workItemId: z.coerce.number().int().positive(),
    labId: z.coerce.number().int().positive().optional(),
    material: z.string().optional(),
    dueDate: optionalDateString,
    isRush: z.boolean().optional(),
    sentOn: optionalDateString,
    note: z.string().optional(),
  }),
  response: labCaseRow,
} as const;
export type CreateLabCaseBody = z.infer<typeof createLabCase.body>;

// POST /api/lab-cases/:id/advance — guarded stage transition.
export const advanceLabCase = {
  params: idParams('id'),
  body: z.object({
    fromStatus: z.enum(LAB_STAGES),
    toStatus: z.enum(LAB_STAGES),
    occurredAt: optionalDateString,
    note: z.string().optional(),
  }),
  response: labCaseRow,
} as const;
export type AdvanceLabCaseBody = z.infer<typeof advanceLabCase.body>;

// POST /api/lab-cases/:id/remake — refuse/remake, revert to an earlier at-lab stage.
export const remakeLabCase = {
  params: idParams('id'),
  body: z.object({
    returnToStatus: z.enum(LAB_STAGES).optional(),
    reason: z.string().min(1),
    occurredAt: optionalDateString,
  }),
  response: labCaseRow,
} as const;
export type RemakeLabCaseBody = z.infer<typeof remakeLabCase.body>;

// POST /api/lab-cases/:id/hold — set the is_on_hold overlay.
export const holdLabCase = {
  params: idParams('id'),
  body: z.object({ note: z.string().optional() }),
  response: labCaseRow,
} as const;
export type HoldLabCaseBody = z.infer<typeof holdLabCase.body>;

// POST /api/lab-cases/:id/resume — clear the is_on_hold overlay.
export const resumeLabCase = {
  params: idParams('id'),
  body: z.object({ note: z.string().optional() }),
  response: labCaseRow,
} as const;
export type ResumeLabCaseBody = z.infer<typeof resumeLabCase.body>;

// PATCH /api/lab-cases/:id — edit metadata (lab/due date/rush/note).
export const updateLabCase = {
  params: idParams('id'),
  body: z.object({
    labId: z.union([z.literal(''), z.coerce.number().int().positive()]).optional(),
    dueDate: optionalDateString,
    isRush: z.boolean().optional(),
    note: z.string().optional(),
  }),
  response: labCaseRow,
} as const;
export type UpdateLabCaseBody = z.infer<typeof updateLabCase.body>;

// POST /api/lab-cases/:id/cancel — soft close.
export const cancelLabCase = {
  params: idParams('id'),
  body: z.object({ note: z.string().optional() }),
  response: labCaseRow,
} as const;
export type CancelLabCaseBody = z.infer<typeof cancelLabCase.body>;

// DELETE /api/lab-cases/:id — admin-only hard delete (mistakes).
export const deleteLabCase = {
  params: idParams('id'),
  response: z.object({ id: z.number() }),
} as const;
