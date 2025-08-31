import React, { useState, useEffect } from 'react';

const DatabaseSettings = ({ onChangesUpdate }) => {
    const [config, setConfig] = useState({
        DB_SERVER: '',
        DB_INSTANCE: '',
        DB_DATABASE: '',
        DB_USER: '',
        DB_PASSWORD: '',
        DB_ENCRYPT: 'false',
        DB_TRUST_CERTIFICATE: 'true'
    });
    const [pendingChanges, setPendingChanges] = useState({});
    const [isLoading, setIsLoading] = useState(false);
    const [isTestingConnection, setIsTestingConnection] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState(null);
    const [showPassword, setShowPassword] = useState(false);
    const [modal, setModal] = useState({ show: false, title: '', message: '' });

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
            showModal('Error', 'Failed to load database configuration: ' + error.message);
        } finally {
            setIsLoading(false);
        }
    };

    const showModal = (title, message) => {
        setModal({ show: true, title, message });
    };

    const hideModal = () => {
        setModal({ show: false, title: '', message: '' });
    };

    const handleInputChange = (key, value) => {
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
                details: error.message
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
            showModal('Error', 'Failed to save database configuration: ' + error.message);
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
            showModal('Error', 'Failed to export configuration: ' + error.message);
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
            showModal('Error', 'Failed to restart application: ' + error.message);
        }
    };

    const getCurrentValue = (key) => {
        return pendingChanges[key] !== undefined ? pendingChanges[key] : config[key];
    };

    const hasChanges = Object.keys(pendingChanges).length > 0;

    return (
        <div className="database-settings">
            <div className="settings-section">
                <h3>
                    <i className="fas fa-database"></i>
                    Database Configuration
                </h3>
                <p className="section-description">
                    Configure database connection settings. Changes require application restart.
                </p>

                {isLoading ? (
                    <div className="loading-spinner">
                        <i className="fas fa-spinner fa-spin"></i>
                        <span>Loading database configuration...</span>
                    </div>
                ) : (
                    <>
                        {/* Connection Information */}
                        <div className="config-group">
                            <h4>Connection Information</h4>
                            
                            <div className="setting-group">
                                <label htmlFor="db_server">Database Server</label>
                                <input
                                    type="text"
                                    id="db_server"
                                    value={getCurrentValue('DB_SERVER')}
                                    onChange={(e) => handleInputChange('DB_SERVER', e.target.value)}
                                    placeholder="e.g., localhost, CLINIC"
                                    className={pendingChanges.DB_SERVER !== undefined ? 'pending-change' : ''}
                                />
                                <div className="setting-description">SQL Server name or IP address</div>
                            </div>

                            <div className="setting-group">
                                <label htmlFor="db_instance">Instance Name</label>
                                <input
                                    type="text"
                                    id="db_instance"
                                    value={getCurrentValue('DB_INSTANCE')}
                                    onChange={(e) => handleInputChange('DB_INSTANCE', e.target.value)}
                                    placeholder="e.g., SQLEXPRESS, DOLPHIN"
                                    className={pendingChanges.DB_INSTANCE !== undefined ? 'pending-change' : ''}
                                />
                                <div className="setting-description">SQL Server instance name</div>
                            </div>

                            <div className="setting-group">
                                <label htmlFor="db_database">Database Name</label>
                                <input
                                    type="text"
                                    id="db_database"
                                    value={getCurrentValue('DB_DATABASE')}
                                    onChange={(e) => handleInputChange('DB_DATABASE', e.target.value)}
                                    placeholder="e.g., ShwanNew, ShwanOrtho"
                                    className={pendingChanges.DB_DATABASE !== undefined ? 'pending-change' : ''}
                                />
                                <div className="setting-description">Database name to connect to</div>
                            </div>
                        </div>

                        {/* Authentication */}
                        <div className="config-group">
                            <h4>Authentication</h4>
                            
                            <div className="setting-group">
                                <label htmlFor="db_user">Username</label>
                                <input
                                    type="text"
                                    id="db_user"
                                    value={getCurrentValue('DB_USER')}
                                    onChange={(e) => handleInputChange('DB_USER', e.target.value)}
                                    placeholder="Database username"
                                    className={pendingChanges.DB_USER !== undefined ? 'pending-change' : ''}
                                />
                                <div className="setting-description">SQL Server login username</div>
                            </div>

                            <div className="setting-group">
                                <label htmlFor="db_password">Password</label>
                                <div className="password-input-group">
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        id="db_password"
                                        value={getCurrentValue('DB_PASSWORD')}
                                        onChange={(e) => handleInputChange('DB_PASSWORD', e.target.value)}
                                        placeholder="Database password"
                                        className={pendingChanges.DB_PASSWORD !== undefined ? 'pending-change' : ''}
                                    />
                                    <button
                                        type="button"
                                        className="password-toggle"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setShowPassword(prevState => !prevState);
                                        }}
                                    >
                                        <i className={showPassword ? "fas fa-eye-slash" : "fas fa-eye"}></i>
                                    </button>
                                </div>
                                <div className="setting-description">SQL Server login password</div>
                            </div>
                        </div>

                        {/* Security Settings */}
                        <div className="config-group">
                            <h4>Security Settings</h4>
                            
                            <div className="setting-group">
                                <label htmlFor="db_encrypt">Encrypt Connection</label>
                                <select
                                    id="db_encrypt"
                                    value={getCurrentValue('DB_ENCRYPT')}
                                    onChange={(e) => handleInputChange('DB_ENCRYPT', e.target.value)}
                                    className={pendingChanges.DB_ENCRYPT !== undefined ? 'pending-change' : ''}
                                >
                                    <option value="true">Enabled</option>
                                    <option value="false">Disabled</option>
                                </select>
                                <div className="setting-description">Enable SSL/TLS encryption for database connection</div>
                            </div>

                            <div className="setting-group">
                                <label htmlFor="db_trust_cert">Trust Server Certificate</label>
                                <select
                                    id="db_trust_cert"
                                    value={getCurrentValue('DB_TRUST_CERTIFICATE')}
                                    onChange={(e) => handleInputChange('DB_TRUST_CERTIFICATE', e.target.value)}
                                    className={pendingChanges.DB_TRUST_CERTIFICATE !== undefined ? 'pending-change' : ''}
                                >
                                    <option value="true">Trust</option>
                                    <option value="false">Verify</option>
                                </select>
                                <div className="setting-description">Trust the server certificate without validation</div>
                            </div>
                        </div>

                        {/* Connection Test */}
                        <div className="config-group">
                            <h4>Connection Test</h4>
                            
                            <div className="connection-test">
                                <button
                                    className="btn btn-secondary"
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
                                    <div className={`connection-status ${connectionStatus.success ? 'success' : 'error'}`}>
                                        <div className="status-header">
                                            <i className={connectionStatus.success ? "fas fa-check-circle" : "fas fa-exclamation-circle"}></i>
                                            <span>{connectionStatus.message}</span>
                                        </div>
                                        <div className="status-details">{connectionStatus.details}</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>

            <div className="settings-actions">
                <button
                    className="btn btn-primary"
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
                    className="btn btn-warning"
                    onClick={exportConfiguration}
                >
                    <i className="fas fa-download"></i>
                    Export Config
                </button>
                
                <button
                    className="btn btn-info"
                    onClick={restartApplication}
                    title="Restart application to apply configuration changes"
                >
                    <i className="fas fa-sync-alt"></i>
                    Restart App
                </button>
            </div>

            {hasChanges && (
                <div className="restart-warning">
                    <i className="fas fa-exclamation-triangle"></i>
                    <span>Application restart required after saving database configuration changes.</span>
                </div>
            )}

            {/* Modal */}
            {modal.show && (
                <div className="modal" onClick={hideModal}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>{modal.title}</h3>
                            <button className="modal-close" onClick={hideModal}>
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        <div className="modal-body">
                            <pre style={{whiteSpace: 'pre-wrap'}}>{modal.message}</pre>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-primary" onClick={hideModal}>OK</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DatabaseSettings;