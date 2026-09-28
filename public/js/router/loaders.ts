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
import { queryClient } from '../query/client';
import { loaderQuery } from '../query/loaderQuery';
import { preloadPatientPage } from '../components/react/ContentRenderer';
import {
  patientInfoQuery,
  workDetailsQuery,
  timepointsQuery,
  patientPhonesQuery,
  workTypesQuery,
  workKeywordsQuery,
  tagOptionsQuery,
  typeOptionsQuery,
  alignerDoctorsQuery,
  templatesQuery,
  templateQuery,
  labCasesBoardQuery,
  labsQuery,
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

      // Auth-only verify path: 401 → session over. The redirect to /login.html
      // is index.html's fetch interceptor's job; this clears the cache and hands
      // the route boundary the status so it can render the Unauthorized card.
      if (httpErr.status === 401) {
        console.warn('[withAuth] 401 Unauthorized - session over, clearing cache');
        queryClient.clear(); // don't leave cached data for the next user
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
 * Patient shell loader — a pure prefetcher.
 *
 * Warms the page chunk and fills the React Query cache so PatientShell paints
 * from cache with no loading flash. It returns `null` on purpose: PatientShell
 * has no `useLoaderData` and never did — it reads `useParams` for routing and
 * the cache for data (3 `useQuery`s), which is the documented design ("thin
 * prefetchers into the React Query cache"). The old return value was a six-field
 * object built with three `as` casts out of parsed contract payloads — dead
 * weight, and three unchecked bridges past the fail-loud guard. `currentPage`
 * was the sharpest decoy: Navigation's `currentPage` prop comes from
 * PatientShell's own `effectivePage`, not from here. Shape now matches
 * `labTrackingLoader`.
 */
export async function patientShellLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<null> {
  const { personId, page, workId } = params;

  const url = new URL(request.url);
  const workIdFromQuery = url.searchParams.get('workId');
  const effectiveWorkId = workId || workIdFromQuery;

  // Warm the lazy chunk for the tab we're about to render, in parallel with the
  // data fetch below. ContentRenderer code-splits each patient sub-page, so
  // without this the page chunk would only begin downloading after PatientShell
  // mounts — a waterfall. Fire-and-forget (mirrors routes.config's withPreload).
  //
  // The diagnosis deep-link has no `:page` segment (its route is
  // ':personId/work/:workId/diagnosis'), so `params.page` is undefined there and
  // this used to no-op on the largest patient sub-page in the tree. Mirror the
  // derivation PatientShell already does for rendering.
  preloadPatientPage(url.pathname.endsWith('/diagnosis') ? 'diagnosis' : page);

  // Skip loading for "new" patient (add patient form)
  if (personId === 'new' || isNaN(parseInt(personId || '', 10))) {
    return null;
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

  // Wait for all promises in parallel — the results land in the RQ cache, which
  // is the whole point; nothing here is returned.
  await Promise.all([patientPromise, workPromise, timepointsPromise]);

  return null;
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
  if (!workId || isNaN(parseInt(workId, 10))) {
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
 * PATIENT MANAGEMENT LOADER — a pure prefetcher.
 *
 * Warms the five filter lookups in the shared React Query cache so the screen's
 * dropdowns paint filled on first render, and enables native scroll restoration
 * via React Router.
 *
 * It returns `null`: the component reads the same five keys with `useQuery`.
 * This used to issue five raw `fetchJSON` calls that duplicated
 * `patientPhonesQuery`/`workTypesQuery`/`workKeywordsQuery`/`tagOptionsQuery`/
 * `typeOptionsQuery` verbatim and returned the rows as loader data, so the
 * results never entered the cache — which is why `typeOptionsQuery` read as dead
 * code, and why a work type or patient tag edited through Settings → Lookups
 * could not reach these dropdowns until a full route re-navigation.
 *
 * `ensureQueryData` rather than `loaderQuery` on purpose: `loaderQuery` maps a
 * failure onto a `Response` for the route errorElement, and here each lookup is
 * individually tolerated (`emptyOnHttpError`) so one bad lookup does not blank
 * the other four or the screen.
 *
 * NOTE: the component still handles its own searching (sessionStorage restore +
 * `?search=` deep link) — that is the documented loader exception, and it is
 * about *search*, not about bypassing the cache for these lookups.
 */
export async function patientManagementLoader(): Promise<null> {
  if (import.meta.env.DEV) console.log('[Loader] Pre-fetching patient management filter data');

  try {
    await Promise.all([
      emptyOnHttpError(queryClient.ensureQueryData(patientPhonesQuery())),
      emptyOnHttpError(queryClient.ensureQueryData(workTypesQuery())),
      emptyOnHttpError(queryClient.ensureQueryData(workKeywordsQuery())),
      emptyOnHttpError(queryClient.ensureQueryData(tagOptionsQuery())),
      emptyOnHttpError(queryClient.ensureQueryData(typeOptionsQuery())),
    ]);
  } catch (error) {
    // Network/abort — the screen still renders; its useQuery reads will report
    // and retry on their own.
    console.error('[Loader] Failed to load filter data:', error);
  }

  return null;
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

/**
 * Lab tracking board loader — pre-fetches the unfiltered board + the labs
 * lookup (the board filter dropdown). A URL that already carries filters
 * re-fetches under the real key once the page mounts (RQ dedupes by key); this
 * just warms the common case of landing on the page with no filters.
 */
export async function labTrackingLoader(): Promise<null> {
  await Promise.all([loaderQuery(labCasesBoardQuery({})), loaderQuery(labsQuery())]);
  return null;
}
