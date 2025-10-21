# Google Drive PDF Upload Feature

## Quick Start

This feature allows uploading PDF files for aligner sets directly to Google Drive from the Aligner Portal.

### For Users

1. Navigate to **Aligner Portal** → Select a patient → Select an aligner set
2. Click **"Upload PDF"** button
3. Choose a PDF file (max 100MB)
4. PDF uploads to Google Drive and link is saved automatically
5. Anyone can view the PDF using the generated link

### For Administrators

**Setup Required** (one-time):

1. Create a Google Cloud project and enable Google Drive API
2. Create OAuth 2.0 credentials
3. Add credentials to `.env`:
   ```bash
   GOOGLE_DRIVE_CLIENT_ID=your_client_id
   GOOGLE_DRIVE_CLIENT_SECRET=your_secret
   GOOGLE_DRIVE_FOLDER_ID=your_folder_id
   ```
4. Run authorization flow to get refresh token:
   - Visit: `http://localhost:3000/api/admin/google-drive/auth-url`
   - Click the URL and authorize
   - Copy refresh token to `.env`
5. Restart application

**Full setup guide**: See [google-drive-setup.md](./google-drive-setup.md)

## Features

- ✅ Upload PDF files up to 100MB
- ✅ Automatic file organization by patient
- ✅ Replace existing PDFs
- ✅ Delete PDFs when no longer needed
- ✅ Track who uploaded and when
- ✅ Shareable public links
- ✅ Works for both doctors and lab staff

## Technical Details

### File Storage Structure
```
Google Drive Folder/
  └── Patient_{ID}_{Name}_Work_{WorkID}/
      └── {ID}_{Name}_Set{Seq}_{Timestamp}.pdf
```

### Database Fields Added
- `SetPdfUrl` - Public shareable link
- `DriveFileId` - Google Drive file ID
- `PdfUploadedAt` - Upload timestamp
- `PdfUploadedBy` - Uploader email

### API Endpoints
- `POST /api/portal/sets/:setId/upload-pdf` - Upload PDF
- `DELETE /api/portal/sets/:setId/pdf` - Delete PDF
- `GET /api/admin/google-drive/status` - Check config status
- `GET /api/admin/google-drive/test` - Test connection

## Files Modified/Created

### New Files
- `services/google-drive/google-drive-client.js` - OAuth & Drive API client
- `services/google-drive/drive-upload.js` - Upload service
- `middleware/upload.js` - Multer file upload middleware
- `routes/admin.js` - Admin configuration endpoints
- `migrations/add-pdf-tracking-fields.sql` - Database migration

### Modified Files
- `config/config.js` - Added Drive configuration
- `routes/portal.js` - Added upload/delete endpoints
- `public/js/components/react/AlignerPortalComponent.jsx` - Added upload UI
- `public/css/pages/alignerportal.css` - Added upload button styles
- `index.js` - Initialize Drive client on startup

## Configuration

### Environment Variables
```bash
# Required
GOOGLE_DRIVE_CLIENT_ID=        # OAuth client ID
GOOGLE_DRIVE_CLIENT_SECRET=    # OAuth client secret
GOOGLE_DRIVE_REFRESH_TOKEN=    # OAuth refresh token
GOOGLE_DRIVE_FOLDER_ID=        # Drive folder ID for PDFs

# Optional (auto-generated if not set)
GOOGLE_DRIVE_REDIRECT_URI=     # OAuth callback URL
```

### Validation
- File type: PDF only (validated by MIME type and magic bytes)
- File size: 100MB maximum
- Authentication: Required (doctor/lab staff)
- Authorization: Checked per set access

## Testing

### Test Connection
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

### Check Configuration
```bash
curl http://localhost:3000/api/admin/google-drive/status
```

### Upload Test
1. Login to aligner portal
2. Select any active aligner set
3. Click "Upload PDF"
4. Select a PDF file
5. Verify upload succeeds and link appears

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Google Drive client not initialized" | Check `.env` has all required variables, restart app |
| "Cannot access folder" | Verify `GOOGLE_DRIVE_FOLDER_ID` is correct |
| "Invalid file type" | Ensure file is actually a PDF |
| "Authentication failed" | Get new refresh token via OAuth flow |

## Security Notes

- ⚠️ PDFs are public to anyone with the link
- ⚠️ Never commit `.env` to version control
- ⚠️ Use separate credentials for production
- ✅ All uploads are authenticated
- ✅ File validation prevents non-PDF uploads
- ✅ Upload tracking for accountability

## Future Enhancements

Potential improvements:
- [ ] Bulk PDF upload
- [ ] PDF preview in portal
- [ ] Email notifications on upload
- [ ] Version history for PDFs
- [ ] Domain-restricted sharing (Google Workspace)
- [ ] Folder-level permissions
- [ ] Upload progress indicator
- [ ] Drag-and-drop upload interface

## Support

For setup assistance or issues:
1. Review [google-drive-setup.md](./google-drive-setup.md)
2. Check application logs
3. Test connection via admin endpoints
4. Verify Google Cloud Console for API errors

---

**Implementation Date**: 2025-10-20
**Developer**: Claude Code
**Status**: Production Ready ✅
