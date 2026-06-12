/**
 * Loader utilities for Data Router
 *
 * These utilities handle:
 * - Prefetching reads into the shared React Query cache (via loaderQuery) so the
 *   screen paints instantly from cache when it mounts and calls useQuery
 * - 401 redirect (preserving existing auth pattern)
 * - Abort controller support (for navigation cancellation)
 */

import type { LoaderFunctionArgs } from 'react-router-dom';
import { fetchJSON, httpErrorMessage, type HttpError } from '@/core/http';
import { dailyAppointments } from '@shared/contracts/appointment.contract';
import { patientPhones, patientSearch, tagOptions, typeOptions } from '@shared/contracts/patient.contract';
import * as workContract from '@shared/contracts/work.contract';
import { queryClient } from '../query/client';
import { loaderQuery } from '../query/loaderQuery';
import {
  patientInfoQuery,
  workDetailsQuery,
  timepointsQuery,
  alignerDoctorsQuery,
  templatesQuery,
  templateQuery,
} from '../query/queries';

/**
 * Tolerate a per-endpoint non-2xx (return an empty array, as the old
 * `res.ok ? json : []` guards did) while letting a network/abort error reject —
 * so a genuine transport failure still propagates to the loader's outer catch.
 */
function emptyOnHttpError<U>(p: Promise<U[]>): Promise<U[]> {
  return p.catch((err: unknown) => {
    if (typeof (err as HttpError).status === 'number') return [];
    throw err;
  });
}

/**
 * Patient data structure (snake_case from /api/patients/:id/info)
 */
export interface PatientData {
  person_id?: number;
  patient_name?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  phone2?: string;
  email?: string;
  [key: string]: unknown;
}

/**
 * Work data structure
 */
export interface WorkData {
  work_id?: number;
  person_id?: number;
  type_name?: string;
  doctor_name?: string;
  status_name?: string;
  [key: string]: unknown;
}

/**
 * Template data structure
 */
export interface TemplateData {
  id?: number;
  name?: string;
  type?: string;
  content?: string;
  [key: string]: unknown;
}

/**
 * Appointment stats
 */
export interface AppointmentStats {
  total: number;
  checkedIn: number;
  absent: number;
  waiting: number;
}

/**
 * Higher-order loader that wraps any loader with authentication check
 * Redirects to /login.html on 401 responses
 *
 * @param loaderFn - The actual loader function (can be null for auth-only check)
 * @returns Wrapped loader with auth check
 */
export function withAuth<T>(
  loaderFn: ((args: LoaderFunctionArgs) => Promise<T>) | null = null
): (args: LoaderFunctionArgs) => Promise<T | null> {
  return async (args: LoaderFunctionArgs): Promise<T | null> => {
    try {
      // If a loader function is provided, execute it
      // The loaderQuery inside will handle 401 redirects automatically
      if (loaderFn) {
        return await loaderFn(args);
      }

      // Auth-only check: verify session with lightweight endpoint
      // eslint-disable-next-line no-restricted-syntax -- session ping; no payload to validate
      await fetchJSON('/api/auth/verify', { signal: args.request?.signal });
      return null; // No data to return for auth-only loaders
    } catch (error) {
      // A nested loader already mapped its failure to a Response (incl. its own
      // 401 redirect) — propagate it untouched.
      if (error instanceof Response) {
        throw error;
      }

      const httpErr = error as HttpError;

      // Auth-only verify path: 401 → redirect to login.
      if (httpErr.status === 401) {
        console.warn('[withAuth] 401 Unauthorized - redirecting to login');
        queryClient.clear(); // session over — don't leave cached data for the next user
        window.location.href = '/login.html';
        throw new Response('Unauthorized', { status: 401 });
      }

      // Any other non-2xx from the verify check was previously treated as
      // "session OK" (the code only redirected on 401) — preserve that.
      if (typeof httpErr.status === 'number') {
        return null;
      }

      // Network/abort error — propagate to the route error boundary.
      throw error;
    }
  };
}

/**
 * Patient info loader result
 */
export interface PatientInfoLoaderResult {
  patient: PatientData | null;
  isNew: boolean;
}

/**
 * Patient info loader
 * Used by patient portal routes
 */
