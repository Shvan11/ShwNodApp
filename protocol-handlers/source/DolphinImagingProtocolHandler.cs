using System;
using System.Collections.Specialized;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Web;
using System.Windows.Forms;

namespace DolphinImagingProtocolHandler
{
    /// <summary>
    /// Configuration loaded from ProtocolHandlers.ini
    /// </summary>
    class Config
    {
        public string DolphinPath { get; set; }
        public string PatientsFolder { get; set; }
        public string MemoryCardPath { get; set; }
        public bool UseRunAsDate { get; set; }
        public string RunAsDatePath { get; set; }
    }

    class Program
    {
        private const string ConfigPath = @"C:\Windows\ProtocolHandlers.ini";

        [DllImport("kernel32", CharSet = CharSet.Unicode)]
        static extern long WritePrivateProfileString(string Section, string Key, string Value, string FilePath);

        [STAThread]
        static void Main(string[] args)
        {
            if (args.Length == 0) return;

            try
            {
                var (patientId, parameters) = ParseUrl(args[0]);
                var config = LoadConfig();

                switch (parameters["action"])
                {
                    case "open":
                        OpenDolphin(patientId, config);
                        break;
                    case "photos":
                        ImportPhotos(patientId, parameters, config);
                        break;
                    default:
                        ShowError($"Unknown action: {parameters["action"]}");
                        break;
                }
            }
            catch (Exception ex)
            {
                ShowError($"Error: {ex.Message}");
            }
        }

        /// <summary>
        /// Parse dolphin:PatientID?action=open&tp=0&date=20251220&skip=0
        /// </summary>
        static (string patientId, NameValueCollection parameters) ParseUrl(string url)
        {
            // Remove protocol prefix
            string withoutProtocol = url.Substring(url.IndexOf(':') + 1);
            withoutProtocol = HttpUtility.UrlDecode(withoutProtocol);

            // Split path and query
            string[] parts = withoutProtocol.Split(new[] { '?' }, 2);
            string patientId = parts[0].Trim();

            // Parse query parameters
            NameValueCollection parameters = new NameValueCollection();
            if (parts.Length > 1)
            {
                parameters = HttpUtility.ParseQueryString(parts[1]);
            }

            return (patientId, parameters);
        }

        /// <summary>
        /// Load configuration from INI file
        /// </summary>
        static Config LoadConfig()
        {
            var config = new Config
            {
                DolphinPath = ReadIniValue("Paths", "DolphinPath"),
                PatientsFolder = ReadIniValue("Paths", "PatientsFolder"),
                MemoryCardPath = ReadIniValue("Paths", "MemoryCardPath") ?? @"D:\DCIM",
                UseRunAsDate = ReadIniValue("Paths", "UseRunAsDate")?.ToLowerInvariant() == "true",
                RunAsDatePath = ReadIniValue("Paths", "RunAsDatePath")
            };

            // Ensure paths end with backslash
            if (!string.IsNullOrEmpty(config.DolphinPath) && !config.DolphinPath.EndsWith("\\"))
                config.DolphinPath += "\\";
            if (!string.IsNullOrEmpty(config.PatientsFolder) && !config.PatientsFolder.EndsWith("\\"))
                config.PatientsFolder += "\\";

            return config;
        }

        /// <summary>
        /// Open patient in Dolphin Imaging
        /// Uses RunAsDate if configured, otherwise DolCtrl.exe
        /// </summary>
        static void OpenDolphin(string patientId, Config config, int? tpCode = null)
        {
            if (string.IsNullOrEmpty(config.DolphinPath))
            {
                ShowError("DolphinPath not configured in ProtocolHandlers.ini");
                return;
            }

            // Set CaptureFromFilePath in Dolphin.ini
            string patientFolder = Path.Combine(config.PatientsFolder, patientId) + "\\";
            string dolphinIni = Path.Combine(config.DolphinPath, "Dolphin.ini");

            if (WritePrivateProfileString("Defaults", "CaptureFromFilePath", patientFolder, dolphinIni) == 0)
            {
                ShowError($"Failed to write to Dolphin.ini: {dolphinIni}");
                return;
            }

            if (config.UseRunAsDate)
            {
                // RunAsDate mode: Launch dolphin64.exe via RunAsDate utility
                if (string.IsNullOrEmpty(config.RunAsDatePath) || !File.Exists(config.RunAsDatePath))
                {
                    ShowError($"RunAsDate.exe not found at: {config.RunAsDatePath}");
                    return;
                }

                string dolphin64Exe = Path.Combine(config.DolphinPath, "dolphin64.exe");
                if (!File.Exists(dolphin64Exe))
                {
                    ShowError($"dolphin64.exe not found at: {dolphin64Exe}");
                    return;
                }

                // Build arguments for dolphin64.exe
                string dolphinArgs = patientId;
                if (tpCode.HasValue)
                {
                    dolphinArgs += $" /tp {tpCode.Value}";
                }

                // Launch via RunAsDate
                // Format: RunAsDate.exe /immediate /movetime 29\07\2021 00:00:00 "path\dolphin64.exe" args
                string runAsDateArgs = $"/immediate /movetime 29\\07\\2021 00:00:00 \"{dolphin64Exe}\" {dolphinArgs}";

                Process.Start(new ProcessStartInfo
                {
                    FileName = config.RunAsDatePath,
                    Arguments = runAsDateArgs,
                    UseShellExecute = true
                });
            }
            else
            {
                // Standard mode: Use DolCtrl.exe
                string dolCtrlExe = Path.Combine(config.DolphinPath, "DolCtrl.exe");
                if (!File.Exists(dolCtrlExe))
                {
                    ShowError($"DolCtrl.exe not found at: {dolCtrlExe}");
                    return;
                }

                string arguments = patientId;
                if (tpCode.HasValue)
                {
                    arguments += $" /tp {tpCode.Value}";
                }

                Process.Start(new ProcessStartInfo
                {
                    FileName = dolCtrlExe,
                    Arguments = arguments,
                    UseShellExecute = true
                });
            }
        }

