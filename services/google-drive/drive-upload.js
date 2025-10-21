/**
 * Google Drive Upload Service
 * High-level service for uploading files to Google Drive with proper organization
 */
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import config from '../../config/config.js';
import driveClient from './google-drive-client.js';

class DriveUploadService {
  /**
   * Upload a PDF file for an aligner set
   * @param {Object} fileInfo - File information
   * @param {Buffer} fileInfo.buffer - File buffer
   * @param {string} fileInfo.originalName - Original filename
   * @param {Object} setInfo - Aligner set information
   * @param {string} setInfo.patientId - Patient ID
   * @param {string} setInfo.patientName - Patient name
   * @param {string} setInfo.workId - Work ID
   * @param {number} setInfo.setSequence - Set sequence number
   * @param {string} uploadedBy - Email of uploader
   * @returns {Promise<Object>} Upload result with URL and file ID
   */
  async uploadPdfForSet(fileInfo, setInfo, uploadedBy) {
    if (!driveClient.isInitialized()) {
      throw new Error('Google Drive client is not initialized. Please configure credentials.');
    }

    try {
      // Get or create the root folder
      const rootFolderId = await this.getRootFolder();

      // Create patient folder structure
      const patientFolderName = this.sanitizeFolderName(
        `Patient_${setInfo.patientId}_${setInfo.patientName}_Work_${setInfo.workId}`
      );
      const patientFolderId = await driveClient.findOrCreateFolder(
        patientFolderName,
        rootFolderId
      );

      // Generate standardized filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const filename = this.generateFilename(setInfo, timestamp);

      // Prepare file metadata
      const fileMetadata = {
        name: filename,
        parents: [patientFolderId],
        description: `Aligner Set #${setInfo.setSequence} PDF for Patient ${setInfo.patientName} (${setInfo.patientId}). Uploaded by: ${uploadedBy}`
      };

      // Prepare media
      const media = {
        mimeType: 'application/pdf',
        body: Readable.from(fileInfo.buffer)
      };

      // Upload file
      const uploadedFile = await driveClient.uploadFile(fileMetadata, media);

      // Create shareable link
      const shareableLink = await driveClient.createShareableLink(uploadedFile.id);

      return {
        success: true,
        fileId: uploadedFile.id,
        fileName: uploadedFile.name,
        url: shareableLink,
        webViewLink: uploadedFile.webViewLink,
        size: uploadedFile.size,
        uploadedAt: uploadedFile.createdTime
      };
    } catch (error) {
      console.error('Error uploading PDF to Google Drive:', error);
      throw new Error(`Failed to upload PDF: ${error.message}`);
    }
  }

  /**
   * Delete a PDF file from Google Drive
   * @param {string} fileId - Google Drive file ID
   * @returns {Promise<boolean>} Success status
   */
  async deletePdf(fileId) {
    if (!driveClient.isInitialized()) {
      throw new Error('Google Drive client is not initialized');
    }

    try {
      await driveClient.deleteFile(fileId);
      return true;
    } catch (error) {
      console.error('Error deleting PDF from Google Drive:', error);
      // Don't throw - file might already be deleted
      return false;
    }
  }

  /**
   * Get or create the root folder for aligner PDFs
   * @returns {Promise<string>} Root folder ID
   */
  async getRootFolder() {
    const rootFolderId = config.googleDrive.folderId;

    if (!rootFolderId) {
      throw new Error('GOOGLE_DRIVE_FOLDER_ID not configured. Please set the root folder ID in environment variables.');
    }

    // Validate folder exists and is accessible
    try {
      await driveClient.drive.files.get({
        fileId: rootFolderId,
        fields: 'id, name'
      });
      return rootFolderId;
    } catch (error) {
      throw new Error(`Cannot access Google Drive folder (${rootFolderId}). Please ensure the folder exists and is shared with the service account.`);
    }
  }

  /**
   * Generate standardized filename for aligner set PDF
   * @param {Object} setInfo - Set information
   * @param {string} timestamp - Timestamp string
   * @returns {string} Generated filename
   */
  generateFilename(setInfo, timestamp) {
    const sanitizedPatientName = this.sanitizeFilename(setInfo.patientName);
    return `${setInfo.patientId}_${sanitizedPatientName}_Set${setInfo.setSequence}_${timestamp}.pdf`;
  }

  /**
   * Sanitize filename by removing special characters
   * @param {string} name - Original name
   * @returns {string} Sanitized name
   */
  sanitizeFilename(name) {
    return name
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .substring(0, 50);
  }

  /**
   * Sanitize folder name
   * @param {string} name - Original name
   * @returns {string} Sanitized name
   */
  sanitizeFolderName(name) {
    return name
      .replace(/[^a-zA-Z0-9_\-\s]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .substring(0, 100);
  }

  /**
   * Validate PDF file
   * @param {Buffer} buffer - File buffer
   * @param {string} mimetype - File mimetype
   * @returns {Object} Validation result
   */
  validatePdfFile(buffer, mimetype) {
    // Check mimetype
    if (mimetype !== 'application/pdf') {
      return {
        valid: false,
        error: 'Invalid file type. Only PDF files are allowed.'
      };
    }

    // Check PDF magic bytes (PDF header: %PDF)
    if (buffer.length < 4) {
      return {
        valid: false,
        error: 'File is too small to be a valid PDF.'
      };
    }

    const header = buffer.toString('utf8', 0, 4);
    if (header !== '%PDF') {
      return {
        valid: false,
        error: 'File does not appear to be a valid PDF (invalid header).'
      };
    }

    // Check file size (100MB max)
    const maxSize = 100 * 1024 * 1024; // 100MB
    if (buffer.length > maxSize) {
      return {
        valid: false,
        error: 'File is too large. Maximum size is 100MB.'
      };
    }

    return {
      valid: true,
      size: buffer.length
    };
  }

  /**
   * Test Google Drive connection
   * @returns {Promise<Object>} Connection test result
   */
  async testConnection() {
    try {
      if (!driveClient.isInitialized()) {
        return {
          success: false,
          message: 'Google Drive client is not initialized'
        };
      }

      const isConnected = await driveClient.testConnection();

      if (isConnected) {
        // Try to access root folder
        const rootFolderId = config.googleDrive.folderId;
        if (rootFolderId) {
          await driveClient.drive.files.get({
            fileId: rootFolderId,
            fields: 'id, name'
          });
          return {
            success: true,
            message: 'Successfully connected to Google Drive and can access root folder'
          };
        } else {
          return {
            success: true,
            message: 'Connected to Google Drive, but root folder not configured',
            warning: 'Please set GOOGLE_DRIVE_FOLDER_ID in environment variables'
          };
        }
      }

      return {
        success: false,
        message: 'Failed to connect to Google Drive'
      };
    } catch (error) {
      console.error('Connection test error:', error);
      return {
        success: false,
        message: `Connection error: ${error.message}`
      };
    }
  }
}

// Create singleton instance
const driveUploadService = new DriveUploadService();

export default driveUploadService;
