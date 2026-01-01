import { useState, useEffect, useCallback, ChangeEvent, MouseEvent } from 'react';

interface EmailConfig {
  smtp_host?: string;
  smtp_port?: string;
  smtp_secure?: string;
  smtp_user?: string;
  smtp_password?: string;
  from_address?: string;
  from_name?: string;
  [key: string]: string | undefined;
}

interface ModalState {
  show: boolean;
  title: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

interface EmailSettingsProps {
  onChangesUpdate?: (hasChanges: boolean) => void;
}

const EmailSettings = ({ onChangesUpdate }: EmailSettingsProps) => {
    const [config, setConfig] = useState<EmailConfig>({});
    const [pendingChanges, setPendingChanges] = useState<EmailConfig>({});
    const [isLoading, setIsLoading] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [modal, setModal] = useState<ModalState>({ show: false, title: '', message: '', type: 'info' });

    const loadEmailConfig = useCallback(async () => {
        setIsLoading(true);
        try {
            const response = await fetch('/api/email/config');
            const data = await response.json();

            if (data.success) {
                setConfig(data.config);
            } else {
                throw new Error(data.error || 'Failed to load email configuration');
            }
        } catch (error) {
            console.error('Error loading email configuration:', error);
            showModal('Error', 'Failed to load email settings: ' + (error as Error).message, 'error');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        loadEmailConfig();
    }, [loadEmailConfig]);

    useEffect(() => {
        // Notify parent component about changes
        if (onChangesUpdate) {
            onChangesUpdate(Object.keys(pendingChanges).length > 0);
        }
    }, [pendingChanges]); // Removed onChangesUpdate from dependencies to prevent infinite loop

    const showModal = (title: string, message: string, type: ModalState['type'] = 'info') => {
        setModal({ show: true, title, message, type });
    };

    const hideModal = () => {
        setModal({ show: false, title: '', message: '', type: 'info' });
    };

    const handleInputChange = (fieldName: string, newValue: string) => {
        const originalValue = config[fieldName];

        if (newValue !== originalValue) {
            setPendingChanges(prev => ({
                ...prev,
                [fieldName]: newValue
            }));
        } else {
            setPendingChanges(prev => {
                const updated = { ...prev };
                delete updated[fieldName];
                return updated;
            });
        }
    };

    const saveChanges = async () => {
        if (Object.keys(pendingChanges).length === 0) {
            showModal('Info', 'No changes to save.', 'info');
            return;
        }

        setIsLoading(true);
        try {
            const response = await fetch('/api/email/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(pendingChanges)
            });

            const data = await response.json();

            if (data.success) {
                // Reload configuration
                await loadEmailConfig();
                setPendingChanges({});
                showModal('Success', 'Email configuration saved successfully!', 'success');
            } else {
                throw new Error(data.error || 'Failed to save configuration');
            }
        } catch (error) {
            console.error('Error saving email configuration:', error);
            showModal('Error', 'Failed to save email configuration: ' + (error as Error).message, 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const testConnection = async () => {
        setIsTesting(true);
        try {
            const response = await fetch('/api/email/test');
            const data = await response.json();

            if (data.success) {
                showModal('Success', 'Email connection test successful! Configuration is valid.', 'success');
            } else {
                showModal('Error', `Connection test failed: ${data.message || data.error}`, 'error');
            }
        } catch (error) {
            console.error('Error testing email connection:', error);
            showModal('Error', 'Connection test failed: ' + (error as Error).message, 'error');
        } finally {
            setIsTesting(false);
        }
    };

    const sendTestEmail = async () => {
        setIsSending(true);
        try {
            const response = await fetch('/api/email/test-send', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({})
            });

            const data = await response.json();

            if (data.success) {
                showModal('Success', `Test email sent successfully to ${data.to}!`, 'success');
            } else {
                showModal('Error', `Failed to send test email: ${data.error}`, 'error');
            }
        } catch (error) {
            console.error('Error sending test email:', error);
            showModal('Error', 'Failed to send test email: ' + (error as Error).message, 'error');
        } finally {
            setIsSending(false);
        }
    };

    const discardChanges = () => {
        setPendingChanges({});
    };

    const getCurrentValue = (fieldName: string): string => {
        return Object.prototype.hasOwnProperty.call(pendingChanges, fieldName)
            ? (pendingChanges[fieldName] ?? '')
            : (config[fieldName] || '');
    };

    const hasChanges = Object.keys(pendingChanges).length > 0;

    return (
        <div className="email-settings">
            <div className="settings-section-inner">
                <div className="section-header">
                    <h3>Email Configuration</h3>
                    <p className="section-description">
                        Configure SMTP settings for sending appointment notifications to staff via email.
                    </p>
                </div>

                {isLoading ? (
                    <div className="loading-indicator">
                        <i className="fas fa-spinner fa-spin"></i> Loading email configuration...
                    </div>
                ) : (
                    <div className="settings-form">
                        {/* SMTP Host */}
                        <div className="form-group">
                            <label htmlFor="smtp_host">
                                SMTP Host
                                <span className="required">*</span>
                            </label>
                            <input
                                type="text"
                                id="smtp_host"
                                className="form-control"
                                value={getCurrentValue('smtp_host')}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange('smtp_host', e.target.value)}
                                placeholder="smtp.gmail.com"
                            />
                            <small className="form-text">SMTP server hostname</small>
                        </div>

                        {/* SMTP Port */}
                        <div className="form-group">
                            <label htmlFor="smtp_port">
                                SMTP Port
                                <span className="required">*</span>
                            </label>
                            <input
                                type="number"
                                id="smtp_port"
                                className="form-control"
                                value={getCurrentValue('smtp_port')}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange('smtp_port', e.target.value)}
                                placeholder="465"
                            />
                            <small className="form-text">Port 465 (SSL) or 587 (TLS)</small>
                        </div>

                        {/* SMTP Secure */}
                        <div className="form-group">
                            <label htmlFor="smtp_secure">
                                Use SSL/TLS
                            </label>
                            <select
                                id="smtp_secure"
                                className="form-control"
                                value={getCurrentValue('smtp_secure')}
                                onChange={(e: ChangeEvent<HTMLSelectElement>) => handleInputChange('smtp_secure', e.target.value)}
                            >
                                <option value="true">Yes (SSL - Port 465)</option>
                                <option value="false">No (STARTTLS - Port 587)</option>
                            </select>
                            <small className="form-text">Enable secure connection</small>
                        </div>

                        {/* SMTP Username */}
                        <div className="form-group">
                            <label htmlFor="smtp_user">
                                SMTP Username / Email
                                <span className="required">*</span>
                            </label>
                            <input
                                type="email"
                                id="smtp_user"
                                className="form-control"
                                value={getCurrentValue('smtp_user')}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange('smtp_user', e.target.value)}
                                placeholder="your-email@gmail.com"
                            />
                            <small className="form-text">Email account for sending</small>
                        </div>

                        {/* SMTP Password */}
                        <div className="form-group">
                            <label htmlFor="smtp_password">
                                SMTP Password / App Password
                                <span className="required">*</span>
                            </label>
                            <input
                                type="password"
                                id="smtp_password"
                                className="form-control"
                                value={getCurrentValue('smtp_password')}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange('smtp_password', e.target.value)}
                                placeholder="Enter password or app-specific password"
                            />
                            <small className="form-text">
                                For Gmail, use an{' '}
                                <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">
                                    App Password
                                </a>
                            </small>
                        </div>

                        {/* From Address */}
                        <div className="form-group">
                            <label htmlFor="from_address">
                                From Email Address
                            </label>
                            <input
                                type="email"
                                id="from_address"
                                className="form-control"
                                value={getCurrentValue('from_address')}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange('from_address', e.target.value)}
                                placeholder="clinic@example.com"
                            />
                            <small className="form-text">Email address shown as sender</small>
                        </div>

                        {/* From Name */}
                        <div className="form-group">
                            <label htmlFor="from_name">
                                From Name
                            </label>
                            <input
                                type="text"
                                id="from_name"
                                className="form-control"
                                value={getCurrentValue('from_name')}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange('from_name', e.target.value)}
                                placeholder="Shwan Orthodontics"
                            />
                            <small className="form-text">Sender name displayed in emails</small>
                        </div>

