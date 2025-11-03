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
                // Or:     launch://C:/full/path/app.exe?args=arg1|arg2|arg3

                Uri uri = new Uri(url);
                string appIdentifier = uri.Host; // alias or drive letter (C)
                string pathPart = uri.AbsolutePath; // empty for alias, or /path/to/app.exe for full path
                string query = uri.Query; // ?args=...

                // Determine if this is an alias or full path
                string executablePath = null;

                if (string.IsNullOrEmpty(pathPart) || pathPart == "/")
                {
                    // It's an alias (e.g., launch://msaccess)
                    executablePath = GetApplicationPath(appIdentifier);

                    if (string.IsNullOrEmpty(executablePath))
                    {
                        ShowError("Application alias not found: " + appIdentifier + "\n\n" +
                                "Please add it to C:\\Windows\\ProtocolHandlers.ini in the [Applications] section.\n\n" +
                                "Example:\n" +
                                appIdentifier + "=C:\\Path\\To\\Application.exe");
                        return;
                    }
                }
                else
                {
                    // It's a full path (e.g., launch://C:/Program%20Files/App/app.exe)
                    // Reconstruct the full path
                    executablePath = appIdentifier + ":" + pathPart;
                    executablePath = HttpUtility.UrlDecode(executablePath);

                    // Check whitelist if enabled
                    if (IsWhitelistEnabled())
                    {
                        ShowError("Security Error:\n\n" +
                                "Full executable paths are disabled.\n" +
                                "UseWhitelist=true in configuration.\n\n" +
                                "Please use application aliases instead,\n" +
                                "or set UseWhitelist=false in:\n" +
                                "C:\\Windows\\ProtocolHandlers.ini");
                        return;
                    }
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
                        "launch://alias?args=arg1|arg2\n" +
                        "or\n" +
                        "launch://C:/path/to/app.exe?args=arg1|arg2");
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
        /// Check if whitelist mode is enabled in INI file
        /// </summary>
        static bool IsWhitelistEnabled()
        {
            if (!File.Exists(CONFIG_FILE))
            {
                return false; // Default: allow full paths
            }

            StringBuilder result = new StringBuilder(50);
            GetPrivateProfileString("Security", "UseWhitelist", "false", result, result.Capacity, CONFIG_FILE);

            string value = result.ToString().Trim().ToLower();
            return value == "true" || value == "1" || value == "yes";
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
