import { useState, useEffect, useCallback, ChangeEvent } from 'react';
import cn from 'classnames';
import Modal from './Modal';
import storage from '../../core/storage';
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
    const [chairIdInput, setChairIdInput] = useState<string>(storage.chairId() ?? '');
    const [chairIdSaved, setChairIdSaved] = useState<string | null>(storage.chairId());

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
        // onChangesUpdate intentionally excluded — parent should provide a stable ref
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingChanges]);

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

    const saveChairId = () => {
        const trimmed = chairIdInput.trim();
        if (trimmed === '') {
            storage.setChairId(null);
            setChairIdSaved(null);
            showModal('Saved', 'Chair ID cleared on this PC.');
            return;
        }
        if (!storage.setChairId(trimmed)) {
            showModal('Invalid', 'Chair ID must be a whole number between 1 and 10.');
            return;
        }
        setChairIdSaved(trimmed);
        showModal('Saved', `This PC is now configured as Chair ${trimmed}.`);
    };

    const chairIdDirty = (chairIdInput.trim() || null) !== chairIdSaved;

    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const secondaryDisplayUrl = `${origin}/chair-display?chair=N`;

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
            <section className={styles.subsection}>
                <h3 className={styles.pageTitle}>
                    <i className="fas fa-desktop"></i>
                    This PC
                </h3>
                <p className={styles.sectionDescription}>
                    Settings stored locally in this browser. Set the Chair ID on chair PCs so the
                    public secondary display can show the patient currently being seen at this chair.
                    Leave blank on non-chair PCs (admin laptops, etc).
                </p>

                <div className={styles.inlineRow}>
                    <div className={cn(styles.settingGroup, chairIdDirty && styles.pendingChange)}>
                        <label htmlFor="chair_id_input">Chair ID (1–10)</label>
                        <input
                            id="chair_id_input"
                            type="number"
                            min={1}
                            max={10}
                            step={1}
                            value={chairIdInput}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setChairIdInput(e.target.value)}
                            className={chairIdDirty ? styles.pendingChange : ''}
                            placeholder="(blank = not a chair PC)"
                        />
                        <div className={styles.settingDescription}>
                            {chairIdSaved
                                ? `Currently configured as Chair ${chairIdSaved} on this PC.`
                                : 'No chair configured on this PC.'}
                        </div>
                    </div>
                    <button
                        className={cn('btn btn-primary', styles.inlineAction)}
                        onClick={saveChairId}
                        disabled={!chairIdDirty}
                    >
                        <i className="fas fa-save"></i>
                        Save Chair ID
                    </button>
                </div>

                <div className={styles.settingGroup}>
                    <label>Secondary Display URL</label>
                    <code className={styles.urlReference}>{secondaryDisplayUrl}</code>
                    <div className={styles.settingDescription}>
                        Open this URL in fullscreen on the patient-facing display PC. Replace
                        <code> N </code> with the chair number (1–10) the display is paired with —
                        e.g. <code>?chair=1</code> for Chair 1.
                        {chairIdSaved && (
                            <> This PC's chair URL: <code>{`${origin}/chair-display?chair=${chairIdSaved}`}</code></>
                        )}
                    </div>
                </div>
            </section>

            <section className={styles.subsection}>
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
            </section>

            {/* Modal */}
            <Modal
                isOpen={modal.show}
                onClose={hideModal}
                contentClassName={styles.infoModal}
                ariaLabelledBy="general-settings-modal-title"
            >
                <div className="modal-header">
                    <h3 id="general-settings-modal-title">{modal.title}</h3>
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
            </Modal>
        </div>
    );
};

export default GeneralSettings;
