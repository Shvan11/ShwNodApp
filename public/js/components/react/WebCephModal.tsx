import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Modal from './Modal';
import ModalHeader from './ModalHeader';
import PatientFolderPicker from './PatientFolderPicker';
import type { FileEntry } from '@/types/api.types';
import { postJSON, postFormData, httpErrorMessage } from '@/core/http';
import { photoTypesQuery, webcephLinkQuery } from '@/query/queries';
import { qk } from '@/query/keys';
import { formatDate, formatISODate } from '../../core/utils';
import { buildContentUrl } from './files/fileHelpers';
import * as mediaContract from '@shared/contracts/media.contract';
import {
    WEBCEPH_DEFAULT_RACE,
    WEBCEPH_RACES,
    WEBCEPH_RACE_LABELS,
    type WebcephRace,
} from '@shared/webceph-race';
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
    const queryClient = useQueryClient();
    const [webcephLoading, setWebcephLoading] = useState(false);
    const [webcephError, setWebcephError] = useState<string | null>(null);
    const [webcephSuccess, setWebcephSuccess] = useState('');
    const [showPicker, setShowPicker] = useState(false);
    // The norm set WebCeph analyses this patient against. Pre-selected to the
    // clinic default (Caucasian — the Middle Eastern norm set; see
    // shared/webceph-race.ts) and shown as such, so it is never an invisible
    // assumption. Staff change it for a patient of another background.
    const [race, setRace] = useState<WebcephRace>(WEBCEPH_DEFAULT_RACE);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // One success-banner timer at a time: a second upload used to leave the first
    // upload's timer running, which then cleared the second banner early.
    const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const flashSuccess = (message: string, ms: number) => {
        if (successTimerRef.current) clearTimeout(successTimerRef.current);
        setWebcephSuccess(message);
        successTimerRef.current = setTimeout(() => setWebcephSuccess(''), ms);
    };
    useEffect(() => () => {
        if (successTimerRef.current) clearTimeout(successTimerRef.current);
    }, []);

    // Photo-type taxonomy for the upload picker — fetched while the modal is open.
    const { data: photoTypes = [] } = useQuery({ ...photoTypesQuery(), enabled: isOpen });

    // The patient's existing WebCeph link, loaded while the modal is open. `null`
    // (a 404) means "not in WebCeph yet" → the Create card; a FAILED or still-
    // loading read must not look like that (it used to render the Create card
    // with no error — FE-F9-9). Created below via setQueryData (no refetch flash).
    const linkRead = useQuery({ ...webcephLinkQuery(personId), enabled: isOpen });
    const webcephData = linkRead.data ?? null;
    const [uploadData, setUploadData] = useState<UploadData>({
        recordDate: formatISODate(),
        targetClass: 'lateral_ceph',
        selectedFile: null,
        imageFile: null,
    });

    // WebCeph's patient ID is the person_id padded to a 6-char minimum. Only sent
    // at create time — both upload paths resolve it server-side from the DB.
    const webcephPatientID = String(personId).padStart(6, '0');

    // Create-patient inputs come from the already-loaded `/info` payload:
    // gender_display is the same gender NAME the edit page sent, DateOfBirth the DOB.
    const genderName = patientInfo?.gender_display || '';
    const birthday = patientInfo?.DateOfBirth ? formatISODate(patientInfo.DateOfBirth) : '';

    // WebCeph is Latin-script only — the create call needs the English
    // first/last name, not the Arabic patient_name.
    const hasEnglishName = Boolean(patientInfo?.first_name?.trim() || patientInfo?.last_name?.trim());

    // WebCeph rejects an empty name/gender/DOB with a cryptic error — list
    // what's missing and block the request before anything is sent.
    const webcephMissingFields = [
        !hasEnglishName && 'an English name',
        !genderName && 'gender',
        !birthday && 'date of birth',
    ].filter(Boolean) as string[];
    const webcephMissingList = webcephMissingFields.length > 1
        ? `${webcephMissingFields.slice(0, -1).join(', ')} and ${webcephMissingFields[webcephMissingFields.length - 1]}`
        : webcephMissingFields[0];

    const handleCreateWebcephPatient = async () => {
        if (!patientInfo) return;

        if (webcephMissingFields.length > 0) {
            setWebcephError(
                `Cannot create in WebCeph: this patient is missing ${webcephMissingList}. ` +
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
                race,
            };

            const result = await postJSON<mediaContract.CreateWebCephPatientResponse>(
                '/api/webceph/create-patient',
                { personId, patientData: webcephPatientData },
                { schema: mediaContract.createPatient.response }
            );

            queryClient.setQueryData(qk.media.webcephLink(personId), {
                webcephPatientId: result.webcephPatientId,
                link: result.link ?? null,
                createdAt: new Date().toISOString(),
            } satisfies mediaContract.PatientLinkResponse);
            flashSuccess('Patient created in WebCeph successfully!', 5000);
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

            const result = await postJSON<mediaContract.WebCephUploadResponse>(
                '/api/webceph/upload-from-file',
                {
                    personId,
                    relPath: uploadData.selectedFile.relPath,
                    recordDate: uploadData.recordDate,
                    targetClass: uploadData.targetClass,
                },
                { schema: mediaContract.uploadFromFile.response, timeoutMs: mediaContract.WEBCEPH_UPLOAD_TIMEOUT_MS }
            );

            flashSuccess(`Image uploaded successfully!${result.link ? ` View at: ${result.link}` : ''}`, 10000);
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
            formDataObj.append('personId', String(personId));
            formDataObj.append('recordDate', uploadData.recordDate);
            formDataObj.append('targetClass', uploadData.targetClass);

            const result = await postFormData<mediaContract.WebCephUploadResponse>(
                '/api/webceph/upload-image',
                formDataObj,
                { schema: mediaContract.uploadImage.response, timeoutMs: mediaContract.WEBCEPH_UPLOAD_TIMEOUT_MS }
            );

            flashSuccess(`Image uploaded successfully!${result.link ? ` View at: ${result.link}` : ''}`, 10000);
            setUploadData((d) => ({ ...d, imageFile: null }));
            if (fileInputRef.current) fileInputRef.current.value = '';
        } catch (err) {
            console.error('Error uploading image:', err);
            setWebcephError(httpErrorMessage(err, 'Failed to upload image'));
        } finally {
            setWebcephLoading(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} contentClassName={styles.dialog} ariaLabelledBy="webceph-modal-title">
            {/* Pinned LTR: the modal is English, but it opens from the translated
                patient-info page, which runs `dir="rtl"` in Arabic — and English
                must never be mirrored (FE-F9-9). `display: contents` keeps the
                dialog's flex layout. */}
            <div dir="ltr" className={styles.ltrScope}>
            <ModalHeader
                titleId="webceph-modal-title"
                icon={<i className="fas fa-brain" />}
                title="WebCeph AI X-Ray Analysis"
                onClose={onClose}
            />

            <div className={styles.body}>
                {patientInfo && (
                    <p className={styles.subtitle}>
                        {patientInfo.patient_name} <span className={styles.subtleId}>(ID: {personId})</span>
                    </p>
                )}

                {webcephError && (
                    <div className={styles.errorBanner}>
                        <span><i className="fas fa-exclamation-circle" /> {webcephError}</span>
                        <button type="button" onClick={() => setWebcephError(null)} className={styles.bannerClose} aria-label="Dismiss error">×</button>
                    </div>
                )}

                {webcephSuccess && (
                    <div className={styles.successBanner}>
                        <i className="fas fa-check-circle" /> {webcephSuccess}
                    </div>
                )}

                {linkRead.isPending ? (
                    <div className={styles.createCard}>
                        <i className="fas fa-spinner fa-spin" aria-hidden="true" />
                        <p className={styles.createDesc}>Checking WebCeph for this patient…</p>
                    </div>
                ) : linkRead.isError && !webcephData ? (
                    <div className={styles.errorBanner} role="alert">
                        <span>
                            <i className="fas fa-exclamation-circle" aria-hidden="true" />{' '}
                            {httpErrorMessage(linkRead.error, 'Could not check whether this patient is in WebCeph.')}
                        </span>
                        <button type="button" onClick={() => void linkRead.refetch()} className={styles.chooseBtn}>
                            <i className="fas fa-redo" aria-hidden="true" /> Retry
                        </button>
                    </div>
                ) : !webcephData ? (
                    <div className={styles.createCard}>
                        <i className={`fas fa-user-plus ${styles.createIcon}`} />
                        <h4 className={styles.createTitle}>Create Patient in WebCeph</h4>
                        <p className={styles.createDesc}>
                            Get AI-powered cephalometric analysis by creating this patient in WebCeph.
                        </p>
                        <div className={styles.raceField}>
                            <label className={styles.label} htmlFor="webceph-race">
                                Race (cephalometric norms)
                            </label>
                            <select
                                id="webceph-race"
                                value={race}
                                onChange={(e: ChangeEvent<HTMLSelectElement>) => setRace(WEBCEPH_RACES.find((r) => r === e.target.value) ?? WEBCEPH_DEFAULT_RACE)}
                                className={styles.input}
                                aria-describedby="webceph-race-hint"
                                disabled={webcephLoading}
                            >
                                {WEBCEPH_RACES.map((r) => (
                                    <option key={r} value={r}>
                                        {WEBCEPH_RACE_LABELS[r]}{r === WEBCEPH_DEFAULT_RACE ? ' (default)' : ''}
                                    </option>
                                ))}
                            </select>
                            <p id="webceph-race-hint" className={styles.helpText}>
                                {race === WEBCEPH_DEFAULT_RACE ? (
                                    <>
                                        <i className="fas fa-info-circle" aria-hidden="true" />{' '}
                                        <strong>{WEBCEPH_RACE_LABELS[WEBCEPH_DEFAULT_RACE]} is chosen by default</strong>
                                        {' '}— the norm set used for Middle Eastern (Iraqi) patients. Change it only for a patient of another background.
                                    </>
                                ) : (
                                    <>
                                        <i className="fas fa-exclamation-circle" aria-hidden="true" />{' '}
                                        Changed from the default ({WEBCEPH_RACE_LABELS[WEBCEPH_DEFAULT_RACE]}) for this patient.
                                    </>
                                )}
                                {' '}It is sent once, when the patient is created in WebCeph.
                            </p>
                        </div>
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
                                Requires {webcephMissingList} — set {webcephMissingFields.length > 1 ? 'them' : 'it'} in Edit Patient first.
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
                                    {formatDate(webcephData.createdAt)}
                                </span>
                            </div>
                            <div className={styles.linkInfo}>
                                <div className={styles.linkLabel}>WebCeph Patient ID</div>
                                <div className={styles.linkValue}>{webcephData.webcephPatientId}</div>
                            </div>
                            {webcephData.link && (
                                <a
                                    href={webcephData.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={styles.openLink}
                                >
                                    <i className="fas fa-external-link-alt" /> Open in WebCeph
                                </a>
                            )}
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
                                    ref={fileInputRef}
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
            </div>
        </Modal>
    );
};

export default WebCephModal;
