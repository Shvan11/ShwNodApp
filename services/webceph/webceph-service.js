/**
 * WebCeph API Service
 * Handles communication with WebCeph AI-powered cephalometric analysis platform
 *
 * Official Documentation: https://webceph.com/en/api/partners
 * Host: https://api.webceph.com (HTTPS only)
 */

import config from '../../config/config.js';
import FormData from 'form-data';
import fetch from 'node-fetch';
import fs from 'fs';

class WebCephService {
    constructor() {
        this.partnerApiKey = config.webceph.partnerApiKey;
        this.userEmail = config.webceph.userEmail;
        this.userApiPassword = config.webceph.userApiPassword;
        this.baseUrl = config.webceph.baseUrl;
        this.maxRetries = 3;
        this.retryDelay = 1000; // 1 second
    }

    /**
     * Make authenticated request to WebCeph API
     * @param {string} endpoint - API endpoint (e.g., '/api/v1/addnewpatient/')
     * @param {object} options - Fetch options
     * @returns {Promise<object>} API response
     */
    async makeRequest(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;

        // WebCeph requires these specific headers for authentication
        const headers = {
            'X-Partner-ApiKey': this.partnerApiKey,
            'X-User-ApiUsername': this.userEmail,
            'X-User-ApiPass': this.userApiPassword,
            // Note: Authorization header might be needed but we don't have a token yet
            // Will add if needed after checking WebCeph account page
            ...options.headers
        };

        console.log(`[WebCeph] Making request to: ${url}`);
        console.log(`[WebCeph] Headers:`, {
            'X-Partner-ApiKey': this.partnerApiKey ? 'SET' : 'MISSING',
            'X-User-ApiUsername': this.userEmail ? 'SET' : 'MISSING',
            'X-User-ApiPass': this.userApiPassword ? 'SET' : 'MISSING'
        });
        console.log(`[WebCeph] Full headers being sent:`, headers);

        let lastError;
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const response = await fetch(url, {
                    ...options,
                    headers
                });

                console.log(`[WebCeph] Response status: ${response.status}`);

                // Get response text first
                const textResponse = await response.text();

                // Try to parse as JSON
                let data;
                try {
                    data = JSON.parse(textResponse);
                } catch (parseError) {
                    console.error(`[WebCeph] Failed to parse JSON response:`, textResponse.substring(0, 200));
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
                lastError = error;
                console.error(`[WebCeph] API request failed (attempt ${attempt}/${this.maxRetries}):`, error.message);

                if (attempt < this.maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
                }
            }
        }

