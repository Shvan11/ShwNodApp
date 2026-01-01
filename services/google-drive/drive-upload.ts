/**
 * Google Drive Upload Service
 * High-level service for uploading files to Google Drive with proper organization
 */
import { Readable } from 'stream';
import config from '../../config/config.js';
import driveClient from './google-drive-client.js';
import { log } from '../../utils/logger.js';

// ===========================================
// TYPES
// ===========================================

/**
 * File information for upload
 */
export interface FileInfo {
  buffer: Buffer;
  originalName: string;
}

/**
 * Aligner set information
 */
export interface SetInfo {
  patientId: string;
  patientName: string;
  workId: string;
  setSequence: number;
}

/**
 * Upload result
 */
export interface UploadResult {
  success: boolean;
  fileId?: string;
  fileName?: string;
  url?: string;
  webViewLink?: string;
  size?: string | number;
  uploadedAt?: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  size?: number;
}

/**
 * Connection test result
 */
export interface ConnectionTestResult {
  success: boolean;
  message: string;
  warning?: string;
}

// ===========================================
// DRIVE UPLOAD SERVICE CLASS
// ===========================================

class DriveUploadService {
  /**
   * Upload a PDF file for an aligner set
   * @param fileInfo - File information
   * @param setInfo - Aligner set information
   * @param uploadedBy - Email of uploader
   * @returns Upload result with URL and file ID
   */
  async uploadPdfForSet(
    fileInfo: FileInfo,
    setInfo: SetInfo,
    uploadedBy: string
  ): Promise<UploadResult> {
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
        description: `Aligner Set #${setInfo.setSequence} PDF for Patient ${setInfo.patientName} (${setInfo.patientId}). Uploaded by: ${uploadedBy}`,
      };

      // Prepare media
      const media = {
        mimeType: 'application/pdf',
        body: Readable.from(fileInfo.buffer),
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
        uploadedAt: uploadedFile.createdTime,
      };
    } catch (error) {
      log.error('Error uploading PDF to Google Drive', { error: (error as Error).message });
      throw new Error(`Failed to upload PDF: ${(error as Error).message}`);
    }
  }

  /**
   * Delete a PDF file from Google Drive
   * @param fileId - Google Drive file ID
   * @returns Success status
   */
  async deletePdf(fileId: string): Promise<boolean> {
    if (!driveClient.isInitialized()) {
      throw new Error('Google Drive client is not initialized');
    }

    try {
      await driveClient.deleteFile(fileId);
      return true;
    } catch (error) {
      log.error('Error deleting PDF from Google Drive', { error: (error as Error).message });
      // Don't throw - file might already be deleted
      return false;
    }
  }

  /**
   * Get or create the root folder for aligner PDFs
   * @returns Root folder ID
   */
  async getRootFolder(): Promise<string> {
    const rootFolderId = config.googleDrive.folderId;

    if (!rootFolderId) {
      throw new Error(
        'GOOGLE_DRIVE_FOLDER_ID not configured. Please set the root folder ID in environment variables.'
      );
    }

    // Validate folder exists and is accessible
    try {
      await driveClient.drive!.files.get({
        fileId: rootFolderId,
        fields: 'id, name',
      });
      return rootFolderId;
    } catch (error) {
      throw new Error(
        `Cannot access Google Drive folder (${rootFolderId}). Please ensure the folder exists and is shared with the service account.`
      );
    }
  }

  /**
   * Generate standardized filename for aligner set PDF
   * @param setInfo - Set information
   * @param timestamp - Timestamp string
   * @returns Generated filename
   */
  generateFilename(setInfo: SetInfo, timestamp: string): string {
    const sanitizedPatientName = this.sanitizeFilename(setInfo.patientName);
    return `${setInfo.patientId}_${sanitizedPatientName}_Set${setInfo.setSequence}_${timestamp}.pdf`;
  }

  /**
   * Sanitize filename by removing special characters
   * @param name - Original name
   * @returns Sanitized name
   */
  sanitizeFilename(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .substring(0, 50);
  }

  /**
   * Sanitize folder name
   * @param name - Original name
   * @returns Sanitized name
   */
  sanitizeFolderName(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9_\-\s]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .substring(0, 100);
  }

  /**
   * Validate PDF file
   * @param buffer - File buffer
   * @param mimetype - File mimetype
   * @returns Validation result
   */
  validatePdfFile(buffer: Buffer, mimetype: string): ValidationResult {
    // Check mimetype
    if (mimetype !== 'application/pdf') {
      return {
        valid: false,
        error: 'Invalid file type. Only PDF files are allowed.',
      };
    }

    // Check PDF magic bytes (PDF header: %PDF)
    if (buffer.length < 4) {
      return {
        valid: false,
        error: 'File is too small to be a valid PDF.',
      };
    }

    const header = buffer.toString('utf8', 0, 4);
    if (header !== '%PDF') {
      return {
        valid: false,
        error: 'File does not appear to be a valid PDF (invalid header).',
      };
    }

    // Check file size (100MB max)
    const maxSize = 100 * 1024 * 1024; // 100MB
    if (buffer.length > maxSize) {
      return {
        valid: false,
        error: 'File is too large. Maximum size is 100MB.',
      };
    }

    return {
      valid: true,
      size: buffer.length,
    };
  }

  /**
   * Test Google Drive connection
   * @returns Connection test result
   */
  async testConnection(): Promise<ConnectionTestResult> {
    try {
      if (!driveClient.isInitialized()) {
        return {
          success: false,
          message: 'Google Drive client is not initialized',
        };
      }

      const isConnected = await driveClient.testConnection();

      if (isConnected) {
        // Try to access root folder
        const rootFolderId = config.googleDrive.folderId;
        if (rootFolderId) {
          await driveClient.drive!.files.get({
            fileId: rootFolderId,
            fields: 'id, name',
          });
          return {
            success: true,
            message: 'Successfully connected to Google Drive and can access root folder',
          };
        } else {
          return {
            success: true,
            message: 'Connected to Google Drive, but root folder not configured',
            warning: 'Please set GOOGLE_DRIVE_FOLDER_ID in environment variables',
          };
        }
      }

      return {
        success: false,
        message: 'Failed to connect to Google Drive',
      };
    } catch (error) {
      log.error('Connection test error', { error: (error as Error).message });
      return {
        success: false,
        message: `Connection error: ${(error as Error).message}`,
      };
    }
  }
}

// Create singleton instance
const driveUploadService = new DriveUploadService();

export default driveUploadService;
