# Protocol Handlers

Custom Windows protocol handlers for Shwan Orthodontics Management System.

---

## Overview

| Protocol | Purpose | Usage |
|----------|---------|-------|
| `explorer:` | Open/create folders | `explorer:\\\\Server\\Path` |
| `csimaging:` | Launch CS Imaging with patient | `csimaging:12345?name=John_Doe` |
| `dolphin:` | Launch Dolphin Imaging with patient | `dolphin:12345?name=John_Doe` |
| `launch:` | Universal app launcher | `launch://msaccess?args={AccessDatabase}\|/cmd\|Form` |

---

## Installation

```cmd
Right-click INSTALL.bat → Run as Administrator
```

**Installs:** Handlers to `C:\Windows\`, registry entries, browser policies. **Time:** ~30s. **Restart:** Browser only.

**Uninstall:**
```cmd
Right-click UNINSTALL.bat → Run as Administrator
```

---

## Configuration

**File:** `C:\Windows\ProtocolHandlers.ini`

```ini
[Paths]
PatientsFolder=\\Clinic\clinic1
AccessDatabase=C:\S_O\labels.accdb
DolphinPath=C:\Dolphin\

[Applications]
msaccess=C:\Program Files\Microsoft Office\root\Office16\MSACCESS.EXE
```

**Edit:** `notepad C:\Windows\ProtocolHandlers.ini` (as Admin). Changes apply immediately.

---

## Allowed Origins

**7 origins** configured for no browser prompts:

| Origin | Environment |
|--------|-------------|
| `http://clinic:3000` | Production |
| `http://192.168.100.2:3000` | Production |
| `https://local.shwan-orthodontics.com` | Production (HTTPS) |
| `https://remote.shwan-orthodontics.com` | Production (HTTPS) |
| `http://localhost:3000` | Testing |
| `http://192.168.100.2:5173` | Development |
| `http://localhost:5173` | Development |

**Registry:** `HKLM\SOFTWARE\Policies\{Chrome,Edge}\AutoLaunchProtocolsFromOrigins`

**Add origin:** Edit `registry/register-protocols.reg`, add to all 4 protocol arrays, merge, restart browser.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Browser shows prompt | Close browser (Task Manager), re-run `INSTALL.bat`, restart browser. Force: `gpupdate /force` |
| CS Imaging not found | Install CS Imaging. Verify: `reg query "HKLM\Software\Classes\Trophy" /v InstallDir` |
| Dolphin not found | Edit config: `DolphinPath=C:\Correct\Path\`. Verify `DolCtrl.exe` exists |
| Network share error | Test: `explorer \\Clinic\clinic1`. Update `PatientsFolder` in config |
| Handler not found | Re-run `INSTALL.bat`. Check antivirus. Verify: `dir C:\Windows\*ProtocolHandler.exe` |
| App not found (launch) | Add alias to `[Applications]` section in config (whitelist-only mode, secure) |
| Policy not in browser | Verify registry, re-run `INSTALL.bat`, `gpupdate /force`, restart browser |

**Verify policies:** `chrome://policy` or `edge://policy` → Search `AutoLaunchProtocolsFromOrigins`

---

## Technical

**Files:** `C:\Windows\{Explorer,CSImaging,Dolphin,Universal}ProtocolHandler.exe` + `ProtocolHandlers.ini`

**Registry:** `HKCR\{explorer,csimaging,dolphin,launch}` → handlers

**Requirements:** Windows 10/11, .NET 4.0+, Chrome/Edge

**Source:** `source/*.cs` (C#, no dependencies)

**Compile:** `compile-handlers.ps1` → `INSTALL.bat`

**Verification:**
```cmd
dir C:\Windows\*ProtocolHandler.exe
reg query HKCR\explorer
reg query "HKLM\SOFTWARE\Policies\Google\Chrome" /v AutoLaunchProtocolsFromOrigins
```

**Upgrade:** Re-run `INSTALL.bat` (preserves config)

---

## Protocol Details

### Universal Launcher (`launch:`)

**Features:** Application aliases only (whitelist-only, secure), variable substitution (`{AccessDatabase}`, `{PatientsFolder}`), multiple args via `|`, `/cmd` switch handling.

**Example:**
```javascript
// Alias with variables
launch://msaccess?args={AccessDatabase}|/cmd|frmLabels|ID=123
```

**Security:** Only applications defined in `[Applications]` section can be launched. Full paths are not supported (hardened security).

### Dolphin Imaging (`dolphin:`)

**Process:** Reads `DolphinPath` from config → Writes `{DolphinPath}\Dolphin.ini` with `CaptureFromFilePath={PatientsFolder}\{PatientID}\` → Launches `DolCtrl.exe {PatientID}`

### CS Imaging (`csimaging:`)

**Process:** Reads CS Imaging path from registry → Constructs OPG path `{PatientsFolder}\{PatientID}\OPG` → Creates folder if needed → Launches CS Imaging

**Requires:** CS Imaging Trophy installed with registry key `HKLM\Software\Classes\Trophy\InstallDir`

---

**Last Updated:** 2025-12-05 (Added HTTPS domains)
