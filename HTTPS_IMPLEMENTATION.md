# HTTPS Implementation for Shwan Orthodontics Application

## Overview
This document outlines the complete HTTPS implementation for LAN use in the Shwan Orthodontics Node.js application, enabling secure connections within the local network.

## Implementation Summary

### 1. SSL Certificate Generation
**Location:** `/ssl/` directory
```bash
# Self-signed SSL certificate created with:
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes \
  -subj "/C=US/ST=State/L=City/O=ShwanOrthodontics/OU=IT/CN=192.168.100.2"
```

**Files created:**
- `ssl/cert.pem` - SSL certificate (2049 bytes)
- `ssl/key.pem` - Private key (3272 bytes)

### 2. SSL Configuration Module
**File:** `config/ssl.js`

Created a dedicated SSL configuration module that:
- Manages SSL certificate paths
- Provides HTTPS server options
- Checks certificate availability
- Handles SSL initialization errors gracefully

**Key Features:**
- Automatic certificate validation
- Error handling for missing certificates
- ES module compatibility

### 3. Server Enhancement
**File:** `index.js` (Modified)

**Changes made:**
- Added HTTPS module import: `import { createServer as createHttpsServer } from 'https'`
- Added SSL config import: `import sslConfig from './config/ssl.js'`
- Implemented conditional server creation (HTTP/HTTPS)
- Updated logging to show correct protocol
- Maintained all existing functionality

**Server Creation Logic:**
```javascript
const useHttps = process.env.ENABLE_HTTPS === 'true' && sslConfig.isAvailable();

if (useHttps) {
  const sslOptions = sslConfig.getOptions();
  server = createHttpsServer(sslOptions, app);
} else {
  server = createServer(app);
}
```

### 4. Environment Configuration
**File:** `.env` (Updated)

**Added variables:**
```bash
# HTTPS Configuration
ENABLE_HTTPS=false  # Set to 'true' to enable HTTPS
```

**Enhanced QR_HOST_URL documentation:**
- Automatic protocol switching based on HTTPS setting
- Clear instructions for HTTP/HTTPS modes

## Cross-Platform Compatibility

### Port Configuration
The implementation respects existing cross-platform behavior:
- **Windows:** Port 80 (default HTTP/HTTPS port)
- **WSL/Ubuntu:** Port 3000 (development-friendly port)

### URL Access Patterns
- **HTTP Mode:** `http://192.168.100.2:port`
- **HTTPS Mode:** `https://192.168.100.2:port`

## Usage Instructions

### Enabling HTTPS
1. **Edit `.env` file:**
   ```bash
   ENABLE_HTTPS=true
   ```

2. **Start the application:**
   ```bash
   node index.js
   ```

3. **Access the application:**
   - WSL: `https://192.168.100.2:3000`
   - Windows: `https://192.168.100.2:80` or `https://192.168.100.2`

### Disabling HTTPS (Default)
```bash
ENABLE_HTTPS=false
```
Application runs on HTTP as before, maintaining backward compatibility.

## Windows Hostname Configuration

### For `https://clinic` Access
To enable `https://clinic` access on Windows computers:

1. **Update SSL Certificate** (include clinic hostname):
   ```bash
   openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes \
     -subj "/C=US/ST=State/L=City/O=ShwanOrthodontics/OU=IT/CN=clinic" \
     -addext "subjectAltName=DNS:clinic,DNS:192.168.100.2,IP:192.168.100.2"
   ```

2. **Windows Hosts File** (Administrator required):
   ```
   # Add to C:\Windows\System32\drivers\etc\hosts
   192.168.100.2  clinic
   ```

3. **Windows Port Configuration:**
   - Ensure application runs on port 443 (standard HTTPS) or port 80
   - Update `.env`: `PORT=443` for standard HTTPS

## Security Considerations

### Self-Signed Certificates
- **Perfect for LAN use** - No external CA required
- **Browser warnings** - Users need to accept certificate
- **Valid for 365 days** - Regenerate annually

### Certificate Security
- Private key permissions: `600` (owner read/write only)
- Certificate stored locally, not in version control
- Suitable for internal network only

## File Structure
```
ShwNodApp/
├── ssl/                    # SSL certificates directory
│   ├── cert.pem           # SSL certificate
│   └── key.pem            # Private key
├── config/
│   └── ssl.js             # SSL configuration module
├── index.js               # Main server (HTTPS-enabled)
├── .env                   # Environment variables
└── HTTPS_IMPLEMENTATION.md # This documentation
```

## Testing

### Verification Steps
1. **Certificate exists:** `ls -la ssl/`
2. **Start with HTTPS:** `ENABLE_HTTPS=true node index.js`
3. **Test endpoint:** `curl -k https://localhost:3000/health/basic`
4. **Check logs:** Look for "🔒 HTTPS server will be created"

### Expected Outputs
- Console: "🔒 HTTPS server will be created"
- Server: "Server running at https://localhost:port"
- Health endpoint accessible via HTTPS

## Troubleshooting

### Common Issues
1. **Certificate not found:**
   - Verify `ssl/cert.pem` and `ssl/key.pem` exist
   - Check file permissions

2. **Port conflicts:**
   - Change PORT environment variable
   - Ensure no other services on same port

3. **Browser certificate warnings:**
   - Normal for self-signed certificates
   - Click "Advanced" → "Proceed to site"

### Fallback Behavior
- If HTTPS enabled but certificates missing: Falls back to HTTP
- If HTTPS disabled: Runs HTTP as normal
- Maintains all existing functionality

## Maintenance

### Certificate Renewal
Certificates expire after 365 days. To renew:
```bash
cd ssl/
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes \
  -subj "/C=US/ST=State/L=City/O=ShwanOrthodontics/OU=IT/CN=clinic" \
  -addext "subjectAltName=DNS:clinic,DNS:192.168.100.2,IP:192.168.100.2"
```

### Backup
- Back up `ssl/` directory before system changes
- Certificate and key files are not in version control (security)

## Implementation Benefits
- ✅ **LAN Security:** Encrypted communication within office network
- ✅ **Zero Configuration:** Works out of the box with environment variable
- ✅ **Backward Compatible:** Existing HTTP functionality preserved
- ✅ **Cross-Platform:** Works on Windows and WSL/Ubuntu
- ✅ **Flexible:** Easy to enable/disable via environment variable
- ✅ **Professional:** Proper SSL configuration for dental practice