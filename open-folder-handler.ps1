# PowerShell Script: open-folder-handler.ps1
# Handles the "explorer:" protocol to open folders in Windows Explorer
#
# Usage: Called automatically by Windows when explorer:// URLs are clicked
# Example: explorer:\\WORK_PC\Aligner_Sets\2\John_Doe\1

param(
    [Parameter(Mandatory=$true)]
    [string]$url
)

try {
    Write-Host "Received URL: $url"

    # Strip the "explorer:" protocol prefix (case insensitive)
    $folderPath = $url -ireplace '^explorer:', ''

    Write-Host "After removing protocol: $folderPath"

    # URL decode the path (handles %5C, %20, Unicode characters, etc.)
    Add-Type -AssemblyName System.Web
    $folderPath = [System.Web.HttpUtility]::UrlDecode($folderPath)

    Write-Host "After URL decode: $folderPath"

    # Check if path exists
    if (Test-Path -Path $folderPath -ErrorAction SilentlyContinue) {
        Write-Host "Path exists! Opening in Explorer..."
        # Open the folder in Windows Explorer
        Start-Process explorer.exe -ArgumentList $folderPath
    } else {
        Write-Host "WARNING: Path does not exist: $folderPath"
        # Still try to open it (might be a network path that needs time to resolve)
        Start-Process explorer.exe -ArgumentList $folderPath
    }

    Write-Host "SUCCESS: Folder opened"

} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
    # Show error to user
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
        "Failed to open folder: $($_.Exception.Message)`n`nPath: $folderPath",
        "Folder Opener Error",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    )
}
