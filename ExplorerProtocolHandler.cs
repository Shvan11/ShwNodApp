using System;
using System.Diagnostics;
using System.Text.RegularExpressions;
using System.Web;

namespace ExplorerProtocolHandler
{
    class Program
    {
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

                // Strip the "explorer:" protocol prefix (case-insensitive)
                // Using Regex for C# 5 compatibility
                string folderPath = Regex.Replace(url, "^explorer:", "", RegexOptions.IgnoreCase);

                // URL decode the path
                folderPath = HttpUtility.UrlDecode(folderPath);

                // Open the folder in Windows Explorer
                if (!string.IsNullOrEmpty(folderPath))
                {
                    Process.Start("explorer.exe", folderPath);
                }
            }
            catch
            {
                // Fail silently - no error dialogs
            }
        }
    }
}
