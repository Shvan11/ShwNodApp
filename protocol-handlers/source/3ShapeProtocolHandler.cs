using System;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using System.Web;
using System.Windows.Forms;

namespace ThreeShapeProtocolHandler
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

                // Parse the tshape: URL (named "tshape" because URI schemes must start with a letter)
                // Format: tshape:PatientID?firstname=FirstName&lastname=LastName
                var parsedUrl = Parse3ShapeUrl(url);

                if (parsedUrl == null)
                {
                    MessageBox.Show(
                        "Invalid 3Shape URL format.\n\nExpected: tshape:PatientID?firstname=FirstName&lastname=LastName",
                        "Invalid URL",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                string patientId = parsedUrl.Item1;
                string firstName = parsedUrl.Item2;
                string lastName = parsedUrl.Item3;

                // Get config file path (same directory as .exe)
                string exePath = System.Reflection.Assembly.GetExecutingAssembly().Location;
                string exeDir = Path.GetDirectoryName(exePath);
                string configPath = Path.Combine(exeDir, "ProtocolHandlers.ini");

                // Check computer name restriction
                string allowedComputer = ReadConfigValue(configPath, "Paths", "TShapeAllowedComputer");
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

                // Get 3Shape executable path from config
                string tshapePath = ReadConfigValue(configPath, "Paths", "TShapePath");

                if (string.IsNullOrEmpty(tshapePath))
                {
                    MessageBox.Show(
                        "3Shape Unite path not configured.\n\n" +
                        "Please add TShapePath to " + configPath + "\n\n" +
                        "Example:\n" +
                        "[Paths]\n" +
                        "TShapePath=C:\\Program Files\\3Shape\\Unite\\3ShapeUnite.exe",
                        "Configuration Error",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                // Validate executable exists
                if (!File.Exists(tshapePath))
                {
                    MessageBox.Show(
                        "3Shape Unite executable not found at:\n\n" + tshapePath + "\n\n" +
                        "Please verify:\n" +
                        "1. 3Shape Unite is installed\n" +
                        "2. The path in ProtocolHandlers.ini is correct",
                        "3Shape Unite Not Found",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                // Launch 3Shape Unite with parameters
                // Syntax: 3ShapeUnite.exe -integrationid=PatientID -firstname=FirstName -lastname=LastName
                string arguments = string.Format(
                    "-integrationid={0} -firstname={1} -lastname={2}",
                    patientId,
                    firstName,
                    lastName
                );

                ProcessStartInfo startInfo = new ProcessStartInfo
                {
                    FileName = tshapePath,
                    Arguments = arguments,
                    UseShellExecute = true
                };

                Process.Start(startInfo);
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Error launching 3Shape Unite:\n\n" + ex.Message,
                    "3Shape Unite Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }

        /// <summary>
        /// Parse tshape: URL (named "tshape" because URI schemes must start with a letter)
        /// Format: tshape:PatientID?firstname=FirstName&lastname=LastName
        /// Returns Tuple of (PatientID, FirstName, LastName)
        /// </summary>
        private static Tuple<string, string, string> Parse3ShapeUrl(string url)
        {
            try
            {
                // Strip protocol: tshape:PatientID?firstname=...&lastname=...
                string withoutProtocol = Regex.Replace(url, "^tshape:", "", RegexOptions.IgnoreCase);

                // URL decode
                withoutProtocol = HttpUtility.UrlDecode(withoutProtocol);

                // Split by ?
                string[] parts = withoutProtocol.Split('?');

                if (parts.Length < 1)
                {
                    return null;
                }

                string patientId = parts[0].Trim();
                string firstName = "";
                string lastName = "";

                // Parse query string for firstname and lastname parameters
                if (parts.Length > 1)
                {
                    string query = parts[1];
                    var queryParams = HttpUtility.ParseQueryString(query);
                    firstName = queryParams["firstname"] ?? "";
                    lastName = queryParams["lastname"] ?? "";
                }

                return new Tuple<string, string, string>(patientId, firstName, lastName);
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
