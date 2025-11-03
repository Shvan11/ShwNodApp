# ✅ Universal Protocol Handler - IMPLEMENTATION COMPLETE

## 🎉 Summary

The Universal Protocol Handler (`launch://`) has been successfully implemented and integrated into your clinic management system. This allows you to launch **any Windows application** with complex arguments directly from the web interface.

---

## 📦 What Was Created/Updated

### 1. **Core Handler**
- **File**: `protocol-handlers/source/UniversalProtocolHandler.cs`
- **Features**:
  - Launch any executable by alias or full path
  - Parse complex pipe-separated arguments
  - Variable substitution from INI file (`{AccessDatabase}`, `{PatientsFolder}`)
  - Optional whitelist security mode
  - Automatic argument quoting for paths with spaces

### 2. **Configuration**
- **File**: `protocol-handlers/ProtocolHandlers.ini`
- **New Sections**:
  - `[Applications]` - Application aliases (msaccess, excel, word, notepad, etc.)
  - `[Security]` - UseWhitelist toggle
  - `[Paths]` - AccessDatabase path variable

### 3. **Installation System**
- **Updated**: `protocol-handlers/INSTALL.bat`
  - Compiles UniversalProtocolHandler.exe
  - Registers `launch://` protocol
  - Adds to browser auto-launch policy (no prompts)
- **Updated**: `protocol-handlers/UNINSTALL.bat`
  - Removes universal protocol handler
  - Cleans up registry and files
- **Updated**: `protocol-handlers/compile-handlers.ps1`
  - Compiles all three handlers (Explorer, CS Imaging, Universal)

### 4. **Frontend Integration**
- **New**: `public/js/services/UniversalLauncher.js`
  - Clean JavaScript API for launching applications
  - Helper methods: `printAlignerLabels()`, `openExcel()`, `openWord()`, etc.
- **Updated**: `public/js/pages/aligner/PatientSets.jsx`
  - Added "Print Labels" button to batch cards
  - Launches MS Access with batch ID, patient name, and doctor ID
  - Purple print icon in batch actions

### 5. **Documentation**
- **New**: `protocol-handlers/docs/UNIVERSAL_PROTOCOL.md`
  - Complete usage guide
  - Examples for common scenarios
  - Troubleshooting section
  - API reference

---

## 🚀 How to Install

1. **Navigate to protocol-handlers folder**
   ```cmd
   cd C:\path\to\ShwNodApp\protocol-handlers
   ```

2. **Run installer as Administrator**
   ```cmd
   Right-click INSTALL.bat → Run as Administrator
   ```

3. **Verify installation**
   - Check output shows all 3 handlers compiled
   - Verify `launch://` protocol registered
   - Browser policy configured

4. **Update INI file (if needed)**
   - Open `C:\Windows\ProtocolHandlers.ini`
   - Set `AccessDatabase=C:\YourPath\labels.accdb`
   - Verify Microsoft Office paths in `[Applications]`

5. **Restart browser**
   - Close all Chrome/Edge windows
   - Reopen application

---

## 💡 Usage Examples

### From JavaScript (Web App)

**Print Labels from Aligner Batch:**
```javascript
import UniversalLauncher from '/js/services/UniversalLauncher.js';

// Simple method
UniversalLauncher.printAlignerLabels(193, 'Sibar Fathil', 1);

// Or manually
UniversalLauncher.launch('msaccess', [
  '{AccessDatabase}',
  '/cmd',
  'frmLabels',
  'AlignerBatchID = 193',
  'Sibar Fathil',
  '1'
]);
```

**Launch Excel:**
```javascript
UniversalLauncher.openExcel('C:\\Reports\\monthly.xlsx');
```

**Launch Notepad:**
```javascript
UniversalLauncher.openNotepad('C:\\temp\\notes.txt');
```

### From Browser URL Bar (Testing)

```
launch://msaccess?args={AccessDatabase}%7C/cmd%7CfrmLabels
launch://notepad?args=C:\temp\file.txt
launch://excel?args=\\server\share\report.xlsx
```

---

## 🎯 Your Specific Use Case: Print Aligner Labels

### What Happens

1. User clicks **"Print Labels"** button on batch card (purple print icon)
2. JavaScript calls `UniversalLauncher.printAlignerLabels(batchId, patientName, drId)`
3. Protocol handler launched: `launch://msaccess?args=...`
4. Handler reads `{AccessDatabase}` from INI → `C:\S_O\labels.accdb`
5. Builds command: `MSACCESS.EXE "C:\S_O\labels.accdb" /cmd frmLabels "AlignerBatchID = 193" "Sibar Fathil" 1`
6. MS Access opens with label form and parameters

### Button Location

- **Page**: Aligner Patient Sets (`/aligner/patient/:workId`)
- **Location**: Batch card actions (alongside Edit, Delete buttons)
- **Color**: Purple background with white print icon
- **Tooltip**: "Print Labels in MS Access"

### Parameters Passed

| Parameter | Source | Example |
|-----------|--------|---------|
| `batchId` | `batch.AlignerBatchID` | `193` |
| `patientName` | `patient.patientname` | `Sibar Fathil` |
| `drId` | `set.DoctorID` | `1` |

