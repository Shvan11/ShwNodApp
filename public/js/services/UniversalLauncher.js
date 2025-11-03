/**
 * Universal Protocol Launcher Service
 *
 * Provides a clean JavaScript API for launching external applications
 * via the launch:// protocol handler.
 *
 * @example
 * import { UniversalLauncher } from '/js/services/UniversalLauncher.js';
 *
 * // Print labels from Access database
 * UniversalLauncher.printAlignerLabels(193, 'Sibar Fathil', 1);
 *
 * // Launch any application
 * UniversalLauncher.launch('notepad', ['C:\\file.txt']);
 */

export class UniversalLauncher {
  /**
   * Launch an application with arguments
   *
   * @param {string} appIdentifier - Application alias or full path
   * @param {string[]} args - Array of arguments (will be pipe-separated)
   *
   * @example
   * // Using alias
   * UniversalLauncher.launch('msaccess', ['{AccessDatabase}']);
   *
   * // Using full path
   * UniversalLauncher.launch('C:/Windows/System32/notepad.exe', ['file.txt']);
   *
   * // Multiple arguments
   * UniversalLauncher.launch('msaccess', [
   *   '{AccessDatabase}',
   *   '/cmd',
   *   'frmMain',
   *   'Parameter1',
   *   'Parameter2'
   * ]);
   */
  static launch(appIdentifier, args = []) {
    try {
      // Build the arguments string (pipe-separated)
      const argsString = args.join('|');

      // URL-encode the arguments
      const encodedArgs = encodeURIComponent(argsString);

      // URL-encode the app identifier if it's a full path
      const encodedApp = appIdentifier.includes(':') || appIdentifier.includes('\\') || appIdentifier.includes('/')
        ? encodeURIComponent(appIdentifier)
        : appIdentifier;

      // Build the protocol URL
      const url = args.length > 0
        ? `launch://${encodedApp}?args=${encodedArgs}`
        : `launch://${encodedApp}`;

      // Launch the protocol
      window.location.href = url;

      return true;
    } catch (error) {
      console.error('Failed to launch application:', error);
      return false;
    }
  }

  /**
   * Print aligner labels from MS Access database
   *
   * This launches MS Access with the labels form and passes the required parameters.
   *
   * @param {number} alignerBatchId - The aligner batch ID
   * @param {string} patientName - Patient full name
   * @param {number} drId - Doctor ID
   *
   * @example
   * UniversalLauncher.printAlignerLabels(193, 'Sibar Fathil', 1);
   */
  static printAlignerLabels(alignerBatchId, patientName, drId) {
    return this.launch('msaccess', [
      '{AccessDatabase}',
      '/cmd',
      'frmLabels',
      `AlignerBatchID = ${alignerBatchId}`,
      patientName,
      drId.toString()
    ]);
  }

  /**
   * Launch MS Access with a specific form and parameters
   *
   * @param {string} formName - Name of the Access form
   * @param {Object} params - Key-value pairs of parameters
   *
   * @example
   * UniversalLauncher.openAccessForm('frmPatients', {
   *   PatientID: 12345,
   *   Mode: 'View'
   * });
   */
  static openAccessForm(formName, params = {}) {
    const args = ['{AccessDatabase}', '/cmd', formName];

    // Add parameters as pipe-separated values
    Object.entries(params).forEach(([key, value]) => {
      args.push(`${key} = ${value}`);
    });

    return this.launch('msaccess', args);
  }

  /**
   * Open MS Access database
   *
   * @param {string} databasePath - Path to .accdb file (or use {AccessDatabase})
   *
   * @example
   * UniversalLauncher.openAccessDatabase('{AccessDatabase}');
   * UniversalLauncher.openAccessDatabase('C:\\MyDB\\data.accdb');
   */
  static openAccessDatabase(databasePath = '{AccessDatabase}') {
    return this.launch('msaccess', [databasePath]);
  }

  /**
   * Launch Excel with a specific file
   *
   * @param {string} filePath - Path to Excel file
   *
   * @example
   * UniversalLauncher.openExcel('C:\\Reports\\data.xlsx');
   * UniversalLauncher.openExcel('\\\\Server\\Share\\file.xlsx');
   */
  static openExcel(filePath) {
    return this.launch('excel', [filePath]);
  }

  /**
   * Launch Word with a specific document
   *
   * @param {string} filePath - Path to Word document
   *
   * @example
   * UniversalLauncher.openWord('C:\\Documents\\letter.docx');
   */
  static openWord(filePath) {
    return this.launch('word', [filePath]);
  }

  /**
   * Launch Notepad with a file
   *
   * @param {string} filePath - Path to text file
   *
   * @example
   * UniversalLauncher.openNotepad('C:\\temp\\notes.txt');
   */
  static openNotepad(filePath) {
    return this.launch('notepad', [filePath]);
  }

  /**
   * Open a folder in Windows Explorer
   *
   * Note: This uses the universal protocol. For creating folders,
   * use the dedicated explorer:// protocol instead.
   *
   * @param {string} folderPath - Path to folder
   *
   * @example
   * UniversalLauncher.openFolder('C:\\Users\\Documents');
   * UniversalLauncher.openFolder('{PatientsFolder}\\12345');
   */
  static openFolder(folderPath) {
    return this.launch('C:/Windows/explorer.exe', [folderPath]);
  }

  /**
   * Launch a custom application with raw arguments
   *
   * @param {string} exePath - Full path to executable
   * @param {string[]} args - Array of arguments
   *
   * @example
   * UniversalLauncher.launchCustomApp(
   *   'C:\\MyApps\\CustomTool.exe',
   *   ['--input', 'file.dat', '--output', 'result.txt']
   * );
   */
  static launchCustomApp(exePath, args = []) {
    return this.launch(exePath, args);
  }
}

/**
 * Global convenience function for quick access
 * You can also use UniversalLauncher.launch() directly
 */
export function launchApp(appIdentifier, args = []) {
  return UniversalLauncher.launch(appIdentifier, args);
}

export default UniversalLauncher;
