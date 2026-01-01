/**
 * PatientSets - Patient's aligner sets, batches, and notes with full CRUD
 * This page handles both doctor-browse and search routes
 * Memoized to prevent unnecessary re-renders
 */
import React, { useState, useEffect, useRef, ChangeEvent, MouseEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ConfirmDialog from '../../components/react/ConfirmDialog';
import SetFormDrawer from '../../components/react/SetFormDrawer';
import BatchFormDrawer from '../../components/react/BatchFormDrawer';
import PaymentFormDrawer from '../../components/react/PaymentFormDrawer';
import LabelPreviewModal from '../../components/react/LabelPreviewModal';
import { copyToClipboard } from '../../core/utils';
import { useToast } from '../../contexts/ToastContext';
import { usePrintQueue } from '../../contexts/PrintQueueContext';

// Types
interface AlignerDoctor {
    id: number;
    DrID: number;
    name: string;
    DoctorName?: string;
    logoPath?: string | null;
}

interface Patient {
    PersonID: number;
    patientID?: string;
    PatientName?: string;
    FirstName?: string;
    LastName?: string;
    Phone?: string;
    WorkType?: string;
    workid: number;
}

interface AlignerSet {
    AlignerSetID: number;
    SetSequence: number;
    Type?: string;
    UpperAlignersCount: number;
    LowerAlignersCount: number;
    RemainingUpperAligners: number;
    RemainingLowerAligners: number;
    Days?: number;
    AlignerDrID?: number;
    AlignerDoctorName?: string;
    SetUrl?: string;
    SetPdfUrl?: string;
    SetVideo?: string;
    SetCost?: number;
    Currency?: string;
    Notes?: string;
    IsActive: boolean;
    CreationDate?: string;
    TotalBatches?: number;
    DeliveredBatches?: number;
    TotalPaid?: number;
    Balance?: number;
    PaymentStatus?: string;
    UnreadActivityCount?: number;
}

interface AlignerBatch {
    AlignerBatchID: number;
    AlignerSetID: number;
    BatchSequence: number;
    UpperAlignerCount?: number;
    LowerAlignerCount?: number;
    UpperAlignerStartSequence?: number;
    UpperAlignerEndSequence?: number;
    LowerAlignerStartSequence?: number;
    LowerAlignerEndSequence?: number;
    Days?: number;
    ValidityPeriod?: number;
    ManufactureDate?: string | null;
    DeliveredToPatientDate?: string | null;
    NextBatchReadyDate?: string | null;
    Notes?: string;
    CreationDate?: string;
}

interface AlignerNote {
    NoteID: number;
    AlignerSetID: number;
    NoteType: 'Lab' | 'Doctor';
    NoteText: string;
    DoctorName?: string;
    CreatedAt: string;
    IsRead: boolean;
    IsEdited?: boolean;
}

interface ConfirmDialogState {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: (() => void) | null;
}

interface LabelModalData {
    batch: AlignerBatch | null;
    set: AlignerSet | null;
}

// PaymentSaveData matches what PaymentFormDrawer sends
interface PaymentSaveData {
    Amountpaid: number;
    Dateofpayment: string;
    ActualAmount: null;
    ActualCur: string;
    Change: null;
}

interface LabelGenerationData {
    startingPosition: number;
    patientName: string;
    doctorName: string;
    includeLogo: boolean;
    arabicFont: string;
    customLabels: Array<{
        text: string;
        isUpper: boolean;
        sequence: number;
    }>;
}

const PatientSets: React.FC = () => {
    const { doctorId, workId } = useParams<{ doctorId?: string; workId?: string }>();
    const navigate = useNavigate();
    const toast = useToast();
    const { addToQueue, isInQueue, removeByBatchId } = usePrintQueue();

    // Determine if we came from doctor browse or direct search
    const isFromDoctorBrowse = doctorId !== undefined;

    const [patient, setPatient] = useState<Patient | null>(null);
    const [alignerSets, setAlignerSets] = useState<AlignerSet[]>([]);
    const [doctors, setDoctors] = useState<AlignerDoctor[]>([]);
    const [expandedSets, setExpandedSets] = useState<Record<number, boolean>>({});
    const [batchesData, setBatchesData] = useState<Record<number, AlignerBatch[]>>({});
    const [notesData, setNotesData] = useState<Record<number, AlignerNote[]>>({});
    const [expandedCommunication, setExpandedCommunication] = useState<Record<number, boolean>>({});
    const [loading, setLoading] = useState<boolean>(false);

    // CRUD states
    const [showSetDrawer, setShowSetDrawer] = useState<boolean>(false);
    const [editingSet, setEditingSet] = useState<AlignerSet | null>(null);
    const [showBatchDrawer, setShowBatchDrawer] = useState<boolean>(false);
    const [editingBatch, setEditingBatch] = useState<AlignerBatch | null>(null);
    const [currentSetForBatch, setCurrentSetForBatch] = useState<AlignerSet | null>(null);
    const [showPaymentDrawer, setShowPaymentDrawer] = useState<boolean>(false);
    const [currentSetForPayment, setCurrentSetForPayment] = useState<AlignerSet | null>(null);
    const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({ isOpen: false, title: '', message: '', onConfirm: null });

    // Label preview modal state
    const [showLabelModal, setShowLabelModal] = useState<boolean>(false);
    const [labelModalData, setLabelModalData] = useState<LabelModalData>({ batch: null, set: null });
    const [isGeneratingLabels, setIsGeneratingLabels] = useState<boolean>(false);

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

    // Check if we have base directory access on mount
    useEffect(() => {
        checkBaseDirectoryAccess();
    }, []);

    // Load patient and sets on mount
    useEffect(() => {
        loadPatientAndSets();
        loadDoctors();
    }, [workId]);

    const loadDoctors = async (): Promise<void> => {
        try {
            const response = await fetch('/api/aligner/doctors');
            const data = await response.json();

            if (data.success) {
                setDoctors(data.doctors || []);
            }
        } catch (error) {
            console.error('Error loading doctors:', error);
        }
    };

    const loadPatientAndSets = async (): Promise<void> => {
        try {
            setLoading(true);

            // Load patient info from work
            const workResponse = await fetch(`/api/getwork/${workId}`);
            const workData = await workResponse.json();

            if (workData.success && workData.work) {
                const patientResponse = await fetch(`/api/patients/${workData.work.PersonID}`);
                const patientData = await patientResponse.json();

                const patientWithWork: Patient = {
                    ...patientData,
                    workid: parseInt(workId || '0'),
                    WorkType: workData.work.TypeOfWork
                };
                setPatient(patientWithWork);
            }

            // Load aligner sets
            await loadAlignerSets(parseInt(workId || '0'));

        } catch (error) {
            console.error('Error loading patient:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadAlignerSets = async (workIdParam: number): Promise<void> => {
        try {
            const response = await fetch(`/api/aligner/sets/${workIdParam}`);
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to load aligner sets');
            }

            const sets: AlignerSet[] = data.sets || [];
            setAlignerSets(sets);

            // Auto-expand the active set
            const activeSet = sets.find(s => s.IsActive === true);
            if (activeSet) {
                const setId = activeSet.AlignerSetID;
                if (!batchesData[setId]) {
                    await loadBatches(setId);
                }
                if (!notesData[setId]) {
                    await loadNotes(setId, workIdParam);
                }
                setExpandedSets(prev => ({ ...prev, [setId]: true }));
                setExpandedCommunication(prev => ({ ...prev, [setId]: true }));
            }
        } catch (error) {
            console.error('Error loading aligner sets:', error);
            toast.error('Failed to load aligner sets: ' + (error as Error).message);
        }
    };

    const loadBatches = async (setId: number): Promise<void> => {
        try {
            const response = await fetch(`/api/aligner/batches/${setId}`);
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to load batches');
            }

            setBatchesData(prev => ({ ...prev, [setId]: data.batches || [] }));
        } catch (error) {
            console.error('Error loading batches:', error);
            setBatchesData(prev => ({ ...prev, [setId]: [] }));
        }
    };

    const loadNotes = async (setId: number, workIdParam: number, autoMarkRead: boolean = true): Promise<void> => {
        try {
            const response = await fetch(`/api/aligner/notes/${setId}`);
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to load notes');
            }

            setNotesData(prev => ({ ...prev, [setId]: data.notes || [] }));

            // Auto-mark unread doctor notes as read
            if (autoMarkRead) {
                const unreadDoctorNotes = (data.notes || []).filter((note: AlignerNote) =>
                    note.NoteType === 'Doctor' && note.IsRead === false
                );

                if (unreadDoctorNotes.length > 0) {
                    for (const note of unreadDoctorNotes) {
                        await markNoteAsRead(note.NoteID);
                    }
                    await loadNotes(setId, workIdParam, false);
                }
            }
        } catch (error) {
            console.error('Error loading notes:', error);
            setNotesData(prev => ({ ...prev, [setId]: [] }));
        }
    };

    const markNoteAsRead = async (noteId: number): Promise<void> => {
        try {
            // First check current status
            const checkResponse = await fetch(`/api/aligner/notes/${noteId}/status`);
            const checkData = await checkResponse.json();

            // Only toggle if it's currently unread
            if (checkData.success && checkData.isRead === false) {
                await fetch(`/api/aligner/notes/${noteId}/toggle-read`, {
                    method: 'PATCH'
                });
            }
        } catch (error) {
            console.error('Error marking note as read:', error);
        }
    };

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
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    };

    const formatDateTime = (dateString: string | null | undefined): string => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const calculateProgress = (set: AlignerSet): number => {
        const delivered = set.UpperAlignersCount + set.LowerAlignersCount - set.RemainingUpperAligners - set.RemainingLowerAligners;
        const total = set.UpperAlignersCount + set.LowerAlignersCount;
        return total > 0 ? Math.round((delivered / total) * 100) : 0;
    };

    const formatPatientName = (p: Patient | null): string => {
        return p?.PatientName || `${p?.FirstName || ''} ${p?.LastName || ''}`.trim() || 'N/A';
    };

    const generateFolderPath = (set: AlignerSet): string | null => {
        if (!patient || !set) return null;
        const folderPath = `\\\\WORK_PC\\Aligner_Sets\\${set.AlignerDrID}\\${patient.PersonID}\\${set.SetSequence}`;
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

            // Create a temporary link and click it to trigger the protocol handler
            const link = document.createElement('a');
            link.href = explorerUrl;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            // Show success notification
            const notification = document.createElement('div');
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: linear-gradient(135deg, #2563eb, #1d4ed8);
                color: white;
                padding: 1rem 1.5rem;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                z-index: 10000;
                animation: slideIn 0.3s ease-out;
                font-size: 0.95rem;
                max-width: 400px;
            `;
            notification.innerHTML = `
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <i class="fas fa-folder-open" style="font-size: 1.2rem;"></i>
                    <div>
                        <div style="font-weight: 600; margin-bottom: 0.25rem;">Opening folder in Explorer...</div>
                        <div style="font-size: 0.85rem; opacity: 0.9;">${folderPath}</div>
                    </div>
                </div>
            `;

            document.body.appendChild(notification);

            // Remove notification after 3 seconds
            setTimeout(() => {
                notification.style.animation = 'slideOut 0.3s ease-out';
                setTimeout(() => notification.remove(), 300);
            }, 3000);

            // Also copy to clipboard as a fallback
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

    // CRUD Operations
    const openAddSetDrawer = (): void => {
        setEditingSet(null);
        setShowSetDrawer(true);
    };

    const openEditSetDrawer = (set: AlignerSet): void => {
        setEditingSet(set);
        setShowSetDrawer(true);
    };

    const handleSetSaved = (): void => {
        setShowSetDrawer(false);
        setEditingSet(null);
        if (patient) {
            loadAlignerSets(patient.workid);
        }
    };

    const openAddBatchDrawer = (set: AlignerSet): void => {
        setCurrentSetForBatch(set);
        setEditingBatch(null);
        setShowBatchDrawer(true);
    };

    const openEditBatchDrawer = (batch: AlignerBatch, set: AlignerSet): void => {
        setCurrentSetForBatch(set);
        setEditingBatch(batch);
        setShowBatchDrawer(true);
    };

    const handleBatchSaved = (): void => {
        setShowBatchDrawer(false);
        setEditingBatch(null);
        setCurrentSetForBatch(null);
        if (currentSetForBatch) {
            loadBatches(currentSetForBatch.AlignerSetID);
        }
    };

    const openPaymentDrawer = (set: AlignerSet): void => {
        setCurrentSetForPayment(set);
        setShowPaymentDrawer(true);
    };

    const handlePaymentSaved = async (paymentData: PaymentSaveData): Promise<void> => {
        if (!patient || !currentSetForPayment) return;

        const response = await fetch('/api/aligner/payments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                workid: patient.workid,
                AlignerSetID: currentSetForPayment.AlignerSetID,
                Amount: paymentData.Amountpaid,
                PaymentDate: paymentData.Dateofpayment,
                PaymentMethod: 'Cash', // Default method
                ActualAmount: paymentData.ActualAmount,
                ActualCur: paymentData.ActualCur,
                Change: paymentData.Change
            })
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to save payment');
        }

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
            message: `Are you sure you want to delete Set #${set.SetSequence}? This will also delete all associated batches and notes. This action cannot be undone.`,
            onConfirm: async () => {
                try {
                    const response = await fetch(`/api/aligner/sets/${set.AlignerSetID}`, {
                        method: 'DELETE'
                    });
                    const data = await response.json();

                    if (!data.success) {
                        throw new Error(data.error || 'Failed to delete set');
                    }

                    toast.success('Set deleted successfully');
                    if (patient) {
                        loadAlignerSets(patient.workid);
                    }
                } catch (error) {
                    console.error('Error deleting set:', error);
                    toast.error('Failed to delete set: ' + (error as Error).message);
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
            message: `Mark Batch #${batch.BatchSequence} as delivered? This will set the delivery date to today.`,
            onConfirm: async () => {
                try {
                    const response = await fetch(`/api/aligner/batches/${batch.AlignerBatchID}/deliver`, {
                        method: 'PATCH'
                    });
                    const data = await response.json();

                    if (!data.success) {
                        throw new Error(data.error || 'Failed to mark as delivered');
                    }

                    toast.success('Batch marked as delivered');
                    await loadBatches(batch.AlignerSetID);
                    if (patient) {
                        await loadAlignerSets(patient.workid);
                    }
                } catch (error) {
                    console.error('Error marking as delivered:', error);
                    toast.error('Failed to mark as delivered: ' + (error as Error).message);
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
            message: `Mark Batch #${batch.BatchSequence} as manufactured? This will set the manufacture date to today.`,
            onConfirm: async () => {
                try {
                    const response = await fetch(`/api/aligner/batches/${batch.AlignerBatchID}/manufacture`, {
                        method: 'PATCH'
                    });
                    const data = await response.json();

                    if (!data.success) {
                        throw new Error(data.error || 'Failed to mark as manufactured');
                    }

                    toast.success('Batch marked as manufactured');
                    await loadBatches(batch.AlignerSetID);
                    if (patient) {
                        await loadAlignerSets(patient.workid);
                    }
                } catch (error) {
                    console.error('Error marking as manufactured:', error);
                    toast.error('Failed to mark as manufactured: ' + (error as Error).message);
                }
                setConfirmDialog({ isOpen: false, title: '', message: '', onConfirm: null });
            }
        });
    };

    const handleUndoManufactured = async (batch: AlignerBatch, e: MouseEvent<HTMLButtonElement>): Promise<void> => {
        e.stopPropagation();
        const hasDelivery = batch.DeliveredToPatientDate !== null;
        setConfirmDialog({
            isOpen: true,
            title: 'Undo Manufacture?',
            message: `Undo manufacture for Batch #${batch.BatchSequence}?${hasDelivery ? '\n\nWarning: This will also clear the delivery date.' : ''}`,
            onConfirm: async () => {
                try {
                    const response = await fetch(`/api/aligner/batches/${batch.AlignerBatchID}/undo-manufacture`, {
                        method: 'PATCH'
                    });
                    const data = await response.json();

                    if (!data.success) {
                        throw new Error(data.error || 'Failed to undo manufacture');
                    }

                    toast.success('Manufacture undone');
                    await loadBatches(batch.AlignerSetID);
                    if (patient) {
                        await loadAlignerSets(patient.workid);
                    }
                } catch (error) {
                    console.error('Error undoing manufacture:', error);
                    toast.error('Failed to undo manufacture: ' + (error as Error).message);
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
            message: `Undo delivery for Batch #${batch.BatchSequence}?`,
            onConfirm: async () => {
                try {
                    const response = await fetch(`/api/aligner/batches/${batch.AlignerBatchID}/undo-deliver`, {
                        method: 'PATCH'
                    });
                    const data = await response.json();

                    if (!data.success) {
                        throw new Error(data.error || 'Failed to undo delivery');
                    }

                    toast.success('Delivery undone');
                    await loadBatches(batch.AlignerSetID);
                    if (patient) {
                        await loadAlignerSets(patient.workid);
                    }
                } catch (error) {
                    console.error('Error undoing delivery:', error);
                    toast.error('Failed to undo delivery: ' + (error as Error).message);
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
            message: `Are you sure you want to delete Batch #${batch.BatchSequence}? This action cannot be undone.`,
            onConfirm: async () => {
                try {
                    const response = await fetch(`/api/aligner/batches/${batch.AlignerBatchID}`, {
                        method: 'DELETE'
                    });
                    const data = await response.json();

                    if (!data.success) {
                        throw new Error(data.error || 'Failed to delete batch');
                    }

                    toast.success('Batch deleted successfully');
                    await loadBatches(batch.AlignerSetID);
                    if (patient) {
                        await loadAlignerSets(patient.workid);
                    }
                } catch (error) {
                    console.error('Error deleting batch:', error);
                    toast.error('Failed to delete batch: ' + (error as Error).message);
                }
                setConfirmDialog({ isOpen: false, title: '', message: '', onConfirm: null });
            }
        });
    };

    // Open label preview modal
    const handlePrintLabels = (batch: AlignerBatch, set: AlignerSet, e: MouseEvent<HTMLButtonElement>): void => {
        e.stopPropagation();

        if (!patient || !batch.AlignerBatchID) {
            toast.error('Missing required information for printing labels');
            return;
        }

        // Open the modal with batch and set data
        setLabelModalData({ batch, set });
        setShowLabelModal(true);
    };

    // Generate labels from modal data
    const handleGenerateLabels = async (labelData: LabelGenerationData): Promise<void> => {
        const { batch, set } = labelModalData;

        if (!batch || !set) {
            toast.error('Missing batch or set information');
            return;
        }

        // Get the doctor ID from the set's AlignerDrID field
        const doctorIdForLabels = set.AlignerDrID || 1;

        setIsGeneratingLabels(true);

        try {
            toast.info('Generating labels...');

            const response = await fetch('/api/aligner/labels/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    batchId: batch.AlignerBatchID,
                    startingPosition: labelData.startingPosition,
                    patientName: labelData.patientName,
                    doctorName: labelData.doctorName,
                    doctorId: doctorIdForLabels,
                    includeLogo: labelData.includeLogo,
                    arabicFont: labelData.arabicFont,
                    // Pass the custom labels array (fully editable)
                    customLabels: labelData.customLabels
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Failed to generate labels');
            }

            // Get metadata from headers
            const totalLabels = response.headers.get('X-Total-Labels');
            const nextPosition = response.headers.get('X-Next-Position');

            // Convert response to blob and open in new tab
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');

            // Close modal and show success message
            setShowLabelModal(false);
            setLabelModalData({ batch: null, set: null });
            toast.success(`Labels generated! ${totalLabels} labels created. Next position: ${nextPosition}`);
        } catch (error) {
            console.error('Error generating labels:', error);
            toast.error('Failed to generate labels: ' + (error as Error).message);
        } finally {
            setIsGeneratingLabels(false);
        }
    };

    // Close label modal
    const handleCloseLabelModal = (): void => {
        setShowLabelModal(false);
        setLabelModalData({ batch: null, set: null });
    };

    // Handle adding batch to print queue
    const handleToggleQueue = (batch: AlignerBatch, set: AlignerSet, e: MouseEvent<HTMLButtonElement>): void => {
        e.stopPropagation();

        if (!patient || !batch.AlignerBatchID) {
            toast.error('Missing required information');
            return;
        }

        const batchId = batch.AlignerBatchID;

        if (isInQueue(batchId)) {
            removeByBatchId(batchId);
            toast.info('Removed from print queue');
        } else {
            // Find the doctor info
            const doctor = doctors.find(d => d.id === set.AlignerDrID || d.DrID === set.AlignerDrID) || {
                id: set.AlignerDrID || 0,
                name: set.AlignerDoctorName || '',
                logoPath: null
            };

            addToQueue(
                {
                    batchId: batch.AlignerBatchID,
                    batchNumber: batch.BatchSequence,
                    upperStart: batch.UpperAlignerStartSequence || 0,
                    upperEnd: batch.UpperAlignerEndSequence || 0,
                    lowerStart: batch.LowerAlignerStartSequence || 0,
                    lowerEnd: batch.LowerAlignerEndSequence || 0
                },
                {
                    code: patient.patientID || String(patient.PersonID),
                    name: formatPatientName(patient)
                },
                doctor,
                { setId: set.AlignerSetID }
            );
            toast.success('Added to print queue');
        }
    };

    // Quick URL handlers
    const handleStartEditUrl = (set: AlignerSet, e: MouseEvent<HTMLButtonElement>): void => {
        e.stopPropagation();
        setEditingUrlForSet(set.AlignerSetID);
        setQuickUrlValue(set.SetUrl || '');
    };

    const handleCancelEditUrl = (): void => {
        setEditingUrlForSet(null);
        setQuickUrlValue('');
    };

    const handleSaveUrl = async (setId: number): Promise<void> => {
        try {
            setSavingUrl(true);

            // Get current set data
            const currentSet = alignerSets.find(s => s.AlignerSetID === setId);
            if (!currentSet) {
                throw new Error('Set not found');
            }

            // Update the set with new URL
            const response = await fetch(`/api/aligner/sets/${setId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...currentSet,
                    SetUrl: quickUrlValue.trim() || null
                })
            });

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to update URL');
            }

            if (patient) {
                await loadAlignerSets(patient.workid);
            }
            setEditingUrlForSet(null);
            setQuickUrlValue('');

        } catch (error) {
            console.error('Error saving URL:', error);
            toast.error('Failed to save URL: ' + (error as Error).message);
        } finally {
            setSavingUrl(false);
        }
    };

    // File System Access API helpers
    const checkBaseDirectoryAccess = async (): Promise<void> => {
        if (!('showDirectoryPicker' in window)) {
            setHasBaseDirectoryAccess(false);
            return;
        }

        try {
            const baseHandle = await getBaseDirectoryHandle();
            if (baseHandle) {
                const permission = await baseHandle.queryPermission({ mode: 'read' });
                setHasBaseDirectoryAccess(permission === 'granted');
            } else {
                setHasBaseDirectoryAccess(false);
            }
        } catch {
            setHasBaseDirectoryAccess(false);
        }
    };

    const requestBaseDirectoryAccess = async (): Promise<boolean> => {
        if (!('showDirectoryPicker' in window)) {
            toast.warning('Your browser does not support the File System Access API. Please use Chrome or Edge.');
            return false;
        }

        try {
            const dirHandle = await (window as Window & { showDirectoryPicker: (opts?: { mode?: string; startIn?: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({
                mode: 'read',
                startIn: 'desktop'
            });

            // Verify the folder name is correct
            if (dirHandle.name !== 'Aligner_Sets') {
                const confirmed = window.confirm(
                    `You selected folder "${dirHandle.name}". Are you sure this is your Aligner_Sets folder?`
                );
                if (!confirmed) {
                    return false;
                }
            }

            // Save to IndexedDB
            await saveBaseDirectoryHandle(dirHandle);
            setHasBaseDirectoryAccess(true);

            toast.success('Base folder access granted! You can now open PDFs directly in the correct folders.');
            return true;
        } catch (error) {
            if ((error as Error).name !== 'AbortError') {
                console.error('Error requesting directory access:', error);
                toast.error('Failed to get directory access: ' + (error as Error).message);
            }
            return false;
        }
    };

    const getBaseDirectoryHandle = async (): Promise<FileSystemDirectoryHandle | undefined> => {
        const db = await openDirectoryDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['directories'], 'readonly');
            const store = transaction.objectStore('directories');
            const request = store.get('base_aligner_sets');

            request.onsuccess = () => resolve(request.result?.handle);
            request.onerror = () => reject(request.error);
        });
    };

    const saveBaseDirectoryHandle = async (handle: FileSystemDirectoryHandle): Promise<void> => {
        const db = await openDirectoryDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['directories'], 'readwrite');
            const store = transaction.objectStore('directories');
            const request = store.put({ key: 'base_aligner_sets', handle, timestamp: Date.now() });

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    };

    const openDirectoryDB = (): Promise<IDBDatabase> => {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('AlignerDirectoryHandles', 1);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains('directories')) {
                    db.createObjectStore('directories', { keyPath: 'key' });
                }
            };
        });
    };

    const navigateToSetFolder = async (
        baseHandle: FileSystemDirectoryHandle,
        drId: number,
        personId: number,
        setSequence: number
    ): Promise<FileSystemDirectoryHandle | null> => {
        try {
            // Navigate: Aligner_Sets/{DoctorID}/{PersonID}/{SetSequence}
            const doctorHandle = await baseHandle.getDirectoryHandle(drId.toString(), { create: false });
            const personHandle = await doctorHandle.getDirectoryHandle(personId.toString(), { create: false });
            const setHandle = await personHandle.getDirectoryHandle(setSequence.toString(), { create: false });
            return setHandle;
        } catch (error) {
            console.error('Error navigating to folder:', error);
            return null;
        }
    };

    // Quick PDF URL handlers
    const handleStartEditPdfUrl = async (set: AlignerSet, e: MouseEvent<HTMLButtonElement>): Promise<void> => {
        e.stopPropagation();

        // Check if File System Access API is supported
        if (!('showOpenFilePicker' in window)) {
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
            // Get base directory handle
            const baseHandle = await getBaseDirectoryHandle();
            if (!baseHandle) {
                fallbackToFileInput(set);
                return;
            }

            // Verify we still have permission
            let permission = await baseHandle.queryPermission({ mode: 'read' });
            if (permission !== 'granted') {
                permission = await baseHandle.requestPermission({ mode: 'read' });
                if (permission !== 'granted') {
                    setHasBaseDirectoryAccess(false);
                    fallbackToFileInput(set);
                    return;
                }
            }

            // Navigate to the specific set folder
            const setFolderHandle = await navigateToSetFolder(
                baseHandle,
                set.AlignerDrID || 0,
                patient?.PersonID || 0,
                set.SetSequence
            );

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

            await handlePdfUpload(set.AlignerSetID, file);

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
            fileInputRef.current.dataset.setId = String(set.AlignerSetID);
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

            const response = await fetch(`/api/aligner/sets/${setId}/upload-pdf`, {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to upload PDF');
            }

            // Show success message
            toast.success('PDF uploaded successfully!');

            // Reload aligner sets to show updated PDF
            if (patient) {
                await loadAlignerSets(patient.workid);
            }

        } catch (error) {
            console.error('Error uploading PDF:', error);
            toast.error('Failed to upload PDF: ' + (error as Error).message);
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
            const currentSet = alignerSets.find(s => s.AlignerSetID === setId);
            if (!currentSet) {
                throw new Error('Set not found');
            }

            // Update the set with new PDF URL
            const response = await fetch(`/api/aligner/sets/${setId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...currentSet,
                    SetPdfUrl: quickPdfUrlValue.trim() || null
                })
            });

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to update PDF URL');
            }

            if (patient) {
                await loadAlignerSets(patient.workid);
            }
            setEditingPdfUrlForSet(null);
            setQuickPdfUrlValue('');

        } catch (error) {
            console.error('Error saving PDF URL:', error);
            toast.error('Failed to save PDF URL: ' + (error as Error).message);
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
        setEditingVideoForSet(set.AlignerSetID);
        setQuickVideoValue(set.SetVideo || '');
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

            const currentSet = alignerSets.find(s => s.AlignerSetID === setId);
            if (!currentSet) {
                throw new Error('Set not found');
            }

            const response = await fetch(`/api/aligner/sets/${setId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...currentSet,
                    SetVideo: quickVideoValue.trim() || null
                })
            });

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to update video URL');
            }

            if (patient) {
                await loadAlignerSets(patient.workid);
            }
            setEditingVideoForSet(null);
            setQuickVideoValue('');

        } catch (error) {
            console.error('Error saving video URL:', error);
            toast.error('Failed to save video URL: ' + (error as Error).message);
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
            const response = await fetch('/api/aligner/notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    AlignerSetID: setId,
                    NoteType: 'Lab',
                    NoteText: labNoteText.trim()
                })
            });

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to add note');
            }

            setLabNoteText('');
            setShowAddLabNote(prev => ({ ...prev, [setId]: false }));
            await loadNotes(setId, patient?.workid || 0, false);

        } catch (error) {
            console.error('Error adding note:', error);
            toast.error('Failed to add note: ' + (error as Error).message);
        }
    };

    const handleStartEditNote = (note: AlignerNote): void => {
        setEditingNoteId(note.NoteID);
        setEditNoteText(note.NoteText);
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
            const response = await fetch(`/api/aligner/notes/${noteId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    NoteText: editNoteText.trim()
                })
            });

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to update note');
            }

            setEditingNoteId(null);
            setEditNoteText('');
            await loadNotes(setId, patient?.workid || 0, false);

        } catch (error) {
            console.error('Error updating note:', error);
            toast.error('Failed to update note: ' + (error as Error).message);
        }
    };

    const handleToggleNoteRead = async (noteId: number, setId: number): Promise<void> => {
        try {
            const response = await fetch(`/api/aligner/notes/${noteId}/toggle-read`, {
                method: 'PATCH'
            });
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to toggle note read status');
            }

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
                    const response = await fetch(`/api/aligner/notes/${noteId}`, {
                        method: 'DELETE'
                    });
                    const data = await response.json();

                    if (!data.success) {
                        throw new Error(data.error || 'Failed to delete note');
                    }

                    await loadNotes(setId, patient?.workid || 0, false);

                } catch (error) {
                    console.error('Error deleting note:', error);
                    toast.error('Failed to delete note: ' + (error as Error).message);
                }
                setConfirmDialog({ isOpen: false, title: '', message: '', onConfirm: null });
            }
        });
    };

    if (loading) {
        return (
            <div className="aligner-container">
                <div className="loading-container">
                    <div className="spinner"></div>
                    <p>Loading patient sets...</p>
                </div>
            </div>
        );
    }

    if (!patient) {
        return (
            <div className="aligner-container">
                <div className="error-container">
                    <i className="fas fa-exclamation-triangle"></i>
                    <h2>Patient Not Found</h2>
                    <button onClick={backToList} className="btn-primary">
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
                className="hidden-file-input"
            />

            {/* Upload Progress Overlay */}
            {uploadingPdf && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0, 0, 0, 0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 9999
                }}>
                    <div style={{
                        background: 'white',
                        padding: '2rem 3rem',
                        borderRadius: '12px',
                        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '1.5rem'
                    }}>
                        <div style={{
                            width: '60px',
                            height: '60px',
                            border: '4px solid #e5e7eb',
                            borderTop: '4px solid #2563eb',
                            borderRadius: '50%',
                            animation: 'spin 1s linear infinite'
                        }}></div>
                        <div style={{
                            fontSize: '1.25rem',
                            fontWeight: '600',
                            color: '#1f2937'
                        }}>
                            Uploading PDF...
                        </div>
                        <div style={{
                            fontSize: '0.875rem',
                            color: '#6b7280'
                        }}>
                            Please wait while your file is being uploaded
                        </div>
                    </div>
                </div>
            )}

            {/* Breadcrumb */}
            <div className="breadcrumb">
                <button onClick={backToList} className="breadcrumb-link">
                    <i className="fas fa-arrow-left"></i>
                    Back to {isFromDoctorBrowse ? 'Patients' : 'Search'}
                </button>
            </div>

            {/* Patient Info Header */}
            <div className="patient-info">
                <div className="patient-header">
                    <div className="patient-details">
                        <h2>
                            {formatPatientName(patient)}
                            {patient.PatientName && patient.FirstName && (
                                <span className="patient-subtitle">
                                    ({patient.FirstName} {patient.LastName})
                                </span>
                            )}
                        </h2>
                        <div className="patient-meta">
                            <span><i className="fas fa-id-card"></i> {patient.patientID || 'N/A'}</span>
                            <span><i className="fas fa-phone"></i> {patient.Phone || 'N/A'}</span>
                            <span><i className="fas fa-tooth"></i> {patient.WorkType}</span>
                        </div>
                    </div>
                    <div className="fs-access-container">
                        {/* File System Access Status */}
                        {'showDirectoryPicker' in window && (
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                padding: '0.5rem 1rem',
                                background: hasBaseDirectoryAccess ? '#d1fae5' : '#fee2e2',
                                borderRadius: '6px',
                                fontSize: '0.875rem'
                            }}>
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
                            className="btn-add-set bg-success"
                            onClick={() => navigate(`/patient/${patient.PersonID}/edit-patient`)}
                        >
                            <i className="fas fa-edit"></i>
                            Edit Patient
                        </button>
                        <button
                            className="btn-add-set bg-info"
                            onClick={() => navigate(`/patient/${patient.PersonID}/new-work?workId=${patient.workid}`)}
                        >
                            <i className="fas fa-tooth"></i>
                            Edit Work
                        </button>
                        <button className="btn-add-set" onClick={openAddSetDrawer}>
                            <i className="fas fa-plus"></i>
                            Add New Set
                        </button>
                    </div>
                </div>
            </div>

            {/* Aligner Sets - Complete rendering */}
            <div className="aligner-sets-container">
                <div className="section-header">
                    <h3>Aligner Sets</h3>
                    <div className="section-info">
                        <span>{alignerSets.length} set{alignerSets.length !== 1 ? 's' : ''}</span>
                    </div>
                </div>

                {loading ? (
                    <div className="loading">
                        <div className="spinner"></div>
                        <p>Loading aligner sets...</p>
                    </div>
                ) : alignerSets.length === 0 ? (
                    <div className="empty-state">
                        <i className="fas fa-inbox"></i>
                        <p>No aligner sets found for this patient</p>
                    </div>
                ) : (
                    <div className="aligner-sets">
                        {alignerSets.map((set) => {
                            const progress = calculateProgress(set);
                            const delivered = set.UpperAlignersCount + set.LowerAlignersCount - set.RemainingUpperAligners - set.RemainingLowerAligners;
                            const total = set.UpperAlignersCount + set.LowerAlignersCount;

                            return (
                                <div key={set.AlignerSetID} className={`aligner-set-card ${set.IsActive ? 'active' : 'inactive'} ${(set.UnreadActivityCount || 0) > 0 ? 'has-activity' : ''}`}>
                                    {/* Activity Banner */}
                                    {(set.UnreadActivityCount || 0) > 0 && (
                                        <div className="activity-banner">
                                            <i className="fas fa-bell"></i>
                                            <strong>{set.UnreadActivityCount}</strong> new {set.UnreadActivityCount === 1 ? 'update' : 'updates'} from doctor
                                        </div>
                                    )}

                                    <div className="set-header" onClick={() => toggleBatches(set.AlignerSetID)}>
                                        <div className="set-title">
                                            <h4>
                                                Set #{set.SetSequence}
                                                <span className={`set-badge ${set.IsActive ? 'active' : 'inactive'}`}>
                                                    {set.IsActive ? 'Active' : 'Inactive'}
                                                </span>
                                                {set.Type && <span className="set-type">{set.Type}</span>}
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
                                            {set.SetPdfUrl && (
                                                <button
                                                    className="pdf-btn"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        window.open(set.SetPdfUrl, '_blank');
                                                    }}
                                                    title={set.SetPdfUrl}
                                                >
                                                    <i className="fas fa-file-pdf"></i>
                                                    <span>View PDF</span>
                                                </button>
                                            )}
                                            {set.SetVideo && (
                                                <button
                                                    className="video-btn bg-error"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        window.open(set.SetVideo, '_blank');
                                                    }}
                                                    title="Watch case explanation video"
                                                >
                                                    <i className="fab fa-youtube"></i>
                                                    <span>Case Video</span>
                                                </button>
                                            )}
                                            {set.SetCost && (set.Balance || 0) > 0 && (
                                                <button
                                                    className="payment-btn"
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
                                                className="delete-set-btn"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDeleteSet(set, e);
                                                }}
                                                title="Delete Set"
                                            >
                                                <i className="fas fa-trash"></i>
                                                <span>Delete</span>
                                            </button>
                                            <button className={`toggle-batches-btn ${expandedSets[set.AlignerSetID] ? 'expanded' : ''}`}>
                                                <span>View Batches ({set.TotalBatches})</span>
                                                <i className="fas fa-chevron-down"></i>
                                            </button>
                                        </div>
                                    </div>

                                    <div className="set-info">
                                        <div className="set-info-item">
                                            <i className="fas fa-teeth"></i>
                                            <span>Upper: <strong>{set.UpperAlignersCount}</strong></span>
                                        </div>
                                        <div className="set-info-item">
                                            <i className="fas fa-teeth"></i>
                                            <span>Lower: <strong>{set.LowerAlignersCount}</strong></span>
                                        </div>
                                        <div className="set-info-item">
                                            <i className="fas fa-box-open"></i>
                                            <span>Remaining Upper: <strong>{set.RemainingUpperAligners}</strong></span>
                                        </div>
                                        <div className="set-info-item">
                                            <i className="fas fa-box-open"></i>
                                            <span>Remaining Lower: <strong>{set.RemainingLowerAligners}</strong></span>
                                        </div>
                                        <div className="set-info-item">
                                            <i className="fas fa-calendar"></i>
                                            <span>Created: <strong>{formatDate(set.CreationDate)}</strong></span>
                                        </div>
                                        <div className="set-info-item">
                                            <i className="fas fa-clock"></i>
                                            <span>Days: <strong>{set.Days || 'N/A'}</strong></span>
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
                                            <span>Cost: <strong>{set.SetCost ? `${set.SetCost} ${set.Currency || 'USD'}` : 'Not set'}</strong></span>
                                        </div>
                                        {set.SetCost && (
                                            <>
                                                <div className="set-info-item">
                                                    <i className="fas fa-money-bill-wave"></i>
                                                    <span>Paid: <strong>{set.TotalPaid || 0} {set.Currency || 'USD'}</strong></span>
                                                </div>
                                                <div className="set-info-item">
                                                    <i className="fas fa-balance-scale"></i>
                                                    <span>Balance: <strong>{set.Balance || set.SetCost} {set.Currency || 'USD'}</strong></span>
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
                                                Set URL: {editingUrlForSet === set.AlignerSetID ? (
                                                    <div className="inline-buttons-container">
                                                        <input
                                                            type="url"
                                                            value={quickUrlValue}
                                                            onChange={(e: ChangeEvent<HTMLInputElement>) => setQuickUrlValue(e.target.value)}
                                                            placeholder="https://..."
                                                            className="url-input-inline"
                                                            autoFocus
                                                            onClick={(e: MouseEvent) => e.stopPropagation()}
                                                        />
                                                    </div>
                                                ) : set.SetUrl ? (
                                                    <a href={set.SetUrl} target="_blank" rel="noopener noreferrer" className="url-link">
                                                        {set.SetUrl}
                                                    </a>
                                                ) : (
                                                    <em className="url-not-set">Not set</em>
                                                )}
                                            </span>
                                            {editingUrlForSet === set.AlignerSetID ? (
                                                <div className="flex-gap-sm">
                                                    <button
                                                        className="action-icon-btn edit btn-small"
                                                        onClick={(e: MouseEvent<HTMLButtonElement>) => {
                                                            e.stopPropagation();
                                                            handleSaveUrl(set.AlignerSetID);
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
                                                    title={set.SetUrl ? "Edit URL" : "Add URL"}
                                                >
                                                    <i className={set.SetUrl ? "fas fa-edit" : "fas fa-plus"}></i>
                                                </button>
                                            )}
                                        </div>
                                        <div className="set-info-item grid-col-full-flex">
                                            <i className="fas fa-file-pdf"></i>
                                            <span className="flex-1">
                                                PDF URL: {editingPdfUrlForSet === set.AlignerSetID ? (
                                                    <div className="inline-buttons-container">
                                                        <input
                                                            type="url"
                                                            value={quickPdfUrlValue}
                                                            onChange={(e: ChangeEvent<HTMLInputElement>) => setQuickPdfUrlValue(e.target.value)}
                                                            placeholder="https://..."
                                                            className="url-input-inline"
                                                            autoFocus
                                                            onClick={(e: MouseEvent) => e.stopPropagation()}
                                                        />
                                                    </div>
                                                ) : set.SetPdfUrl ? (
                                                    <a href={set.SetPdfUrl} target="_blank" rel="noopener noreferrer" className="url-link">
                                                        {set.SetPdfUrl}
                                                    </a>
                                                ) : (
                                                    <em className="url-not-set">Not set</em>
                                                )}
                                            </span>
                                            {editingPdfUrlForSet === set.AlignerSetID ? (
                                                <div className="flex-gap-sm">
                                                    <button
                                                        className="action-icon-btn edit btn-small"
                                                        onClick={(e: MouseEvent<HTMLButtonElement>) => {
                                                            e.stopPropagation();
                                                            handleSavePdfUrl(set.AlignerSetID);
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
                                                <button
                                                    className="action-icon-btn edit btn-medium"
                                                    onClick={(e: MouseEvent<HTMLButtonElement>) => handleStartEditPdfUrl(set, e)}
                                                    title={set.SetPdfUrl ? "Edit PDF URL" : "Add PDF URL"}
                                                    disabled={uploadingPdf}
                                                >
                                                    {uploadingPdf ? (
                                                        <i className="fas fa-spinner fa-spin"></i>
                                                    ) : (
                                                        <i className={set.SetPdfUrl ? "fas fa-edit" : "fas fa-plus"}></i>
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                        <div className="set-info-item grid-col-full-flex">
                                            <i className="fas fa-video"></i>
                                            <span className="flex-1">
                                                Case Video: {editingVideoForSet === set.AlignerSetID ? (
                                                    <div className="inline-buttons-container">
                                                        <input
                                                            type="url"
                                                            value={quickVideoValue}
                                                            onChange={(e: ChangeEvent<HTMLInputElement>) => setQuickVideoValue(e.target.value)}
                                                            placeholder="https://youtube.com/watch?v=..."
                                                            className="url-input-inline"
                                                            autoFocus
                                                            onClick={(e: MouseEvent) => e.stopPropagation()}
                                                        />
                                                    </div>
                                                ) : set.SetVideo ? (
                                                    <a href={set.SetVideo} target="_blank" rel="noopener noreferrer" className="video-link-youtube">
                                                        <i className="fab fa-youtube icon-gap-xs"></i>
                                                        Watch Case Video
                                                    </a>
                                                ) : (
                                                    <em className="url-not-set">Not set</em>
                                                )}
                                            </span>
                                            {editingVideoForSet === set.AlignerSetID ? (
                                                <div className="flex-gap-sm">
                                                    <button
                                                        className="action-icon-btn edit btn-small"
                                                        onClick={(e: MouseEvent<HTMLButtonElement>) => {
                                                            e.stopPropagation();
                                                            handleSaveVideo(set.AlignerSetID);
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
                                                    title={set.SetVideo ? "Edit Video URL" : "Add Video URL"}
                                                >
                                                    <i className={set.SetVideo ? "fas fa-edit" : "fas fa-plus"}></i>
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {set.Notes && (
                                        <div className="set-info-item">
                                            <i className="fas fa-sticky-note"></i>
                                            <span>Notes: {set.Notes}</span>
                                        </div>
                                    )}

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
                                    {expandedSets[set.AlignerSetID] && (
                                        <div className="batches-container expanded">
                                            <div className="batches-header">
                                                <h5>Batches</h5>
                                                <button
                                                    className="add-batch-btn"
                                                    onClick={() => openAddBatchDrawer(set)}
                                                    disabled={!set.IsActive}
                                                    title={!set.IsActive ? 'Cannot add batches to inactive sets' : 'Add new batch'}
                                                >
                                                    <i className="fas fa-plus"></i> Add Batch
                                                </button>
                                            </div>
                                            {!batchesData[set.AlignerSetID] ? (
                                                <div className="loading">
                                                    <div className="spinner"></div>
                                                    <p>Loading batches...</p>
                                                </div>
                                            ) : batchesData[set.AlignerSetID].length === 0 ? (
                                                <p className="empty-state">No batches found for this set</p>
                                            ) : (
                                                batchesData[set.AlignerSetID].map((batch) => {
                                                    const isManufactured = batch.ManufactureDate !== null;
                                                    const isDelivered = batch.DeliveredToPatientDate !== null;
                                                    // Three states: pending-manufacture, pending-delivery, delivered
                                                    const batchState = !isManufactured ? 'pending-manufacture'
                                                        : !isDelivered ? 'pending-delivery'
                                                        : 'delivered';
                                                    const batchStateLabel = !isManufactured ? 'Pending Manufacture'
                                                        : !isDelivered ? 'Pending Delivery'
                                                        : 'Delivered';
                                                    return (
                                                        <div key={batch.AlignerBatchID} className={`batch-item ${batchState}`}>
                                                            <div className="batch-header">
                                                                <div className="batch-title">Batch #{batch.BatchSequence}</div>
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
                                                                        className={`action-icon-btn queue-labels ${isInQueue(batch.AlignerBatchID) ? 'in-queue' : ''}`}
                                                                        onClick={(e: MouseEvent<HTMLButtonElement>) => handleToggleQueue(batch, set, e)}
                                                                        title={isInQueue(batch.AlignerBatchID) ? 'Remove from print queue' : 'Add to print queue'}
                                                                    >
                                                                        <i className={isInQueue(batch.AlignerBatchID) ? 'fas fa-check' : 'fas fa-cart-plus'}></i>
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
                                                                    <span>Upper: {batch.UpperAlignerStartSequence}-{batch.UpperAlignerEndSequence} ({batch.UpperAlignerCount})</span>
                                                                </div>
                                                                <div className="batch-detail">
                                                                    <i className="fas fa-teeth"></i>
                                                                    <span>Lower: {batch.LowerAlignerStartSequence}-{batch.LowerAlignerEndSequence} ({batch.LowerAlignerCount})</span>
                                                                </div>
                                                                {batch.CreationDate && (
                                                                    <div className="batch-detail">
                                                                        <i className="fas fa-plus-circle"></i>
                                                                        <span>Created: {formatDate(batch.CreationDate)}</span>
                                                                    </div>
                                                                )}
                                                                <div className="batch-detail">
                                                                    <i className="fas fa-industry"></i>
                                                                    <span>Manufactured: {batch.ManufactureDate ? formatDate(batch.ManufactureDate) : 'Not yet'}</span>
                                                                </div>
                                                                {isDelivered && (
                                                                    <div className="batch-detail">
                                                                        <i className="fas fa-truck"></i>
                                                                        <span>Delivered: {formatDate(batch.DeliveredToPatientDate)}</span>
                                                                    </div>
                                                                )}
                                                                <div className="batch-detail">
                                                                    <i className="fas fa-clock"></i>
                                                                    <span>Days: {batch.Days || 'N/A'}</span>
                                                                </div>
                                                                <div className="batch-detail">
                                                                    <i className="fas fa-hourglass-half"></i>
                                                                    <span>Validity: {batch.ValidityPeriod || 'N/A'} days</span>
                                                                </div>
                                                                {batch.NextBatchReadyDate && (
                                                                    <div className="batch-detail">
                                                                        <i className="fas fa-calendar-check"></i>
                                                                        <span>Next Batch: {formatDate(batch.NextBatchReadyDate)}</span>
                                                                    </div>
                                                                )}
                                                                {batch.Notes && (
                                                                    <div className="batch-detail batch-detail-full">
                                                                        <i className="fas fa-sticky-note"></i>
                                                                        <span>Notes: {batch.Notes}</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    )}

                                    {/* Communication Section */}
                                    <div className="communication-section">
                                        <button
                                            className={`communication-toggle-btn ${expandedCommunication[set.AlignerSetID] ? 'expanded' : ''}`}
                                            onClick={() => toggleCommunication(set.AlignerSetID)}
                                        >
                                            <i className="fas fa-comments"></i>
                                            <span>Communication with Doctor</span>
                                            <i className="fas fa-chevron-down"></i>
                                        </button>

                                        {expandedCommunication[set.AlignerSetID] && (
                                            <div className="communication-content expanded">
                                                {!notesData[set.AlignerSetID] ? (
                                                    <div className="loading">
                                                        <div className="spinner"></div>
                                                        <p>Loading communication...</p>
                                                    </div>
                                                ) : (
                                                    <>
                                                        {/* Add Note Form */}
                                                        <div className="add-note-section">
                                                            {!showAddLabNote[set.AlignerSetID] ? (
                                                                <button
                                                                    className="add-batch-btn btn-auto-width"
                                                                    onClick={() => setShowAddLabNote(prev => ({ ...prev, [set.AlignerSetID]: true }))}
                                                                >
                                                                    <i className="fas fa-plus"></i> Send Note to Doctor
                                                                </button>
                                                            ) : (
                                                                <div className="note-form">
                                                                    <textarea
                                                                        className="note-textarea note-textarea-input"
                                                                        placeholder="Type your message to the doctor..."
                                                                        value={labNoteText}
                                                                        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setLabNoteText(e.target.value)}
                                                                    />
                                                                    <div className="flex-justify-end">
                                                                        <button
                                                                            className="btn-cancel btn-sm-icon"
                                                                            onClick={() => {
                                                                                setShowAddLabNote(prev => ({ ...prev, [set.AlignerSetID]: false }));
                                                                                setLabNoteText('');
                                                                            }}
                                                                        >
                                                                            Cancel
                                                                        </button>
                                                                        <button
                                                                            className="add-batch-btn btn-auto-width"
                                                                            onClick={() => handleAddLabNote(set.AlignerSetID)}
                                                                        >
                                                                            <i className="fas fa-paper-plane"></i> Send Note
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>

                                                        {/* Notes Timeline */}
                                                        {notesData[set.AlignerSetID].length === 0 ? (
                                                            <div className="empty-communication">
                                                                <i className="fas fa-inbox"></i>
                                                                <p>No messages yet</p>
                                                                <p className="hint">Communication between doctor and lab will appear here</p>
                                                            </div>
                                                        ) : (
                                                            <div className="notes-timeline">
                                                                {notesData[set.AlignerSetID].map((note) => (
                                                                    <div key={note.NoteID} className={`note-item ${note.NoteType === 'Lab' ? 'lab-note' : 'doctor-note'}`}>
                                                                        {editingNoteId === note.NoteID ? (
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
                                                                                        onClick={() => saveEditNote(note.NoteID, set.AlignerSetID)}
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
                                                                                        <label className="note-checkbox-label">
                                                                                            <input
                                                                                                type="checkbox"
                                                                                                checked={note.IsRead !== false}
                                                                                                onChange={() => handleToggleNoteRead(note.NoteID, set.AlignerSetID)}
                                                                                                className="note-checkbox"
                                                                                                title={note.IsRead !== false ? 'Mark as unread' : 'Mark as read'}
                                                                                            />
                                                                                        </label>
                                                                                        <div className={`note-author ${note.NoteType === 'Lab' ? 'lab' : 'doctor'} ${note.IsRead === false ? 'font-bold' : 'font-normal'}`}>
                                                                                            <i className={note.NoteType === 'Lab' ? 'fas fa-flask' : 'fas fa-user-md'}></i>
                                                                                            {note.NoteType === 'Lab' ? 'Shwan Lab' : `Dr. ${note.DoctorName}`}
                                                                                        </div>
                                                                                        <div className="note-date">
                                                                                            {formatDateTime(note.CreatedAt)}
                                                                                            {note.IsEdited && ' (edited)'}
                                                                                        </div>
                                                                                    </div>
                                                                                    {/* Show edit/delete buttons */}
                                                                                    <div className="flex-gap-sm">
                                                                                        {/* Only Lab notes can be edited */}
                                                                                        {note.NoteType === 'Lab' && (
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
                                                                                            onClick={() => handleDeleteNote(note.NoteID, set.AlignerSetID)}
                                                                                            title="Delete Note"
                                                                                        >
                                                                                            <i className="fas fa-trash"></i>
                                                                                        </button>
                                                                                    </div>
                                                                                </div>
                                                                                <p className={`note-text ${note.IsRead === false ? 'font-bold' : 'font-normal'}`}>{note.NoteText}</p>
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
                    onClose={() => setShowSetDrawer(false)}
                    onSave={handleSetSaved}
                    set={editingSet}
                    workId={patient.workid}
                    doctors={doctors}
                    allSets={alignerSets}
                    defaultDoctorId={doctorId}
                    folderPath={editingSet ? generateFolderPath(editingSet) : null}
                />
            )}

            {showBatchDrawer && (
                <BatchFormDrawer
                    isOpen={showBatchDrawer}
                    onClose={() => setShowBatchDrawer(false)}
                    onSave={handleBatchSaved}
                    batch={editingBatch}
                    set={currentSetForBatch}
                    existingBatches={currentSetForBatch ? (batchesData[currentSetForBatch.AlignerSetID] || []) : []}
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

            {/* Label Preview Modal - handles generation internally */}
            <LabelPreviewModal
                isOpen={showLabelModal}
                onClose={handleCloseLabelModal}
                batch={labelModalData.batch}
                set={labelModalData.set}
                patient={patient}
                doctorName={labelModalData.set?.AlignerDoctorName}
                isGenerating={isGeneratingLabels}
            />
        </div>
    );
};

// Memoize to prevent unnecessary re-renders
export default React.memo(PatientSets);
