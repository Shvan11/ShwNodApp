import { useState, useEffect, useCallback, ChangeEvent, MouseEvent } from 'react';
import cn from 'classnames';
import styles from './SettingsSection.module.css';

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
        // Check if the key is ALL_UPPERCASE_WITH_UNDERSCORES (database option format)
        if (key === key.toUpperCase() && key.includes('_')) {
            // Convert CALENDAR_EARLY_SLOTS to "Calendar Early Slots"
            return key
                .split('_')
                .map(word => word.charAt(0) + word.slice(1).toLowerCase())
                .join(' ');
        }
        // Handle camelCase or PascalCase with proper acronym handling
        // "OldOPG" → "Old OPG", "myAPIKey" → "My API Key"
        return key
            .replace(/([a-z])([A-Z])/g, '$1 $2')           // lowercase to uppercase: "oldOPG" → "old OPG"
            .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')     // acronym to word: "OPGNew" → "OPG New"
            .replace(/^./, str => str.toUpperCase())       // capitalize first letter
            .replace(/_/g, ' ')                            // replace underscores
            .trim();
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
                    className={hasChanges ? styles.pendingChange : ''}
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
                    className={hasChanges ? styles.pendingChange : ''}
                />
            );
        } else if (value.length > 100) {
            return (
                <textarea
                    id={settingId}
                    value={currentValue}
                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => handleInputChange(key, e.target.value)}
                    rows={3}
                    className={hasChanges ? styles.pendingChange : ''}
                />
            );
        } else {
            return (
                <input
                    type="text"
                    id={settingId}
                    value={currentValue}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange(key, e.target.value)}
                    className={hasChanges ? styles.pendingChange : ''}
                />
            );
        }
    };

    const hasChanges = Object.keys(pendingChanges).length > 0;

    return (
        <div>
            <h3 className={styles.pageTitle}>
                <i className="fas fa-cog"></i>
                System Options
            </h3>
            <p className={styles.sectionDescription}>
                Configure general system settings and preferences
            </p>

            <div className={styles.form}>
                {isLoading ? (
                    <div className={styles.loading}>
                        <i className="fas fa-spinner fa-spin"></i>
                        <span>Loading settings...</span>
                    </div>
                ) : (
                    <div className={styles.formFields}>
                        {Object.keys(options).length === 0 ? (
                            <p className={styles.noSettings}>No settings found. Please check your database configuration.</p>
                        ) : (
                            Object.entries(options)
                                // Filter out settings that have their own dedicated tabs
                                .filter(([key]) => !key.startsWith('EMAIL_') && !key.startsWith('CALENDAR_'))
                                .map(([key, value]) => (
                                <div key={key} className={cn(styles.settingGroup, pendingChanges[key] !== undefined && styles.pendingChange)}>
                                    <label htmlFor={`setting_${key.replace(/[^a-zA-Z0-9]/g, '_')}`}>
                                        {formatSettingName(key)}
                                    </label>
                                    {renderSettingInput(key, value)}
                                    <div className={styles.settingDescription}>Option: {key}</div>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>

            <div className={styles.actions}>
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
