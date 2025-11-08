using System;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using System.Web;
using System.Windows.Forms;
using Microsoft.Win32;

namespace CSImagingProtocolHandler
{
    class Program
    {
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

                // Parse the csimaging: URL
                // Format: csimaging:PatientID?name=PatientName
                var parsedUrl = ParseCSImagingUrl(url);

                if (parsedUrl == null)
                {
                    MessageBox.Show(
                        "Invalid CS Imaging URL format.\n\nExpected: csimaging:PatientID?name=PatientName",
                        "Invalid URL",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                string patientId = parsedUrl.Item1;
                string patientName = parsedUrl.Item2;

                // Get TW.EXE path from registry
                string twExePath = GetTWExePath();

                if (string.IsNullOrEmpty(twExePath))
                {
                    MessageBox.Show(
                        "CS Imaging (TW.EXE) is not installed on this computer.\n\n" +
                        "Please install CS Imaging Trophy software.\n\n" +
                        "Registry key not found:\n" +
                        "HKEY_LOCAL_MACHINE\\Software\\Classes\\Trophy\\InstallDir",
                        "CS Imaging Not Found",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                // Validate TW.EXE exists
                if (!File.Exists(twExePath))
                {
                    MessageBox.Show(
                        "CS Imaging executable not found at:\n\n" + twExePath + "\n\n" +
                        "The application may have been moved or uninstalled.\n" +
                        "Please reinstall CS Imaging Trophy software.",
                        "CS Imaging Not Found",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                // Get OPG folder path
                string opgPath = GetOPGPath(patientId);

                if (string.IsNullOrEmpty(opgPath))
                {
                    MessageBox.Show(
                        "Unable to determine OPG folder path for patient: " + patientId + "\n\n" +
                        "Please ensure the PATIENTS_FOLDER environment variable is set,\n" +
                        "or the default path exists: \\\\WORK_PC\\clinic1",
                        "Configuration Error",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                // Check if OPG folder exists
                if (!Directory.Exists(opgPath))
                {
                    DialogResult result = MessageBox.Show(
                        "OPG folder does not exist for this patient:\n\n" + opgPath + "\n\n" +
                        "Do you want to create it?",
                        "Create OPG Folder?",
                        MessageBoxButtons.YesNo,
                        MessageBoxIcon.Question
                    );

                    if (result == DialogResult.Yes)
                    {
                        try
                        {
                            Directory.CreateDirectory(opgPath);
                        }
                        catch (Exception ex)
                        {
                            MessageBox.Show(
                                "Failed to create OPG folder:\n\n" + ex.Message,
                                "Error Creating Folder",
                                MessageBoxButtons.OK,
                                MessageBoxIcon.Error
                            );
                            return;
                        }
                    }
                    else
                    {
                        return; // User cancelled
                    }
                }

                // Launch TW.EXE with parameters
                // Syntax: TW.EXE -P<opgPath> -N<PatientName> -D<PatientID> (no spaces after flags)
                string arguments = string.Format(
                    "-P{0} -N{1} -D{2}",
                    opgPath,
                    patientName,
                    patientId
                );

                ProcessStartInfo startInfo = new ProcessStartInfo
                {
                    FileName = twExePath,
                    Arguments = arguments,
                    UseShellExecute = true  // Use shell execute for proper Unicode/Arabic handling
                };

                Process.Start(startInfo);

            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Error launching CS Imaging:\n\n" + ex.Message,
                    "CS Imaging Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }

        /// <summary>
        /// Get TW.EXE path from Windows registry
        /// Key: HKLM\Software\Classes\Trophy, Value: InstallDir
        /// </summary>
        private static string GetTWExePath()
        {
            try
            {
                using (RegistryKey key = Registry.LocalMachine.OpenSubKey(@"Software\Classes\Trophy"))
                {
                    if (key != null)
                    {
                        object installDir = key.GetValue("InstallDir");
                        if (installDir != null)
                        {
                            string dir = installDir.ToString();
                            // Construct full path to TW.EXE
                            string twPath = Path.Combine(dir, "TW.EXE");

                            if (File.Exists(twPath))
                            {
                                return twPath;
                            }
                        }
                    }
                }
            }
            catch
            {
                // Registry access failed
            }

            return null;
        }

        /// <summary>
        /// Parse csimaging: URL
        /// Format: csimaging:PatientID?name=PatientName
        /// Returns Tuple of (PatientID, PatientName)
        /// </summary>
        private static Tuple<string, string> ParseCSImagingUrl(string url)
        {
            try
            {
                // Strip protocol: csimaging:PatientID?name=PatientName
                string withoutProtocol = Regex.Replace(url, "^csimaging:", "", RegexOptions.IgnoreCase);

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
        /// Get OPG folder path for patient
        /// Constructs: {PatientsFolder}\{PatientID}\OPG
        ///
        /// Reads configuration from config.ini in the same directory as the executable.
        /// </summary>
        private static string GetOPGPath(string patientId)
        {
            try
            {
                // Get config file path (same directory as .exe)
                string exePath = System.Reflection.Assembly.GetExecutingAssembly().Location;
                string exeDir = Path.GetDirectoryName(exePath);
                string configPath = Path.Combine(exeDir, "ProtocolHandlers.ini");

                // Read patients folder from config
                string patientsFolder = ReadConfigValue(configPath, "Paths", "PatientsFolder");

                if (string.IsNullOrEmpty(patientsFolder))
                {
                    // Config file or value not found - show error
                    MessageBox.Show(
                        "Configuration file not found or missing PatientsFolder setting.\n\n" +
                        "Expected file: " + configPath + "\n\n" +
                        "Please ensure the configuration file exists with:\n" +
                        "[Paths]\n" +
                        "PatientsFolder=\\\\YourServer\\YourPath",
                        "Configuration Error",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return null;
                }

                // Construct OPG path: {PatientsFolder}\{PatientID}\OPG
                string opgPath = Path.Combine(patientsFolder, patientId, "OPG");

                return opgPath;
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
