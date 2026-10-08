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
import type { FetchQueryOptions, QueryKey } from '@tanstack/react-query';
import { fetchJSON, type HttpError } from '@/core/http';
import { toLocalDateString } from '@/utils/calendarDate';
import { queryClient } from '../query/client';
import { loaderQuery } from '../query/loaderQuery';
import type { WorkDetails } from '@shared/contracts/work.contract';
import type { PatientInfo } from '@shared/contracts/patient.contract';
import { preloadPatientPage } from '../components/react/ContentRenderer';
import {
  patientInfoQuery,
  workDetailsQuery,
  timepointsQuery,
  workTypesQuery,
  dailyAppointmentsQuery,
  workKeywordsQuery,
  tagOptionsQuery,
  patientTypesQuery,
  alignerDoctorsQuery,
  templatesQuery,
  templateQuery,
  labCasesBoardQuery,
  labsQuery,
  patientsFolderQuery,
  worksQuery,
  hasAppointmentQuery,
  galleryQuery,
  photoVisibilityQuery,
  workingFilesQuery,
  patientAlertsQuery,
  alertTypesQuery,
  costPresetsQuery,
  patientAppointmentsQuery,
  visitsByWorkQuery,
  gendersQuery,
  addressesQuery,
  referralSourcesQuery,
  workDoctorsQuery,
  slideshowConfigsQuery,
  wiresQuery,
  operatorsQuery,
  latestWiresQuery,
  alignerSetsQuery,
  alignerFeaturesQuery,
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
 * Start a read without waiting for it. The request goes out beside the loader's
 * awaited reads and the chunk download, and the screen's `useQuery` (same
 * `queryOptions` factory, so the same key) picks it up in flight or finished.
 * Not awaited on purpose: a slow list must not hold the navigation on the old
 * screen. `prefetchQuery` never rejects and skips a read that is still fresh.
 */
function warm<TQueryFnData, TError, TData, TQueryKey extends QueryKey>(
  options: FetchQueryOptions<TQueryFnData, TError, TData, TQueryKey>
): void {
  void queryClient.prefetchQuery(options);
}

/**
 * The reads each patient page makes the moment it mounts, started from the
 * loader so they run beside the patient header and the page chunk, not after
 * them. Before, a page asked for its own list only once it had mounted: Works
 * was four sequential steps (header → sidebar → works list → work details)
 * where it can be two (audit FE-F26-4).
 *
 * Each entry must call the SAME factory with the SAME arguments as the page.
 * A mismatch is never wrong data, only a second request, and
 * `scripts/e2e/nav-waterfall.mjs` reports any URL a navigation fetches twice.
 * Left out on purpose: reads keyed on device or screen state (the Files
 * listing's flat mode, the booking form's month, Compare's chosen sessions),
 * role-gated reads (the portal card), and the two reads that always refetch on
 * mount (`diagnosisQuery`, the edit form's `patientByIdQuery`).
 */
const PAGE_READS: Record<string, (personId: string, at: { workId: string | null; tp: string }) => void> = {
  works: (id) => {
    warm(worksQuery(id));
    warm(hasAppointmentQuery(id));
    warm(galleryQuery(id, 0));
  },
  photos: (id, { tp }) => {
    warm(galleryQuery(id, tp));
    warm(photoVisibilityQuery(id));
    warm(workingFilesQuery(id));
  },
  'working-files': (id) => warm(workingFilesQuery(id)),
  'patient-info': (id) => {
    warm(patientAlertsQuery(id));
    warm(alertTypesQuery());
    warm(costPresetsQuery());
  },
  // Lookups only: the form reads the patient itself with `refetchOnMount: 'always'`
  // (it must open on the stored row, FE-F6-8), so a prefetch of it is fetched twice.
  'edit-patient': () => {
    warm(gendersQuery());
    warm(addressesQuery());
    warm(referralSourcesQuery());
    warm(patientTypesQuery());
    warm(tagOptionsQuery());
  },
  appointments: (id) => warm(patientAppointmentsQuery(id)),
  visits: (_id, { workId }) => {
    if (workId) warm(visitsByWorkQuery(workId));
  },
  'new-visit': (_id, { workId }) => {
    warm(wiresQuery());
    warm(operatorsQuery());
    if (workId) warm(latestWiresQuery(workId));
  },
  'new-work': () => {
    warm(workTypesQuery());
    warm(workKeywordsQuery());
    warm(workDoctorsQuery());
  },
  diagnosis: (id) => warm(worksQuery(id)),
  slideshow: (id) => warm(slideshowConfigsQuery(id)),
};