export async function patientInfoLoader({
  params,
}: LoaderFunctionArgs): Promise<PatientInfoLoaderResult> {
  const { personId } = params;

  // Skip loading for "new" patient (add patient form)
  if (personId === 'new' || isNaN(parseInt(personId || ''))) {
    return { patient: null, isNew: true };
  }

  const data = (await loaderQuery(patientInfoQuery(personId!))) as PatientData;
  return { patient: data, isNew: false };
}

/**
 * Work details loader result
 */
export interface WorkDetailsLoaderResult {
  work: WorkData | null;
}

/**
 * Work details loader
 * Used by visits/diagnosis pages
 */
export async function workDetailsLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<WorkDetailsLoaderResult> {
  const { workId } = params;
  const url = new URL(request.url);
  const workIdFromQuery = url.searchParams.get('workId');
  const effectiveWorkId = workId || workIdFromQuery;

  if (!effectiveWorkId) {
    return { work: null };
  }

  const data = (await loaderQuery(workDetailsQuery(effectiveWorkId))) as WorkData;
  return { work: data };
}

/**
 * Timepoint data
 */
export interface TimepointData {
  tp_code?: string | number;
  tp_date_time?: string;
  tp_description?: string;
  [key: string]: unknown;
}

/**
 * Patient shell loader result
 */
export interface PatientShellLoaderResult {
  patient: PatientData | null;
  work: WorkData | null;
  timepoints: TimepointData[];
  isNew: boolean;
  currentPage: string;
  workId: string | null;
}

/**
 * Patient shell loader (comprehensive)
 * Loads patient demographic data and work details (if applicable)
 * This runs BEFORE PatientShell renders, eliminating the loading flash
 */
export async function patientShellLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<PatientShellLoaderResult> {
  const { personId, page, workId } = params;
  const url = new URL(request.url);
  const workIdFromQuery = url.searchParams.get('workId');
  const effectiveWorkId = workId || workIdFromQuery;

  // Skip loading for "new" patient (add patient form)
  if (personId === 'new' || isNaN(parseInt(personId || ''))) {
    return {
      patient: null,
      work: null,
      timepoints: [],
      isNew: true,
      currentPage: page || 'works',
      workId: effectiveWorkId,
    };
  }

  // Load patient demographics
  const patientPromise = loaderQuery(patientInfoQuery(personId!));

  // Load work details if workId is present
  const workPromise = effectiveWorkId
    ? loaderQuery(workDetailsQuery(effectiveWorkId))
    : Promise.resolve(null);

  // Load time points for photos/comparison pages
  const timepointsPromise =
    page && (page.startsWith('photos') || page === 'compare' || page === 'xrays')
      ? loaderQuery(timepointsQuery(personId!))
      : Promise.resolve(null);

  // Wait for all promises in parallel
  const [patient, work, timepoints] = await Promise.all([
    patientPromise,
    workPromise,
    timepointsPromise,
  ]);

  return {
    patient: (patient ?? null) as PatientData | null,
    work: (work ?? null) as WorkData | null,
    timepoints: (timepoints ?? []) as TimepointData[],
    isNew: false,
    currentPage: page || 'works',
    workId: effectiveWorkId,
  };
}

/**
 * Doctor data
 */
export interface DoctorData {
  dr_id?: number;
  doctor_name?: string;
  doctor_email?: string | null;
  logo_path?: string | null;
  [key: string]: unknown;
}

/**
 * Aligner doctors loader result
 */
export interface AlignerDoctorsLoaderResult {
  doctors: DoctorData[];
  success: boolean;
}

/**
 * Aligner doctors loader
 * Used by aligner management routes
 */
export async function alignerDoctorsLoader(): Promise<AlignerDoctorsLoaderResult> {
  const data = await loaderQuery(alignerDoctorsQuery());
  return { doctors: (data.doctors ?? []) as DoctorData[], success: true };
}

/**
 * Aligner patient work loader result
 */
export interface AlignerPatientWorkLoaderResult {
  work: WorkData;
  patient: PatientData;
}

/**
 * Aligner patient work loader
 * Loads patient and work details for aligner sets page
 */
