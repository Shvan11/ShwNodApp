import { useState, useEffect, useCallback, ChangeEvent, MouseEvent } from 'react';

interface OptionsMap {
    [key: string]: string;
}

interface ModalState {
    show: boolean;
    title: string;
    message: string;
}

interface GeneralSettingsProps {
    onChangesUpdate?: (hasChanges: boolean) => void;
}

const GeneralSettings = ({ onChangesUpdate }: GeneralSettingsProps) => {
    const [options, setOptions] = useState<OptionsMap>({});
    const [pendingChanges, setPendingChanges] = useState<OptionsMap>({});
    const [isLoading, setIsLoading] = useState(false);
    const [modal, setModal] = useState<ModalState>({ show: false, title: '', message: '' });

    const loadSettings = useCallback(async () => {
        setIsLoading(true);
        try {
            const response = await fetch('/api/options');
            const data = await response.json();

            if (data.status === 'success') {
                const optionsMap: OptionsMap = {};
                data.options.forEach((option: { OptionName: string; OptionValue: string }) => {
                    optionsMap[option.OptionName] = option.OptionValue;
                });
                setOptions(optionsMap);
            } else {
                throw new Error(data.message || 'Failed to load settings');
            }
        } catch (error) {
            console.error('Error loading settings:', error);
            showModal('Error', 'Failed to load settings: ' + (error as Error).message);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        loadSettings();
    }, [loadSettings]);

    useEffect(() => {
        // Notify parent component about changes
        if (onChangesUpdate) {
            onChangesUpdate(Object.keys(pendingChanges).length > 0);
        }
    }, [pendingChanges]); // Remove onChangesUpdate from deps since it should be stable

    const showModal = (title: string, message: string) => {
        setModal({ show: true, title, message });
    };

    const hideModal = () => {
        setModal({ show: false, title: '', message: '' });
    };

    const handleInputChange = (optionName: string, newValue: string) => {
        const originalValue = options[optionName];

        if (newValue !== originalValue) {
            setPendingChanges(prev => ({
                ...prev,
                [optionName]: newValue
            }));
        } else {
            setPendingChanges(prev => {
                const updated = { ...prev };
                delete updated[optionName];
                return updated;
            });
        }
    };

    const saveAllChanges = async () => {
        if (Object.keys(pendingChanges).length === 0) {
            showModal('Info', 'No changes to save.');
            return;
        }

        try {
            const optionsArray = Object.entries(pendingChanges).map(([name, value]) => ({
                name,
                value: value.toString()
            }));

            const response = await fetch('/api/options/bulk', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ options: optionsArray })
            });

            const data = await response.json();

            if (data.status === 'success') {
                // Update local options
                setOptions(prev => ({ ...prev, ...pendingChanges }));
                setPendingChanges({});

                const message = data.failed && data.failed.length > 0
                    ? `Settings saved successfully! ${data.updated} updated, ${data.failed.length} failed: ${data.failed.join(', ')}`
                    : `All settings saved successfully! ${data.updated} options updated.`;

                showModal('Success', message);
            } else {
                throw new Error(data.message || 'Failed to save settings');
            }
        } catch (error) {
            console.error('Error saving settings:', error);
            showModal('Error', 'Failed to save settings: ' + (error as Error).message);
        }
    };

    const refreshSettings = async () => {
        setPendingChanges({});
        await loadSettings();
        showModal('Info', 'Settings refreshed successfully.');
    };

    const formatSettingName = (key: string): string => {
        return key.replace(/([A-Z])/g, ' $1')
                  .replace(/^./, str => str.toUpperCase())
                  .replace(/_/g, ' ');
    };

    const renderSettingInput = (key: string, value: string) => {
        const settingId = `setting_${key.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const isBoolean = value === 'true' || value === 'false';
        const isNumber = !isNaN(Number(value)) && !isNaN(parseFloat(value)) && value !== '';
        const currentValue = pendingChanges[key] !== undefined ? pendingChanges[key] : value;
        const hasChanges = pendingChanges[key] !== undefined;

        if (isBoolean) {
            return (
                <select
                    id={settingId}
                    value={currentValue}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) => handleInputChange(key, e.target.value)}
                    className={hasChanges ? 'pending-change' : ''}
                >
                    <option value="true">True</option>
                    <option value="false">False</option>
                </select>
            );
        } else if (isNumber) {
            return (
                <input
                    type="number"
                    id={settingId}
                    value={currentValue}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange(key, e.target.value)}
                    step="any"
                    className={hasChanges ? 'pending-change' : ''}
                />
            );
        } else if (value.length > 100) {
            return (
                <textarea
                    id={settingId}
                    value={currentValue}
                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => handleInputChange(key, e.target.value)}
                    rows={3}
                    className={hasChanges ? 'pending-change' : ''}
                />
            );
        } else {
            return (
                <input
                    type="text"
                    id={settingId}
                    value={currentValue}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange(key, e.target.value)}
                    className={hasChanges ? 'pending-change' : ''}
                />
            );
        }
    };

    const hasChanges = Object.keys(pendingChanges).length > 0;

    return (
        <div className="general-settings">
            <div className="settings-section">
                <h3>
                    <i className="fas fa-cog"></i>
                    System Options
                </h3>
                <p className="section-description">
                    Configure general system settings and preferences
                </p>

                <div className="settings-form">
                    {isLoading ? (
                        <div className="loading-spinner">
                            <i className="fas fa-spinner fa-spin"></i>
                            <span>Loading settings...</span>
                        </div>
                    ) : (
                        <div className="settings-form-fields">
                            {Object.keys(options).length === 0 ? (
                                <p className="no-settings">No settings found. Please check your database configuration.</p>
                            ) : (
                                Object.entries(options)
                                    // Filter out email settings - they belong in the Email Settings tab
                                    .filter(([key]) => !key.startsWith('EMAIL_'))
                                    .map(([key, value]) => (
                                    <div key={key} className={`setting-group ${pendingChanges[key] !== undefined ? 'pending-change' : ''}`}>
                                        <label htmlFor={`setting_${key.replace(/[^a-zA-Z0-9]/g, '_')}`}>
                                            {formatSettingName(key)}
                                        </label>
                                        {renderSettingInput(key, value)}
                                        <div className="setting-description">Option: {key}</div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div className="settings-actions">
                <button
                    className="btn btn-primary"
                    onClick={saveAllChanges}
                    disabled={!hasChanges}
                >
                    <i className="fas fa-save"></i>
                    {hasChanges
                        ? `Save Changes (${Object.keys(pendingChanges).length})`
                        : 'Save Changes'
                    }
                </button>
                <button
                    className="btn btn-secondary"
                    onClick={refreshSettings}
                >
                    <i className="fas fa-sync-alt"></i>
                    Refresh Settings
                </button>
            </div>

            {/* Modal */}
            {modal.show && (
                <div className="modal-overlay" onClick={hideModal}>
                    <div className="modal-content" onClick={(e: MouseEvent) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>{modal.title}</h3>
                            <button className="modal-close" onClick={hideModal}>
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        <div className="modal-body">
                            <p>{modal.message}</p>
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

export default GeneralSettings;