/** The Add Patient form's lookups (`/patient/new/add` has no patient to read). */
function warmAddPatientForm(): void {
  warm(referralSourcesQuery());
  warm(addressesQuery());
  warm(gendersQuery());
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

  // The diagnosis deep-link has no `:page` segment (its route is
  // ':personId/work/:workId/diagnosis'), so `params.page` is undefined there.
  // Mirror the derivation PatientShell does for rendering.
  const effectivePage = url.pathname.endsWith('/diagnosis') ? 'diagnosis' : page;

  // The page's own chunk (ContentRenderer code-splits each patient sub-page),
  // downloaded beside the data below and awaited with it, so the page mounts
  // loaded. Started here and merely not awaited, it used to lose the race by one
  // tick, show the content spinner, and pay React's 300 ms fallback throttle.
  const pageChunk = preloadPatientPage(effectivePage);

  // Skip loading for "new" patient (add patient form)
  if (personId === 'new' || isNaN(parseInt(personId || '', 10))) {
    if (effectivePage === 'add') warmAddPatientForm();
    warm(patientsFolderQuery());
    await pageChunk;
    return null;
  }

  // Load patient demographics
  const patientPromise = loaderQuery(patientInfoQuery(personId!));

  // Load work details if workId is present
  const workPromise = effectiveWorkId
    ? loaderQuery(workDetailsQuery(effectiveWorkId))
    : Promise.resolve(null);

  // Photo sessions: awaited on the pages built from them; on every other page
  // only the sidebar reads them (its photo-session links), so there they are
  // started and not waited for.
  const needsTimepoints =
    !!page && (page.startsWith('photos') || page === 'compare' || page === 'xrays');
  const timepointsPromise = needsTimepoints
    ? loaderQuery(timepointsQuery(personId!))
    : Promise.resolve(null);
  if (!needsTimepoints) warm(timepointsQuery(personId!));
  warm(patientsFolderQuery()); // the sidebar's "open folder" link

  // The page's own reads (see PAGE_READS).
  const tp = (params['*'] || '').match(/^tp(\d+)$/)?.[1] ?? '0';
  if (effectivePage) PAGE_READS[effectivePage]?.(personId!, { workId: effectiveWorkId ?? null, tp });

  // Wait for the header data and the chunk together — the results land in the
  // RQ cache, which is the whole point; nothing here is returned.
  await Promise.all([patientPromise, workPromise, timepointsPromise, pageChunk]);

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
  work: WorkDetails;
  patient: PatientInfo;
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

  // What PatientSets reads on mount, started beside the work read. They used to
  // go out only after work → patient → mount, two round trips later (FE-F26-4).
  warm(alignerSetsQuery(workId));
  warm(alignerDoctorsQuery());
  warm(alignerFeaturesQuery());

  const work = await loaderQuery(workDetailsQuery(workId));

  // Validate person_id before fetching patient data
  if (!work?.person_id) {
    throw new Response('Work record has no associated patient', { status: 404 });
  }

  // Also load patient info
  const patient = await loaderQuery(patientInfoQuery(work.person_id));

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
 * Warms the four filter lookups in the shared React Query cache so the screen's
 * dropdowns paint filled on first render, and enables native scroll restoration
 * via React Router.
 *
 * It returns `null`: the component reads the same four keys with `useQuery`.
 * This used to issue raw `fetchJSON` calls that duplicated
 * the lookup factories verbatim and returned the rows as loader data, so the
 * results never entered the cache — and a work type or patient tag edited
 * through Settings → Lookups could not reach these dropdowns until a full route
 * re-navigation. (The patient-type filter reads `patientTypesQuery`, the same
 * `/api/patient-types` feed as the edit form; its own `/api/patients/type-options`
 * twin was retired in FE-F6-14.)
 *
 * There was a fifth: the whole patient list, for the two search boxes' jump
 * lists (419 kB at 6,859 patients, on every visit to this screen). The boxes now
 * ask the server as the user types (`usePatientLookup`), so nothing about
 * patients is fetched until something is typed.
 *
 * `ensureQueryData` rather than `loaderQuery` on purpose: `loaderQuery` maps a
 * failure onto a `Response` for the route errorElement, and here each lookup is
 * individually tolerated (`emptyOnHttpError`) so one bad lookup does not blank
 * the other three or the screen.
 *
 * NOTE: the component still handles its own searching (sessionStorage restore +
 * `?search=` deep link) — that is the documented loader exception, and it is
 * about *search*, not about bypassing the cache for these lookups.
 */
export async function patientManagementLoader(): Promise<null> {
  if (import.meta.env.DEV) console.log('[Loader] Pre-fetching patient management filter data');

  try {
    await Promise.all([
      emptyOnHttpError(queryClient.ensureQueryData(workTypesQuery())),
      emptyOnHttpError(queryClient.ensureQueryData(workKeywordsQuery())),
      emptyOnHttpError(queryClient.ensureQueryData(tagOptionsQuery())),
      emptyOnHttpError(queryClient.ensureQueryData(patientTypesQuery())),
    ]);
  } catch (error) {
    // Network/abort — the screen still renders; its useQuery reads will report
    // and retry on their own.
    console.error('[Loader] Failed to load filter data:', error);
  }

  return null;
}

/**
 * Daily appointments loader result — only the date it loaded. The rows go into
 * the React Query cache under `qk.appointments.daily(date)`, where the page's
 * `useAppointments` reads them.
 */
export interface DailyAppointmentsLoaderResult {
  loadedDate: string;
}

/**
 * DAILY APPOINTMENTS LOADER
 * Fetches the day BEFORE the page renders (no loading flash; native scroll
 * restoration) and writes it straight into the query cache.
 *
 * It used to return the rows as `initialData`, which React Query ignores
 * whenever the key is already cached — so on a return to the board within 30 s
 * the fresh fetch was thrown away and the stale cache painted, e.g. without the
 * walk-in just checked in from the patient screens (audit FE-F11-17). `fetchQuery`
 * with `staleTime: 0` always fetches and always lands in the cache.
 *
 * A failed read is not thrown: the page renders its header and a retry, and the
 * query reports the error itself.
 */
export async function dailyAppointmentsLoader({
  request,
}: LoaderFunctionArgs): Promise<DailyAppointmentsLoaderResult> {
  const url = new URL(request.url);
  const loadedDate = url.searchParams.get('date') || toLocalDateString(new Date());

  try {
    await queryClient.fetchQuery({ ...dailyAppointmentsQuery(loadedDate), staleTime: 0 });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    console.error('[Loader] Daily appointments failed:', error);
  }
  return { loadedDate };
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
