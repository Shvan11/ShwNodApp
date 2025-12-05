using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web;
using System.Windows.Forms;

namespace UniversalProtocolHandler
{
    class Program
    {
        // Win32 API for INI file reading
        [DllImport("kernel32", CharSet = CharSet.Unicode)]
        static extern int GetPrivateProfileString(string section, string key, string defaultValue, StringBuilder result, int size, string filePath);

        private const string CONFIG_FILE = @"C:\Windows\ProtocolHandlers.ini";

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

                // Parse the URL
                // Format: launch://alias?args=arg1|arg2|arg3

                Uri uri = new Uri(url);
                string appIdentifier = uri.Host; // alias (e.g., msaccess)
                string query = uri.Query; // ?args=...

                // Get executable path from [Applications] section (aliases only, security hardened)
                string executablePath = GetApplicationPath(appIdentifier);

                if (string.IsNullOrEmpty(executablePath))
                {
                    ShowError("Application alias not found: " + appIdentifier + "\n\n" +
                            "Please add it to C:\\Windows\\ProtocolHandlers.ini in the [Applications] section.\n\n" +
                            "Example:\n" +
                            appIdentifier + "=C:\\Path\\To\\Application.exe");
                    return;
                }

                // Validate that the executable exists
                if (!File.Exists(executablePath))
                {
                    ShowError("Executable not found:\n\n" + executablePath + "\n\n" +
                            "Please verify:\n" +
                            "1. The path is correct\n" +
                            "2. The application is installed\n" +
                            "3. You have access permissions");
                    return;
                }

                // Parse arguments from query string
                string arguments = "";
                if (!string.IsNullOrEmpty(query))
                {
                    // Remove leading '?'
                    query = query.TrimStart('?');

                    // Parse query string
                    var queryParams = HttpUtility.ParseQueryString(query);
                    string argsParam = queryParams["args"];

                    if (!string.IsNullOrEmpty(argsParam))
                    {
                        // URL decode the arguments
                        argsParam = HttpUtility.UrlDecode(argsParam);

                        // Replace variables from INI file
                        argsParam = ReplaceConfigVariables(argsParam);

                        // Split by pipe character and rebuild as space-separated
                        string[] argParts = argsParam.Split('|');

                        // Special handling for /cmd switch (used by MS Access and other apps)
                        // If we have: database.accdb|/cmd|FormName|Arg1|Arg2
                        // We need: "database.accdb" /cmd "FormName|Arg1|Arg2"
                        bool hasCmdSwitch = false;
                        int cmdIndex = -1;

                        for (int i = 0; i < argParts.Length; i++)
                        {
                            if (argParts[i].Trim().Equals("/cmd", StringComparison.OrdinalIgnoreCase))
                            {
                                hasCmdSwitch = true;
                                cmdIndex = i;
                                break;
                            }
                        }

                        if (hasCmdSwitch && cmdIndex >= 0 && cmdIndex < argParts.Length - 1)
                        {
                            // Process arguments before /cmd normally
                            for (int i = 0; i < cmdIndex; i++)
                            {
                                string arg = argParts[i];
                                if (arg.Contains(" ") && !arg.StartsWith("\""))
                                {
                                    arguments += "\"" + arg + "\"";
                                }
                                else
                                {
                                    arguments += arg;
                                }
                                arguments += " ";
                            }

                            // Add /cmd switch
                            arguments += "/cmd ";

                            // Combine all remaining arguments into a single quoted string with pipes
                            string cmdArgument = string.Join("|", argParts, cmdIndex + 1, argParts.Length - cmdIndex - 1);
                            arguments += "\"" + cmdArgument + "\"";
                        }
                        else
                        {
                            // Normal processing for non-/cmd commands
                            for (int i = 0; i < argParts.Length; i++)
                            {
                                string arg = argParts[i];

                                // Add quotes around arguments with spaces (unless already quoted)
                                if (arg.Contains(" ") && !arg.StartsWith("\""))
                                {
                                    arguments += "\"" + arg + "\"";
                                }
                                else
                                {
                                    arguments += arg;
                                }

                                // Add space between arguments (except last one)
                                if (i < argParts.Length - 1)
                                {
                                    arguments += " ";
                                }
                            }
                        }
                    }
                }

                // Launch the application
                ProcessStartInfo startInfo = new ProcessStartInfo
                {
                    FileName = executablePath,
                    Arguments = arguments,
                    UseShellExecute = true,
                    WorkingDirectory = Path.GetDirectoryName(executablePath)
                };

                Process.Start(startInfo);

                // Success - exit silently
            }
            catch (UriFormatException ex)
            {
                ShowError("Invalid URL format:\n\n" + ex.Message + "\n\n" +
                        "Expected format:\n" +
                        "launch://alias?args=arg1|arg2");
            }
            catch (Exception ex)
            {
                ShowError("Error launching application:\n\n" + ex.Message);
            }
        }

        /// <summary>
        /// Read application path from INI file [Applications] section
        /// </summary>
        static string GetApplicationPath(string alias)
        {
            if (!File.Exists(CONFIG_FILE))
            {
                return null;
            }

            StringBuilder result = new StringBuilder(500);
            GetPrivateProfileString("Applications", alias, "", result, result.Capacity, CONFIG_FILE);

            string path = result.ToString().Trim();
            return string.IsNullOrEmpty(path) ? null : path;
        }

        /// <summary>
        /// Replace {VariableName} placeholders with values from INI file [Paths] section
        /// </summary>
        static string ReplaceConfigVariables(string input)
        {
            if (string.IsNullOrEmpty(input) || !File.Exists(CONFIG_FILE))
            {
                return input;
            }

            // Replace common variables
            // {AccessDatabase} -> value from [Paths] AccessDatabase
            // {PatientsFolder} -> value from [Paths] PatientsFolder

            string result = input;

            // Find all {VariableName} patterns
            System.Text.RegularExpressions.Regex regex = new System.Text.RegularExpressions.Regex(@"\{(\w+)\}");
            System.Text.RegularExpressions.MatchCollection matches = regex.Matches(input);

            foreach (System.Text.RegularExpressions.Match match in matches)
            {
                string variableName = match.Groups[1].Value; // e.g., "AccessDatabase"
                string placeholder = match.Value; // e.g., "{AccessDatabase}"

                // Try to read from [Paths] section first
                StringBuilder value = new StringBuilder(500);
                GetPrivateProfileString("Paths", variableName, "", value, value.Capacity, CONFIG_FILE);

                string configValue = value.ToString().Trim();

                if (!string.IsNullOrEmpty(configValue))
                {
                    result = result.Replace(placeholder, configValue);
                }
                // If not found in [Paths], try [Applications]
                else
                {
                    value = new StringBuilder(500);
                    GetPrivateProfileString("Applications", variableName, "", value, value.Capacity, CONFIG_FILE);
                    configValue = value.ToString().Trim();

                    if (!string.IsNullOrEmpty(configValue))
                    {
                        result = result.Replace(placeholder, configValue);
                    }
                }
            }

            return result;
        }

        /// <summary>
        /// Show error message to user
        /// </summary>
        static void ShowError(string message)
        {
            MessageBox.Show(
                message,
                "Universal Protocol Handler",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }
    }
}
