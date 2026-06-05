import { useState, useEffect, useCallback, ChangeEvent, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext';
import PhoneInput from './PhoneInput';
import styles from './EditPatientComponent.module.css';
import { formatISODate } from '../../core/utils';
import { fetchJSON, postJSON, putJSON, postFormData, httpErrorMessage, type HttpError } from '@/core/http';
import { tagOptions as tagOptionsContract } from '@shared/contracts/patient.contract';
import * as lookup from '@shared/contracts/lookup.contract';

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

interface PhotoType {
    class: string;
    name: string;
}

interface WebcephData {
    webcephPatientId: string;
    link: string;
    createdAt?: string;
}

interface PatientData {
    person_id: number;
    patient_name?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    phone2?: string;
    email?: string;
    date_of_birth?: string;
    gender?: string;
    address_id?: string;
    referral_source_id?: string;
    patient_type_id?: string;
    notes?: string;
    language?: number | string;
    country_code?: string;
    estimated_cost?: string;
    currency?: string;
    tag_id?: string;
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

interface UploadData {
    recordDate: string;
    targetClass: string;
    imageFile: File | null;
}

const EditPatientComponent = ({ personId }: Props) => {
    const navigate = useNavigate();
    const toast = useToast();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState('');
    const [patientData, setPatientData] = useState<PatientData | null>(null);

    // Use validated PersonID from loader, fallback to patientData.person_id
    const validPersonId = personId ?? patientData?.person_id ?? null;

    // Dropdown data
    const [genders, setGenders] = useState<Gender[]>([]);
    const [addresses, setAddresses] = useState<Address[]>([]);
    const [referralSources, setReferralSources] = useState<ReferralSource[]>([]);
    const [patientTypes, setPatientTypes] = useState<PatientType[]>([]);
    const [tags, setTags] = useState<Tag[]>([]);

    // WebCeph integration state
    const [webcephData, setWebcephData] = useState<WebcephData | null>(null);
    const [webcephLoading, setWebcephLoading] = useState(false);
    const [webcephError, setWebcephError] = useState<string | null>(null);
    const [webcephSuccess, setWebcephSuccess] = useState('');
    const [photoTypes, setPhotoTypes] = useState<PhotoType[]>([]);
    const [uploadData, setUploadData] = useState<UploadData>({
        recordDate: formatISODate(),
        targetClass: 'ceph_photo',
        imageFile: null
    });

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

    const loadDropdownData = useCallback(async () => {
        try {
            // Independent dropdowns — each tolerates its own failure (per-promise
            // .catch) so one bad lookup doesn't blank the rest, matching the old
            // per-`res.ok` guards.
            const [gendersData, addressesData, referralsData, typesData, tagsData] = await Promise.all([
                fetchJSON<Gender[]>('/api/genders', { schema: lookup.genders.response }).catch(() => null),
                fetchJSON<Address[]>('/api/addresses', { schema: lookup.addresses.response }).catch(() => null),
                fetchJSON<ReferralSource[]>('/api/referral-sources', { schema: lookup.referralSources.response }).catch(() => null),
                fetchJSON<PatientType[]>('/api/patient-types', { schema: lookup.patientTypes.response }).catch(() => null),
                fetchJSON<Tag[]>('/api/patients/tag-options', { schema: tagOptionsContract.response }).catch(() => null)
            ]);

            if (gendersData) setGenders(gendersData);
            if (addressesData) setAddresses(addressesData);
            if (referralsData) setReferralSources(referralsData);
            if (typesData) setPatientTypes(typesData);
            if (tagsData) setTags(tagsData);
        } catch (err) {
            console.error('Error loading dropdown data:', err);
        }
    }, []);

    const loadPatientData = useCallback(async () => {
        // Use validated personId from loader
        if (!personId) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const data = await fetchJSON<PatientData>(`/api/patients/${personId}`);
            setPatientData(data);

            // Populate form
            setFormData({
                person_id: data.person_id,
                patient_name: data.patient_name || '',
                first_name: data.first_name || '',
                last_name: data.last_name || '',
                phone: data.phone || '',
                phone2: data.phone2 || '',
                email: data.email || '',
                date_of_birth: data.date_of_birth ? formatISODate(data.date_of_birth) : '',
                gender: data.gender || '',
                address_id: data.address_id || '',
                referral_source_id: data.referral_source_id || '',
                patient_type_id: data.patient_type_id || '',
                notes: data.notes || '',
                language: (data.language !== null && data.language !== undefined) ? data.language.toString() : '0',
                country_code: data.country_code || '',
                estimated_cost: data.estimated_cost || '',
                currency: data.currency || 'IQD',
                tag_id: data.tag_id || ''
            });
        } catch (err) {
            console.error('Error loading patient data:', err);
            setError(httpErrorMessage(err, 'Failed to load patient data'));
        } finally {
            setLoading(false);
        }
    }, [personId]);

    useEffect(() => {
        loadDropdownData();
        loadPatientData();
        loadWebcephData();
        loadPhotoTypes();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [personId, loadDropdownData, loadPatientData]);

    // Load WebCeph data for patient
    const loadWebcephData = async () => {
        if (!personId) return;

        try {
            // A hit is `{success:true, data}` → unwrapped to the link object.
            const link = await fetchJSON<WebcephData>(
                `/api/webceph/patient-link/${personId}`
            );
            setWebcephData(link);
        } catch (err) {
            // 404 = this patient has no WebCeph link yet (the common case, not an
            // error); only surface genuine failures.
            if ((err as { status?: number }).status !== 404) {
                console.error('Error loading WebCeph data:', err);
            }
        }
    };

    // Load available photo types
    const loadPhotoTypes = async () => {
        try {
            const photoTypes = await fetchJSON<PhotoType[]>('/api/webceph/photo-types');
            setPhotoTypes(photoTypes);
        } catch (err) {
            console.error('Error loading photo types:', err);
        }
    };

    // Create patient in WebCeph
    const handleCreateWebcephPatient = async () => {
        if (!patientData) return;

        try {
            setWebcephLoading(true);
            setWebcephError(null);

            // Map gender ID to gender name
            let genderName = '';
            if (formData.gender) {
                const gender = genders.find(g => g.id === parseInt(formData.gender));
                genderName = gender ? gender.name : '';
            }

            // Pad PersonID with zeros to meet 6-character minimum
            let paddedPatientID = patientData.person_id.toString();
            if (paddedPatientID.length < 6) {
                paddedPatientID = paddedPatientID.padStart(6, '0');
            }

            const webcephPatientData = {
                patientID: paddedPatientID,
                firstName: formData.first_name || '',
                lastName: formData.last_name || '',
                gender: genderName,
                birthday: formData.date_of_birth || '',
                race: 'Asian' // Default value
            };

            const result = await postJSON<{ webcephPatientId: string; link: string; linkId?: string }>(
                '/api/webceph/create-patient',
                {
                    personId: patientData.person_id,
                    patientData: webcephPatientData
                }
            );

            setWebcephData({
                webcephPatientId: result.webcephPatientId,
                link: result.link,
                createdAt: new Date().toISOString()
            });

            setWebcephSuccess('Patient created in WebCeph successfully!');
            setTimeout(() => setWebcephSuccess(''), 5000);
        } catch (err) {
            console.error('Error creating WebCeph patient:', err);
            setWebcephError(httpErrorMessage(err, 'Failed to create patient in WebCeph'));
        } finally {
            setWebcephLoading(false);
        }
    };

    // Upload X-ray image to WebCeph
    const handleUploadImage = async () => {
        if (!uploadData.imageFile) {
            setWebcephError('Please select an image file');
            return;
        }

        try {
            setWebcephLoading(true);
            setWebcephError(null);

            const formDataObj = new FormData();
            formDataObj.append('image', uploadData.imageFile);
            formDataObj.append('patientID', patientData?.person_id.toString() || '');
            formDataObj.append('recordDate', uploadData.recordDate);
            formDataObj.append('targetClass', uploadData.targetClass);

            const result = await postFormData<{ big?: string; thumbnail?: string; link: string }>(
                '/api/webceph/upload-image',
                formDataObj
            );

            setWebcephSuccess(`Image uploaded successfully! View at: ${result.link}`);
            setTimeout(() => setWebcephSuccess(''), 10000);

            // Reset upload form
            setUploadData({
                recordDate: formatISODate(),
                targetClass: 'ceph_photo',
                imageFile: null
            });

            // Clear file input
            const fileInput = document.getElementById('webceph-image-upload') as HTMLInputElement;
            if (fileInput) fileInput.value = '';
        } catch (err) {
            console.error('Error uploading image:', err);
            setWebcephError(httpErrorMessage(err, 'Failed to upload image'));
        } finally {
            setWebcephLoading(false);
        }
    };

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

            setSuccessMessage('Patient updated successfully!');
            toast.success('Patient updated successfully!');
            setTimeout(() => {
                setSuccessMessage('');
            }, 3000);

            // Reload patient data to get fresh values
            await loadPatientData();
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

                {/* WebCeph AI X-Ray Analysis Section */}
                <div className={styles.webcephIntegrationSection}>
                    <h3 className={styles.webcephSectionHeader}>
                        <i className={`fas fa-brain ${styles.webcephHeaderIcon}`}></i>
                        WebCeph AI X-Ray Analysis
                    </h3>

                    {webcephError && (
                        <div className={styles.webcephError}>
                            <div>
                                <i className="fas fa-exclamation-circle"></i>
                                {webcephError}
                            </div>
                            <button onClick={() => setWebcephError(null)} className={styles.webcephErrorClose}>×</button>
                        </div>
                    )}

                    {webcephSuccess && (
                        <div className={styles.editPatientSuccess}>
                            <i className="fas fa-check-circle"></i>
                            {webcephSuccess}
                        </div>
                    )}

                    {!webcephData ? (
                        <div className={styles.webcephCreateCard}>
                            <i className={`fas fa-user-plus ${styles.webcephCreateIcon}`}></i>
                            <h4 className={styles.webcephCreateTitle}>
                                Create Patient in WebCeph
                            </h4>
                            <p className={styles.webcephCreateDescription}>
                                Get AI-powered cephalometric analysis by creating this patient in WebCeph
                            </p>
                            <button
                                type="button"
                                onClick={handleCreateWebcephPatient}
                                disabled={webcephLoading}
                                className={styles.webcephBtnSend}
                            >
                                {webcephLoading ? (
                                    <>
                                        <i className="fas fa-spinner fa-spin"></i>
                                        Creating...
                                    </>
                                ) : (
                                    <>
                                        <i className="fas fa-plus-circle"></i>
                                        Create in WebCeph
                                    </>
                                )}
                            </button>
                        </div>
                    ) : (
                        <div className={styles.webcephStatusContainer}>
                            {/* Patient Link Card */}
                            <div className={styles.webcephPatientCreatedCard}>
                                <div className={styles.webcephCardHeader}>
                                    <div className={styles.webcephCardTitleGroup}>
                                        <i className={`fas fa-check-circle ${styles.webcephSuccessIcon}`}></i>
                                        <span className={styles.webcephCardTitle}>Patient Created in WebCeph</span>
                                    </div>
                                    <span className={styles.webcephCardSubtitle}>
                                        {webcephData.createdAt ? new Date(webcephData.createdAt).toLocaleDateString() : ''}
                                    </span>
                                </div>
                                <div className={styles.webcephInfoSection}>
                                    <div className={styles.webcephInfoLabel}>WebCeph Patient ID</div>
                                    <div className={styles.webcephInfoValue}>
                                        {webcephData.webcephPatientId}
                                    </div>
                                </div>
                                <a
                                    href={webcephData.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`${styles.webcephBtnSend} ${styles.inlineFlexLink}`}
                                >
                                    <i className="fas fa-external-link-alt"></i>
                                    Open in WebCeph
                                </a>
                            </div>

                            {/* Upload X-Ray Card */}
                            <div className={styles.webcephAnalysisCard}>
                                <h4 className={styles.webcephAnalysisTitle}>
                                    <i className={`fas fa-upload ${styles.webcephHeaderIcon}`}></i>
                                    Upload X-Ray Image
                                </h4>

                                <div className={styles.webcephFormRow}>
                                    <div>
                                        <label className={styles.webcephUploadLabel}>
                                            Record Date
                                        </label>
                                        <input
                                            type="date"
                                            value={uploadData.recordDate}
                                            onChange={(e: ChangeEvent<HTMLInputElement>) => setUploadData({...uploadData, recordDate: e.target.value})}
                                            className={styles.inputHeightConsistent}
                                        />
                                    </div>
                                    <div>
                                        <label className={styles.webcephUploadLabel}>
                                            Photo Type
                                        </label>
                                        <select
                                            value={uploadData.targetClass}
                                            onChange={(e: ChangeEvent<HTMLSelectElement>) => setUploadData({...uploadData, targetClass: e.target.value})}
                                            className={styles.inputHeightConsistent}
                                        >
                                            {photoTypes.map(type => (
                                                <option key={type.class} value={type.class}>{type.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div className={styles.webcephUploadSection}>
                                    <label className={styles.webcephUploadLabel}>
                                        X-Ray Image
                                    </label>
                                    <input
                                        id="webceph-image-upload"
                                        type="file"
                                        accept="image/jpeg,image/png,image/jpg"
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => setUploadData({...uploadData, imageFile: e.target.files?.[0] || null})}
                                        className={styles.webcephFileInputStyled}
                                    />
                                    <div className={styles.webcephHelpText}>
                                        Accepted formats: JPEG, PNG (Max 10MB)
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    onClick={handleUploadImage}
                                    disabled={webcephLoading || !uploadData.imageFile}
                                    className={styles.webcephBtnUpload}
                                >
                                    {webcephLoading ? (
                                        <>
                                            <i className="fas fa-spinner fa-spin"></i>
                                            Uploading...
                                        </>
                                    ) : (
                                        <>
                                            <i className="fas fa-cloud-upload-alt"></i>
                                            Upload to WebCeph
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}
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
