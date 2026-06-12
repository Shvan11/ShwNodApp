import { useState, useEffect, ChangeEvent, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '../../contexts/ToastContext';
import PhoneInput from './PhoneInput';
import styles from './EditPatientComponent.module.css';
import { formatISODate } from '../../core/utils';
import { putJSON, httpErrorMessage, type HttpError } from '@/core/http';
import { invalidatePatientCache } from '@/router/loader-cache';
import {
    patientByIdQuery,
    gendersQuery,
    addressesQuery,
    referralSourcesQuery,
    patientTypesQuery,
    tagOptionsQuery,
} from '../../query/queries';

interface Props {
    personId?: number | null;  // Validated PersonID from loader (null if invalid)
}

interface Gender {
    id: number;
    name: string;
}

interface Address {
    id: number;
    name: string;
}

interface ReferralSource {
    id: number;
    name: string;
}

interface PatientType {
    id: number;
    name: string;
}

interface Tag {
    id: number;
    tag: string;
}

interface FormData {
    person_id: string | number;
    patient_name: string;
    first_name: string;
    last_name: string;
    phone: string;
    phone2: string;
    email: string;
    date_of_birth: string;
    gender: string;
    address_id: string;
    referral_source_id: string;
    patient_type_id: string;
    notes: string;
    language: string;
    country_code: string;
    estimated_cost: string;
    currency: string;
    tag_id: string;
}

const EditPatientComponent = ({ personId }: Props) => {
    const navigate = useNavigate();
    const toast = useToast();
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState('');

    // Patient record read — populates the form via the effect below. Each
    // dropdown read is its own independent query, so one lookup failing can't
    // blank the others (same tolerance the old per-promise `.catch` gave, free).
    const {
        data: patientData,
        isLoading: patientLoading,
        error: patientError,
        refetch: refetchPatient,
    } = useQuery({
        ...patientByIdQuery(personId ?? ''),
        enabled: !!personId,
    });

    // Dropdown reads — loose contract responses expose the long-tail fields as
    // unknown, so each `data` is cast to its concrete row type.
    const { data: gendersData } = useQuery(gendersQuery());
    const { data: addressesData } = useQuery(addressesQuery());
    const { data: referralSourcesData } = useQuery(referralSourcesQuery());
    const { data: patientTypesData } = useQuery(patientTypesQuery());
    const { data: tagsData } = useQuery(tagOptionsQuery());

    // Loose contracts model only `{ id }`, so the runtime rows (which carry
    // name/tag) need a double cast through unknown.
    const genders = (gendersData ?? []) as unknown as Gender[];
    const addresses = (addressesData ?? []) as unknown as Address[];
    const referralSources = (referralSourcesData ?? []) as unknown as ReferralSource[];
    const patientTypes = (patientTypesData ?? []) as unknown as PatientType[];
    const tags = (tagsData ?? []) as unknown as Tag[];

    // Loading screen shows only while the patient record is in flight (a missing
    // personId resolves immediately to "not loading").
    const loading = !!personId && patientLoading;

    // Use validated PersonID from loader, fallback to patientData.person_id
    const validPersonId = personId ?? patientData?.person_id ?? null;

    // Form data
    const [formData, setFormData] = useState<FormData>({
        person_id: '',
        patient_name: '',
        first_name: '',
        last_name: '',
        phone: '',
        phone2: '',
        email: '',
        date_of_birth: '',
        gender: '',
        address_id: '',
        referral_source_id: '',
        patient_type_id: '',
        notes: '',
        language: '0',
        country_code: '',
        estimated_cost: '',
        currency: 'IQD',
        tag_id: ''
    });

    // Populate the form when the patient record arrives (or is refetched after a
    // save). Mirrors the old loadPatientData population exactly — same field
    // coercion (String(...) on FK ids/cost, NULL→'' empty-option, language→'0').
    useEffect(() => {
        if (!patientData) return;
        const data = patientData;
        setFormData({
            person_id: data.person_id,
            patient_name: data.patient_name || '',
            first_name: data.first_name || '',
            last_name: data.last_name || '',
            phone: data.phone || '',
            phone2: data.phone2 || '',
            email: data.email || '',
            date_of_birth: data.date_of_birth ? formatISODate(data.date_of_birth) : '',
            // FK ids / cost are DB numbers → coerce to the `<select>`/input strings
            // the form (and the updatePatient body schema) expect. `falsy ? : ''`
            // keeps NULL → '' (the "nothing chosen" empty option).
            gender: data.gender ? String(data.gender) : '',
            address_id: data.address_id ? String(data.address_id) : '',
            referral_source_id: data.referral_source_id ? String(data.referral_source_id) : '',
            patient_type_id: data.patient_type_id ? String(data.patient_type_id) : '',
            notes: data.notes || '',
            language: (data.language !== null && data.language !== undefined) ? data.language.toString() : '0',
            country_code: data.country_code || '',
            estimated_cost: data.estimated_cost ? String(data.estimated_cost) : '',
            currency: data.currency || 'IQD',
            tag_id: data.tag_id ? String(data.tag_id) : ''
        });
    }, [patientData]);

    // Surface a patient-record load failure in the existing error banner (the
    // old loadPatientData did setError(...) on its catch).
    useEffect(() => {
        if (patientError) {
            setError(httpErrorMessage(patientError, 'Failed to load patient data'));
        }
    }, [patientError]);

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        if (!formData.patient_name.trim()) {
            setError('Patient Name is required');
            toast.warning('Patient Name is required');
            return;
        }

        // Use validated PersonID for API call
        const pid = validPersonId ?? formData.person_id;
        if (!pid) {
            setError('Invalid patient ID');
            toast.error('Invalid patient ID');
            return;
        }

        try {
            setSaving(true);
            setError(null);

            await putJSON(`/api/patients/${pid}`, formData);
            invalidatePatientCache(pid); // the patient-shell loader cache is now stale

            setSuccessMessage('Patient updated successfully!');
            toast.success('Patient updated successfully!');
            setTimeout(() => {
                setSuccessMessage('');
            }, 3000);

            // Reload patient data to get fresh values (re-runs the read query →
            // the form-population effect repopulates from the fresh record).
            await refetchPatient();
        } catch (err) {
            // Duplicate patient name → 409 with code/context in `details` (root kept as a fallback).
            const errorData = (err as HttpError).data as {
                code?: string;
                duplicateName?: string;
                details?: { code?: string; duplicateName?: string };
            } | undefined;
            if ((errorData?.details?.code ?? errorData?.code) === 'DUPLICATE_PATIENT_NAME') {
                const duplicateName = errorData?.details?.duplicateName || errorData?.duplicateName || formData.patient_name;
                toast.error(`A patient with the name "${duplicateName}" already exists`);
                setError(`A patient with the name "${duplicateName}" already exists. Please use a different name.`);
                return;
            }

            const errorMessage = httpErrorMessage(err, 'Failed to update patient');
            setError(errorMessage);
            toast.error(errorMessage);
        } finally {
            setSaving(false);
        }
    };

    const handleCancel = () => {
        // Navigate back to works page using React Router
        if (validPersonId) {
            navigate(`/patient/${validPersonId}/works`);
        } else {
            navigate('/patient-management');
        }
    };

    if (loading) {
        return (
            <div className={styles.editPatientLoading}>
                <i className={`fas fa-spinner fa-spin ${styles.editPatientLoadingSpinner}`}></i>
                <p>Loading patient data...</p>
            </div>
        );
    }

    return (
        <div className={styles.editPatientContainer}>
            <div className={styles.editPatientHeader}>
                <h2 className={styles.editPatientTitle}>
                    <i className="fas fa-user-edit"></i>
                    Edit Patient
                </h2>
                {patientData && (
                    <p className={styles.editPatientDescription}>
                        Editing: <strong>{patientData.patient_name}</strong> (ID: {patientData.person_id})
                    </p>
                )}
            </div>

            {error && (
                <div className={styles.editPatientError}>
                    <div>
                        <i className="fas fa-exclamation-circle"></i>
                        {error}
                    </div>
                    <button onClick={() => setError(null)} className={styles.editPatientErrorClose}>×</button>
                </div>
            )}

            {successMessage && (
                <div className={styles.editPatientSuccess}>
                    <i className="fas fa-check-circle"></i>
                    {successMessage}
                </div>
            )}

            {/* Top action buttons */}
            <div className={styles.topActions}>
                <button
                    type="button"
                    onClick={handleCancel}
                    className="btn btn-secondary"
                    disabled={saving}
                >
                    <i className="fas fa-times"></i> Cancel
                </button>
                <button
                    type="submit"
                    form="edit-patient-form"
                    className="btn bg-success"
                    disabled={saving}
                >
                    {saving ? (
                        <>
                            <i className="fas fa-spinner fa-spin"></i> Saving...
                        </>
                    ) : (
                        <>
                            <i className="fas fa-save"></i> Save Changes
                        </>
                    )}
                </button>
            </div>

            <form id="edit-patient-form" onSubmit={handleSubmit} className={styles.editPatientForm}>
                <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                        <label>Patient Name (Arabic) <span className={styles.requiredAsterisk}>*</span></label>
                        <input
                            type="text"
                            value={formData.patient_name}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({...formData, patient_name: e.target.value})}
                            required
                            className={styles.inputHeightConsistent}
                        />
                    </div>
                </div>

                <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                        <label>First Name</label>
                        <input
                            type="text"
                            value={formData.first_name}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({...formData, first_name: e.target.value})}
                        />
                    </div>
                    <div className={styles.formGroup}>
                        <label>Last Name</label>
                        <input
                            type="text"
                            value={formData.last_name}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({...formData, last_name: e.target.value})}
                        />
                    </div>
                </div>

                <div className={`${styles.formRow} ${styles.formRowPhone}`}>
                    <div className={styles.formGroup}>
                        <label>Country Code</label>
                        <input
                            type="text"
                            value={formData.country_code}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({...formData, country_code: e.target.value})}
                            placeholder="+964"
                        />
                    </div>
                    <div className={styles.formGroup}>
                        <label>Phone</label>
                        <PhoneInput
                            value={formData.phone}
                            onChange={(value) => setFormData({...formData, phone: value})}
                        />
                    </div>
                    <div className={styles.formGroup}>
                        <label>Phone 2</label>
                        <PhoneInput
                            value={formData.phone2}
                            onChange={(value) => setFormData({...formData, phone2: value})}
                        />
                    </div>
                </div>

                <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                        <label>Email</label>
                        <input
                            type="email"
                            value={formData.email}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({...formData, email: e.target.value})}
                        />
                    </div>
                    <div className={styles.formGroup}>
                        <label>Date of Birth</label>
                        <input
                            type="date"
                            value={formData.date_of_birth}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({...formData, date_of_birth: e.target.value})}
                        />
                    </div>
                </div>

                <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                        <label>Gender</label>
                        <select
                            value={formData.gender}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => setFormData({...formData, gender: e.target.value})}
                        >
                            <option value="">Select Gender</option>
                            {genders.map(gender => (
                                <option key={gender.id} value={gender.id}>
                                    {gender.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className={styles.formGroup}>
                        <label>Language</label>
                        <select
                            value={formData.language}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => setFormData({...formData, language: e.target.value})}
                        >
                            <option value="0">Kurdish</option>
                            <option value="1">Arabic</option>
                            <option value="2">English</option>
                        </select>
                    </div>
                </div>

                <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                        <label>Address/Zone</label>
                        <select
                            value={formData.address_id}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => setFormData({...formData, address_id: e.target.value})}
                        >
                            <option value="">Select Address</option>
                            {addresses.map(address => (
                                <option key={address.id} value={address.id}>
                                    {address.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className={styles.formGroup}>
                        <label>Referral Source</label>
                        <select
                            value={formData.referral_source_id}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => setFormData({...formData, referral_source_id: e.target.value})}
                        >
                            <option value="">Select Referral Source</option>
                            {referralSources.map(source => (
                                <option key={source.id} value={source.id}>
                                    {source.name}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                        <label>Patient Type</label>
                        <select
                            value={formData.patient_type_id}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => setFormData({...formData, patient_type_id: e.target.value})}
                        >
                            <option value="">Select Patient Type</option>
                            {patientTypes.map(type => (
                                <option key={type.id} value={type.id}>
                                    {type.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className={styles.formGroup}>
                        <label>Tag</label>
                        <select
                            value={formData.tag_id}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => setFormData({...formData, tag_id: e.target.value})}
                        >
                            <option value="">Select Tag</option>
                            {tags.map(tag => (
                                <option key={tag.id} value={tag.id}>
                                    {tag.tag}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                        <label>Estimated Cost (Consultation)</label>
                        <input
                            type="text"
                            value={formData.estimated_cost ? formData.estimated_cost.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') : ''}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => {
                                const rawValue = e.target.value.replace(/,/g, '');
                                if (rawValue === '' || /^\d+$/.test(rawValue)) {
                                    setFormData({...formData, estimated_cost: rawValue});
                                }
                            }}
                            placeholder="Cost quoted at consultation"
                        />
                    </div>
                    <div className={styles.formGroup}>
                        <label>Currency</label>
                        <select
                            value={formData.currency}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => setFormData({...formData, currency: e.target.value})}
                        >
                            <option value="IQD">Iraqi Dinar (IQD)</option>
                            <option value="USD">US Dollar (USD)</option>
                            <option value="EUR">Euro (EUR)</option>
                        </select>
                    </div>
                </div>

                <div className={`${styles.formGroup} ${styles.formGroupFullWidth}`}>
                    <label>Notes</label>
                    <textarea
                        value={formData.notes}
                        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setFormData({...formData, notes: e.target.value})}
                        rows={3}
                    />
                </div>

                <div className={`${styles.modalActions} ${styles.flexEndActions}`}>
                    <button
                        type="button"
                        onClick={handleCancel}
                        className="btn btn-secondary"
                        disabled={saving}
                    >
                        <i className="fas fa-times"></i> Cancel
                    </button>
                    <button
                        type="submit"
                        className="btn bg-success"
                        disabled={saving}
                    >
                        {saving ? (
                            <>
                                <i className="fas fa-spinner fa-spin"></i> Saving...
                            </>
                        ) : (
                            <>
                                <i className="fas fa-save"></i> Save Changes
                            </>
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default EditPatientComponent;