        throw lastError;
    }

    /**
     * Create a new patient in WebCeph
     * @param {object} patientData - Patient information
     * @param {string} patientData.patientID - Internal patient ID (6-20 chars, or empty for auto-generate)
     * @param {string} patientData.firstName - Patient's first name (max 50 chars)
     * @param {string} patientData.lastName - Patient's last name (max 50 chars)
     * @param {string} patientData.gender - Patient's gender (male/female - lowercase)
     * @param {string} patientData.birthday - Patient's birthday (YYYY-MM-DD)
     * @param {string} patientData.race - Patient's race (african/asian/caucasian/hispanic)
     * @returns {Promise<object>} WebCeph patient data including link
     */
    async createPatient(patientData) {
        try {
            console.log('[WebCeph] Creating patient:', patientData.patientID);

            // Prepare request body as FormData (POST body format)
            const formData = new URLSearchParams();
            formData.append('patientid', patientData.patientID || '');
            formData.append('firstname', patientData.firstName || '');
            formData.append('lastname', patientData.lastName || '');
            formData.append('gender', (patientData.gender || '').toLowerCase());
            formData.append('birthdate', patientData.birthday || '');
            formData.append('race', (patientData.race || 'asian').toLowerCase());
            formData.append('agreement', 'yes'); // Required by API

            console.log('[WebCeph] Request body:', formData.toString());

            const response = await this.makeRequest('/api/v1/addnewpatient/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: formData.toString()
            });

            console.log('[WebCeph] Patient created successfully:', response.patientid);

            return {
                success: true,
                webcephPatientId: response.patientid,
                linkId: response.linkid,
                link: response.link
            };
        } catch (error) {
            console.error('[WebCeph] Error creating patient:', error);
            throw new Error(`Failed to create patient in WebCeph: ${error.message}`);
        }
    }

    /**
     * Add a new record to an existing patient
     * @param {string} patientID - Patient ID
     * @param {string} recordDate - Record date (YYYY-MM-DD)
     * @returns {Promise<object>} Record creation result
     */
    async addNewRecord(patientID, recordDate) {
        try {
            console.log('[WebCeph] Adding new record for patient:', patientID);

            const formData = new URLSearchParams();
            formData.append('patientid', patientID);
            formData.append('recorddate', recordDate);

            const response = await this.makeRequest('/api/v1/addnewpatientrecord/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: formData.toString()
            });

            console.log('[WebCeph] Record created successfully');

            return {
                success: true,
                recordHash: response.recordhash,
                linkId: response.linkid,
                link: response.link
            };
        } catch (error) {
            console.error('[WebCeph] Error creating record:', error);
            throw new Error(`Failed to create record in WebCeph: ${error.message}`);
        }
    }

    /**
     * Upload an X-ray image to a patient record
     * @param {object} uploadData - Upload information
     * @param {string} uploadData.patientID - Internal patient ID
     * @param {string} uploadData.recordHash - Record hash/date (YYYY-MM-DD)
     * @param {string} uploadData.targetClass - Photo class (see getPhotoTypes)
     * @param {Buffer} uploadData.image - Image buffer
     * @param {string} uploadData.filename - Original filename
     * @param {boolean} uploadData.overwrite - Whether to overwrite existing image
     * @returns {Promise<object>} Upload result with image URLs
     */
    async uploadImage(uploadData) {
        try {
            console.log('[WebCeph] Uploading image for patient:', uploadData.patientID);

            const formData = new FormData();
            formData.append('patientid', uploadData.patientID);
            formData.append('recordhash', uploadData.recordHash);
            formData.append('targetclass', uploadData.targetClass);
            formData.append('overwrite', uploadData.overwrite ? 'true' : 'false');

            // Append the image file
            formData.append('photo', uploadData.image, {
                filename: uploadData.filename || 'image.jpg',
                contentType: uploadData.contentType || 'image/jpeg'
            });

            const response = await this.makeRequest('/api/v1/uploadrecordphoto/', {
                method: 'POST',
                body: formData,
                headers: formData.getHeaders()
            });

            console.log('[WebCeph] Image uploaded successfully');

            return {
                success: true,
                big: response.big,
                thumbnail: response.thumbnail,
                link: response.link
            };
        } catch (error) {
            console.error('[WebCeph] Error uploading image:', error);
            throw new Error(`Failed to upload image to WebCeph: ${error.message}`);
        }
    }

    /**
     * Get available photo/image types (target classes) for uploads
     * Based on WebCeph API documentation
     * @returns {Array<object>} Photo types with class names and display names
     */
    getPhotoTypes() {
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
            { class: 'io_photo_extra6', name: 'Intra-Oral Extra 6' }
        ];
    }

    /**
     * Validate patient data before creation
     * @param {object} patientData - Patient data to validate
     * @returns {object} Validation result
     */
    validatePatientData(patientData) {
        const errors = [];

        if (patientData.patientID && (patientData.patientID.length < 6 || patientData.patientID.length > 20)) {
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
            errors
        };
    }

    /**
     * Validate upload data
     * @param {object} uploadData - Upload data to validate
     * @returns {object} Validation result
     */
    validateUploadData(uploadData) {
        const errors = [];

        if (!uploadData.patientID) {
            errors.push('Patient ID is required');
        }

        if (!uploadData.recordHash) {
            errors.push('Record hash/date is required');
        }

        if (!uploadData.targetClass) {
            errors.push('Target class (photo type) is required');
        }

        const validClasses = this.getPhotoTypes().map(t => t.class);
        if (uploadData.targetClass && !validClasses.includes(uploadData.targetClass)) {
            errors.push('Invalid target class');
        }

        if (!uploadData.image) {
            errors.push('Image file is required');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }
}

// Export singleton instance
export default new WebCephService();