        /// <summary>
        /// Import photos from memory card, then optionally open Dolphin
        /// </summary>
        static void ImportPhotos(string patientId, NameValueCollection parameters, Config config)
        {
            // Parse parameters
            int tpCode = int.Parse(parameters["tp"] ?? "0");
            string date = parameters["date"] ?? DateTime.Now.ToString("yyyyMMdd");
            bool skipDolphin = parameters["skip"] == "1";

            // Create destination folder
            string destFolder = Path.Combine(config.PatientsFolder, patientId, $"{tpCode}_{date}");
            Directory.CreateDirectory(destFolder);

            // Show file picker
            using (var dialog = new OpenFileDialog())
            {
                dialog.Title = "Select Photos to Import";
                dialog.Filter = "Image Files|*.jpg;*.jpeg;*.png;*.bmp|All Files|*.*";
                dialog.Multiselect = true;
                dialog.InitialDirectory = Directory.Exists(config.MemoryCardPath)
                    ? config.MemoryCardPath
                    : Environment.GetFolderPath(Environment.SpecialFolder.MyPictures);

                if (dialog.ShowDialog() != DialogResult.OK || dialog.FileNames.Length == 0)
                {
                    return; // User cancelled or no files selected
                }

                // Move selected photos to destination
                int movedCount = 0;
                foreach (string sourcePath in dialog.FileNames)
                {
                    string fileName = Path.GetFileName(sourcePath);
                    string destPath = Path.Combine(destFolder, fileName);

                    // Handle duplicate filenames
                    if (File.Exists(destPath))
                    {
                        string nameWithoutExt = Path.GetFileNameWithoutExtension(fileName);
                        string ext = Path.GetExtension(fileName);
                        int counter = 1;
                        do
                        {
                            destPath = Path.Combine(destFolder, $"{nameWithoutExt}_{counter}{ext}");
                            counter++;
                        } while (File.Exists(destPath));
                    }

                    File.Move(sourcePath, destPath);
                    movedCount++;
                }

                if (skipDolphin)
                {
                    MessageBox.Show(
                        $"Successfully moved {movedCount} photo(s) to:\n{destFolder}",
                        "Photos Organized",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Information
                    );
                }
                else
                {
                    OpenDolphin(patientId, config, tpCode);
                }
            }
        }

        /// <summary>
        /// Read value from INI file
        /// </summary>
        static string ReadIniValue(string section, string key)
        {
            if (!File.Exists(ConfigPath)) return null;

            string[] lines = File.ReadAllLines(ConfigPath);
            bool inSection = false;

            foreach (string line in lines)
            {
                string trimmed = line.Trim();
                if (string.IsNullOrEmpty(trimmed) || trimmed.StartsWith(";") || trimmed.StartsWith("#"))
                    continue;

                if (trimmed.StartsWith("[") && trimmed.EndsWith("]"))
                {
                    inSection = trimmed.Substring(1, trimmed.Length - 2)
                        .Equals(section, StringComparison.OrdinalIgnoreCase);
                    continue;
                }

                if (inSection && trimmed.Contains("="))
                {
                    string[] parts = trimmed.Split(new[] { '=' }, 2);
                    if (parts[0].Trim().Equals(key, StringComparison.OrdinalIgnoreCase))
                    {
                        return parts[1].Trim();
                    }
                }
            }

            return null;
        }

        /// <summary>
        /// Show error message
        /// </summary>
        static void ShowError(string message)
        {
            MessageBox.Show(message, "Dolphin Protocol Handler", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