export async function alignerPatientWorkLoader({
  params,
}: LoaderFunctionArgs): Promise<AlignerPatientWorkLoaderResult> {
  const { workId } = params;

  // Validate workId before making API calls
  if (!workId || isNaN(parseInt(workId))) {
    throw new Response('Invalid work ID', { status: 400 });
  }

  const work = (await loaderQuery(workDetailsQuery(workId))) as WorkData;

  // Validate person_id before fetching patient data
  if (!work?.person_id) {
    throw new Response('Work record has no associated patient', { status: 404 });
  }

  // Also load patient info
  const patient = (await loaderQuery(patientInfoQuery(work.person_id))) as PatientData;

  return {
    work,
    patient,
  };
}

/**
 * Template list loader result
 */
export interface TemplateListLoaderResult {
  templates: TemplateData[];
}

/**
 * Template list loader
 * Loads available templates for management page
 */
export async function templateListLoader(): Promise<TemplateListLoaderResult> {
  const data = await loaderQuery(templatesQuery());
  return { templates: (data ?? []) as TemplateData[] };
}

/**
 * Template designer loader result
 */
export interface TemplateDesignerLoaderResult {
  template: TemplateData | null;
  mode: 'create' | 'edit';
}

/**
 * Template designer loader (optional - for edit mode)
 * Loads template data for editing
 */
export async function templateDesignerLoader({
  params,
}: LoaderFunctionArgs): Promise<TemplateDesignerLoaderResult> {
  const { templateId } = params;

  // Creating new template
  if (!templateId) {
    return { template: null, mode: 'create' };
  }

  // Loading existing template
  const data = (await loaderQuery(templateQuery(templateId))) as TemplateData;
  return { template: data, mode: 'edit' };
}

/**
 * Select option format for react-select
 */
export interface SelectOption {
  value: number | string;
  label: string;
}

/**
 * Patient management loader result
 */
export interface PatientManagementLoaderResult {
  allPatients: PatientData[];
  workTypes: SelectOption[];
  keywords: SelectOption[];
  tags: SelectOption[];
  patientTypes: SelectOption[];
  searchResults: PatientData[] | null;
  error?: string;
  _loaderTimestamp: number;
}

/**
 * PATIENT MANAGEMENT LOADER
 * Pre-fetches filter data (work types, keywords, tags, patient list)
 * Enables native scroll restoration via React Router
 */
export async function patientManagementLoader({
  request,
}: LoaderFunctionArgs): Promise<PatientManagementLoaderResult> {
  const { signal } = request;
  const url = new URL(request.url);

  if (import.meta.env.DEV) console.log('[Loader] Pre-fetching patient management filter data');

  try {
    // Fetch all filter data in parallel. Each lookup returns a raw array
    // (fetchJSON passthrough) and tolerates its own non-2xx (→ empty) so one bad
    // lookup doesn't blank the rest; a network/abort error still rejects → outer catch.
    const [allPatients, workTypesData, keywordsData, tagsData, patientTypesData] = await Promise.all([
      emptyOnHttpError(fetchJSON<PatientData[]>('/api/patients/phones', { signal, schema: patientPhones.response })),
      emptyOnHttpError(fetchJSON<Array<{ id: number; work_type: string }>>('/api/getworktypes', { signal, schema: workContract.getWorkTypes.response })),
      emptyOnHttpError(fetchJSON<Array<{ id: number; key_word: string }>>('/api/getworkkeywords', { signal, schema: workContract.getWorkKeywords.response })),
      emptyOnHttpError(fetchJSON<Array<{ id: number; tag: string }>>('/api/patients/tag-options', { signal, schema: tagOptions.response })),
      emptyOnHttpError(fetchJSON<Array<{ id: number; type: string }>>('/api/patients/type-options', { signal, schema: typeOptions.response })),
    ]);

    // Transform to react-select format
    const workTypes: SelectOption[] = workTypesData.map((wt) => ({
      value: wt.id,
      label: wt.work_type,
    }));

    const keywords: SelectOption[] = keywordsData.map((kw) => ({
      value: kw.id,
      label: kw.key_word,
    }));

    const tags: SelectOption[] = tagsData.map((tag) => ({
      value: tag.id,
      label: tag.tag,
    }));

    const patientTypes: SelectOption[] = patientTypesData.map((pt) => ({
      value: pt.id,
      label: pt.type,
    }));

    // Check if we have search params and need to execute search
    const hasSearchParams =
      url.searchParams.has('patientName') ||
      url.searchParams.has('firstName') ||
      url.searchParams.has('lastName') ||
      url.searchParams.has('q') ||
      url.searchParams.has('workTypes') ||
      url.searchParams.has('keywords') ||
      url.searchParams.has('tags');

    let searchResults: PatientData[] | null = null;

    if (hasSearchParams) {
      if (import.meta.env.DEV) console.log('[Loader] Search params detected - fetching results');

      // Build search query from URL params
      const searchParams = new URLSearchParams();
      const paramsToCopy = [
        'patientName',
        'firstName',
        'lastName',
        'q',
        'workTypes',
        'keywords',
        'tags',
        'sortBy',
        'order',
      ];
      paramsToCopy.forEach((param) => {
        const value = url.searchParams.get(param);
        if (value) searchParams.set(param, value);
      });

      // Non-2xx → empty results (old behavior); a network/abort error rejects → outer catch.
      const data = await fetchJSON<{ patients?: PatientData[] } | PatientData[]>(
        `/api/patients/search?${searchParams.toString()}`,
        { signal, schema: patientSearch.response } // Validate the boundary (audit H11)
      ).catch((err: unknown) => {
        if (typeof (err as HttpError).status === 'number') return [] as PatientData[];
        throw err;
      });
      // Handle new paginated response format
      searchResults = Array.isArray(data) ? data : data.patients || [];
    }

    return {
      allPatients,
      workTypes,
      keywords,
      tags,
      patientTypes,
      searchResults, // Will be null if no search params, or array if search executed
      _loaderTimestamp: Date.now(),
    };
  } catch (error) {
    console.error('[Loader] Failed to load filter data:', error);
    // Return empty arrays on error
    return {
      allPatients: [],
      workTypes: [],
      keywords: [],
      tags: [],
      patientTypes: [],
      searchResults: null,
      error: error instanceof Error ? error.message : 'Unknown error',
      _loaderTimestamp: Date.now(),
    };
  }
}

