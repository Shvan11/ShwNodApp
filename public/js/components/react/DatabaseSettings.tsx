import { useState, useEffect, ChangeEvent, MouseEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useToast } from '../../contexts/ToastContext';
import styles from './DatabaseSettings.module.css';
import { formatISODate } from '../../core/utils';
import { fetchJSON, postJSON, putJSON, httpErrorMessage } from '@/core/http';
import { waitForServerRestart } from '@/core/serverHealth';
import { databaseConfigQuery } from '@/query/queries';
import { qk } from '@/query/keys';
import * as settings from '@shared/contracts/settings.contract';
import { isMaskedSecret } from '@shared/masked-secret';

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

/** Where a restart is: asked for and waiting on the new process, or given up on. */
type RestartState = null | 'waiting' | 'timedOut';

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
    const [isSaving, setIsSaving] = useState(false);
    const confirm = useConfirm();
    const toast = useToast();
    const queryClient = useQueryClient();
    const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | null>(null);
    const [showPassword, setShowPassword] = useState(false);
    const [restart, setRestart] = useState<RestartState>(null);

    const { data: configData, isLoading, isError, error: loadError } = useQuery(databaseConfigQuery());

    // The DB config is loaded into an editable `config` state — seed it from the
    // query data during render (keyed on the query result reference) so the form has
    // mutable local state without a setState-in-effect.
    const [seededConfigData, setSeededConfigData] = useState<unknown>(null);
    if (configData?.config && configData !== seededConfigData) {
        setSeededConfigData(configData);
        // `getDatabaseConfig.response` types `config` as `z.unknown()` on purpose —
        // the DB config is a free-form map validated field-by-field server-side by
        // DatabaseConfigService — so a single assertion off `unknown` is required.
        setConfig(configData.config as DatabaseConfig);
    }

    useEffect(() => {
        // Notify parent component about changes
        if (onChangesUpdate) {
            onChangesUpdate(Object.keys(pendingChanges).length > 0);
        }
        // onChangesUpdate intentionally excluded — parent should provide a stable ref
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingChanges]);

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
            // Current values including pending changes. A still-masked password stands
            // for the saved one: the server uses it only against the saved host/port/user.
            const testConfig = { ...config, ...pendingChanges };

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

    /**
     * Ask the server to restart, then wait for the NEW process before reloading. It used
     * to reload after a fixed 5 s — mid graceful-shutdown (up to 15 s) or before the
     * service manager had the app back up — onto a proxy error page, or, on a box with
     * no service manager, onto nothing at all while the page said "restarting" (FE-F22-6).
     */
    const restartApplication = async () => {
        const requestedAt = Date.now();
        try {
            await postJSON<{ message?: string }>(
                '/api/system/restart',
                { reason: 'Database configuration update' }
            );
        } catch (error) {
            toast.error('Failed to restart the application: ' + httpErrorMessage(error, 'Unknown error'));
            return;
        }
        setRestart('waiting');
        if (await waitForServerRestart(requestedAt)) {
            window.location.reload();
        } else {
            setRestart('timedOut');
        }
    };

    const saveConfiguration = async () => {
        if (Object.keys(pendingChanges).length === 0 || isSaving) return;

        setIsSaving(true);
        try {
            // Get complete configuration (current + pending changes).
            // The loaded password is a MASK, not the real one. Posting it back
            // unchanged used to write the bullet characters into .env as the literal
            // PostgreSQL password — so drop it unless the user actually retyped it.
            // (The server refuses the mask as well; both halves are deliberate.)
            const completeConfig: Record<string, string> = { ...config, ...pendingChanges };
            if (isMaskedSecret(completeConfig.PG_PASSWORD)) {
                delete completeConfig.PG_PASSWORD;
            }

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
                    (data.message ? data.message + '\n\n' : '') +
                        'The application must be restarted for database changes to take effect.\n\nRestart now?',
                    { title: 'Restart Required', danger: true, confirmText: 'Restart Now', cancelText: 'Later' }
                );

                if (shouldRestart) {
                    void restartApplication();
                } else {
                    toast.warning('Saved. Restart the application for the change to take effect.');
                }
            } else {
                toast.success(data.message || 'Configuration saved');
            }

        } catch (error) {
            toast.error('Failed to save the database configuration: ' + httpErrorMessage(error, 'Unknown error'));
        } finally {
            setIsSaving(false);
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

            toast.success('Configuration exported (the password is not included)');
        } catch (error) {
            toast.error('Failed to export the configuration: ' + httpErrorMessage(error, 'Unknown error'));
        }
    };

    const getCurrentValue = (key: string): string => {
        return pendingChanges[key] !== undefined ? pendingChanges[key] : config[key];
    };

    const hasChanges = Object.keys(pendingChanges).length > 0;
    const passwordIsSaved = isMaskedSecret(getCurrentValue('PG_PASSWORD'));

    return (
        <div className={styles.container}>
            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>
                    <i className="fas fa-database" aria-hidden="true"></i>
                    Database Configuration
                </h3>
                <p className={styles.sectionDescription}>
                    Configure database connection settings. Changes require application restart.
                </p>

                {restart && (
                    <div className={`${styles.connectionStatus} ${restart === 'waiting' ? styles.success : styles.error}`} role="status">
                        <div className={styles.statusHeader}>
                            <i className={restart === 'waiting' ? 'fas fa-spinner fa-spin' : 'fas fa-exclamation-circle'} aria-hidden="true"></i>
                            <span>
                                {restart === 'waiting'
                                    ? 'Restarting the application… this page reloads as soon as it is back.'
                                    : 'The application has not come back after two minutes.'}
                            </span>
                        </div>
                        {restart === 'timedOut' && (
                            <div className={styles.statusDetails}>
                                Check the server: on a Windows service install, look at the service and its logs;
                                on a development machine nothing restarts the process for you.
                            </div>
                        )}
                    </div>
                )}

                {isLoading ? (
                    <div className={styles.loadingSpinner}>
                        <i className="fas fa-spinner fa-spin" aria-hidden="true"></i>
                        <span>Loading database configuration...</span>
                    </div>
                ) : isError ? (
                    <div className={`${styles.connectionStatus} ${styles.error}`}>
                        <div className={styles.statusHeader}>
                            <i className="fas fa-exclamation-circle" aria-hidden="true"></i>
                            <span>{httpErrorMessage(loadError, 'Failed to load the database configuration')}</span>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Connection Information */}
                        <div className={styles.configGroup}>
                            <h4><i className="fas fa-server" aria-hidden="true"></i> Connection Information</h4>

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
                            <h4><i className="fas fa-key" aria-hidden="true"></i> Authentication</h4>

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
                                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                                        onClick={(e: MouseEvent<HTMLButtonElement>) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setShowPassword(prevState => !prevState);
                                        }}
                                    >
                                        <i className={showPassword ? "fas fa-eye-slash" : "fas fa-eye"} aria-hidden="true"></i>
                                    </button>
                                </div>
                                <div className={styles.settingDescription}>
                                    {passwordIsSaved
                                        ? 'The saved password is hidden. Leave it to keep it; type over it to change it.'
                                        : 'PostgreSQL role password (leave blank for trust/peer auth)'}
                                </div>
                            </div>
                        </div>

                        {/* Connection Test */}
                        <div className={styles.configGroup}>
                            <h4><i className="fas fa-plug" aria-hidden="true"></i> Connection Test</h4>

                            <div className={styles.connectionTest}>
                                <button
                                    className={`${styles.btn} ${styles.btnSecondary}`}
                                    onClick={testConnection}
                                    disabled={isTestingConnection}
                                >
                                    {isTestingConnection ? (
                                        <>
                                            <i className="fas fa-spinner fa-spin" aria-hidden="true"></i>
                                            Testing Connection...
                                        </>
                                    ) : (
                                        <>
                                            <i className="fas fa-plug" aria-hidden="true"></i>
                                            Test Connection
                                        </>
                                    )}
                                </button>

                                {connectionStatus && (
                                    <div className={`${styles.connectionStatus} ${connectionStatus.success ? styles.success : styles.error}`} role="status">
                                        <div className={styles.statusHeader}>
                                            <i className={connectionStatus.success ? "fas fa-check-circle" : "fas fa-exclamation-circle"} aria-hidden="true"></i>
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
                    disabled={!hasChanges || isSaving || restart === 'waiting'}
                >
                    <i className="fas fa-save" aria-hidden="true"></i>
                    {hasChanges
                        ? `Save Configuration (${Object.keys(pendingChanges).length} changes)`
                        : 'Save Configuration'
                    }
                </button>

                <button
                    className={`${styles.btn} ${styles.btnWarning}`}
                    onClick={exportConfiguration}
                >
                    <i className="fas fa-download" aria-hidden="true"></i>
                    Export Config
                </button>

                <button
                    className={`${styles.btn} ${styles.btnInfo}`}
                    disabled={restart === 'waiting'}
                    onClick={async () => {
                        const ok = await confirm(
                            'This will restart the live application server for all users. Continue?',
                            { title: 'Restart Application', danger: true, confirmText: 'Restart Now', cancelText: 'Cancel' }
                        );
                        if (ok) void restartApplication();
                    }}
                    title="Restart application to apply configuration changes"
                >
                    <i className="fas fa-sync-alt" aria-hidden="true"></i>
                    Restart App
                </button>
            </div>

            {hasChanges && (
                <div className={styles.restartWarning}>
                    <i className="fas fa-exclamation-triangle" aria-hidden="true"></i>
                    <span>Application restart required after saving database configuration changes.</span>
                </div>
            )}
        </div>
    );
};

export default DatabaseSettings;
