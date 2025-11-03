# Universal Protocol Handler (launch://)

## Overview

The Universal Protocol Handler allows you to launch **any application** with custom arguments from your web application, without creating separate protocol handlers for each program.

## Features

- Launch any executable with custom arguments
- Use application aliases from INI configuration
- Support for complex argument patterns (pipes, spaces, quotes)
- INI variable substitution (`{AccessDatabase}`, `{PatientsFolder}`)
- Optional whitelist security mode
- No browser prompts (configured via AutoLaunchProtocolsFromOrigins)

---

## Installation

The Universal Protocol Handler is installed alongside Explorer and CS Imaging protocols:

```cmd
Right-click protocol-handlers/INSTALL.bat → Run as Administrator
```

This will:
1. Compile `UniversalProtocolHandler.exe`
2. Copy to `C:\Windows\`
3. Register `launch://` protocol
4. Configure browser auto-launch policy

---

## Configuration

Edit `C:\Windows\ProtocolHandlers.ini`:

### Application Aliases

```ini
[Applications]
msaccess=C:\Program Files\Microsoft Office\root\Office16\MSACCESS.EXE
excel=C:\Program Files\Microsoft Office\root\Office16\EXCEL.EXE
word=C:\Program Files\Microsoft Office\root\Office16\WINWORD.EXE
notepad=C:\Windows\System32\notepad.exe

# Add your own
myapp=C:\CustomApps\MyApplication.exe
```

### Path Variables

```ini
[Paths]
PatientsFolder=\\Clinic\clinic1
AccessDatabase=C:\S_O\labels.accdb
```

### Security

```ini
[Security]
# Set to 'true' to only allow aliases (no full paths)
# Set to 'false' to allow full executable paths
UseWhitelist=false
```

---

## Usage

### Basic Syntax

```
launch://alias?args=arg1|arg2|arg3
launch://C:/full/path/app.exe?args=arg1|arg2|arg3
```

**Key Points:**
- Use **pipe (`|`)** to separate multiple arguments
- Arguments with spaces are automatically quoted
- URL-encode special characters

---

## Examples

### 1. Launch MS Access with Database

**Using alias:**
```javascript
window.location.href = 'launch://msaccess?args=C:\\S_O\\labels.accdb';
```

**Using variable:**
```javascript
window.location.href = 'launch://msaccess?args={AccessDatabase}';
```

### 2. Launch MS Access with `/cmd` Parameter

This is your label printing use case:

```javascript
const batchId = 193;
const patientName = 'Sibar Fathil';
const drId = 1;

const args = encodeURIComponent(
  `{AccessDatabase}|/cmd|frmLabels|AlignerBatchID = ${batchId}|${patientName}|${drId}`
);

window.location.href = `launch://msaccess?args=${args}`;
```

**What happens:**
1. `{AccessDatabase}` → replaced with `C:\S_O\labels.accdb` from INI
2. Pipes (`|`) → split into separate arguments
3. Final command:
   ```
   MSACCESS.EXE "C:\S_O\labels.accdb" /cmd frmLabels "AlignerBatchID = 193" "Sibar Fathil" 1
   ```

### 3. Launch Notepad

```javascript
window.location.href = 'launch://notepad?args=C:\\temp\\file.txt';
```

### 4. Launch Excel

```javascript
const filePath = '\\\\Clinic\\clinic1\\reports\\data.xlsx';
const args = encodeURIComponent(filePath);
window.location.href = `launch://excel?args=${args}`;
```

### 5. Launch Custom Application

```javascript
// Using full path (if UseWhitelist=false)
const exePath = 'C:/CustomApps/MyApp.exe';
const arg1 = 'param1';
const arg2 = 'value with spaces';

