using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Web;
using System.Windows.Forms;

namespace DolphinImagingProtocolHandler
{
    class Program
    {
        /// <summary>
        /// Win32 API for writing to INI files
        /// Returns non-zero on success, 0 on failure
        /// </summary>
        [DllImport("kernel32", CharSet = CharSet.Unicode)]
        static extern long WritePrivateProfileString(
            string Section,
            string Key,
            string Value,
            string FilePath
        );

        [STAThread]
        static void Main(string[] args)
        {
            try
            {
                // Get the URL argument passed by Windows
                if (args.Length == 0)
                {
                    return; // No arguments, exit silently
                }

                string url = args[0];

                // Parse the dolphin: URL
                // Format: dolphin:PatientID?name=PatientName
                var parsedUrl = ParseDolphinUrl(url);

                if (parsedUrl == null)
                {
                    MessageBox.Show(
                        "Invalid Dolphin Imaging URL format.\n\nExpected: dolphin:PatientID?name=PatientName",
                        "Invalid URL",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                string patientId = parsedUrl.Item1;
                string patientName = parsedUrl.Item2;

                // Read DolphinPath from configuration file
                string dolphinPath = GetDolphinPath();

                if (string.IsNullOrEmpty(dolphinPath))
                {
                    MessageBox.Show(
                        "Dolphin Imaging path not configured.\n\n" +
                        "Please edit C:\\Windows\\ProtocolHandlers.ini and add:\n\n" +
                        "[Paths]\n" +
                        "DolphinPath=C:\\Dolphin\\",
                        "Configuration Error",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                // Validate DolCtrl.exe exists
                string dolCtrlExe = Path.Combine(dolphinPath, "DolCtrl.exe");
                if (!File.Exists(dolCtrlExe))
                {
                    MessageBox.Show(
                        "Dolphin Imaging executable not found at:\n\n" + dolCtrlExe + "\n\n" +
                        "Please install Dolphin Imaging software or update DolphinPath in:\n" +
                        "C:\\Windows\\ProtocolHandlers.ini",
                        "Dolphin Imaging Not Found",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                // Get patient folder path
                string patientFolder = GetPatientFolder(patientId);

                if (string.IsNullOrEmpty(patientFolder))
                {
                    MessageBox.Show(
                        "Unable to determine patient folder path for patient: " + patientId + "\n\n" +
                        "Please ensure PatientsFolder is set in C:\\Windows\\ProtocolHandlers.ini",
                        "Configuration Error",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                // Modify Dolphin.ini to set CaptureFromFilePath
                string dolphinIni = Path.Combine(dolphinPath, "Dolphin.ini");

                long result = WritePrivateProfileString(
                    "Defaults",
                    "CaptureFromFilePath",
                    patientFolder,
                    dolphinIni
                );

                if (result == 0)
                {
                    MessageBox.Show(
                        "Failed to write to Dolphin.ini:\n\n" + dolphinIni + "\n\n" +
                        "Please check file permissions.",
                        "INI Write Failed",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                // Launch DolCtrl.exe with PatientID as argument
                ProcessStartInfo startInfo = new ProcessStartInfo
                {
                    FileName = dolCtrlExe,
                    Arguments = patientId,
                    UseShellExecute = true  // Use shell execute for proper path handling
                };

                Process.Start(startInfo);

            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Error launching Dolphin Imaging:\n\n" + ex.Message,
                    "Dolphin Imaging Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }

        /// <summary>
        /// Get Dolphin installation path from configuration file
        /// Returns path from C:\Windows\ProtocolHandlers.ini [Paths] section
        /// </summary>
        private static string GetDolphinPath()
        {
            try
            {
                string configPath = @"C:\Windows\ProtocolHandlers.ini";
                string dolphinPath = ReadConfigValue(configPath, "Paths", "DolphinPath");

                if (string.IsNullOrEmpty(dolphinPath))
                {
                    return null;
                }

                // Ensure path ends with backslash
                if (!dolphinPath.EndsWith("\\"))
                {
                    dolphinPath += "\\";
                }

                return dolphinPath;
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// Get patient folder path
        /// Constructs: {PatientsFolder}\{PatientID}\
        /// </summary>
        private static string GetPatientFolder(string patientId)
        {
            try
            {
                string configPath = @"C:\Windows\ProtocolHandlers.ini";
                string patientsFolder = ReadConfigValue(configPath, "Paths", "PatientsFolder");

                if (string.IsNullOrEmpty(patientsFolder))
                {
                    return null;
                }

                // Construct patient folder path with trailing backslash
                string patientFolder = Path.Combine(patientsFolder, patientId) + "\\";

                return patientFolder;
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Error reading configuration:\n\n" + ex.Message,
                    "Configuration Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return null;
            }
        }

        /// <summary>
        /// Parse dolphin: URL
        /// Format: dolphin:PatientID?name=PatientName
        /// Returns Tuple of (PatientID, PatientName)
        /// </summary>
        private static Tuple<string, string> ParseDolphinUrl(string url)
        {
            try
            {
                // Strip protocol: dolphin:PatientID?name=PatientName
                string withoutProtocol = Regex.Replace(url, "^dolphin:", "", RegexOptions.IgnoreCase);

                // URL decode
                withoutProtocol = HttpUtility.UrlDecode(withoutProtocol);

                // Split by ?
                string[] parts = withoutProtocol.Split('?');

                if (parts.Length < 1)
                {
                    return null;
                }

                string patientId = parts[0].Trim();
                string patientName = "";

                // Parse query string for name parameter
                if (parts.Length > 1)
                {
                    string query = parts[1];
                    var queryParams = HttpUtility.ParseQueryString(query);
                    patientName = queryParams["name"] ?? "";
                }

                // Replace underscores with spaces in patient name
                patientName = patientName.Replace("_", " ");

                return new Tuple<string, string>(patientId, patientName);
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// Read a value from INI config file
        /// </summary>
        private static string ReadConfigValue(string filePath, string section, string key)
        {
            try
            {
                if (!File.Exists(filePath))
                {
                    return null;
                }

                string[] lines = File.ReadAllLines(filePath);
                bool inSection = false;

                foreach (string line in lines)
                {
                    string trimmed = line.Trim();

                    // Skip empty lines and comments
                    if (string.IsNullOrEmpty(trimmed) || trimmed.StartsWith(";") || trimmed.StartsWith("#"))
                    {
                        continue;
                    }

                    // Check for section header
                    if (trimmed.StartsWith("[") && trimmed.EndsWith("]"))
                    {
                        string currentSection = trimmed.Substring(1, trimmed.Length - 2).Trim();
                        inSection = currentSection.Equals(section, StringComparison.OrdinalIgnoreCase);
                        continue;
                    }

                    // If we're in the right section, look for the key
                    if (inSection && trimmed.Contains("="))
                    {
                        string[] parts = trimmed.Split(new[] { '=' }, 2);
                        if (parts.Length == 2)
                        {
                            string currentKey = parts[0].Trim();
                            if (currentKey.Equals(key, StringComparison.OrdinalIgnoreCase))
                            {
                                return parts[1].Trim();
                            }
                        }
                    }
                }

                return null;
            }
            catch
            {
                return null;
            }
        }
    }
}
