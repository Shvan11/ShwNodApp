/**
 * Admin Routes
 * Admin-only endpoints for configuration and management
 */
import express from 'express';
import driveClient from '../services/google-drive/google-drive-client.js';
import driveUploadService from '../services/google-drive/drive-upload.js';

const router = express.Router();

/**
 * Get Google Drive authorization URL
 * Use this to get the OAuth URL for initial setup
 */
router.get('/api/admin/google-drive/auth-url', (req, res) => {
    try {
        if (!driveClient.oauth2Client) {
            driveClient.initialize();
        }

        const authUrl = driveClient.getAuthUrl();

        res.json({
            success: true,
            authUrl: authUrl,
            message: 'Visit this URL to authorize the application'
        });
    } catch (error) {
        console.error('Error generating auth URL:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * OAuth callback handler
 * Exchanges the authorization code for tokens
 */
router.get('/api/admin/google-drive/callback', async (req, res) => {
    try {
        const { code } = req.query;

        if (!code) {
            return res.status(400).send('Authorization code not provided');
        }

        const tokens = await driveClient.getTokensFromCode(code);

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Google Drive Authorization Success</title>
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        max-width: 800px;
                        margin: 50px auto;
                        padding: 20px;
                        background: #f5f5f5;
                    }
                    .container {
                        background: white;
                        padding: 30px;
                        border-radius: 12px;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                    }
                    h1 { color: #00897B; }
                    .token-box {
                        background: #f9f9f9;
                        border: 1px solid #ddd;
                        border-radius: 6px;
                        padding: 15px;
                        margin: 20px 0;
                        font-family: 'Courier New', monospace;
                        word-break: break-all;
                    }
                    .success { color: #43A047; }
                    .instructions {
                        background: #E3F2FD;
                        padding: 15px;
                        border-radius: 6px;
                        margin: 20px 0;
                    }
                    code {
                        background: #f5f5f5;
                        padding: 2px 6px;
                        border-radius: 3px;
                        font-family: 'Courier New', monospace;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1 class="success">✓ Authorization Successful!</h1>
                    <p>Your Google Drive has been successfully authorized.</p>

                    <div class="instructions">
                        <h3>Next Steps:</h3>
                        <ol>
                            <li>Copy the refresh token below</li>
                            <li>Add it to your <code>.env</code> file as <code>GOOGLE_DRIVE_REFRESH_TOKEN</code></li>
                            <li>Restart your application</li>
                        </ol>
                    </div>

                    <h3>Refresh Token:</h3>
                    <div class="token-box">
                        ${tokens.refresh_token || 'No refresh token received. You may already have one configured.'}
                    </div>

                    <h3>Environment Variable:</h3>
                    <div class="token-box">
                        GOOGLE_DRIVE_REFRESH_TOKEN=${tokens.refresh_token || 'YOUR_TOKEN_HERE'}
                    </div>

                    ${tokens.access_token ? `
                        <p style="font-size: 0.9em; color: #666;">
                            <strong>Note:</strong> The access token will be automatically refreshed when needed.
                            You only need to save the refresh token.
                        </p>
                    ` : ''}
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Error in OAuth callback:', error);
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Authorization Error</title>
                <style>
                    body {
                        font-family: sans-serif;
                        max-width: 600px;
                        margin: 50px auto;
                        padding: 20px;
                    }
                    .error {
                        background: #ffebee;
                        border: 1px solid #ef5350;
                        border-radius: 6px;
                        padding: 20px;
                        color: #c62828;
                    }
                </style>
            </head>
            <body>
                <div class="error">
                    <h1>Authorization Failed</h1>
                    <p>${error.message}</p>
                </div>
            </body>
            </html>
        `);
    }
});

/**
 * Test Google Drive connection
 */
router.get('/api/admin/google-drive/test', async (req, res) => {
    try {
        const result = await driveUploadService.testConnection();
        res.json(result);
    } catch (error) {
        console.error('Error testing connection:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/**
 * Get Google Drive configuration status
 */
router.get('/api/admin/google-drive/status', (req, res) => {
    try {
        const isInitialized = driveClient.isInitialized();
        const config = {
            clientId: !!process.env.GOOGLE_DRIVE_CLIENT_ID || !!process.env.GOOGLE_CLIENT_ID,
            clientSecret: !!process.env.GOOGLE_DRIVE_CLIENT_SECRET || !!process.env.GOOGLE_CLIENT_SECRET,
            refreshToken: !!process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
            folderId: !!process.env.GOOGLE_DRIVE_FOLDER_ID
        };

        res.json({
            success: true,
            initialized: isInitialized,
            configuration: config,
            ready: isInitialized && config.clientId && config.clientSecret && config.refreshToken && config.folderId
        });
    } catch (error) {
        console.error('Error checking status:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

export default router;
