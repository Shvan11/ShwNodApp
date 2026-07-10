/**
 * Google Drive API Client
 * Handles authentication and basic Drive API operations
 */
import { drive, drive_v3 } from '@googleapis/drive';
import { OAuth2Client, type Credentials } from 'google-auth-library';
import config from '../../config/config.js';
import { log } from '../../utils/logger.js';
import {
  getGoogleDriveTokens,
  saveGoogleDriveTokens,
} from '../database/queries/google-drive-queries.js';

// OAuth2 client type (drive() accepts this as its `auth`)
type OAuth2ClientType = OAuth2Client;

// ===========================================
// TYPES
// ===========================================

/**
 * File metadata for upload
 */
export interface DriveFileMetadata {
  name: string;
  parents?: string[];
  description?: string;
  mimeType?: string;
}

/**
 * File media for upload
 */
export interface DriveMedia {
  mimeType: string;
  body: NodeJS.ReadableStream;
}

/**
 * Upload response
 */
export interface DriveUploadResponse {
  id: string;
  name?: string;
  webViewLink?: string;
  webContentLink?: string;
  size?: string;
  createdTime?: string;
}

/**
 * Tokens from OAuth
 */
export interface OAuthTokens extends Credentials {
  access_token?: string | null;
  refresh_token?: string | null;
  scope?: string;
  token_type?: string | null;
  expiry_date?: number | null;
}

// ===========================================
// GOOGLE DRIVE CLIENT CLASS
// ===========================================

class GoogleDriveClient {
  public oauth2Client: OAuth2ClientType | null = null;
  public drive: drive_v3.Drive | null = null;
  public initialized = false;

  // De-dupes concurrent findOrCreateFolder calls for the same (parent, name) pair
  // within this process — without it, two uploads racing for the same
  // not-yet-created patient folder can each miss the list check and create a
  // duplicate folder.
  private folderCreationInFlight = new Map<string, Promise<string>>();

  /**
   * Initialize the Google Drive client with OAuth2 credentials
   */
  initialize(): boolean {
    try {
      const { clientId, clientSecret, redirectUri, refreshToken } = config.googleDrive;

      // Validate required credentials
      if (!clientId || !clientSecret) {
        log.warn('Google Drive credentials not configured. PDF upload will be disabled.');
        return false;
      }

      // Create OAuth2 client
      this.oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);

      // Set refresh token if available (env fallback — loadStoredCredentials()
      // overrides this with the DB-stored token, if one has been connected via
      // Settings → Integrations).
      if (refreshToken) {
        this.oauth2Client.setCredentials({
          refresh_token: refreshToken,
        });
      }

      // Persist a rotated/newly-issued refresh token so a future restart picks it
      // up without re-running the consent flow. Google only emits refresh_token on
      // the initial grant (or an occasional rotation), never on a plain access-token
      // refresh, so this fires rarely — best-effort, never throws into caller code.
      this.oauth2Client.on('tokens', (tokens: Credentials) => {
        if (!tokens.refresh_token) return;
        saveGoogleDriveTokens({
          accessToken: tokens.access_token || '',
          refreshToken: tokens.refresh_token,
          tokenType: tokens.token_type || 'Bearer',
          scope: tokens.scope ?? null,
          expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 3600_000),
        }).catch((error: unknown) => {
          log.error('Failed to persist rotated Google Drive refresh token', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      });

      // Initialize Drive API
      this.drive = drive({
        version: 'v3',
        auth: this.oauth2Client,
      });

      this.initialized = true;
      log.info('Google Drive client initialized successfully');
      return true;
    } catch (error) {
      log.error('Failed to initialize Google Drive client', { error: (error as Error).message });
      this.initialized = false;
      return false;
    }
  }

  /**
   * Check if the client is properly initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Load a DB-stored refresh token (Settings → Integrations connect flow), if one
   * exists, and apply it — taking precedence over the env-configured token so a
   * reconnect through the UI takes effect immediately, no restart required.
   * @returns Whether DB-stored credentials were found and applied
   */
  async loadStoredCredentials(): Promise<boolean> {
    if (!this.oauth2Client) return false;
    const tokens = await getGoogleDriveTokens();
    if (!tokens?.refreshToken) return false;
    this.oauth2Client.setCredentials({
      refresh_token: tokens.refreshToken,
      access_token: tokens.accessToken || undefined,
      expiry_date: tokens.expiresAt.getTime(),
    });
    return true;
  }

  /**
   * Generate OAuth2 authorization URL
   * @param state - Anti-CSRF state, verified by the callback against the session
   * @returns Authorization URL
   */
  getAuthUrl(state: string): string {
    if (!this.oauth2Client) {
      throw new Error('OAuth2 client not initialized');
    }

    const scopes = [
      'https://www.googleapis.com/auth/drive', // Full access to Google Drive
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent', // Force consent screen to get refresh token
      state,
    });
  }

