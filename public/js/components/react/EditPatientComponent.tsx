import { useState, ChangeEvent, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../contexts/ToastContext';
import PhoneInput from './PhoneInput';
import Modal from './Modal';
import ModalHeader from './ModalHeader';
import styles from './EditPatientComponent.module.css';
import { formatISODate } from '../../core/utils';
import { putJSON, postJSON, deleteJSON, httpErrorMessage, type HttpError } from '@/core/http';
import * as patientContract from '@shared/contracts/patient.contract';
import { PATIENT_LANGUAGE_OPTIONS } from '@shared/patient-language';
import { useAuthUser } from '../../contexts/GlobalStateContext';
import { roleCaps, type UserRole } from '@shared/auth/roles';
import { qk } from '@/query/keys';
import { invalidateApprovals } from '@/services/approvals';
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
    notes: string;
    language: string;
    country_code: string;
    estimated_cost: string;
    currency: string;
    tag_id: string;
}

const EditPatientComponent = ({ personId }: Props) => {
    const { t } = useTranslation('patients');
    // Patient edit + delete are FINANCE_ROLES on the server — see the guard above the render.
    const user = useAuthUser();
    const caps = roleCaps(user?.role as UserRole | undefined);
    const navigate = useNavigate();
    const location = useLocation();
    const toast = useToast();
    const queryClient = useQueryClient();
    const [saving, setSaving] = useState(false);
    const [translating, setTranslating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleting, setDeleting] = useState(false);

    // Patient record read — seeds the form below. Always refetched on mount and
    // seeded only once that fetch has settled: Save is a whole-row PUT, so seeding
    // from a cached copy (up to gcTime old) let a save revert a colleague's newer
    // change that nothing on screen had shown (audit FE-F6-8). Each dropdown read
    // is its own query, so one lookup failing can't blank the others.
    const {
        data: patientData,
        isFetching: patientFetching,
        error: patientError,
    } = useQuery({
        ...patientByIdQuery(personId ?? ''),
        enabled: !!personId,
        refetchOnMount: 'always',
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


    // Where Save/Cancel return to. Callers that navigate here pass the page they
    // came from in `location.state.from` (patient-info, patient management, …) so
    // the form hands the user back where they were instead of dumping them on the
    // works page. Falls back to works for a direct URL / refresh (no history state).
    const returnTo = (location.state as { from?: string } | null)?.from ?? null;
    const backTo = (pid: string | number) => returnTo ?? `/patient/${pid}/works`;

    // Form data
    const [formData, setFormData] = useState<FormData>({
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
        notes: '',
        language: '0',
        country_code: '',
        estimated_cost: '',
        currency: 'IQD',
        tag_id: ''
    });

    // One field at a time, always from the latest state. The handlers used to spread
    // the render's `formData`, so two writes in one tick (both phone inputs report at
    // mount) lost the first (audit FE-F6-4).
    const setField = <K extends keyof FormData>(key: K, value: FormData[K]) =>
        setFormData(prev => ({ ...prev, [key]: value }));
    const handlePhoneChange = (value: string) => setField('phone', value);
    const handlePhone2Change = (value: string) => setField('phone2', value);

    // Derived patient-type label for the read-only display (id→name map); the type is
    // derived from the works and never posted, so it is read off the record itself.
    const patientTypeLabel =
        patientTypes.find((pt) => pt.id === patientData?.patient_type_id)?.name ?? '';

    // Populate the form when the patient record arrives (or is refetched after a
    // save). Mirrors the old loadPatientData population exactly — same field
    // coercion (String(...) on FK ids/cost, NULL→'' empty-option, language→'0').
    // Done during render (adjust-state-during-render), keyed on the patient identity,
    // so the React Compiler can optimize and there's no extra post-paint render.
    const patientKey = patientData && !patientFetching ? String(patientData.person_id) : '';
    const [initializedPatientKey, setInitializedPatientKey] = useState('');
    if (patientKey && patientKey !== initializedPatientKey) {
        setInitializedPatientKey(patientKey);
        const data = patientData!;
        setFormData({
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
            notes: data.notes || '',
            language: (data.language !== null && data.language !== undefined) ? data.language.toString() : '0',
            country_code: data.country_code || '',
            estimated_cost: data.estimated_cost ? String(data.estimated_cost) : '',
            currency: data.currency || 'IQD',
            tag_id: data.tag_id ? String(data.tag_id) : ''
        });
    }

    // The form shows once it is seeded from the fresh record (or the read failed).
    const loading = !!personId && !patientError && initializedPatientKey !== String(personId);

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

        const pid = personId;
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
            // The name and phones feed the jump comboboxes and message pickers (FE-F6-9).
            queryClient.invalidateQueries({ queryKey: qk.lookups.patientLookupAll() });

            toast.success(t('edit.toast.success'));
            // Close the form on success — return to the page the user came from
            // (same destination as Cancel). The toast persists across navigation.
            navigate(backTo(pid));
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
        // Back to wherever the user opened the form from (works page by default)
        if (personId) {
            navigate(backTo(personId));
        } else {
            navigate(returnTo ?? '/patient-management');
        }
    };

    // Delete the patient (cascade + photo folder). Mirrors the PatientManagement
    // flow: the backend gates by role/record-age and returns outcome 'pending' when
    // a same-day-only user's delete is routed to admin approval instead of applied.
    const handleDeleteConfirm = async () => {
        if (deleting) return;
        const pid = personId;
        if (!pid) {
            toast.error(t('edit.toast.invalidId'));
            return;
        }
        setDeleting(true);
        try {
            const data = await deleteJSON<{ outcome: string; folderRemoved?: boolean }>(
                `/api/patients/${pid}`,
                { schema: patientContract.deletePatient.response }
            );
            setShowDeleteConfirm(false);
            if (data.outcome === 'pending') {
                toast.success(t('edit.toast.deletePending'));
                // A request was created but no row changed — tell the approval bells
                // (they only hear about a RESOLVED request otherwise, and poll every 5 min).
                void invalidateApprovals();
                return;
            }
            queryClient.invalidateQueries({ queryKey: qk.patient.all(pid) });
            queryClient.invalidateQueries({ queryKey: qk.lookups.patientLookupAll() });
            if (data.folderRemoved === false) {
                toast.warning(t('edit.toast.deleteFolderWarning'));
            } else {
                toast.success(t('edit.toast.deleteSuccess'));
            }
            // The patient no longer exists — leave the edit form for the patient list.
            navigate('/patient-management');
        } catch (err) {
            toast.error(httpErrorMessage(err, t('edit.toast.deleteFailed')));
        } finally {
            setDeleting(false);
        }
    };

    // A doctor/assistant who reaches this route used to fill the whole form and learn
    // "Insufficient permissions" only at Save (FE-F6-6). Gated only once the role is
    // known, so an admin's cold load never flashes it.
    if (user && !caps.editRecords) {
        return (
            <div className={styles.editPatientContainer}>
                <div className={styles.editPatientError} role="alert">
                    <div>
                        <i className="fas fa-lock" aria-hidden="true"></i> {t('edit.notPermitted')}
                    </div>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className={styles.editPatientLoading}>
                <i className={`fas fa-spinner fa-spin ${styles.editPatientLoadingSpinner}`} aria-hidden="true"></i>
                <p>{t('edit.loading')}</p>
            </div>
        );
    }

    return (
        <div className={styles.editPatientContainer}>
            <div className={styles.editPatientHeader}>
                <h2 className={styles.editPatientTitle}>
                    <i className="fas fa-user-edit" aria-hidden="true"></i>
                    {t('edit.title')}
                </h2>
                {patientData && (
                    <p className={styles.editPatientDescription}>
                        {t('edit.editingLabel')} <strong>{patientData.patient_name}</strong> {t('edit.idSuffix', { id: patientData.person_id })}
                    </p>
                )}
            </div>

            {error && (
                <div className={styles.editPatientError} role="alert">
                    <div>
                        <i className="fas fa-exclamation-circle" aria-hidden="true"></i>
                        {error}
                    </div>
                    <button
                        type="button"
                        onClick={() => setError(null)}
                        className={styles.editPatientErrorClose}
                        aria-label={t('edit.dismissError')}
                        title={t('edit.dismissError')}
                    >
                        <i className="fas fa-times" aria-hidden="true"></i>
                    </button>
                </div>
            )}

            {/* Top action buttons */}
            <div className={styles.topActions}>
                <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className={`btn btn-danger ${styles.deleteBtnPush}`}
                    disabled={saving || deleting}
                >
                    <i className="fas fa-trash" aria-hidden="true"></i> {t('edit.delete.button')}
                </button>
                <button
                    type="button"
                    onClick={handleCancel}
                    className="btn btn-secondary"
                    disabled={saving}
                >
                    <i className="fas fa-times" aria-hidden="true"></i> {t('common.cancel')}
                </button>
                <button
                    type="submit"
                    form="edit-patient-form"
                    className="btn btn-primary"
                    disabled={saving}
                >
                    {saving ? (
                        <>
                            <i className="fas fa-spinner fa-spin" aria-hidden="true"></i> {t('edit.saving')}
                        </>
                    ) : (
                        <>
                            <i className="fas fa-save" aria-hidden="true"></i> {t('edit.save')}
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
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setField('patient_name', e.target.value)}
                            required
                            className="form-control"
                            dir="rtl"
                            lang="ar"
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
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setField('first_name', e.target.value)}
                            dir="ltr"
                        />
                    </div>
                    <div className={styles.formGroup}>
                        <label htmlFor="edit-last-name">{t('fields.lastName')}</label>
                        <input
                            id="edit-last-name"
                            type="text"
                            className="form-control"
                            value={formData.last_name}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setField('last_name', e.target.value)}
                            dir="ltr"
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
                            <><i className="fas fa-spinner fa-spin" aria-hidden="true"></i> {t('edit.translating')}</>
                        ) : (
                            <><i className="fas fa-language" aria-hidden="true"></i> {t('edit.translateButton')}</>
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
                            // Digits only: a typed "+964" reached the SMS builder as "++964…" (FE-F6-7e).
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setField('country_code', e.target.value.replace(/\D/g, ''))}
                            placeholder={t('fields.countryCodePlaceholder')}
                            inputMode="numeric"
                            maxLength={4}
                            dir="ltr"
                        />
                    </div>
                    <div className={styles.formGroup}>
                        <label htmlFor="edit-phone">{t('fields.phone')}</label>
                        <PhoneInput
                            id="edit-phone"
                            value={formData.phone}
                            onChange={handlePhoneChange}
                        />
                    </div>
                </div>

                <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                        <label htmlFor="edit-phone2">{t('fields.phone2')}</label>
                        <PhoneInput
                            id="edit-phone2"
                            value={formData.phone2}
                            onChange={handlePhone2Change}
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
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setField('email', e.target.value)}
                            dir="ltr"
                        />
                    </div>
                    <div className={styles.formGroup}>
                        <label htmlFor="edit-date-of-birth">{t('fields.dateOfBirth')}</label>
                        <input
                            id="edit-date-of-birth"
                            type="date"
                            className="form-control"
                            value={formData.date_of_birth}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setField('date_of_birth', e.target.value)}
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
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => setField('gender', e.target.value)}
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
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => setField('language', e.target.value)}
                        >
                            {/* Codebook shared with the reminder senders (FE-F6-2). */}
                            {PATIENT_LANGUAGE_OPTIONS.map(o => (
                                <option key={o.code} value={String(o.code)}>{t(`languages.${o.key}`)}</option>
                            ))}
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
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => setField('address_id', e.target.value)}
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
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => setField('referral_source_id', e.target.value)}
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
                        {/* Read-only: patient type is DERIVED from the patient's works
                            (classifyPatient) — no longer a manual pick. Shown for context. */}
                        <input
                            id="edit-patient-type-id"
                            type="text"
                            className="form-control"
                            value={patientTypeLabel}
                            readOnly
                            disabled
                            title={t('fields.patientTypeDerived')}
                        />
                    </div>
                    <div className={styles.formGroup}>
                        <label htmlFor="edit-tag-id">{t('fields.tag')}</label>
                        <select
                            id="edit-tag-id"
                            className="form-control"
                            value={formData.tag_id}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => setField('tag_id', e.target.value)}
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
                                    setField('estimated_cost', rawValue);
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
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => setField('currency', e.target.value)}
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
                        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setField('notes', e.target.value)}
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
                        <i className="fas fa-times" aria-hidden="true"></i> {t('common.cancel')}
                    </button>
                    <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={saving}
                    >
                        {saving ? (
                            <>
                                <i className="fas fa-spinner fa-spin" aria-hidden="true"></i> {t('edit.saving')}
                            </>
                        ) : (
                            <>
                                <i className="fas fa-save" aria-hidden="true"></i> {t('edit.save')}
                            </>
                        )}
                    </button>
                </div>
            </form>

            <Modal
                isOpen={showDeleteConfirm}
                onClose={() => setShowDeleteConfirm(false)}
                ariaLabelledBy="edit-patient-delete-modal-title"
            >
                <ModalHeader
                    variant="danger"
                    title={t('edit.delete.confirmTitle')}
                    titleId="edit-patient-delete-modal-title"
                    onClose={() => setShowDeleteConfirm(false)}
                />
                <div className={styles.deleteModalContent}>
                    <p>{t('edit.delete.confirmQuestion', { name: patientData?.patient_name ?? formData.patient_name })}</p>
                    <p className={styles.deleteModalWarning}>
                        <i className="fas fa-exclamation-triangle" aria-hidden="true"></i> {t('edit.delete.warning')}
                    </p>
                    <div className={styles.deleteModalActions}>
                        <button onClick={() => setShowDeleteConfirm(false)} className="btn btn-light" disabled={deleting}>
                            {t('common.cancel')}
                        </button>
                        <button onClick={handleDeleteConfirm} className="btn btn-danger" disabled={deleting}>
                            {deleting ? t('edit.delete.deleting') : t('edit.delete.confirm')}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default EditPatientComponent;
