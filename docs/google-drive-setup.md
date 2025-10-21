# Google Drive PDF Upload Setup Guide

This guide explains how to set up Google Drive integration for uploading aligner PDFs in the Shwan Orthodontics application.

## Overview

The Google Drive integration allows doctors and lab staff to upload PDF files for aligner sets directly from the Aligner Portal. Files are:
- Uploaded to Google Drive
- Organized by patient and work ID
- Automatically shared with "anyone with link" permissions
- Tracked in the database with upload metadata

## Prerequisites

1. A Google account with access to Google Cloud Console
2. Admin access to your Shwan Orthodontics application
3. A Google Drive folder for storing aligner PDFs

## Setup Steps

### 1. Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Name it something like "Shwan Aligner PDFs"

### 2. Enable Google Drive API

1. In your project, go to **APIs & Services > Library**
2. Search for "Google Drive API"
3. Click on it and press **Enable**

### 3. Create OAuth 2.0 Credentials

1. Go to **APIs & Services > Credentials**
2. Click **Create Credentials > OAuth client ID**
3. If prompted, configure the OAuth consent screen:
   - Choose **Internal** (if using Google Workspace) or **External**
   - Fill in application name: "Shwan Orthodontics"
   - Add your email as support email
   - Add scopes: `https://www.googleapis.com/auth/drive.file`
   - Save and continue
4. Create OAuth client ID:
   - Application type: **Web application**
   - Name: "Shwan Orthodontics Web"
   - Authorized redirect URIs:
     - `http://localhost:3000/api/admin/google-drive/callback`
     - `https://your-domain.com/api/admin/google-drive/callback`
   - Click **Create**
5. **IMPORTANT**: Copy the **Client ID** and **Client Secret** - you'll need these!

### 4. Create Google Drive Folder