  /**
   * Exchange authorization code for tokens
   * @param code - Authorization code from OAuth callback
   * @returns Tokens object
   */
  async getTokensFromCode(code: string): Promise<OAuthTokens> {
    if (!this.oauth2Client) {
      throw new Error('OAuth2 client not initialized');
    }

    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);

    return tokens as OAuthTokens;
  }

  /**
   * Upload a file to Google Drive
   * @param fileMetadata - File metadata (name, parents, etc.)
   * @param media - File media object (mimeType, body)
   * @returns Upload response with file ID and webViewLink
   */
  async uploadFile(
    fileMetadata: DriveFileMetadata,
    media: DriveMedia
  ): Promise<DriveUploadResponse> {
    if (!this.initialized || !this.drive) {
      throw new Error('Google Drive client not initialized');
    }

    try {
      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id, name, webViewLink, webContentLink, size, createdTime',
      });

      return response.data as DriveUploadResponse;
    } catch (error) {
      log.error('Error uploading file to Google Drive', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Create a shareable link for a file
   * @param fileId - Google Drive file ID
   * @returns Shareable link
   */
  async createShareableLink(fileId: string): Promise<string> {
    if (!this.initialized || !this.drive) {
      throw new Error('Google Drive client not initialized');
    }

    try {
      // Make file viewable by anyone with the link
      await this.drive.permissions.create({
        fileId: fileId,
        requestBody: {
          role: 'reader',
          type: 'anyone',
        },
      });

      // Get the file to retrieve webViewLink
      const file = await this.drive.files.get({
        fileId: fileId,
        fields: 'webViewLink',
      });

      return file.data.webViewLink || '';
    } catch (error) {
      log.error('Error creating shareable link', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Delete a file from Google Drive
   * @param fileId - Google Drive file ID
   */
  async deleteFile(fileId: string): Promise<void> {
    if (!this.initialized || !this.drive) {
      throw new Error('Google Drive client not initialized');
    }

    try {
      await this.drive.files.delete({
        fileId: fileId,
      });
    } catch (error) {
      log.error('Error deleting file from Google Drive', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Create a folder in Google Drive
   * @param folderName - Name of the folder
   * @param parentFolderId - Parent folder ID (optional)
   * @returns Folder ID
   */
  async createFolder(folderName: string, parentFolderId: string | null = null): Promise<string> {
    if (!this.initialized || !this.drive) {
      throw new Error('Google Drive client not initialized');
    }

    try {
      const fileMetadata: DriveFileMetadata = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
      };

      if (parentFolderId) {
        fileMetadata.parents = [parentFolderId];
      }

      const folder = await this.drive.files.create({
        requestBody: fileMetadata,
        fields: 'id, name',
      });

      return folder.data.id || '';
    } catch (error) {
      log.error('Error creating folder', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Find or create a folder by path
   * @param folderName - Name of the folder
   * @param parentFolderId - Parent folder ID
   * @returns Folder ID
   */
  async findOrCreateFolder(folderName: string, parentFolderId: string): Promise<string> {
    const lockKey = `${parentFolderId}::${folderName}`;
    const inFlight = this.folderCreationInFlight.get(lockKey);
    if (inFlight) {
      return inFlight;
    }

    const promise = this.findOrCreateFolderUncached(folderName, parentFolderId).finally(() => {
      this.folderCreationInFlight.delete(lockKey);
    });
    this.folderCreationInFlight.set(lockKey, promise);
    return promise;
  }

  private async findOrCreateFolderUncached(folderName: string, parentFolderId: string): Promise<string> {
    if (!this.initialized || !this.drive) {
      throw new Error('Google Drive client not initialized');
    }

    try {
      // Search for existing folder
      const query = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed=false`;

      const response = await this.drive.files.list({
        q: query,
        fields: 'files(id, name)',
        spaces: 'drive',
      });

      if (response.data.files && response.data.files.length > 0) {
        return response.data.files[0].id || '';
      }

      // Create folder if it doesn't exist
      return await this.createFolder(folderName, parentFolderId);
    } catch (error) {
      log.error('Error finding or creating folder', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Test the Drive connection
   * @returns Connection status
   */
  async testConnection(): Promise<boolean> {
    if (!this.initialized || !this.drive) {
      return false;
    }

    try {
      await this.drive.files.list({
        pageSize: 1,
        fields: 'files(id, name)',
      });
      return true;
    } catch (error) {
      log.error('Google Drive connection test failed', { error: (error as Error).message });
      return false;
    }
  }
}

// Create singleton instance
const driveClient = new GoogleDriveClient();

export default driveClient;