const args = encodeURIComponent(`${arg1}|${arg2}`);
window.location.href = `launch://${encodeURIComponent(exePath)}?args=${args}`;
```

---

## Variable Substitution

The handler supports variable substitution from the INI file:

| Variable | INI Section | Example Value |
|----------|-------------|---------------|
| `{AccessDatabase}` | `[Paths]` | `C:\S_O\labels.accdb` |
| `{PatientsFolder}` | `[Paths]` | `\\Clinic\clinic1` |
| `{msaccess}` | `[Applications]` | (resolved to full path) |

**Usage:**
```javascript
// These are equivalent if AccessDatabase is set in INI:
launch://msaccess?args={AccessDatabase}|/cmd|form
launch://msaccess?args=C:\\S_O\\labels.accdb|/cmd|form
```

---

## JavaScript Helper

Use the provided helper class for cleaner code:

```javascript
import { UniversalLauncher } from '/js/services/UniversalLauncher.js';

// Launch MS Access with label printing
UniversalLauncher.printLabels(193, 'Sibar Fathil', 1);

// Launch notepad
UniversalLauncher.launch('notepad', ['C:\\temp\\file.txt']);

// Launch using variables
UniversalLauncher.launch('msaccess', ['{AccessDatabase}', '/cmd', 'frmMain']);
```

See `/public/js/services/UniversalLauncher.js` for full API.

---

## Security Considerations

### Whitelist Mode

Set `UseWhitelist=true` in INI to:
- Only allow applications defined in `[Applications]` section
- Block arbitrary executable paths
- Prevent potential security risks

**Trade-offs:**
- ✅ More secure (only predefined apps)
- ❌ Less flexible (must edit INI for new apps)

### Open Mode (Default)

Set `UseWhitelist=false` to:
- Allow full executable paths
- Maximum flexibility
- Requires trust in users/developers

**Trade-offs:**
- ✅ Launch any application without config changes
- ❌ Could be abused if web app is compromised

### Recommendation

For production:
- Use `UseWhitelist=true`
- Define all needed applications in `[Applications]`
- Regularly audit the whitelist

For development:
- Use `UseWhitelist=false` for faster iteration
- Switch to whitelist before deployment

---

## Troubleshooting

### Protocol doesn't launch

1. **Check registry:**
   ```cmd
   reg query "HKCR\launch\shell\open\command"
   ```
   Should show: `"C:\Windows\UniversalProtocolHandler.exe" "%1"`

2. **Check browser policy:**
   - Chrome: `chrome://policy`
   - Edge: `edge://policy`
   - Look for `AutoLaunchProtocolsFromOrigins`
   - Should include `"protocol": "launch"`

3. **Restart browser** after installation

### Application not found

```
Error: Application alias not found: myapp
```

**Fix:** Add to `C:\Windows\ProtocolHandlers.ini`:
```ini
[Applications]
myapp=C:\Path\To\Application.exe
```

### Executable not found

```
Error: Executable not found: C:\Path\App.exe
```

**Fix:**
- Verify the path is correct
- Check application is installed
- Ensure you have access permissions

### Security error (whitelist)

```
Error: Full executable paths are disabled
```

**Fix:** Either:
1. Add application to `[Applications]` section, OR
2. Set `UseWhitelist=false` in `[Security]` section

### Arguments not working

**Common issues:**
- Forgot to URL-encode: Use `encodeURIComponent()`
- Wrong separator: Use pipe `|`, not comma or space
- Special characters: Ensure proper escaping

**Example:**
```javascript
// ❌ Wrong
launch://msaccess?args=file.accdb,/cmd,form

// ✅ Correct
const args = encodeURIComponent('file.accdb|/cmd|form');
launch://msaccess?args=${args}
```

---

## Advanced Usage

### Passing Complex Data

For complex parameters (JSON, special characters):

```javascript
const data = {
  batchId: 193,
  patient: 'Sibar Fathil',
  drId: 1,
  action: 'print'
};

// Convert to pipe-separated format
const args = [
  '{AccessDatabase}',
  '/cmd',
  'frmLabels',
  `BatchID = ${data.batchId}`,
  data.patient,
  data.drId
].join('|');

window.location.href = `launch://msaccess?args=${encodeURIComponent(args)}`;
```

### Dynamic Application Selection

```javascript
function launchWith(appAlias, args) {
  const argsEncoded = encodeURIComponent(args.join('|'));
  window.location.href = `launch://${appAlias}?args=${argsEncoded}`;
}

