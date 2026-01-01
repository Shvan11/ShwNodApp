/**
 * Loader utilities for Data Router
 *
 * These utilities handle:
 * - API fetching with error handling
 * - 401 redirect (preserving existing auth pattern)
 * - Response caching (for performance)
 * - Abort controller support (for navigation cancellation)
 */

import type { LoaderFunctionArgs } from 'react-router-dom';

/**
 * Cached data structure
 */
interface CachedData<T> {
  data: T;
  timestamp: number;
}

/**
 * API loader options
 */
interface ApiLoaderOptions {
  signal?: AbortSignal;
  cache?: boolean;
  cacheKey?: string | null;
}

/**
 * Patient data structure
 */
export interface PatientData {
  code?: number;
  id?: number;
  PatientName?: string;
  FirstName?: string;
  LastName?: string;
  Phone?: string;
  [key: string]: unknown;
}

/**
 * Work data structure
 */
export interface WorkData {
  WorkID?: number;
  PersonID?: number;
  WorkType?: string;
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
      // The apiLoader inside will handle 401 redirects automatically
      if (loaderFn) {
        return await loaderFn(args);
      }

      // Auth-only check: verify session with lightweight endpoint
      const response = await fetch('/api/auth/verify', {
        signal: args.request?.signal,
      });

      if (response.status === 401) {
        console.warn('[withAuth] 401 Unauthorized - redirecting to login');
        window.location.href = '/login.html';
        throw new Response('Unauthorized', { status: 401 });
      }

      return null; // No data to return for auth-only loaders
    } catch (error) {
      // Re-throw for route error boundary to handle
      if (error instanceof Response) {
        throw error;
      }
      throw error;
    }
  };
}

/**
 * Base API loader with error handling and 401 redirect
 * Preserves the existing auth interceptor pattern
 *
 * @param url - API endpoint URL
 * @param options - Configuration options
 * @returns API response data
 */
export async function apiLoader<T = unknown>(
  url: string,
  options: ApiLoaderOptions = {}
): Promise<T> {
  const { signal, cache = false, cacheKey = null } = options;

  // Check cache first (if enabled)
  if (cache && cacheKey) {
    const cached = sessionStorage.getItem(`loader_cache_${cacheKey}`);
    if (cached) {
      try {
        const { data, timestamp } = JSON.parse(cached) as CachedData<T>;
        const age = Date.now() - timestamp;
        // Cache valid for 5 minutes
        if (age < 5 * 60 * 1000) {
          console.log(`[Loader] Cache hit for ${cacheKey}`);
          return data;
        }
      } catch {
        // Invalid cache, continue to fetch
        sessionStorage.removeItem(`loader_cache_${cacheKey}`);
      }
    }
  }

  try {
    const response = await fetch(url, { signal });

    // Handle 401 Unauthorized (preserve existing auth pattern)
    // Note: Global fetch interceptor in index.html also handles this
    if (response.status === 401) {
      console.warn('[Loader] 401 Unauthorized - redirecting to login');
      window.location.href = '/login.html';
      throw new Response('Unauthorized', { status: 401 });
    }

    if (!response.ok) {
      throw new Response(`API Error: ${response.statusText}`, {
        status: response.status,
      });
    }

    const data = (await response.json()) as T;

    // Cache response if enabled
    if (cache && cacheKey) {
      sessionStorage.setItem(
        `loader_cache_${cacheKey}`,
        JSON.stringify({
          data,
          timestamp: Date.now(),
        })
      );
    }

    return data;
  } catch (error) {
    // Re-throw abort errors (navigation cancelled)
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }

    // Re-throw Response errors (will be handled by errorElement)
    if (error instanceof Response) {
      throw error;
    }

    // Wrap other errors
    console.error('[Loader] Error:', error);
    throw new Response(error instanceof Error ? error.message : 'Unknown error', { status: 500 });
  }
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
  request,
}: LoaderFunctionArgs): Promise<PatientInfoLoaderResult> {
  const { patientId } = params;
  const { signal } = request;

  // Skip loading for "new" patient (add patient form)
  if (patientId === 'new' || isNaN(parseInt(patientId || ''))) {
    return { patient: null, isNew: true };
  }

  const data = await apiLoader<PatientData>(`/api/patients/${patientId}/info`, {
    signal,
    cache: true,
    cacheKey: `patient_${patientId}`,
  });

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
  const { signal } = request;
  const url = new URL(request.url);
  const workIdFromQuery = url.searchParams.get('workId');
  const effectiveWorkId = workId || workIdFromQuery;

  if (!effectiveWorkId) {
    return { work: null };
  }

  const data = await apiLoader<WorkData>(`/api/getworkdetails?workId=${effectiveWorkId}`, {
    signal,
    cache: true,
    cacheKey: `work_${effectiveWorkId}`,
  });

  return { work: data };
}

/**
 * Timepoint data
 */
export interface TimepointData {
  ID?: number;
  TimePoint?: string;
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
  const { patientId, page, workId } = params;
  const { signal } = request;
  const url = new URL(request.url);
  const workIdFromQuery = url.searchParams.get('workId');
  const effectiveWorkId = workId || workIdFromQuery;

