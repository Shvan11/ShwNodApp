/**
 * AddPatientForm - React component for adding new patients
 *
 * Provides a comprehensive tabbed form for patient registration
 * - Desktop: Tabbed interface for organized data entry
 * - Mobile: Accordion/stacked layout for easy mobile access
 */

import { useState, useEffect, ChangeEvent, FormEvent } from 'react';
import { fetchJSON, postJSON, httpErrorMessage, type HttpError } from '@/core/http';
import * as lookup from '@shared/contracts/lookup.contract';
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
    name: string;
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
    const [dropdownData, setDropdownData] = useState<DropdownData>({
        referralSources: [],
        patientTypes: [],
        addresses: [],
        genders: []
    });

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

    // Load dropdown data on component mount
    useEffect(() => {
        const loadDropdownData = async () => {
            try {
                const [referralSources, patientTypes, addresses, genders] = await Promise.all([
                    fetchJSON<DropdownItem[]>('/api/referral-sources', { schema: lookup.referralSources.response }),
                    fetchJSON<DropdownItem[]>('/api/patient-types', { schema: lookup.patientTypes.response }),
                    fetchJSON<DropdownItem[]>('/api/addresses', { schema: lookup.addresses.response }),
                    fetchJSON<DropdownItem[]>('/api/genders', { schema: lookup.genders.response })
                ]);

                setDropdownData({
                    referralSources,
                    patientTypes,
                    addresses,
                    genders
                });
            } catch (error) {
                console.error('Error loading dropdown data:', error);
                showAlert('Failed to load form data. Please refresh the page.');
            }
        };

        loadDropdownData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
            showAlert('Patient name is required.');
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
                `Patient "${formData.patientName}" has been successfully added. Redirecting to works page...`,
                'success',
                result.personId
            );
        } catch (error) {
            const httpErr = error as HttpError;
            const code = (httpErr.data as { details?: { code?: string } } | undefined)?.details?.code;
            if (httpErr.status === 409 && code === 'DUPLICATE_PATIENT_NAME') {
                showAlert(
                    `A patient with the name "${formData.patientName}" already exists. Please use a different name or check existing patients.`,
                    'danger'
                );
            } else if (httpErr.status) {
                // Server responded with a non-2xx — surface its message.
                showAlert(httpErrorMessage(error, 'Failed to add patient. Please try again.'));
            } else {
                // Transport/parse failure (no HTTP status).
                console.error('Error adding patient:', error);
                showAlert('Network error. Please check your connection and try again.');
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
        { id: 'basic', label: 'Basic Info', icon: 'fas fa-user' },
        { id: 'contact', label: 'Contact', icon: 'fas fa-address-book' },
        { id: 'personal', label: 'Personal', icon: 'fas fa-user-circle' },
        { id: 'medical', label: 'Medical', icon: 'fas fa-stethoscope' },
        { id: 'additional', label: 'Additional', icon: 'fas fa-clipboard' }
    ];

    // Render Basic Information Fields
    const renderBasicInfo = () => (
        <div className={styles.tabContentSection}>
            <div className={styles.formRow}>
                <div className={`${styles.formGroup} ${styles.formGroupFullWidth}`}>
                    <label className={styles.formLabel} htmlFor="add-patient-name">
                        <i className="fas fa-signature"></i>
                        Patient Name (Arabic) <span className={styles.required}>*</span>
                    </label>
                    <input
                        id="add-patient-name"
                        type="text"
                        name="patientName"
                        value={formData.patientName}
                        onChange={handleInputChange}
                        className="form-control"
                        placeholder="الاسم الكامل"
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
                        First Name (English)
                    </label>
                    <input
                        id="add-first-name"
                        type="text"
                        name="firstName"
                        value={formData.firstName}
                        onChange={handleInputChange}
                        className="form-control"
                        placeholder="First name"
                        dir="ltr"
                        lang="en"
                    />
                </div>
                <div className={styles.formGroup}>
                    <label className={styles.formLabel} htmlFor="add-last-name">
                        <i className="fas fa-user"></i>
                        Last Name (English)
                    </label>
                    <input
                        id="add-last-name"
                        type="text"
                        name="lastName"
                        value={formData.lastName}
                        onChange={handleInputChange}
                        className="form-control"
                        placeholder="Last name"
                        dir="ltr"
                        lang="en"
                    />
                </div>
            </div>

            <div className={styles.formRow}>
                <div className={styles.formGroup}>
                    <label className={styles.formLabel} htmlFor="add-country-code">
                        <i className="fas fa-globe"></i>
                        Country Code
                    </label>
                    <input
                        id="add-country-code"
                        type="text"
                        name="countryCode"
                        value={formData.countryCode}
                        onChange={handleInputChange}
                        className="form-control"
                        placeholder="e.g., +1, +44"
                        maxLength={5}
                    />
                </div>
                <div className={styles.formGroup}>
                    <label className={styles.formLabel} htmlFor="add-phone">
                        <i className="fas fa-phone"></i>
                        Primary Phone
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
                        Secondary Phone
                    </label>
                    <input
                        id="add-phone2"
                        type="tel"
                        name="phone2"
                        value={formData.phone2}
                        onChange={handleInputChange}
                        className="form-control"
                        placeholder="Secondary phone number"
                    />
                </div>
                <div className={styles.formGroup}>
                    <label className={styles.formLabel} htmlFor="add-email">
                        <i className="fas fa-envelope"></i>
                        Email Address
                    </label>
                    <input
                        id="add-email"
                        type="email"
                        name="email"
                        value={formData.email}
                        onChange={handleInputChange}
                        className="form-control"
                        placeholder="patient@example.com"
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
                        Date of Birth
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
                        Gender
                    </label>
                    <select
                        id="add-gender"
                        name="gender"
                        value={formData.gender}
                        onChange={handleInputChange}
                        className="form-control"
                    >
                        <option value="">Select Gender</option>
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
                        Language
                    </label>
                    <select
                        id="add-language"
                        name="language"
                        value={formData.language}
                        onChange={handleInputChange}
                        className="form-control"
                    >
                        <option value="0">Kurdish</option>
                        <option value="1">Arabic</option>
                        <option value="2">English</option>
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
                        Patient Type
                    </label>
                    <select
                        id="add-patient-type"
                        name="patientTypeID"
                        value={formData.patientTypeID}
                        onChange={handleInputChange}
                        className="form-control"
                    >
                        <option value="">Select Patient Type</option>
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
                        Referral Source
                    </label>
                    <select
                        id="add-referral-source"
                        name="referralSourceID"
                        value={formData.referralSourceID}
                        onChange={handleInputChange}
                        className="form-control"
                    >
                        <option value="">Select Referral Source</option>
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
                        Address
                    </label>
                    <select
                        id="add-address"
                        name="addressID"
                        value={formData.addressID}
                        onChange={handleInputChange}
                        className="form-control"
                    >
                        <option value="">Select Address</option>
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
                        Notes
                    </label>
                    <textarea
                        id="add-notes"
                        name="notes"
                        value={formData.notes}
                        onChange={handleInputChange}
                        className="form-control"
                        rows={3}
                        maxLength={100}
                        placeholder="Additional notes about the patient..."
                    />
                </div>
            </div>

            <div className={styles.formRow}>
                <div className={`${styles.formGroup} ${styles.formGroupFullWidth}`}>
                    <label className={styles.formLabel} htmlFor="add-alerts">
                        <i className="fas fa-exclamation-triangle"></i>
                        Alerts
                    </label>
                    <textarea
                        id="add-alerts"
                        name="alerts"
                        value={formData.alerts}
                        onChange={handleInputChange}
                        className="form-control"
                        rows={3}
                        placeholder="Important alerts or warnings..."
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
                Add New Patient
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
                        <span>Cancel</span>
                    </button>
                    <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={loading}
                    >
                        {loading ? (
                            <>
                                <div className={styles.loadingSpinner}></div>
                                <span>Adding Patient...</span>
                            </>
                        ) : (
                            <>
                                <i className="fas fa-save"></i>
                                <span>Add Patient</span>
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
                        <span>Cancel</span>
                    </button>
                    <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={loading}
                    >
                        {loading ? (
                            <>
                                <div className={styles.loadingSpinner}></div>
                                <span>Adding Patient...</span>
                            </>
                        ) : (
                            <>
                                <i className="fas fa-save"></i>
                                <span>Add Patient</span>
                            </>
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default AddPatientForm;
