import { useState, useEffect, useCallback, useRef, ChangeEvent, MouseEvent } from 'react';
import styles from './DatabaseSettings.module.css';
import {
    isFileSystemAccessSupported,
    checkBrowserSupport,
    pickIniFile,
    readTextFile,
    writeTextFile,
    saveHandle,
    getFileHandle,
    removeHandle,
    checkPermission,
    ensurePermission,
    isAbortError,
    isNotFoundError,
    type BrowserSupportResult,
    type FileOperationResult
} from '../../core/fileSystemAccess';
import {
    parseIniContent,
    formatIniContent,
    mergeConfigs,
    getProtocolHandlerFormatOptions,
    type IniConfig,
    type IniSection
} from '../../core/iniParser';
import { useToast } from '../../contexts/ToastContext';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface PendingChanges {
    [section: string]: {
        [key: string]: string;
    };
}

interface FileInfo {
    name: string;
    lastModified: Date;
    size: number;
}

interface ModalState {
    show: boolean;
    title: string;
    message: string;
}

interface ProtocolHandlersSettingsProps {
    onChangesUpdate?: (hasChanges: boolean) => void;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const HANDLE_STORAGE_KEY = 'protocol-handlers-ini';

// Key descriptions for documentation
const KEY_DESCRIPTIONS: Record<string, string> = {
    PatientsFolder: 'Network share or local path for patient records (e.g., \\\\Clinic\\clinic1)',
    AccessDatabase: 'MS Access database path for labels/reports',
    DolphinPath: 'Dolphin Imaging installation directory (contains DolCtrl.exe)',
    MemoryCardPath: 'Default folder for photo import (memory card path)',
    TShapePath: 'Full path to 3Shape Unite executable',
    TShapeAllowedComputer: 'Restrict 3Shape to specific computer (leave empty for no restriction)',
    UseRunAsDate: 'Enable RunAsDate workaround for legacy Dolphin (true/false)',
    RunAsDatePath: 'Full path to RunAsDate.exe utility',
    msaccess: 'Path to Microsoft Access executable'
};

// ============================================================================
// COMPONENT
// ============================================================================

const ProtocolHandlersSettings = ({ onChangesUpdate }: ProtocolHandlersSettingsProps) => {
    const toast = useToast();
    const lastReportedChanges = useRef<boolean | null>(null);

    // Configuration state
    const [config, setConfig] = useState<IniConfig>({});
    const [pendingChanges, setPendingChanges] = useState<PendingChanges>({});

    // File System Access state
    const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | null>(null);
    const [hasFileAccess, setHasFileAccess] = useState(false);
    const [browserSupport, setBrowserSupport] = useState<BrowserSupportResult | null>(null);
    const [permissionState, setPermissionState] = useState<PermissionState>('prompt');
    const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);

    // UI state
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [modal, setModal] = useState<ModalState>({ show: false, title: '', message: '' });
    const [configError, setConfigError] = useState<string | null>(null);

    // ========================================================================
    // INITIALIZATION
    // ========================================================================

    useEffect(() => {
        // Check browser support on mount
        const support = checkBrowserSupport();
        setBrowserSupport(support);

        if (support.isSupported) {
            loadSavedHandle();
        }
    }, []);

    useEffect(() => {
        // Notify parent component about changes
        if (onChangesUpdate) {
            const hasChanges = Object.keys(pendingChanges).some(
                section => Object.keys(pendingChanges[section]).length > 0
            );
            // Only call if value actually changed to prevent infinite loops
            if (lastReportedChanges.current !== hasChanges) {
                lastReportedChanges.current = hasChanges;
                onChangesUpdate(hasChanges);
            }
        }
    }, [pendingChanges, onChangesUpdate]);

    // ========================================================================
    // FILE HANDLE MANAGEMENT
    // ========================================================================