---

## 📁 File Structure

```
protocol-handlers/
├── source/
│   ├── ExplorerProtocolHandler.cs       (Existing)
│   ├── CSImagingProtocolHandler.cs      (Existing)
│   └── UniversalProtocolHandler.cs      ⭐ NEW
│
├── docs/
│   ├── EXPLORER_PROTOCOL.md
│   ├── CS_IMAGING_PROTOCOL.md
│   └── UNIVERSAL_PROTOCOL.md             ⭐ NEW
│
├── registry/
│   ├── register-protocols.reg           (Not updated, INSTALL.bat handles it)
│   └── unregister-protocols.reg         (Not updated, UNINSTALL.bat handles it)
│
├── ProtocolHandlers.ini                  ✏️ UPDATED (new sections)
├── compile-handlers.ps1                  ✏️ UPDATED (3 handlers)
├── INSTALL.bat                           ✏️ UPDATED (universal handler)
├── UNINSTALL.bat                         ✏️ UPDATED (universal handler)
├── README.md
├── INSTALLATION_GUIDE.txt
└── UNIVERSAL_PROTOCOL_COMPLETE.md        ⭐ NEW (this file)
```

```
public/js/
└── services/
    └── UniversalLauncher.js              ⭐ NEW

public/js/pages/aligner/
└── PatientSets.jsx                       ✏️ UPDATED (print button)
```

---

## 🔧 Configuration Reference

### C:\Windows\ProtocolHandlers.ini

```ini
[Paths]
PatientsFolder=\\Clinic\clinic1
AccessDatabase=C:\S_O\labels.accdb      ⭐ NEW

[Applications]
msaccess=C:\Program Files\Microsoft Office\root\Office16\MSACCESS.EXE
excel=C:\Program Files\Microsoft Office\root\Office16\EXCEL.EXE
word=C:\Program Files\Microsoft Office\root\Office16\WINWORD.EXE
powerpoint=C:\Program Files\Microsoft Office\root\Office16\POWERPNT.EXE
notepad=C:\Windows\System32\notepad.exe
calc=C:\Windows\System32\calc.exe
mspaint=C:\Windows\System32\mspaint.exe

[Security]
UseWhitelist=false                       ⭐ NEW
```

### Registry

```
HKEY_CLASSES_ROOT\
  └── launch\
      ├── (Default) = "URL:Universal Application Launcher"
      ├── URL Protocol = ""
      └── shell\open\command\
          └── (Default) = "C:\Windows\UniversalProtocolHandler.exe" "%1"
```

### Browser Policy

```
HKLM\SOFTWARE\Policies\Google\Chrome\
  └── AutoLaunchProtocolsFromOrigins = [..., {"protocol": "launch", "allowed_origins": ["http://clinic:3000"]}]

HKLM\SOFTWARE\Policies\Microsoft\Edge\
  └── AutoLaunchProtocolsFromOrigins = [..., {"protocol": "launch", "allowed_origins": ["http://clinic:3000"]}]
```

---

## ✅ Testing Checklist

After installation, verify:

- [ ] INSTALL.bat ran without errors
- [ ] All 3 handlers compiled successfully
- [ ] Files exist: `C:\Windows\UniversalProtocolHandler.exe`
- [ ] Registry key: `HKCR\launch\shell\open\command`
- [ ] Browser policy includes `launch` protocol
- [ ] Browser restarted
- [ ] INI file has correct `AccessDatabase` path
- [ ] Print Labels button appears on batch cards (purple)
- [ ] Clicking Print Labels opens MS Access (no browser prompt)
- [ ] Correct parameters passed to Access form

---

## 🐛 Troubleshooting

### Protocol doesn't launch

1. **Check registry:**
   ```cmd
   reg query "HKCR\launch\shell\open\command"
   ```
   Should show: `"C:\Windows\UniversalProtocolHandler.exe" "%1"`

2. **Check browser policy:**
   - Chrome: `chrome://policy`
   - Edge: `edge://policy`
   - Search for: `AutoLaunchProtocolsFromOrigins`
   - Verify: `"protocol": "launch"` is present

3. **Restart browser completely**
   - Close all windows
   - Kill process in Task Manager if needed
   - Reopen

### Application not found

```
Error: Application alias not found: msaccess
```

**Fix:** Add to `C:\Windows\ProtocolHandlers.ini`:
```ini
[Applications]
msaccess=C:\Program Files\Microsoft Office\root\Office16\MSACCESS.EXE
```

**Note:** Office path may vary:
- Office 365/2019+: `C:\Program Files\Microsoft Office\root\Office16\`
- Office 2016: `C:\Program Files (x86)\Microsoft Office\Office16\`
- Office 2013: `C:\Program Files (x86)\Microsoft Office\Office15\`

### Wrong database path

If Access opens but can't find database:

1. Open `C:\Windows\ProtocolHandlers.ini`
2. Update:
   ```ini
   [Paths]
   AccessDatabase=C:\YourActualPath\labels.accdb
   ```
3. No restart needed (reads INI on each launch)

### Browser still shows prompt

1. **Re-run INSTALL.bat as Administrator**
2. **Check policy applied:**
   - Open `chrome://policy` or `edge://policy`
   - Click "Reload policies"
   - Verify `AutoLaunchProtocolsFromOrigins` includes `launch`