                        {/* Info about recipients */}
                        <div className="form-group">
                            <label>Email Recipients</label>
                            <div className="info-box">
                                <i className="fas fa-info-circle"></i>
                                <span>
                                    Email notifications are sent to employees with "Receive Email" enabled.
                                    Manage recipients in <a href="/settings/employees">Settings → Employees</a>.
                                </span>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="form-actions">
                            <div className="button-group-left">
                                <button
                                    className="btn btn-primary"
                                    onClick={saveChanges}
                                    disabled={!hasChanges || isLoading}
                                >
                                    <i className="fas fa-save"></i> Save Changes
                                </button>
                                <button
                                    className="btn btn-secondary"
                                    onClick={discardChanges}
                                    disabled={!hasChanges || isLoading}
                                >
                                    <i className="fas fa-undo"></i> Discard
                                </button>
                            </div>
                            <div className="button-group-right">
                                <button
                                    className="btn btn-info"
                                    onClick={testConnection}
                                    disabled={isTesting || isLoading}
                                >
                                    {isTesting ? (
                                        <><i className="fas fa-spinner fa-spin"></i> Testing...</>
                                    ) : (
                                        <><i className="fas fa-plug"></i> Test Connection</>
                                    )}
                                </button>
                                <button
                                    className="btn btn-success"
                                    onClick={sendTestEmail}
                                    disabled={isSending || isLoading}
                                >
                                    {isSending ? (
                                        <><i className="fas fa-spinner fa-spin"></i> Sending...</>
                                    ) : (
                                        <><i className="fas fa-envelope"></i> Send Test Email</>
                                    )}
                                </button>
                            </div>
                        </div>

                        {hasChanges && (
                            <div className="alert alert-warning">
                                <i className="fas fa-exclamation-triangle"></i>
                                You have unsaved changes. Click "Save Changes" to apply them.
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Modal */}
            {modal.show && (
                <div className="modal-overlay" onClick={hideModal}>
                    <div className="modal-content" onClick={(e: MouseEvent) => e.stopPropagation()}>
                        <div className={`modal-header modal-${modal.type}`}>
                            <h4>
                                {modal.type === 'success' && <i className="fas fa-check-circle"></i>}
                                {modal.type === 'error' && <i className="fas fa-exclamation-circle"></i>}
                                {modal.type === 'info' && <i className="fas fa-info-circle"></i>}
                                {' '}{modal.title}
                            </h4>
                        </div>
                        <div className="modal-body">
                            <p>{modal.message}</p>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-primary" onClick={hideModal}>
                                OK
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default EmailSettings;
