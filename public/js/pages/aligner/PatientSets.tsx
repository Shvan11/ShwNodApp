/**
 * PatientSets - Patient's aligner sets, batches, and notes with full CRUD
 * This page handles both doctor-browse and search routes
 * Memoized to prevent unnecessary re-renders
 */
import React, { useState, useEffect, useRef, ChangeEvent, MouseEvent } from 'react';
import { useParams, useNavigate, useLoaderData } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
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
    isAbortError
} from '../../core/fileSystemAccess';
import { useToast } from '../../contexts/ToastContext';
import { useGlobalState } from '../../contexts/GlobalStateContext';
import { roleCaps, type UserRole } from '@shared/auth/roles';
import { usePrintQueue } from '../../contexts/PrintQueueContext';
import { useSetDrawer } from '../../hooks/useSetDrawer';
import { useBatchDrawer } from '../../hooks/useBatchDrawer';
import { useLabelModal } from '../../hooks/useLabelModal';
import type {
    AlignerDoctorWithAliases,
    AlignerSet,
    AlignerBatch,
    AlignerNote,
    AlignerPhoto,
} from './aligner.types';
import type { PaymentSaveData } from '@/types/api.types';
import { fetchJSON, postJSON, putJSON, patchJSON, deleteJSON, postFormData, httpErrorMessage } from '@/core/http';
import { qk } from '@/query/keys';
import * as alignerContract from '@shared/contracts/aligner.contract';
import styles from './PatientSets.module.css';

const getFileIconClass = (photo: AlignerPhoto): string => {
    const ext = photo.file_name.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'zip':
        case 'rar':
        case '7z':
        case 'tar':
        case 'gz':
            return 'fas fa-file-archive';
        case 'stl':
        case 'ply':
        case 'obj':
        case '3ds':
        case 'fbx':
            return 'fas fa-cube';
        case 'pdf':
            return 'fas fa-file-pdf';
        case 'doc':
        case 'docx':
            return 'fas fa-file-word';
        default:
            return 'fas fa-file';
    }
};

interface Patient {
    person_id: number;
    patient_name?: string;
    first_name?: string;
    last_name?: string;
    Phone?: string;
    WorkType?: string;
    workid: number;
}

interface ConfirmDialogState {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: (() => void) | null;
}

// These are the UNWRAPPED payloads: the batch-status routes return
// { success, message, data:{…} }, and core/http.ts's fetchJSON/patchJSON unwrap
// to the inner `data` object (audit H1). So a handler receives this shape directly.
interface MarkDeliveredResult {
    batchId: number;
    batchSequence: number;
    setId: number;
    wasActivated: boolean;
    wasAlreadyActive: boolean;
    wasAlreadyDelivered: boolean;
    previouslyActiveBatchSequence: number | null;
}

interface BatchStatusResult {
    batchId: number;
    batchSequence: number;
    action?: string;
    wasAlreadyManufactured?: boolean;
}

// IndexedDB key for the persisted base aligner-sets directory handle (File System
// Access API). Module-scoped so the loaders below can reference it before their
// File System helper siblings are declared.
const ALIGNER_SETS_HANDLE_KEY = 'base_aligner_sets';

