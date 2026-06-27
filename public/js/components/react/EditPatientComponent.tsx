import { useState, ChangeEvent, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../contexts/ToastContext';
import PhoneInput from './PhoneInput';
import styles from './EditPatientComponent.module.css';
import { formatISODate } from '../../core/utils';
import { putJSON, postJSON, httpErrorMessage, type HttpError } from '@/core/http';
import * as patientContract from '@shared/contracts/patient.contract';
import { qk } from '@/query/keys';
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

// addresses.zone / referral_sources.referral / patient_types.patient_type are
// nullable in the DB (aliased to `name`); rendered directly in the dropdowns.
interface Address {
    id: number;
    name: string | null;
}

interface ReferralSource {
    id: number;
    name: string | null;
}

interface PatientType {
    id: number;
    name: string | null;
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
    const { t } = useTranslation('patients');
    const navigate = useNavigate();
    const toast = useToast();
    const queryClient = useQueryClient();
    const [saving, setSaving] = useState(false);
    const [translating, setTranslating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Patient record read — populates the form via the effect below. Each
    // dropdown read is its own independent query, so one lookup failing can't
    // blank the others (same tolerance the old per-promise `.catch` gave, free).
    const {
        data: patientData,
        isLoading: patientLoading,
        error: patientError,
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

    // Contract rows now model the display field, so these read straight through
    // (the local types below match the contract's nullability).
    const genders: Gender[] = gendersData ?? [];
    const addresses: Address[] = addressesData ?? [];
    const referralSources: ReferralSource[] = referralSourcesData ?? [];
    const patientTypes: PatientType[] = patientTypesData ?? [];
    const tags: Tag[] = tagsData ?? [];

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
    // Done during render (adjust-state-during-render), keyed on the patient identity,
    // so the React Compiler can optimize and there's no extra post-paint render.
    const patientKey = patientData ? String(patientData.person_id) : '';
    const [initializedPatientKey, setInitializedPatientKey] = useState('');
    if (patientKey !== initializedPatientKey) {
        setInitializedPatientKey(patientKey);
        if (patientData) {
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
        }
    }

    // Surface a patient-record load failure in the existing error banner (the
    // old loadPatientData did setError(...) on its catch). Done during render
    // (adjust-state-during-render) so the React Compiler can optimize it.
    const [prevPatientError, setPrevPatientError] = useState(patientError);
    if (patientError !== prevPatientError) {
        setPrevPatientError(patientError);
        if (patientError) {
            setError(httpErrorMessage(patientError, t('edit.toast.loadFailed')));
        }
    }

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        if (!formData.patient_name.trim()) {
            setError(t('edit.toast.nameRequired'));
            toast.warning(t('edit.toast.nameRequired'));
            return;
        }

        // Use validated PersonID for API call
        const pid = validPersonId ?? formData.person_id;
        if (!pid) {
            setError(t('edit.toast.invalidId'));
            toast.error(t('edit.toast.invalidId'));
            return;
        }

        try {
            setSaving(true);
            setError(null);

            await putJSON(`/api/patients/${pid}`, formData);
            queryClient.invalidateQueries({ queryKey: qk.patient.all(pid) });

            toast.success(t('edit.toast.success'));
            // Close the form on success — return to the patient's works page
            // (same destination as Cancel). The toast persists across navigation.
            navigate(`/patient/${pid}/works`);
        } catch (err) {
            // Duplicate patient name → 409 with code/context in `details` (root kept as a fallback).
            const errorData = (err as HttpError).data as {
                code?: string;
                duplicateName?: string;
                details?: { code?: string; duplicateName?: string };
            } | undefined;
            if ((errorData?.details?.code ?? errorData?.code) === 'DUPLICATE_PATIENT_NAME') {
                const duplicateName = errorData?.details?.duplicateName || errorData?.duplicateName || formData.patient_name;
                toast.error(t('edit.toast.duplicateToast', { name: duplicateName }));
                setError(t('edit.toast.duplicateError', { name: duplicateName }));
                return;
            }

            const errorMessage = httpErrorMessage(err, t('edit.toast.updateFailed'));
            setError(errorMessage);
            toast.error(errorMessage);
        } finally {
            setSaving(false);
        }
    };

    // On-demand AI romanization of the Arabic patient name → fills First/Last for the
    // user to review before saving. Clean translate (bounded 8s, no retries): it either
    // fills the name or shows the server's error — no silent empty/manual fallback.
    const handleTranslateName = async () => {
        const arabicName = formData.patient_name.trim();
        if (!arabicName) {
            toast.warning(t('edit.toast.enterNameFirst'));
            return;
        }
        try {
            setTranslating(true);
            const result = await postJSON<patientContract.TransliterateNameResult>(
                '/api/patients/transliterate-name',
                { patientName: arabicName },
                { schema: patientContract.transliterateName.response }
            );
            setFormData(prev => ({
                ...prev,
                first_name: result.firstName || prev.first_name,
                last_name: result.lastName || prev.last_name,
            }));
            toast.success(t('edit.toast.translateSuccess'));
        } catch (err) {
            toast.error(httpErrorMessage(err, t('edit.toast.translateFailed')));
        } finally {
            setTranslating(false);
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
                <p>{t('edit.loading')}</p>
            </div>
        );
    }

    return (
        <div className={styles.editPatientContainer}>
            <div className={styles.editPatientHeader}>
                <h2 className={styles.editPatientTitle}>
                    <i className="fas fa-user-edit"></i>
                    {t('edit.title')}
                </h2>
                {patientData && (
                    <p className={styles.editPatientDescription}>
                        {t('edit.editingLabel')} <strong>{patientData.patient_name}</strong> {t('edit.idSuffix', { id: patientData.person_id })}
                    </p>
                )}
            </div>

            {error && (
                <div className={styles.editPatientError}>
                    <div>
                        <i className="fas fa-exclamation-circle"></i>
                        {error}
                    </div>
                    <button onClick={() => setError(null)} className={styles.editPatientErrorClose}><i className="fas fa-times"></i></button>
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
                    <i className="fas fa-times"></i> {t('common.cancel')}
                </button>
                <button
                    type="submit"
                    form="edit-patient-form"
                    className="btn bg-success"
                    disabled={saving}
                >
                    {saving ? (
                        <>
                            <i className="fas fa-spinner fa-spin"></i> {t('edit.saving')}
                        </>
                    ) : (
                        <>
                            <i className="fas fa-save"></i> {t('edit.save')}
                        </>
                    )}
                </button>
            </div>

            <form id="edit-patient-form" onSubmit={handleSubmit} className={styles.editPatientForm}>
                <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                        <label htmlFor="edit-patient-name">{t('fields.patientNameArabic')} <span className={styles.requiredAsterisk}>*</span></label>
                        <input
                            id="edit-patient-name"
                            type="text"
                            value={formData.patient_name}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({...formData, patient_name: e.target.value})}
                            required
                            className="form-control"
                        />
                    </div>
                </div>

                <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                        <label htmlFor="edit-first-name">{t('fields.firstName')}</label>
                        <input
                            id="edit-first-name"
                            type="text"
                            className="form-control"
                            value={formData.first_name}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({...formData, first_name: e.target.value})}
                        />
                    </div>
                    <div className={styles.formGroup}>
                        <label htmlFor="edit-last-name">{t('fields.lastName')}</label>
                        <input
                            id="edit-last-name"
                            type="text"
                            className="form-control"
                            value={formData.last_name}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({...formData, last_name: e.target.value})}
                        />
                    </div>
                </div>

                {/* Subtle on-demand AI romanization of the Arabic name → fills First/Last for review */}
                <div className={styles.formRow}>
                    <button
                        type="button"
                        className="btn btn-sm btn-outline-primary"
                        onClick={handleTranslateName}
                        disabled={translating || !formData.patient_name.trim()}
                        title={t('edit.translateTitle')}
                    >
                        {translating ? (
                            <><i className="fas fa-spinner fa-spin"></i> {t('edit.translating')}</>
                        ) : (
                            <><i className="fas fa-language"></i> {t('edit.translateButton')}</>
                        )}
                    </button>
                </div>

                <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                        <label htmlFor="edit-country-code">{t('fields.countryCode')}</label>
                        <input
                            id="edit-country-code"
                            type="text"
                            className="form-control"
                            value={formData.country_code}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({...formData, country_code: e.target.value})}
                            placeholder="+964"
                        />
                    </div>
                    <div className={styles.formGroup}>
                        <label htmlFor="edit-phone">{t('fields.phone')}</label>
                        <PhoneInput
                            id="edit-phone"
                            value={formData.phone}
                            onChange={(value) => setFormData({...formData, phone: value})}
                        />
                    </div>
                </div>

                <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                        <label htmlFor="edit-phone2">{t('fields.phone2')}</label>
                        <PhoneInput
                            id="edit-phone2"
                            value={formData.phone2}
                            onChange={(value) => setFormData({...formData, phone2: value})}
                        />
                    </div>
                </div>

                <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                        <label htmlFor="edit-email">{t('fields.email')}</label>
                        <input
                            id="edit-email"
                            type="email"
                            className="form-control"
                            value={formData.email}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({...formData, email: e.target.value})}
                        />
                    </div>
                    <div className={styles.formGroup}>
                        <label htmlFor="edit-date-of-birth">{t('fields.dateOfBirth')}</label>
                        <input
                            id="edit-date-of-birth"
                            type="date"
                            className="form-control"
                            value={formData.date_of_birth}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({...formData, date_of_birth: e.target.value})}
                        />
                    </div>
                </div>

                <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                        <label htmlFor="edit-gender">{t('fields.gender')}</label>
                        <select
                            id="edit-gender"
                            className="form-control"
                            value={formData.gender}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => setFormData({...formData, gender: e.target.value})}
                        >
                            <option value="">{t('fields.selectGender')}</option>
                            {genders.map(gender => (
                                <option key={gender.id} value={gender.id}>
                                    {gender.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className={styles.formGroup}>
                        <label htmlFor="edit-language">{t('fields.language')}</label>
                        <select
                            id="edit-language"
                            className="form-control"
                            value={formData.language}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => setFormData({...formData, language: e.target.value})}
                        >
                            <option value="0">{t('languages.kurdish')}</option>
                            <option value="1">{t('languages.arabic')}</option>
                            <option value="2">{t('languages.english')}</option>
                        </select>
                    </div>
                </div>

                <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                        <label htmlFor="edit-address-id">{t('fields.addressZone')}</label>
                        <select
                            id="edit-address-id"
                            className="form-control"
                            value={formData.address_id}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => setFormData({...formData, address_id: e.target.value})}
                        >
                            <option value="">{t('fields.selectAddress')}</option>
                            {addresses.map(address => (
                                <option key={address.id} value={address.id}>
                                    {address.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className={styles.formGroup}>
                        <label htmlFor="edit-referral-source-id">{t('fields.referralSource')}</label>
                        <select
                            id="edit-referral-source-id"
                            className="form-control"
                            value={formData.referral_source_id}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => setFormData({...formData, referral_source_id: e.target.value})}
                        >
                            <option value="">{t('fields.selectReferralSource')}</option>
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
                        <label htmlFor="edit-patient-type-id">{t('fields.patientType')}</label>
                        <select
                            id="edit-patient-type-id"
                            className="form-control"
                            value={formData.patient_type_id}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => setFormData({...formData, patient_type_id: e.target.value})}
                        >
                            <option value="">{t('fields.selectPatientType')}</option>
                            {patientTypes.map(type => (
                                <option key={type.id} value={type.id}>
                                    {type.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className={styles.formGroup}>
                        <label htmlFor="edit-tag-id">{t('fields.tag')}</label>
                        <select
                            id="edit-tag-id"
                            className="form-control"
                            value={formData.tag_id}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => setFormData({...formData, tag_id: e.target.value})}
                        >
                            <option value="">{t('fields.selectTag')}</option>
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
                        <label htmlFor="edit-estimated-cost">{t('fields.estimatedCost')}</label>
                        <input
                            id="edit-estimated-cost"
                            type="text"
                            className="form-control"
                            value={formData.estimated_cost ? formData.estimated_cost.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') : ''}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => {
                                const rawValue = e.target.value.replace(/,/g, '');
                                if (rawValue === '' || /^\d+$/.test(rawValue)) {
                                    setFormData({...formData, estimated_cost: rawValue});
                                }
                            }}
                            placeholder={t('fields.estimatedCostPlaceholder')}
                        />
                    </div>
                    <div className={styles.formGroup}>
                        <label htmlFor="edit-currency">{t('fields.currency')}</label>
                        <select
                            id="edit-currency"
                            className="form-control"
                            value={formData.currency}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => setFormData({...formData, currency: e.target.value})}
                        >
                            <option value="IQD">{t('currencies.iqd')}</option>
                            <option value="USD">{t('currencies.usd')}</option>
                            <option value="EUR">{t('currencies.eur')}</option>
                        </select>
                    </div>
                </div>

                <div className={`${styles.formGroup} ${styles.formGroupFullWidth}`}>
                    <label htmlFor="edit-notes">{t('fields.notes')}</label>
                    <textarea
                        id="edit-notes"
                        className="form-control"
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
                        <i className="fas fa-times"></i> {t('common.cancel')}
                    </button>
                    <button
                        type="submit"
                        className="btn bg-success"
                        disabled={saving}
                    >
                        {saving ? (
                            <>
                                <i className="fas fa-spinner fa-spin"></i> {t('edit.saving')}
                            </>
                        ) : (
                            <>
                                <i className="fas fa-save"></i> {t('edit.save')}
                            </>
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default EditPatientComponent;
