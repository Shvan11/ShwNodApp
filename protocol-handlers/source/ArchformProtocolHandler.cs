using System;
using System.Diagnostics;
using System.IO;
using System.Web;
using System.Windows.Forms;
using Microsoft.Win32;

namespace ArchformProtocolHandler
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

                // Parse the archform: URL
                // Format: archform:ArchformID
                string archformId = ParseArchformUrl(url);

                if (string.IsNullOrEmpty(archformId))
                {
                    MessageBox.Show(
                        "Invalid Archform URL format.\n\nExpected: archform:ArchformID",
                        "Invalid URL",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                // Get config file path (same directory as .exe)
                string exePath = System.Reflection.Assembly.GetExecutingAssembly().Location;
                string exeDir = Path.GetDirectoryName(exePath);
                string configPath = Path.Combine(exeDir, "ProtocolHandlers.ini");

                // Check computer name restriction
                string allowedComputer = ReadConfigValue(configPath, "Paths", "ArchformAllowedComputer");
                if (!string.IsNullOrEmpty(allowedComputer))
                {
                    string currentComputer = Environment.MachineName;
                    if (!currentComputer.Equals(allowedComputer, StringComparison.OrdinalIgnoreCase))
                    {
                        MessageBox.Show(
                            "This function can only run on " + allowedComputer + "!\n\n" +
                            "Current computer: " + currentComputer,
                            "Computer Restriction",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Warning
                        );
                        return;
                    }
                }

                // Write ArchformID to registry so Archform opens the correct patient
                // Registry key: HKCU\Software\ArchForm\ArchForm
                // Value name: LastPatient_h2457475196
                try
                {
                    using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\ArchForm\ArchForm"))
                    {
                        if (key == null)
                        {
                            MessageBox.Show(
                                "Failed to open Archform registry key.\n\n" +
                                "Registry path: HKCU\\Software\\ArchForm\\ArchForm",
                                "Registry Error",
                                MessageBoxButtons.OK,
                                MessageBoxIcon.Error
                            );
                            return;
                        }
                        key.SetValue("LastPatient_h2457475196", archformId, RegistryValueKind.String);
                    }
                }
                catch (Exception regEx)
                {
                    MessageBox.Show(
                        "Failed to write to Archform registry:\n\n" + regEx.Message,
                        "Registry Error",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                // Get Archform executable path from config
                string archformPath = ReadConfigValue(configPath, "Paths", "ArchformPath");

                if (string.IsNullOrEmpty(archformPath))
                {
                    MessageBox.Show(
                        "Archform path not configured.\n\n" +
                        "Please add ArchformPath to " + configPath + "\n\n" +
                        "Example:\n" +
                        "[Paths]\n" +
                        "ArchformPath=C:\\Program Files\\Archform\\archform.exe",
                        "Configuration Error",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                // Validate executable exists
                if (!File.Exists(archformPath))
                {
                    MessageBox.Show(
                        "Archform executable not found at:\n\n" + archformPath + "\n\n" +
                        "Please verify:\n" +
                        "1. Archform is installed\n" +
                        "2. The path in ProtocolHandlers.ini is correct",
                        "Archform Not Found",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                // Launch Archform
                ProcessStartInfo startInfo = new ProcessStartInfo
                {
                    FileName = archformPath,
                    UseShellExecute = true
                };

                Process.Start(startInfo);
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Error launching Archform:\n\n" + ex.Message,
                    "Archform Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }

        /// <summary>
        /// Parse archform: URL
        /// Format: archform:ArchformID
        /// Returns the ArchformID string
        /// </summary>
        private static string ParseArchformUrl(string url)
        {
            try
            {
                // Strip protocol prefix
                string withoutProtocol = url;
                if (url.StartsWith("archform:", StringComparison.OrdinalIgnoreCase))
                {
                    withoutProtocol = url.Substring("archform:".Length);
                }

                // URL decode and trim
                string archformId = HttpUtility.UrlDecode(withoutProtocol).Trim();

                // Remove any trailing slashes that browsers might add
                archformId = archformId.TrimEnd('/');

                if (string.IsNullOrEmpty(archformId))
                {
                    return null;
                }

                return archformId;
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
                        string[] keyValue = trimmed.Split(new[] { '=' }, 2);
                        if (keyValue.Length == 2)
                        {
                            string currentKey = keyValue[0].Trim();
                            if (currentKey.Equals(key, StringComparison.OrdinalIgnoreCase))
                            {
                                return keyValue[1].Trim();
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
