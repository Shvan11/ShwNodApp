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

// ===========================================
// WEBCEPH SERVICE CLASS
// ===========================================

class WebCephService {
  private partnerApiKey: string;
  private userEmail: string;
  private userApiPassword: string;
  private baseUrl: string;
  private maxRetries: number;
  private retryDelay: number;

  constructor() {
    this.partnerApiKey = config.webceph.partnerApiKey || '';
    this.userEmail = config.webceph.userEmail || '';
    this.userApiPassword = config.webceph.userApiPassword || '';
    this.baseUrl = config.webceph.baseUrl;
    this.maxRetries = 3;
    this.retryDelay = 1000; // 1 second
  }

  /**
   * Make authenticated request to WebCeph API
   * @param endpoint - API endpoint (e.g., '/api/v1/addnewpatient/')
   * @param options - Fetch options
   * @returns API response
   */
  async makeRequest(
    endpoint: string,
    options: Omit<RequestInit, 'headers' | 'body'> & { headers?: Record<string, string>; body?: BodyInit } = {}
  ): Promise<WebCephApiResponse> {
    const url = `${this.baseUrl}${endpoint}`;

    // WebCeph requires these specific headers for authentication
    const additionalHeaders = options.headers && typeof options.headers === 'object' && !Array.isArray(options.headers)
      ? options.headers
      : {};
    const headers: Record<string, string> = {
      'X-Partner-ApiKey': this.partnerApiKey,
      'X-User-ApiUsername': this.userEmail,
      'X-User-ApiPass': this.userApiPassword,
      ...additionalHeaders,
    };

    log.debug('[WebCeph] Making request', { url });
    log.debug('[WebCeph] Headers status', {
      partnerApiKey: this.partnerApiKey ? 'SET' : 'MISSING',
      userApiUsername: this.userEmail ? 'SET' : 'MISSING',
      userApiPass: this.userApiPassword ? 'SET' : 'MISSING',
    });

    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response: Response = await fetch(url, {
          ...options,
          headers,
        });

        log.debug('[WebCeph] Response received', { status: response.status });

        // Get response text first
        const textResponse = await response.text();

        // Try to parse as JSON
        let data: WebCephApiResponse;
        try {
          data = JSON.parse(textResponse);
        } catch {
          log.error('[WebCeph] Failed to parse JSON response', { response: textResponse.substring(0, 200) });
          throw new Error(`Invalid JSON response from WebCeph API`);
        }

        // Check for API errors
        if (data.detail) {
          throw new Error(data.detail);
        }

        if (data.error) {
          throw new Error(data.message || data.error);
        }

        if (!response.ok && data.result !== 'success') {
          throw new Error(JSON.stringify(data));
        }

        return data;
      } catch (error) {
        lastError = error as Error;
        log.error('[WebCeph] API request failed', {
          attempt,
          maxRetries: this.maxRetries,
          error: lastError.message,
        });

        if (attempt < this.maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, this.retryDelay * attempt));
        }
      }
    }

    throw lastError;
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

      const response = await this.makeRequest('/api/v1/addnewpatient/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
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
      throw new Error(`Failed to create patient in WebCeph: ${(error as Error).message}`);
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

      const response = await this.makeRequest('/api/v1/addnewpatientrecord/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
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
      throw new Error(`Failed to create record in WebCeph: ${(error as Error).message}`);
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

      const formData = new FormData();
      formData.append('patientid', uploadData.patientID);
      formData.append('recordhash', uploadData.recordHash);
      formData.append('targetclass', uploadData.targetClass);
      formData.append('overwrite', uploadData.overwrite ? 'true' : 'false');

      // Append the image file
      formData.append('photo', uploadData.image, {
        filename: uploadData.filename || 'image.jpg',
        contentType: uploadData.contentType || 'image/jpeg',
      });

      const response = await this.makeRequest('/api/v1/uploadrecordphoto/', {
        method: 'POST',
        body: formData,
        headers: formData.getHeaders(),
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
      throw new Error(`Failed to upload image to WebCeph: ${(error as Error).message}`);
    }
  }

  /**
   * Get available photo/image types (target classes) for uploads
   * Based on WebCeph API documentation
   * @returns Photo types with class names and display names
   */
  getPhotoTypes(): PhotoType[] {
    return [
      { class: 'ceph_photo', name: 'Lateral Cephalogram' },
      { class: 'pa_photo', name: 'PA Cephalogram' },
      { class: 'pano_photo', name: 'Panoramic' },
      { class: 'eo_photo_lateral', name: 'Extra-Oral Lateral' },
      { class: 'eo_photo_frontal', name: 'Extra-Oral Frontal' },
      { class: 'eo_photo_oblique', name: 'Extra-Oral Oblique' },
      { class: 'eo_photo_smile', name: 'Extra-Oral Smile' },
      { class: 'io_photo_frontal', name: 'Intra-Oral Frontal' },
      { class: 'io_photo_left', name: 'Intra-Oral Left' },
      { class: 'io_photo_right', name: 'Intra-Oral Right' },
      { class: 'io_photo_upper', name: 'Intra-Oral Upper' },
      { class: 'io_photo_lower', name: 'Intra-Oral Lower' },
      { class: 'io_photo_extra1', name: 'Intra-Oral Extra 1' },
      { class: 'io_photo_extra2', name: 'Intra-Oral Extra 2' },
      { class: 'io_photo_extra3', name: 'Intra-Oral Extra 3' },
      { class: 'io_photo_extra4', name: 'Intra-Oral Extra 4' },
      { class: 'io_photo_extra5', name: 'Intra-Oral Extra 5' },
      { class: 'io_photo_extra6', name: 'Intra-Oral Extra 6' },
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

    if (!patientData.firstName && !patientData.lastName) {
      errors.push('At least first name or last name is required');
    }

    if (patientData.firstName && patientData.firstName.length > 50) {
      errors.push('First name must be 50 characters or less');
    }

    if (patientData.lastName && patientData.lastName.length > 50) {
      errors.push('Last name must be 50 characters or less');
    }

    const validGenders = ['male', 'female'];
    if (patientData.gender && !validGenders.includes(patientData.gender.toLowerCase())) {
      errors.push('Gender must be "male" or "female"');
    }

    const validRaces = ['african', 'asian', 'caucasian', 'hispanic'];
    if (patientData.race && !validRaces.includes(patientData.race.toLowerCase())) {
      errors.push('Race must be one of: african, asian, caucasian, hispanic');
    }

    if (patientData.birthday) {
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
