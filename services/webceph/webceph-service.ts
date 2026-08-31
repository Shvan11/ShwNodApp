/**
 * WebCeph API Service
 * Handles communication with WebCeph AI-powered cephalometric analysis platform
 *
 * Official Documentation: https://webceph.com/en/api/partners
 * Host: https://api.webceph.com (HTTPS only)
 */

import config from '../../config/config.js';
import FormData from 'form-data';
import fetch, { type Response, type BodyInit } from 'node-fetch';
import { log } from '../../utils/logger.js';

// ===========================================
// TYPES
// ===========================================

/**
 * Patient creation data
 */
export interface PatientData {
  patientID?: string;
  firstName?: string;
  lastName?: string;
  gender?: string;
  birthday?: string;
  race?: string;
}

/**
 * Patient creation result
 */
export interface PatientResult {
  success: boolean;
  webcephPatientId?: string;
  linkId?: string;
  link?: string;
}

/**
 * Record creation result
 */
export interface RecordResult {
  success: boolean;
  recordHash?: string;
  linkId?: string;
  link?: string;
}

/**
 * Image upload data
 */
export interface UploadData {
  patientID: string;
  recordHash: string;
  targetClass: string;
  image: Buffer;
  filename?: string;
  contentType?: string;
  overwrite?: boolean;
}

/**
 * Image upload result
 */
export interface UploadResult {
  success: boolean;
  big?: string;
  thumbnail?: string;
  link?: string;
}

/**
 * Photo type definition
 */
export interface PhotoType {
  class: string;
  name: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * WebCeph API response
 */
interface WebCephApiResponse {
  result?: string;
  detail?: string;
  error?: string;
  message?: string;
  patientid?: string;
  linkid?: string;
  link?: string;
  recordhash?: string;
  big?: string;
  thumbnail?: string;
}

/** Cap on one WebCeph round trip — generous for an X-ray upload, tight for the JSON calls. */
const DEFAULT_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 60_000;

// ===========================================
// WEBCEPH SERVICE CLASS
// ===========================================

class WebCephService {
  private readonly maxRetries = 3;
  private readonly retryDelay = 1000; // 1 second, multiplied by the attempt number

  // Credentials are read from config at CALL time rather than snapshotted into fields by the
  // constructor. The singleton is built at import, so a snapshot could only ever be changed by a
  // restart — and the sibling Contacts integration already needed an explicit cache-reset hatch
  // (resetResolvedClient) after making exactly that assumption.
  private get partnerApiKey(): string {
    return config.webceph.partnerApiKey || '';
  }
  private get userEmail(): string {
    return config.webceph.userEmail || '';
  }
  private get userApiPassword(): string {
    return config.webceph.userApiPassword || '';
  }
  private get baseUrl(): string {
    return config.webceph.baseUrl;
  }

  /**
   * Build the `X-User-ApiPass` header value.
   *
   * WebCeph does NOT accept the plain API password. The header must be the
   * XOR-encrypted (Vernam cipher) result of the API password, keyed by
   * `userEmail + partnerApiKey`, then Base64-encoded. (Per WebCeph Partner API
   * support; matches their reference `simple_encrypt(plaintext, key)`.)
   */
  private encryptApiPass(): string {
    const data = Buffer.from(this.userApiPassword, 'utf-8');
    const key = Buffer.from(this.userEmail + this.partnerApiKey, 'utf-8');
    if (key.length === 0) {
      return '';
    }
    const out = Buffer.allocUnsafe(data.length);
    for (let i = 0; i < data.length; i++) {
      out[i] = data[i] ^ key[i % key.length];
    }
    return out.toString('base64');
  }

