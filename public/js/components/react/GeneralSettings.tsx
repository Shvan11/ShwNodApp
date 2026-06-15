import { useState, useEffect, ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import cn from 'classnames';
import Modal from './Modal';
import ModalHeader from './ModalHeader';
import storage from '../../core/storage';
import { useTheme } from '../../contexts/ThemeContext';
import type { ThemePreference } from '../../core/theme';
import { useLanguage } from '../../contexts/LanguageContext';
import { LANGUAGES, type Language } from '../../core/language';
import { useArabicFont } from '../../contexts/FontContext';
import { ARABIC_FONTS, type ArabicFont } from '../../core/font';
import { putJSON, httpErrorMessage } from '@/core/http';
import { allOptionsQuery } from '@/query/queries';
import { qk } from '@/query/keys';
import * as settings from '@shared/contracts/settings.contract';
import styles from './SettingsSection.module.css';

// Per-device appearance options, mirrored by the header toggle.
const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string; icon: string }> = [
    { value: 'light', label: 'Light', icon: 'fas fa-sun' },
    { value: 'dark', label: 'Dark', icon: 'fas fa-moon' },
    { value: 'auto', label: 'Auto (follow system)', icon: 'fas fa-circle-half-stroke' },
];

// Languages derived from the registry; own-script names shown deliberately
// untranslated (a speaker recognizes "العربية", not the word "Arabic").
const LANGUAGE_OPTIONS: ReadonlyArray<{ value: Language; nativeLabel: string }> = (
    Object.keys(LANGUAGES) as Language[]
).map((value) => ({ value, nativeLabel: LANGUAGES[value].nativeLabel }));

