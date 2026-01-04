using System;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using System.Web;
using System.Windows.Forms;

namespace ExplorerProtocolHandler
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

                // Strip the "explorer:" protocol prefix (case-insensitive)
                // Using Regex for C# 5 compatibility
                string folderPath = Regex.Replace(url, "^explorer:", "", RegexOptions.IgnoreCase);

                // URL decode the path
                folderPath = HttpUtility.UrlDecode(folderPath);

                // Check if folder path is valid
                if (!string.IsNullOrEmpty(folderPath))
                {
                    // Extract the root network share (e.g., \\WORK_PC\Aligner_Sets)
                    string rootShare = GetNetworkShareRoot(folderPath);

                    // Check if network share is accessible
                    if (!string.IsNullOrEmpty(rootShare) && !Directory.Exists(rootShare))
                    {
                        MessageBox.Show(
                            "Network share is not accessible:\n\n" + rootShare + "\n\n" +
                            "Please ensure:\n" +
                            "1. The network location is available\n" +
                            "2. You have proper permissions\n" +
                            "3. You are connected to the network",
                            "Network Share Not Accessible",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Error
                        );
                        return;
                    }

                    if (!Directory.Exists(folderPath))
                    {
                        // Ask user if they want to create the folder
                        DialogResult result = MessageBox.Show(
                            "Folder does not exist:\n\n" + folderPath + "\n\nDo you want to create it?",
                            "Create Folder?",
                            MessageBoxButtons.YesNo,
                            MessageBoxIcon.Question
                        );

                        if (result == DialogResult.Yes)
                        {
                            // Create the folder structure
                            Directory.CreateDirectory(folderPath);

                            // Open the newly created folder
                            Process.Start("explorer.exe", folderPath);
                        }
                        // If user clicks No, do nothing (exit silently)
                    }
                    else
                    {
                        // Folder exists, just open it
                        Process.Start("explorer.exe", folderPath);
                    }
                }
            }
            catch (Exception ex)
            {
                // Show error dialog for any issues
                MessageBox.Show(
                    "Error opening/creating folder:\n\n" + ex.Message,
                    "Explorer Protocol Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }

        // Helper method to extract network share root from full path
        static string GetNetworkShareRoot(string path)
        {
            try
            {
                // Check if it's a UNC path (starts with \\)
                if (path.StartsWith("\\\\"))
                {
                    // Split the path: \\server\share\folder1\folder2
                    string[] parts = path.Substring(2).Split(new[] { '\\' }, StringSplitOptions.RemoveEmptyEntries);

                    if (parts.Length >= 2)
                    {
                        // Return \\server\share
                        return "\\\\" + parts[0] + "\\" + parts[1];
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