  /**
   * Make an authenticated request to the WebCeph API, retrying transient failures.
   *
   * `body` is a FACTORY, not a value. A request body may be a STREAM — `uploadImage` sends
   * multipart via form-data — and a stream can only be read once. Passing one value and re-sending
   * it across attempts meant attempt 2 shipped an already-drained stream: with a Content-Length
   * promising bytes that never came, the upload either hung until the server gave up or landed
   * truncated, and the caller was told it succeeded. Rebuilding per attempt is cheap here (the
   * image is already a Buffer in memory) and makes the retry actually recoverable.
   *
   * @param endpoint - API endpoint (e.g., '/api/v1/addnewpatient/')
   * @param options - method, headers, and a per-attempt body factory
   * @returns API response
   */
  async makeRequest(
    endpoint: string,
    options: {
      method?: string;
      headers?: Record<string, string> | (() => Record<string, string>);
      body?: () => BodyInit;
      timeoutMs?: number;
    } = {}
  ): Promise<WebCephApiResponse> {
    const url = `${this.baseUrl}${endpoint}`;

    // WebCeph requires these specific headers for authentication. Like the body, headers can be
    // per-attempt (form-data's boundary belongs to the FormData instance that attempt built).
    const buildHeaders = (): Record<string, string> => ({
      'X-Partner-ApiKey': this.partnerApiKey,
      'X-User-ApiUsername': this.userEmail,
      'X-User-ApiPass': this.encryptApiPass(),
      ...(typeof options.headers === 'function' ? options.headers() : (options.headers ?? {})),
    });

    log.debug('[WebCeph] Making request', { url });
    log.debug('[WebCeph] Headers status', {
      partnerApiKey: this.partnerApiKey ? 'SET' : 'MISSING',
      userApiUsername: this.userEmail ? 'SET' : 'MISSING',
      userApiPass: this.userApiPassword ? 'SET' : 'MISSING',
    });

    // Retry ONLY transient failures: network errors, HTTP 5xx, and unparseable
    // bodies (gateway HTML error pages). A parsed non-5xx API rejection is
    // deterministic — e.g. "Record dates already exist", "no matching photo
    // class" — so retrying it just burns the 30 req/min rate limit and adds
    // seconds of latency; those throw immediately. Multipart is safe to retry now that the body is
    // rebuilt per attempt (see the method doc).
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      let status: number | undefined;
      let textResponse: string | undefined;
      try {
        // Body BEFORE headers, and both fresh per attempt (see the method doc). The order is
        // load-bearing for multipart: form-data generates a random boundary per instance, and the
        // Content-Type header naming that boundary can only be read off the instance the body
        // factory just built. Building them the other way round ships one form's bytes under
        // another form's boundary, which the server reads as an empty upload.
        const attemptBody = options.body?.();
        const attemptHeaders = buildHeaders();
        const response: Response = await fetch(url, {
          method: options.method ?? 'GET',
          headers: attemptHeaders,
          body: attemptBody,
          // node-fetch v3 dropped `timeout`; without a signal three attempts can each hang for the
          // OS TCP timeout against a stalled api.webceph.com, pinning the Express request with
          // nothing logged. An AbortError is treated as transient, so the retry is what recovers it.
          signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
        status = response.status;
        textResponse = await response.text();
        log.debug('[WebCeph] Response received', { status });
      } catch (error) {
        lastError = error as Error; // network failure — transient
      }

      if (textResponse !== undefined && status !== undefined) {
        let data: WebCephApiResponse | undefined;
        try {
          data = JSON.parse(textResponse);
        } catch {
          log.error('[WebCeph] Failed to parse JSON response', { status, response: textResponse.substring(0, 200) });
        }

        if (data !== undefined && status < 500) {
          // Structured, non-5xx response: definitive — success or fail-fast.
          if (data.detail) {
            throw new Error(data.detail);
          }
          if (data.error) {
            throw new Error(data.message || data.error);
          }
          // An explicit non-success `result` is a failure whatever the status. This test used to sit
          // under `status >= 400`, so a 200 carrying `{ result: 'fail' }` and nothing else was
          // returned as success — callers then read `undefined` off it and the real problem surfaced
          // much later as a missing WebCeph link.
          if (data.result !== undefined && data.result !== 'success') {
            throw new Error(data.message || JSON.stringify(data));
          }
          if (status >= 400) {
            throw new Error(JSON.stringify(data));
          }
          return data;
        }

        lastError = new Error(
          data === undefined
            ? 'Invalid JSON response from WebCeph API'
            : data.detail || data.error || data.message || `WebCeph API returned HTTP ${status}`
        );
      }

      log.error('[WebCeph] API request failed (transient)', {
        attempt,
        maxRetries: this.maxRetries,
        status,
        error: lastError?.message,
      });

      if (attempt < this.maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, this.retryDelay * attempt));
      }
    }

    // Every loop exit path assigns lastError, but the type says it may be undefined
    // and `throw undefined` would defeat every `(error as Error).message` handler
    // upstream — normalize so callers always catch a real Error.
    throw lastError ?? new Error('WebCeph API request failed with no response');
  }