const PatientSets: React.FC = () => {
    const { doctorId, workId } = useParams<{ doctorId?: string; workId?: string }>();
    const loaderData = useLoaderData() as AlignerPatientWorkLoaderResult;
    const navigate = useNavigate();
    const toast = useToast();
    const queryClient = useQueryClient();
    const { addToQueue, isInQueue, removeByBatchId } = usePrintQueue();
    const { user } = useGlobalState();
    const caps = roleCaps(user?.role as UserRole | undefined);

    // Determine if we came from doctor browse or direct search
    const isFromDoctorBrowse = doctorId !== undefined;

    // Initialize patient from loader data (already validated in loader)
    const initialPatient: Patient | null = loaderData?.patient && loaderData?.work ? {
        person_id: (loaderData.patient.person_id as number) ?? 0,
        patient_name: loaderData.patient.patient_name as string | undefined,
        first_name: loaderData.patient.first_name as string | undefined,
        last_name: loaderData.patient.last_name as string | undefined,
        Phone: loaderData.patient.phone as string | undefined,
        WorkType: loaderData.work.type_name as string | undefined,
        workid: parseInt(workId || '0'),
    } : null;

    const [patient] = useState<Patient | null>(initialPatient);
    const [alignerSets, setAlignerSets] = useState<AlignerSet[]>([]);
    const [doctors, setDoctors] = useState<AlignerDoctorWithAliases[]>([]);
    const [expandedSets, setExpandedSets] = useState<Record<number, boolean>>({});
    const [batchesData, setBatchesData] = useState<Record<number, AlignerBatch[]>>({});
    const [notesData, setNotesData] = useState<Record<number, AlignerNote[]>>({});
    const [photosData, setPhotosData] = useState<Record<number, AlignerPhoto[]>>({});
    const [viewerPhoto, setViewerPhoto] = useState<AlignerPhoto | null>(null);
    const [expandedCommunication, setExpandedCommunication] = useState<Record<number, boolean>>({});
    const [loading, setLoading] = useState<boolean>(false);

    // Close fullscreen photo viewer with Escape key
    useEffect(() => {
        const handleKeyDown = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'Escape') {
                setViewerPhoto(null);
            }
        };
        if (viewerPhoto) {
            window.addEventListener('keydown', handleKeyDown);
        }
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [viewerPhoto]);

    // Self-managed data loaders. Declared above the drawer hooks + mount effects
    // that reference them so every reference is a backward one (a forward reference
    // from a hook argument / effect trips react-hooks/immutability "accessed before
    // declared"). PatientSets keeps these self-managed reads — see CLAUDE.md.
    const loadAlignerSets = async (workIdParam: number): Promise<void> => {
        try {
            // Flat { success, sets, count } (no `data` key) → fetchJSON passthrough.
            const data = await fetchJSON<{ sets?: AlignerSet[] }>(`/api/aligner/sets/${workIdParam}`, { schema: alignerContract.setsByWorkId.response });

            const sets: AlignerSet[] = data.sets || [];
            setAlignerSets(sets);

            // Auto-expand the active set
            const activeSet = sets.find(s => s.is_active === true);
            if (activeSet) {
                const setId = activeSet.aligner_set_id;
                if (!batchesData[setId]) {
                    await loadBatches(setId);
                }
                if (!notesData[setId]) {
                    await loadNotes(setId, workIdParam);
                }
                if (!photosData[setId]) {
                    await loadPhotos(setId);
                }
                setExpandedSets(prev => ({ ...prev, [setId]: true }));
                setExpandedCommunication(prev => ({ ...prev, [setId]: true }));
            }
        } catch (error) {
            console.error('Error loading aligner sets:', error);
            toast.error('Failed to load aligner sets: ' + httpErrorMessage(error, 'unknown error'));
        }
    };

    const loadBatches = async (setId: number): Promise<void> => {
        try {
            // Flat { success, batches } (no `data` key) → fetchJSON passthrough.
            const data = await fetchJSON<{ batches?: AlignerBatch[] }>(`/api/aligner/batches/${setId}`, { schema: alignerContract.batchesBySetId.response });
            setBatchesData(prev => ({ ...prev, [setId]: data.batches || [] }));
        } catch (error) {
            console.error('Error loading batches:', error);
            setBatchesData(prev => ({ ...prev, [setId]: [] }));
        }
    };

    const loadNotes = async (setId: number, workIdParam: number, autoMarkRead: boolean = true): Promise<void> => {
        try {
            // Flat { success, notes } (no `data` key) → fetchJSON passthrough.
            const data = await fetchJSON<{ notes?: AlignerNote[] }>(`/api/aligner/notes/${setId}`, { schema: alignerContract.notesBySetId.response });

            setNotesData(prev => ({ ...prev, [setId]: data.notes || [] }));

            // Auto-mark unread doctor notes as read
            if (autoMarkRead) {
                const unreadDoctorNotes = (data.notes || []).filter((note: AlignerNote) =>
                    note.note_type === 'Doctor' && note.is_read === false
                );

                if (unreadDoctorNotes.length > 0) {
                    for (const note of unreadDoctorNotes) {
                        await markNoteAsRead(note.note_id);
                    }
                    await loadNotes(setId, workIdParam, false);
                }
            }
        } catch (error) {
            console.error('Error loading notes:', error);
            setNotesData(prev => ({ ...prev, [setId]: [] }));
        }
    };

    const loadPhotos = async (setId: number): Promise<void> => {
        try {
            const data = await fetchJSON<{ photos: AlignerPhoto[] }>(`/api/aligner/sets/${setId}/photos`, { schema: alignerContract.getSetPhotos.response });
            setPhotosData(prev => ({ ...prev, [setId]: data.photos || [] }));
        } catch (error) {
            console.error('Error loading photos:', error);
            setPhotosData(prev => ({ ...prev, [setId]: [] }));
        }
    };

    const handleDeletePhoto = async (setId: number, path: string): Promise<void> => {
        if (!window.confirm('Are you sure you want to delete this photo?')) {
            return;
        }
        try {
            await deleteJSON(`/api/aligner/sets/${setId}/photos?path=${encodeURIComponent(path)}`);
            toast.success('Photo deleted successfully');
            await loadPhotos(setId);
        } catch (error) {
            console.error('Error deleting photo:', error);
            toast.error('Failed to delete photo: ' + httpErrorMessage(error, 'unknown error'));
        }
    };

    const markNoteAsRead = async (noteId: number): Promise<void> => {
        // Callers only pass notes already known to be unread (is_read === false from
        // the just-loaded notes payload), so toggling to read directly is safe — no
        // need for a per-note /status round-trip first.
        try {
            await patchJSON(`/api/aligner/notes/${noteId}/toggle-read`, {});
        } catch (error) {
            console.error('Error marking note as read:', error);
        }
    };

    // Set drawer hook - handles add/edit set form state
    const {
        showSetDrawer,
        editingSet,
        openAddSetDrawer,
        openEditSetDrawer,
        closeSetDrawer,
        handleSetSaved,
    } = useSetDrawer({
        onRefresh: () => {
            if (patient) loadAlignerSets(patient.workid);
        },
    });

    // Batch drawer hook - handles add/edit batch form state
    const {
        showBatchDrawer,
        editingBatch,
        currentSetForBatch,
        openAddBatchDrawer,
        openEditBatchDrawer,
        closeBatchDrawer,
        handleBatchSaved,
    } = useBatchDrawer({
        onRefresh: async (setId) => {
            await loadBatches(setId);
            // Also refresh sets to update RemainingUpperAligners/RemainingLowerAligners
            if (patient) {
                await loadAlignerSets(patient.workid);
            }
        },
    });

    const {
        showLabelModal,
        labelModalData,
        openLabelModal,
        closeLabelModal,
    } = useLabelModal();

    const [showPaymentDrawer, setShowPaymentDrawer] = useState<boolean>(false);
    const [currentSetForPayment, setCurrentSetForPayment] = useState<AlignerSet | null>(null);
    const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({ isOpen: false, title: '', message: '', onConfirm: null });

    // Folder confirmation dialog (async pattern)
    const [folderConfirmDialog, setFolderConfirmDialog] = useState<{ isOpen: boolean; folderName: string }>({ isOpen: false, folderName: '' });
    const folderConfirmResolveRef = useRef<((value: boolean) => void) | null>(null);

    // Note states for lab communication
    const [showAddLabNote, setShowAddLabNote] = useState<Record<number, boolean>>({});
    const [labNoteText, setLabNoteText] = useState<string>('');
    const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
    const [editNoteText, setEditNoteText] = useState<string>('');

    // Quick URL editing
    const [editingUrlForSet, setEditingUrlForSet] = useState<number | null>(null);
    const [quickUrlValue, setQuickUrlValue] = useState<string>('');
    const [savingUrl, setSavingUrl] = useState<boolean>(false);

    // Quick PDF URL editing
    const [editingPdfUrlForSet, setEditingPdfUrlForSet] = useState<number | null>(null);
    const [quickPdfUrlValue, setQuickPdfUrlValue] = useState<string>('');
    const [savingPdfUrl, setSavingPdfUrl] = useState<boolean>(false);

    // Quick Video URL editing
    const [editingVideoForSet, setEditingVideoForSet] = useState<number | null>(null);
    const [quickVideoValue, setQuickVideoValue] = useState<string>('');
    const [savingVideo, setSavingVideo] = useState<boolean>(false);

    // PDF file upload
    const [uploadingPdf, setUploadingPdf] = useState<boolean>(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [hasBaseDirectoryAccess, setHasBaseDirectoryAccess] = useState<boolean>(false);

    // Self-managed loaders (PatientSets keeps loader-fed / self-managed reads — see
    // CLAUDE.md). Written as .then-chains so every setState lives in a chained
    // callback, never synchronously in the mount effects below (set-state-in-effect).

    const loadDoctors = (): void => {
        // Flat { success, doctors } (no `data` key) → fetchJSON passthrough.
        fetchJSON<{ doctors?: AlignerDoctorWithAliases[] }>('/api/aligner/doctors', { schema: alignerContract.alignerDoctors.response })
            .then((data) => setDoctors(data.doctors || []))
            .catch((error) => console.error('Error loading doctors:', error));
    };

    const loadAlignerSetsOnly = (): void => {
        // Patient data is already loaded from the route loader (useLoaderData); only
        // the aligner sets are fetched here. The loading flag is raised in render
        // (below) on each work change and lowered when the fetch settles. The async
        // loadAlignerSets is invoked from a chained callback (not synchronously) so
        // the mount effect's synchronous body never calls into a setState-bearing
        // async function (react-hooks/set-state-in-effect).
        Promise.resolve()
            .then(() => loadAlignerSets(parseInt(workId || '0')))
            .catch((error) => console.error('Error loading aligner sets:', error))
            .finally(() => setLoading(false));
    };

    const checkBaseDirectoryAccess = (): void => {
        if (!isFileSystemAccessSupported()) return; // stays false (initial state)
        getDirectoryHandle(ALIGNER_SETS_HANDLE_KEY)
            .then((baseHandle) => {
                if (!baseHandle) {
                    setHasBaseDirectoryAccess(false);
                    return;
                }
                return checkPermission(baseHandle, 'read').then((permission) => {
                    setHasBaseDirectoryAccess(permission === 'granted');
                });
            })
            .catch(() => setHasBaseDirectoryAccess(false));
    };

    // Raise the loading flag whenever the viewed work changes (incl. first mount) —
    // done during render so the mount effect carries no synchronous setState;
    // loadAlignerSetsOnly lowers it when the fetch settles.
    const [loadedWork, setLoadedWork] = useState<string | null>(null);
    if (loadedWork !== (workId ?? null)) {
        setLoadedWork(workId ?? null);
        setLoading(true);
    }

    // Check base directory access on mount.
    useEffect(() => {
        checkBaseDirectoryAccess();
    }, []);

    // Load aligner sets + doctors on mount / work change (patient data from loader).
    useEffect(() => {
        loadAlignerSetsOnly();
        loadDoctors();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workId]);

    const toggleBatches = async (setId: number): Promise<void> => {
        if (expandedSets[setId]) {
            setExpandedSets(prev => ({ ...prev, [setId]: false }));
            setExpandedCommunication(prev => ({ ...prev, [setId]: false }));
            return;
        }

        if (!batchesData[setId]) {
            await loadBatches(setId);
        }

        if (!notesData[setId]) {
            await loadNotes(setId, patient?.workid || 0);
        }

        if (!photosData[setId]) {
            await loadPhotos(setId);
        }

        setExpandedSets(prev => ({ ...prev, [setId]: true }));
        setExpandedCommunication(prev => ({ ...prev, [setId]: true }));
    };

    const toggleCommunication = (setId: number): void => {
        setExpandedCommunication(prev => ({ ...prev, [setId]: !prev[setId] }));
    };

    // Helper functions
    const formatDate = (dateString: string | null | undefined): string => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    };

    const formatDateTime = (dateString: string | null | undefined): string => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const calculateProgress = (set: AlignerSet): number => {
        const delivered = set.upper_aligners_count + set.lower_aligners_count - set.remaining_upper_aligners - set.remaining_lower_aligners;
        const total = set.upper_aligners_count + set.lower_aligners_count;
        return total > 0 ? Math.round((delivered / total) * 100) : 0;
    };

    const formatPatientName = (p: Patient | null): string => {
        return p?.patient_name || `${p?.first_name || ''} ${p?.last_name || ''}`.trim() || 'N/A';
    };

    const generateFolderPath = (set: AlignerSet): string | null => {
        if (!patient || !set) return null;
        const folderPath = `\\\\WORK_PC\\Aligner_Sets\\${set.aligner_dr_id}\\${patient.person_id}\\${set.set_sequence}`;
        return folderPath;
    };

    const openSetFolder = async (set: AlignerSet): Promise<void> => {
        const folderPath = generateFolderPath(set);
        if (!folderPath) {
            toast.error('Unable to generate folder path');
            return;
        }

        // Try to open using explorer: protocol
        try {
            const explorerUrl = `explorer:${folderPath}`;

            const link = document.createElement('a');
            link.href = explorerUrl;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            toast.info(`Opening folder: ${folderPath}`);
            await copyToClipboard(folderPath);

        } catch (error) {
            console.error('Error opening folder:', error);

            // Fallback - copy to clipboard and show alert
            const success = await copyToClipboard(folderPath);

            if (success) {
                toast.info(`Folder path copied to clipboard. Note: Please ensure the explorer: protocol handler is installed.`);
            } else {
                toast.info(`Folder path: ${folderPath}. Note: Please ensure the explorer: protocol handler is installed.`);
            }
        }
    };

    const backToList = (): void => {
        if (isFromDoctorBrowse) {
            navigate(`/aligner/doctor/${doctorId}`);
        } else {
            navigate('/aligner/search');
        }
    };

    const openPaymentDrawer = (set: AlignerSet): void => {
        setCurrentSetForPayment(set);
        setShowPaymentDrawer(true);
    };

    const handlePaymentSaved = async (paymentData: PaymentSaveData): Promise<void> => {
        if (!patient || !currentSetForPayment) return;

        try {
            await postJSON('/api/aligner/payments', {
                workid: patient.workid,
                aligner_set_id: currentSetForPayment.aligner_set_id,
                amount_paid: paymentData.amount_paid,
                date_of_payment: paymentData.date_of_payment,
                payment_method: 'Cash', // Default method
                actual_amount: paymentData.actual_amount,
                actual_cur: paymentData.actual_cur,
                change: paymentData.change
            });
        } catch (err) {
            // PaymentFormDrawer surfaces the thrown error's .message — preserve the
            // server's detail (HttpError.message would just be "HTTP Error: 400 …").
            throw new Error(httpErrorMessage(err, 'Failed to save payment'), { cause: err });
        }

        queryClient.invalidateQueries({ queryKey: qk.work.all(patient.workid) });
        toast.success('Payment saved successfully');
        setShowPaymentDrawer(false);
        setCurrentSetForPayment(null);
        loadAlignerSets(patient.workid);
    };

    const handleDeleteSet = (set: AlignerSet, e: MouseEvent<HTMLButtonElement>): void => {
        e.stopPropagation();
        setConfirmDialog({
            isOpen: true,
            title: 'Delete Aligner Set?',
            message: `Are you sure you want to delete Set #${set.set_sequence}? This will also delete all associated batches and notes. This action cannot be undone.`,
            onConfirm: async () => {
                try {
                    await deleteJSON(`/api/aligner/sets/${set.aligner_set_id}`);

                    toast.success('Set deleted successfully');
                    if (patient) {
                        loadAlignerSets(patient.workid);
                    }
                } catch (error) {
                    console.error('Error deleting set:', error);
                    toast.error('Failed to delete set: ' + httpErrorMessage(error, 'unknown error'));
                }
                setConfirmDialog({ isOpen: false, title: '', message: '', onConfirm: null });
            }
        });
    };

    const handleMarkDelivered = async (batch: AlignerBatch, e: MouseEvent<HTMLButtonElement>): Promise<void> => {
        e.stopPropagation();
        setConfirmDialog({
            isOpen: true,
            title: 'Mark as Delivered?',
            message: `Mark Batch #${batch.batch_sequence} as delivered? This will set the delivery date to today.`,
            onConfirm: async () => {
                try {
                    // fetchJSON unwraps { success, message, data } → the inner data object.
                    const result = await patchJSON<MarkDeliveredResult>(`/api/aligner/batches/${batch.aligner_batch_id}/deliver`, {}, { schema: alignerContract.deliverBatch.response });

                    // Show appropriate toast based on what happened
                    if (result.wasAlreadyDelivered) {
                        toast.info('Batch was already delivered');
                    } else if (result.wasActivated) {
                        toast.success(`Batch #${result.batchSequence} delivered and activated (latest batch)`);
                    } else if (result.wasAlreadyActive) {
                        toast.success(`Batch #${result.batchSequence} delivered (already active)`);
                    } else {
                        toast.success('Batch marked as delivered');
                    }

                    await loadBatches(batch.aligner_set_id);
                    if (patient) {
                        await loadAlignerSets(patient.workid);
                    }
                } catch (error) {
                    console.error('Error marking as delivered:', error);
                    toast.error('Failed to mark as delivered: ' + httpErrorMessage(error, 'unknown error'));
                }
                setConfirmDialog({ isOpen: false, title: '', message: '', onConfirm: null });
            }
        });
    };

    const handleMarkManufactured = async (batch: AlignerBatch, e: MouseEvent<HTMLButtonElement>): Promise<void> => {
        e.stopPropagation();
        setConfirmDialog({
            isOpen: true,
            title: 'Mark as Manufactured?',
            message: `Mark Batch #${batch.batch_sequence} as manufactured? This will set the manufacture date to today.`,
            onConfirm: async () => {
                try {
                    // fetchJSON unwraps to the inner data; the idempotency signal is now
                    // the structured wasAlreadyManufactured flag (was the envelope message,
                    // which unwrapEnvelope strips — see audit N19).
                    const result = await patchJSON<BatchStatusResult>(`/api/aligner/batches/${batch.aligner_batch_id}/manufacture`, {}, { schema: alignerContract.manufactureBatch.response });

                    // Handle idempotent case where batch was already manufactured
                    if (result.wasAlreadyManufactured) {
                        toast.info('Batch was already manufactured');
                    } else {
                        toast.success('Batch marked as manufactured');
                    }

                    await loadBatches(batch.aligner_set_id);
                    if (patient) {
                        await loadAlignerSets(patient.workid);
                    }
                } catch (error) {
                    console.error('Error marking as manufactured:', error);
                    toast.error('Failed to mark as manufactured: ' + httpErrorMessage(error, 'unknown error'));
                }
                setConfirmDialog({ isOpen: false, title: '', message: '', onConfirm: null });
            }
        });
    };

    const handleUndoManufactured = async (batch: AlignerBatch, e: MouseEvent<HTMLButtonElement>): Promise<void> => {
        e.stopPropagation();
        const hasDelivery = batch.delivered_to_patient_date !== null;

        // Prevent undo manufacture if batch is delivered - show error instead of confirmation
        if (hasDelivery) {
            toast.error('Cannot undo manufacture: batch is already delivered. Undo delivery first.');
            return;
        }

        setConfirmDialog({
            isOpen: true,
            title: 'Undo Manufacture?',
            message: `Undo manufacture for Batch #${batch.batch_sequence}?`,
            onConfirm: async () => {
                try {
                    await patchJSON(`/api/aligner/batches/${batch.aligner_batch_id}/undo-manufacture`, {});

                    toast.success('Manufacture undone');
                    await loadBatches(batch.aligner_set_id);
                    if (patient) {
                        await loadAlignerSets(patient.workid);
                    }
                } catch (error) {
                    console.error('Error undoing manufacture:', error);
                    // Handle specific validation error (now carried on HttpError.data.error)
                    const errorMessage = httpErrorMessage(error, 'Failed to undo manufacture');
                    if (errorMessage.includes('already delivered')) {
                        toast.error('Cannot undo manufacture: batch is already delivered. Undo delivery first.');
                    } else {
                        toast.error('Failed to undo manufacture: ' + errorMessage);
                    }
                }
                setConfirmDialog({ isOpen: false, title: '', message: '', onConfirm: null });
            }
        });
    };

    const handleUndoDelivered = async (batch: AlignerBatch, e: MouseEvent<HTMLButtonElement>): Promise<void> => {
        e.stopPropagation();
        setConfirmDialog({
            isOpen: true,
            title: 'Undo Delivery?',
            message: `Undo delivery for Batch #${batch.batch_sequence}? This will also clear the batch expiry date.`,
            onConfirm: async () => {
                try {
                    await patchJSON(`/api/aligner/batches/${batch.aligner_batch_id}/undo-deliver`, {});

                    toast.success('Delivery undone');
                    await loadBatches(batch.aligner_set_id);
                    if (patient) {
                        await loadAlignerSets(patient.workid);
                    }
                } catch (error) {
                    console.error('Error undoing delivery:', error);
                    toast.error('Failed to undo delivery: ' + httpErrorMessage(error, 'unknown error'));
                }
                setConfirmDialog({ isOpen: false, title: '', message: '', onConfirm: null });
            }
        });
    };

    const handleDeleteBatch = (batch: AlignerBatch, e: MouseEvent<HTMLButtonElement>): void => {
        e.stopPropagation();
        setConfirmDialog({
            isOpen: true,
            title: 'Delete Batch?',
            message: `Are you sure you want to delete Batch #${batch.batch_sequence}? This action cannot be undone.`,
            onConfirm: async () => {
                try {
                    await deleteJSON(`/api/aligner/batches/${batch.aligner_batch_id}`);

                    toast.success('Batch deleted successfully');
                    await loadBatches(batch.aligner_set_id);
                    if (patient) {
                        await loadAlignerSets(patient.workid);
                    }
                } catch (error) {
                    console.error('Error deleting batch:', error);
                    toast.error('Failed to delete batch: ' + httpErrorMessage(error, 'unknown error'));
                }
                setConfirmDialog({ isOpen: false, title: '', message: '', onConfirm: null });
            }
        });
    };

    // Open label preview modal - validation wrapper for hook's openLabelModal
    const handlePrintLabels = (batch: AlignerBatch, set: AlignerSet, e: MouseEvent<HTMLButtonElement>): void => {
        e.stopPropagation();

        if (!patient || !batch.aligner_batch_id) {
            toast.error('Missing required information for printing labels');
            return;
        }

        openLabelModal(batch, set);
    };

    // Handle adding batch to print queue
    const handleToggleQueue = (batch: AlignerBatch, set: AlignerSet, e: MouseEvent<HTMLButtonElement>): void => {
        e.stopPropagation();

        if (!patient || !batch.aligner_batch_id) {
            toast.error('Missing required information');
            return;
        }

        const batchId = batch.aligner_batch_id;

        if (isInQueue(batchId)) {
            removeByBatchId(batchId);
            toast.info('Removed from print queue');
        } else {
            // Find the doctor info
            const doctor = doctors.find(d => d.id === set.aligner_dr_id || d.dr_id === set.aligner_dr_id) || {
                id: set.aligner_dr_id || 0,
                name: set.AlignerDoctorName || '',
                logoPath: null
            };

            addToQueue(
                {
                    batchId: batch.aligner_batch_id,
                    batchNumber: batch.batch_sequence,
                    // ?? null, not || 0: start 0 is a real template sequence,
                    // null means the batch has no aligners for that arch
                    upperStart: batch.upper_aligner_start_sequence ?? null,
                    upperEnd: batch.upper_aligner_end_sequence ?? null,
                    lowerStart: batch.lower_aligner_start_sequence ?? null,
                    lowerEnd: batch.lower_aligner_end_sequence ?? null
                },
                {
                    code: String(patient.person_id),
                    name: formatPatientName(patient)
                },
                doctor,
                { setId: set.aligner_set_id }
            );
            toast.success('Added to print queue');
        }
    };

    // Quick URL handlers
    const handleStartEditUrl = (set: AlignerSet, e: MouseEvent<HTMLButtonElement>): void => {
        e.stopPropagation();
        setEditingUrlForSet(set.aligner_set_id);
        setQuickUrlValue(set.set_url || '');
    };

    const handleCancelEditUrl = (): void => {
        setEditingUrlForSet(null);
        setQuickUrlValue('');
    };

    const handleSaveUrl = async (setId: number): Promise<void> => {
        try {
            setSavingUrl(true);

            // Get current set data
            const currentSet = alignerSets.find(s => s.aligner_set_id === setId);
            if (!currentSet) {
                throw new Error('Set not found');
            }

            // Update the set with new URL
            await putJSON(`/api/aligner/sets/${setId}`, {
                ...currentSet,
                set_url: quickUrlValue.trim() || null
            });

            if (patient) {
                await loadAlignerSets(patient.workid);
            }
            setEditingUrlForSet(null);
            setQuickUrlValue('');

        } catch (error) {
            console.error('Error saving URL:', error);
            toast.error('Failed to save URL: ' + httpErrorMessage(error, 'unknown error'));
        } finally {
            setSavingUrl(false);
        }
    };

    // Helper for async folder confirmation
    const confirmFolderSelection = (folderName: string): Promise<boolean> => {
        return new Promise((resolve) => {
            folderConfirmResolveRef.current = resolve;
            setFolderConfirmDialog({ isOpen: true, folderName });
        });
    };

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

            // Verify the folder name is correct
            if (dirHandle.name !== 'Aligner_Sets') {
                const confirmed = await confirmFolderSelection(dirHandle.name);
                if (!confirmed) {
                    return false;
                }
            }

            // Save to IndexedDB using shared utility
            await saveHandle(ALIGNER_SETS_HANDLE_KEY, dirHandle, {
                expectedName: 'Aligner_Sets'
            });
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

    const getBaseDirectoryHandleFromStorage = async (): Promise<FileSystemDirectoryHandle | undefined> => {
        return getDirectoryHandle(ALIGNER_SETS_HANDLE_KEY);
    };

    const navigateToSetFolder = async (
        baseHandle: FileSystemDirectoryHandle,
        drId: number,
        personId: number,
        setSequence: number
    ): Promise<FileSystemDirectoryHandle | null> => {
        const path = `${drId}/${personId}/${setSequence}`;
        const result = await navigateToDirectory(baseHandle, path, false);
        return result.success && result.data ? result.data : null;
    };

    // Quick PDF URL handlers
    const handleStartEditPdfUrlManual = (set: AlignerSet, e: MouseEvent<HTMLButtonElement>): void => {
        e.stopPropagation();
        setEditingPdfUrlForSet(set.aligner_set_id);
        setQuickPdfUrlValue(set.set_pdf_url || '');
    };

    const handleStartEditPdfUrl = async (set: AlignerSet, e: MouseEvent<HTMLButtonElement>): Promise<void> => {
        e.stopPropagation();

        // Check if File System Access API is supported
        if (!isFileSystemAccessSupported()) {
            fallbackToFileInput(set);
            return;
        }

        // Check if we have base directory access
        if (!hasBaseDirectoryAccess) {
            const granted = await requestBaseDirectoryAccess();
            if (!granted) {
                fallbackToFileInput(set);
                return;
            }
        }

        try {
            // Get base directory handle from shared utility
            const baseHandle = await getBaseDirectoryHandleFromStorage();
            if (!baseHandle) {
                fallbackToFileInput(set);
                return;
            }

            // Verify we still have permission using shared utility
            let permission = await checkPermission(baseHandle, 'read');
            if (permission !== 'granted') {
                permission = await baseHandle.requestPermission({ mode: 'read' });
                if (permission !== 'granted') {
                    setHasBaseDirectoryAccess(false);
                    fallbackToFileInput(set);
                    return;
                }
            }

            // Navigate to the specific set folder. Without a real doctor/patient id
            // there's no correct subfolder to resolve to — skip navigation rather
            // than silently landing in a bogus "0/..." path, and open the picker
            // at the base folder instead.
            const setFolderHandle = (set.aligner_dr_id && patient?.person_id)
                ? await navigateToSetFolder(
                    baseHandle,
                    set.aligner_dr_id,
                    patient.person_id,
                    set.set_sequence ?? 0
                )
                : null;

            // Open file picker starting in the set folder
            type FilePickerOptions = {
                types: Array<{
                    description: string;
                    accept: Record<string, string[]>;
                }>;
                multiple: boolean;
                startIn?: FileSystemDirectoryHandle;
            };

            const pickerOpts: FilePickerOptions = {
                types: [{
                    description: 'PDF Files',
                    accept: { 'application/pdf': ['.pdf'] }
                }],
                multiple: false
            };

            if (setFolderHandle) {
                pickerOpts.startIn = setFolderHandle;
            }

            const [fileHandle] = await (window as Window & { showOpenFilePicker: (opts?: FilePickerOptions) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker(pickerOpts);
            const file = await fileHandle.getFile();

            // Validate and upload
            if (file.type !== 'application/pdf') {
                toast.warning('Please select a PDF file');
                return;
            }

            if (file.size > 100 * 1024 * 1024) {
                toast.warning('File is too large. Maximum size is 100MB.');
                return;
            }

            await handlePdfUpload(set.aligner_set_id, file);

        } catch (error) {
            if ((error as Error).name !== 'AbortError') {
                console.error('File picker error:', error);
                fallbackToFileInput(set);
            }
        }
    };

    const fallbackToFileInput = async (set: AlignerSet): Promise<void> => {
        // Copy folder path to clipboard as fallback
        const folderPath = generateFolderPath(set);
        if (folderPath) {
            await copyToClipboard(folderPath);
        }

        // Trigger hidden file input
        if (fileInputRef.current) {
            fileInputRef.current.dataset.setId = String(set.aligner_set_id);
            fileInputRef.current.click();
        }
    };

    const handlePdfFileChange = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.type !== 'application/pdf') {
            toast.warning('Please select a PDF file');
            e.target.value = '';
            return;
        }

        if (file.size > 100 * 1024 * 1024) {
            toast.warning('File is too large. Maximum size is 100MB.');
            e.target.value = '';
            return;
        }

        const setId = e.target.dataset.setId;
        if (!setId) return;

        // Upload the PDF
        await handlePdfUpload(parseInt(setId), file);
        e.target.value = ''; // Reset file input
    };

    const handlePdfUpload = async (setId: number, file: File): Promise<void> => {
        try {
            setUploadingPdf(true);

            const formData = new FormData();
            formData.append('pdf', file);

            // Route returns { success, message, data } but the FE just reloads sets to
            // pick up the new URL; non-2xx throws.
            // 120s to match the server's timeouts.long on this route — the default
            // 30s funnel timeout would abort large PDFs client-side while the
            // upload was still completing server-side.
            await postFormData(`/api/aligner/sets/${setId}/upload-pdf`, formData, { timeoutMs: 120000 });

            // Show success message
            toast.success('PDF uploaded successfully!');

            // Reload aligner sets to show updated PDF
            if (patient) {
                await loadAlignerSets(patient.workid);
            }

        } catch (error) {
            console.error('Error uploading PDF:', error);
            toast.error('Failed to upload PDF: ' + httpErrorMessage(error, 'unknown error'));
        } finally {
            setUploadingPdf(false);
        }
    };

    const handleCancelEditPdfUrl = (): void => {
        setEditingPdfUrlForSet(null);
        setQuickPdfUrlValue('');
    };

    const handleSavePdfUrl = async (setId: number): Promise<void> => {
        try {
            setSavingPdfUrl(true);

            // Get current set data
            const currentSet = alignerSets.find(s => s.aligner_set_id === setId);
            if (!currentSet) {
                throw new Error('Set not found');
            }

            // Update the set with new PDF URL
            await putJSON(`/api/aligner/sets/${setId}`, {
                ...currentSet,
                set_pdf_url: quickPdfUrlValue.trim() || null
            });

            if (patient) {
                await loadAlignerSets(patient.workid);
            }
            setEditingPdfUrlForSet(null);
            setQuickPdfUrlValue('');

        } catch (error) {
            console.error('Error saving PDF URL:', error);
            toast.error('Failed to save PDF URL: ' + httpErrorMessage(error, 'unknown error'));
        } finally {
            setSavingPdfUrl(false);
        }
    };

    // Video URL handlers
    const isValidYouTubeUrl = (url: string): boolean => {
        if (!url) return true;
        const patterns = [
            /^https?:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]+/,
            /^https?:\/\/youtu\.be\/[\w-]+/,
            /^https?:\/\/(www\.)?youtube\.com\/embed\/[\w-]+/
        ];
        return patterns.some(pattern => pattern.test(url));
    };

    const handleStartEditVideo = (set: AlignerSet, e: MouseEvent<HTMLButtonElement>): void => {
        e.stopPropagation();
        setEditingVideoForSet(set.aligner_set_id);
        setQuickVideoValue(set.set_video || '');
    };

    const handleCancelEditVideo = (): void => {
        setEditingVideoForSet(null);
        setQuickVideoValue('');
    };

    const handleSaveVideo = async (setId: number): Promise<void> => {
        try {
            setSavingVideo(true);

            // Validate YouTube URL
            if (quickVideoValue.trim() && !isValidYouTubeUrl(quickVideoValue)) {
                toast.warning('Please enter a valid YouTube URL. Accepted formats: youtube.com/watch, youtu.be, or youtube.com/embed');
                return;
            }

            const currentSet = alignerSets.find(s => s.aligner_set_id === setId);
            if (!currentSet) {
                throw new Error('Set not found');
            }

            await putJSON(`/api/aligner/sets/${setId}`, {
                ...currentSet,
                set_video: quickVideoValue.trim() || null
            });

            if (patient) {
                await loadAlignerSets(patient.workid);
            }
            setEditingVideoForSet(null);
            setQuickVideoValue('');

        } catch (error) {
            console.error('Error saving video URL:', error);
            toast.error('Failed to save video URL: ' + httpErrorMessage(error, 'unknown error'));
        } finally {
            setSavingVideo(false);
        }
    };

    // Notes Operations
    const handleAddLabNote = async (setId: number): Promise<void> => {
        if (!labNoteText.trim()) {
            toast.warning('Please enter a note');
            return;
        }

        try {
            await postJSON('/api/aligner/notes', {
                aligner_set_id: setId,
                note_text: labNoteText.trim()
            });

            setLabNoteText('');
            setShowAddLabNote(prev => ({ ...prev, [setId]: false }));
            await loadNotes(setId, patient?.workid || 0, false);

        } catch (error) {
            console.error('Error adding note:', error);
            toast.error('Failed to add note: ' + httpErrorMessage(error, 'unknown error'));
        }
    };

    const handleStartEditNote = (note: AlignerNote): void => {
        setEditingNoteId(note.note_id);
        setEditNoteText(note.note_text);
    };

    const handleCancelEditNote = (): void => {
        setEditingNoteId(null);
        setEditNoteText('');
    };

    const saveEditNote = async (noteId: number, setId: number): Promise<void> => {
        if (!editNoteText.trim()) {
            toast.warning('Please enter a note');
            return;
        }

        try {
            await putJSON(`/api/aligner/notes/${noteId}`, {
                note_text: editNoteText.trim()
            });

            setEditingNoteId(null);
            setEditNoteText('');
            await loadNotes(setId, patient?.workid || 0, false);

        } catch (error) {
            console.error('Error updating note:', error);
            toast.error('Failed to update note: ' + httpErrorMessage(error, 'unknown error'));
        }
    };

    const handleToggleNoteRead = async (noteId: number, setId: number): Promise<void> => {
        try {
            await patchJSON(`/api/aligner/notes/${noteId}/toggle-read`, {});

            await loadNotes(setId, patient?.workid || 0, false);
        } catch (error) {
            console.error('Error toggling note read status:', error);
        }
    };

    const handleDeleteNote = (noteId: number, setId: number): void => {
        setConfirmDialog({
            isOpen: true,
            title: 'Delete Note?',
            message: 'Are you sure you want to delete this note? This action cannot be undone.',
            onConfirm: async () => {
                try {
                    await deleteJSON(`/api/aligner/notes/${noteId}`);

                    await loadNotes(setId, patient?.workid || 0, false);

                } catch (error) {
                    console.error('Error deleting note:', error);
                    toast.error('Failed to delete note: ' + httpErrorMessage(error, 'unknown error'));
                }
                setConfirmDialog({ isOpen: false, title: '', message: '', onConfirm: null });
            }
        });
    };

    if (loading) {
        return (
            <div className="aligner-container">
                <div className={styles.loadingContainer}>
                    <div className={styles.spinner}></div>
                    <p>Loading patient sets...</p>
                </div>
            </div>
        );
    }

    if (!patient) {
        return (
            <div className="aligner-container">
                <div className={styles.errorContainer}>
                    <i className="fas fa-exclamation-triangle"></i>
                    <h2>Patient Not Found</h2>
                    <button onClick={backToList} className="btn btn-primary">
                        Back to List
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="aligner-container">
            {/* Hidden file input for PDF upload */}
            <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                onChange={handlePdfFileChange}
                className={styles.hiddenFileInput}
            />

            {/* Upload Progress Overlay */}
            {uploadingPdf && (
                <div className={styles.uploadOverlay}>
                    <div className={styles.uploadDialog}>
                        <div className={styles.uploadSpinner}></div>
                        <div className={styles.uploadTitle}>Uploading PDF...</div>
                        <div className={styles.uploadHint}>Please wait while your file is being uploaded</div>
                    </div>
                </div>
            )}

            {/* Breadcrumb */}
            <div className={styles.breadcrumb}>
                <button onClick={backToList} className={styles.breadcrumbLink}>
                    <i className="fas fa-arrow-left"></i>
                    Back to {isFromDoctorBrowse ? 'Patients' : 'Search'}
                </button>
            </div>

            {/* Patient Info Header */}
            <div className={styles.patientInfo}>
                <div className={styles.patientHeader}>
                    <div className={styles.patientDetails}>
                        <h2>
                            {formatPatientName(patient)}
                            {patient.patient_name && patient.first_name && (
                                <span className={styles.patientSubtitle}>
                                    ({patient.first_name} {patient.last_name})
                                </span>
                            )}
                        </h2>
                        <div className={styles.patientMeta}>
                            <span><i className="fas fa-id-card"></i> {patient.person_id}</span>
                            <span><i className="fas fa-phone"></i> {patient.Phone || 'N/A'}</span>
                            <span><i className="fas fa-tooth"></i> {patient.WorkType}</span>
                        </div>
                    </div>
                    <div className={styles.fsAccessContainer}>
                        {/* File System Access Status */}
                        {isFileSystemAccessSupported() && (
                            <div className={`${styles.fsAccessStatus} ${hasBaseDirectoryAccess ? styles.fsAccessActive : styles.fsAccessInactive}`}>
                                <i className={`fas ${hasBaseDirectoryAccess ? 'fa-check-circle status-success' : 'fa-exclamation-circle status-error'}`}></i>
                                <span className={hasBaseDirectoryAccess ? 'text-success' : 'text-error'}>
                                    {hasBaseDirectoryAccess ? 'Folder Access: Active' : 'Folder Access: Not Set'}
                                </span>
                                {!hasBaseDirectoryAccess && (
                                    <button
                                        onClick={requestBaseDirectoryAccess}
                                        className="btn btn-sm bg-error"
                                    >
                                        Grant Access
                                    </button>
                                )}
                            </div>
                        )}

                        <button
                            className="btn btn-success"
                            onClick={() => navigate(`/patient/${patient.person_id}/edit-patient`)}
                        >
                            <i className="fas fa-edit"></i>
                            Edit Patient
                        </button>
                        <button
                            className="btn btn-info"
                            onClick={() => navigate(`/patient/${patient.person_id}/new-work?workId=${patient.workid}`)}
                        >
                            <i className="fas fa-tooth"></i>
                            Edit Work
                        </button>
                        <button className="btn btn-success" onClick={openAddSetDrawer}>
                            <i className="fas fa-plus"></i>
                            Add New Set
                        </button>
                    </div>
                </div>
            </div>

            {/* Aligner Sets - Complete rendering */}
            <div className={styles.setsContainer}>
                <div className={styles.sectionHeader}>
                    <h3>Aligner Sets</h3>
                    <div className={styles.sectionInfo}>
                        <span>{alignerSets.length} set{alignerSets.length !== 1 ? 's' : ''}</span>
                    </div>
                </div>

                {loading ? (
                    <div className={styles.loadingContainer}>
                        <div className={styles.spinner}></div>
                        <p>Loading aligner sets...</p>
                    </div>
                ) : alignerSets.length === 0 ? (
                    <div className={styles.emptyState}>
                        <i className="fas fa-inbox"></i>
                        <p>No aligner sets found for this patient</p>
                    </div>
                ) : (
                    <div className="aligner-sets">
                        {alignerSets.map((set) => {
                            const progress = calculateProgress(set);
                            const delivered = set.upper_aligners_count + set.lower_aligners_count - set.remaining_upper_aligners - set.remaining_lower_aligners;
                            const total = set.upper_aligners_count + set.lower_aligners_count;

                            return (
                                <div key={set.aligner_set_id} className={`aligner-set-card ${set.is_active ? 'active' : 'inactive'} ${(set.UnreadActivityCount || 0) > 0 ? 'has-activity' : ''}`}>
                                    {/* Activity Banner */}
                                    {(set.UnreadActivityCount || 0) > 0 && (
                                        <div className="activity-banner">
                                            <i className="fas fa-bell"></i>
                                            <strong>{set.UnreadActivityCount}</strong> new {set.UnreadActivityCount === 1 ? 'update' : 'updates'} from doctor
                                        </div>
                                    )}

                                    <div
                                        className="set-header"
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => toggleBatches(set.aligner_set_id)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                toggleBatches(set.aligner_set_id);
                                            }
                                        }}
                                    >
                                        <div className="set-title">
                                            <h4>
                                                Set #{set.set_sequence}
                                                <span className={`set-badge ${set.is_active ? 'active' : 'inactive'}`}>
                                                    {set.is_active ? 'Active' : 'Inactive'}
                                                </span>
                                                {set.type && <span className="set-type">{set.type}</span>}
                                            </h4>
                                        </div>
                                        <div className="set-header-actions">
                                            <button
                                                className="edit-set-btn"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    openEditSetDrawer(set);
                                                }}
                                                title="Edit Set Details"
                                            >
                                                <i className="fas fa-edit"></i>
                                                <span>Edit Set</span>
                                            </button>
                                            <button
                                                className="folder-btn"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    openSetFolder(set);
                                                }}
                                                title={generateFolderPath(set) || ''}
                                            >
                                                <i className="fas fa-folder-open"></i>
                                                <span>Open Folder</span>
                                            </button>
                                            {set.set_pdf_url && (
                                                <button
                                                    className="pdf-btn"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        window.open(set.set_pdf_url ?? undefined, '_blank');
                                                    }}
                                                    title={set.set_pdf_url ?? undefined}
                                                >
                                                    <i className="fas fa-file-pdf"></i>
                                                    <span>View PDF</span>
                                                </button>
                                            )}
                                            {set.set_video && (
                                                <button
                                                    className="video-btn bg-error"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        window.open(set.set_video ?? undefined, '_blank');
                                                    }}
                                                    title="Watch case explanation video"
                                                >
                                                    <i className="fab fa-youtube"></i>
                                                    <span>Case Video</span>
                                                </button>
                                            )}
                                            {set.archform_id && (
                                                <button
                                                    className="archform-btn"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        window.location.href = `archformlocal:${set.archform_id}`;
                                                    }}
                                                    title="Open in Archform"
                                                >
                                                    <i className="fas fa-cube"></i>
                                                    <span>Archform</span>
                                                </button>
                                            )}
                                            {caps.writeFinance && set.set_cost && (set.Balance || 0) > 0 && (
                                                <button
                                                    className="btn btn-primary btn-sm"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        openPaymentDrawer(set);
                                                    }}
                                                    title="Add Payment"
                                                >
                                                    <i className="fas fa-money-bill-wave"></i>
                                                    <span>Add Payment</span>
                                                </button>
                                            )}
                                            <button
                                                className="btn btn-danger btn-sm"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDeleteSet(set, e);
                                                }}
                                                title="Delete Set"
                                            >
                                                <i className="fas fa-trash"></i>
                                                <span>Delete</span>
                                            </button>
                                            <button className={`toggle-batches-btn ${expandedSets[set.aligner_set_id] ? 'expanded' : ''}`}>
                                                <span>View Batches ({set.TotalBatches})</span>
                                                <i className="fas fa-chevron-down"></i>
                                            </button>
                                        </div>
                                    </div>

                                    {set.notes && (
                                        <div className="set-notes">
                                            <i className="fas fa-sticky-note"></i>
                                            <div className="set-notes-body">
                                                <span className="set-notes-label">Set Notes</span>
                                                <p className="set-notes-text">{set.notes}</p>
                                            </div>
                                        </div>
                                    )}

                                    <div className="set-info">
                                        <div className="set-info-item">
                                            <i className="fas fa-teeth"></i>
                                            <span>Upper: <strong>{set.upper_aligners_count}</strong></span>
                                        </div>
                                        <div className="set-info-item">
                                            <i className="fas fa-teeth"></i>
                                            <span>Lower: <strong>{set.lower_aligners_count}</strong></span>
                                        </div>
                                        <div className="set-info-item">
                                            <i className="fas fa-box-open"></i>
                                            <span>Remaining Upper: <strong>{set.remaining_upper_aligners}</strong></span>
                                        </div>
                                        <div className="set-info-item">
                                            <i className="fas fa-box-open"></i>
                                            <span>Remaining Lower: <strong>{set.remaining_lower_aligners}</strong></span>
                                        </div>
                                        <div className="set-info-item">
                                            <i className="fas fa-calendar"></i>
                                            <span>Created: <strong>{formatDate(set.creation_date)}</strong></span>
                                        </div>
                                        <div className="set-info-item">
                                            <i className="fas fa-clock"></i>
                                            <span>Days: <strong>{set.days || 'N/A'}</strong></span>
                                        </div>
                                        <div className="set-info-item">
                                            <i className="fas fa-user-md"></i>
                                            <span>Doctor: <strong>{set.AlignerDoctorName || 'N/A'}</strong></span>
                                        </div>
                                        <div className="set-info-item">
                                            <i className="fas fa-check-circle"></i>
                                            <span>Delivered Batches: <strong>{set.DeliveredBatches}/{set.TotalBatches}</strong></span>
                                        </div>
                                        <div className="set-info-item">
                                            <i className="fas fa-dollar-sign"></i>
                                            <span>Cost: <strong>{set.set_cost ? `${set.set_cost} ${set.currency || 'USD'}` : 'Not set'}</strong></span>
                                        </div>
                                        {set.set_cost && (
                                            <>
                                                <div className="set-info-item">
                                                    <i className="fas fa-money-bill-wave"></i>
                                                    <span>Paid: <strong>{set.TotalPaid || 0} {set.currency || 'USD'}</strong></span>
                                                </div>
                                                <div className="set-info-item">
                                                    <i className="fas fa-balance-scale"></i>
                                                    <span>Balance: <strong>{set.Balance ?? set.set_cost} {set.currency || 'USD'}</strong></span>
                                                </div>
                                                <div className="set-info-item">
                                                    <span className={`payment-status-badge ${set.PaymentStatus?.toLowerCase().replace(/\s+/g, '-') || 'unpaid'}`}>
                                                        {set.PaymentStatus || 'Unpaid'}
                                                    </span>
                                                </div>
                                            </>
                                        )}
                                        <div className="set-info-item grid-col-full-flex">
                                            <i className="fas fa-external-link-alt"></i>
                                            <span className="flex-1">
                                                Set URL: {editingUrlForSet === set.aligner_set_id ? (
                                                    <div className="inline-buttons-container">
                                                        <input
                                                            type="url"
                                                            value={quickUrlValue}
                                                            onChange={(e: ChangeEvent<HTMLInputElement>) => setQuickUrlValue(e.target.value)}
                                                            placeholder="https://..."
                                                            className="url-input-inline"
                                                            // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional focus on open
                                                            autoFocus
                                                            onClick={(e: MouseEvent) => e.stopPropagation()}
                                                        />
                                                    </div>
                                                ) : set.set_url ? (
                                                    <a href={set.set_url} target="_blank" rel="noopener noreferrer" className="url-link">
                                                        {set.set_url}
                                                    </a>
                                                ) : (
                                                    <em className="url-not-set">Not set</em>
                                                )}
                                            </span>
                                            {editingUrlForSet === set.aligner_set_id ? (
                                                <div className="flex-gap-sm">
                                                    <button
                                                        className="action-icon-btn edit btn-small"
                                                        onClick={(e: MouseEvent<HTMLButtonElement>) => {
                                                            e.stopPropagation();
                                                            handleSaveUrl(set.aligner_set_id);
                                                        }}
                                                        disabled={savingUrl}
                                                        title="Save URL"
                                                    >
                                                        {savingUrl ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-save"></i>}
                                                    </button>
                                                    <button
                                                        className="action-icon-btn delete btn-small"
                                                        onClick={(e: MouseEvent<HTMLButtonElement>) => {
                                                            e.stopPropagation();
                                                            handleCancelEditUrl();
                                                        }}
                                                        title="Cancel"
                                                    >
                                                        <i className="fas fa-times"></i>
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    className="action-icon-btn edit btn-medium"
                                                    onClick={(e: MouseEvent<HTMLButtonElement>) => handleStartEditUrl(set, e)}
                                                    title={set.set_url ? "Edit URL" : "Add URL"}
                                                >
                                                    <i className={set.set_url ? "fas fa-edit" : "fas fa-plus"}></i>
                                                </button>
                                            )}
                                        </div>
                                        <div className="set-info-item grid-col-full-flex">
                                            <i className="fas fa-file-pdf"></i>
                                            <span className="flex-1">
                                                PDF URL: {editingPdfUrlForSet === set.aligner_set_id ? (
                                                    <div className="inline-buttons-container">
                                                        <input
                                                            type="url"
                                                            value={quickPdfUrlValue}
                                                            onChange={(e: ChangeEvent<HTMLInputElement>) => setQuickPdfUrlValue(e.target.value)}
                                                            placeholder="https://..."
                                                            className="url-input-inline"
                                                            // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional focus on open
                                                            autoFocus
                                                            onClick={(e: MouseEvent) => e.stopPropagation()}
                                                        />
                                                    </div>
                                                ) : set.set_pdf_url ? (
                                                    <a href={set.set_pdf_url} target="_blank" rel="noopener noreferrer" className="url-link">
                                                        {set.set_pdf_url}
                                                    </a>
                                                ) : (
                                                    <em className="url-not-set">Not set</em>
                                                )}
                                            </span>
                                            {editingPdfUrlForSet === set.aligner_set_id ? (
                                                <div className="flex-gap-sm">
                                                    <button
                                                        className="action-icon-btn edit btn-small"
                                                        onClick={(e: MouseEvent<HTMLButtonElement>) => {
                                                            e.stopPropagation();
                                                            handleSavePdfUrl(set.aligner_set_id);
                                                        }}
                                                        disabled={savingPdfUrl}
                                                        title="Save PDF URL"
                                                    >
                                                        {savingPdfUrl ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-save"></i>}
                                                    </button>
                                                    <button
                                                        className="action-icon-btn delete btn-small"
                                                        onClick={(e: MouseEvent<HTMLButtonElement>) => {
                                                            e.stopPropagation();
                                                            handleCancelEditPdfUrl();
                                                        }}
                                                        title="Cancel"
                                                    >
                                                        <i className="fas fa-times"></i>
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="flex-gap-sm">
                                                    <button
                                                        className="action-icon-btn edit btn-medium"
                                                        onClick={(e: MouseEvent<HTMLButtonElement>) => handleStartEditPdfUrl(set, e)}
                                                        title={set.set_pdf_url ? "Replace PDF (upload file)" : "Upload PDF"}
                                                        disabled={uploadingPdf}
                                                    >
                                                        {uploadingPdf ? (
                                                            <i className="fas fa-spinner fa-spin"></i>
                                                        ) : (
                                                            <i className={set.set_pdf_url ? "fas fa-edit" : "fas fa-plus"}></i>
                                                        )}
                                                    </button>
                                                    <button
                                                        className="action-icon-btn edit btn-medium"
                                                        onClick={(e: MouseEvent<HTMLButtonElement>) => handleStartEditPdfUrlManual(set, e)}
                                                        title="Enter PDF link manually"
                                                        disabled={uploadingPdf}
                                                    >
                                                        <i className="fas fa-link"></i>
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                        <div className="set-info-item grid-col-full-flex">
                                            <i className="fas fa-video"></i>
                                            <span className="flex-1">
                                                Case Video: {editingVideoForSet === set.aligner_set_id ? (
                                                    <div className="inline-buttons-container">
                                                        <input
                                                            type="url"
                                                            value={quickVideoValue}
                                                            onChange={(e: ChangeEvent<HTMLInputElement>) => setQuickVideoValue(e.target.value)}
                                                            placeholder="https://youtube.com/watch?v=..."
                                                            className="url-input-inline"
                                                            // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional focus on open
                                                            autoFocus
                                                            onClick={(e: MouseEvent) => e.stopPropagation()}
                                                        />
                                                    </div>
                                                ) : set.set_video ? (
                                                    <a href={set.set_video} target="_blank" rel="noopener noreferrer" className="video-link-youtube">
                                                        <i className="fab fa-youtube icon-gap-xs"></i>
                                                        Watch Case Video
                                                    </a>
                                                ) : (
                                                    <em className="url-not-set">Not set</em>
                                                )}
                                            </span>
                                            {editingVideoForSet === set.aligner_set_id ? (
                                                <div className="flex-gap-sm">
                                                    <button
                                                        className="action-icon-btn edit btn-small"
                                                        onClick={(e: MouseEvent<HTMLButtonElement>) => {
                                                            e.stopPropagation();
                                                            handleSaveVideo(set.aligner_set_id);
                                                        }}
                                                        disabled={savingVideo}
                                                        title="Save Video URL"
                                                    >
                                                        {savingVideo ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-save"></i>}
                                                    </button>
                                                    <button
                                                        className="action-icon-btn delete btn-small"
                                                        onClick={(e: MouseEvent<HTMLButtonElement>) => {
                                                            e.stopPropagation();
                                                            handleCancelEditVideo();
                                                        }}
                                                        title="Cancel"
                                                    >
                                                        <i className="fas fa-times"></i>
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    className="action-icon-btn edit btn-medium"
                                                    onClick={(e: MouseEvent<HTMLButtonElement>) => handleStartEditVideo(set, e)}
                                                    title={set.set_video ? "Edit Video URL" : "Add Video URL"}
                                                >
                                                    <i className={set.set_video ? "fas fa-edit" : "fas fa-plus"}></i>
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <div className="set-progress">
                                        <div className="progress-bar-container">
                                            <div className="progress-bar" style={{ width: `${progress}%` }}></div>
                                        </div>
                                        <div className="progress-text">
                                            <span>{delivered} of {total} aligners delivered</span>
                                            <span>{progress}%</span>
                                        </div>
                                    </div>

                                    {/* Batches Container */}
                                    {expandedSets[set.aligner_set_id] && (
                                        <div className="batches-container expanded">
                                            <div className="batches-header">
                                                <h5>Batches</h5>
                                                <button
                                                    className="btn btn-success btn-sm"
                                                    onClick={() => openAddBatchDrawer(set)}
                                                    disabled={!set.is_active}
                                                    title={!set.is_active ? 'Cannot add batches to inactive sets' : 'Add new batch'}
                                                >
                                                    <i className="fas fa-plus"></i> Add Batch
                                                </button>
                                            </div>
                                            {!batchesData[set.aligner_set_id] ? (
                                                <div className="loading">
                                                    <div className="spinner"></div>
                                                    <p>Loading batches...</p>
                                                </div>
                                            ) : batchesData[set.aligner_set_id].length === 0 ? (
                                                <p className="empty-state">No batches found for this set</p>
                                            ) : (
                                                batchesData[set.aligner_set_id].map((batch) => {
                                                    const isManufactured = batch.manufacture_date !== null;
                                                    const isDelivered = batch.delivered_to_patient_date !== null;
                                                    // Three states: pending-manufacture, pending-delivery, delivered
                                                    const batchState = !isManufactured ? 'pending-manufacture'
                                                        : !isDelivered ? 'pending-delivery'
                                                        : 'delivered';
                                                    const batchStateLabel = !isManufactured ? 'Pending Manufacture'
                                                        : !isDelivered ? 'Pending Delivery'
                                                        : 'Delivered';
                                                    return (
                                                        <div key={batch.aligner_batch_id} className={`batch-item ${batchState}`}>
                                                            <div className="batch-header">
                                                                <div className="batch-title">Batch #{batch.batch_sequence}</div>
                                                                <div className="batch-actions">
                                                                    <span className={`batch-status ${batchState}`}>
                                                                        {batchStateLabel}
                                                                    </span>
                                                                    {/* Mark Manufactured - only if not yet manufactured */}
                                                                    {!isManufactured && (
                                                                        <button
                                                                            className="action-icon-btn manufacture"
                                                                            onClick={(e: MouseEvent<HTMLButtonElement>) => handleMarkManufactured(batch, e)}
                                                                            title="Mark as Manufactured (sets today's date)"
                                                                        >
                                                                            <i className="fas fa-industry"></i>
                                                                        </button>
                                                                    )}
                                                                    {/* Mark Delivered - only if manufactured but not yet delivered */}
                                                                    {isManufactured && !isDelivered && (
                                                                        <button
                                                                            className="action-icon-btn deliver"
                                                                            onClick={(e: MouseEvent<HTMLButtonElement>) => handleMarkDelivered(batch, e)}
                                                                            title="Mark as Delivered (sets today's date)"
                                                                        >
                                                                            <i className="fas fa-truck"></i>
                                                                        </button>
                                                                    )}
                                                                    {/* Undo buttons moved to Edit Batch modal */}
                                                                    <button
                                                                        className={`action-icon-btn queue-labels ${isInQueue(batch.aligner_batch_id) ? 'in-queue' : ''}`}
                                                                        onClick={(e: MouseEvent<HTMLButtonElement>) => handleToggleQueue(batch, set, e)}
                                                                        title={isInQueue(batch.aligner_batch_id) ? 'Remove from print queue' : 'Add to print queue'}
                                                                    >
                                                                        <i className={isInQueue(batch.aligner_batch_id) ? 'fas fa-check' : 'fas fa-cart-plus'}></i>
                                                                    </button>
                                                                    <button
                                                                        className="action-icon-btn print-labels bg-purple"
                                                                        onClick={(e: MouseEvent<HTMLButtonElement>) => handlePrintLabels(batch, set, e)}
                                                                        title="Print Labels (PDF)"
                                                                    >
                                                                        <i className="fas fa-print"></i>
                                                                    </button>
                                                                    <button
                                                                        className="action-icon-btn edit"
                                                                        onClick={() => openEditBatchDrawer(batch, set)}
                                                                        title="Edit Batch"
                                                                    >
                                                                        <i className="fas fa-edit"></i>
                                                                    </button>
                                                                    <button
                                                                        className="action-icon-btn delete"
                                                                        onClick={(e: MouseEvent<HTMLButtonElement>) => handleDeleteBatch(batch, e)}
                                                                        title="Delete Batch"
                                                                    >
                                                                        <i className="fas fa-times"></i>
                                                                    </button>
                                                                </div>
                                                            </div>
                                                            <div className="batch-details">
                                                                <div className="batch-detail">
                                                                    <i className="fas fa-teeth"></i>
                                                                    <span>Upper: {batch.upper_aligner_start_sequence}-{batch.upper_aligner_end_sequence} ({batch.upper_aligner_count})</span>
                                                                </div>
                                                                <div className="batch-detail">
                                                                    <i className="fas fa-teeth"></i>
                                                                    <span>Lower: {batch.lower_aligner_start_sequence}-{batch.lower_aligner_end_sequence} ({batch.lower_aligner_count})</span>
                                                                </div>
                                                                {batch.creation_date && (
                                                                    <div className="batch-detail">
                                                                        <i className="fas fa-plus-circle"></i>
                                                                        <span>Created: {formatDate(batch.creation_date)}</span>
                                                                    </div>
                                                                )}
                                                                <div className="batch-detail">
                                                                    <i className="fas fa-industry"></i>
                                                                    <span>Manufactured: {batch.manufacture_date ? formatDate(batch.manufacture_date) : 'Not yet'}</span>
                                                                </div>
                                                                {isDelivered && (
                                                                    <div className="batch-detail">
                                                                        <i className="fas fa-truck"></i>
                                                                        <span>Delivered: {formatDate(batch.delivered_to_patient_date)}</span>
                                                                    </div>
                                                                )}
                                                                <div className="batch-detail">
                                                                    <i className="fas fa-clock"></i>
                                                                    <span>Days: {batch.days || 'N/A'}</span>
                                                                </div>
                                                                <div className="batch-detail">
                                                                    <i className="fas fa-hourglass-half"></i>
                                                                    <span>Validity: {batch.validity_period || 'N/A'} days</span>
                                                                </div>
                                                                {batch.batch_expiry_date && (
                                                                    <div className="batch-detail">
                                                                        <i className="fas fa-calendar-check"></i>
                                                                        <span>Batch Expiry: {formatDate(batch.batch_expiry_date)}</span>
                                                                    </div>
                                                                )}
                                                                {batch.notes && (
                                                                    <div className="batch-detail batch-detail-full">
                                                                        <i className="fas fa-sticky-note"></i>
                                                                        <span>Notes: {batch.notes}</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    )}

                                    {/* Portal Photos Section */}
                                    {expandedSets[set.aligner_set_id] && (
                                        <div className="aligner-photos-container">
                                            {(() => {
                                                const allAttachments = photosData[set.aligner_set_id];
                                                if (!allAttachments) {
                                                    return (
                                                        <div className="loading">
                                                            <div className="spinner"></div>
                                                            <p>Loading files...</p>
                                                        </div>
                                                    );
                                                }

                                                const imagePhotos = allAttachments.filter(p => p.path.includes('/photos/') || !p.path.includes('/files/'));
                                                const fileAttachments = allAttachments.filter(p => p.path.includes('/files/'));

                                                return (
                                                    <>
                                                        {/* Clinical Photos Sub-section */}
                                                        <div style={{ marginBottom: '1.5rem' }}>
                                                            <div className="aligner-photos-header">
                                                                <h5>
                                                                    <i className="fas fa-camera"></i>
                                                                    Portal Photos ({imagePhotos.length})
                                                                </h5>
                                                            </div>
                                                            {imagePhotos.length === 0 ? (
                                                                <p className="empty-state">No photos uploaded by the doctor yet</p>
                                                            ) : (
                                                                <div className="aligner-photos-grid">
                                                                    {imagePhotos.map((photo) => (
                                                                        <div 
                                                                            key={photo.path} 
                                                                            className="aligner-photo-card"
                                                                            onClick={() => setViewerPhoto(photo)}
                                                                            onKeyDown={(e) => {
                                                                                if (e.key === 'Enter' || e.key === ' ') {
                                                                                    e.preventDefault();
                                                                                    setViewerPhoto(photo);
                                                                                }
                                                                            }}
                                                                            role="button"
                                                                            tabIndex={0}
                                                                            title={`View ${photo.file_name}`}
                                                                        >
                                                                            <button
                                                                                className="aligner-photo-delete-btn"
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    handleDeletePhoto(set.aligner_set_id, photo.path);
                                                                                }}
                                                                                title="Delete File"
                                                                            >
                                                                                <i className="fas fa-trash"></i>
                                                                            </button>
                                                                            <img src={photo.view_url} alt={photo.file_name} />
                                                                            <div className="aligner-photo-info-overlay" title={photo.file_name}>
                                                                                {photo.file_name}
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>

                                                        {/* Scan Files Sub-section */}
                                                        <div>
                                                            <div className="aligner-photos-header">
                                                                <h5>
                                                                    <i className="fas fa-cube"></i>
                                                                    Portal Scan Files ({fileAttachments.length})
                                                                </h5>
                                                            </div>
                                                            {fileAttachments.length === 0 ? (
                                                                <p className="empty-state">No scan files uploaded by the doctor yet</p>
                                                            ) : (
                                                                <div className="aligner-photos-grid">
                                                                    {fileAttachments.map((photo) => (
                                                                        <div 
                                                                            key={photo.path} 
                                                                            className="aligner-photo-card"
                                                                            onClick={() => window.open(photo.view_url, '_blank')}
                                                                            onKeyDown={(e) => {
                                                                                if (e.key === 'Enter' || e.key === ' ') {
                                                                                    e.preventDefault();
                                                                                    window.open(photo.view_url, '_blank');
                                                                                }
                                                                            }}
                                                                            role="button"
                                                                            tabIndex={0}
                                                                            title={`Download ${photo.file_name}`}
                                                                        >
                                                                            <button
                                                                                className="aligner-photo-delete-btn"
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    handleDeletePhoto(set.aligner_set_id, photo.path);
                                                                                }}
                                                                                title="Delete File"
                                                                            >
                                                                                <i className="fas fa-trash"></i>
                                                                            </button>
                                                                            <div className="aligner-file-icon-placeholder">
                                                                                <i className={getFileIconClass(photo)}></i>
                                                                            </div>
                                                                            <div className="aligner-photo-info-overlay" title={photo.file_name}>
                                                                                {photo.file_name}
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </>
                                                );
                                            })()}
                                        </div>
                                    )}

                                    {/* Communication Section */}
                                    <div className="communication-section">
                                        <button
                                            className={`communication-toggle-btn ${expandedCommunication[set.aligner_set_id] ? 'expanded' : ''}`}
                                            onClick={() => toggleCommunication(set.aligner_set_id)}
                                        >
                                            <i className="fas fa-comments"></i>
                                            <span>Communication with Doctor</span>
                                            <i className="fas fa-chevron-down"></i>
                                        </button>

                                        {expandedCommunication[set.aligner_set_id] && (
                                            <div className="communication-content expanded">
                                                {!notesData[set.aligner_set_id] ? (
                                                    <div className="loading">
                                                        <div className="spinner"></div>
                                                        <p>Loading communication...</p>
                                                    </div>
                                                ) : (
                                                    <>
                                                        {/* Add Note Form */}
                                                        <div className="add-note-section">
                                                            {!showAddLabNote[set.aligner_set_id] ? (
                                                                <button
                                                                    className="btn btn-primary btn-sm"
                                                                    onClick={() => setShowAddLabNote(prev => ({ ...prev, [set.aligner_set_id]: true }))}
                                                                >
                                                                    <i className="fas fa-plus"></i> Send Note to Doctor
                                                                </button>
                                                            ) : (
                                                                <div className="note-form">
                                                                    <textarea
                                                                        className="note-textarea"
                                                                        placeholder="Type your message to the doctor..."
                                                                        value={labNoteText}
                                                                        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setLabNoteText(e.target.value)}
                                                                    />
                                                                    <div className={styles.noteFormActions}>
                                                                        <button
                                                                            className="btn btn-secondary btn-sm"
                                                                            onClick={() => {
                                                                                setShowAddLabNote(prev => ({ ...prev, [set.aligner_set_id]: false }));
                                                                                setLabNoteText('');
                                                                            }}
                                                                        >
                                                                            Cancel
                                                                        </button>
                                                                        <button
                                                                            className="btn btn-primary btn-sm"
                                                                            onClick={() => handleAddLabNote(set.aligner_set_id)}
                                                                        >
                                                                            <i className="fas fa-paper-plane"></i> Send Note
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>

                                                        {/* Notes Timeline */}
                                                        {notesData[set.aligner_set_id].length === 0 ? (
                                                            <div className="empty-communication">
                                                                <i className="fas fa-inbox"></i>
                                                                <p>No messages yet</p>
                                                                <p className="hint">Communication between doctor and lab will appear here</p>
                                                            </div>
                                                        ) : (
                                                            <div className="notes-timeline">
                                                                {notesData[set.aligner_set_id].map((note) => (
                                                                    <div key={note.note_id} className={`note-item ${note.note_type === 'Lab' ? 'lab-note' : 'doctor-note'}`}>
                                                                        {editingNoteId === note.note_id ? (
                                                                            /* Editing Mode */
                                                                            <div className="note-edit-form">
                                                                                <textarea
                                                                                    className="note-textarea note-textarea-edit"
                                                                                    value={editNoteText}
                                                                                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setEditNoteText(e.target.value)}
                                                                                />
                                                                                <div className="flex-justify-end">
                                                                                    <button
                                                                                        className="btn-cancel btn-small"
                                                                                        onClick={handleCancelEditNote}
                                                                                    >
                                                                                        Cancel
                                                                                    </button>
                                                                                    <button
                                                                                        className="days-save-btn btn-small"
                                                                                        onClick={() => saveEditNote(note.note_id, set.aligner_set_id)}
                                                                                    >
                                                                                        Save
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                        ) : (
                                                                            /* View Mode */
                                                                            <>
                                                                                <div className="note-header-row">
                                                                                    <div className="note-author-container">
                                                                                        {/* Read/Unread Checkbox */}
                                                                                        <label
                                                                                            className="note-checkbox-label"
                                                                                            aria-label={note.is_read !== false ? 'Mark as unread' : 'Mark as read'}
                                                                                        >
                                                                                            <input
                                                                                                type="checkbox"
                                                                                                checked={note.is_read !== false}
                                                                                                onChange={() => handleToggleNoteRead(note.note_id, set.aligner_set_id)}
                                                                                                className="note-checkbox"
                                                                                                title={note.is_read !== false ? 'Mark as unread' : 'Mark as read'}
                                                                                            />
                                                                                        </label>
                                                                                        <div className={`note-author ${note.note_type === 'Lab' ? 'lab' : 'doctor'} ${note.is_read === false ? 'font-bold' : 'font-normal'}`}>
                                                                                            <i className={note.note_type === 'Lab' ? 'fas fa-flask' : 'fas fa-user-md'}></i>
                                                                                            {note.note_type === 'Lab' ? 'Shwan Lab' : `Dr. ${note.doctor_name}`}
                                                                                        </div>
                                                                                        <div className="note-date">
                                                                                            {formatDateTime(note.created_at)}
                                                                                            {note.is_edited && ' (edited)'}
                                                                                        </div>
                                                                                    </div>
                                                                                    {/* Show edit/delete buttons */}
                                                                                    <div className="flex-gap-sm">
                                                                                        {/* Only Lab notes can be edited */}
                                                                                        {note.note_type === 'Lab' && (
                                                                                            <button
                                                                                                className="action-icon-btn edit btn-compact"
                                                                                                onClick={() => handleStartEditNote(note)}
                                                                                                title="Edit Note"
                                                                                            >
                                                                                                <i className="fas fa-edit"></i>
                                                                                            </button>
                                                                                        )}
                                                                                        {/* All notes can be deleted */}
                                                                                        <button
                                                                                            className="action-icon-btn delete btn-compact"
                                                                                            onClick={() => handleDeleteNote(note.note_id, set.aligner_set_id)}
                                                                                            title="Delete Note"
                                                                                        >
                                                                                            <i className="fas fa-trash"></i>
                                                                                        </button>
                                                                                    </div>
                                                                                </div>
                                                                                <p className={`note-text ${note.is_read === false ? 'font-bold' : 'font-normal'}`}>{note.note_text}</p>
                                                                            </>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Drawers and Dialogs */}
            {showSetDrawer && (
                <SetFormDrawer
                    isOpen={showSetDrawer}
                    onClose={closeSetDrawer}
                    onSave={handleSetSaved}
                    set={editingSet}
                    workId={patient.workid}
                    doctors={doctors}
                    allSets={alignerSets}
                    folderPath={editingSet ? generateFolderPath(editingSet) : null}
                />
            )}

            {showBatchDrawer && (
                <BatchFormDrawer
                    isOpen={showBatchDrawer}
                    onClose={closeBatchDrawer}
                    onSave={handleBatchSaved}
                    batch={editingBatch}
                    set={currentSetForBatch}
                    existingBatches={currentSetForBatch ? (batchesData[currentSetForBatch.aligner_set_id] || []) : []}
                    onUndoManufacture={handleUndoManufactured}
                    onUndoDelivery={handleUndoDelivered}
                />
            )}

            {showPaymentDrawer && (
                <PaymentFormDrawer
                    isOpen={showPaymentDrawer}
                    onClose={() => setShowPaymentDrawer(false)}
                    onSave={handlePaymentSaved}
                    set={currentSetForPayment}
                />
            )}

            <ConfirmDialog
                isOpen={confirmDialog.isOpen}
                title={confirmDialog.title}
                message={confirmDialog.message}
                onConfirm={confirmDialog.onConfirm || (() => {})}
                onCancel={() => setConfirmDialog({ isOpen: false, title: '', message: '', onConfirm: null })}
            />

            {/* Folder Selection Confirmation Dialog */}
            <ConfirmDialog
                isOpen={folderConfirmDialog.isOpen}
                title="Verify Folder Selection"
                message={`You selected folder "${folderConfirmDialog.folderName}". Are you sure this is your Aligner_Sets folder?`}
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

            {viewerPhoto && (
                <div 
                    className="aligner-photo-viewer-overlay" 
                    onClick={() => setViewerPhoto(null)}
                    role="dialog" 
                    aria-modal="true"
                >
                    <button 
                        className="aligner-photo-viewer-close" 
                        onClick={() => setViewerPhoto(null)}
                        aria-label="Close viewer"
                    >
                        <i className="fas fa-times"></i>
                    </button>
                    <div 
                        className="aligner-photo-viewer-content" 
                        onClick={(e) => e.stopPropagation()}
                    >
                        <img 
                            src={viewerPhoto.view_url} 
                            alt={viewerPhoto.file_name} 
                            className="aligner-photo-viewer-image" 
                        />
                        <div className="aligner-photo-viewer-details">
                            <div className="aligner-photo-viewer-filename">{viewerPhoto.file_name}</div>
                            {viewerPhoto.uploaded_at && (
                                <div className="aligner-photo-viewer-meta">
                                    Uploaded: {formatDate(viewerPhoto.uploaded_at)}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// Memoize to prevent unnecessary re-renders
export default React.memo(PatientSets);