  // Skip loading for "new" patient (add patient form)
  if (patientId === 'new' || isNaN(parseInt(patientId || ''))) {
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
  const patientPromise = apiLoader<PatientData>(`/api/patients/${patientId}/info`, {
    signal,
    cache: true,
    cacheKey: `patient_${patientId}`,
  });

  // Load work details if workId is present
  let workPromise: Promise<WorkData | null> | null = null;
  if (effectiveWorkId) {
    workPromise = apiLoader<WorkData>(`/api/getworkdetails?workId=${effectiveWorkId}`, {
      signal,
      cache: true,
      cacheKey: `work_${effectiveWorkId}`,
    });
  }

  // Load time points for photos/comparison pages
  let timepointsPromise: Promise<TimepointData[] | null> | null = null;
  if (page && (page.startsWith('photos') || page === 'compare' || page === 'xrays')) {
    timepointsPromise = apiLoader<TimepointData[]>(`/api/patients/${patientId}/timepoints`, {
      signal,
      cache: true,
      cacheKey: `timepoints_${patientId}`,
    });
  }

  // Wait for all promises in parallel
  const [patient, work, timepoints] = await Promise.all([
    patientPromise,
    workPromise,
    timepointsPromise,
  ]);

  return {
    patient,
    work,
    timepoints: timepoints || [],
    isNew: false,
    currentPage: page || 'works',
    workId: effectiveWorkId,
  };
}

/**
 * Doctor data
 */
export interface DoctorData {
  DoctorID?: number;
  DoctorName?: string;
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
export async function alignerDoctorsLoader({
  request,
}: LoaderFunctionArgs): Promise<AlignerDoctorsLoaderResult> {
  const { signal } = request;

  const data = await apiLoader<{ doctors?: DoctorData[]; success?: boolean }>(
    '/api/aligner/doctors',
    {
      signal,
      cache: true,
      cacheKey: 'aligner_doctors',
    }
  );

  return { doctors: data.doctors || [], success: data.success ?? true };
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
  request,
}: LoaderFunctionArgs): Promise<AlignerPatientWorkLoaderResult> {
  const { workId } = params;
  const { signal } = request;

  const data = await apiLoader<WorkData>(`/api/getworkdetails?workId=${workId}`, {
    signal,
    cache: true,
    cacheKey: `work_${workId}`,
  });

  // Also load patient info (Note: getWorkDetails returns PersonID, not PatientID)
  const patientData = await apiLoader<PatientData>(`/api/patients/${data.PersonID}/info`, {
    signal,
    cache: true,
    cacheKey: `patient_${data.PersonID}`,
  });

  return {
    work: data,
    patient: patientData,
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
export async function templateListLoader({
  request,
}: LoaderFunctionArgs): Promise<TemplateListLoaderResult> {
  const { signal } = request;

  const data = await apiLoader<{ templates?: TemplateData[] }>('/api/templates', {
    signal,
    cache: true,
    cacheKey: 'template_list',
  });

  return { templates: data.templates || [] };
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
  request,
}: LoaderFunctionArgs): Promise<TemplateDesignerLoaderResult> {
  const { templateId } = params;
  const { signal } = request;

  // Creating new template
  if (!templateId) {
    return { template: null, mode: 'create' };
  }

  // Loading existing template
  const data = await apiLoader<TemplateData>(`/api/templates/${templateId}`, {
    signal,
    cache: true,
    cacheKey: `template_${templateId}`,
  });

  return { template: data, mode: 'edit' };
}

/**
 * Clear all loader caches
 * Useful after data mutations or logout
 */
export function clearLoaderCache(): void {
  const keys = Object.keys(sessionStorage);
  keys.forEach((key) => {
    if (key.startsWith('loader_cache_')) {
      sessionStorage.removeItem(key);
    }
  });
  console.log('[Loader] Cache cleared');
}

/**
 * Clear specific loader cache by key
 *
 * @param cacheKey - Cache key to clear
 */
export function clearLoaderCacheKey(cacheKey: string): void {
  sessionStorage.removeItem(`loader_cache_${cacheKey}`);
  console.log(`[Loader] Cache cleared for ${cacheKey}`);
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

  console.log('[Loader] Pre-fetching patient management filter data');

  try {
    // Fetch all filter data in parallel
    const [allPatientsRes, workTypesRes, keywordsRes, tagsRes] = await Promise.all([
      fetch('/api/patients/phones', { signal }),
      fetch('/api/getworktypes', { signal }),
      fetch('/api/getworkkeywords', { signal }),
      fetch('/api/patients/tag-options', { signal }),
    ]);

    // Parse responses
    const allPatients: PatientData[] = allPatientsRes.ok ? await allPatientsRes.json() : [];
    const workTypesData: Array<{ ID: number; WorkType: string }> = workTypesRes.ok
      ? await workTypesRes.json()
      : [];
    const keywordsData: Array<{ ID: number; KeyWord: string }> = keywordsRes.ok
      ? await keywordsRes.json()
      : [];
    const tagsData: Array<{ id: number; tag: string }> = tagsRes.ok ? await tagsRes.json() : [];

    // Transform to react-select format
    const workTypes: SelectOption[] = workTypesData.map((wt) => ({
      value: wt.ID,
      label: wt.WorkType,
    }));

    const keywords: SelectOption[] = keywordsData.map((kw) => ({
      value: kw.ID,
      label: kw.KeyWord,
    }));

    const tags: SelectOption[] = tagsData.map((tag) => ({
      value: tag.id,
      label: tag.tag,
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
      console.log('[Loader] Search params detected - fetching results');

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

      const searchRes = await fetch(`/api/patients/search?${searchParams.toString()}`, { signal });
      searchResults = searchRes.ok ? await searchRes.json() : [];
    }

    return {
      allPatients,
      workTypes,
      keywords,
      tags,
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
  AppointmentID?: number;
  PatientID?: number;
  PatientName?: string;
  AppsDate?: string;
  AppsTime?: string;
  State?: string;
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

  console.log(`[Loader] Pre-fetching appointments for: ${targetDate}`);

  try {
    const response = await fetch(`/api/getDailyAppointments?AppsDate=${targetDate}`, {
      signal: request.signal, // Abort on navigation
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

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
      error: error instanceof Error ? error.message : 'Unknown error',
      _loaderTimestamp: Date.now(),
    };
  }
}