  /**
   * Create a new patient in WebCeph
   * @param patientData - Patient information
   * @returns WebCeph patient data including link
   */
  async createPatient(patientData: PatientData): Promise<PatientResult> {
    try {
      log.info('[WebCeph] Creating patient', { patientId: patientData.patientID });

      // Prepare request body as FormData (POST body format)
      const formData = new URLSearchParams();
      formData.append('patientid', patientData.patientID || '');
      formData.append('firstname', patientData.firstName || '');
      formData.append('lastname', patientData.lastName || '');
      formData.append('gender', (patientData.gender || '').toLowerCase());
      formData.append('birthdate', patientData.birthday || '');
      formData.append('race', (patientData.race || 'asian').toLowerCase());
      formData.append('agreement', 'yes'); // Required by API

      log.debug('[WebCeph] Request body prepared');

      const encoded = formData.toString();
      const response = await this.makeRequest('/api/v1/addnewpatient/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: () => encoded, // a string is re-sendable as-is; the factory is for the stream case
      });

      log.info('[WebCeph] Patient created successfully', { patientId: response.patientid });

      return {
        success: true,
        webcephPatientId: response.patientid,
        linkId: response.linkid,
        link: response.link,
      };
    } catch (error) {
      log.error('[WebCeph] Error creating patient', { error: (error as Error).message });
      throw new Error(`Failed to create patient in WebCeph: ${(error as Error).message}`, { cause: error });
    }
  }

  /**
   * Add a new record to an existing patient
   * @param patientID - Patient ID
   * @param recordDate - Record date (YYYY-MM-DD)
   * @returns Record creation result
   */
  async addNewRecord(patientID: string, recordDate: string): Promise<RecordResult> {
    try {
      log.info('[WebCeph] Adding new record for patient', { patientId: patientID });

      const formData = new URLSearchParams();
      formData.append('patientid', patientID);
      formData.append('recorddate', recordDate);

      const encoded = formData.toString();
      const response = await this.makeRequest('/api/v1/addnewpatientrecord/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: () => encoded,
      });

      log.info('[WebCeph] Record created successfully');

      return {
        success: true,
        recordHash: response.recordhash,
        linkId: response.linkid,
        link: response.link,
      };
    } catch (error) {
      log.error('[WebCeph] Error creating record', { error: (error as Error).message });
      throw new Error(`Failed to create record in WebCeph: ${(error as Error).message}`, { cause: error });
    }
  }

  /**
   * Upload an X-ray image to a patient record
   * @param uploadData - Upload information
   * @returns Upload result with image URLs
   */
  async uploadImage(uploadData: UploadData): Promise<UploadResult> {
    try {
      log.info('[WebCeph] Uploading image for patient', { patientId: uploadData.patientID });

      // Built fresh per attempt: form-data is a STREAM, so a retry that re-sent one already
      // drained by attempt 1 would hang against its own Content-Length or upload a truncated
      // X-ray. The buffer is in memory, so rebuilding costs nothing. The boundary lives on the
      // instance, hence the matching per-attempt headers.
      let current: FormData | null = null;
      const buildForm = (): FormData => {
        const form = new FormData();
        form.append('patientid', uploadData.patientID);
        form.append('recordhash', uploadData.recordHash);
        form.append('targetclass', uploadData.targetClass);
        form.append('overwrite', uploadData.overwrite ? 'true' : 'false');
        // WebCeph's upload field name is "file" (NOT "photo", which it rejects with
        // "invalid upload").
        form.append('file', uploadData.image, {
          filename: uploadData.filename || 'image.jpg',
          contentType: uploadData.contentType || 'image/jpeg',
        });
        return form;
      };

      const response = await this.makeRequest('/api/v1/uploadrecordphoto/', {
        method: 'POST',
        body: () => {
          current = buildForm();
          return current as unknown as BodyInit;
        },
        // makeRequest calls `body` first, so `current` is this attempt's form and its headers
        // carry the matching boundary.
        headers: () => (current ?? buildForm()).getHeaders(),
        timeoutMs: UPLOAD_TIMEOUT_MS,
      });

      log.info('[WebCeph] Image uploaded successfully');

      return {
        success: true,
        big: response.big,
        thumbnail: response.thumbnail,
        link: response.link,
      };
    } catch (error) {
      log.error('[WebCeph] Error uploading image', { error: (error as Error).message });
      throw new Error(`Failed to upload image to WebCeph: ${(error as Error).message}`, { cause: error });
    }
  }

  /**
   * Get available photo/image types (target classes) for uploads
   * Based on WebCeph API documentation
   * @returns Photo types with class names and display names
   */
  getPhotoTypes(): PhotoType[] {
    // Class codes verified against the live WebCeph Partner API (an unknown code
    // is rejected with "no matching photo class"). The X-ray codes are
    // `lateral_ceph`/`pa_ceph`/`orthopan` — NOT the old
    // `ceph_photo`/`pa_photo`/`pano_photo`. Extra-intraoral slots are omitted
    // until their official class codes are confirmed (the guessed codes all 404'd).
    return [
      { class: 'lateral_ceph', name: 'Lateral Cephalogram' },
      { class: 'pa_ceph', name: 'PA Cephalogram' },
      { class: 'orthopan', name: 'Panoramic' },
      { class: 'eo_photo_frontal', name: 'Extra-Oral Frontal' },
      { class: 'eo_photo_lateral', name: 'Extra-Oral Lateral' },
      { class: 'eo_photo_oblique', name: 'Extra-Oral Oblique' },
      { class: 'eo_photo_smile', name: 'Extra-Oral Smile' },
      { class: 'io_photo_frontal', name: 'Intra-Oral Frontal' },
      { class: 'io_photo_right', name: 'Intra-Oral Right' },
      { class: 'io_photo_left', name: 'Intra-Oral Left' },
      { class: 'io_photo_upper', name: 'Intra-Oral Upper' },
      { class: 'io_photo_lower', name: 'Intra-Oral Lower' },
    ];
  }

  /**
   * Validate patient data before creation
   * @param patientData - Patient data to validate
   * @returns Validation result
   */
  validatePatientData(patientData: PatientData): ValidationResult {
    const errors: string[] = [];

    if (
      patientData.patientID &&
      (patientData.patientID.length < 6 || patientData.patientID.length > 20)
    ) {
      errors.push('Patient ID must be 6-20 characters or empty for auto-generation');
    }

    // WebCeph is Latin-script only — it needs the patient's English
    // first/last name (the Arabic patient_name is never sent).
    if (!patientData.firstName?.trim() && !patientData.lastName?.trim()) {
      errors.push('An English first or last name is required by WebCeph — set the patient\'s English name first');
    }

    if (patientData.firstName && patientData.firstName.length > 50) {
      errors.push('First name must be 50 characters or less');
    }

    if (patientData.lastName && patientData.lastName.length > 50) {
      errors.push('Last name must be 50 characters or less');
    }

    // WebCeph requires gender — an empty one is rejected server-side with the
    // same cryptic "invalid format" error, so enforce it here.
    const validGenders = ['male', 'female'];
    if (!patientData.gender) {
      errors.push('Gender is required by WebCeph — set the patient\'s gender first');
    } else if (!validGenders.includes(patientData.gender.toLowerCase())) {
      errors.push('Gender must be "male" or "female"');
    }

    const validRaces = ['african', 'asian', 'caucasian', 'hispanic'];
    if (patientData.race && !validRaces.includes(patientData.race.toLowerCase())) {
      errors.push('Race must be one of: african, asian, caucasian, hispanic');
    }

    // WebCeph requires a valid birthdate — an empty/missing one is rejected
    // server-side with a cryptic "invalid format" error, so enforce it here.
    if (!patientData.birthday) {
      errors.push('Date of birth is required by WebCeph — set the patient\'s date of birth first');
    } else {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(patientData.birthday)) {
        errors.push('Birthday must be in YYYY-MM-DD format');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate upload data
   * @param uploadData - Upload data to validate
   * @returns Validation result
   */
  validateUploadData(uploadData: UploadData): ValidationResult {
    const errors: string[] = [];

    if (!uploadData.patientID) {
      errors.push('Patient ID is required');
    }

    if (!uploadData.recordHash) {
      errors.push('Record hash/date is required');
    }

    if (!uploadData.targetClass) {
      errors.push('Target class (photo type) is required');
    }

    const validClasses = this.getPhotoTypes().map((t) => t.class);
    if (uploadData.targetClass && !validClasses.includes(uploadData.targetClass)) {
      errors.push('Invalid target class');
    }

    if (!uploadData.image) {
      errors.push('Image file is required');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

// Export singleton instance
export default new WebCephService();
