import { useEffect, useState, ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import cn from 'classnames';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import storage from '../../core/storage';
import { useTheme } from '../../contexts/ThemeContext';
import type { ThemePreference } from '../../core/theme';
import { useLanguage } from '../../contexts/LanguageContext';
import { LANGUAGES, type Language } from '../../core/language';
import { useArabicFont } from '../../contexts/FontContext';
import { ARABIC_FONTS, type ArabicFont } from '../../core/font';
import { putJSON, postFormData, deleteJSON, httpErrorMessage } from '@/core/http';
import { allOptionsQuery, brandingQuery } from '@/query/queries';
import { qk } from '@/query/keys';
import * as settings from '@shared/contracts/settings.contract';
import * as brandingContract from '@shared/contracts/branding.contract';
import { WORK_CURRENCIES } from '@shared/work-currency';
import { roleCaps, type UserRole } from '@shared/auth/roles';
import { useAuthUser } from '../../contexts/GlobalStateContext';
import { SYSTEM_OPTIONS, findSystemOption, isManagedOption, type SystemOption } from '../../config/systemOptions';
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

interface GeneralSettingsProps {
    onChangesUpdate?: (hasChanges: boolean) => void;
}

const GeneralSettings = ({ onChangesUpdate }: GeneralSettingsProps) => {
    const [options, setOptions] = useState<OptionsMap>({});
    const [pendingChanges, setPendingChanges] = useState<OptionsMap>({});
    // Saves and refreshes answer with a toast; they used to open a dialog that had to
    // be dismissed every time (FE-F21-13).
    const toast = useToast();
    const confirm = useConfirm();
    const [chairIdInput, setChairIdInput] = useState<string>(storage.chairId() ?? '');
    const [chairIdSaved, setChairIdSaved] = useState<string | null>(storage.chairId());
    const { preference: themePreference, setPreference: setThemePreference } = useTheme();
    const { language, setLanguage } = useLanguage();
    const { arabicFont, setArabicFont } = useArabicFont();
    const { t } = useTranslation('common');
    const queryClient = useQueryClient();
    // The clinic-wide sections (branding + system options) are admin-only on the server,
    // and the options list is never fetched for anyone else (FE-F21-1).
    const user = useAuthUser();
    const canManageSettings = roleCaps(user?.role as UserRole | undefined).manageSettings;

    const { data: optionsData, isLoading, isError, error: loadError, refetch } = useQuery({
        ...allOptionsQuery(),
        enabled: canManageSettings,
    });

    // Clinic branding (logo + display name) — header customization, shared by all
    // users. The name buffers in local state (seeded below, render-phase guard); a
    // freshly-picked logo file + its preview data URL, and a "remove" flag, buffer
    // until Save. All cleared on a successful save.
    const { data: brandingData } = useQuery(brandingQuery());
    const [brandingName, setBrandingName] = useState('');
    // The name patients see INSIDE reminder messages, EN + AR. Separate from the header name on
    // purpose (see shared/contracts/branding.contract.ts): this clinic's header reads "Shwan
    // Orthodontics" while its messages read "Dr. Shwan orthodontic clinic", and folding the two
    // together would silently reword every reminder it sends.
    const [messageName, setMessageName] = useState('');
    const [messageNameAr, setMessageNameAr] = useState('');
    const [logoFile, setLogoFile] = useState<File | null>(null);
    const [logoPreview, setLogoPreview] = useState<string | null>(null);
    const [removeLogoFlag, setRemoveLogoFlag] = useState(false);
    const [savingBranding, setSavingBranding] = useState(false);
    const [seededBranding, setSeededBranding] = useState<unknown>(null);
    if (brandingData && brandingData !== seededBranding) {
        setSeededBranding(brandingData);
        setBrandingName(brandingData.clinicName ?? '');
        setMessageName(brandingData.messageName ?? '');
        setMessageNameAr(brandingData.messageNameAr ?? '');
    }

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

    // Surface a load failure once per error transition.
    useEffect(() => {
        if (isError) toast.error('Failed to load settings: ' + httpErrorMessage(loadError, 'Unknown error'));
    }, [isError, loadError, toast]);

    const onLogoPick = (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0] ?? null;
        e.target.value = ''; // reset so re-picking the same file still fires onChange
        if (!file) return;
        setLogoFile(file);
        setRemoveLogoFlag(false);
        const reader = new FileReader();
        reader.onload = () => setLogoPreview(typeof reader.result === 'string' ? reader.result : null);
        reader.readAsDataURL(file);
    };

    const clearLogo = () => {
        setLogoFile(null);
        setLogoPreview(null);
        setRemoveLogoFlag(true);
    };

    const saveBranding = async () => {
        setSavingBranding(true);
        try {
            // Logo first (upload a new one, or delete the current), then the name.
            if (logoFile) {
                const fd = new FormData();
                fd.append('logo', logoFile);
                await postFormData('/api/branding/logo', fd, { schema: brandingContract.uploadLogo.response });
            } else if (removeLogoFlag) {
                await deleteJSON('/api/branding/logo', { schema: brandingContract.deleteLogo.response });
            }
            if (
                brandingName !== (brandingData?.clinicName ?? '') ||
                messageName !== (brandingData?.messageName ?? '') ||
                messageNameAr !== (brandingData?.messageNameAr ?? '')
            ) {
                await putJSON(
                    '/api/branding',
                    { clinicName: brandingName, messageName, messageNameAr },
                    { schema: brandingContract.updateBranding.response }
                );
            }
            // Refresh both the header (branding) cache and reset the edit buffers.
            await queryClient.invalidateQueries({ queryKey: qk.branding() });
            setLogoFile(null);
            setLogoPreview(null);
            setRemoveLogoFlag(false);
            toast.success('Clinic branding updated.');
        } catch (error) {
            toast.error('Failed to update branding: ' + httpErrorMessage(error, 'Unknown error'));
        } finally {
            setSavingBranding(false);
        }
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
        if (Object.keys(pendingChanges).length === 0) return;

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
            // `settings.option(name)` is a SIBLING of `settings.options()`, not a child, so
            // the line above never reached a single-option reader. The work form reads
            // DEFAULT_WORK_CURRENCY that way — refresh each option this save touched.
            for (const name of Object.keys(pendingChanges)) {
                queryClient.invalidateQueries({ queryKey: qk.settings.option(name) });
            }
            // The patient page's "open folder" reads PatientsFolder through its own feed,
            // cached for an hour (FE-F21-11).
            if (Object.keys(pendingChanges).some(name => name.toLowerCase() === 'patientsfolder')) {
                queryClient.invalidateQueries({ queryKey: qk.lookups.patientsFolder() });
            }

            if (data.failed && data.failed.length > 0) {
                toast.warning(`${data.updated} saved; ${data.failed.length} not saved: ${data.failed.join(', ')}`);
            } else {
                toast.success(`Settings saved (${data.updated} changed).`);
            }
        } catch (error) {
            toast.error('Failed to save settings: ' + httpErrorMessage(error, 'Unknown error'));
        }
    };

    const refreshSettings = async () => {
        if (Object.keys(pendingChanges).length > 0 && !(await confirm(
            'Reloading discards the changes you have not saved. Reload anyway?',
            { title: 'Unsaved changes', confirmText: 'Discard and reload', danger: true }
        ))) {
            return;
        }
        setPendingChanges({});
        await refetch();
        toast.info('Settings reloaded.');
    };

    const saveChairId = () => {
        const trimmed = chairIdInput.trim();
        if (trimmed === '') {
            storage.setChairId(null);
            setChairIdSaved(null);
            toast.success('Chair ID cleared on this PC.');
            return;
        }
        if (!storage.setChairId(trimmed)) {
            toast.warning('Chair ID must be a whole number between 1 and 10.');
            return;
        }
        setChairIdSaved(trimmed);
        toast.success(`This PC is now configured as Chair ${trimmed}.`);
    };

    const chairIdDirty = (chairIdInput.trim() || null) !== chairIdSaved;

    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const secondaryDisplayUrl = `${origin}/chair-display?chair=N`;

    const renderSettingInput = (option: SystemOption, key: string, value: string) => {
        const settingId = `setting_${key.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const currentValue = pendingChanges[key] !== undefined ? pendingChanges[key] : value;
        const className = pendingChanges[key] !== undefined ? styles.pendingChange : '';

        // The work form's starting currency (shared/work-currency.ts). A closed list, not
        // free text: a typo here would silently mean "no default". Blank = no default —
        // staff pick the currency on every new work.
        if (option.kind === 'currency') {
            return (
                <select
                    id={settingId}
                    value={currentValue.trim().toUpperCase()}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) => handleInputChange(key, e.target.value)}
                    className={className}
                >
                    <option value="">Not set — choose on each new work</option>
                    {WORK_CURRENCIES.map(c => (
                        <option key={c} value={c}>{c}</option>
                    ))}
                </select>
            );
        }

        return (
            <input
                type={option.kind === 'number' ? 'number' : 'text'}
                id={settingId}
                value={currentValue}
                onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange(key, e.target.value)}
                step={option.kind === 'number' ? 1 : undefined}
                min={option.kind === 'number' ? 1 : undefined}
                className={className}
            />
        );
    };

    // System Options (owner decision, RF1): the known settings in a fixed order, each
    // under its stored name; everything else stored is listed read-only, collapsed.
    const knownRows = SYSTEM_OPTIONS.flatMap(option => {
        const key = Object.keys(options).find(k => k.toLowerCase() === option.name.toLowerCase());
        return key === undefined ? [] : [{ option, key, value: options[key] }];
    });
    const otherRows = Object.entries(options).filter(
        ([key]) => !findSystemOption(key) && !isManagedOption(key)
    );

    const hasChanges = Object.keys(pendingChanges).length > 0;

    // What the preview shows: a freshly-picked logo, else (unless removal is
    // staged) the current saved logo. `brandingDirty` gates the Save button.
    const shownLogo = logoPreview ?? (removeLogoFlag ? null : brandingData?.logo ?? null);
    const brandingDirty =
        logoFile != null ||
        removeLogoFlag ||
        brandingName !== (brandingData?.clinicName ?? '') ||
        messageName !== (brandingData?.messageName ?? '') ||
        messageNameAr !== (brandingData?.messageNameAr ?? '');

    // Every unsaved edit on this tab — options, branding and the chair ID — so the
    // Settings shell can ask before a tab switch or a navigation drops it (FE-F21-4;
    // only the options used to be reported).
    const tabDirty = hasChanges || brandingDirty || chairIdDirty;
    useEffect(() => {
        onChangesUpdate?.(tabDirty);
    }, [tabDirty, onChangesUpdate]);

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

            {canManageSettings && (<>
                <section className={styles.subsection}>
                    <h3 className={styles.pageTitle}>
                        <i className="fas fa-image"></i>
                        Clinic Branding
                    </h3>
                    <p className={styles.sectionDescription}>
                        The logo and name shown in the app header. Saved for the whole clinic (all users).
                    </p>

                    <div className={styles.settingGroup}>
                        <label htmlFor="logo_input">Logo</label>
                        <div className={styles.brandingLogoRow}>
                            <div className={styles.brandingLogoPreview}>
                                {shownLogo ? (
                                    <img src={shownLogo} alt="Clinic logo preview" />
                                ) : (
                                    <span className={styles.brandingLogoEmpty}>
                                        <i className="fas fa-image" aria-hidden="true" /> No logo
                                    </span>
                                )}
                            </div>
                            <div className={styles.brandingLogoActions}>
                                <label className="btn btn-secondary">
                                    <i className="fas fa-upload"></i>
                                    Choose image
                                    <input
                                        id="logo_input"
                                        type="file"
                                        accept="image/png,image/jpeg,image/webp"
                                        onChange={onLogoPick}
                                        hidden
                                    />
                                </label>
                                {shownLogo && (
                                    <button type="button" className="btn btn-secondary" onClick={clearLogo}>
                                        <i className="fas fa-trash"></i>
                                        Remove
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className={styles.settingDescription}>
                            PNG, JPEG, or WebP, up to 2&nbsp;MB. Shown on the colored header — a transparent
                            PNG works best. Replaces the clinic name when set.
                        </div>
                    </div>

                    <div className={styles.settingGroup}>
                        <label htmlFor="clinic_name_input">Clinic name</label>
                        <input
                            id="clinic_name_input"
                            type="text"
                            maxLength={80}
                            value={brandingName}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setBrandingName(e.target.value)}
                            placeholder="The clinic's name"
                        />
                        <div className={styles.settingDescription}>
                            Shown when no logo is set, and used as the logo&apos;s text alternative.
                        </div>
                    </div>

                    <div className={styles.settingGroup}>
                        <label htmlFor="clinic_message_name_input">Clinic name in patient messages</label>
                        <input
                            id="clinic_message_name_input"
                            type="text"
                            maxLength={80}
                            value={messageName}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setMessageName(e.target.value)}
                            placeholder="The name patients see in reminders"
                        />
                        <div className={styles.settingDescription}>
                            Used inside appointment reminders sent by WhatsApp and SMS, e.g. &ldquo;Tomorrow
                            &quot;Wednesday&quot; is your appointment with <em>this name</em> at 2:30&rdquo;.
                            Kept separate from the header name above, which is usually shorter.
                        </div>
                    </div>

                    <div className={styles.settingGroup}>
                        <label htmlFor="clinic_message_name_ar_input">Clinic name in Arabic messages</label>
                        <input
                            id="clinic_message_name_ar_input"
                            type="text"
                            maxLength={80}
                            dir="rtl"
                            value={messageNameAr}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setMessageNameAr(e.target.value)}
                            placeholder="اسم العيادة في الرسائل"
                        />
                        <div className={styles.settingDescription}>
                            The same name for Arabic-language patients. Most patients receive the Arabic
                            message, so this one matters most.
                        </div>
                    </div>

                    <div className={styles.actions}>
                        <button
                            className="btn btn-primary"
                            onClick={saveBranding}
                            disabled={!brandingDirty || savingBranding}
                        >
                            <i className="fas fa-save"></i>
                            {savingBranding ? 'Saving…' : 'Save Branding'}
                        </button>
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
                                {knownRows.length === 0 ? (
                                    <p className={styles.noSettings}>No settings found. Please check your database configuration.</p>
                                ) : (
                                    knownRows.map(({ option, key, value }) => (
                                        <div key={key} className={cn(styles.settingGroup, pendingChanges[key] !== undefined && styles.pendingChange)}>
                                            <label htmlFor={`setting_${key.replace(/[^a-zA-Z0-9]/g, '_')}`}>
                                                {option.label}
                                            </label>
                                            {renderSettingInput(option, key, value)}
                                            <div className={styles.settingDescription}>{option.description}</div>
                                        </div>
                                    ))
                                )}
                                {otherRows.length > 0 && (
                                    <details className={styles.otherOptions}>
                                        <summary>Other stored values ({otherRows.length})</summary>
                                        <p className={styles.settingDescription}>
                                            Rows in the options table that this version of the app does not read.
                                            Shown for reference only.
                                        </p>
                                        <dl className={styles.otherOptionsList}>
                                            {otherRows.map(([key, value]) => (
                                                <div key={key}>
                                                    <dt>{key}</dt>
                                                    <dd>{value === '' ? '(empty)' : value}</dd>
                                                </div>
                                            ))}
                                        </dl>
                                    </details>
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
            </>)}

        </div>
    );
};

export default GeneralSettings;
