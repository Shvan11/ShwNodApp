# Protocol Handlers for Shwan Orthodontics

**One unified solution for both Explorer and CS Imaging integrations**

---

## 📁 Folder Structure

```
protocol-handlers/
├── source/
│   ├── ExplorerProtocolHandler.cs      # Explorer protocol source
│   └── CSImagingProtocolHandler.cs     # CS Imaging protocol source
├── registry/
│   ├── register-protocols.reg          # Registers both protocols
│   └── unregister-protocols.reg        # Removes both protocols
├── docs/
│   ├── EXPLORER_PROTOCOL.md            # Explorer protocol documentation
│   └── CS_IMAGING_PROTOCOL.md          # CS Imaging protocol documentation
├── compile-handlers.ps1                 # Compiles both handlers
├── INSTALL.bat                          # Unified installer
├── UNINSTALL.bat                        # Unified uninstaller
└── README.md                            # This file
```

---

## 🚀 Quick Start

### Installation (One Command):

```cmd
Right-click INSTALL.bat → Run as Administrator
```

**That's it!** The installer will:
1. ✅ Compile both protocol handlers
2. ✅ Create configuration file (ProtocolHandlers.ini)
3. ✅ Copy executables to C:\Windows\
4. ✅ Register protocols in Windows registry
5. ✅ Configure browser to auto-launch (no prompts)
6. ✅ Verify installation

### Uninstallation:

```cmd
Right-click UNINSTALL.bat → Run as Administrator
```

---

## 🎯 What Gets Installed

### 1. Explorer Protocol (`explorer:`)

**Purpose**: Open/create folders on network shares

**Usage**: Click "Open Folder" button on aligner sets

**Features**:
- Opens existing folders instantly
- Creates folders if they don't exist (with confirmation)
- Checks network share accessibility first
- Works with UNC paths: `\\WORK_PC\Aligner_Sets\...`

**Example**:
```javascript
window.location.href = 'explorer:\\\\WORK_PC\\Aligner_Sets\\5\\John_Doe\\1';
```

---

### 2. CS Imaging Protocol (`csimaging:`)

**Purpose**: Launch CS Imaging Trophy software with patient X-rays

**Usage**: Click "CS Imaging" button in patient sidebar

**Features**:
- Reads TW.EXE path from registry automatically
- Reads configuration from `C:\Windows\ProtocolHandlers.ini`
- Constructs OPG folder path: `{PatientsFolder}\{PatientID}\OPG`
- Creates OPG folder if needed (with confirmation)
- Launches CS Imaging with patient data

**Example**:
```javascript
window.location.href = 'csimaging:12345?name=John_Doe';
```

---

## 🔧 How It Works

### Architecture:

```
[Web Application]
        │
        │ User clicks button
        ▼
[JavaScript Handler]
        │
        │ Constructs protocol URL
        │ (explorer: or csimaging:)
        ▼
[Browser]
        │
        │ Checks AutoLaunchProtocolsFromOrigins policy
        │ (no prompt due to policy)
        ▼
[Windows Registry]
        │
        │ Routes to appropriate handler
        ▼
[Protocol Handler .exe]
        │
        ├─► ExplorerProtocolHandler.exe → Opens/creates folders
        └─► CSImagingProtocolHandler.exe → Launches CS Imaging
```

### Browser Configuration:

The installer sets this registry policy:

```json
AutoLaunchProtocolsFromOrigins = [
  {"protocol": "explorer", "allowed_origins": ["http://clinic:3000"]},
  {"protocol": "csimaging", "allowed_origins": ["http://clinic:3000"]}
]
```

**Result**: No browser prompts when launching protocols from your domain!

---

## ⚙️ Configuration

### Configuration File

**Location**: `C:\Windows\ProtocolHandlers.ini`

**Format**:
```ini
[Paths]
PatientsFolder=\\Clinic\clinic1
```

This is the **single source of truth** for all configuration.

### How to Change Configuration:

