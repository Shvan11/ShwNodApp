/**
 * Google Drive API Client
 * Handles authentication and basic Drive API operations
 */
import { google } from 'googleapis';
import config from '../../config/config.js';

class GoogleDriveClient {
  constructor() {
    this.oauth2Client = null;
    this.drive = null;
    this.initialized = false;
  }

  /**
   * Initialize the Google Drive client with OAuth2 credentials
   */
  initialize() {
    try {
      const { clientId, clientSecret, redirectUri, refreshToken } = config.googleDrive;

      // Validate required credentials
      if (!clientId || !clientSecret) {
        console.warn('Google Drive credentials not configured. PDF upload will be disabled.');
        return false;
      }

      // Create OAuth2 client
      this.oauth2Client = new google.auth.OAuth2(
        clientId,
        clientSecret,
        redirectUri
      );

      // Set refresh token if available
      if (refreshToken) {
        this.oauth2Client.setCredentials({
          refresh_token: refreshToken
        });
      }

      // Initialize Drive API
      this.drive = google.drive({
        version: 'v3',
        auth: this.oauth2Client
      });

      this.initialized = true;
      console.log('Google Drive client initialized successfully');
      return true;
    } catch (error) {
      console.error('Failed to initialize Google Drive client:', error);
      this.initialized = false;
      return false;
    }
  }

  /**
   * Check if the client is properly initialized
   */
  isInitialized() {
    return this.initialized;
  }

  /**
   * Generate OAuth2 authorization URL
   * @returns {string} Authorization URL
   */
  getAuthUrl() {
    if (!this.oauth2Client) {
      throw new Error('OAuth2 client not initialized');
    }

    const scopes = [
      'https://www.googleapis.com/auth/drive' // Full access to Google Drive
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent' // Force consent screen to get refresh token
    });
  }

  /**
   * Exchange authorization code for tokens
   * @param {string} code - Authorization code from OAuth callback
   * @returns {Promise<Object>} Tokens object
   */
  async getTokensFromCode(code) {
    if (!this.oauth2Client) {
      throw new Error('OAuth2 client not initialized');
    }

    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);

    return tokens;
  }

  /**
   * Upload a file to Google Drive
   * @param {Object} fileMetadata - File metadata (name, parents, etc.)
   * @param {Object} media - File media object (mimeType, body)
   * @returns {Promise<Object>} Upload response with file ID and webViewLink
   */
  async uploadFile(fileMetadata, media) {
    if (!this.initialized) {
      throw new Error('Google Drive client not initialized');
    }

    try {
      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id, name, webViewLink, webContentLink, size, createdTime'
      });

      return response.data;
    } catch (error) {
      console.error('Error uploading file to Google Drive:', error);
      throw error;
    }
  }

  /**
   * Create a shareable link for a file
   * @param {string} fileId - Google Drive file ID
   * @returns {Promise<string>} Shareable link
   */
  async createShareableLink(fileId) {
    if (!this.initialized) {
      throw new Error('Google Drive client not initialized');
    }

    try {
      // Make file viewable by anyone with the link
      await this.drive.permissions.create({
        fileId: fileId,
        requestBody: {
          role: 'reader',
          type: 'anyone'
        }
      });

      // Get the file to retrieve webViewLink
      const file = await this.drive.files.get({
        fileId: fileId,
        fields: 'webViewLink'
      });

      return file.data.webViewLink;
    } catch (error) {
      console.error('Error creating shareable link:', error);
      throw error;
    }
  }

  /**
   * Delete a file from Google Drive
   * @param {string} fileId - Google Drive file ID
   * @returns {Promise<void>}
   */
  async deleteFile(fileId) {
    if (!this.initialized) {
      throw new Error('Google Drive client not initialized');
    }

    try {
      await this.drive.files.delete({
        fileId: fileId
      });
    } catch (error) {
      console.error('Error deleting file from Google Drive:', error);
      throw error;
    }
  }

  /**
   * Create a folder in Google Drive
   * @param {string} folderName - Name of the folder
   * @param {string} parentFolderId - Parent folder ID (optional)
   * @returns {Promise<string>} Folder ID
   */
  async createFolder(folderName, parentFolderId = null) {
    if (!this.initialized) {
      throw new Error('Google Drive client not initialized');
    }

    try {
      const fileMetadata = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder'
      };

      if (parentFolderId) {
        fileMetadata.parents = [parentFolderId];
      }

      const folder = await this.drive.files.create({
        requestBody: fileMetadata,
        fields: 'id, name'
      });

      return folder.data.id;
    } catch (error) {
      console.error('Error creating folder:', error);
      throw error;
    }
  }

  /**
   * Find or create a folder by path
   * @param {string} folderName - Name of the folder
   * @param {string} parentFolderId - Parent folder ID
   * @returns {Promise<string>} Folder ID
   */
  async findOrCreateFolder(folderName, parentFolderId) {
    if (!this.initialized) {
      throw new Error('Google Drive client not initialized');
    }

    try {
      // Search for existing folder
      const query = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed=false`;

      const response = await this.drive.files.list({
        q: query,
        fields: 'files(id, name)',
        spaces: 'drive'
      });

      if (response.data.files && response.data.files.length > 0) {
        return response.data.files[0].id;
      }

      // Create folder if it doesn't exist
      return await this.createFolder(folderName, parentFolderId);
    } catch (error) {
      console.error('Error finding or creating folder:', error);
      throw error;
    }
  }

  /**
   * Test the Drive connection
   * @returns {Promise<boolean>} Connection status
   */
  async testConnection() {
    if (!this.initialized) {
      return false;
    }

    try {
      await this.drive.files.list({
        pageSize: 1,
        fields: 'files(id, name)'
      });
      return true;
    } catch (error) {
      console.error('Google Drive connection test failed:', error);
      return false;
    }
  }
}

// Create singleton instance
const driveClient = new GoogleDriveClient();

export default driveClient;