    const loadSavedHandle = useCallback(async () => {
        try {
            const savedHandle = await getFileHandle(HANDLE_STORAGE_KEY);
            if (savedHandle) {
                const permission = await checkPermission(savedHandle, 'readwrite');
                setPermissionState(permission);

                if (permission === 'granted') {
                    setFileHandle(savedHandle);
                    setHasFileAccess(true);
                    await loadConfigFromFile(savedHandle);
                } else {
                    // Handle exists but permission not granted yet
                    setFileHandle(savedHandle);
                }
            }
        } catch (error) {
            console.error('Error loading saved handle:', error);
        }
    }, []);

    const selectIniFile = async (): Promise<void> => {
        setIsLoading(true);
        setConfigError(null);

        try {
            const result = await pickIniFile();

            if (!result.success) {
                if (!isAbortError({ name: result.errorName })) {
                    setConfigError(result.error || 'Failed to select file');
                }
                return;
            }

            if (result.data) {
                const handle = result.data;

                // Save handle for persistence
                await saveHandle(HANDLE_STORAGE_KEY, handle, {
                    fileName: handle.name
                });

                setFileHandle(handle);
                setHasFileAccess(true);
                setPermissionState('granted');

                await loadConfigFromFile(handle);
                toast.success('INI file loaded successfully');
            }
        } catch (error) {
            console.error('Error selecting INI file:', error);
            setConfigError('Failed to select file: ' + (error as Error).message);
        } finally {
            setIsLoading(false);
        }
    };

    const requestFilePermission = async (): Promise<void> => {
        if (!fileHandle) return;

        try {
            const granted = await ensurePermission(fileHandle, 'readwrite');

            if (granted) {
                setPermissionState('granted');
                setHasFileAccess(true);
                await loadConfigFromFile(fileHandle);
                toast.success('Permission granted');
            } else {
                setPermissionState('denied');
                toast.warning('Permission denied. Please try again.');
            }
        } catch (error) {
            console.error('Error requesting permission:', error);
            toast.error('Failed to request permission');
        }
    };

    const changeFile = async (): Promise<void> => {
        // Clear current handle and let user select a new one
        await removeHandle(HANDLE_STORAGE_KEY);
        setFileHandle(null);
        setHasFileAccess(false);
        setConfig({});
        setPendingChanges({});
        setFileInfo(null);
        setConfigError(null);

        // Immediately prompt for new file
        await selectIniFile();
    };

    // ========================================================================
    // FILE OPERATIONS
    // ========================================================================

    const loadConfigFromFile = async (handle: FileSystemFileHandle): Promise<void> => {
        setIsLoading(true);
        setConfigError(null);

        try {
            // Get file info
            const file = await handle.getFile();
            setFileInfo({
                name: file.name,
                lastModified: new Date(file.lastModified),
                size: file.size
            });

            // Read and parse content
            const result = await readTextFile(handle);

            if (!result.success) {
                throw new Error(result.error || 'Failed to read file');
            }

            const parsed = parseIniContent(result.data || '');
            setConfig(parsed);
            setPendingChanges({});
        } catch (error) {
            console.error('Error loading config from file:', error);

            if (isNotFoundError(error)) {
                // File was deleted/moved
                await removeHandle(HANDLE_STORAGE_KEY);
                setFileHandle(null);
                setHasFileAccess(false);
                setConfigError('File not found. Please select the INI file again.');
            } else {
                setConfigError('Failed to load configuration: ' + (error as Error).message);
            }
        } finally {
            setIsLoading(false);
        }
    };

    const saveConfiguration = async (): Promise<void> => {
        if (!fileHandle) {
            toast.error('No file selected');
            return;
        }

        const totalChanges = Object.values(pendingChanges).reduce(
            (sum, section) => sum + Object.keys(section).length,
            0
        );

        if (totalChanges === 0) {
            showModal('Info', 'No changes to save.');
            return;
        }

        setIsSaving(true);

        try {
            // Ensure we have write permission
            const hasPermission = await ensurePermission(fileHandle, 'readwrite');
            if (!hasPermission) {
                showModal('Permission Denied', 'Cannot save without write permission. Please grant access and try again.');
                return;
            }

            // Merge pending changes with current config
            const mergedConfig = mergeConfigs(config, pendingChanges);

            // Format and write to file
            const content = formatIniContent(mergedConfig, getProtocolHandlerFormatOptions());
            const result = await writeTextFile(fileHandle, content);

            if (!result.success) {
                throw new Error(result.error || 'Failed to write file');
            }

            // Update state
            setConfig(mergedConfig);
            setPendingChanges({});

            // Refresh file info
            const file = await fileHandle.getFile();
            setFileInfo({
                name: file.name,
                lastModified: new Date(file.lastModified),
                size: file.size
            });

            showModal('Success', 'Configuration saved successfully.\n\nNote: Protocol handlers will use the new settings immediately.');
        } catch (error) {
            console.error('Error saving config:', error);
            showModal('Error', 'Failed to save configuration: ' + (error as Error).message);
        } finally {
            setIsSaving(false);
        }
    };

