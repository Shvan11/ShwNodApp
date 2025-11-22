# Protocol Handlers - Allowed Origins Reference

## Quick Reference

This document lists all approved origins that can launch protocol handlers **without browser confirmation prompts**.

---

## All Allowed Origins

### Production Environments

| Origin | Description | Use Case |
|--------|-------------|----------|
| `http://clinic:3000` | Hostname-based access | Primary production server (network hostname) |
| `http://192.168.100.2:3000` | IP-based access | Production server accessed by IP address |
| `http://localhost:3000` | Local production | Testing production build locally (`npm start`) |

### Development Environments

| Origin | Description | Use Case |
|--------|-------------|----------|
| `http://192.168.100.2:5173` | IP-based dev server | Vite dev server accessed by IP (`npm run dev`) |
| `http://localhost:5173` | Local dev server | Vite dev server accessed locally (`npm run dev`) |

---

## Supported Protocols

All origins above work with these three protocols:

### 1. Explorer Protocol (`explorer:`)
**Purpose**: Open/create folders on network shares
**Example**: `explorer:\\\\WORK_PC\\Aligner_Sets\\5\\John_Doe\\1`
**Used by**: Aligner sets "Open Folder" button

### 2. CS Imaging Protocol (`csimaging:`)
**Purpose**: Launch CS Imaging Trophy with patient X-rays
**Example**: `csimaging:12345?name=John_Doe`
**Used by**: Patient sidebar "CS Imaging" button

### 3. Universal Protocol (`launch:`)
**Purpose**: Launch any application with arguments
**Example**: `launch://msaccess?args={AccessDatabase}|/cmd|frmLabels|ID=123`
**Used by**: Aligner batch "Print Labels" button, custom application launchers

---

## Testing Matrix

Use this table to verify all protocols work from all origins:

| Origin | explorer: | csimaging: | launch: |
|--------|-----------|------------|---------|
| `http://clinic:3000` | ✅ | ✅ | ✅ |
| `http://192.168.100.2:3000` | ✅ | ✅ | ✅ |
| `http://localhost:3000` | ✅ | ✅ | ✅ |
| `http://192.168.100.2:5173` | ✅ | ✅ | ✅ |
| `http://localhost:5173` | ✅ | ✅ | ✅ |

**Expected behavior for all**: No browser prompt, immediate protocol launch

---

## How It Works

### Browser Policy Configuration

The installer configures this policy in Windows Registry for both Chrome and Edge:

```
HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Google\Chrome
HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\Edge

AutoLaunchProtocolsFromOrigins = [
  {
    "protocol": "explorer",
    "allowed_origins": [
      "http://clinic:3000",
      "http://192.168.100.2:3000",
      "http://localhost:3000",
      "http://192.168.100.2:5173",
      "http://localhost:5173"
    ]
  },
  {
    "protocol": "csimaging",
    "allowed_origins": [
      "http://clinic:3000",
      "http://192.168.100.2:3000",
      "http://localhost:3000",
      "http://192.168.100.2:5173",
      "http://localhost:5173"
    ]
  },
  {
    "protocol": "launch",
    "allowed_origins": [
      "http://clinic:3000",
      "http://192.168.100.2:3000",
      "http://localhost:3000",
      "http://192.168.100.2:5173",
      "http://localhost:5173"
    ]
  }
]
```

### Security Model

✅ **Origin-based security**: Only approved origins can launch protocols
✅ **No wildcards**: Each origin must be explicitly listed
✅ **No HTTPS required**: HTTP is sufficient for local/internal network apps
✅ **Port-specific**: Each port must be explicitly allowed

---

## Adding New Origins

If you need to add a new origin (e.g., new server IP or port):

### Method 1: Edit Registry File

1. Open `protocol-handlers/registry/register-protocols.reg`
2. Add your new origin to the `allowed_origins` array for each protocol
3. Save the file
4. Right-click → Merge
5. Restart browser

### Method 2: Edit Installer

1. Open `protocol-handlers/INSTALL.bat`
2. Find lines 226 and 236 (Chrome and Edge policies)
3. Add your new origin to the JSON string
4. Save the file
5. Run `INSTALL.bat` as Administrator
6. Restart browser

### Example: Adding `http://192.168.1.100:3000`

Add this to the `allowed_origins` array:
```
"http://192.168.1.100:3000"
```

Full example:
```json
"allowed_origins": [
  "http://clinic:3000",
  "http://192.168.100.2:3000",
  "http://192.168.1.100:3000",    ← NEW
  "http://localhost:3000",
  "http://192.168.100.2:5173",
  "http://localhost:5173"
]
```

---

## Verification Commands

### Check Chrome Policy
```cmd
reg query "HKLM\SOFTWARE\Policies\Google\Chrome" /v AutoLaunchProtocolsFromOrigins
```

### Check Edge Policy
```cmd
reg query "HKLM\SOFTWARE\Policies\Microsoft\Edge" /v AutoLaunchProtocolsFromOrigins
```

### View in Browser
- **Chrome**: Navigate to `chrome://policy`
- **Edge**: Navigate to `edge://policy`
- Search for: `AutoLaunchProtocolsFromOrigins`

---

## Common Scenarios

### Scenario 1: Accessing from Office Network
**Origin**: `http://clinic:3000`
**Status**: ✅ Allowed (default)

### Scenario 2: Accessing from IP Address
**Origin**: `http://192.168.100.2:3000`
**Status**: ✅ Allowed (added in this update)

### Scenario 3: Local Development
**Origin**: `http://localhost:5173`
**Status**: ✅ Allowed (added in this update)

### Scenario 4: Testing Production Build Locally
**Origin**: `http://localhost:3000`
**Status**: ✅ Allowed (added in this update)

### Scenario 5: HTTPS Access
**Origin**: `https://clinic:3000`
**Status**: ❌ Not allowed (HTTPS not configured)
**Fix**: Add HTTPS origins if needed

---

## FAQ

### Q: Why do I need to specify both hostname and IP?
**A**: Browsers treat `http://clinic:3000` and `http://192.168.100.2:3000` as different origins, even if they point to the same server.

### Q: Why both port 3000 and 5173?
**A**: Port 3000 is production (`npm start`), port 5173 is Vite dev server (`npm run dev`). Supporting both allows seamless development workflow.

### Q: Can I use wildcards like `http://*:3000`?
**A**: No, Chrome/Edge policies don't support wildcards for security reasons. Each origin must be explicit.

### Q: Do I need HTTPS?
**A**: Not for local/internal network applications. HTTP is sufficient and simpler.

### Q: What if I access from a different IP?
**A**: Add that IP to the allowed origins list using the methods above.

---

## Summary

✅ **5 allowed origins** (production + development)
✅ **3 protocols** (explorer, csimaging, launch)
✅ **Zero browser prompts** from any allowed origin
✅ **Easy to extend** (add more origins as needed)
✅ **Secure by design** (explicit origin allowlist)

**Last Updated**: 2025-11-22 (Added IP-based and localhost origins)
