import { useState, useEffect, useCallback, type ChangeEvent } from 'react';
import Modal from './Modal';
import PatientFolderPicker from './PatientFolderPicker';
import type { FileEntry } from '@/types/api.types';
import { fetchJSON, postJSON, postFormData, httpErrorMessage } from '@/core/http';
import { formatISODate } from '../../core/utils';
import { buildContentUrl } from './files/fileHelpers';
import * as mediaContract from '@shared/contracts/media.contract';
import styles from './WebCephModal.module.css';

/** Minimal slice of the patient `/info` payload the WebCeph create step needs. */
interface WebCephPatientInfo {
    person_id: number;
    patient_name?: string;
    first_name?: string;
    last_name?: string;
    gender_display?: string;
    DateOfBirth?: string;
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    personId: number;
    patientInfo: WebCephPatientInfo | null;
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

interface UploadData {
    recordDate: string;
    targetClass: string;
    /** Image picked from the patient's server folder (primary path). */
    selectedFile: FileEntry | null;
    /** Image chosen from the user's computer (fallback path). */
    imageFile: File | null;
}

/**
 * WebCeph cephalometric-analysis workflow, opened from the patient info page:
 * create the patient in WebCeph (once), then upload an x-ray image. The image is
 * picked straight from the patient's server folder (the server reads it off disk
 * via /webceph/upload-from-file) — with PC upload kept as a fallback. Moved here
 * from the patient edit form so the flow starts where staff naturally are.
 */
const WebCephModal = ({ isOpen, onClose, personId, patientInfo }: Props) => {
    const [webcephData, setWebcephData] = useState<WebcephData | null>(null);
    const [webcephLoading, setWebcephLoading] = useState(false);
    const [webcephError, setWebcephError] = useState<string | null>(null);
    const [webcephSuccess, setWebcephSuccess] = useState('');
    const [photoTypes, setPhotoTypes] = useState<PhotoType[]>([]);
    const [showPicker, setShowPicker] = useState(false);
    const [uploadData, setUploadData] = useState<UploadData>({
        recordDate: formatISODate(),
        targetClass: 'lateral_ceph',
        selectedFile: null,
        imageFile: null,
    });

    // WebCeph's patient ID is the person_id padded to a 6-char minimum — the SAME
    // value used at create time (the server reads it back from the DB on upload).
    const webcephPatientID = String(personId).padStart(6, '0');

    // Create-patient inputs come from the already-loaded `/info` payload:
    // gender_display is the same gender NAME the edit page sent, DateOfBirth the DOB.
    const genderName = patientInfo?.gender_display || '';
    const birthday = patientInfo?.DateOfBirth ? formatISODate(patientInfo.DateOfBirth) : '';

    // WebCeph rejects empty gender/DOB with a cryptic error — list what's missing
    // and block the request before anything is sent.
    const webcephMissingFields = [
        !genderName && 'gender',
        !birthday && 'date of birth',
    ].filter(Boolean) as string[];

    const loadWebcephData = useCallback(async () => {
        try {
            // A hit is `{success:true, data}` → unwrapped to the link object.
            const link = await fetchJSON<WebcephData>(
                `/api/webceph/patient-link/${personId}`,
                { schema: mediaContract.patientLink.response }
            );
            setWebcephData(link);
        } catch (err) {
            // 404 = no WebCeph link yet (the common case, not an error).
            if ((err as { status?: number }).status !== 404) {
                console.error('Error loading WebCeph data:', err);
            }
        }
    }, [personId]);

    const loadPhotoTypes = useCallback(async () => {
        try {
            const types = await fetchJSON<PhotoType[]>('/api/webceph/photo-types', { schema: mediaContract.photoTypes.response });
            setPhotoTypes(types);
        } catch (err) {
            console.error('Error loading photo types:', err);
        }
    }, []);

    // Load WebCeph link + photo types each time the modal opens.
    useEffect(() => {
        if (!isOpen) return;
        loadWebcephData();
        loadPhotoTypes();
    }, [isOpen, loadWebcephData, loadPhotoTypes]);

    const handleCreateWebcephPatient = async () => {
        if (!patientInfo) return;

        if (webcephMissingFields.length > 0) {
            setWebcephError(
                `Cannot create in WebCeph: this patient is missing ${webcephMissingFields.join(' and ')}. ` +
                `Set ${webcephMissingFields.length > 1 ? 'these fields' : 'this field'} in Edit Patient first.`
            );
            return;
        }

        try {
            setWebcephLoading(true);
            setWebcephError(null);

            const webcephPatientData = {
                patientID: webcephPatientID,
                firstName: patientInfo.first_name || '',
                lastName: patientInfo.last_name || '',
                gender: genderName,
                birthday,
                race: 'Asian', // Default value
            };

            const result = await postJSON<{ webcephPatientId: string; link: string; linkId?: string }>(
                '/api/webceph/create-patient',
                { personId, patientData: webcephPatientData },
                { schema: mediaContract.createPatient.response }
            );

            setWebcephData({
                webcephPatientId: result.webcephPatientId,
                link: result.link,
                createdAt: new Date().toISOString(),
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

    // Primary: upload an image already in the patient's server folder — the server
    // reads it off disk, so only the relPath crosses the wire.
    const handleUploadFromFolder = async () => {
        if (!uploadData.selectedFile) {
            setWebcephError('Please choose an image from the patient folder');
            return;
        }

        try {
            setWebcephLoading(true);
            setWebcephError(null);

            const result = await postJSON<{ big?: string; thumbnail?: string; link?: string }>(
                '/api/webceph/upload-from-file',
                {
                    personId,
                    relPath: uploadData.selectedFile.relPath,
                    recordDate: uploadData.recordDate,
                    targetClass: uploadData.targetClass,
                },
                { schema: mediaContract.uploadFromFile.response }
            );

            setWebcephSuccess(`Image uploaded successfully!${result.link ? ` View at: ${result.link}` : ''}`);
            setTimeout(() => setWebcephSuccess(''), 10000);
            setUploadData((d) => ({ ...d, selectedFile: null }));
        } catch (err) {
            console.error('Error uploading image from folder:', err);
            setWebcephError(httpErrorMessage(err, 'Failed to upload image'));
        } finally {
            setWebcephLoading(false);
        }
    };

    // Fallback: upload an image from the user's computer (the original path).
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
            formDataObj.append('patient_id', webcephPatientID);
            formDataObj.append('recordDate', uploadData.recordDate);
            formDataObj.append('targetClass', uploadData.targetClass);

            const result = await postFormData<{ big?: string; thumbnail?: string; link?: string }>(
                '/api/webceph/upload-image',
                formDataObj,
                { schema: mediaContract.uploadImage.response }
            );

            setWebcephSuccess(`Image uploaded successfully!${result.link ? ` View at: ${result.link}` : ''}`);
            setTimeout(() => setWebcephSuccess(''), 10000);
            setUploadData((d) => ({ ...d, imageFile: null }));

            const fileInput = document.getElementById('webceph-image-upload') as HTMLInputElement | null;
            if (fileInput) fileInput.value = '';
        } catch (err) {
            console.error('Error uploading image:', err);
            setWebcephError(httpErrorMessage(err, 'Failed to upload image'));
        } finally {
            setWebcephLoading(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} contentClassName={styles.dialog}>
            <div className={styles.header}>
                <h3 className={styles.headerTitle}>
                    <i className="fas fa-brain" /> WebCeph AI X-Ray Analysis
                </h3>
                <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
                    <i className="fas fa-times" />
                </button>
            </div>

            <div className={styles.body}>
                {patientInfo && (
                    <p className={styles.subtitle}>
                        {patientInfo.patient_name} <span className={styles.subtleId}>(ID: {personId})</span>
                    </p>
                )}

                {webcephError && (
                    <div className={styles.errorBanner}>
                        <span><i className="fas fa-exclamation-circle" /> {webcephError}</span>
                        <button type="button" onClick={() => setWebcephError(null)} className={styles.bannerClose}>×</button>
                    </div>
                )}

                {webcephSuccess && (
                    <div className={styles.successBanner}>
                        <i className="fas fa-check-circle" /> {webcephSuccess}
                    </div>
                )}

                {!webcephData ? (
                    <div className={styles.createCard}>
                        <i className={`fas fa-user-plus ${styles.createIcon}`} />
                        <h4 className={styles.createTitle}>Create Patient in WebCeph</h4>
                        <p className={styles.createDesc}>
                            Get AI-powered cephalometric analysis by creating this patient in WebCeph.
                        </p>
                        <button
                            type="button"
                            className={styles.primaryBtn}
                            onClick={handleCreateWebcephPatient}
                            disabled={webcephLoading || webcephMissingFields.length > 0}
                        >
                            {webcephLoading ? (
                                <><i className="fas fa-spinner fa-spin" /> Creating…</>
                            ) : (
                                <><i className="fas fa-plus-circle" /> Create in WebCeph</>
                            )}
                        </button>
                        {webcephMissingFields.length > 0 && (
                            <p className={styles.createWarn}>
                                <i className="fas fa-exclamation-triangle" />{' '}
                                Requires {webcephMissingFields.join(' and ')} — set {webcephMissingFields.length > 1 ? 'them' : 'it'} in Edit Patient first.
                            </p>
                        )}
                    </div>
                ) : (
                    <>
                        <div className={styles.linkCard}>
                            <div className={styles.linkHeader}>
                                <span className={styles.linkTitle}>
                                    <i className="fas fa-check-circle" /> Patient Created in WebCeph
                                </span>
                                <span className={styles.linkDate}>
                                    {webcephData.createdAt ? new Date(webcephData.createdAt).toLocaleDateString() : ''}
                                </span>
                            </div>
                            <div className={styles.linkInfo}>
                                <div className={styles.linkLabel}>WebCeph Patient ID</div>
                                <div className={styles.linkValue}>{webcephData.webcephPatientId}</div>
                            </div>
                            <a
                                href={webcephData.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={styles.openLink}
                            >
                                <i className="fas fa-external-link-alt" /> Open in WebCeph
                            </a>
                        </div>

                        <div className={styles.uploadCard}>
                            <h4 className={styles.cardTitle}>
                                <i className="fas fa-upload" /> Upload X-Ray Image
                            </h4>

                            <div className={styles.formRow}>
                                <div className={styles.field}>
                                    <label className={styles.label} htmlFor="webceph-record-date">Record Date</label>
                                    <input
                                        id="webceph-record-date"
                                        type="date"
                                        value={uploadData.recordDate}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => setUploadData({ ...uploadData, recordDate: e.target.value })}
                                        className={styles.input}
                                    />
                                </div>
                                <div className={styles.field}>
                                    <label className={styles.label} htmlFor="webceph-photo-type">Photo Type</label>
                                    <select
                                        id="webceph-photo-type"
                                        value={uploadData.targetClass}
                                        onChange={(e: ChangeEvent<HTMLSelectElement>) => setUploadData({ ...uploadData, targetClass: e.target.value })}
                                        className={styles.input}
                                    >
                                        {photoTypes.map((type) => (
                                            <option key={type.class} value={type.class}>{type.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Primary: pick an image already in the patient's server folder */}
                            <div className={styles.sourceBlock}>
                                <span className={styles.label}>Choose image from the patient folder</span>
                                {uploadData.selectedFile ? (
                                    <div className={styles.selectedChip}>
                                        <img
                                            src={buildContentUrl(personId, uploadData.selectedFile.relPath, { thumb: 120, v: uploadData.selectedFile.modified })}
                                            alt={uploadData.selectedFile.name}
                                            className={styles.chipThumb}
                                        />
                                        <span className={styles.chipName} title={uploadData.selectedFile.relPath}>
                                            {uploadData.selectedFile.name}
                                        </span>
                                        <button
                                            type="button"
                                            className={styles.chipClear}
                                            onClick={() => setUploadData({ ...uploadData, selectedFile: null })}
                                            title="Clear selection"
                                        >
                                            <i className="fas fa-times" />
                                        </button>
                                    </div>
                                ) : (
                                    <button type="button" className={styles.chooseBtn} onClick={() => setShowPicker((s) => !s)}>
                                        <i className="fas fa-folder-open" /> {showPicker ? 'Hide patient folder' : 'Browse patient folder'}
                                    </button>
                                )}
                                {showPicker && !uploadData.selectedFile && (
                                    <PatientFolderPicker
                                        personId={personId}
                                        selectedRelPath={null}
                                        onSelect={(entry) => {
                                            setUploadData((d) => ({ ...d, selectedFile: entry, imageFile: null }));
                                            setShowPicker(false);
                                        }}
                                    />
                                )}
                            </div>

                            {/* Fallback: upload from this computer */}
                            <div className={styles.sourceBlock}>
                                <label className={styles.label} htmlFor="webceph-image-upload">Or upload from this computer</label>
                                <input
                                    id="webceph-image-upload"
                                    type="file"
                                    accept="image/jpeg,image/png,image/jpg"
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => setUploadData({ ...uploadData, imageFile: e.target.files?.[0] || null, selectedFile: null })}
                                    className={styles.fileInput}
                                />
                                <div className={styles.helpText}>Accepted formats: JPEG, PNG</div>
                            </div>

                            <button
                                type="button"
                                className={styles.uploadBtn}
                                onClick={uploadData.selectedFile ? handleUploadFromFolder : handleUploadImage}
                                disabled={webcephLoading || (!uploadData.selectedFile && !uploadData.imageFile)}
                            >
                                {webcephLoading ? (
                                    <><i className="fas fa-spinner fa-spin" /> Uploading…</>
                                ) : (
                                    <><i className="fas fa-cloud-upload-alt" /> Upload to WebCeph</>
                                )}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </Modal>
    );
};

export default WebCephModal;
