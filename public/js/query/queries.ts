/**
 * Query-options factories — the single definition of each read, reused by BOTH
 * route loaders (prefetch via `loaderQuery`/`ensureQueryData`) and components
 * (`useQuery`). Each pairs a `qk` key with a `core/http` fetch carrying the
 * shared Zod `.response` contract (so the `require-schema-on-reads` rule and the
 * fail-loud H11 guard are satisfied in one place).
 *
 * Typed with `z.infer<typeof X.response>` so a factory depends only on the
 * contract's schema export — no parallel hand-written response type.
 *
 * This file grows as screens migrate; only the factories currently wired live
 * here.
 */
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { fetchJSON } from '@/core/http';
import * as patientContract from '@shared/contracts/patient.contract';
import * as workContract from '@shared/contracts/work.contract';
import * as templateContract from '@shared/contracts/template.contract';
import * as alignerContract from '@shared/contracts/aligner.contract';
import { qk } from './keys';

type Id = number | string;

// ---------------------------------------------------------------------------
// Patient
// ---------------------------------------------------------------------------

/** GET /api/patients/:id/info — demographics (deduped across Work/View/Xrays/Diagnosis). */
export const patientInfoQuery = (id: Id) =>
  queryOptions({
    queryKey: qk.patient.info(id),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof patientContract.patientInfo.response>>(`/api/patients/${id}/info`, {
        signal,
        schema: patientContract.patientInfo.response,
      }),
  });

/** GET /api/patients/:id — patientById (the edit form; a different endpoint from info). */
export const patientByIdQuery = (id: Id) =>
  queryOptions({
    queryKey: qk.patient.full(id),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof patientContract.patientById.response>>(`/api/patients/${id}`, {
        signal,
        schema: patientContract.patientById.response,
      }),
  });

/** GET /api/patients/:id/timepoints — photos/compare/xrays timepoint list. */
export const timepointsQuery = (id: Id) =>
  queryOptions({
    queryKey: qk.patient.timepoints(id),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof patientContract.timepoints.response>>(
        `/api/patients/${id}/timepoints`,
        { signal, schema: patientContract.timepoints.response }
      ),
  });

// ---------------------------------------------------------------------------
// Work
// ---------------------------------------------------------------------------

/** GET /api/getworkdetails?workId= — single work row. */
export const workDetailsQuery = (workId: Id) =>
  queryOptions({
    queryKey: qk.work.details(workId),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof workContract.getWorkDetails.response>>(
        `/api/getworkdetails?workId=${workId}`,
        { signal, schema: workContract.getWorkDetails.response }
      ),
  });

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/** GET /api/templates — template list. */
export const templatesQuery = () =>
  queryOptions({
    queryKey: qk.templates.list(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof templateContract.getTemplates.response>>('/api/templates', {
        signal,
        schema: templateContract.getTemplates.response,
      }),
  });

/** GET /api/templates/:id — single template (designer edit mode). */
export const templateQuery = (id: Id) =>
  queryOptions({
    queryKey: qk.templates.one(id),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof templateContract.getTemplate.response>>(`/api/templates/${id}`, {
        signal,
        schema: templateContract.getTemplate.response,
      }),
  });

// ---------------------------------------------------------------------------
// Aligner
// ---------------------------------------------------------------------------

/** GET /api/aligner/doctors — aligner doctors list. */
export const alignerDoctorsQuery = () =>
  queryOptions({
    queryKey: qk.aligner.doctors(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof alignerContract.alignerDoctors.response>>('/api/aligner/doctors', {
        signal,
        schema: alignerContract.alignerDoctors.response,
      }),
  });

// ---------------------------------------------------------------------------
// Lookups — patient-management filter data
// ---------------------------------------------------------------------------

/** GET /api/patients/phones — patient phone/name list (patient-management). */
export const patientPhonesQuery = () =>
  queryOptions({
    queryKey: qk.lookups.patientPhones(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof patientContract.patientPhones.response>>('/api/patients/phones', {
        signal,
        schema: patientContract.patientPhones.response,
      }),
  });

/** GET /api/getworktypes — work-type options. */
export const workTypesQuery = () =>
  queryOptions({
    queryKey: qk.lookups.workTypes(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof workContract.getWorkTypes.response>>('/api/getworktypes', {
        signal,
        schema: workContract.getWorkTypes.response,
      }),
  });

/** GET /api/getworkkeywords — work-keyword options. */
export const workKeywordsQuery = () =>
  queryOptions({
    queryKey: qk.lookups.workKeywords(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof workContract.getWorkKeywords.response>>('/api/getworkkeywords', {
        signal,
        schema: workContract.getWorkKeywords.response,
      }),
  });

/** GET /api/patients/tag-options — patient tag options. */
export const tagOptionsQuery = () =>
  queryOptions({
    queryKey: qk.lookups.tagOptions(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof patientContract.tagOptions.response>>('/api/patients/tag-options', {
        signal,
        schema: patientContract.tagOptions.response,
      }),
  });

/** GET /api/patients/type-options — patient type options. */
export const typeOptionsQuery = () =>
  queryOptions({
    queryKey: qk.lookups.typeOptions(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof patientContract.typeOptions.response>>('/api/patients/type-options', {
        signal,
        schema: patientContract.typeOptions.response,
      }),
  });
