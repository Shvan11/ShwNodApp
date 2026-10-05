/**
 * PatientSets — a patient's aligner sets, batches, the doctor's uploads and the
 * lab ↔ doctor messages, with full CRUD. Serves both the doctor-browse and the
 * search routes.
 *
 * SERVER STATE IS REACT QUERY. This page was CLAUDE.md's "deliberate loader
 * exception": 29 `useState`s holding sets, doctors and per-set batches, notes and
 * photos, loaded by hand-written `.then` chains. That is what let it serve stale
 * data — nothing re-read a set once loaded (FE-F17-2), a failed read while
 * switching patients left the previous patient's sets on screen (FE-F17-3), no
 * write refreshed the aligner lists (FE-F17-6), and opening the page marked every
 * doctor note read (FE-F17-12). Now each read is a query keyed by work or set
 * (`qk.aligner.*`), every write invalidates the `['aligner']` prefix
 * (`invalidateAligner`), and the route renders the page keyed by `workId`, so a
 * patient switch is a fresh mount. The pieces live in `./sets/`.
 */
import { useState, useRef, useEffect } from 'react';
import type { ChangeEvent } from 'react';
import { useParams, useNavigate, useLoaderData, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AlignerPatientWorkLoaderResult } from '../../router/loaders';
import ConfirmDialog from '../../components/react/ConfirmDialog';
import SetFormDrawer from '../../components/react/SetFormDrawer';
import BatchFormDrawer from '../../components/react/BatchFormDrawer';
import PaymentFormDrawer from '../../components/react/PaymentFormDrawer';
import LabelPreviewModal from '../../components/react/LabelPreviewModal';
import { copyToClipboard } from '../../core/utils';
import {
    isFileSystemAccessSupported,
    getDirectoryHandle,
    saveHandle,
    checkPermission,
    showDirectoryPickerDialog,
    navigateToDirectory,
    isAbortError,
} from '../../core/fileSystemAccess';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useAuthUser } from '../../contexts/GlobalStateContext';
import { roleCaps, type UserRole } from '@shared/auth/roles';
import { ALIGNER_SETS_FOLDER_OPTION, lastPathSegment } from '@shared/clinic-options';
import { usePrintQueue } from '../../contexts/PrintQueueContext';
import { useSetDrawer } from '../../hooks/useSetDrawer';
import { useBatchDrawer } from '../../hooks/useBatchDrawer';
import { useLabelModal } from '../../hooks/useLabelModal';
import type { AlignerSet, AlignerBatch, AlignerPhoto } from './aligner.types';
import type { PaymentSaveData } from '@/types/api.types';
import { postJSON, patchJSON, deleteJSON, postFormData, httpErrorMessage } from '@/core/http';
import { qk } from '@/query/keys';
import { invalidateAligner } from '@/query/aligner';
import {
    alignerSetsQuery,
    alignerDoctorsQuery,
    alignerFeaturesQuery,
    alignerBatchesQuery,
    brandingQuery,
    optionQuery,
} from '@/query/queries';
import * as alignerContract from '@shared/contracts/aligner.contract';
import AlignerPhotoViewer from './AlignerPhotoViewer';
import SetCard, { type SetCardActions } from './sets/SetCard';
import { formatSetDateTime, setFolderPath } from './sets/setHelpers';
import styles from './PatientSets.module.css';

/** Fullscreen photo viewer: the photo list it was opened from + the current position. */
type PhotoViewerState = { photos: AlignerPhoto[]; index: number };

// IndexedDB key for the persisted base aligner-sets directory handle (File System Access API).
const ALIGNER_SETS_HANDLE_KEY = 'base_aligner_sets';
const MAX_PDF_BYTES = 100 * 1024 * 1024;

/**
 * The route element. Keyed by `workId`, so moving from one patient to another on
 * the same route (the Portal-activity bell does) is a fresh mount: no state, no
 * in-flight read and no expanded set carries over (FE-F17-3).
 */