1. Open Notepad as Administrator
2. Open `C:\Windows\ProtocolHandlers.ini`
3. Edit the `PatientsFolder` path
4. Save the file
5. **Done!** Changes take effect immediately

**See**: [CONFIGURATION.md](CONFIGURATION.md) for detailed configuration guide

### CS Imaging Requirements:

1. CS Imaging Trophy software must be installed
2. Registry key must exist:
   ```
   HKEY_LOCAL_MACHINE\Software\Classes\Trophy\InstallDir
   ```

---

## 🔄 Re-running the Installer

**The installer is safe to run multiple times!**

It intelligently:
- ✅ Preserves existing configuration (doesn't overwrite ProtocolHandlers.ini)
- ✅ Checks if files are identical (skips copy if same)
- ✅ Updates files only if different
- ✅ Never creates duplicate registry entries
- ✅ Always verifies installation

**Use cases**:
- After updating handler source code
- After reinstalling CS Imaging (path may change)
- To verify installation integrity
- After Windows updates

**Note**: Configuration file (`ProtocolHandlers.ini`) is preserved during reinstall!

---

## 🧪 Testing

### Test Explorer Protocol:

1. Go to aligner sets page
2. Click "Open Folder" on any set
3. Should open/create folder with NO browser prompt

### Test CS Imaging Protocol:

1. Go to patient details page
2. Click "CS Imaging" in sidebar
3. Should launch CS Imaging with patient X-rays (NO prompt)

### Browser Policy Verification:

**Chrome**: Navigate to `chrome://policy`
- Look for: `AutoLaunchProtocolsFromOrigins`
- Should show both protocols

**Edge**: Navigate to `edge://policy`
- Look for: `AutoLaunchProtocolsFromOrigins`
- Should show both protocols

---

## 🐛 Troubleshooting

### "Browser still shows prompt"

**Cause**: Registry policy not applied or browser not restarted

**Fix**:
1. Close browser COMPLETELY (check Task Manager)
2. Re-run `INSTALL.bat` as Administrator
3. Restart browser
4. Check browser policy (chrome://policy or edge://policy)

---

### "CS Imaging not found"

**Cause**: CS Imaging not installed or registry incorrect

**Fix**:
1. Install CS Imaging Trophy software
2. Verify registry:
   ```cmd
   reg query "HKLM\Software\Classes\Trophy" /v InstallDir
   ```
3. If wrong, update registry or reinstall CS Imaging

---

### "Network share not accessible"

**Cause**: Network path wrong or not accessible

**Fix**:
1. Test path manually:
   ```cmd
   explorer \\WORK_PC\clinic1
   ```
2. Check network connection
3. Verify share permissions
4. Set `PATIENTS_FOLDER` environment variable

---

### "Handler executable not found"

**Cause**: Files not copied to C:\Windows\

**Fix**:
1. Re-run `INSTALL.bat` as Administrator
2. Check antivirus (may block copy to C:\Windows\)
3. Verify files exist:
   ```cmd
   dir C:\Windows\*ProtocolHandler.exe
   ```

---

## 📋 Manual Installation (Advanced)

If automated installer fails:

### 1. Compile Handlers:
```powershell
.\compile-handlers.ps1
```

### 2. Copy to Windows:
```cmd
copy ExplorerProtocolHandler.exe C:\Windows\
copy CSImagingProtocolHandler.exe C:\Windows\
```

### 3. Register Protocols:
```cmd
reg import registry\register-protocols.reg
```

### 4. Restart Browser

---

## 🗑️ Complete Removal

The uninstaller removes:
- ✅ Both .exe files from C:\Windows\
- ✅ All registry protocol entries
- ✅ Browser auto-launch policies
- ✅ CS Imaging cache files

**Verification**:
```cmd
dir C:\Windows\*ProtocolHandler.exe
reg query HKCR\explorer
reg query HKCR\csimaging
```

All should return "not found"

---

## 🔐 Security

### What Gets Registered:

**Windows Registry**:
- `HKEY_CLASSES_ROOT\explorer` - Protocol definition
- `HKEY_CLASSES_ROOT\csimaging` - Protocol definition
- `HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Google\Chrome` - Browser policy
- `HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\Edge` - Browser policy

### Files Installed:

- `C:\Windows\ExplorerProtocolHandler.exe` (Digitally unsigned)
- `C:\Windows\CSImagingProtocolHandler.exe` (Digitally unsigned)

### Security Notes:

✅ **No shell injection** - Uses ProcessStartInfo with argument array
✅ **Path validation** - Checks paths before executing
✅ **User confirmation** - Asks before creating folders
✅ **Clear error messages** - Users know what's happening
✅ **Domain-restricted** - Only works from http://clinic:3000

---

## 📊 Technical Specifications

### Protocols:

| Protocol | Handler | Purpose | Registry Read? | Network Access? |
|----------|---------|---------|----------------|-----------------|
| `explorer:` | ExplorerProtocolHandler.exe | Open/create folders | No | Yes |
| `csimaging:` | CSImagingProtocolHandler.exe | Launch CS Imaging | Yes (1-5ms) | Yes |

### Performance:

- **Registry read**: ~1-5ms (fast enough, no caching needed)
- **Folder creation**: Depends on network speed
- **Total launch time**: ~50-100ms (dominated by application startup)

### Compatibility:

- ✅ Windows 10/11
- ✅ Chrome (with policy)
- ✅ Edge (with policy)
- ✅ .NET Framework 4.0+
- ✅ Network shares (UNC paths)
- ✅ Local drives

---

## 🆘 Support

### Common Issues:

1. **Permission denied** → Run as Administrator
2. **Browser prompts** → Check chrome://policy
3. **Handler not found** → Re-run installer
4. **Network path wrong** → Set PATIENTS_FOLDER env var

### Debug Steps:

1. Check files exist: `dir C:\Windows\*ProtocolHandler.exe`
2. Check registry: `reg query HKCR\explorer`
3. Check browser policy: `chrome://policy`
4. Test manually: Open Command Prompt, run handler directly

### Logs:

Handlers show error dialogs when issues occur. No log files are created.

---

## 📝 Development

### Modifying Handlers:

1. Edit source files in `source/` folder
2. Run `compile-handlers.ps1`
3. Run `INSTALL.bat` to update
4. Test changes

### Source Code:

- **ExplorerProtocolHandler.cs**: ~120 lines
- **CSImagingProtocolHandler.cs**: ~250 lines
- Both use standard Windows APIs (no external dependencies)

---

## ✅ Installation Checklist

After running `INSTALL.bat`, verify:

- [ ] `C:\Windows\ExplorerProtocolHandler.exe` exists
- [ ] `C:\Windows\CSImagingProtocolHandler.exe` exists
- [ ] Registry key `HKCR\explorer` exists
- [ ] Registry key `HKCR\csimaging` exists
- [ ] Chrome policy shows `AutoLaunchProtocolsFromOrigins`
- [ ] Edge policy shows `AutoLaunchProtocolsFromOrigins`
- [ ] "Open Folder" button works (no prompt)
- [ ] "CS Imaging" button works (no prompt)

---

## 📚 Additional Documentation

See `docs/` folder for detailed protocol-specific documentation:

- `EXPLORER_PROTOCOL.md` - Explorer protocol implementation details
- `CS_IMAGING_PROTOCOL.md` - CS Imaging integration guide

---

## 🎉 Summary

This unified solution provides:

✅ **Two protocols** in one installation
✅ **No browser prompts** thanks to AutoLaunchProtocolsFromOrigins
✅ **Safe to re-run** - intelligent update mechanism
✅ **Clean uninstall** - removes everything
✅ **Production-ready** - error handling, user feedback
✅ **Well-documented** - comprehensive guides

**Install once, works forever!**

Run `INSTALL.bat` and you're done. 🚀
