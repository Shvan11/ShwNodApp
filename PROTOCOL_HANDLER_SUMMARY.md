# Explorer Protocol Handler - Complete Solution

## 🎯 The Problem

When clicking `explorer:` protocol links in your web app, you get **TWO prompts**:

1. **Browser prompt:** "Open ExplorerProtocolHandler.exe?"
2. **Windows prompt:** "Open Windows PowerShell?" (if using PowerShell)

Both are annoying and kill the user experience!

---

## ✅ The Solution (Two-Part System)

### **Part 1: EXE Handler** → Eliminates Windows Prompts
Instead of using a PowerShell script (which Windows doesn't trust), we compile a small C# executable that Windows trusts.

**Files:**
- `ExplorerProtocolHandler.cs` - Simple C# program that opens folders
- `compile-handler.ps1` - Compiles the C# file
- `register-explorer-protocol-exe.reg` - Tells Windows to use the EXE

**What it does:**
- Receives `explorer:\\path\to\folder` URLs
- Strips the `explorer:` prefix
- URL-decodes the path
- Opens it in Windows Explorer

### **Part 2: Browser Policy** → Eliminates Browser Prompts
Chrome/Edge need to be told to allow the `explorer:` protocol without asking.

**File:**
- `allow-explorer-protocol-chrome.reg` - Adds `explorer:*` to Chrome/Edge allowlist

**Registry keys:**
```registry
[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Google\Chrome\URLAllowlist]
"1"="explorer:*"

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\Edge\URLAllowlist]
"1"="explorer:*"
```

---

## 🚀 Installation (One Command)

```cmd
Right-click INSTALL_EXE_HANDLER.bat → Run as Administrator
```

This does **everything**:
1. ✅ Compiles the C# handler
2. ✅ Copies `ExplorerProtocolHandler.exe` to `C:\Windows\`
3. ✅ Registers the `explorer:` protocol
4. ✅ Configures Chrome/Edge to allow it

**Then:** Restart your browser and test!

---

## 🧪 Testing

```javascript
// In browser console:
window.location.href = 'explorer:C:\\Windows';
```

**Result:** Windows Explorer opens directly - NO PROMPTS! ✨

---

## 🔍 Why You Need BOTH Parts

| Part | Without It | With It |
|------|-----------|---------|
| **EXE Handler** | "Open Windows PowerShell?" ❌ | Opens silently ✅ |
| **Browser Policy** | "Open ExplorerProtocolHandler.exe?" ❌ | Opens silently ✅ |

**Without Part 1:** PowerShell prompt appears
**Without Part 2:** Browser prompt appears
**With BOTH:** Completely silent! 🎯

---

## 📁 Files Summary

### **Installation Files:**
- ✅ `INSTALL_EXE_HANDLER.bat` - One-click installer

### **Source Files:**
- ✅ `ExplorerProtocolHandler.cs` - C# handler source
- ✅ `compile-handler.ps1` - Compilation script

### **Registry Files:**
- ✅ `register-explorer-protocol-exe.reg` - Windows protocol registration
- ✅ `allow-explorer-protocol-chrome.reg` - Browser policy (Chrome & Edge)

### **Uninstallers:**
- ✅ `unregister-explorer-protocol-exe.reg` - Remove protocol handler

---

## 💡 How It Works

```
User clicks link in browser
         ↓
  explorer:\\WORK_PC\folder
         ↓
  Browser checks policy → ✅ "explorer:*" allowed
         ↓
  Windows receives request
         ↓
  Registry → C:\Windows\ExplorerProtocolHandler.exe
         ↓
  EXE strips "explorer:", decodes URL
         ↓
  Opens folder in Explorer → ✨ Done!
```

**No prompts anywhere!** 🎉

---

## 🔧 Advanced: Manual Installation

If the automated installer fails, you can install manually:

### **1. Compile the handler:**
```powershell
cd C:\path\to\files
.\compile-handler.ps1
```

### **2. Copy to Windows:**
```powershell
Copy-Item ExplorerProtocolHandler.exe C:\Windows\ -Force
```

### **3. Register protocol:**
```cmd
reg import register-explorer-protocol-exe.reg
```

### **4. Configure browser:**
```cmd
reg import allow-explorer-protocol-chrome.reg
```

### **5. Restart browser**

---

## ✅ Success Checklist

After installation, verify everything works:

- [ ] `C:\Windows\ExplorerProtocolHandler.exe` exists
- [ ] Chrome policy active: `chrome://policy` shows `URLAllowlist`
- [ ] Test link opens folder with NO prompts
- [ ] Works with both local paths (`C:\folder`) and UNC paths (`\\server\share`)

---

## 🎓 Key Takeaway

**You discovered** that `URLAllowlist` policy eliminates browser prompts - great find! But without the EXE wrapper, Windows would still prompt about PowerShell. **Both pieces are essential** for a silent experience.

✨ **Complete solution = EXE Handler + Browser Policy** ✨