1. Go to [Google Drive](https://drive.google.com)
2. Create a new folder called "Aligner PDFs" (or any name you prefer)
3. Right-click the folder > Get link > Copy link
4. The folder ID is the last part of the URL:
   - URL: `https://drive.google.com/drive/folders/1a2b3c4d5e6f7g8h9i0j`
   - Folder ID: `1a2b3c4d5e6f7g8h9i0j`
5. Copy this folder ID

### 5. Configure Environment Variables

Add the following to your `.env` file:

```bash
# Google Drive Configuration
GOOGLE_DRIVE_CLIENT_ID=your_client_id_here
GOOGLE_DRIVE_CLIENT_SECRET=your_client_secret_here
GOOGLE_DRIVE_FOLDER_ID=your_folder_id_here
GOOGLE_DRIVE_REDIRECT_URI=http://localhost:3000/api/admin/google-drive/callback

# If you already have Google OAuth configured, you can skip CLIENT_ID and CLIENT_SECRET
# The system will use GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET as fallbacks
```

### 6. Get Refresh Token

This is the most important step - you need to authorize the application:

1. **Start your application** (it doesn't need the refresh token to generate the auth URL)

2. **Get the authorization URL**:
   ```bash
   curl http://localhost:3000/api/admin/google-drive/auth-url
   ```
   Or visit in browser: `http://localhost:3000/api/admin/google-drive/auth-url`

3. **Visit the authorization URL** that was returned (it will look like `https://accounts.google.com/o/oauth2/v2/auth?...`)

4. **Sign in with your Google account** and grant permissions

5. **You'll be redirected** to a success page showing your refresh token

6. **Copy the refresh token** and add it to `.env`:
   ```bash
   GOOGLE_DRIVE_REFRESH_TOKEN=your_refresh_token_here
   ```

7. **Restart your application** for the changes to take effect

### 7. Test the Connection

Test that everything is configured correctly:

```bash
curl http://localhost:3000/api/admin/google-drive/test
```

Expected response:
```json
{
  "success": true,
  "message": "Successfully connected to Google Drive and can access root folder"
}
```

## Environment Variables Reference

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `GOOGLE_DRIVE_CLIENT_ID` | Yes | OAuth client ID from Google Cloud Console | `123456-abc.apps.googleusercontent.com` |
| `GOOGLE_DRIVE_CLIENT_SECRET` | Yes | OAuth client secret | `GOCSPX-abc123xyz` |
| `GOOGLE_DRIVE_REFRESH_TOKEN` | Yes | Refresh token obtained from OAuth flow | `1//0abc123...` |
| `GOOGLE_DRIVE_FOLDER_ID` | Yes | Google Drive folder ID for storing PDFs | `1a2b3c4d5e6f7g8h9i0j` |
| `GOOGLE_DRIVE_REDIRECT_URI` | No | OAuth redirect URI (auto-generated if not set) | `http://localhost:3000/api/admin/google-drive/callback` |

## Using the Feature

### Upload a PDF

1. Navigate to the **Aligner Portal**
2. Select a patient case
3. Find the aligner set you want to upload a PDF for
4. Click the **"Upload PDF"** button
5. Select a PDF file from your computer (max 100MB)
6. Wait for upload to complete
7. The PDF link will appear automatically

### Replace a PDF

1. If a PDF already exists, you'll see **"Replace PDF"** button
2. Click it and select a new PDF
3. The old PDF will be deleted from Google Drive
4. The new PDF will be uploaded and linked

### Delete a PDF

1. Click the **"Delete PDF"** button next to the PDF link
2. Confirm the deletion
3. The PDF link will be removed from the database
4. The file will be deleted from Google Drive

## File Organization

PDFs are automatically organized in Google Drive as follows:

```
Aligner PDFs/                              (Root folder - GOOGLE_DRIVE_FOLDER_ID)
├── Patient_12345_John_Doe_Work_789/
│   ├── 12345_John_Doe_Set1_2025-10-20T14-30-00.pdf
│   └── 12345_John_Doe_Set2_2025-10-21T09-15-00.pdf
└── Patient_67890_Jane_Smith_Work_456/
    └── 67890_Jane_Smith_Set1_2025-10-20T16-45-00.pdf
```

### Filename Format
```
{PatientID}_{PatientName}_Set{SetSequence}_{Timestamp}.pdf
```

Example: `12345_John_Doe_Set1_2025-10-20T14-30-00.pdf`

## Troubleshooting

### "Google Drive client is not initialized"

**Cause**: Missing or invalid credentials in `.env`

**Solution**:
1. Verify all environment variables are set correctly
2. Restart the application
3. Check the startup logs for Drive initialization status

### "Cannot access Google Drive folder"

**Cause**: The folder ID is incorrect or the service account doesn't have access

**Solution**:
1. Verify the folder ID is correct
2. Make sure you're signed in with the Google account that owns the folder
3. Check that the folder exists in Google Drive

### "File does not appear to be a valid PDF"

**Cause**: The uploaded file is not a PDF or is corrupted

**Solution**:
1. Make sure the file has a `.pdf` extension
2. Try opening the file locally to verify it's a valid PDF
3. Try exporting/saving the PDF again from the original source

### "Failed to upload PDF: quota exceeded"

**Cause**: Google Drive API quota limit reached

**Solution**:
1. Wait for the quota to reset (usually at midnight Pacific Time)
2. Reduce the number of uploads
3. Contact Google Cloud support to increase quota limits

### Token expired or invalid

**Cause**: The refresh token is invalid or has been revoked

**Solution**:
1. Delete the `GOOGLE_DRIVE_REFRESH_TOKEN` from `.env`
2. Follow step 6 again to get a new refresh token
3. Update `.env` and restart the application

## Security Considerations

1. **Never commit `.env` file** to version control
2. **Keep credentials secure** - don't share client secrets
3. **Use environment-specific credentials** for production
4. **Review folder permissions** regularly
5. **Monitor API usage** in Google Cloud Console
6. **Files are public** to anyone with the link - don't store sensitive information

## API Endpoints

### Admin Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/google-drive/auth-url` | GET | Get OAuth authorization URL |
| `/api/admin/google-drive/callback` | GET | OAuth callback handler |
| `/api/admin/google-drive/test` | GET | Test Drive connection |
| `/api/admin/google-drive/status` | GET | Check configuration status |

### Portal Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/portal/sets/:setId/upload-pdf` | POST | Upload PDF for a set |
| `/api/portal/sets/:setId/pdf` | DELETE | Delete PDF from a set |

## Database Schema

The following fields were added to `tblAlignerSets`:

| Column | Type | Description |
|--------|------|-------------|
| `SetPdfUrl` | NVARCHAR(2000) | Public shareable link to the PDF |
| `DriveFileId` | NVARCHAR(255) | Google Drive file ID for management |
| `PdfUploadedAt` | DATETIME | Timestamp of last upload |
| `PdfUploadedBy` | NVARCHAR(255) | Email of person who uploaded |

## Support

If you encounter issues:

1. Check the application logs for detailed error messages
2. Verify all environment variables are set correctly
3. Test the connection using `/api/admin/google-drive/test`
4. Check Google Cloud Console for API usage and errors
5. Review this documentation for common issues

For additional help, contact your system administrator.
