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
    patientTypesQuery,
    addressesQuery,
    gendersQuery,
} from '@/query/queries';
import * as patientContract from '@shared/contracts/patient.contract';
import PhoneInput from './PhoneInput';
import styles from './AddPatientForm.module.css';

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
    patientTypeID: string;
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
    patientTypes: DropdownItem[];
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
        patientTypeID: '',
        language: '0',
        notes: '',
        alerts: ''
    });

    const [loading, setLoading] = useState(false);
    const [alert, setAlert] = useState<Alert>({ show: false, message: '', type: 'danger' });

    // Lookup dropdowns — loaded once via React Query.
    const referralSourcesQ = useQuery(referralSourcesQuery());
    const patientTypesQ = useQuery(patientTypesQuery());
    const addressesQ = useQuery(addressesQuery());
    const gendersQ = useQuery(gendersQuery());

    const dropdownData: DropdownData = {
        referralSources: referralSourcesQ.data ?? [],
        patientTypes: patientTypesQ.data ?? [],
        addresses: addressesQ.data ?? [],
        genders: gendersQ.data ?? [],
    };

    const dropdownError =
        referralSourcesQ.isError || patientTypesQ.isError || addressesQ.isError || gendersQ.isError;

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

        setLoading(true);
        hideAlert();

        let succeeded = false;
        try {
            // Success body is the flat `{ success, personId, message }` (no `data`
            // key), so the envelope unwrap is a passthrough — `personId` is read off it.
            const result = await postJSON<{ personId: number }>('/api/patients', formData, { schema: patientContract.createPatient.response });

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

    // Render Medical Information Fields
    const renderMedicalInfo = () => (
        <div className={styles.tabContentSection}>
            <div className={styles.formRow}>
                <div className={styles.formGroup}>
                    <label className={styles.formLabel} htmlFor="add-patient-type">
                        <i className="fas fa-user-tag"></i>
                        {t('fields.patientType')}
                    </label>
                    <select
                        id="add-patient-type"
                        name="patientTypeID"
                        value={formData.patientTypeID}
                        onChange={handleInputChange}
                        className="form-control"
                    >
                        <option value="">{t('fields.selectPatientType')}</option>
                        {dropdownData.patientTypes.map(type => (
                            <option key={type.id} value={type.id}>
                                {type.name}
                            </option>
                        ))}
                    </select>
                </div>
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

    return (
        <div className={styles.addPatientFormContainer}>
            <h2 className={styles.addPatientTitle}>
                <i className="fas fa-user-plus"></i>
                {t('add.title')}
            </h2>

            {alert.show && (
                <div className={`${styles.alert} ${alert.type === 'success' ? styles.alertSuccess : styles.alertDanger}`}>
                    <i className={`fas ${alert.type === 'success' ? 'fa-check-circle' : 'fa-exclamation-triangle'}`}></i>
                    {alert.message}
                </div>
            )}

            <form onSubmit={handleSubmit} className={styles.patientForm}>
                {/* Form Actions - Top */}
                <div className={`${styles.formActions} ${styles.formActionsTop}`}>
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
                </div>

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

                {/* Form Actions - Bottom */}
                <div className={`${styles.formActions} ${styles.formActionsBottom}`}>
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
                </div>
            </form>
        </div>
    );
};

export default AddPatientForm;