// Usage
launchWith('msaccess', ['{AccessDatabase}', '/cmd', 'frmMain']);
launchWith('excel', ['\\\\server\\share\\file.xlsx']);
launchWith('notepad', ['C:\\temp\\notes.txt']);
```

---

## Comparison with Specific Protocols

| Feature | Universal (`launch://`) | Specific (`explorer://`, `csimaging://`) |
|---------|------------------------|------------------------------------------|
| **Flexibility** | Launch any app | Single purpose |
| **Configuration** | INI aliases | Hardcoded paths |
| **Arguments** | Complex, multi-arg | Simple, specific |
| **Security** | Optional whitelist | Built-in validation |
| **Use Case** | Ad-hoc, varied apps | Well-defined actions |

**When to use:**
- **Universal:** Label printing, reports, document editing, varied apps
- **Specific:** Core features (folder opening, imaging), better UX, simpler frontend

---

## API Reference

### Protocol Syntax

```
launch://IDENTIFIER?args=ARG1|ARG2|ARG3
```

**IDENTIFIER:**
- Alias: `msaccess` (looks up in `[Applications]`)
- Full path: `C:/Program%20Files/App/app.exe`

**args parameter:**
- Pipe-separated: `arg1|arg2|arg3`
- URL-encoded: Use `encodeURIComponent()`
- Variables: `{VariableName}` (resolved from INI)

### Argument Processing

1. **URL decode**: Convert `%20` → space, etc.
2. **Variable substitution**: Replace `{VariableName}` with INI values
3. **Split by pipe**: `arg1|arg2|arg3` → `['arg1', 'arg2', 'arg3']`
4. **Quote spaces**: `my file` → `"my file"`
5. **Pass to executable**: Final command line

---

## Files

| File | Location | Purpose |
|------|----------|---------|
| **Handler** | `C:\Windows\UniversalProtocolHandler.exe` | Protocol handler executable |
| **Config** | `C:\Windows\ProtocolHandlers.ini` | Application aliases and settings |
| **Source** | `protocol-handlers/source/UniversalProtocolHandler.cs` | C# source code |
| **JS Helper** | `public/js/services/UniversalLauncher.js` | JavaScript API |

---

## Examples for Common Scenarios

### Printing Labels from Aligner Batch

```javascript
function printAlignerLabels(batchId, patientName, drId) {
  const args = encodeURIComponent(
    `{AccessDatabase}|/cmd|frmLabels|AlignerBatchID = ${batchId}|${patientName}|${drId}`
  );
  window.location.href = `launch://msaccess?args=${args}`;
}

// Usage
printAlignerLabels(193, 'Sibar Fathil', 1);
```

### Opening Patient Folder in Explorer

```javascript
function openPatientFolder(patientId) {
  const folder = `{PatientsFolder}\\${patientId}`;
  const args = encodeURIComponent(folder);
  window.location.href = `launch://C:/Windows/explorer.exe?args=${args}`;
}
```

### Generating Report in Excel

```javascript
function openExcelReport(reportPath) {
  const args = encodeURIComponent(reportPath);
  window.location.href = `launch://excel?args=${args}`;
}
```

---

## Summary

The Universal Protocol Handler provides a **powerful, flexible way** to integrate external applications into your web interface. By using:

- **Application aliases** for convenience
- **INI variables** for configuration management
- **Pipe-separated arguments** for complex commands
- **Optional whitelist** for security

You can create seamless workflows between your web app and desktop applications, all with a unified, maintainable approach.

For your **specific use case** (MS Access label printing), the pattern is:

```javascript
launch://msaccess?args={AccessDatabase}|/cmd|frmLabels|AlignerBatchID = ${id}|${name}|${drId}
```

This will launch Access, open your database, run the form, and pass all required parameters - exactly what you needed!

---

**Need help?** Check:
- Configuration: `C:\Windows\ProtocolHandlers.ini`
- Browser policy: `chrome://policy` or `edge://policy`
- Registry: `HKCR\launch\shell\open\command`
- Logs: Check Windows Event Viewer for application errors