// Arabic webfonts derived from the registry; each option renders a live sample
// in its own font (font-family applied inline — the only way to preview a face).
const FONT_OPTIONS: ReadonlyArray<{ value: ArabicFont } & (typeof ARABIC_FONTS)[ArabicFont]> = (
    Object.keys(ARABIC_FONTS) as ArabicFont[]
).map((value) => ({ value, ...ARABIC_FONTS[value] }));

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
    const [modal, setModal] = useState<ModalState>({ show: false, title: '', message: '' });
    const [chairIdInput, setChairIdInput] = useState<string>(storage.chairId() ?? '');
    const [chairIdSaved, setChairIdSaved] = useState<string | null>(storage.chairId());
    const { preference: themePreference, setPreference: setThemePreference } = useTheme();
    const { language, setLanguage } = useLanguage();
    const { arabicFont, setArabicFont } = useArabicFont();
    const { t } = useTranslation('common');
    const queryClient = useQueryClient();

    const { data: optionsData, isLoading, isError, error: loadError, refetch } = useQuery(allOptionsQuery());

    // Build the editable `options` map from the query data during render (keyed on
    // the query result reference); `pendingChanges` overlays it for unsaved edits.
    const [seededOptionsData, setSeededOptionsData] = useState<unknown>(null);
    if (optionsData?.options && optionsData !== seededOptionsData) {
        setSeededOptionsData(optionsData);
        const optionsMap: OptionsMap = {};
        optionsData.options.forEach((option) => {
            optionsMap[option.option_name] = option.option_value ?? '';
        });
        setOptions(optionsMap);
    }

    // Surface a load failure once per error transition. setModal is called directly
    // (the later-declared showModal would trip react-hooks/immutability).
    const [prevIsError, setPrevIsError] = useState(isError);
    if (isError !== prevIsError) {
        setPrevIsError(isError);
        if (isError) {
            setModal({ show: true, title: 'Error', message: 'Failed to load settings: ' + httpErrorMessage(loadError, 'Unknown error') });
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

            const data = await putJSON<{
                updated?: number;
                failed?: string[];
            }>('/api/options/bulk', { options: optionsArray }, { schema: settings.bulkOptions.response });

            // putJSON throws on non-2xx, so reaching here means the save succeeded.
            setOptions(prev => ({ ...prev, ...pendingChanges }));
            setPendingChanges({});
            queryClient.invalidateQueries({ queryKey: qk.settings.options() });

            const message = data.failed && data.failed.length > 0
                ? `Settings saved successfully! ${data.updated} updated, ${data.failed.length} failed: ${data.failed.join(', ')}`
                : `All settings saved successfully! ${data.updated} options updated.`;

            showModal('Success', message);
        } catch (error) {
            console.error('Error saving settings:', error);
            showModal('Error', 'Failed to save settings: ' + httpErrorMessage(error, 'Unknown error'));
        }
    };

    const refreshSettings = async () => {
        setPendingChanges({});
        await refetch();
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
                    <span>Secondary Display URL</span>
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

                <div className={styles.settingGroup}>
                    <span>Appearance</span>
                    <div className={styles.themeRadioGroup} role="radiogroup" aria-label="Theme">
                        {THEME_OPTIONS.map((opt) => (
                            <label
                                key={opt.value}
                                className={cn(
                                    styles.themeRadioOption,
                                    themePreference === opt.value && styles.themeRadioOptionActive
                                )}
                            >
                                <input
                                    type="radio"
                                    name="theme-preference"
                                    value={opt.value}
                                    checked={themePreference === opt.value}
                                    onChange={() => setThemePreference(opt.value)}
                                />
                                <i className={opt.icon} aria-hidden="true" />
                                <span>{opt.label}</span>
                            </label>
                        ))}
                    </div>
                    <div className={styles.settingDescription}>
                        Light, dark, or follow your device's system setting. Saved on this PC only.
                    </div>
                </div>

                <div className={styles.settingGroup}>
                    <label>{t('language.label')}</label>
                    <div className={styles.themeRadioGroup} role="radiogroup" aria-label={t('language.label')}>
                        {LANGUAGE_OPTIONS.map((opt) => (
                            <label
                                key={opt.value}
                                className={cn(
                                    styles.themeRadioOption,
                                    language === opt.value && styles.themeRadioOptionActive
                                )}
                            >
                                <input
                                    type="radio"
                                    name="language-preference"
                                    value={opt.value}
                                    checked={language === opt.value}
                                    onChange={() => setLanguage(opt.value)}
                                />
                                <span>{opt.nativeLabel}</span>
                            </label>
                        ))}
                    </div>
                    <div className={styles.settingDescription}>
                        {t('language.description')}
                    </div>
                </div>

                <div className={styles.settingGroup}>
                    <span>Arabic font</span>
                    <div className={styles.fontRadioGroup} role="radiogroup" aria-label="Arabic font">
                        {FONT_OPTIONS.map((opt) => (
                            <label
                                key={opt.value}
                                className={cn(
                                    styles.fontRadioOption,
                                    arabicFont === opt.value && styles.themeRadioOptionActive
                                )}
                            >
                                <input
                                    type="radio"
                                    name="arabic-font-preference"
                                    value={opt.value}
                                    checked={arabicFont === opt.value}
                                    onChange={() => setArabicFont(opt.value)}
                                />
                                <span className={styles.fontOptionMeta}>
                                    <span className={styles.fontOptionLabel}>{opt.label}</span>
                                    <span className={styles.fontOptionNote}>{opt.note}</span>
                                </span>
                                <span
                                    className={styles.fontOptionSample}
                                    style={{ fontFamily: opt.cssFamily }}
                                    dir="rtl"
                                    lang="ar"
                                >
                                    {opt.sample}
                                </span>
                            </label>
                        ))}
                    </div>
                    <div className={styles.settingDescription}>
                        Font used for Arabic text (patient names, Arabic UI). Saved on this PC only.
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
                <ModalHeader
                    titleId="general-settings-modal-title"
                    title={modal.title}
                    onClose={hideModal}
                />
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
