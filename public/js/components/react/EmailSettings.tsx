import { useState, useEffect, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { postJSON, httpErrorMessage } from '@/core/http';
import { useToast } from '@/contexts/ToastContext';
import { qk } from '@/query/keys';
import { emailConfigQuery } from '@/query/queries';
import type { EmailConfigBody, EmailConfigView } from '@shared/contracts/email-api.contract';

/**
 * The form edits strings; the server stores typed values (port a number, SSL a
 * boolean). Converting at both edges is what makes "Use SSL/TLS" savable: the select
 * used to post `"false"` to a `z.boolean()` field (400 on every change), and a stored
 * `false` displayed as "Yes", because `false || ''` matched no option (audit FE-F22-2).
 */
type FieldName =
    | 'smtp_host'
    | 'smtp_port'
    | 'smtp_secure'
    | 'smtp_user'
    | 'smtp_password'
    | 'from_address'
    | 'from_name';
type FormValues = Record<FieldName, string>;

function toFormValues(c: EmailConfigView | undefined): FormValues {
    return {
        smtp_host: c?.smtp_host ?? '',
        smtp_port: c?.smtp_port != null ? String(c.smtp_port) : '',
        // The mailer is secure unless the option says false (services/messaging/email.ts).
        smtp_secure: c?.smtp_secure === false ? 'false' : 'true',
        smtp_user: c?.smtp_user ?? '',
        // Never sent by the server — the box is for a NEW password only.
        smtp_password: '',
        from_address: c?.from_address ?? '',
        from_name: c?.from_name ?? '',
    };
}

function toBody(edits: Partial<FormValues>): EmailConfigBody {
    const body: EmailConfigBody = {};
    for (const [key, value] of Object.entries(edits) as [FieldName, string][]) {
        if (key === 'smtp_secure') body.smtp_secure = value === 'true';
        else if (key === 'smtp_port') body.smtp_port = Number(value);
        else body[key] = value;
    }
    return body;
}

interface EmailSettingsProps {
    onChangesUpdate?: (hasChanges: boolean) => void;
}

const EmailSettings = ({ onChangesUpdate }: EmailSettingsProps) => {
    const toast = useToast();
    const queryClient = useQueryClient();
    const { data, isLoading: isConfigLoading, isError, error } = useQuery(emailConfigQuery());
    const saved = toFormValues(data?.config);
    const passwordSet = data?.config.smtp_password_set ?? false;
    const [edits, setEdits] = useState<Partial<FormValues>>({});
    const [isSaving, setIsSaving] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [isSending, setIsSending] = useState(false);

    const hasChanges = Object.keys(edits).length > 0;

    useEffect(() => {
        onChangesUpdate?.(hasChanges);
        // onChangesUpdate intentionally excluded to prevent infinite loop
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasChanges]);

    const handleInputChange = (field: FieldName, value: string) => {
        setEdits((prev) => {
            const next = { ...prev };
            // A password box is only "changed" when something is typed in it.
            const unchanged = field === 'smtp_password' ? value === '' : value === saved[field];
            if (unchanged) delete next[field];
            else next[field] = value;
            return next;
        });
    };

    const value = (field: FieldName): string => edits[field] ?? saved[field];

    const saveChanges = async () => {
        if (!hasChanges || isSaving) return;
        if (edits.smtp_port !== undefined && !/^\d{1,5}$/.test(edits.smtp_port)) {
            toast.error('The SMTP port must be a number, e.g. 465 or 587.');
            return;
        }
        setIsSaving(true);
        try {
            await postJSON('/api/email/config', toBody(edits));
            // Awaited so the edits clear only once the saved values are on screen.
            await queryClient.invalidateQueries({ queryKey: qk.settings.emailConfig() });
            setEdits({});
            toast.success('Email settings saved');
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Failed to save the email settings'));
        } finally {
            setIsSaving(false);
        }
    };

    const testConnection = async () => {
        setIsTesting(true);
        try {
            // Raw (excluded from contracts): /api/email/test returns a raw top-level
            // { success, message?, error? } at 200 (semantic-success, NOT the envelope) —
            // see docs/shared-contract-progress.md. Left unguarded by design.
            // It is a POST because it opens an outbound SMTP connection.
            const result = await postJSON<{ success?: boolean; message?: string; error?: string }>('/api/email/test', {});
            if (result.success) toast.success('Connection test passed — the saved settings work.');
            else toast.error(`Connection test failed: ${result.message || result.error || 'unknown error'}`);
        } catch (err) {
            toast.error('Connection test failed: ' + httpErrorMessage(err, 'unknown error'));
        } finally {
            setIsTesting(false);
        }
    };

    const sendTestEmail = async () => {
        setIsSending(true);
        try {
            await postJSON('/api/email/test-send', {});
            toast.success('Test email sent');
        } catch (err) {
            toast.error('Failed to send the test email: ' + httpErrorMessage(err, 'unknown error'));
        } finally {
            setIsSending(false);
        }
    };

    return (
        <div className="email-settings">
            <div className="settings-section-inner">
                <div className="section-header">
                    <h3>Email Configuration</h3>
                    <p className="section-description">
                        Configure SMTP settings for sending appointment notifications to staff via email.
                    </p>
                </div>

                {isConfigLoading ? (
                    <div className="loading-indicator">
                        <i className="fas fa-spinner fa-spin" aria-hidden="true"></i> Loading email configuration...
                    </div>
                ) : isError ? (
                    <div className="alert alert-warning">
                        <i className="fas fa-exclamation-triangle" aria-hidden="true"></i>{' '}
                        {httpErrorMessage(error, 'Failed to load the email settings.')}
                    </div>
                ) : (
                    <div className="settings-form">
                        <div className="form-group">
                            <label htmlFor="smtp_host">
                                SMTP Host
                                <span className="required">*</span>
                            </label>
                            <input
                                type="text"
                                id="smtp_host"
                                className="form-control"
                                value={value('smtp_host')}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange('smtp_host', e.target.value)}
                                placeholder="smtp.gmail.com"
                            />
                            <small className="form-text">SMTP server hostname</small>
                        </div>

                        <div className="form-group">
                            <label htmlFor="smtp_port">
                                SMTP Port
                                <span className="required">*</span>
                            </label>
                            <input
                                type="number"
                                id="smtp_port"
                                className="form-control"
                                value={value('smtp_port')}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange('smtp_port', e.target.value)}
                                placeholder="465"
                            />
                            <small className="form-text">Port 465 (SSL) or 587 (TLS)</small>
                        </div>

                        <div className="form-group">
                            <label htmlFor="smtp_secure">
                                Use SSL/TLS
                            </label>
                            <select
                                id="smtp_secure"
                                className="form-control"
                                value={value('smtp_secure')}
                                onChange={(e: ChangeEvent<HTMLSelectElement>) => handleInputChange('smtp_secure', e.target.value)}
                            >
                                <option value="true">Yes (SSL - Port 465)</option>
                                <option value="false">No (STARTTLS - Port 587)</option>
                            </select>
                            <small className="form-text">Enable secure connection</small>
                        </div>

                        <div className="form-group">
                            <label htmlFor="smtp_user">
                                SMTP Username / Email
                                <span className="required">*</span>
                            </label>
                            <input
                                type="email"
                                id="smtp_user"
                                className="form-control"
                                value={value('smtp_user')}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange('smtp_user', e.target.value)}
                                placeholder="your-email@gmail.com"
                            />
                            <small className="form-text">Email account for sending</small>
                        </div>

                        <div className="form-group">
                            <label htmlFor="smtp_password">
                                SMTP Password / App Password
                                {!passwordSet && <span className="required">*</span>}
                            </label>
                            <input
                                type="password"
                                id="smtp_password"
                                className="form-control"
                                value={value('smtp_password')}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange('smtp_password', e.target.value)}
                                placeholder={passwordSet ? 'A password is saved — leave blank to keep it' : 'Enter password or app-specific password'}
                                autoComplete="new-password"
                            />
                            <small className="form-text">
                                {passwordSet ? 'Type a new password only to replace the saved one. ' : ''}
                                For Gmail, use an{' '}
                                <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">
                                    App Password
                                </a>
                            </small>
                        </div>

                        <div className="form-group">
                            <label htmlFor="from_address">
                                From Email Address
                            </label>
                            <input
                                type="email"
                                id="from_address"
                                className="form-control"
                                value={value('from_address')}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange('from_address', e.target.value)}
                                placeholder="clinic@example.com"
                            />
                            <small className="form-text">Email address shown as sender</small>
                        </div>

                        <div className="form-group">
                            <label htmlFor="from_name">
                                From Name
                            </label>
                            <input
                                type="text"
                                id="from_name"
                                className="form-control"
                                value={value('from_name')}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange('from_name', e.target.value)}
                                placeholder="The clinic's name"
                            />
                            <small className="form-text">Sender name displayed in emails</small>
                        </div>

                        <div className="form-group">
                            <span>Email Recipients</span>
                            <div className="info-box">
                                <i className="fas fa-info-circle" aria-hidden="true"></i>
                                <span>
                                    Email notifications are sent to employees with &quot;Receive Email&quot; enabled.
                                    Manage recipients in <Link to="/settings/employees">Settings → Employees</Link>.
                                </span>
                            </div>
                        </div>

                        <div className="form-actions">
                            <div className="button-group-left">
                                <button
                                    className="btn btn-primary"
                                    onClick={saveChanges}
                                    disabled={!hasChanges || isSaving}
                                >
                                    <i className="fas fa-save" aria-hidden="true"></i> {isSaving ? 'Saving…' : 'Save Changes'}
                                </button>
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => setEdits({})}
                                    disabled={!hasChanges || isSaving}
                                >
                                    <i className="fas fa-undo" aria-hidden="true"></i> Discard
                                </button>
                            </div>
                            <div className="button-group-right">
                                <button
                                    className="btn btn-info"
                                    onClick={testConnection}
                                    disabled={isTesting || hasChanges}
                                    title={hasChanges ? 'Save first — the test uses the saved settings' : undefined}
                                >
                                    {isTesting ? (
                                        <><i className="fas fa-spinner fa-spin" aria-hidden="true"></i> Testing...</>
                                    ) : (
                                        <><i className="fas fa-plug" aria-hidden="true"></i> Test Connection</>
                                    )}
                                </button>
                                <button
                                    className="btn btn-success"
                                    onClick={sendTestEmail}
                                    disabled={isSending || hasChanges}
                                    title={hasChanges ? 'Save first — the test uses the saved settings' : undefined}
                                >
                                    {isSending ? (
                                        <><i className="fas fa-spinner fa-spin" aria-hidden="true"></i> Sending...</>
                                    ) : (
                                        <><i className="fas fa-envelope" aria-hidden="true"></i> Send Test Email</>
                                    )}
                                </button>
                            </div>
                        </div>

                        {hasChanges && (
                            <div className="alert alert-warning">
                                <i className="fas fa-exclamation-triangle" aria-hidden="true"></i>
                                You have unsaved changes. Save them before testing — the tests use the saved settings.
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default EmailSettings;
