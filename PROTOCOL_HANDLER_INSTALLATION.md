# Windows Explorer Protocol Handler - Installation Guide

This guide will help you install a custom `explorer:` protocol handler that allows your web application to open folders directly in Windows Explorer.

---

## ⚡ Quick Start (Recommended)

**Want NO PROMPTS at all? Just do this:**

1. **Right-click** `INSTALL_EXE_HANDLER.bat` → **Run as Administrator**
2. **Restart your browser** (Chrome/Edge)
3. Done! Click folder links - they open silently! ✅

This installs:
- ✅ EXE handler (eliminates Windows PowerShell prompts)
- ✅ Browser policy for Chrome & Edge (eliminates browser prompts)

**Files needed (all included):**
- `INSTALL_EXE_HANDLER.bat`, `ExplorerProtocolHandler.cs`, `compile-handler.ps1`
- `register-explorer-protocol-exe.reg`, `allow-explorer-protocol-chrome.reg`

---

## 🎯 Choose Your Installation Method

### **Method 1: EXE Handler (RECOMMENDED - No Prompts!)**
✅ **No browser prompts** - Opens folders silently
✅ **One-click installation** - Automated batch file
✅ **Most reliable** - Windows trusts compiled executables

**Files needed:**
- `INSTALL_EXE_HANDLER.bat` - Automated installer
- `ExplorerProtocolHandler.cs` - C# source code
- `compile-handler.ps1` - Compilation script
- `register-explorer-protocol-exe.reg` - Registry settings

**Quick Install:**
1. **Right-click** `INSTALL_EXE_HANDLER.bat` → **Run as Administrator**
2. Wait for compilation to complete
3. Done! Test it in your browser - no prompts!

---

### **Method 2: PowerShell Handler (Simple but prompts)**
⚠️ **Browser will prompt** "Open Windows PowerShell?" each time
✅ **Simple** - No compilation needed

**Files needed:**
- `open-folder-handler.ps1` - PowerShell script
- `register-explorer-protocol.reg` - Registry file
- `unregister-explorer-protocol.reg` - Uninstall registry

Continue reading below for detailed PowerShell installation steps.

---

## 🚀 Method 1: EXE Handler Installation (Recommended)

### **Automated Installation (Easy)**

1. Navigate to your project folder: `ShwNodApp`
2. **Right-click** on `INSTALL_EXE_HANDLER.bat`
3. Select **"Run as Administrator"**
4. The script will:
   - Compile the C# handler
   - Copy it to `C:\Windows\`
   - Register the protocol
5. Press any key when complete

**Done!** Test by clicking any folder link - no prompts!

### **Manual Installation (If automated fails)**

1. **Compile the handler:**
   ```powershell
   # Run in PowerShell (as Administrator)
   cd C:\path\to\ShwNodApp
   .\compile-handler.ps1
   ```

2. **Copy the EXE:**
   ```powershell
   Copy-Item ExplorerProtocolHandler.exe C:\Windows\ -Force
   ```

3. **Register the protocol:**
   - Double-click `register-explorer-protocol-exe.reg`
   - Click **Yes** to confirm

**Done!** No more prompts!

---

## 🚀 Method 2: PowerShell Handler Installation (5 minutes)

### **Step 1: Copy PowerShell Script to Windows Folder**

1. Open File Explorer (`Win + E`)
2. Navigate to your project folder: `ShwNodApp`
3. Find the file: `open-folder-handler.ps1`
4. **Right-click** → **Copy** the file
5. Navigate to: `C:\Windows\`
6. **Right-click in empty space** → **Paste**
7. **Click "Continue"** when Windows asks for Administrator permission

**Result:** `C:\Windows\open-folder-handler.ps1` should now exist

---

### **Step 2: Register the Protocol Handler**

1. Still in your project folder: `ShwNodApp`
2. Find the file: `register-explorer-protocol.reg`
3. **Right-click** on it → **Merge** (or just double-click)
4. Windows will show a warning:
   ```
   Adding information can unintentionally change or delete values
   and cause components to stop working correctly.
   ```
5. **Click "Yes"** to confirm
6. Windows will show: **"The keys and values have been successfully added to the registry"**
7. **Click "OK"**

**Result:** The `explorer:` protocol is now registered!

---

### **Step 3: Test the Installation**

#### **Test Method 1: From Browser Console**

1. Open your application in browser: `http://localhost:5173/aligner/doctor/2/patient/10301`
2. Press `F12` to open Developer Console
3. Type this in the console and press Enter:
   ```javascript
   window.location.href = 'explorer:C:\\Windows';
   ```
4. **Windows Explorer should open showing the C:\Windows folder!** ✅

#### **Test Method 2: From HTML Page**

Create a test HTML file:
```html
<!DOCTYPE html>
<html>
<body>
    <h1>Protocol Handler Test</h1>
    <a href="explorer:C:\Windows">Click to open C:\Windows folder</a>
</body>
</html>
```

Open it and click the link - Windows Explorer should open!

---

### **Step 4: Test with UNC Network Paths**

In the browser console, test with your actual network path:
```javascript
window.location.href = 'explorer:\\\\WORK_PC\\Aligner_Sets\\5';
```

**Windows Explorer should open the network folder!** 🎉

---

## ✅ How It Works Now

When you click "Edit Set" and then "Open Patient Folder" in your application:

1. **Browser:** Executes `window.location.href = 'explorer:\\WORK_PC\Aligner_Sets\...'`
2. **Windows:** Detects `explorer:` protocol
3. **Registry:** Points to your PowerShell script
4. **PowerShell:**
   - Strips `explorer:` prefix
   - Decodes URL encoding (`%5C` → `\`, `%20` → space, etc.)
   - Opens folder in Windows Explorer
5. **User:** Sees the patient's folder! 🎯

---

## 🎯 Understanding the Two-Layer Prompt System

When using custom protocols, you face **TWO separate prompts**:

### **Layer 1: Windows Prompt**
❌ "Open Windows PowerShell?" (if using PowerShell handler)
✅ **Solution:** Use the EXE handler instead

### **Layer 2: Browser Prompt**
❌ "Open ExplorerProtocolHandler.exe?" (from Chrome/Edge)
✅ **Solution:** Configure browser policy with `allow-explorer-protocol-chrome.reg`

**You need BOTH solutions for a completely silent experience!**

---

## 🚀 Complete Solution (No Prompts)

The `INSTALL_EXE_HANDLER.bat` script handles **BOTH layers automatically**:

1. ✅ Compiles and installs the EXE handler (eliminates Windows prompt)
2. ✅ Configures Chrome/Edge policy (eliminates browser prompt)

**Just run it once and you're done!**

### **What the browser policy does:**

The `allow-explorer-protocol-chrome.reg` file adds the `explorer:` protocol to Chrome/Edge's allowlist:

```registry
[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Google\Chrome\URLAllowlist]
"1"="explorer:*"

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\Edge\URLAllowlist]
"1"="explorer:*"
```

This tells both browsers to allow the `explorer:` protocol without asking the user.

**Important:** You must **restart your browser** after applying the policy!

---

## 🔧 Troubleshooting

### **Problem: Nothing happens when clicking**

**Solution 1: Check if script exists**
```powershell
Test-Path C:\Windows\open-folder-handler.ps1
```
Should return `True`. If not, repeat Step 1.

**Solution 2: Check registry entry**
1. Press `Win + R`
2. Type: `regedit` and press Enter
3. Navigate to: `HKEY_CLASSES_ROOT\explorer\shell\open\command`
4. Check that the value points to correct PowerShell script path

**Solution 3: Test PowerShell script manually**
1. Open PowerShell as Administrator
2. Run:
   ```powershell
   C:\Windows\open-folder-handler.ps1 -url "explorer:C:\Windows"
   ```
3. Should open C:\Windows folder

---

### **Problem: PowerShell execution policy error**

If you see: `cannot be loaded because running scripts is disabled`

**Solution:**
```powershell
# Open PowerShell as Administrator
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope LocalMachine
```

(The registry entry uses `-ExecutionPolicy Bypass` to avoid this, but just in case)

---

### **Problem: Network path doesn't work**

**Solution: Check network access**
1. Open Windows Explorer manually
2. Type in address bar: `\\WORK_PC\Aligner_Sets`
3. Press Enter
4. If it asks for credentials, save them ("Remember my credentials")
5. Try the protocol handler again

---

## 🗑️ Uninstallation (if needed)

If you want to remove the protocol handler:

1. Navigate to your project folder
2. Find: `unregister-explorer-protocol.reg`
3. **Double-click** it → Click "Yes"
4. Delete: `C:\Windows\open-folder-handler.ps1`

Done! Protocol handler is removed.

---

## 🔒 Security Notes

### **Is this safe?**

✅ **YES** - This is a standard Windows feature (custom protocol handlers)
✅ Script only opens folders, doesn't execute files
✅ No data is sent over network
✅ PowerShell runs with `-NoProfile` (no user profile loaded)
✅ `-WindowStyle Hidden` (no PowerShell window appears)

### **What if I'm concerned about security?**

You can review the PowerShell script (`open-folder-handler.ps1`) - it's only ~40 lines and well-commented. It simply:
1. Takes a URL
2. Strips the protocol prefix
3. Decodes URL encoding
4. Opens the folder

No file execution, no network calls, no data collection.

---

## 📝 Technical Details

### **Registry Structure:**
```
HKEY_CLASSES_ROOT\explorer
├── @: "URL:Explorer Folder Protocol"
├── URL Protocol: ""
├── DefaultIcon
│   └── @: "C:\Windows\explorer.exe,0"
└── shell\open\command
    └── @: "powershell.exe ... -File C:\Windows\open-folder-handler.ps1 -url "%1""
```

### **PowerShell Parameters:**
- `-NoProfile` - Don't load user profile (faster startup)
- `-ExecutionPolicy Bypass` - Allow script execution
- `-WindowStyle Hidden` - No visible PowerShell window
- `-File` - Path to script
- `-url "%1"` - The URL parameter (e.g., `explorer:\\path`)

### **URL Encoding Examples:**
- `\\` (backslash) → `%5C`
- ` ` (space) → `%20`
- `علي` (Arabic) → `%D8%B9%D9%84%D9%8A`

The script handles all of these automatically!

---

## 🎉 Success Checklist

After installation, you should be able to:

- [x] Click "Edit Set" in the application
- [x] See "Open Patient Folder" button in Resources tab
- [x] Click the button → Windows Explorer opens
- [x] See the exact patient folder
- [x] Select and upload PDF files

**All done!** Your application can now open folders directly! 🚀

---

## 📞 Need Help?

If you encounter issues:
1. Check the Troubleshooting section above
2. Test each step individually
3. Verify PowerShell script is in `C:\Windows\`
4. Verify registry entry exists

**Remember:** This needs to be installed on **each computer** that will use the application.