export default function PatientSetsRoute() {
    const { workId } = useParams<{ workId?: string }>();
    return <PatientSets key={workId} />;
}

function PatientSets() {
    const { doctorId, workId } = useParams<{ doctorId?: string; workId?: string }>();
    const loaderData = useLoaderData() as AlignerPatientWorkLoaderResult;
    const navigate = useNavigate();
    const location = useLocation();
    const toast = useToast();
    const confirm = useConfirm();
    const queryClient = useQueryClient();
    const { addToQueue, isInQueue, removeByBatchId } = usePrintQueue();
    const user = useAuthUser();
    const caps = roleCaps(user?.role as UserRole | undefined);

    const workIdNum = parseInt(workId || '0', 10);
    const { patient: patientRow, work } = loaderData;
    const patient = {
        person_id: patientRow.person_id,
        patient_name: patientRow.patient_name ?? undefined,
        first_name: patientRow.first_name ?? undefined,
        last_name: patientRow.last_name ?? undefined,
        phone: patientRow.phone,
        workType: work.type_name,
        workid: workIdNum,
    };
    const patientName =
        patient.patient_name || `${patient.first_name || ''} ${patient.last_name || ''}`.trim() || 'N/A';
    // Set payments are booked in USD into the WORK's ledger, so they are only
    // offered on a USD work (the server refuses the rest — FE-F8-6).
    const workCurrency = work.currency;

    // ---- Reads ------------------------------------------------------------------------------
    const setsQuery = useQuery(alignerSetsQuery(workIdNum));
    const alignerSets = setsQuery.data?.sets ?? [];
    const doctors = useQuery(alignerDoctorsQuery()).data?.doctors ?? [];
    const labName = useQuery(brandingQuery()).data?.clinicName?.trim() || 'Lab';
    const hasPortal = useQuery(alignerFeaturesQuery()).data?.portal ?? false;
    // This install's aligner share (FE-F17-7) — null when not configured.
    const folderRoot = useQuery(optionQuery(ALIGNER_SETS_FOLDER_OPTION)).data?.value?.trim() || null;
    const expectedFolderName = (folderRoot && lastPathSegment(folderRoot)) || 'Aligner_Sets';
    const folderPathOf = (set: AlignerSet): string | null =>
        setFolderPath(folderRoot, set.aligner_dr_id, patient.person_id, set.set_sequence);

    // ---- Expansion: the active set opens by default ----------------------------------------
    const [expandedSets, setExpandedSets] = useState<Record<number, boolean>>({});
    const [commOpen, setCommOpen] = useState<Record<number, boolean>>({});
    const isExpanded = (set: AlignerSet): boolean => expandedSets[set.aligner_set_id] ?? set.is_active;
    const isCommOpen = (set: AlignerSet): boolean => commOpen[set.aligner_set_id] ?? isExpanded(set);
    const toggleSet = (set: AlignerSet): void => {
        const next = !isExpanded(set);
        setExpandedSets((prev) => ({ ...prev, [set.aligner_set_id]: next }));
        setCommOpen((prev) => ({ ...prev, [set.aligner_set_id]: next }));
    };
    const toggleComm = (set: AlignerSet): void => {
        const next = !isCommOpen(set);
        setCommOpen((prev) => ({ ...prev, [set.aligner_set_id]: next }));
    };

    const [viewer, setViewer] = useState<PhotoViewerState | null>(null);

    // ---- Drawers ----------------------------------------------------------------------------
    const {
        showSetDrawer,
        editingSet,
        openAddSetDrawer,
        openEditSetDrawer,
        closeSetDrawer,
        handleSetSaved,
    } = useSetDrawer({ onRefresh: () => void invalidateAligner() });

    const {
        showBatchDrawer,
        editingBatch,
        currentSetForBatch,
        openAddBatchDrawer,
        openEditBatchDrawer,
        closeBatchDrawer,
        handleBatchSaved,
    } = useBatchDrawer({ onRefresh: invalidateAligner });
    // The drawer works from the LIVE set and batch list, not the snapshot it opened with.
    const batchDrawerSetId = currentSetForBatch?.aligner_set_id ?? 0;
    const drawerBatches = useQuery({ ...alignerBatchesQuery(batchDrawerSetId), enabled: showBatchDrawer && batchDrawerSetId > 0 });
    const liveSetForBatch = alignerSets.find((s) => s.aligner_set_id === batchDrawerSetId) ?? currentSetForBatch;

    const { showLabelModal, labelModalData, openLabelModal, closeLabelModal } = useLabelModal();

    const [paymentSet, setPaymentSet] = useState<AlignerSet | null>(null);

    // Folder confirmation dialog (async pattern)
    const [folderConfirmDialog, setFolderConfirmDialog] = useState<{ isOpen: boolean; folderName: string }>({ isOpen: false, folderName: '' });
    const folderConfirmResolveRef = useRef<((value: boolean) => void) | null>(null);

    // PDF file upload
    const [uploadingPdf, setUploadingPdf] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [hasBaseDirectoryAccess, setHasBaseDirectoryAccess] = useState(false);
    // Whether this browser already holds a granted handle to the share (checked once).
    useEffect(() => {
        if (!isFileSystemAccessSupported()) return;
        getDirectoryHandle(ALIGNER_SETS_HANDLE_KEY)
            .then((handle) => (handle ? checkPermission(handle, 'read') : null))
            .then((permission) => setHasBaseDirectoryAccess(permission === 'granted'))
            .catch(() => setHasBaseDirectoryAccess(false));
    }, []);

    // ---- Navigation ------------------------------------------------------------------------
    // Back goes where the user came from — the bell, the Works page and All Sets
    // land here too; the breadcrumb used to say "Back to Search" for all of them
    // (FE-F17-14). A direct load falls back to the list this route belongs to.
    const canGoBack = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    const backToList = (): void => {
        if (canGoBack > 0) navigate(-1);
        else navigate(doctorId !== undefined ? `/aligner/doctor/${doctorId}` : '/aligner/search');
    };

    // ---- Set actions -----------------------------------------------------------------------
    const openSetFolder = async (set: AlignerSet): Promise<void> => {
        const folderPath = folderPathOf(set);
        if (!folderPath) {
            toast.warning('The aligner folder is not set up on this install. Set AlignerSetsFolder in Settings → General.');
            return;
        }
        try {
            const link = document.createElement('a');
            link.href = `explorer:${folderPath}`;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            toast.info(`Opening folder: ${folderPath}`);
            await copyToClipboard(folderPath);
        } catch (error) {
            console.error('Error opening folder:', error);
            const success = await copyToClipboard(folderPath);
            toast.info(
                success
                    ? 'Folder path copied to clipboard. Note: Please ensure the explorer: protocol handler is installed.'
                    : `Folder path: ${folderPath}. Note: Please ensure the explorer: protocol handler is installed.`
            );
        }
    };

    const handleDeleteSet = async (set: AlignerSet): Promise<void> => {
        // Say what goes with it (FE-F17-11): notes are two-way, the batches carry the
        // doctor's portal announcements, and the uploads + PDF live outside the DB.
        const ok = await confirm(
            `Delete Set #${set.set_sequence}?\n` +
                "This also deletes its batches and every message with the doctor — the doctor's own messages included — and removes the batches' announcements from the doctor's portal.\n" +
                "The doctor's uploaded photos and scan files, and the set's PDF, stay in storage but will no longer be reachable from any screen.\n" +
                'This cannot be undone.',
            { title: 'Delete Aligner Set', danger: true, confirmText: 'Delete Set' }
        );
        if (!ok) return;
        try {
            await deleteJSON(`/api/aligner/sets/${set.aligner_set_id}`);
            toast.success('Set deleted successfully');
        } catch (error) {
            toast.error('Failed to delete set: ' + httpErrorMessage(error, 'unknown error'));
        } finally {
            await invalidateAligner();
        }
    };

    const handlePaymentSaved = async (paymentData: PaymentSaveData): Promise<void> => {
        if (!paymentSet) return;
        try {
            await postJSON('/api/aligner/payments', {
                workid: patient.workid,
                aligner_set_id: paymentSet.aligner_set_id,
                amount_paid: paymentData.amount_paid,
                date_of_payment: paymentData.date_of_payment,
                change: paymentData.change,
            });
        } catch (err) {
            // PaymentFormDrawer surfaces the thrown error's .message — preserve the
            // server's detail (HttpError.message would just be "HTTP Error: 400 …").
            throw new Error(httpErrorMessage(err, 'Failed to save payment'), { cause: err });
        }
        // The work's ledger AND the patient's Works page (Paid / Remaining / Add
        // Payment) — the latter kept the pre-payment balance for up to 30 s (FE-F8-7).
        void queryClient.invalidateQueries({ queryKey: qk.work.all(patient.workid) });
        void queryClient.invalidateQueries({ queryKey: qk.patient.all(patient.person_id) });
        void invalidateAligner();
        toast.success('Payment saved successfully');
        setPaymentSet(null);
    };

    // ---- Batch actions ---------------------------------------------------------------------
    const handleMarkManufactured = async (batch: AlignerBatch): Promise<void> => {
        const ok = await confirm(
            `Mark Batch #${batch.batch_sequence} as manufactured? This will set the manufacture date to today.`,
            { title: 'Mark as Manufactured', confirmText: 'Mark Manufactured' }
        );
        if (!ok) return;
        try {
            const result = await patchJSON<alignerContract.ManufactureBatchResponse>(
                `/api/aligner/batches/${batch.aligner_batch_id}/manufacture`,
                {},
                { schema: alignerContract.manufactureBatch.response }
            );
            if (result.wasAlreadyManufactured) toast.info('Batch was already manufactured');
            else toast.success('Batch marked as manufactured');
        } catch (error) {
            toast.error('Failed to mark as manufactured: ' + httpErrorMessage(error, 'unknown error'));
        } finally {
            await invalidateAligner();
        }
    };

    const handleMarkDelivered = async (batch: AlignerBatch): Promise<void> => {
        const ok = await confirm(
            `Mark Batch #${batch.batch_sequence} as delivered? This will set the delivery date to today.`,
            { title: 'Mark as Delivered', confirmText: 'Mark Delivered' }
        );
        if (!ok) return;
        try {
            const result = await patchJSON<alignerContract.DeliverBatchResponse>(
                `/api/aligner/batches/${batch.aligner_batch_id}/deliver`,
                {},
                { schema: alignerContract.deliverBatch.response }
            );
            if (result.wasAlreadyDelivered) toast.info('Batch was already delivered');
            else if (result.wasActivated) toast.success(`Batch #${result.batchSequence} delivered and activated (latest batch)`);
            else if (result.wasAlreadyActive) toast.success(`Batch #${result.batchSequence} delivered (already active)`);
            else toast.success('Batch marked as delivered');
        } catch (error) {
            toast.error('Failed to mark as delivered: ' + httpErrorMessage(error, 'unknown error'));
        } finally {
            await invalidateAligner();
        }
    };

    const handleDeleteBatch = async (batch: AlignerBatch): Promise<void> => {
        const ok = await confirm(
            `Delete Batch #${batch.batch_sequence}?\n` +
                "Its announcements disappear from the doctor's portal, and the later batches of this set are renumbered.\n" +
                'This cannot be undone.',
            { title: 'Delete Batch', danger: true, confirmText: 'Delete Batch' }
        );
        if (!ok) return;
        try {
            await deleteJSON(`/api/aligner/batches/${batch.aligner_batch_id}`);
            toast.success('Batch deleted successfully');
        } catch (error) {
            toast.error('Failed to delete batch: ' + httpErrorMessage(error, 'unknown error'));
        } finally {
            await invalidateAligner();
        }
    };

    const handleToggleQueue = (batch: AlignerBatch, set: AlignerSet): void => {
        const batchId = batch.aligner_batch_id;
        if (isInQueue(batchId)) {
            removeByBatchId(batchId);
            toast.info('Removed from print queue');
            return;
        }
        // Built from the contract's own doctor fields — it used to read `id`/`name`/
        // `logoPath` aliases the contract doesn't declare (FE-F17-15).
        const doctor = doctors.find((d) => d.dr_id === set.aligner_dr_id);
        addToQueue(
            {
                batchId,
                batchNumber: batch.batch_sequence,
                // ?? null, not || 0: start 0 is a real template sequence,
                // null means the batch has no aligners for that arch
                upperStart: batch.upper_aligner_start_sequence ?? null,
                upperEnd: batch.upper_aligner_end_sequence ?? null,
                lowerStart: batch.lower_aligner_start_sequence ?? null,
                lowerEnd: batch.lower_aligner_end_sequence ?? null,
            },
            { code: String(patient.person_id), name: patientName },
            {
                id: set.aligner_dr_id ?? 0,
                name: doctor?.doctor_name ?? set.AlignerDoctorName ?? '',
                logoPath: doctor?.logo_path ?? null,
            },
            { setId: set.aligner_set_id }
        );
        toast.success('Added to print queue');
    };

    // ---- PDF upload (File System Access, falling back to a file input) -----------------------
    const confirmFolderSelection = (folderName: string): Promise<boolean> =>
        new Promise((resolve) => {
            folderConfirmResolveRef.current = resolve;
            setFolderConfirmDialog({ isOpen: true, folderName });
        });

    const handleFolderConfirmResponse = (confirmed: boolean): void => {
        setFolderConfirmDialog({ isOpen: false, folderName: '' });
        folderConfirmResolveRef.current?.(confirmed);
        folderConfirmResolveRef.current = null;
    };

    const requestBaseDirectoryAccess = async (): Promise<boolean> => {
        if (!isFileSystemAccessSupported()) {
            toast.warning('Your browser does not support the File System Access API. Please use Chrome or Edge.');
            return false;
        }
        try {
            const result = await showDirectoryPickerDialog({ mode: 'read', startIn: 'desktop' });
            if (!result.success || !result.data) {
                if (!isAbortError({ name: result.errorName })) {
                    toast.error(result.error || 'Failed to select folder');
                }
                return false;
            }
            const dirHandle = result.data;
            // The configured share's own folder name (FE-F17-7), not this clinic's.
            if (dirHandle.name !== expectedFolderName) {
                const confirmed = await confirmFolderSelection(dirHandle.name);
                if (!confirmed) return false;
            }
            await saveHandle(ALIGNER_SETS_HANDLE_KEY, dirHandle, { expectedName: expectedFolderName });
            setHasBaseDirectoryAccess(true);
            toast.success('Base folder access granted! You can now open PDFs directly in the correct folders.');
            return true;
        } catch (error) {
            if (!isAbortError(error)) {
                console.error('Error requesting directory access:', error);
                toast.error('Failed to get directory access: ' + (error as Error).message);
            }
            return false;
        }
    };

    const fallbackToFileInput = async (set: AlignerSet): Promise<void> => {
        const folderPath = folderPathOf(set);
        if (folderPath) await copyToClipboard(folderPath);
        if (fileInputRef.current) {
            fileInputRef.current.dataset.setId = String(set.aligner_set_id);
            fileInputRef.current.click();
        }
    };

    const handlePdfUpload = async (setId: number, file: File): Promise<void> => {
        if (file.type !== 'application/pdf') {
            toast.warning('Please select a PDF file');
            return;
        }
        if (file.size > MAX_PDF_BYTES) {
            toast.warning('File is too large. Maximum size is 100MB.');
            return;
        }
        setUploadingPdf(true);
        try {
            const formData = new FormData();
            formData.append('pdf', file);
            // 120s to match the server's timeouts.long on this route — the default
            // 30s funnel timeout would abort large PDFs client-side while the
            // upload was still completing server-side.
            await postFormData(`/api/aligner/sets/${setId}/upload-pdf`, formData, { timeoutMs: 120000 });
            toast.success('PDF uploaded successfully!');
        } catch (error) {
            toast.error('Failed to upload PDF: ' + httpErrorMessage(error, 'unknown error'));
        } finally {
            setUploadingPdf(false);
            await invalidateAligner();
        }
    };

    const pickPdf = async (set: AlignerSet): Promise<void> => {
        if (!isFileSystemAccessSupported()) {
            await fallbackToFileInput(set);
            return;
        }
        if (!hasBaseDirectoryAccess && !(await requestBaseDirectoryAccess())) {
            await fallbackToFileInput(set);
            return;
        }
        try {
            const baseHandle = await getDirectoryHandle(ALIGNER_SETS_HANDLE_KEY);
            if (!baseHandle) {
                await fallbackToFileInput(set);
                return;
            }
            let permission = await checkPermission(baseHandle, 'read');
            if (permission !== 'granted') {
                permission = await baseHandle.requestPermission({ mode: 'read' });
                if (permission !== 'granted') {
                    setHasBaseDirectoryAccess(false);
                    await fallbackToFileInput(set);
                    return;
                }
            }
            // Without a real doctor id there's no correct subfolder — open the
            // picker at the base folder rather than a bogus "0/..." path.
            const setFolder = set.aligner_dr_id
                ? await navigateToDirectory(baseHandle, `${set.aligner_dr_id}/${patient.person_id}/${set.set_sequence ?? 0}`, false)
                : null;

            type FilePickerOptions = {
                types: Array<{ description: string; accept: Record<string, string[]> }>;
                multiple: boolean;
                startIn?: FileSystemDirectoryHandle;
            };
            const pickerOpts: FilePickerOptions = {
                types: [{ description: 'PDF Files', accept: { 'application/pdf': ['.pdf'] } }],
                multiple: false,
            };
            if (setFolder?.success && setFolder.data) pickerOpts.startIn = setFolder.data;

            const [fileHandle] = await (
                window as Window & { showOpenFilePicker: (opts?: FilePickerOptions) => Promise<FileSystemFileHandle[]> }
            ).showOpenFilePicker(pickerOpts);
            await handlePdfUpload(set.aligner_set_id, await fileHandle.getFile());
        } catch (error) {
            if ((error as Error).name !== 'AbortError') {
                console.error('File picker error:', error);
                await fallbackToFileInput(set);
            }
        }
    };

    const handlePdfFileChange = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
        const file = e.target.files?.[0];
        const setId = e.target.dataset.setId;
        e.target.value = '';
        if (!file || !setId) return;
        await handlePdfUpload(parseInt(setId, 10), file);
    };

    const actions: SetCardActions = {
        onEditSet: openEditSetDrawer,
        onOpenFolder: (set) => void openSetFolder(set),
        onDeleteSet: (set) => void handleDeleteSet(set),
        onAddPayment: setPaymentSet,
        onPickPdf: (set) => void pickPdf(set),
        onAddBatch: openAddBatchDrawer,
        onEditBatch: openEditBatchDrawer,
        onMarkManufactured: (batch) => void handleMarkManufactured(batch),
        onMarkDelivered: (batch) => void handleMarkDelivered(batch),
        onDeleteBatch: (batch) => void handleDeleteBatch(batch),
        onPrintLabels: openLabelModal,
        onToggleQueue: handleToggleQueue,
        isInQueue: (batchId) => isInQueue(batchId),
        onViewPhotos: (photos, index) => setViewer({ photos, index }),
    };

    return (
        <div>
            <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                onChange={(e) => void handlePdfFileChange(e)}
                className={styles.hiddenFileInput}
                aria-hidden="true"
                tabIndex={-1}
            />

            {uploadingPdf && (
                <div className={styles.uploadOverlay}>
                    <div className={styles.uploadDialog} role="status">
                        <div className={styles.uploadSpinner}></div>
                        <div className={styles.uploadTitle}>Uploading PDF...</div>
                        <div className={styles.uploadHint}>Please wait while your file is being uploaded</div>
                    </div>
                </div>
            )}

            <div className={styles.breadcrumb}>
                <button type="button" onClick={backToList} className={styles.breadcrumbLink}>
                    <i className="fas fa-arrow-left" aria-hidden="true"></i>
                    Back
                </button>
            </div>

            <div className={styles.patientInfo}>
                <div className={styles.patientHeader}>
                    <div className={styles.patientDetails}>
                        <h2>
                            {patientName}
                            {patient.patient_name && patient.first_name && (
                                <span className={styles.patientSubtitle}>
                                    ({patient.first_name} {patient.last_name})
                                </span>
                            )}
                        </h2>
                        <div className={styles.patientMeta}>
                            <span><i className="fas fa-id-card" aria-hidden="true"></i> {patient.person_id}</span>
                            <span><i className="fas fa-phone" aria-hidden="true"></i> {patient.phone || 'N/A'}</span>
                            <span><i className="fas fa-tooth" aria-hidden="true"></i> {patient.workType}</span>
                        </div>
                    </div>
                    <div className={styles.fsAccessContainer}>
                        {isFileSystemAccessSupported() && folderRoot && (
                            <div className={`${styles.fsAccessStatus} ${hasBaseDirectoryAccess ? styles.fsAccessActive : styles.fsAccessInactive}`}>
                                <i
                                    className={`fas ${hasBaseDirectoryAccess ? 'fa-check-circle status-success' : 'fa-exclamation-circle status-error'}`}
                                    aria-hidden="true"
                                ></i>
                                <span className={hasBaseDirectoryAccess ? 'text-success' : 'text-error'}>
                                    {hasBaseDirectoryAccess ? 'Folder Access: Active' : 'Folder Access: Not Set'}
                                </span>
                                {!hasBaseDirectoryAccess && (
                                    <button type="button" onClick={() => void requestBaseDirectoryAccess()} className="btn btn-sm bg-error">
                                        Grant Access
                                    </button>
                                )}
                            </div>
                        )}
                        <button
                            type="button"
                            className="btn btn-success"
                            onClick={() =>
                                navigate(`/patient/${patient.person_id}/edit-patient`, {
                                    state: { from: `${location.pathname}${location.search}` },
                                })
                            }
                        >
                            <i className="fas fa-edit" aria-hidden="true"></i>
                            Edit Patient
                        </button>
                        <button
                            type="button"
                            className="btn btn-info"
                            onClick={() => navigate(`/patient/${patient.person_id}/new-work?workId=${patient.workid}`)}
                        >
                            <i className="fas fa-tooth" aria-hidden="true"></i>
                            Edit Work
                        </button>
                        <button type="button" className="btn btn-success" onClick={openAddSetDrawer}>
                            <i className="fas fa-plus" aria-hidden="true"></i>
                            Add New Set
                        </button>
                    </div>
                </div>
            </div>

            <div className={styles.setsContainer}>
                <div className={styles.sectionHeader}>
                    <h3>Aligner Sets</h3>
                    <div className={styles.sectionInfo}>
                        {setsQuery.isSuccess && (
                            <span>{alignerSets.length} set{alignerSets.length !== 1 ? 's' : ''}</span>
                        )}
                    </div>
                </div>

                {setsQuery.isPending ? (
                    <div className={styles.loadingContainer}>
                        <div className={styles.spinner}></div>
                        <p>Loading aligner sets...</p>
                    </div>
                ) : setsQuery.isError ? (
                    // A failed read says so — it used to leave the previous patient's sets
                    // on screen under this patient's name (FE-F17-3).
                    <div className={styles.errorContainer} role="alert">
                        <i className="fas fa-exclamation-triangle" aria-hidden="true"></i>
                        <h2>Could not load the aligner sets</h2>
                        <p>{httpErrorMessage(setsQuery.error, 'Unknown error')}</p>
                        <button type="button" className="btn btn-primary" onClick={() => void setsQuery.refetch()}>
                            Retry
                        </button>
                    </div>
                ) : alignerSets.length === 0 ? (
                    <div className={styles.emptyState}>
                        <i className="fas fa-inbox" aria-hidden="true"></i>
                        <p>No aligner sets found for this patient</p>
                    </div>
                ) : (
                    alignerSets.map((set) => (
                        <SetCard
                            key={set.aligner_set_id}
                            set={set}
                            expanded={isExpanded(set)}
                            commOpen={isCommOpen(set)}
                            onToggle={() => toggleSet(set)}
                            onToggleComm={() => toggleComm(set)}
                            folderPath={folderPathOf(set)}
                            labName={labName}
                            canPay={caps.writeFinance}
                            workCurrency={workCurrency}
                            uploadingPdf={uploadingPdf}
                            hasPortal={hasPortal}
                            actions={actions}
                        />
                    ))
                )}
            </div>

            {showSetDrawer && (
                <SetFormDrawer
                    isOpen={showSetDrawer}
                    onClose={closeSetDrawer}
                    onSave={handleSetSaved}
                    set={editingSet ? (alignerSets.find((s) => s.aligner_set_id === editingSet.aligner_set_id) ?? editingSet) : null}
                    workId={patient.workid}
                    doctors={doctors}
                    allSets={alignerSets}
                    folderPath={editingSet ? folderPathOf(editingSet) : null}
                    canPrice={caps.writeFinance}
                    workCurrency={workCurrency}
                />
            )}

            {showBatchDrawer && liveSetForBatch && (
                <BatchFormDrawer
                    isOpen={showBatchDrawer}
                    onClose={closeBatchDrawer}
                    onSave={handleBatchSaved}
                    batch={editingBatch}
                    set={liveSetForBatch}
                    existingBatches={drawerBatches.data?.batches ?? []}
                />
            )}

            {paymentSet && (
                <PaymentFormDrawer
                    isOpen
                    onClose={() => setPaymentSet(null)}
                    onSave={handlePaymentSaved}
                    set={paymentSet}
                />
            )}

            <ConfirmDialog
                isOpen={folderConfirmDialog.isOpen}
                title="Verify Folder Selection"
                message={`You selected folder "${folderConfirmDialog.folderName}". Are you sure this is your ${expectedFolderName} folder?`}
                onConfirm={() => handleFolderConfirmResponse(true)}
                onCancel={() => handleFolderConfirmResponse(false)}
                confirmText="Yes, Continue"
                cancelText="Cancel"
            />

            <LabelPreviewModal
                isOpen={showLabelModal}
                onClose={closeLabelModal}
                batch={labelModalData.batch}
                set={labelModalData.set}
                patient={patient}
                doctorName={labelModalData.set?.AlignerDoctorName ?? undefined}
            />

            {viewer && (
                <AlignerPhotoViewer
                    photos={viewer.photos}
                    index={viewer.index}
                    onIndexChange={(index) => setViewer({ ...viewer, index })}
                    onClose={() => setViewer(null)}
                    formatDate={formatSetDateTime}
                />
            )}
        </div>
    );
}
