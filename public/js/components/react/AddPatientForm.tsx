/**
 * AddPatientForm - React component for adding new patients
 *
 * Provides a comprehensive tabbed form for patient registration
 * - Desktop: Tabbed interface for organized data entry
 * - Mobile: Accordion/stacked layout for easy mobile access
 */

import { useState, ChangeEvent, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { postJSON, httpErrorMessage, type HttpError } from '@/core/http';
import {
    referralSourcesQuery,
    addressesQuery,
    gendersQuery,
} from '@/query/queries';
import * as patientContract from '@shared/contracts/patient.contract';
import { WORK_TYPE_IDS } from '@shared/treatment-taxonomy';
import PhoneInput from './PhoneInput';
import styles from './AddPatientForm.module.css';

// Intake selector — Regular (no auto-work) / X-ray (imaging work) / Consult work.
type IntakeKind = 'regular' | 'xray' | 'consult';

// The three intake choices, in display order. Module-scoped so the string values
// aren't user-facing JSX literals (labels are t()-keyed via `intake.kinds.<kind>`).
const INTAKE_KINDS: readonly IntakeKind[] = ['regular', 'xray', 'consult'];

// The three imaging work types offered by the X-ray intake (static, no fetch);
// labels are t()-keyed. Kept here (not shared) — it's a UI presentation list.
const XRAY_TYPE_OPTIONS = [
    { id: WORK_TYPE_IDS.OPG, labelKey: 'intake.xrayTypes.opg' },
    { id: WORK_TYPE_IDS.CBCT, labelKey: 'intake.xrayTypes.cbct' },
    { id: WORK_TYPE_IDS.CEPHALO, labelKey: 'intake.xrayTypes.cephalo' },
] as const;

interface Props {
    onSuccess: (personId: number) => void;
    onCancel: () => void;
}

interface FormData {
    patientName: string;
    firstName: string;
    lastName: string;
    phone: string;
    phone2: string;
    email: string;
    countryCode: string;
    dateOfBirth: string;
    gender: string;
    addressID: string;
    referralSourceID: string;
    language: string;
    notes: string;
    alerts: string;
}

interface Alert {
    show: boolean;
    message: string;
    type: 'danger' | 'success';
}

interface DropdownItem {
    id: number;
    // referral_sources.referral / patient_types.patient_type / addresses.zone are
    // nullable in the DB; the dropdown renders the name directly.
    name: string | null;
}

interface DropdownData {
    referralSources: DropdownItem[];
    addresses: DropdownItem[];
    genders: DropdownItem[];
}

interface ExpandedSections {
    basic: boolean;
    contact: boolean;
    personal: boolean;
    medical: boolean;
    additional: boolean;
}

interface Tab {
    id: string;
    label: string;
    icon: string;
}

const AddPatientForm = ({ onSuccess, onCancel }: Props) => {
    const { t } = useTranslation('patients');
    const [formData, setFormData] = useState<FormData>({
        patientName: '',
        firstName: '',
        lastName: '',
        phone: '',
        phone2: '',
        email: '',
        countryCode: '964',
        dateOfBirth: '',
        gender: '',
        addressID: '',
        referralSourceID: '',
        language: '0',
        notes: '',
        alerts: ''
    });

    // Intake selector (basic tab). 'regular' = no auto-work; 'xray'/'consult' auto-create
    // a FINISHED work + full-payment invoice, so the classifier types the patient at create.
    const [intakeKind, setIntakeKind] = useState<IntakeKind>('regular');
    const [xrayWorkTypeId, setXrayWorkTypeId] = useState<string>(String(WORK_TYPE_IDS.OPG));
    const [intakeFee, setIntakeFee] = useState<string>('');
    const [intakeCurrency, setIntakeCurrency] = useState<'IQD' | 'USD'>('IQD');

    const [loading, setLoading] = useState(false);
    const [alert, setAlert] = useState<Alert>({ show: false, message: '', type: 'danger' });

    // Lookup dropdowns — loaded once via React Query. (Patient type is no longer a
    // manual pick — it's derived from works — so its lookup is gone from this form.)
    const referralSourcesQ = useQuery(referralSourcesQuery());
    const addressesQ = useQuery(addressesQuery());
    const gendersQ = useQuery(gendersQuery());

    const dropdownData: DropdownData = {
        referralSources: referralSourcesQ.data ?? [],
        addresses: addressesQ.data ?? [],
        genders: gendersQ.data ?? [],
    };

    const dropdownError =
        referralSourcesQ.isError || addressesQ.isError || gendersQ.isError;

    // Tab state for desktop view
    const [activeTab, setActiveTab] = useState('basic');

    // Accordion state for mobile view
    const [expandedSections, setExpandedSections] = useState<ExpandedSections>({
        basic: true,
        contact: false,
        personal: false,
        medical: false,
        additional: false
    });

    // Surface a load failure for any of the dropdown lookups. Done during render
    // (adjust-state-during-render) rather than in an effect so the React Compiler
    // can optimize it.
    const [prevDropdownError, setPrevDropdownError] = useState(dropdownError);
    if (dropdownError !== prevDropdownError) {
        setPrevDropdownError(dropdownError);
        if (dropdownError) {
            setAlert({ show: true, message: t('add.toast.loadFailed'), type: 'danger' });
        }
    }

    const handleInputChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    // IMaskInput handler - receives unmasked (digits only) value
    const handlePhoneChange = (value: string) => {
        setFormData(prev => ({ ...prev, phone: value }));
    };

    const showAlert = (message: string, type: 'danger' | 'success' = 'danger', personId: number | null = null) => {
        setAlert({ show: true, message, type });

        if (type === 'success' && personId) {
            setTimeout(() => {
                onSuccess(personId);
            }, 1500);
        }
    };

    const hideAlert = () => {
        setAlert({ show: false, message: '', type: 'danger' });
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        // Basic validation
        if (!formData.patientName.trim()) {
            showAlert(t('add.toast.nameRequired'));
            return;
        }

        // Intake (X-ray/Consult) requires a positive fee — the auto-work carries a
        // full-payment invoice for it.
        const feeNum = Number(intakeFee);
        if (intakeKind !== 'regular' && (!Number.isFinite(feeNum) || feeNum <= 0)) {
            showAlert(t('intake.feeRequired'));
            return;
        }

        // Build the explicit request payload: the flat patient fields + an `intake`
        // block ONLY when a non-regular intake is chosen (numbers coerced by the
        // contract). The bare `formData` also carries `alerts`, which the strict
        // create body strips.
        const intake =
            intakeKind === 'xray'
                ? { kind: 'xray' as const, workTypeId: Number(xrayWorkTypeId), fee: feeNum, currency: intakeCurrency }
                : intakeKind === 'consult'
                    ? { kind: 'consult' as const, fee: feeNum, currency: intakeCurrency }
                    : undefined;
        const payload = intake ? { ...formData, intake } : formData;

        setLoading(true);
        hideAlert();

        let succeeded = false;
        try {
            // Success body is the flat `{ success, personId, workId?, invoiceId?, message }`
            // (no `data` key), so the envelope unwrap is a passthrough — `personId` is read off it.
            const result = await postJSON<patientContract.CreatePatientResponse>('/api/patients', payload, { schema: patientContract.createPatient.response });

            succeeded = true;
            showAlert(
                t('add.toast.success', { name: formData.patientName }),
                'success',
                result.personId
            );
        } catch (error) {
            const httpErr = error as HttpError;
            const code = (httpErr.data as { details?: { code?: string } } | undefined)?.details?.code;
            if (httpErr.status === 409 && code === 'DUPLICATE_PATIENT_NAME') {
                showAlert(
                    t('add.toast.duplicate', { name: formData.patientName }),
                    'danger'
                );
            } else if (httpErr.status) {
                // Server responded with a non-2xx — surface its message.
                showAlert(httpErrorMessage(error, t('add.toast.addFailed')));
            } else {
                // Transport/parse failure (no HTTP status).
                console.error('Error adding patient:', error);
                showAlert(t('add.toast.networkError'));
            }
        } finally {
            // On success the button stays disabled through the 1.5s redirect
            // window so a second click can't create a duplicate patient.
            if (!succeeded) setLoading(false);
        }
    };

    const toggleAccordion = (section: keyof ExpandedSections) => {
        setExpandedSections(prev => ({
            ...prev,
            [section]: !prev[section]
        }));
    };

    const tabs: Tab[] = [
        { id: 'basic', label: t('add.tabs.basic'), icon: 'fas fa-user' },
        { id: 'contact', label: t('add.tabs.contact'), icon: 'fas fa-address-book' },
        { id: 'personal', label: t('add.tabs.personal'), icon: 'fas fa-user-circle' },
        { id: 'medical', label: t('add.tabs.medical'), icon: 'fas fa-stethoscope' },
        { id: 'additional', label: t('add.tabs.additional'), icon: 'fas fa-clipboard' }
    ];

    // Render Basic Information Fields
    const renderBasicInfo = () => (
        <div className={styles.tabContentSection}>
            <div className={styles.formRow}>
                <div className={`${styles.formGroup} ${styles.formGroupFullWidth}`}>
                    <label className={styles.formLabel} htmlFor="add-patient-name">
                        <i className="fas fa-signature"></i>
                        {t('fields.patientNameArabic')} <span className={styles.required}>*</span>
                    </label>
                    <input
                        id="add-patient-name"
                        type="text"
                        name="patientName"
                        value={formData.patientName}
                        onChange={handleInputChange}
                        className="form-control"
                        placeholder={t('fields.fullNamePlaceholder')}
                        dir="rtl"
                        lang="ar"
                        required
                    />
                </div>
            </div>

            <div className={styles.formRow}>
                <div className={styles.formGroup}>
                    <label className={styles.formLabel} htmlFor="add-first-name">
                        <i className="fas fa-user"></i>
                        {t('fields.firstNameEnglish')}
                    </label>
                    <input
                        id="add-first-name"
                        type="text"
                        name="firstName"
                        value={formData.firstName}
                        onChange={handleInputChange}
                        className="form-control"
                        placeholder={t('fields.firstNamePlaceholder')}
                        dir="ltr"
                        lang="en"
                    />
                </div>
                <div className={styles.formGroup}>
                    <label className={styles.formLabel} htmlFor="add-last-name">
                        <i className="fas fa-user"></i>
                        {t('fields.lastNameEnglish')}
                    </label>
                    <input
                        id="add-last-name"
                        type="text"
                        name="lastName"
                        value={formData.lastName}
                        onChange={handleInputChange}
                        className="form-control"
                        placeholder={t('fields.lastNamePlaceholder')}
                        dir="ltr"
                        lang="en"
                    />
                </div>
            </div>

            <div className={styles.formRow}>
                <div className={styles.formGroup}>
                    <label className={styles.formLabel} htmlFor="add-country-code">
                        <i className="fas fa-globe"></i>
                        {t('fields.countryCode')}
                    </label>
                    <input
                        id="add-country-code"
                        type="text"
                        name="countryCode"
                        value={formData.countryCode}
                        onChange={handleInputChange}
                        className="form-control"
                        placeholder={t('fields.countryCodePlaceholder')}
                        maxLength={5}
                    />
                </div>
                <div className={styles.formGroup}>
                    <label className={styles.formLabel} htmlFor="add-phone">
                        <i className="fas fa-phone"></i>
                        {t('fields.primaryPhone')}
                    </label>
                    <PhoneInput
                        id="add-phone"
                        value={formData.phone}
                        onChange={handlePhoneChange}
                    />
                </div>
            </div>

            {/* Intake selector — determines the patient's first work (which auto-types
                them): Regular = none; X-ray = imaging work; Consult = consult work. */}
            <div className={styles.formRow}>
                <div className={`${styles.formGroup} ${styles.formGroupFullWidth}`}>
                    <label className={styles.formLabel}>
                        <i className="fas fa-clipboard-check"></i>
                        {t('intake.label')}
                    </label>
                    <div className={styles.intakeRadios}>
                        {INTAKE_KINDS.map((kind) => (
                            <label
                                key={kind}
                                className={`${styles.intakeRadioLabel} ${intakeKind === kind ? styles.intakeRadioLabelActive : ''}`}
                            >
                                <input
                                    type="radio"
                                    name="intakeKind"
                                    value={kind}
                                    checked={intakeKind === kind}
                                    onChange={() => setIntakeKind(kind)}
                                />
                                {t(`intake.kinds.${kind}`)}
                            </label>
                        ))}
                    </div>
                </div>
            </div>

            {intakeKind !== 'regular' && (
                <div className={`${styles.formRow} ${styles.intakeConditional}`}>
                    {intakeKind === 'xray' && (
                        <div className={styles.formGroup}>
                            <label className={styles.formLabel} htmlFor="add-xray-type">
                                <i className="fas fa-x-ray"></i>
                                {t('intake.xrayType')}
                            </label>
                            <select
                                id="add-xray-type"
                                value={xrayWorkTypeId}
                                onChange={(e) => setXrayWorkTypeId(e.target.value)}
                                className="form-control"
                            >
                                {XRAY_TYPE_OPTIONS.map((o) => (
                                    <option key={o.id} value={o.id}>{t(o.labelKey)}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div className={styles.formGroup}>
                        <label className={styles.formLabel} htmlFor="add-intake-fee">
                            <i className="fas fa-money-bill"></i>
                            {t('intake.fee')} <span className={styles.required}>*</span>
                        </label>
                        <input
                            id="add-intake-fee"
                            type="text"
                            inputMode="numeric"
                            value={intakeFee}
                            onChange={(e) => {
                                const raw = e.target.value.replace(/,/g, '');
                                if (raw === '' || /^\d+$/.test(raw)) setIntakeFee(raw);
                            }}
                            className="form-control"
                            placeholder={t('intake.feePlaceholder')}
                        />
                    </div>
                    <div className={styles.formGroup}>
                        <label className={styles.formLabel} htmlFor="add-intake-currency">
                            <i className="fas fa-coins"></i>
                            {t('fields.currency')}
                        </label>
                        <select
                            id="add-intake-currency"
                            value={intakeCurrency}
                            onChange={(e) => setIntakeCurrency(e.target.value as 'IQD' | 'USD')}
                            className="form-control"
                        >
                            <option value="IQD">{t('currencies.iqd')}</option>
                            <option value="USD">{t('currencies.usd')}</option>
                        </select>
                    </div>
                </div>
            )}
        </div>
    );

    // Render Contact Information Fields
    const renderContactInfo = () => (
        <div className={styles.tabContentSection}>
            <div className={styles.formRow}>
                <div className={styles.formGroup}>
                    <label className={styles.formLabel} htmlFor="add-phone2">
                        <i className="fas fa-phone-alt"></i>
                        {t('fields.secondaryPhone')}
                    </label>
                    <input
                        id="add-phone2"
                        type="tel"
                        name="phone2"
                        value={formData.phone2}
                        onChange={handleInputChange}
                        className="form-control"
                        placeholder={t('fields.secondaryPhonePlaceholder')}
                    />
                </div>
                <div className={styles.formGroup}>
                    <label className={styles.formLabel} htmlFor="add-email">
                        <i className="fas fa-envelope"></i>
                        {t('fields.emailAddress')}
                    </label>
                    <input
                        id="add-email"
                        type="email"
                        name="email"
                        value={formData.email}
                        onChange={handleInputChange}
                        className="form-control"
                        placeholder={t('fields.emailPlaceholder')}
                        dir="ltr"
                    />
                </div>
            </div>

        </div>
    );

    // Render Personal Information Fields
    const renderPersonalInfo = () => (
        <div className={styles.tabContentSection}>
            <div className={styles.formRow}>
                <div className={styles.formGroup}>
                    <label className={styles.formLabel} htmlFor="add-date-of-birth">
                        <i className="fas fa-calendar"></i>
                        {t('fields.dateOfBirth')}
                    </label>
                    <input
                        id="add-date-of-birth"
                        type="date"
                        name="dateOfBirth"
                        value={formData.dateOfBirth}
                        onChange={handleInputChange}
                        className="form-control"
                    />
                </div>
                <div className={styles.formGroup}>
                    <label className={styles.formLabel} htmlFor="add-gender">
                        <i className="fas fa-venus-mars"></i>
                        {t('fields.gender')}
                    </label>
                    <select
                        id="add-gender"
                        name="gender"
                        value={formData.gender}
                        onChange={handleInputChange}
                        className="form-control"
                    >
                        <option value="">{t('fields.selectGender')}</option>
                        {dropdownData.genders.map(gender => (
                            <option key={gender.id} value={gender.id}>
                                {gender.name}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            <div className={styles.formRow}>
                <div className={styles.formGroup}>
                    <label className={styles.formLabel} htmlFor="add-language">
                        <i className="fas fa-language"></i>
                        {t('fields.language')}
                    </label>
                    <select
                        id="add-language"
                        name="language"
                        value={formData.language}
                        onChange={handleInputChange}
                        className="form-control"
                    >
                        <option value="0">{t('languages.kurdish')}</option>
                        <option value="1">{t('languages.arabic')}</option>
                        <option value="2">{t('languages.english')}</option>
                    </select>
                </div>
            </div>
        </div>
    );

    // Render Medical Information Fields. (Patient type is no longer set here — it is
    // derived from the patient's works; the intake selector on the Basic tab seeds
    // the first work.)
    const renderMedicalInfo = () => (
        <div className={styles.tabContentSection}>
            <div className={styles.formRow}>
                <div className={styles.formGroup}>
                    <label className={styles.formLabel} htmlFor="add-referral-source">
                        <i className="fas fa-handshake"></i>
                        {t('fields.referralSource')}
                    </label>
                    <select
                        id="add-referral-source"
                        name="referralSourceID"
                        value={formData.referralSourceID}
                        onChange={handleInputChange}
                        className="form-control"
                    >
                        <option value="">{t('fields.selectReferralSource')}</option>
                        {dropdownData.referralSources.map(source => (
                            <option key={source.id} value={source.id}>
                                {source.name}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            <div className={styles.formRow}>
                <div className={styles.formGroup}>
                    <label className={styles.formLabel} htmlFor="add-address">
                        <i className="fas fa-map-marker-alt"></i>
                        {t('fields.address')}
                    </label>
                    <select
                        id="add-address"
                        name="addressID"
                        value={formData.addressID}
                        onChange={handleInputChange}
                        className="form-control"
                    >
                        <option value="">{t('fields.selectAddress')}</option>
                        {dropdownData.addresses.map(address => (
                            <option key={address.id} value={address.id}>
                                {address.name}
                            </option>
                        ))}
                    </select>
                </div>
            </div>
        </div>
    );

    // Render Additional Information Fields
    const renderAdditionalInfo = () => (
        <div className={styles.tabContentSection}>
            <div className={styles.formRow}>
                <div className={`${styles.formGroup} ${styles.formGroupFullWidth}`}>
                    <label className={styles.formLabel} htmlFor="add-notes">
                        <i className="fas fa-sticky-note"></i>
                        {t('fields.notes')}
                    </label>
                    <textarea
                        id="add-notes"
                        name="notes"
                        value={formData.notes}
                        onChange={handleInputChange}
                        className="form-control"
                        rows={3}
                        maxLength={100}
                        placeholder={t('add.notesPlaceholder')}
                    />
                </div>
            </div>

            <div className={styles.formRow}>
                <div className={`${styles.formGroup} ${styles.formGroupFullWidth}`}>
                    <label className={styles.formLabel} htmlFor="add-alerts">
                        <i className="fas fa-exclamation-triangle"></i>
                        {t('add.alerts')}
                    </label>
                    <textarea
                        id="add-alerts"
                        name="alerts"
                        value={formData.alerts}
                        onChange={handleInputChange}
                        className="form-control"
                        rows={3}
                        placeholder={t('add.alertsPlaceholder')}
                    />
                </div>
            </div>
        </div>
    );

    const renderTabContent = (tabId: string) => {
        switch (tabId) {
            case 'basic':
                return renderBasicInfo();
            case 'contact':
                return renderContactInfo();
            case 'personal':
                return renderPersonalInfo();
            case 'medical':
                return renderMedicalInfo();
            case 'additional':
                return renderAdditionalInfo();
            default:
                return null;
        }
    };

    // Shared Cancel/Submit pair — rendered in the header row (desktop) and the
    // bottom bar (mobile accordion); CSS shows exactly one of the two.
    const renderActions = () => (
        <>
            <button
                type="button"
                className="btn btn-secondary"
                onClick={onCancel}
                disabled={loading}
            >
                <i className="fas fa-times"></i>
                <span>{t('common.cancel')}</span>
            </button>
            <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
            >
                {loading ? (
                    <>
                        <div className={styles.loadingSpinner}></div>
                        <span>{t('add.submitting')}</span>
                    </>
                ) : (
                    <>
                        <i className="fas fa-save"></i>
                        <span>{t('add.submit')}</span>
                    </>
                )}
            </button>
        </>
    );

    return (
        <div className={styles.addPatientFormContainer}>
            <form onSubmit={handleSubmit} className={styles.patientForm}>
                {/* Compact header: title + actions share one row (desktop) */}
                <div className={styles.formHeader}>
                    <h2 className={styles.addPatientTitle}>
                        <i className="fas fa-user-plus"></i>
                        {t('add.title')}
                    </h2>
                    <div className={`${styles.formActions} ${styles.headerActions}`}>
                        {renderActions()}
                    </div>
                </div>

                {alert.show && (
                    <div className={`${styles.alert} ${alert.type === 'success' ? styles.alertSuccess : styles.alertDanger}`}>
                        <i className={`fas ${alert.type === 'success' ? 'fa-check-circle' : 'fa-exclamation-triangle'}`}></i>
                        {alert.message}
                    </div>
                )}

                {/* Desktop Tabbed View */}
                <div className={`${styles.formTabsContainer} ${styles.desktopOnly}`}>
                    <div className={styles.tabsHeader}>
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                type="button"
                                className={`${styles.tabButton} ${activeTab === tab.id ? styles.tabButtonActive : ''}`}
                                onClick={() => setActiveTab(tab.id)}
                            >
                                <i className={tab.icon}></i>
                                <span className={styles.tabLabel}>{tab.label}</span>
                            </button>
                        ))}
                    </div>
                    <div className={styles.tabsContent}>
                        {renderTabContent(activeTab)}
                    </div>
                </div>

                {/* Mobile Accordion View */}
                <div className={`${styles.formAccordionContainer} ${styles.mobileOnly}`}>
                    {tabs.map(tab => (
                        <div key={tab.id} className={styles.accordionSection}>
                            <button
                                type="button"
                                className={`${styles.accordionHeader} ${expandedSections[tab.id as keyof ExpandedSections] ? styles.accordionHeaderExpanded : ''}`}
                                onClick={() => toggleAccordion(tab.id as keyof ExpandedSections)}
                            >
                                <div className={styles.accordionTitle}>
                                    <i className={tab.icon}></i>
                                    <span>{tab.label}</span>
                                </div>
                                <i className={`fas fa-chevron-${expandedSections[tab.id as keyof ExpandedSections] ? 'up' : 'down'}`}></i>
                            </button>
                            {expandedSections[tab.id as keyof ExpandedSections] && (
                                <div className={styles.accordionContent}>
                                    {renderTabContent(tab.id)}
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                {/* Bottom bar — mobile accordion only (submit after filling) */}
                <div className={`${styles.formActions} ${styles.bottomActions}`}>
                    {renderActions()}
                </div>
            </form>
        </div>
    );
};

export default AddPatientForm;
