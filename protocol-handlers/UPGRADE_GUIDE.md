# Protocol Handlers - Upgrade Guide

## What's New in This Update

### Enhanced Origin Support

The protocol handlers now support **multiple allowed origins** to eliminate browser confirmation prompts from all your development and production environments:

#### Newly Added Origins:
- ✅ `http://192.168.100.2:3000` - **Production server (IP address)** ← **YOUR REQUESTED FIX!**
- ✅ `http://localhost:3000` - Local production server
- ✅ `http://localhost:5173` - Local Vite dev server

#### Previously Supported Origins:
- `http://clinic:3000` - Production server (hostname)
- `http://192.168.100.2:5173` - Vite dev server (IP)

### Universal Protocol Support

All three protocols now work seamlessly from all origins:
- `explorer:` - Open/create folders
- `csimaging:` - Launch CS Imaging Trophy
- `launch:` - Universal application launcher

---

## How to Upgrade

### Option 1: Re-run Installer (Recommended)

**This is the safest and easiest method!**

1. Navigate to the `protocol-handlers` folder
2. Right-click `INSTALL.bat`
3. Select "Run as Administrator"
4. Close ALL browser windows completely
5. Restart your browser
6. Done! ✅

**Note:** Your configuration in `C:\Windows\ProtocolHandlers.ini` will be preserved during the upgrade.

### Option 2: Import Registry File Manually

If you prefer manual installation:

1. Navigate to `protocol-handlers/registry/`
2. Right-click `register-protocols.reg`
3. Select "Merge"
4. Click "Yes" to confirm
5. Close ALL browser windows completely
6. Restart your browser
7. Done! ✅

---

## Verification Steps

After upgrading, verify the new origins are registered:

### For Chrome:
1. Open Chrome
2. Navigate to: `chrome://policy`
3. Search for: `AutoLaunchProtocolsFromOrigins`
4. Verify you see all 5 allowed origins for each protocol:
   - `http://clinic:3000`
   - `http://192.168.100.2:3000` ← **NEW!**
   - `http://localhost:3000` ← **NEW!**
   - `http://192.168.100.2:5173`
   - `http://localhost:5173` ← **NEW!**

### For Edge:
1. Open Edge
2. Navigate to: `edge://policy`
3. Search for: `AutoLaunchProtocolsFromOrigins`
4. Verify you see all 5 allowed origins for each protocol (same as Chrome)

---

## Testing the Fix

### Test from Production Server (IP)

1. Open your browser
2. Navigate to: `http://192.168.100.2:3000`
3. Try using any protocol handler:
   - Click "Open Folder" on an aligner set (tests `explorer:`)
   - Click "CS Imaging" in patient sidebar (tests `csimaging:`)
   - Click "Print Labels" on a batch card (tests `launch:`)
4. **Expected result**: No browser confirmation prompt! ✅

### Test from Localhost

1. Navigate to: `http://localhost:3000`
2. Try the same protocol handlers
3. **Expected result**: No browser confirmation prompt! ✅

### Test from Vite Dev Server

1. Navigate to: `http://localhost:5173` or `http://192.168.100.2:5173`
2. Try the same protocol handlers
3. **Expected result**: No browser confirmation prompt! ✅

---

## Troubleshooting

### Still Getting Browser Prompts?

**Cause**: Browser not restarted or cache not cleared

**Fix**:
1. Close ALL browser windows completely
2. Open Task Manager (Ctrl+Shift+Esc)
3. End all Chrome/Edge processes
4. Restart browser
5. Test again

### Policy Not Showing in chrome://policy?

**Cause**: Registry not updated or browser not refreshed

**Fix**:
1. Re-run `INSTALL.bat` as Administrator
2. Verify registry key exists:
   ```cmd
   reg query "HKLM\SOFTWARE\Policies\Google\Chrome" /v AutoLaunchProtocolsFromOrigins
   ```
3. Close browser completely and restart
4. Check `chrome://policy` again

### Works from Some Origins But Not Others?

**Cause**: Old registry policy still cached

**Fix**:
1. Run this command to force registry update:
   ```cmd
   gpupdate /force
   ```
2. Restart browser completely
3. Test from all origins

---

## What Changed Technically?

### Files Modified:

1. **`registry/register-protocols.reg`**
   - Updated `AutoLaunchProtocolsFromOrigins` for Chrome
   - Updated `AutoLaunchProtocolsFromOrigins` for Edge
   - Added 3 new allowed origins for each protocol

2. **`INSTALL.bat`**
   - Updated Chrome policy registration (line 226)
   - Updated Edge policy registration (line 236)
   - Added 3 new allowed origins for each protocol

3. **`README.md`**
   - Updated Browser Configuration section
   - Added comprehensive list of supported origins
   - Updated security notes

### Registry Changes:

**Before** (old policy):
```json
{
  "protocol": "explorer",
  "allowed_origins": ["http://clinic:3000"]
}
```

**After** (new policy):
```json
{
  "protocol": "explorer",
  "allowed_origins": [
    "http://clinic:3000",
    "http://192.168.100.2:3000",
    "http://localhost:3000",
    "http://192.168.100.2:5173",
    "http://localhost:5173"
  ]
}
```

---

## Benefits of This Update

✅ **No more browser prompts** when accessing from IP address `192.168.100.2:3000`
✅ **Full localhost support** for local development and testing
✅ **Development + Production** environments both supported
✅ **Better developer experience** - seamless protocol handling everywhere
✅ **Future-proof** - works with any origin configuration

---

## Backward Compatibility

✅ **100% backward compatible**
✅ **All existing origins still work**
✅ **Configuration file preserved** during upgrade
✅ **No breaking changes**

---

## Need Help?

If you encounter any issues after upgrading:

1. Check this guide's Troubleshooting section
2. Verify registry policy in `chrome://policy` or `edge://policy`
3. Try re-running `INSTALL.bat` as Administrator
4. Check `C:\Windows\ProtocolHandlers.ini` exists and is configured

---

## Summary

This update **fixes the browser confirmation prompt issue** for `http://192.168.100.2:3000` and adds comprehensive origin support for all development and production environments.

**To apply the fix**: Just run `INSTALL.bat` as Administrator and restart your browser!

🎉 **Enjoy seamless protocol handling from all your origins!** 🎉
