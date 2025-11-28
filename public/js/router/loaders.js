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
 * Aligner doctor info loader
 * Loads specific doctor information
 *
 * @param {Object} params - Route parameters
 * @param {string} params.doctorId - Doctor ID
 * @param {Request} request - Request object with signal
 * @returns {Promise<Object>} Doctor data
 */
export async function alignerDoctorLoader({ params, request }) {
  const { doctorId } = params;
  const { signal } = request;

  // Special case: "all" doctors
  if (doctorId === 'all') {
    return {
      doctor: { DrID: 'all', DoctorName: 'All Doctors' },
      isAllDoctors: true
    };
  }

  const data = await apiLoader(`/api/aligner/doctor/${doctorId}`, {
    signal,
    cache: true,
    cacheKey: `aligner_doctor_${doctorId}`
  });

  return { doctor: data.doctor, isAllDoctors: false };
}

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

  // Also load patient info
  const patientData = await apiLoader(`/api/getinfos?code=${data.PatientID}`, {
    signal,
    cache: true,
    cacheKey: `patient_${data.PatientID}`
  });

  return {
    work: data,
    patient: patientData
  };
}

/**
 * Settings loader
 * Used by settings routes
 *
 * @param {Object} params - Route parameters
 * @param {string} params.tab - Current settings tab
 * @param {Request} request - Request object with signal
 * @returns {Promise<Object>} Settings data
 */
export async function settingsLoader({ params, request }) {
  const { tab } = params;
  const { signal } = request;

  const validTabs = ['general', 'database', 'alignerDoctors', 'messaging', 'system', 'security'];
  const currentTab = validTabs.includes(tab) ? tab : 'general';

  const data = await apiLoader(`/api/settings?tab=${currentTab}`, {
    signal,
    cache: false // Settings should NOT be cached
  });

  return {
    settings: data,
    currentTab,
    validTabs
  };
}

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
