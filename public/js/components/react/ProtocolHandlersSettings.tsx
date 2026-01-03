import { useState, useEffect, ChangeEvent, MouseEvent } from 'react';
import styles from './DatabaseSettings.module.css';

interface IniSection {
    [key: string]: string;
}

interface IniConfig {
    [section: string]: IniSection;
}

interface PendingChanges {
    [section: string]: {
        [key: string]: string;
    };
}

interface FileStatus {
    exists: boolean;
    backupExists: boolean;
    modified?: string;
    size?: number;
}

interface ModalState {
    show: boolean;
    title: string;
    message: string;
}

interface ProtocolHandlersSettingsProps {
    onChangesUpdate?: (hasChanges: boolean) => void;
}

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

const ProtocolHandlersSettings = ({ onChangesUpdate }: ProtocolHandlersSettingsProps) => {
    const [config, setConfig] = useState<IniConfig>({});
    const [pendingChanges, setPendingChanges] = useState<PendingChanges>({});
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [fileStatus, setFileStatus] = useState<FileStatus | null>(null);
    const [modal, setModal] = useState<ModalState>({ show: false, title: '', message: '' });
    const [configError, setConfigError] = useState<string | null>(null);

    useEffect(() => {
        loadConfig();
    }, []);

    useEffect(() => {
        // Notify parent component about changes
        if (onChangesUpdate) {
            const hasChanges = Object.keys(pendingChanges).some(
                section => Object.keys(pendingChanges[section]).length > 0
            );
            onChangesUpdate(hasChanges);
        }
    }, [pendingChanges]);

    const loadConfig = async () => {
        setIsLoading(true);
        setConfigError(null);
        try {
            // Load config and status in parallel
            const [configResponse, statusResponse] = await Promise.all([
                fetch('/api/config/protocol-handlers'),
                fetch('/api/config/protocol-handlers/status')
            ]);

            const configData = await configResponse.json();
            const statusData = await statusResponse.json();

            if (configData.success) {
                setConfig(configData.config);
            } else {
                setConfigError(configData.message || 'Failed to load configuration');
            }

            if (statusData.success) {
                setFileStatus(statusData.status);
            }
        } catch (error) {
            console.error('Error loading protocol handler config:', error);
            setConfigError('Failed to load configuration: ' + (error as Error).message);
        } finally {
            setIsLoading(false);
        }
    };

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

    const saveConfiguration = async () => {
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
            // Merge pending changes with current config
            const mergedConfig: IniConfig = {};
            for (const section of Object.keys(config)) {
                mergedConfig[section] = { ...config[section] };
            }
            for (const section of Object.keys(pendingChanges)) {
                if (!mergedConfig[section]) {
                    mergedConfig[section] = {};
                }
                Object.assign(mergedConfig[section], pendingChanges[section]);
            }

            const response = await fetch('/api/config/protocol-handlers', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ config: mergedConfig })
            });

            const data = await response.json();

            if (data.success) {
                setConfig(mergedConfig);
                setPendingChanges({});
                showModal('Success', 'Configuration saved successfully.\n\nNote: Protocol handlers will use the new settings immediately.');
                // Reload status to get updated file info
                loadFileStatus();
            } else {
                throw new Error(data.message || 'Failed to save configuration');
            }
        } catch (error) {
            console.error('Error saving config:', error);
            showModal('Error', 'Failed to save configuration: ' + (error as Error).message);
        } finally {
            setIsSaving(false);
        }
    };

    const loadFileStatus = async () => {
        try {
            const response = await fetch('/api/config/protocol-handlers/status');
            const data = await response.json();
            if (data.success) {
                setFileStatus(data.status);
            }
        } catch (error) {
            console.error('Error loading file status:', error);
        }
    };

    const createBackup = async () => {
        try {
            const response = await fetch('/api/config/protocol-handlers/backup', {
                method: 'POST'
            });
            const data = await response.json();

            if (data.success) {
                showModal('Success', 'Backup created successfully.');
                loadFileStatus();
            } else {
                throw new Error(data.message || 'Failed to create backup');
            }
        } catch (error) {
            console.error('Error creating backup:', error);
            showModal('Error', 'Failed to create backup: ' + (error as Error).message);
        }
    };

    const restoreFromBackup = async () => {
        if (!window.confirm('Are you sure you want to restore from backup? Current configuration will be overwritten.')) {
            return;
        }

        try {
            const response = await fetch('/api/config/protocol-handlers/restore', {
                method: 'POST'
            });
            const data = await response.json();

            if (data.success) {
                setConfig(data.config);
                setPendingChanges({});
                showModal('Success', 'Configuration restored from backup.');
                loadFileStatus();
            } else {
                throw new Error(data.message || 'Failed to restore from backup');
            }
        } catch (error) {
            console.error('Error restoring from backup:', error);
            showModal('Error', 'Failed to restore from backup: ' + (error as Error).message);
        }
    };

    const hasChanges = Object.keys(pendingChanges).some(
        section => Object.keys(pendingChanges[section]).length > 0
    );

    const totalChanges = Object.values(pendingChanges).reduce(
        (sum, section) => sum + Object.keys(section).length,
        0
    );

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

    return (
        <div className={styles.container}>
            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>
                    <i className="fas fa-link"></i>
                    Protocol Handler Configuration
                </h3>
                <p className={styles.sectionDescription}>
                    Configure Windows protocol handlers for Dolphin, CS Imaging, and other integrations.
                    File location: C:\Windows\ProtocolHandlers.ini
                </p>

                <div className={styles.restartWarning} style={{ marginBottom: 'var(--spacing-lg)', background: 'var(--info-50, #eff6ff)', borderColor: 'var(--info-200, #bfdbfe)', color: 'var(--info-800, #1e40af)' }}>
                    <i className="fas fa-info-circle" style={{ color: 'var(--info-color)' }}></i>
                    <span>
                        <strong>Note:</strong> This configuration is for Windows production environment only.
                        The INI file is located on the Windows system at C:\Windows\ProtocolHandlers.ini.
                    </span>
                </div>

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
                                onClick={loadConfig}
                            >
                                <i className="fas fa-redo"></i>
                                Retry
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* File Status */}
                        {fileStatus && (
                            <div className={styles.configGroup}>
                                <h4><i className="fas fa-file-alt"></i> File Status</h4>
                                <div style={{ display: 'flex', gap: 'var(--spacing-lg)', flexWrap: 'wrap' }}>
                                    <div>
                                        <strong>File exists:</strong>{' '}
                                        <span style={{ color: fileStatus.exists ? 'var(--success-color)' : 'var(--error-color)' }}>
                                            {fileStatus.exists ? 'Yes' : 'No'}
                                        </span>
                                    </div>
                                    <div>
                                        <strong>Backup exists:</strong>{' '}
                                        <span style={{ color: fileStatus.backupExists ? 'var(--success-color)' : 'var(--text-secondary)' }}>
                                            {fileStatus.backupExists ? 'Yes' : 'No'}
                                        </span>
                                    </div>
                                    {fileStatus.modified && (
                                        <div>
                                            <strong>Last modified:</strong>{' '}
                                            {new Date(fileStatus.modified).toLocaleString()}
                                        </div>
                                    )}
                                    {fileStatus.size !== undefined && (
                                        <div>
                                            <strong>Size:</strong> {fileStatus.size} bytes
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Render each section */}
                        {Object.entries(config).map(([sectionName, sectionData]) =>
                            renderSection(sectionName, sectionData)
                        )}
                    </>
                )}
            </div>

            {!configError && (
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
                        disabled={!fileStatus?.exists}
                    >
                        <i className="fas fa-copy"></i>
                        Create Backup
                    </button>

                    <button
                        className={`${styles.btn} ${styles.btnWarning}`}
                        onClick={restoreFromBackup}
                        disabled={!fileStatus?.backupExists}
                    >
                        <i className="fas fa-undo"></i>
                        Restore from Backup
                    </button>

                    <button
                        className={`${styles.btn} ${styles.btnInfo}`}
                        onClick={loadConfig}
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