3. **Try Incognito/Private mode** (should still work)
4. **Check Windows Security** (may block protocol handlers)

---

## 🔒 Security Notes

### Current Configuration

- **UseWhitelist**: `false` (allows full executable paths)
- **Browser Origin**: Restricted to `http://clinic:3000`
- **No external validation** of arguments

### Recommendations

**For Production:**
```ini
[Security]
UseWhitelist=true
```

**Benefits:**
- Only predefined applications can be launched
- Prevents arbitrary code execution
- Audit trail in INI file

**Trade-off:**
- Must add new apps to INI manually
- Less flexible for ad-hoc needs

### Best Practices

1. **Keep INI updated** - Remove unused applications
2. **Audit regularly** - Review `[Applications]` section
3. **Restrict browser origin** - Only your clinic domain
4. **Don't expose publicly** - Internal network only
5. **Log launches** (optional) - Add logging to C# handler if needed

---

## 📈 Future Enhancements

### Potential Additions

1. **Logging System**
   - Log all protocol launches to file
   - Track user, timestamp, application, arguments
   - Useful for auditing and troubleshooting

2. **More Helpers**
   - `UniversalLauncher.openPatientReport()`
   - `UniversalLauncher.exportToWord()`
   - `UniversalLauncher.printDocument()`

3. **Error Handling**
   - Return success/failure status
   - Show user-friendly error messages
   - Retry logic for locked files

4. **Batch Operations**
   - Print labels for multiple batches at once
   - Queue commands if application already running

5. **More Office Automation**
   - PowerPoint presentations
   - Outlook email composition
   - Excel macros with parameters

---

## 🎓 Technical Details

### Argument Parsing

**Input:** `launch://msaccess?args=C:\db.accdb|/cmd|frmMain|ID=123`

**Processing:**
1. URL decode: `C:\db.accdb|/cmd|frmMain|ID=123`
2. Variable substitution: `{AccessDatabase}` → `C:\S_O\labels.accdb`
3. Split by pipe: `['C:\S_O\labels.accdb', '/cmd', 'frmMain', 'ID=123']`
4. Quote spaces: `["C:\S_O\labels.accdb", "/cmd", "frmMain", "ID=123"]`
5. Build command line: `C:\...\MSACCESS.EXE "C:\S_O\labels.accdb" /cmd frmMain "ID=123"`

### Why Pipe Separator?

- **Commas** - Common in values (e.g., "Last, First")
- **Semicolons** - Used in file paths
- **Spaces** - Need to be preserved
- **Pipes** - Rare in typical arguments, easy to URL-encode

### Variable Substitution Order

1. Check `[Paths]` section first
2. If not found, check `[Applications]` section
3. If still not found, leave as-is (literal)

### Quoting Rules

- Arguments with spaces → Automatically quoted
- Already quoted arguments → Not double-quoted
- Paths with backslashes → Preserved correctly

---

## 📞 Support & Maintenance

### Configuration File Location

```
C:\Windows\ProtocolHandlers.ini
```

**To Edit:**
1. Right-click Notepad → Run as Administrator
2. File → Open → `C:\Windows\ProtocolHandlers.ini`
3. Make changes
4. Save (no restart needed)

### Reinstalling

If handler stops working:

```cmd
cd C:\path\to\ShwNodApp\protocol-handlers
Right-click INSTALL.bat → Run as Administrator
```

**Safe to run multiple times** - Installer is idempotent.

### Uninstalling

```cmd
cd C:\path\to\ShwNodApp\protocol-handlers
Right-click UNINSTALL.bat → Run as Administrator
Type: YES
```

**This removes:**
- All handler executables
- All registry entries
- Browser policies
- Configuration file

---

## ✨ Summary of Capabilities

You can now:

✅ **Launch MS Access** with complex `/cmd` parameters
✅ **Print aligner labels** directly from batch cards
✅ **Pass patient name and doctor ID** to Access forms
✅ **Use configuration variables** (`{AccessDatabase}`)
✅ **Launch any Office application** (Excel, Word, PowerPoint)
✅ **Open files in any program** with custom arguments
✅ **No browser prompts** (AutoLaunchProtocolsFromOrigins)
✅ **Clean JavaScript API** (UniversalLauncher service)
✅ **Optional security whitelist** (production-ready)

---

## 🎊 You're All Set!

The Universal Protocol Handler is now fully integrated into your system. The "Print Labels" button on batch cards will launch MS Access with the correct parameters.

**Next Steps:**
1. Run INSTALL.bat (if not done already)
2. Update AccessDatabase path in INI
3. Test print labels button
4. Enjoy seamless desktop integration!

**Need Help?**
- Documentation: `protocol-handlers/docs/UNIVERSAL_PROTOCOL.md`
- Troubleshooting: See section above
- Configuration: `C:\Windows\ProtocolHandlers.ini`

---

**Happy Launching! 🚀**