    const createBackup = async (): Promise<void> => {
        if (!browserSupport?.isSupported) {
            toast.error('File System Access API not supported');
            return;
        }

        try {
            // Merge any pending changes for backup
            const currentConfig = mergeConfigs(config, pendingChanges);
            const content = formatIniContent(currentConfig, getProtocolHandlerFormatOptions());

            // Use save file picker for backup
            const backupHandle = await window.showSaveFilePicker({
                suggestedName: 'ProtocolHandlers.ini.backup',
                types: [{
                    description: 'INI Backup Files',
                    accept: { 'text/plain': ['.ini', '.backup'] }
                }]
            });

            const result = await writeTextFile(backupHandle, content);

            if (result.success) {
                showModal('Success', 'Backup created successfully.');
            } else {
                throw new Error(result.error || 'Failed to create backup');
            }
        } catch (error) {
            if (!isAbortError(error)) {
                console.error('Error creating backup:', error);
                showModal('Error', 'Failed to create backup: ' + (error as Error).message);
            }
        }
    };

    const restoreFromBackup = async (): Promise<void> => {
        if (!fileHandle) {
            toast.error('No target file selected');
            return;
        }

        if (!window.confirm('Are you sure you want to restore from backup? Current configuration will be overwritten.')) {
            return;
        }

        try {
            // Pick a backup file to restore from
            const result = await pickIniFile();

            if (!result.success || !result.data) {
                if (!isAbortError({ name: result.errorName })) {
                    toast.error(result.error || 'Failed to select backup file');
                }
                return;
            }

            // Read backup content
            const backupContent = await readTextFile(result.data);

            if (!backupContent.success) {
                throw new Error(backupContent.error || 'Failed to read backup file');
            }

            // Parse backup
            const parsed = parseIniContent(backupContent.data || '');

            // Ensure we have write permission for target
            const hasPermission = await ensurePermission(fileHandle, 'readwrite');
            if (!hasPermission) {
                toast.error('Cannot write without permission');
                return;
            }

            // Write to target file
            const content = formatIniContent(parsed, getProtocolHandlerFormatOptions());
            const writeResult = await writeTextFile(fileHandle, content);

            if (!writeResult.success) {
                throw new Error(writeResult.error || 'Failed to write restored config');
            }

            // Update state
            setConfig(parsed);
            setPendingChanges({});

            // Refresh file info
            const file = await fileHandle.getFile();
            setFileInfo({
                name: file.name,
                lastModified: new Date(file.lastModified),
                size: file.size
            });

            showModal('Success', 'Configuration restored from backup.');
        } catch (error) {
            if (!isAbortError(error)) {
                console.error('Error restoring from backup:', error);
                showModal('Error', 'Failed to restore from backup: ' + (error as Error).message);
            }
        }
    };

    const reloadConfig = async (): Promise<void> => {
        if (fileHandle) {
            await loadConfigFromFile(fileHandle);
            toast.info('Configuration reloaded');
        }
    };

    // ========================================================================
    // UI HELPERS
    // ========================================================================

    const showModal = (title: string, message: string) => {
        setModal({ show: true, title, message });
    };

    const hideModal = () => {
        setModal({ show: false, title: '', message: '' });
    };

