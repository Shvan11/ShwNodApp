# Aligner Folder Creation Enhancement

## What Changed

The `ExplorerProtocolHandler.exe` has been updated to automatically create folders that don't exist, with user confirmation.

## New Behavior

### Before:
- Clicking "Open Folder" on an aligner set would fail silently if folder didn't exist
- No way to create folder structure from the web app

### After:
- When clicking "Open Folder" on an aligner set:
  1. **First**: Checks if network share (e.g., `\\WORK_PC\Aligner_Sets`) is accessible
     - **If not accessible**: Shows error:
       ```
       Network share is not accessible:
       \\WORK_PC\Aligner_Sets

       Please ensure:
       1. The network location is available
       2. You have proper permissions
       3. You are connected to the network
       ```
  2. **If folder exists**: Opens it directly (same as before)
  3. **If folder doesn't exist**: Shows a dialog:
     ```
     Folder does not exist:
     \\WORK_PC\Aligner_Sets\5\John_Doe\1

     Do you want to create it?
     [Yes] [No]
     ```
  4. **If user clicks Yes**: Creates the entire folder structure and opens it in Explorer
  5. **If user clicks No**: Does nothing (cancels)

## Installation Steps

### 1. Recompile the Handler

Open PowerShell **as Administrator** in the project directory:

```powershell
cd C:\path\to\ShwNodApp
.\compile-handler.ps1
```

This will create the new `ExplorerProtocolHandler.exe` with folder creation capability.

### 2. Update the System

Copy the new executable to Windows directory:

```powershell
Copy-Item ExplorerProtocolHandler.exe C:\Windows\ -Force
```

**Note**: The registry is already configured, so you don't need to re-register the protocol.

### 3. Restart Your Browser

Close and reopen your browser (Chrome/Edge) to ensure it picks up the updated handler.

## Testing

1. Go to any patient's aligner sets page
2. Click "Open Folder" on a set that doesn't have a folder yet
3. You should see the confirmation dialog
4. Click "Yes" to create the folder
5. Windows Explorer should open showing the newly created folder

## Technical Details

### Code Changes

**ExplorerProtocolHandler.cs:**
- Added `System.IO` namespace for `Directory.Exists()` and `Directory.CreateDirectory()`
- Added `System.Windows.Forms` namespace for `MessageBox`
- Added network share accessibility check (validates `\\WORK_PC\Aligner_Sets` exists)
- Added `GetNetworkShareRoot()` helper method to extract share path from full path
- Shows error if network share is not accessible
- Shows confirmation dialog before creating folders
- Creates entire folder hierarchy using `Directory.CreateDirectory()`

**compile-handler.ps1:**
- Changed target from `/target:exe` to `/target:winexe` (prevents console window)
- Added reference to `System.Windows.Forms.dll`

## Folder Structure Created

The handler creates this structure:
```
\\WORK_PC\Aligner_Sets\
    └── {DoctorID}\
        └── {PatientName}\
            └── {SetSequence}\
```

For example:
```
\\WORK_PC\Aligner_Sets\5\John_Doe\1\
```

## Error Handling

If folder creation fails (e.g., network issues, permissions), an error dialog will show:
```
Explorer Protocol Error

Error opening/creating folder:
[Error message details]

[OK]
```

## Benefits

✅ **No separate "Create Folder" button needed** - One button does both
✅ **User confirmation** - Prevents accidental folder creation
✅ **Works on LAN machines** - Creates folders on network shares
✅ **Automatic folder hierarchy** - Creates all parent folders as needed
✅ **Clean UX** - Same workflow as before, just with creation capability
