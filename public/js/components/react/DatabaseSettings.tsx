import { useState, useEffect, ChangeEvent, MouseEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useConfirm } from '../../contexts/ConfirmContext';
import Modal from './Modal';
import ModalHeader from './ModalHeader';
import styles from './DatabaseSettings.module.css';
import { formatISODate } from '../../core/utils';
import { fetchJSON, postJSON, putJSON, httpErrorMessage } from '@/core/http';
import { databaseConfigQuery } from '@/query/queries';
import { qk } from '@/query/keys';
import * as settings from '@shared/contracts/settings.contract';

interface DatabaseConfig {
    PG_HOST: string;
    PG_PORT: string;
    PG_DATABASE: string;
    PG_USER: string;
    PG_PASSWORD: string;
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
        PG_HOST: '',
        PG_PORT: '5432',
        PG_DATABASE: '',
        PG_USER: '',
        PG_PASSWORD: ''
    });
    const [pendingChanges, setPendingChanges] = useState<PendingChanges>({});
    const [isTestingConnection, setIsTestingConnection] = useState(false);
    const confirm = useConfirm();
    const queryClient = useQueryClient();
    const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | null>(null);
    const [showPassword, setShowPassword] = useState(false);
    const [modal, setModal] = useState<ModalState>({ show: false, title: '', message: '' });

    const { data: configData, isLoading, isError, error: loadError } = useQuery(databaseConfigQuery());

    // The DB config is loaded into an editable `config` state — seed it from the
    // query data during render (keyed on the query result reference) so the form has
    // mutable local state without a setState-in-effect.
    const [seededConfigData, setSeededConfigData] = useState<unknown>(null);
    if (configData?.config && configData !== seededConfigData) {
        setSeededConfigData(configData);
        setConfig(configData.config as DatabaseConfig);
    }

    // Surface a load failure once per error transition. setModal is called directly
    // (the later-declared showModal would trip react-hooks/immutability).
    const [prevIsError, setPrevIsError] = useState(isError);
    if (isError !== prevIsError) {
        setPrevIsError(isError);
        if (isError) {
            setModal({ show: true, title: 'Error', message: 'Failed to load database configuration: ' + httpErrorMessage(loadError, 'Unknown error') });
        }
    }

    useEffect(() => {
        // Notify parent component about changes
        if (onChangesUpdate) {
            onChangesUpdate(Object.keys(pendingChanges).length > 0);
        }
        // onChangesUpdate intentionally excluded — parent should provide a stable ref
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingChanges]);

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
            if (testConfig.PG_PASSWORD === '••••••••') {
                setConnectionStatus({
                    success: false,
                    message: 'Cannot test with masked password',
                    details: 'Please enter a new password to test the connection. Existing passwords are masked for security.'
                });
                setIsTestingConnection(false);
                return;
            }

            const data = await postJSON<{ connectionOk: boolean; message: string; details?: string }>(
                '/api/config/database/test',
                testConfig,
                { schema: settings.testDatabaseConnection.response }
            );

            setConnectionStatus({
                success: data.connectionOk,
                message: data.message,
                details: data.details
            });

        } catch (error) {
            // The test result (reachable / not) now rides a 200 `connectionOk`, so this
            // only fires on a genuine transport/server error — surface its reason.
            setConnectionStatus({
                success: false,
                message: httpErrorMessage(error, 'Connection test failed'),
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

            const data = await putJSON<{ message?: string; requiresRestart?: boolean }>(
                '/api/config/database',
                completeConfig,
                { schema: settings.updateDatabaseConfig.response }
            );

            // A failed save throws from putJSON → caught below.
            setConfig(prev => ({ ...prev, ...pendingChanges }));
            setPendingChanges({});
            queryClient.invalidateQueries({ queryKey: qk.settings.databaseConfig() });

            if (data.requiresRestart) {
                const shouldRestart = await confirm(
                    data.message + '\n\nThe application must be restarted for database changes to take effect.\n\nRestart now?',
                    { title: 'Restart Required', danger: true, confirmText: 'Restart Now', cancelText: 'Later' }
                );

                if (shouldRestart) {
                    restartApplication();
                } else {
                    showModal('Success', data.message + '\n\nRemember to restart the application for changes to take effect.');
                }
            } else {
                showModal('Success', data.message || 'Configuration saved successfully.');
            }

        } catch (error) {
            console.error('Error saving database config:', error);
            showModal('Error', 'Failed to save database configuration: ' + httpErrorMessage(error, 'Unknown error'));
        }
    };

    const exportConfiguration = async () => {
        try {
            const data = await fetchJSON<{ config?: unknown }>(
                '/api/config/database/export',
                { schema: settings.exportDatabaseConfig.response }
            );

            // A failed export throws from fetchJSON → caught below.
            const blob = new Blob([JSON.stringify(data.config, null, 2)], {
                type: 'application/json'
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `database-config-${formatISODate()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            showModal('Success', 'Configuration exported successfully.');
        } catch (error) {
            console.error('Error exporting configuration:', error);
            showModal('Error', 'Failed to export configuration: ' + httpErrorMessage(error, 'Unknown error'));
        }
    };

    const restartApplication = async () => {
        try {
            await postJSON<{ message?: string }>(
                '/api/system/restart',
                { reason: 'Database configuration update' }
            );

            // A failed restart-init throws from postJSON → caught below.
            showModal('Restarting', 'Application is restarting. Please wait...');

            // Check if server is back up
            setTimeout(() => {
                window.location.reload();
            }, 5000);
        } catch (error) {
            console.error('Error restarting application:', error);
            showModal('Error', 'Failed to restart application: ' + httpErrorMessage(error, 'Unknown error'));
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
                                <label htmlFor="pg_host">Host</label>
                                <input
                                    type="text"
                                    id="pg_host"
                                    value={getCurrentValue('PG_HOST')}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange('PG_HOST', e.target.value)}
                                    placeholder="e.g., localhost"
                                    className={pendingChanges.PG_HOST !== undefined ? styles.pendingChange : ''}
                                />
                                <div className={styles.settingDescription}>PostgreSQL server host or IP address</div>
                            </div>

                            <div className={styles.settingGroup}>
                                <label htmlFor="pg_port">Port</label>
                                <input
                                    type="text"
                                    id="pg_port"
                                    value={getCurrentValue('PG_PORT')}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange('PG_PORT', e.target.value)}
                                    placeholder="5432"
                                    className={pendingChanges.PG_PORT !== undefined ? styles.pendingChange : ''}
                                />
                                <div className={styles.settingDescription}>PostgreSQL server port (default 5432)</div>
                            </div>

                            <div className={styles.settingGroup}>
                                <label htmlFor="pg_database">Database Name</label>
                                <input
                                    type="text"
                                    id="pg_database"
                                    value={getCurrentValue('PG_DATABASE')}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange('PG_DATABASE', e.target.value)}
                                    placeholder="e.g., shwan_test"
                                    className={pendingChanges.PG_DATABASE !== undefined ? styles.pendingChange : ''}
                                />
                                <div className={styles.settingDescription}>Database name to connect to</div>
                            </div>
                        </div>

                        {/* Authentication */}
                        <div className={styles.configGroup}>
                            <h4><i className="fas fa-key"></i> Authentication</h4>

                            <div className={styles.settingGroup}>
                                <label htmlFor="pg_user">Username</label>
                                <input
                                    type="text"
                                    id="pg_user"
                                    value={getCurrentValue('PG_USER')}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange('PG_USER', e.target.value)}
                                    placeholder="Database role/username"
                                    className={pendingChanges.PG_USER !== undefined ? styles.pendingChange : ''}
                                />
                                <div className={styles.settingDescription}>PostgreSQL role/username</div>
                            </div>

                            <div className={styles.settingGroup}>
                                <label htmlFor="pg_password">Password</label>
                                <div className={styles.passwordInputGroup}>
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        id="pg_password"
                                        value={getCurrentValue('PG_PASSWORD')}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange('PG_PASSWORD', e.target.value)}
                                        placeholder="Database password"
                                        className={pendingChanges.PG_PASSWORD !== undefined ? styles.pendingChange : ''}
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
                                <div className={styles.settingDescription}>PostgreSQL role password (leave blank for trust/peer auth)</div>
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
                    onClick={async () => {
                        const ok = await confirm(
                            'This will restart the live application server for all users. Continue?',
                            { title: 'Restart Application', danger: true, confirmText: 'Restart Now', cancelText: 'Cancel' }
                        );
                        if (ok) restartApplication();
                    }}
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
            <Modal
                isOpen={modal.show}
                onClose={hideModal}
                contentClassName={styles.modalContent}
                ariaLabelledBy="database-settings-modal-title"
            >
                <ModalHeader
                    titleId="database-settings-modal-title"
                    title={modal.title}
                    onClose={hideModal}
                />
                <div className={styles.modalBody}>
                    <pre>{modal.message}</pre>
                </div>
                <div className={styles.modalFooter}>
                    <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={hideModal}>OK</button>
                </div>
            </Modal>
        </div>
    );
};

export default DatabaseSettings;
