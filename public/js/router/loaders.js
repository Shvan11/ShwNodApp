/**
 * Loader utilities for Data Router
 *
 * These utilities handle:
 * - API fetching with error handling
 * - 401 redirect (preserving existing auth pattern)
 * - Response caching (for performance)
 * - Abort controller support (for navigation cancellation)
 */

/**
 * Higher-order loader that wraps any loader with authentication check
 * Redirects to /login.html on 401 responses
 *
 * @param {Function} loaderFn - The actual loader function (can be null for auth-only check)
 * @returns {Function} Wrapped loader with auth check
 */
export function withAuth(loaderFn = null) {
  return async (args) => {
    try {
      // If a loader function is provided, execute it
      // The apiLoader inside will handle 401 redirects automatically
      if (loaderFn) {
        return await loaderFn(args);
      }

      // Auth-only check: verify session with lightweight endpoint
      const response = await fetch('/api/auth/verify', {
        signal: args.request?.signal
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
 * @param {string} url - API endpoint URL
 * @param {Object} options - Configuration options
 * @param {AbortSignal} options.signal - Abort signal for request cancellation
 * @param {boolean} options.cache - Enable caching (default: false)
 * @param {string} options.cacheKey - Cache key for sessionStorage
 * @returns {Promise<any>} API response data
 */
export async function apiLoader(url, options = {}) {
  const { signal, cache = false, cacheKey = null } = options;

  // Check cache first (if enabled)
  if (cache && cacheKey) {
    const cached = sessionStorage.getItem(`loader_cache_${cacheKey}`);
    if (cached) {
      try {
        const { data, timestamp } = JSON.parse(cached);
        const age = Date.now() - timestamp;
        // Cache valid for 5 minutes
        if (age < 5 * 60 * 1000) {
          console.log(`[Loader] Cache hit for ${cacheKey}`);
          return data;
        }
      } catch (e) {
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
        status: response.status
      });
    }

    const data = await response.json();

    // Cache response if enabled
    if (cache && cacheKey) {
      sessionStorage.setItem(`loader_cache_${cacheKey}`, JSON.stringify({
        data,
        timestamp: Date.now()
      }));
    }

    return data;
  } catch (error) {
    // Re-throw abort errors (navigation cancelled)
    if (error.name === 'AbortError') {
      throw error;
    }

    // Re-throw Response errors (will be handled by errorElement)
    if (error instanceof Response) {
      throw error;
    }

    // Wrap other errors
    console.error('[Loader] Error:', error);
    throw new Response(error.message || 'Unknown error', { status: 500 });
  }
}

/**
 * Patient info loader
 * Used by patient portal routes
 *
 * @param {Object} params - Route parameters
 * @param {string} params.patientId - Patient ID from route
 * @param {Request} request - Request object with signal
 * @returns {Promise<Object>} Patient data or null
 */
export async function patientInfoLoader({ params, request }) {
  const { patientId } = params;
  const { signal } = request;

  // Skip loading for "new" patient (add patient form)
  if (patientId === 'new' || isNaN(parseInt(patientId))) {
    return { patient: null, isNew: true };
  }

  const data = await apiLoader(`/api/getinfos?code=${patientId}`, {
    signal,
    cache: true,
    cacheKey: `patient_${patientId}`
  });

  return { patient: data, isNew: false };
}

/**
 * Work details loader
 * Used by visits/diagnosis pages
 *
 * @param {Object} params - Route parameters
 * @param {string} params.workId - Work ID from route
 * @param {Request} request - Request object with signal and URL
 * @returns {Promise<Object>} Work data or null
 */
export async function workDetailsLoader({ params, request }) {
  const { workId } = params;
  const { signal } = request;
  const url = new URL(request.url);
  const workIdFromQuery = url.searchParams.get('workId');
  const effectiveWorkId = workId || workIdFromQuery;

  if (!effectiveWorkId) {
    return { work: null };
  }

  const data = await apiLoader(`/api/getworkdetails?workId=${effectiveWorkId}`, {
    signal,
    cache: true,
    cacheKey: `work_${effectiveWorkId}`
  });

  return { work: data };
}

/**
 * Patient shell loader (comprehensive)
 * Loads patient demographic data and work details (if applicable)
 * This runs BEFORE PatientShell renders, eliminating the loading flash
 *
 * @param {Object} params - Route parameters
 * @param {string} params.patientId - Patient ID
 * @param {string} params.page - Current page (works, photos, etc.)
 * @param {string} params.workId - Work ID (optional, from route)
 * @param {Request} request - Request object with signal and URL
 * @returns {Promise<Object>} Combined patient and work data
 */
export async function patientShellLoader({ params, request }) {
  const { patientId, page, workId } = params;
  const { signal } = request;
  const url = new URL(request.url);
  const workIdFromQuery = url.searchParams.get('workId');
  const effectiveWorkId = workId || workIdFromQuery;

  // Skip loading for "new" patient (add patient form)
  if (patientId === 'new' || isNaN(parseInt(patientId))) {
    return {
      patient: null,
      work: null,
      timepoints: [],
      isNew: true,
      currentPage: page || 'works',
      workId: effectiveWorkId
    };
  }

  // Load patient demographics
  const patientPromise = apiLoader(`/api/getinfos?code=${patientId}`, {
    signal,
    cache: true,
    cacheKey: `patient_${patientId}`
  });

  // Load work details if workId is present
  let workPromise = null;
  if (effectiveWorkId) {
    workPromise = apiLoader(`/api/getworkdetails?workId=${effectiveWorkId}`, {
      signal,
      cache: true,
      cacheKey: `work_${effectiveWorkId}`
    });
  }

  // Load time points for photos/comparison pages
  let timepointsPromise = null;
  if (page && (page.startsWith('photos') || page === 'compare' || page === 'xrays')) {
    timepointsPromise = apiLoader(`/api/gettimepoints?code=${patientId}`, {
      signal,
      cache: true,
      cacheKey: `timepoints_${patientId}`
    });
  }

  // Wait for all promises in parallel
  const [patient, work, timepoints] = await Promise.all([
    patientPromise,
    workPromise,
    timepointsPromise
  ]);

  return {
    patient,
    work,
    timepoints: timepoints || [],
    isNew: false,
    currentPage: page || 'works',
    workId: effectiveWorkId
  };
}

/**
 * Aligner doctors loader
 * Used by aligner management routes
 *
 * @param {Request} request - Request object with signal
 * @returns {Promise<Object>} Doctors list
 */
export async function alignerDoctorsLoader({ request }) {
  const { signal } = request;

  const data = await apiLoader('/api/aligner/doctors', {
    signal,
    cache: true,
    cacheKey: 'aligner_doctors'
  });

  return { doctors: data.doctors || [], success: data.success };
}

/**
 * Aligner doctor info loader - REMOVED
 * Not needed since PatientsList fetches doctor info independently
 */

/**
 * Aligner patient work loader
 * Loads patient and work details for aligner sets page
 *
 * @param {Object} params - Route parameters
 * @param {string} params.workId - Work ID
 * @param {Request} request - Request object with signal
 * @returns {Promise<Object>} Patient and work data
 */
export async function alignerPatientWorkLoader({ params, request }) {
  const { workId } = params;
  const { signal } = request;

  const data = await apiLoader(`/api/getworkdetails?workId=${workId}`, {
    signal,
    cache: true,
    cacheKey: `work_${workId}`
  });

  // Also load patient info (Note: getWorkDetails returns PersonID, not PatientID)
  const patientData = await apiLoader(`/api/getinfos?code=${data.PersonID}`, {
    signal,
    cache: true,
    cacheKey: `patient_${data.PersonID}`
  });

  return {
    work: data,
    patient: patientData
  };
}

/**
 * Settings loader - REMOVED
 * Not needed since SettingsComponent fetches user role independently
 * and each settings tab fetches its own data
 */

/**
 * Template list loader
 * Loads available templates for management page
 *
 * @param {Request} request - Request object with signal
 * @returns {Promise<Object>} Templates list
 */
export async function templateListLoader({ request }) {
  const { signal } = request;

  const data = await apiLoader('/api/templates', {
    signal,
    cache: true,
    cacheKey: 'template_list'
  });

  return { templates: data.templates || [] };
}

/**
 * Template designer loader (optional - for edit mode)
 * Loads template data for editing
 *
 * @param {Object} params - Route parameters
 * @param {string} params.templateId - Template ID (optional)
 * @param {Request} request - Request object with signal
 * @returns {Promise<Object>} Template data or null
 */
export async function templateDesignerLoader({ params, request }) {
  const { templateId } = params;
  const { signal } = request;

  // Creating new template
  if (!templateId) {
    return { template: null, mode: 'create' };
  }

  // Loading existing template
  const data = await apiLoader(`/api/templates/${templateId}`, {
    signal,
    cache: true,
    cacheKey: `template_${templateId}`
  });

  return { template: data, mode: 'edit' };
}

/**
 * Clear all loader caches
 * Useful after data mutations or logout
 */
export function clearLoaderCache() {
  const keys = Object.keys(sessionStorage);
  keys.forEach(key => {
    if (key.startsWith('loader_cache_')) {
      sessionStorage.removeItem(key);
    }
  });
  console.log('[Loader] Cache cleared');
}

/**
 * Clear specific loader cache by key
 *
 * @param {string} cacheKey - Cache key to clear
 */
export function clearLoaderCacheKey(cacheKey) {
  sessionStorage.removeItem(`loader_cache_${cacheKey}`);
  console.log(`[Loader] Cache cleared for ${cacheKey}`);
}

/**
 * PATIENT MANAGEMENT LOADER
 * Pre-fetches filter data (work types, keywords, tags, patient list)
 * Enables native scroll restoration via React Router
 *
 * @param {Request} request - Request object with signal
 * @returns {Promise<Object>} Filter data for dropdowns and advanced search
 */
export async function patientManagementLoader({ request }) {
  const { signal } = request;
  const url = new URL(request.url);

  console.log('🚀 [Loader] Pre-fetching patient management filter data');

  try {
    // Fetch all filter data in parallel
    const [allPatientsRes, workTypesRes, keywordsRes, tagsRes] = await Promise.all([
      fetch('/api/patientsPhones', { signal }),
      fetch('/api/getworktypes', { signal }),
      fetch('/api/getworkkeywords', { signal }),
      fetch('/api/tag-options', { signal })
    ]);

    // Parse responses
    const allPatients = allPatientsRes.ok ? await allPatientsRes.json() : [];
    const workTypesData = workTypesRes.ok ? await workTypesRes.json() : [];
    const keywordsData = keywordsRes.ok ? await keywordsRes.json() : [];
    const tagsData = tagsRes.ok ? await tagsRes.json() : [];

    // Transform to react-select format
    const workTypes = workTypesData.map(wt => ({
      value: wt.ID,
      label: wt.WorkType
    }));

    const keywords = keywordsData.map(kw => ({
      value: kw.ID,
      label: kw.KeyWord
    }));

    const tags = tagsData.map(tag => ({
      value: tag.id,
      label: tag.tag
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

    let searchResults = null;

    if (hasSearchParams) {
      console.log('🔍 [Loader] Search params detected - fetching results');

      // Build search query from URL params
      const searchParams = new URLSearchParams();
      if (url.searchParams.get('patientName')) searchParams.set('patientName', url.searchParams.get('patientName'));
      if (url.searchParams.get('firstName')) searchParams.set('firstName', url.searchParams.get('firstName'));
      if (url.searchParams.get('lastName')) searchParams.set('lastName', url.searchParams.get('lastName'));
      if (url.searchParams.get('q')) searchParams.set('q', url.searchParams.get('q'));
      if (url.searchParams.get('workTypes')) searchParams.set('workTypes', url.searchParams.get('workTypes'));
      if (url.searchParams.get('keywords')) searchParams.set('keywords', url.searchParams.get('keywords'));
      if (url.searchParams.get('tags')) searchParams.set('tags', url.searchParams.get('tags'));
      if (url.searchParams.get('sortBy')) searchParams.set('sortBy', url.searchParams.get('sortBy'));
      if (url.searchParams.get('order')) searchParams.set('order', url.searchParams.get('order'));

      const searchRes = await fetch(`/api/patients/search?${searchParams.toString()}`, { signal });
      searchResults = searchRes.ok ? await searchRes.json() : [];
    }

    return {
      allPatients,
      workTypes,
      keywords,
      tags,
      searchResults, // Will be null if no search params, or array if search executed
      _loaderTimestamp: Date.now()
    };
  } catch (error) {
    console.error('❌ [Loader] Failed to load filter data:', error);
    // Return empty arrays on error
    return {
      allPatients: [],
      workTypes: [],
      keywords: [],
      tags: [],
      searchResults: null,
      error: error.message
    };
  }
}

/**
 * DAILY APPOINTMENTS LOADER
 * Fetches initial data BEFORE component renders
 * Enables native scroll restoration via React Router
 *
 * @param {Object} params - Route parameters (unused)
 * @param {Request} request - Request object with URL
 * @returns {Promise<Object>} Appointments data + metadata
 */
export async function dailyAppointmentsLoader({ request }) {
  // Helper to get today's date in YYYY-MM-DD format
  const getToday = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Read date from URL (source of truth)
  const url = new URL(request.url);
  const targetDate = url.searchParams.get('date') || getToday();

  console.log(`🚀 [Loader] Pre-fetching appointments for: ${targetDate}`);

  try {
    const response = await fetch(`/api/getDailyAppointments?AppsDate=${targetDate}`, {
      signal: request.signal // Abort on navigation
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
      _loaderTimestamp: Date.now() // For debugging
    };
  } catch (error) {
    // Don't throw - return empty state (component will show error)
    console.error('❌ [Loader] Failed:', error);
    return {
      allAppointments: [],
      checkedInAppointments: [],
      stats: { total: 0, checkedIn: 0, absent: 0, waiting: 0 },
      loadedDate: targetDate,
      error: error.message
    };
  }
}
