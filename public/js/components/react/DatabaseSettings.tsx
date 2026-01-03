import { useState, useEffect, ChangeEvent, MouseEvent } from 'react';
import styles from './DatabaseSettings.module.css';

interface DatabaseConfig {
    DB_SERVER: string;
    DB_INSTANCE: string;
    DB_DATABASE: string;
    DB_USER: string;
    DB_PASSWORD: string;
    DB_ENCRYPT: string;
    DB_TRUST_CERTIFICATE: string;
    [key: string]: string;
}

interface PendingChanges {
    [key: string]: string;
}

interface ConnectionStatus {
    success: boolean;
    message: string;
    details?: string;
}

interface ModalState {
    show: boolean;
    title: string;
    message: string;
}

interface DatabaseSettingsProps {
    onChangesUpdate?: (hasChanges: boolean) => void;
}

const DatabaseSettings = ({ onChangesUpdate }: DatabaseSettingsProps) => {
    const [config, setConfig] = useState<DatabaseConfig>({
        DB_SERVER: '',
        DB_INSTANCE: '',
        DB_DATABASE: '',
        DB_USER: '',
        DB_PASSWORD: '',
        DB_ENCRYPT: 'false',
        DB_TRUST_CERTIFICATE: 'true'
    });
    const [pendingChanges, setPendingChanges] = useState<PendingChanges>({});
    const [isLoading, setIsLoading] = useState(false);
    const [isTestingConnection, setIsTestingConnection] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | null>(null);
    const [showPassword, setShowPassword] = useState(false);
    const [modal, setModal] = useState<ModalState>({ show: false, title: '', message: '' });

    useEffect(() => {
        loadCurrentConfig();
    }, []);

    useEffect(() => {
        // Notify parent component about changes
        if (onChangesUpdate) {
            onChangesUpdate(Object.keys(pendingChanges).length > 0);
        }
    }, [pendingChanges]); // Remove onChangesUpdate from deps since it should be stable

    const loadCurrentConfig = async () => {
        setIsLoading(true);
        try {
            const response = await fetch('/api/config/database');
            const data = await response.json();

            if (data.success) {
                setConfig(data.config);
            } else {
                throw new Error(data.message || 'Failed to load database configuration');
            }
        } catch (error) {
            console.error('Error loading database config:', error);
            showModal('Error', 'Failed to load database configuration: ' + (error as Error).message);
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

    const handleInputChange = (key: string, value: string) => {
        const originalValue = config[key];

        if (value !== originalValue) {
            setPendingChanges(prev => ({
                ...prev,
                [key]: value
            }));
        } else {
            setPendingChanges(prev => {
                const updated = { ...prev };
                delete updated[key];
                return updated;
            });
        }
    };

    const testConnection = async () => {
        setIsTestingConnection(true);
        setConnectionStatus(null);

        try {
            // Get current values (including pending changes)
            const testConfig = { ...config, ...pendingChanges };

            // Check if password is masked (security feature)
            if (testConfig.DB_PASSWORD === '••••••••') {
                setConnectionStatus({
                    success: false,
                    message: 'Cannot test with masked password',
                    details: 'Please enter a new password to test the connection. Existing passwords are masked for security.'
                });
                setIsTestingConnection(false);
                return;
            }

            const response = await fetch('/api/config/database/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(testConfig)
            });

            const data = await response.json();

            setConnectionStatus({
                success: data.success,
                message: data.message,
                details: data.details
            });

        } catch (error) {
            setConnectionStatus({
                success: false,
                message: 'Connection test failed',
                details: (error as Error).message
            });
        } finally {
            setIsTestingConnection(false);
        }
    };

    const saveConfiguration = async () => {
        if (Object.keys(pendingChanges).length === 0) {
            showModal('Info', 'No changes to save.');
            return;
        }

        try {
            // Get complete configuration (current + pending changes)
            const completeConfig = { ...config, ...pendingChanges };

            const response = await fetch('/api/config/database', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(completeConfig)
            });

            const data = await response.json();

            if (data.success) {
                // Update local state
                setConfig(prev => ({ ...prev, ...pendingChanges }));
                setPendingChanges({});

                if (data.requiresRestart) {
                    // Use confirm dialog for restart
                    const shouldRestart = window.confirm(
                        data.message + '\n\n' +
                        'The application must be restarted for database changes to take effect.\n\n' +
                        'Click OK to restart now, or Cancel to restart later.'
                    );

                    if (shouldRestart) {
                        restartApplication();
                    } else {
                        showModal('Success', data.message + '\n\nRemember to restart the application for changes to take effect.');
                    }
                } else {
                    showModal('Success', data.message);
                }
            } else {
                throw new Error(data.message || 'Failed to save configuration');
            }

        } catch (error) {
            console.error('Error saving database config:', error);
            showModal('Error', 'Failed to save database configuration: ' + (error as Error).message);
        }
    };

    const exportConfiguration = async () => {
        try {
            const response = await fetch('/api/config/database/export');
            const data = await response.json();

            if (data.success) {
                // Create downloadable file
                const blob = new Blob([JSON.stringify(data.config, null, 2)], {
                    type: 'application/json'
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `database-config-${new Date().toISOString().split('T')[0]}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                showModal('Success', 'Configuration exported successfully.');
            } else {
                throw new Error(data.message || 'Failed to export configuration');
            }
        } catch (error) {
            console.error('Error exporting configuration:', error);
            showModal('Error', 'Failed to export configuration: ' + (error as Error).message);
        }
    };

    const restartApplication = async () => {
        try {
            const response = await fetch('/api/system/restart', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: 'Database configuration update' })
            });

            const data = await response.json();

            if (data.success) {
                showModal('Restarting', 'Application is restarting. Please wait...');

                // Check if server is back up
                setTimeout(() => {
                    window.location.reload();
                }, 5000);
            } else {
                throw new Error(data.message || 'Failed to restart application');
            }
        } catch (error) {
            console.error('Error restarting application:', error);
            showModal('Error', 'Failed to restart application: ' + (error as Error).message);
        }
    };

    const getCurrentValue = (key: string): string => {
        return pendingChanges[key] !== undefined ? pendingChanges[key] : config[key];
    };

    const hasChanges = Object.keys(pendingChanges).length > 0;

    return (
        <div className={styles.container}>
            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>
                    <i className="fas fa-database"></i>
                    Database Configuration
                </h3>
                <p className={styles.sectionDescription}>
                    Configure database connection settings. Changes require application restart.
                </p>

                {isLoading ? (
                    <div className={styles.loadingSpinner}>
                        <i className="fas fa-spinner fa-spin"></i>
                        <span>Loading database configuration...</span>
                    </div>
                ) : (
                    <>
                        {/* Connection Information */}
                        <div className={styles.configGroup}>
                            <h4><i className="fas fa-server"></i> Connection Information</h4>

                            <div className={styles.settingGroup}>
                                <label htmlFor="db_server">Database Server</label>
                                <input
                                    type="text"
                                    id="db_server"
                                    value={getCurrentValue('DB_SERVER')}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange('DB_SERVER', e.target.value)}
                                    placeholder="e.g., localhost, CLINIC"
                                    className={pendingChanges.DB_SERVER !== undefined ? styles.pendingChange : ''}
                                />
                                <div className={styles.settingDescription}>SQL Server name or IP address</div>
                            </div>

                            <div className={styles.settingGroup}>
                                <label htmlFor="db_instance">Instance Name</label>
                                <input
                                    type="text"
                                    id="db_instance"
                                    value={getCurrentValue('DB_INSTANCE')}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange('DB_INSTANCE', e.target.value)}
                                    placeholder="e.g., SQLEXPRESS, DOLPHIN"
                                    className={pendingChanges.DB_INSTANCE !== undefined ? styles.pendingChange : ''}
                                />
                                <div className={styles.settingDescription}>SQL Server instance name</div>
                            </div>

                            <div className={styles.settingGroup}>
                                <label htmlFor="db_database">Database Name</label>
                                <input
                                    type="text"
                                    id="db_database"
                                    value={getCurrentValue('DB_DATABASE')}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange('DB_DATABASE', e.target.value)}
                                    placeholder="e.g., ShwanNew, ShwanOrtho"
                                    className={pendingChanges.DB_DATABASE !== undefined ? styles.pendingChange : ''}
                                />
                                <div className={styles.settingDescription}>Database name to connect to</div>
                            </div>
                        </div>

                        {/* Authentication */}
                        <div className={styles.configGroup}>
                            <h4><i className="fas fa-key"></i> Authentication</h4>

                            <div className={styles.settingGroup}>
                                <label htmlFor="db_user">Username</label>
                                <input
                                    type="text"
                                    id="db_user"
                                    value={getCurrentValue('DB_USER')}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange('DB_USER', e.target.value)}
                                    placeholder="Database username"
                                    className={pendingChanges.DB_USER !== undefined ? styles.pendingChange : ''}
                                />
                                <div className={styles.settingDescription}>SQL Server login username</div>
                            </div>

                            <div className={styles.settingGroup}>
                                <label htmlFor="db_password">Password</label>
                                <div className={styles.passwordInputGroup}>
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        id="db_password"
                                        value={getCurrentValue('DB_PASSWORD')}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange('DB_PASSWORD', e.target.value)}
                                        placeholder="Database password"
                                        className={pendingChanges.DB_PASSWORD !== undefined ? styles.pendingChange : ''}
                                    />
                                    <button
                                        type="button"
                                        className={styles.passwordToggle}
                                        onClick={(e: MouseEvent<HTMLButtonElement>) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setShowPassword(prevState => !prevState);
                                        }}
                                    >
                                        <i className={showPassword ? "fas fa-eye-slash" : "fas fa-eye"}></i>
                                    </button>
                                </div>
                                <div className={styles.settingDescription}>SQL Server login password</div>
                            </div>
                        </div>

                        {/* Security Settings */}
                        <div className={styles.configGroup}>
                            <h4><i className="fas fa-shield-alt"></i> Security Settings</h4>

                            <div className={styles.settingGroup}>
                                <label htmlFor="db_encrypt">Encrypt Connection</label>
                                <select
                                    id="db_encrypt"
                                    value={getCurrentValue('DB_ENCRYPT')}
                                    onChange={(e: ChangeEvent<HTMLSelectElement>) => handleInputChange('DB_ENCRYPT', e.target.value)}
                                    className={pendingChanges.DB_ENCRYPT !== undefined ? styles.pendingChange : ''}
                                >
                                    <option value="true">Enabled</option>
                                    <option value="false">Disabled</option>
                                </select>
                                <div className={styles.settingDescription}>Enable SSL/TLS encryption for database connection</div>
                            </div>

                            <div className={styles.settingGroup}>
                                <label htmlFor="db_trust_cert">Trust Server Certificate</label>
                                <select
                                    id="db_trust_cert"
                                    value={getCurrentValue('DB_TRUST_CERTIFICATE')}
                                    onChange={(e: ChangeEvent<HTMLSelectElement>) => handleInputChange('DB_TRUST_CERTIFICATE', e.target.value)}
                                    className={pendingChanges.DB_TRUST_CERTIFICATE !== undefined ? styles.pendingChange : ''}
                                >
                                    <option value="true">Trust</option>
                                    <option value="false">Verify</option>
                                </select>
                                <div className={styles.settingDescription}>Trust the server certificate without validation</div>
                            </div>
                        </div>

                        {/* Connection Test */}
                        <div className={styles.configGroup}>
                            <h4><i className="fas fa-plug"></i> Connection Test</h4>

                            <div className={styles.connectionTest}>
                                <button
                                    className={`${styles.btn} ${styles.btnSecondary}`}
                                    onClick={testConnection}
                                    disabled={isTestingConnection}
                                >
                                    {isTestingConnection ? (
                                        <>
                                            <i className="fas fa-spinner fa-spin"></i>
                                            Testing Connection...
                                        </>
                                    ) : (
                                        <>
                                            <i className="fas fa-plug"></i>
                                            Test Connection
                                        </>
                                    )}
                                </button>

                                {connectionStatus && (
                                    <div className={`${styles.connectionStatus} ${connectionStatus.success ? styles.success : styles.error}`}>
                                        <div className={styles.statusHeader}>
                                            <i className={connectionStatus.success ? "fas fa-check-circle" : "fas fa-exclamation-circle"}></i>
                                            <span>{connectionStatus.message}</span>
                                        </div>
                                        <div className={styles.statusDetails}>{connectionStatus.details}</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>

            <div className={styles.actions}>
                <button
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    onClick={saveConfiguration}
                    disabled={!hasChanges}
                >
                    <i className="fas fa-save"></i>
                    {hasChanges
                        ? `Save Configuration (${Object.keys(pendingChanges).length} changes)`
                        : 'Save Configuration'
                    }
                </button>

                <button
                    className={`${styles.btn} ${styles.btnWarning}`}
                    onClick={exportConfiguration}
                >
                    <i className="fas fa-download"></i>
                    Export Config
                </button>

                <button
                    className={`${styles.btn} ${styles.btnInfo}`}
                    onClick={restartApplication}
                    title="Restart application to apply configuration changes"
                >
                    <i className="fas fa-sync-alt"></i>
                    Restart App
                </button>
            </div>

            {hasChanges && (
                <div className={styles.restartWarning}>
                    <i className="fas fa-exclamation-triangle"></i>
                    <span>Application restart required after saving database configuration changes.</span>
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

export default DatabaseSettings;
