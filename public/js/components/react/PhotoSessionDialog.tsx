import { useState, useEffect, type ChangeEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '../../contexts/ToastContext';
import { useImportFolder } from '@/hooks/useImportFolder';
import Modal from './Modal';
import ModalHeader from './ModalHeader';
import styles from './PhotoSessionDialog.module.css';
import { formatISODate } from '../../core/utils';
import { postJSON, httpErrorMessage } from '../../core/http';
import { photoDatesQuery } from '@/query/queries';
import { invalidatePatientPhotos } from '@/query/photos';
import { parseLocalDate } from '@/utils/calendarDate';
import * as photoEditor from '@shared/contracts/photo-editor.contract';
import type { PhotoPrepareResult } from '../../types/api.types';

interface Props {
    personId?: string;
    onClose: () => void;
    /** Called once a timepoint is prepared (and the photo caches refreshed), to hand off
     *  to the in-app editor. */
    onPrepared?: (result: { tpCode: number; tpName: string; tpDate: string }) => void;
}

interface TimepointType {
    value: string;
    label: string;
}

const TIMEPOINT_TYPES: TimepointType[] = [
    { value: 'Initial', label: 'Initial' },
    { value: 'Progress', label: 'Progress' },
    { value: 'Final', label: 'Final' },
    { value: 'Retention', label: 'Retention' }
];

interface ConflictInfo {
    conflictType: string;
    existingDate: string;
    requestedDate: string;
    message: string;
}

const PhotoSessionDialog = ({ personId, onClose, onPrepared }: Props) => {
    const toast = useToast();
    const navigate = useNavigate();
    const location = useLocation();
    // The memory-card import folder reused by the editor's "Move from card" flow; surfaced
    // here so the user sees/grants access before opening the editor.
    const importFolder = useImportFolder('readwrite');
    const [submitting, setSubmitting] = useState(false);
    const [timepointType, setTimepointType] = useState('Initial');
    const [selectedDate, setSelectedDate] = useState(formatISODate());
    const [conflictInfo, setConflictInfo] = useState<ConflictInfo | null>(null);
    // Set (with a message) when the server reports the patient has no English name. Dolphin's
    // patient columns are Latin1 and corrupt Arabic, so instead of capturing a name inline we
    // bounce the user to the Edit Patient form (which offers on-demand AI translation).
    const [needsProfileFix, setNeedsProfileFix] = useState<string | null>(null);

    const { data: photoDates, isLoading: loading, isError } = useQuery({
        ...photoDatesQuery(personId ?? ''),
        enabled: !!personId,
    });
    // Date shortcuts: the five most recent appointment days up to TODAY (a photo
    // session is not taken in the future — the list used to lead with an appointment
    // three weeks ahead, FE-F12-10b), and the five most recent photo visits (the
    // server orders those oldest-first, so the old slice showed the five OLDEST).
    const today = formatISODate();
    const appointmentDays = [...new Set((photoDates?.appointments ?? []).map((a) => a.date.substring(0, 10)))]
        .filter((d) => d <= today)
        .sort()
        .reverse()
        .slice(0, 5);
    const visitDays = [...new Set((photoDates?.visits ?? []).map((v) => v.visitDate.substring(0, 10)))]
        .sort()
        .reverse()
        .slice(0, 5);

    useEffect(() => {
        if (isError) toast.error('Failed to load appointments and visits');
    }, [isError, toast]);

    // The shortcuts carry 'YYYY-MM-DD' already. `new Date()` on one is UTC midnight,
    // so west of UTC the button showed and SELECTED the day before (FE-F12-10a).
    const handleDateSelect = (day: string) => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(day)) setSelectedDate(day);
    };

    const handleOpenEditPatient = () => {
        onClose();
        // Return the user to the page this dialog was opened over, not the works page
        navigate(`/patient/${personId}/edit-patient`, {
            state: { from: `${location.pathname}${location.search}` },
        });
    };

    // (No client-side "Patient name is required" check: the patient read it used was
    // often still in flight, so a quick click toasted it for a patient who has a name
    // (FE-F12-10c). The server answers `needsName` when the name really is missing.)
    const handleSubmit = async (overrideDate = false) => {
        try {
            setSubmitting(true);
            setConflictInfo(null);

            const result = await postJSON<PhotoPrepareResult>(`/api/photo-editor/${personId}/prepare`, {
                tpDescription: timepointType,
                tpDate: selectedDate,
                overrideDate,
            }, { schema: photoEditor.prepare.response });

            // Patient has no English name — Dolphin can't store Arabic. Bounce to the Edit Patient
            // form (which offers on-demand AI translation) rather than proceeding.
            if ('needsName' in result) {
                setNeedsProfileFix(result.message || 'This patient needs an English name before adding photos.');
                setSubmitting(false);
                return;
            }

            // tblwork date conflict — offer to override the existing Initial/Final date.
            if ('conflict' in result) {
                setConflictInfo({
                    conflictType: result.conflictType,
                    existingDate: result.existingDate,
                    requestedDate: result.requestedDate,
                    message: result.message
                });
                setSubmitting(false);
                return;
            }

            // The new session must show in the tabs even if the user backs out of the
            // editor, and an override rewrote the works' Initial/Final photo date —
            // done HERE so all three call sites get it (FE-F12-3d).
            if (personId) await invalidatePatientPhotos(personId, { works: overrideDate });

            // Hand off to the in-app editor.
            onPrepared?.({ tpCode: result.tp_code, tpName: timepointType, tpDate: selectedDate });
            onClose();
        } catch (error) {
            toast.error(httpErrorMessage(error, 'Failed to prepare photo session'));
        } finally {
            setSubmitting(false);
        }
    };

    const handleOverrideConfirm = () => {
        handleSubmit(true);
    };

    const handleOverrideCancel = () => {
        setConflictInfo(null);
    };

    const handleChooseImportFolder = async (): Promise<void> => {
        const dir = await importFolder.choosePick();
        if (dir) toast.success(`Import folder set to “${dir.name}”`);
    };

    const handleGrantImportFolder = async (): Promise<void> => {
        const ok = await importFolder.grant();
        if (ok) toast.success('Import folder access granted');
        else toast.warning('Access was not granted');
    };

    const handleForgetImportFolder = async (): Promise<void> => {
        await importFolder.clear();
        toast.info('Import folder forgotten');
    };

    const formatDate = (dateStr: string): string => {
        if (!dateStr) return '';
        const date = parseLocalDate(dateStr);
        return date.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
    };

    return (
        <Modal isOpen={true} onClose={onClose} contentClassName={styles.dialog} ariaLabelledBy="photo-session-title">
                <ModalHeader title="New Photo Session" titleId="photo-session-title" onClose={onClose} />

                <div className={styles.body}>
                    {/* Conflict Warning */}
                    {conflictInfo && (
                        <div className={styles.conflictWarning}>
                            <div className={styles.conflictIcon}>
                                <i className="fas fa-exclamation-triangle" />
                            </div>
                            <div className={styles.conflictContent}>
                                <strong>Date Conflict Detected</strong>
                                <p>{conflictInfo.message}</p>
                                <p>Do you want to override the existing date?</p>
                                <div className={styles.conflictActions}>
                                    <button
                                        type="button"
                                        className="btn btn-warning"
                                        onClick={handleOverrideConfirm}
                                        disabled={submitting}
                                    >
                                        {submitting ? 'Updating...' : 'Yes, Override'}
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={handleOverrideCancel}
                                        disabled={submitting}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* English name required — bounce to the Edit Patient form (Dolphin can't store Arabic). */}
                    {needsProfileFix ? (
                        <div className={`${styles.conflictWarning} ${styles.conflictError}`}>
                            <div className={styles.conflictIcon}>
                                <i className="fas fa-language" />
                            </div>
                            <div className={styles.conflictContent}>
                                <strong>English name required</strong>
                                <p>{needsProfileFix}</p>
                                <div className={styles.conflictActions}>
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        onClick={handleOpenEditPatient}
                                    >
                                        <i className="fas fa-user-edit" /> Open Edit Patient Form
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={onClose}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : (
                    <>
                    {/* Session Type */}
                    <div className={styles.formGroup}>
                        <label htmlFor="photo-session-type">Session Type</label>
                        <select
                            id="photo-session-type"
                            value={timepointType}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => setTimepointType(e.target.value)}
                            className={styles.formSelect}
                            disabled={!!conflictInfo}
                        >
                            {TIMEPOINT_TYPES.map(tp => (
                                <option key={tp.value} value={tp.value}>{tp.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Date Selection */}
                    <div className={styles.formGroup}>
                        <label htmlFor="photo-session-date">Photo Date</label>
                        <input
                            id="photo-session-date"
                            type="date"
                            value={selectedDate}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setSelectedDate(e.target.value)}
                            className={styles.formInput}
                            disabled={!!conflictInfo}
                        />
                    </div>

                    {/* Import folder — the memory-card source reused by "Move from card" in the editor */}
                    <div className={styles.importFolder}>
                        <span>Import folder</span>
                        {importFolder.status === 'unsupported' ? (
                            <p className={styles.iniHint}>Folder import needs Chrome or Edge.</p>
                        ) : (
                            <>
                                <div className={styles.importRow}>
                                    <span className={styles.folderName} title={importFolder.folderName ?? undefined}>
                                        <i className="fas fa-folder" aria-hidden="true" />{' '}
                                        {importFolder.folderName ?? 'No folder selected'}
                                    </span>
                                    {importFolder.status === 'granted' && (
                                        <span className={`${styles.statusBadge} ${styles.badgeGranted}`}>Ready</span>
                                    )}
                                    {importFolder.status === 'prompt' && (
                                        <span className={`${styles.statusBadge} ${styles.badgePrompt}`}>Needs access</span>
                                    )}
                                    {importFolder.status === 'denied' && (
                                        <span className={`${styles.statusBadge} ${styles.badgeDenied}`}>Blocked</span>
                                    )}
                                    {importFolder.status === 'unset' && (
                                        <span className={`${styles.statusBadge} ${styles.badgeUnset}`}>Not set</span>
                                    )}
                                </div>

                                <div className={styles.importActions}>
                                    {importFolder.status === 'unset' && (
                                        <button type="button" className="btn btn-secondary" onClick={handleChooseImportFolder}>
                                            <i className="fas fa-folder-open" aria-hidden="true" /> Choose import folder
                                        </button>
                                    )}
                                    {importFolder.status === 'prompt' && (
                                        <>
                                            <button type="button" className="btn btn-secondary" onClick={handleGrantImportFolder}>
                                                <i className="fas fa-key" aria-hidden="true" /> Grant access
                                            </button>
                                            <button type="button" className={styles.linkBtn} onClick={handleChooseImportFolder}>
                                                Change folder
                                            </button>
                                        </>
                                    )}
                                    {importFolder.status === 'granted' && (
                                        <>
                                            <button type="button" className={styles.linkBtn} onClick={handleChooseImportFolder}>
                                                Change folder
                                            </button>
                                            <button type="button" className={styles.linkBtn} onClick={handleForgetImportFolder}>
                                                Forget
                                            </button>
                                        </>
                                    )}
                                    {importFolder.status === 'denied' && (
                                        <>
                                            <button type="button" className="btn btn-secondary" onClick={handleGrantImportFolder}>
                                                <i className="fas fa-key" aria-hidden="true" /> Try again
                                            </button>
                                            <button type="button" className={styles.linkBtn} onClick={handleChooseImportFolder}>
                                                Change folder
                                            </button>
                                        </>
                                    )}
                                </div>

                                {/* The editor's "Move from card" deletes the photos it moves from
                                    this folder; say so where the folder is chosen (FE-F14-10). */}
                                <p className={styles.iniHint}>
                                    In the editor, “Move from card” uploads photos from this folder and then deletes
                                    them from it. “Upload (copy)” leaves them in place.
                                </p>
                                {(importFolder.status === 'prompt' || importFolder.status === 'denied') && (
                                    <p className={styles.iniHint}>Tip: choose “Allow on every visit” so access sticks.</p>
                                )}
                            </>
                        )}
                    </div>

                    {/* Appointments List */}
                    {loading ? (
                        <div className={styles.loadingPlaceholder}>Loading dates...</div>
                    ) : (
                        <>
                            {appointmentDays.length > 0 && (
                                <div className={styles.dateList}>
                                    <span>Recent Appointments</span>
                                    <div className={styles.dateItems}>
                                        {appointmentDays.map((day) => (
                                            <button
                                                key={day}
                                                type="button"
                                                className={styles.dateItem}
                                                onClick={() => handleDateSelect(day)}
                                            >
                                                <span className={styles.dateValue}>{formatDate(day)}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {visitDays.length > 0 && (
                                <div className={styles.dateList}>
                                    <span>Recent Photo Visits</span>
                                    <div className={styles.dateItems}>
                                        {visitDays.map((day) => (
                                            <button
                                                key={day}
                                                type="button"
                                                className={styles.dateItem}
                                                onClick={() => handleDateSelect(day)}
                                            >
                                                <span className={styles.dateValue}>{formatDate(day)}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                    </>
                    )}
                </div>

                <div className={styles.footer}>
                    {!conflictInfo && !needsProfileFix && (
                        <>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={onClose}
                                disabled={submitting}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={() => handleSubmit(false)}
                                disabled={submitting || loading}
                            >
                                {submitting ? 'Opening…' : 'Open Editor'}
                            </button>
                        </>
                    )}
                </div>
        </Modal>
    );
};

export default PhotoSessionDialog;