    const handleInputChange = (section: string, key: string, value: string) => {
        const originalValue = config[section]?.[key] || '';

        if (value !== originalValue) {
            setPendingChanges(prev => ({
                ...prev,
                [section]: {
                    ...(prev[section] || {}),
                    [key]: value
                }
            }));
        } else {
            setPendingChanges(prev => {
                const updated = { ...prev };
                if (updated[section]) {
                    delete updated[section][key];
                    if (Object.keys(updated[section]).length === 0) {
                        delete updated[section];
                    }
                }
                return updated;
            });
        }
    };

    const getCurrentValue = (section: string, key: string): string => {
        return pendingChanges[section]?.[key] ?? config[section]?.[key] ?? '';
    };

    const hasFieldChange = (section: string, key: string): boolean => {
        return pendingChanges[section]?.[key] !== undefined;
    };

    const hasChanges = Object.keys(pendingChanges).some(
        section => Object.keys(pendingChanges[section]).length > 0
    );

    const totalChanges = Object.values(pendingChanges).reduce(
        (sum, section) => sum + Object.keys(section).length,
        0
    );

    // ========================================================================
    // RENDER HELPERS
    // ========================================================================

    const renderSection = (sectionName: string, sectionData: IniSection) => {
        const sectionIcons: Record<string, string> = {
            Paths: 'fas fa-folder-open',
            Applications: 'fas fa-desktop'
        };

        const sectionTitles: Record<string, string> = {
            Paths: 'Path Configuration',
            Applications: 'Application Aliases'
        };

        return (
            <div key={sectionName} className={styles.configGroup}>
                <h4>
                    <i className={sectionIcons[sectionName] || 'fas fa-cog'}></i>
                    {sectionTitles[sectionName] || sectionName}
                </h4>

                {Object.entries(sectionData).map(([key, value]) => (
                    <div key={key} className={styles.settingGroup}>
                        <label htmlFor={`${sectionName}_${key}`}>{key}</label>
                        {key === 'UseRunAsDate' ? (
                            <select
                                id={`${sectionName}_${key}`}
                                value={getCurrentValue(sectionName, key)}
                                onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                                    handleInputChange(sectionName, key, e.target.value)
                                }
                                className={hasFieldChange(sectionName, key) ? styles.pendingChange : ''}
                            >
                                <option value="false">Disabled (use DolCtrl.exe)</option>
                                <option value="true">Enabled (use RunAsDate + dolphin64.exe)</option>
                            </select>
                        ) : (
                            <input
                                type="text"
                                id={`${sectionName}_${key}`}
                                value={getCurrentValue(sectionName, key)}
                                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                    handleInputChange(sectionName, key, e.target.value)
                                }
                                placeholder={`Enter ${key}`}
                                className={hasFieldChange(sectionName, key) ? styles.pendingChange : ''}
                            />
                        )}
                        <div className={styles.settingDescription}>
                            {KEY_DESCRIPTIONS[key] || `Configuration value for ${key}`}
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    const renderBrowserNotSupported = () => (
        <div className={`${styles.connectionStatus} ${styles.error}`}>
            <div className={styles.statusHeader}>
                <i className="fas fa-browser"></i>
                <span>Browser Not Supported</span>
            </div>
            <div className={styles.statusDetails}>
                <p>The File System Access API is required to edit local configuration files.</p>
                <p style={{ marginTop: 'var(--spacing-md)' }}>Please use one of these browsers:</p>
                <ul style={{ marginTop: 'var(--spacing-sm)', marginLeft: 'var(--spacing-lg)' }}>
                    <li><i className="fab fa-chrome" style={{ marginRight: 'var(--spacing-sm)' }}></i>Google Chrome 86+</li>
                    <li><i className="fab fa-edge" style={{ marginRight: 'var(--spacing-sm)' }}></i>Microsoft Edge 86+</li>
                </ul>
                <p style={{ marginTop: 'var(--spacing-md)', color: 'var(--text-secondary)' }}>
                    Alternatively, you can manually edit the file at:<br />
                    <code>C:\ShwanOrtho\ProtocolHandlers.ini</code>
                </p>
            </div>
        </div>
    );

    const renderFileSelection = () => (
        <div className={styles.configGroup}>
            <h4><i className="fas fa-file-alt"></i> Select Configuration File</h4>
            <p style={{ marginBottom: 'var(--spacing-md)' }}>
                To edit the protocol handler configuration, you need to select the INI file on your local computer.
            </p>
            <p style={{ marginBottom: 'var(--spacing-lg)', color: 'var(--text-secondary)' }}>
                Default location: <code>C:\ShwanOrtho\ProtocolHandlers.ini</code>
            </p>
            <button
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={selectIniFile}
                disabled={isLoading}
            >
                {isLoading ? (
                    <>
                        <i className="fas fa-spinner fa-spin"></i>
                        Loading...
                    </>
                ) : (
                    <>
                        <i className="fas fa-folder-open"></i>
                        Select INI File
                    </>
                )}
            </button>
        </div>
    );

    const renderPermissionRequest = () => (
        <div className={styles.configGroup}>
            <h4><i className="fas fa-key"></i> Permission Required</h4>
            <p style={{ marginBottom: 'var(--spacing-md)' }}>
                The browser needs permission to access the configuration file.
            </p>
            {fileHandle && (
                <p style={{ marginBottom: 'var(--spacing-lg)', color: 'var(--text-secondary)' }}>
                    File: <code>{fileHandle.name}</code>
                </p>
            )}
            <button
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={requestFilePermission}
            >
                <i className="fas fa-key"></i>
                Grant Permission
            </button>
            <button
                className={`${styles.btn} ${styles.btnSecondary}`}
                onClick={changeFile}
                style={{ marginLeft: 'var(--spacing-md)' }}
            >
                <i className="fas fa-file"></i>
                Select Different File
            </button>
        </div>
    );

    const renderFileInfo = () => (
        <div className={styles.configGroup}>
            <h4><i className="fas fa-file-alt"></i> File Status</h4>
            <div style={{ display: 'flex', gap: 'var(--spacing-lg)', flexWrap: 'wrap', alignItems: 'center' }}>
                <div>
                    <strong>File:</strong>{' '}
                    <code>{fileInfo?.name || fileHandle?.name || 'Unknown'}</code>
                </div>
                {fileInfo?.lastModified && (
                    <div>
                        <strong>Last modified:</strong>{' '}
                        {fileInfo.lastModified.toLocaleString()}
                    </div>
                )}
                {fileInfo?.size !== undefined && (
                    <div>
                        <strong>Size:</strong> {fileInfo.size} bytes
                    </div>
                )}
                <button
                    className={styles.btnLink}
                    onClick={changeFile}
                    style={{ marginLeft: 'auto' }}
                >
                    <i className="fas fa-exchange-alt"></i>
                    Change File
                </button>
            </div>
        </div>
    );

    // ========================================================================
    // MAIN RENDER
    // ========================================================================

    return (
        <div className={styles.container}>
            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>
                    <i className="fas fa-link"></i>
                    Protocol Handler Configuration
                </h3>
                <p className={styles.sectionDescription}>
                    Configure Windows protocol handlers for Dolphin, CS Imaging, and other integrations.
                    File location: C:\ShwanOrtho\ProtocolHandlers.ini
                </p>

                <div className={styles.restartWarning} style={{ marginBottom: 'var(--spacing-lg)', background: 'var(--info-50, #eff6ff)', borderColor: 'var(--info-200, #bfdbfe)', color: 'var(--info-800, #1e40af)' }}>
                    <i className="fas fa-info-circle" style={{ color: 'var(--info-color)' }}></i>
                    <span>
                        <strong>Note:</strong> This page edits the INI file on <strong>this computer</strong>.
                        Each PC has its own configuration file at C:\ShwanOrtho\ProtocolHandlers.ini.
                    </span>
                </div>

                {/* Browser not supported */}
                {browserSupport && !browserSupport.isSupported && renderBrowserNotSupported()}

                {/* Browser supported but no file selected */}
                {browserSupport?.isSupported && !fileHandle && renderFileSelection()}

                {/* File selected but permission not granted */}
                {browserSupport?.isSupported && fileHandle && permissionState !== 'granted' && renderPermissionRequest()}

                {/* File access granted - show config editor */}
                {browserSupport?.isSupported && hasFileAccess && (
                    <>
                        {isLoading ? (
                            <div className={styles.loadingSpinner}>
                                <i className="fas fa-spinner fa-spin"></i>
                                <span>Loading protocol handler configuration...</span>
                            </div>
                        ) : configError ? (
                            <div className={`${styles.connectionStatus} ${styles.error}`}>
                                <div className={styles.statusHeader}>
                                    <i className="fas fa-exclamation-circle"></i>
                                    <span>Configuration Error</span>
                                </div>
                                <div className={styles.statusDetails}>{configError}</div>
                                <div style={{ marginTop: 'var(--spacing-md)' }}>
                                    <button
                                        className={`${styles.btn} ${styles.btnSecondary}`}
                                        onClick={reloadConfig}
                                    >
                                        <i className="fas fa-redo"></i>
                                        Retry
                                    </button>
                                    <button
                                        className={`${styles.btn} ${styles.btnSecondary}`}
                                        onClick={changeFile}
                                        style={{ marginLeft: 'var(--spacing-md)' }}
                                    >
                                        <i className="fas fa-file"></i>
                                        Select Different File
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <>
                                {/* File Status */}
                                {renderFileInfo()}

                                {/* Render each section */}
                                {Object.entries(config).map(([sectionName, sectionData]) =>
                                    renderSection(sectionName, sectionData)
                                )}

                                {/* Empty config message */}
                                {Object.keys(config).length === 0 && (
                                    <div className={styles.configGroup}>
                                        <p style={{ color: 'var(--text-secondary)', textAlign: 'center' }}>
                                            <i className="fas fa-info-circle" style={{ marginRight: 'var(--spacing-sm)' }}></i>
                                            No configuration found in file. The file may be empty or have an invalid format.
                                        </p>
                                    </div>
                                )}
                            </>
                        )}
                    </>
                )}
            </div>

            {/* Action buttons - only show when file access is granted and no error */}
            {browserSupport?.isSupported && hasFileAccess && !configError && !isLoading && (
                <div className={styles.actions}>
                    <button
                        className={`${styles.btn} ${styles.btnPrimary}`}
                        onClick={saveConfiguration}
                        disabled={!hasChanges || isSaving}
                    >
                        {isSaving ? (
                            <>
                                <i className="fas fa-spinner fa-spin"></i>
                                Saving...
                            </>
                        ) : (
                            <>
                                <i className="fas fa-save"></i>
                                {hasChanges
                                    ? `Save Configuration (${totalChanges} changes)`
                                    : 'Save Configuration'
                                }
                            </>
                        )}
                    </button>

                    <button
                        className={`${styles.btn} ${styles.btnSecondary}`}
                        onClick={createBackup}
                    >
                        <i className="fas fa-copy"></i>
                        Create Backup
                    </button>

                    <button
                        className={`${styles.btn} ${styles.btnWarning}`}
                        onClick={restoreFromBackup}
                    >
                        <i className="fas fa-undo"></i>
                        Restore from Backup
                    </button>

                    <button
                        className={`${styles.btn} ${styles.btnInfo}`}
                        onClick={reloadConfig}
                        disabled={isLoading}
                    >
                        <i className="fas fa-sync-alt"></i>
                        Reload
                    </button>
                </div>
            )}

            {hasChanges && (
                <div className={styles.restartWarning}>
                    <i className="fas fa-info-circle"></i>
                    <span>Protocol handlers will use the new settings immediately after saving.</span>
                </div>
            )}

            {/* Modal */}
            {modal.show && (
                <div className={styles.modalOverlay} onClick={hideModal}>
                    <div className={styles.modalContent} onClick={(e: MouseEvent) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h3>{modal.title}</h3>
                            <button className={styles.modalClose} onClick={hideModal}>
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        <div className={styles.modalBody}>
                            <pre>{modal.message}</pre>
                        </div>
                        <div className={styles.modalFooter}>
                            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={hideModal}>OK</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProtocolHandlersSettings;
