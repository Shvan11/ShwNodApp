# Protocol Handlers Configuration Guide

## Overview

The protocol handlers use a **single configuration file** located at:
```
C:\Windows\ProtocolHandlers.ini
```

This is the **single source of truth** for all configuration. No environment variables, no registry lookups, no fallbacks.

---

## Configuration File Format

The configuration file uses standard INI format:

```ini
[Paths]
PatientsFolder=\\Clinic\clinic1
```

### Supported Settings

| Setting | Description | Example |
|---------|-------------|---------|
| `PatientsFolder` | Base path where patient folders are stored | `\\Clinic\clinic1` |
| `DolphinPath` | Dolphin Imaging installation directory | `C:\Dolphin\` |

---

## How to Change Configuration

### Method 1: Edit with Notepad (Recommended)

1. **Open Notepad as Administrator**
   - Press `Win + S`
   - Type "Notepad"
   - Right-click → "Run as administrator"

2. **Open the config file**
   - File → Open
   - Navigate to: `C:\Windows\ProtocolHandlers.ini`
   - Change "Text Documents" to "All Files" if needed

3. **Edit the path**
   ```ini
   [Paths]
   PatientsFolder=\\YourServer\YourPath
   ```

4. **Save the file**
   - File → Save
   - Close Notepad

5. **Done!**
   - No restart needed
   - Changes take effect immediately
   - Next protocol launch will use new path

### Method 2: Edit from Command Line

```cmd
notepad C:\Windows\ProtocolHandlers.ini
```

---

## During Installation

### First Install
When you run `INSTALL.bat` for the first time:
- Creates `C:\Windows\ProtocolHandlers.ini` with default settings
- Default path: `\\Clinic\clinic1`

### Subsequent Installs
When you run `INSTALL.bat` again:
- **Preserves existing configuration**
- Does NOT overwrite your settings
- Only updates the .exe files if they changed

---

## Configuration Examples

### Example 1: Network Share
```ini
[Paths]
PatientsFolder=\\Clinic\clinic1
```

### Example 2: Different Server
```ini
[Paths]
PatientsFolder=\\WORK_PC\patients
```

### Example 3: Local Path
```ini
[Paths]
PatientsFolder=C:\PatientData
```

### Example 4: Multiple Machines (Different Config Per Machine)
Each machine can have its own config:

**Machine 1** (`C:\Windows\ProtocolHandlers.ini`):
```ini
[Paths]
PatientsFolder=\\Clinic\clinic1
```

**Machine 2** (`C:\Windows\ProtocolHandlers.ini`):
```ini
[Paths]
PatientsFolder=\\BackupServer\clinic1
```

---

## How CS Imaging Uses Configuration

When you click "CS Imaging" in the patient sidebar:

1. Protocol handler reads `C:\Windows\ProtocolHandlers.ini`
2. Extracts `PatientsFolder` value
3. Constructs OPG path: `{PatientsFolder}\{PatientID}\OPG`
4. Example: `\\Clinic\clinic1\12345\OPG`
5. Launches CS Imaging with this path

---

## How Dolphin Imaging Uses Configuration

When you click "Dolphin Imaging" in More Actions flyout:

1. Protocol handler reads `C:\Windows\ProtocolHandlers.ini`
2. Extracts `DolphinPath` value (e.g., `C:\Dolphin\`)
3. Constructs patient folder: `{PatientsFolder}\{PatientID}\`
4. Writes to `{DolphinPath}\Dolphin.ini`:
   - Section: `[Defaults]`
   - Key: `CaptureFromFilePath`
   - Value: `\\Clinic\clinic1\12345\`
5. Launches `{DolphinPath}\DolCtrl.exe {PatientID}`
6. Dolphin loads with patient folder pre-configured

**Example Configuration**:
```ini
[Paths]
PatientsFolder=\\Clinic\clinic1
DolphinPath=C:\Dolphin\
```

---

## Troubleshooting

### Error: "Configuration file not found"

**Cause**: `C:\Windows\ProtocolHandlers.ini` doesn't exist

**Fix**:
```cmd
Right-click protocol-handlers\INSTALL.bat → Run as Administrator
```

### Error: "Missing PatientsFolder setting"

**Cause**: Config file exists but `PatientsFolder` is not set

**Fix**:
1. Open `C:\Windows\ProtocolHandlers.ini`
2. Add:
   ```ini
   [Paths]
   PatientsFolder=\\Clinic\clinic1
   ```

### Error: "Network share is not accessible"

**Cause**: The path in `PatientsFolder` doesn't exist or is unreachable

**Fix**:
1. Verify network connection
2. Check the path exists: Open Windows Explorer → Type path in address bar
3. Update config with correct path

### Config Changes Not Taking Effect

**Cause**: File saved but protocol still uses old path

**Fix**:
- Config changes are instant - no restart needed
- Verify you saved the file (check file timestamp)
- Verify you edited the correct file: `C:\Windows\ProtocolHandlers.ini`

---

## Security Considerations

### File Location
- Config is in `C:\Windows\` (requires admin access to edit)
- Prevents unauthorized users from changing paths
- Matches security model of .exe files

### Path Validation
- Protocol handlers validate paths before use
- Shows error if network share is unreachable
- Prevents launching with invalid configuration

---

## Migration from Old Setup

If you previously used environment variables:

### Old Method (No Longer Used)
```cmd
setx PATIENTS_FOLDER "\\WORK_PC\clinic1"
```

### New Method (Current)
Edit `C:\Windows\ProtocolHandlers.ini`:
```ini
[Paths]
PatientsFolder=\\Clinic\clinic1
```

**Advantages**:
- ✅ Single source of truth
- ✅ Easy to discover and edit
- ✅ No hidden environment variables
- ✅ Consistent with Windows .ini conventions
- ✅ Changes take effect immediately

---

## Summary

| Aspect | Details |
|--------|---------|
| **Config File** | `C:\Windows\ProtocolHandlers.ini` |
| **Format** | Standard INI |
| **Edit With** | Notepad (as Administrator) |
| **Changes** | Take effect immediately |
| **Installation** | Auto-created by INSTALL.bat |
| **Updates** | Preserved during reinstall |
| **Uninstall** | Removed by UNINSTALL.bat |

---

**Remember**: This is the ONLY place configuration is stored. No fallbacks, no environment variables, no registry lookups.
