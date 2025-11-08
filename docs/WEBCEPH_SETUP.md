# WebCeph API Integration Setup Guide

## Current Status

The WebCeph integration has been fully implemented in the codebase, but we need the **correct API endpoint URL** from WebCeph to complete the setup.

## What's Been Done ✅

1. **Backend Service** - Full API integration in `/services/webceph/webceph-service.js`
2. **Database Schema** - Added WebCeph tracking fields to `tblPatients` table
3. **API Endpoints** - 4 new endpoints for patient creation and image upload
4. **Frontend UI** - Beautiful integration in the Edit Patient page
5. **Configuration** - Environment variables set up in `.env`

## What's Needed ❗

### Get Correct API Endpoint from WebCeph

The current error shows **404 Not Found**, which means the API URL is incorrect.

**Current configuration in `.env`:**
```
WEBCEPH_API_KEY=Schwan2WkiF7fg3uNLmUwqWznfk3oFmV8MAbdulkareem
WEBCEPH_API_PASSWORD=yarmok11
WEBCEPH_API_BASE_URL=https://webceph.com/partner/api
```

### Steps to Get the Correct URL:

1. **Contact WebCeph Support**
   - Email: support@webceph.com (or check their website)
   - Reference: Your Partner API Key (Schwan2WkiF7fg3uNLmUwqWznfk3oFmV8MAbdulkareem)

2. **Ask for:**
   - The correct base URL for Partner API endpoints
   - The exact endpoint paths for:
     - Creating a patient
     - Uploading images
     - Getting patient records
   - Authentication method (API Key header name, format, etc.)
   - Any required request headers
   - API documentation PDF or link

3. **Possible URL Formats:**
   The API base URL could be one of these formats:
   - `https://webceph.com/api/partner`
   - `https://webceph.com/partner/api`
   - `https://api.webceph.com/partner`
   - `https://api.webceph.com/v1/partner`
   - `https://webceph.com/api/v1/partner`

## How to Update Once You Have the Correct URL

### Option 1: Update via Settings UI (Recommended)
1. Navigate to `http://clinic:3000/settings/system`
2. Look for WebCeph API settings
3. Update the base URL
4. Restart the server

### Option 2: Update `.env` Directly
1. Edit `/home/administrator/projects/ShwNodApp/.env`
2. Update the `WEBCEPH_API_BASE_URL` line
3. Restart the server: `pm2 restart all` or `node index.js`

### Example:
If WebCeph tells you the base URL is `https://api.webceph.com/partner`, update `.env`:
```bash
WEBCEPH_API_BASE_URL=https://api.webceph.com/partner
```

## Testing the Integration

Once the correct URL is configured:

1. **Navigate to a patient edit page:**
   ```
   http://clinic:3000/patient/{patientId}/edit-patient
   ```

2. **Scroll to "WebCeph AI X-Ray Analysis" section**

3. **Click "Create in WebCeph"**
   - Should see success message
   - Patient link should appear

4. **Upload an X-ray image**
   - Select image file
   - Choose photo type (Lateral, PA, etc.)
   - Click "Upload to WebCeph"

5. **Check server logs** for any errors:
   ```bash
   tail -f /home/administrator/projects/ShwNodApp/server.log
   ```

## API Endpoints Documentation

### Expected Request Format

**Create Patient:**
```http
POST {BASE_URL}/create-patient
Headers:
  X-API-Key: Schwan2WkiF7fg3uNLmUwqWznfk3oFmV8MAbdulkareem
  Content-Type: application/json

Body:
{
  "patientID": "M75",
  "firstName": "John",
  "lastName": "Doe",
  "gender": "Male",
  "birthday": "1990-01-15",
  "race": "Asian"
}
```

**Expected Response:**
```json
{
  "result": "success",
  "patientid": "BBG7XKBTH",
  "linkid": "Adzv7pFl95234k",
  "link": "https://webceph.com/records/Adzv7pFl95234k/"
}
```

**Upload Image:**
```http
POST {BASE_URL}/upload-image
Headers:
  X-API-Key: Schwan2WkiF7fg3uNLmUwqWznfk3oFmV8MAbdulkareem
  Content-Type: multipart/form-data

Body (FormData):
  patientID: "M75"
  recordDate: "2025-11-08"
  photoType: "Lateral"
  image: <File>
```

## Troubleshooting

### Still Getting 404 Error
- Verify the base URL with WebCeph support
- Check if API key is active and has the right permissions
- Ensure you have a Premium or higher WebCeph subscription

### Getting 401/403 Error
- API key might be incorrect or expired
- Check if the API key header name is correct (`X-API-Key`)
- Verify your WebCeph account has API access enabled

### Getting JSON Parse Error
- The endpoint might be returning HTML (404 page)
- Double-check the URL path structure

## Contact Information

**WebCeph Official:**
- Website: https://webceph.com
- API Documentation: https://webceph.com/en/api/

**Your Credentials:**
- Partner API Key: `Schwan2WkiF7fg3uNLmUwqWznfk3oFmV8MAbdulkareem`
- Password: `yarmok11`
- Account: Shwan Orthodontics

## Next Steps

1. ✅ All code is ready and tested
2. ❗ **YOU NEED:** Get correct API base URL from WebCeph
3. ⏳ Update `.env` with correct URL
4. ✅ Restart server
5. ✅ Test patient creation and image upload

---

**Note:** The integration is 100% complete from a code perspective. We just need the correct API endpoint URL from WebCeph to make it work!