/**
 * Appointment data
 */
export interface AppointmentData {
  appointment_id?: number;
  person_id?: number;
  patient_name?: string;
  app_date?: string | Date;
  app_detail?: string;
  apptime?: string | null;
  [key: string]: unknown;
}

/**
 * Daily appointments loader result
 */
export interface DailyAppointmentsLoaderResult {
  allAppointments: AppointmentData[];
  checkedInAppointments: AppointmentData[];
  stats: AppointmentStats;
  loadedDate: string;
  error?: string;
  _loaderTimestamp: number;
}

/**
 * DAILY APPOINTMENTS LOADER
 * Fetches initial data BEFORE component renders
 * Enables native scroll restoration via React Router
 */
export async function dailyAppointmentsLoader({
  request,
}: LoaderFunctionArgs): Promise<DailyAppointmentsLoaderResult> {
  // Helper to get today's date in YYYY-MM-DD format
  const getToday = (): string => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Read date from URL (source of truth)
  const url = new URL(request.url);
  const targetDate = url.searchParams.get('date') || getToday();

  if (import.meta.env.DEV) console.log(`[Loader] Pre-fetching appointments for: ${targetDate}`);

  try {
    const data = await fetchJSON<{
      allAppointments?: AppointmentData[];
      checkedInAppointments?: AppointmentData[];
      stats?: AppointmentStats;
    }>(`/api/getDailyAppointments?AppsDate=${targetDate}`, {
      signal: request.signal, // Abort on navigation
      schema: dailyAppointments.response, // Validate the boundary (audit H11)
    });

    return {
      allAppointments: data.allAppointments || [],
      checkedInAppointments: data.checkedInAppointments || [],
      stats: data.stats || { total: 0, checkedIn: 0, absent: 0, waiting: 0 },
      loadedDate: targetDate,
      _loaderTimestamp: Date.now(), // For debugging
    };
  } catch (error) {
    // Don't throw - return empty state (component will show error)
    console.error('[Loader] Failed:', error);
    return {
      allAppointments: [],
      checkedInAppointments: [],
      stats: { total: 0, checkedIn: 0, absent: 0, waiting: 0 },
      loadedDate: targetDate,
      error: httpErrorMessage(error, 'Unknown error'),
      _loaderTimestamp: Date.now(),
    };
  }
}
