/**
 * LabelPreviewModal - Modal for previewing and editing aligner labels before printing
 *
 * Works in two modes:
 * - Single batch mode: Opened from PatientSets with a specific batch
 * - Queue mode: Opened from PrintQueueIndicator with multiple batches
 *
 * Both modes use the same rich label format for consistency.
 *
 * @module LabelPreviewModal
 */
import { useState, useMemo, useCallback, useRef } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../contexts/ToastContext';
import { groupByPatient, type PatientGroupOf, type PrintQueueItem } from '../../contexts/PrintQueueContext';
import { prefetchCsrfToken } from '../../core/http';
import { qk } from '../../query/keys';
import { alignerLabelSettingsQuery } from '../../query/queries';
import { buildLabelsFromRanges, doctorLabel, type AlignerLabel } from '../../utils/aligner-labels';
import Modal from './Modal';
import ModalHeader from './ModalHeader';
import styles from './LabelPreviewModal.module.css';
import { PDF_ARABIC_FONTS, DEFAULT_PDF_ARABIC_FONT, type PdfArabicFont } from '@shared/pdf-fonts';

const LABELS_PER_SHEET = 12;

/** The server's own request timeout; a PDF that takes longer is not coming. */
const GENERATE_TIMEOUT_MS = 30_000;

const NO_LOGO_HINT = 'Upload a clinic logo (PNG or JPEG) in Settings → General to print it on labels.';

type Label = AlignerLabel;

interface LabelBatch {
    batch_sequence?: number;
    upper_aligner_start_sequence?: number | null;
    upper_aligner_end_sequence?: number | null;
    lower_aligner_start_sequence?: number | null;
    lower_aligner_end_sequence?: number | null;
}

interface LabelSet {
    set_sequence?: number | null;
}

interface LabelPatient {
    patient_name?: string;
    first_name?: string;
    last_name?: string;
}

/** A queued batch as this modal edits it: the context's item + its labels and logo choice as queued (for Reset and the unsaved guard). */
interface QueueBatch extends PrintQueueItem {
    originalLabels: string[];
    originalIncludeLogo: boolean;
}

/** What the single-batch form was seeded with — the unsaved guard compares against it. */
interface SingleSeed {
    patientName: string;
    doctorName: string;
    labels: string;
}

interface QueueStats {
    batchCount: number;
    patientCount: number;
    totalLabels: number;
}

interface RichLabel {
    text: string;
    patientName: string;
    doctorName: string;
    includeLogo: boolean;
}

interface LabelPreviewModalProps {
    // Single batch mode props
    isOpen?: boolean;
    onClose?: () => void;
    batch?: LabelBatch | null;
    set?: LabelSet | null;
    patient?: LabelPatient | null;
    doctorName?: string;
    // Queue mode props
    queueMode?: boolean;
    queuedItems?: PrintQueueItem[];
    onQueuePrintSuccess?: () => void;
}

/**
 * Calculate pages needed and next position
 */
function calculateStats(totalLabels: number, startingPosition: number): { pages: number; nextPosition: number } {
    if (totalLabels === 0) return { pages: 0, nextPosition: startingPosition };

    const availableFirstPage = LABELS_PER_SHEET - startingPosition + 1;
    const pages = totalLabels <= availableFirstPage
        ? 1
        : 1 + Math.ceil((totalLabels - availableFirstPage) / LABELS_PER_SHEET);

    const finalPosition = startingPosition + totalLabels - 1;
    const nextPosition = (finalPosition % LABELS_PER_SHEET) + 1;

    return { pages, nextPosition };
}

/**
 * Determine label type from text
 */
function getLabelType(text: string): 'U' | 'L' | 'UL' | 'custom' {
    if (text.includes('/')) return 'UL';
    if (text.toUpperCase().startsWith('U')) return 'U';
    if (text.toUpperCase().startsWith('L')) return 'L';
    return 'custom';
}

/** The label texts as one comparable string. */
const joinLabels = (labels: readonly string[]): string => labels.join('\n');

/** The file name the server gave the PDF (Content-Disposition), for the download fallback. */
function pdfFileName(response: Response): string {
    const match = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '');
    return match?.[1] ?? 'Labels.pdf';
}

const LabelPreviewModal = ({
    // Single batch mode props
    isOpen = false,
    onClose,
    batch,
    set,
    patient,
    doctorName: initialDoctorName = '',
    // Queue mode props
    queueMode = false,
    queuedItems = [],
    onQueuePrintSuccess
}: LabelPreviewModalProps) => {
    const toast = useToast();
    const queryClient = useQueryClient();

    // Determine if modal should show
    const isModalOpen = queueMode ? queuedItems.length > 0 : isOpen;

    // Where the last print ended on the sheet, and whether a logo can print. Always
    // stale, and enabled only while open, so every opening re-reads it (another
    // workstation may have printed since).
    const { data: labelSettings } = useQuery({ ...alignerLabelSettingsQuery(), enabled: isModalOpen });
    const logoAvailable = labelSettings?.logo === true;

    // Shared state. `null` = the stored next position (FE-F20-5: every print used to
    // start at 1, so a part-used sheet was printed over); a click picks another.
    const [chosenPosition, setStartingPosition] = useState<number | null>(null);
    const startingPosition = chosenPosition ?? labelSettings?.nextPosition ?? 1;
    const [arabicFont, setArabicFont] = useState<PdfArabicFont>(DEFAULT_PDF_ARABIC_FONT);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const generatingRef = useRef(false);

    // Single batch mode state
    const [patientName, setPatientName] = useState('');
    const [doctorName, setDoctorName] = useState('');
    const [includeLogo, setIncludeLogo] = useState(true);
    const [labels, setLabels] = useState<Label[]>([]);
    const [newLabelText, setNewLabelText] = useState('');
    const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
    const [editLabelText, setEditLabelText] = useState('');

    const [singleSeed, setSingleSeed] = useState<SingleSeed | null>(null);

    // Queue mode state
    const [queueBatches, setQueueBatches] = useState<QueueBatch[]>([]);
    const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
    const [queueNewLabelText, setQueueNewLabelText] = useState('');
    const [queueEditingLabel, setQueueEditingLabel] = useState<{ batchId: string; labelIndex: number } | null>(null);
    const [queueEditLabelText, setQueueEditLabelText] = useState('');

    // Initialize single batch mode. Adjust-during-render keyed on the open state +
    // the batch/patient/doctor identity, so opening (or re-targeting) the modal
    // re-seeds the editable form once, without a setState-in-effect bailout.
    const singleInitKey = !queueMode && isOpen && batch && patient
        ? `${batch.batch_sequence ?? ''}|${patient.patient_name ?? ''}|${patient.first_name ?? ''}|${patient.last_name ?? ''}|${initialDoctorName}`
        : '';
    const [singleInitializedKey, setSingleInitializedKey] = useState('');
    if (singleInitKey !== singleInitializedKey) {
        setSingleInitializedKey(singleInitKey);
        if (!queueMode && isOpen && batch && patient) {
            const name = patient.patient_name ||
                (patient.first_name && patient.last_name
                    ? `${patient.first_name} ${patient.last_name}`
                    : 'Unknown Patient');
            setPatientName(name);

            // The shared rule (FE-F20-10): with no doctor the field used to hold
            // "Dr. ", which passed validation and printed as a doctor line.
            const drName = doctorLabel(initialDoctorName);
            setDoctorName(drName);
            setIncludeLogo(true);

            const defaultLabels = buildLabelsFromRanges(
                batch.upper_aligner_start_sequence,
                batch.upper_aligner_end_sequence,
                batch.lower_aligner_start_sequence,
                batch.lower_aligner_end_sequence
            );
            setLabels(defaultLabels);
            setSingleSeed({ patientName: name, doctorName: drName, labels: joinLabels(defaultLabels.map(l => l.text)) });
            setStartingPosition(null);
            setArabicFont(DEFAULT_PDF_ARABIC_FONT);
            setNewLabelText('');
            setEditingLabelId(null);
        }
    }

    // Initialize queue mode. Adjust-during-render keyed on the queued-items
    // identity, so a fresh queue re-seeds the editable batches once, without a
    // setState-in-effect bailout.
    const [seededQueuedItems, setSeededQueuedItems] = useState<PrintQueueItem[] | null>(null);
    if (queueMode && queuedItems.length > 0 && queuedItems !== seededQueuedItems) {
        setSeededQueuedItems(queuedItems);
        const batches: QueueBatch[] = queuedItems.map(item => ({
            ...item,
            originalLabels: [...item.labels], // Store original for reset
            originalIncludeLogo: item.includeLogo,
        }));
        setQueueBatches(batches);
        setStartingPosition(null);
        setArabicFont(DEFAULT_PDF_ARABIC_FONT);
        setExpandedBatchId(null);
        setQueueNewLabelText('');
        setQueueEditingLabel(null);
    }

    // Calculate totals
    const totalLabels = queueMode
        ? queueBatches.reduce((sum, b) => sum + b.labels.length, 0)
        : labels.length;

    const { pages: totalPages, nextPosition } = calculateStats(totalLabels, startingPosition);

    // Validation. The doctor is optional: a label without one prints no doctor line.
    const isValid = queueMode
        ? queueBatches.length > 0 && totalLabels > 0
        : patientName.trim() !== '' && labels.length > 0;

    // Unsaved work: Escape, the backdrop, ✕ and Cancel threw an edited queue or
    // label list away without a word (FE-F20-10). Most edits here are clicks
    // (remove a label, toggle the logo), which `watchInput` can't see, so the
    // state is compared with what the dialog was opened with.
    const isDirty = queueMode
        ? queueNewLabelText.trim() !== ''
            || queueBatches.length !== queuedItems.length
            || queueBatches.some(b => b.includeLogo !== b.originalIncludeLogo
                || joinLabels(b.labels) !== joinLabels(b.originalLabels))
        : singleSeed !== null && (
            newLabelText.trim() !== ''
            || patientName !== singleSeed.patientName
            || doctorName !== singleSeed.doctorName
            || !includeLogo
            || joinLabels(labels.map(l => l.text)) !== singleSeed.labels
        );

    // Group queue batches by patient
    const groupedQueueBatches = useMemo(
        (): PatientGroupOf<QueueBatch>[] => (queueMode ? groupByPatient(queueBatches) : []),
        [queueMode, queueBatches]
    );

    // Queue stats
    const queueStats = useMemo((): QueueStats | null => {
        if (!queueMode) return null;
        return {
            batchCount: queueBatches.length,
            patientCount: new Set(queueBatches.map(b => b.personId)).size,
            totalLabels
        };
    }, [queueMode, queueBatches, totalLabels]);

    // Single batch: Label management
    const addLabel = useCallback(() => {
        const text = newLabelText.trim().toUpperCase();
        if (!text) return;

        setLabels(prev => [...prev, {
            id: `custom-${Date.now()}`,
            text,
            type: getLabelType(text)
        }]);
        setNewLabelText('');
    }, [newLabelText]);

    const removeLabel = useCallback((id: string) => {
        setLabels(prev => prev.filter(l => l.id !== id));
    }, []);

    const startEditLabel = useCallback((label: Label) => {
        setEditingLabelId(label.id);
        setEditLabelText(label.text);
    }, []);

    const saveEditLabel = useCallback(() => {
        if (!editLabelText.trim()) {
            setLabels(prev => prev.filter(l => l.id !== editingLabelId));
        } else {
            const text = editLabelText.trim().toUpperCase();
            setLabels(prev => prev.map(l =>
                l.id === editingLabelId ? { ...l, text, type: getLabelType(text) } : l
            ));
        }
        setEditingLabelId(null);
        setEditLabelText('');
    }, [editingLabelId, editLabelText]);

    const resetToDefault = useCallback(() => {
        if (batch) {
            setLabels(buildLabelsFromRanges(
                batch.upper_aligner_start_sequence,
                batch.upper_aligner_end_sequence,
                batch.lower_aligner_start_sequence,
                batch.lower_aligner_end_sequence
            ));
        }
    }, [batch]);

    // Queue mode: Toggle logo for batch
    const toggleQueueBatchLogo = useCallback((batchId: string) => {
        setQueueBatches(prev => prev.map(b =>
            b.id === batchId ? { ...b, includeLogo: !b.includeLogo } : b
        ));
    }, []);

    // Queue mode: Remove batch
    const removeQueueBatch = useCallback((batchId: string) => {
        setQueueBatches(prev => prev.filter(b => b.id !== batchId));
        if (expandedBatchId === batchId) {
            setExpandedBatchId(null);
        }
    }, [expandedBatchId]);

    // Queue mode: Toggle batch expansion
    const toggleBatchExpansion = useCallback((batchId: string) => {
        setExpandedBatchId(prev => prev === batchId ? null : batchId);
        setQueueNewLabelText('');
        setQueueEditingLabel(null);
    }, []);

    // Queue mode: Add label to batch
    const addLabelToQueueBatch = useCallback((batchId: string) => {
        const text = queueNewLabelText.trim().toUpperCase();
        if (!text) return;

        setQueueBatches(prev => prev.map(b =>
            b.id === batchId ? { ...b, labels: [...b.labels, text] } : b
        ));
        setQueueNewLabelText('');
    }, [queueNewLabelText]);

    // Queue mode: Remove label from batch
    const removeLabelFromQueueBatch = useCallback((batchId: string, labelIndex: number) => {
        setQueueBatches(prev => prev.map(b =>
            b.id === batchId
                ? { ...b, labels: b.labels.filter((_, idx) => idx !== labelIndex) }
                : b
        ));
    }, []);

    // Queue mode: Start editing a label
    const startQueueLabelEdit = useCallback((batchId: string, labelIndex: number, currentText: string) => {
        setQueueEditingLabel({ batchId, labelIndex });
        setQueueEditLabelText(currentText);
    }, []);

    // Queue mode: Save edited label
    const saveQueueLabelEdit = useCallback(() => {
        if (!queueEditingLabel) return;

        const { batchId, labelIndex } = queueEditingLabel;
        const text = queueEditLabelText.trim().toUpperCase();

        if (!text) {
            // Empty text = remove the label
            removeLabelFromQueueBatch(batchId, labelIndex);
        } else {
            setQueueBatches(prev => prev.map(b =>
                b.id === batchId
                    ? { ...b, labels: b.labels.map((l, idx) => idx === labelIndex ? text : l) }
                    : b
            ));
        }
        setQueueEditingLabel(null);
        setQueueEditLabelText('');
    }, [queueEditingLabel, queueEditLabelText, removeLabelFromQueueBatch]);

    // Queue mode: Cancel editing
    const cancelQueueLabelEdit = useCallback(() => {
        setQueueEditingLabel(null);
        setQueueEditLabelText('');
    }, []);

    // Queue mode: Reset batch labels to original
    const resetQueueBatchLabels = useCallback((batchId: string) => {
        setQueueBatches(prev => prev.map(b =>
            b.id === batchId ? { ...b, labels: [...b.originalLabels] } : b
        ));
    }, []);

    // Queue mode: Clear all labels from batch
    const clearQueueBatchLabels = useCallback((batchId: string) => {
        setQueueBatches(prev => prev.map(b =>
            b.id === batchId ? { ...b, labels: [] } : b
        ));
    }, []);

    /**
     * Build rich labels array from current state
     * Works for both single batch and queue mode
     */
    const buildRichLabels = useCallback((): RichLabel[] => {
        if (queueMode) {
            // Queue mode: flatten all batches into rich labels
            const richLabels: RichLabel[] = [];
            queueBatches.forEach(batch => {
                batch.labels.forEach(labelText => {
                    richLabels.push({
                        text: labelText,
                        patientName: batch.patientName,
                        doctorName: batch.doctorName || '',
                        includeLogo: batch.includeLogo && logoAvailable
                    });
                });
            });
            return richLabels;
        } else {
            // Single batch mode: all labels share same patient/doctor
            return labels.map(label => ({
                text: label.text,
                patientName: patientName.trim(),
                doctorName: doctorName.trim(),
                includeLogo: includeLogo && logoAvailable
            }));
        }
    }, [queueMode, queueBatches, labels, patientName, doctorName, includeLogo, logoAvailable]);

    /**
     * Unified generate handler for both modes
     */
    const handleGenerate = async (): Promise<void> => {
        if (!isValid || generatingRef.current) return;
        generatingRef.current = true;
        setIsSubmitting(true);

        // Open the PDF's window NOW, inside the click. Opened after the response it
        // was no longer the user's gesture: a popup blocker returned null, nothing
        // looked, the toast said the labels were generated and queue mode cleared
        // the queue (FE-F20-4).
        const pdfWindow = window.open('', '_blank');
        if (pdfWindow) {
            pdfWindow.opener = null;
            pdfWindow.document.title = 'Preparing labels…';
            pdfWindow.document.body.textContent = 'Preparing labels…';
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);
        try {
            const richLabels = buildRichLabels();

            // eslint-disable-next-line no-restricted-syntax -- returns a PDF blob (res.blob()) + reads X-Total-* response headers; needs the raw Response (so it bypasses core/http.ts's envelope unwrap). The funnel also attaches the CSRF token on mutations, so we replicate that here (audit H2) — staffCsrfProtection 403s tokenless /api mutations.
            const response = await fetch('/api/aligner/labels/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-csrf-token': await prefetchCsrfToken(),
                },
                body: JSON.stringify({
                    labels: richLabels,
                    startingPosition,
                    arabicFont
                }),
                signal: controller.signal,
            });

            if (!response.ok) {
                // The server's message, not its raw JSON body (FE-F20-4).
                const body = await response.json().catch(() => null) as { error?: string } | null;
                throw new Error(body?.error || `the server answered ${response.status}`);
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            // Release the blob URL once the PDF has had a chance to load.
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
            if (pdfWindow && !pdfWindow.closed) {
                pdfWindow.location.href = url;
            } else {
                // Blocked even inside the click, or the user closed the tab: save it.
                const link = document.createElement('a');
                link.href = url;
                link.download = pdfFileName(response);
                link.click();
                toast.info('Pop-ups are blocked here, so the labels PDF was downloaded instead.', 6000);
            }

            const totalLabelsHeader = response.headers.get('X-Total-Labels');
            const totalPagesHeader = response.headers.get('X-Total-Pages');
            toast.success(`Generated ${totalLabelsHeader || richLabels.length} labels on ${totalPagesHeader || '?'} page(s)`);
            // The server stored where this print ended; the next opening starts there.
            void queryClient.invalidateQueries({ queryKey: qk.aligner.labelSettings() });

            // Close modal and clear queue if in queue mode — only now that the PDF is
            // on screen or saved. Any failure keeps the dialog and the queue.
            if (queueMode && onQueuePrintSuccess) {
                onQueuePrintSuccess();
            } else if (onClose) {
                onClose();
            }
        } catch (error) {
            pdfWindow?.close();
            const message = controller.signal.aborted
                ? 'it took too long. Try again, or print fewer labels at once.'
                : error instanceof Error ? error.message : 'unknown error';
            toast.error(`Failed to generate labels: ${message}`);
        } finally {
            clearTimeout(timer);
            generatingRef.current = false;
            setIsSubmitting(false);
        }
    };

    // Key handlers - Single batch mode
    const handleNewLabelKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addLabel();
        }
    };

    // Escape cancels the label edit — and only that: preventDefault tells the
    // Modal the key is used, or the same keypress closed the whole dialog.
    const handleEditLabelKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveEditLabel();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            setEditingLabelId(null);
            setEditLabelText('');
        }
    };

    // Key handlers - Queue mode
    const handleQueueNewLabelKeyDown = (e: KeyboardEvent<HTMLInputElement>, batchId: string) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addLabelToQueueBatch(batchId);
        }
    };

    const handleQueueEditLabelKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveQueueLabelEdit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelQueueLabelEdit();
        }
    };

    // Get label type class for styling
    const getQueueLabelTypeClass = (text: string): string => {
        if (text.includes('/')) return styles.queueLabelChipCombined;
        if (text.toUpperCase().startsWith('U')) return styles.queueLabelChipUpper;
        if (text.toUpperCase().startsWith('L')) return styles.queueLabelChipLower;
        return styles.queueLabelChipCustom;
    };

    // Get label item type class for styling
    const getLabelItemTypeClass = (text: string): string => {
        if (text.includes('/')) return styles.labelItemCombined;
        if (text.toUpperCase().startsWith('U')) return styles.labelItemUpper;
        if (text.toUpperCase().startsWith('L')) return styles.labelItemLower;
        return styles.labelItemCustom;
    };

    const currentIsGenerating = isSubmitting;

    const handleClose = useCallback(() => {
        if (onClose) onClose();
    }, [onClose]);

    const unsavedGuard = { isDirty };

    // Shared: Position selector and stats
    const renderPositionAndStats = () => (
        <div className={styles.right}>
            {/* Arabic Font Selector */}
            <div className={styles.formGroup}>
                <label htmlFor="label-arabic-font">Arabic Font</label>
                <select
                    id="label-arabic-font"
                    value={arabicFont}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) => setArabicFont(e.target.value as PdfArabicFont)}
                    className={styles.fontSelector}
                >
                    {PDF_ARABIC_FONTS.map(font => (
                        <option key={font.id} value={font.id}>
                            {font.label} - {font.description}
                        </option>
                    ))}
                </select>
            </div>

            {/* Starting Position Selector */}
            <div className={styles.positionSelector}>
                <h3>Starting Position</h3>
                <p className={styles.positionHint}>Select where to start on the label sheet (OL291)</p>

                <div className={styles.positionGrid}>
                    {Array.from({ length: LABELS_PER_SHEET }, (_, i) => i + 1).map(pos => {
                        const isSelected = pos === startingPosition;
                        const labelsOnFirstPage = Math.min(totalLabels, LABELS_PER_SHEET - startingPosition + 1);
                        const isUsed = pos >= startingPosition && pos < startingPosition + labelsOnFirstPage;

                        return (
                            <button
                                key={pos}
                                className={`${styles.positionCell} ${isSelected ? styles.positionCellSelected : ''} ${isUsed && !isSelected ? styles.positionCellWillUse : ''}`}
                                onClick={() => setStartingPosition(pos)}
                                title={`Position ${pos}`}
                            >
                                {pos}
                            </button>
                        );
                    })}
                </div>

                <div className={styles.positionLegend}>
                    <span className={styles.legendItem}>
                        <span className={`${styles.legendColor} ${styles.legendColorSelected}`}></span>
                        Start
                    </span>
                    <span className={styles.legendItem}>
                        <span className={`${styles.legendColor} ${styles.legendColorWillUse}`}></span>
                        Used
                    </span>
                </div>
            </div>

            {/* Stats */}
            <div className={styles.printStats}>
                <div className={styles.statItem}>
                    <span className={styles.statLabel}>Total Labels</span>
                    <span className={styles.statValue}>{totalLabels}</span>
                </div>
                <div className={styles.statItem}>
                    <span className={styles.statLabel}>Pages</span>
                    <span className={styles.statValue}>{totalPages}</span>
                </div>
                <div className={styles.statItem}>
                    <span className={styles.statLabel}>Next Pos</span>
                    <span className={styles.statValue}>{nextPosition}</span>
                </div>
            </div>
        </div>
    );

    // Queue mode render
    if (queueMode) {
        return (
            <Modal isOpen={isModalOpen} onClose={handleClose} contentClassName={`${styles.modal} ${styles.modalWide}`} ariaLabelledBy="label-queue-modal-title" unsavedGuard={unsavedGuard}>
                {(dismiss) => (<>
                    {/* The shared header is the drag grip, so the label list below stays selectable. */}
                    <ModalHeader
                        title="Print Queue"
                        titleId="label-queue-modal-title"
                        icon={<i className="fas fa-layer-group" aria-hidden="true" />}
                        subtitle={<>
                            {queueStats?.patientCount} {queueStats?.patientCount === 1 ? 'patient' : 'patients'} &bull; {queueStats?.batchCount} {queueStats?.batchCount === 1 ? 'batch' : 'batches'} &bull; {queueStats?.totalLabels} labels
                        </>}
                        onClose={dismiss}
                    />

                    {/* Content */}
                    <div className={`${styles.content} ${styles.queueModeContent}`}>
                        {/* Left: Queue batches */}
                        <div className={styles.queueBatches}>
                            <h3>Batches to Print</h3>
                            <p className={styles.queueHint}>
                                <i className="fas fa-info-circle" aria-hidden="true"></i>
                                Click batch to expand and edit labels. Labels are printed in order shown.
                            </p>
                            {labelSettings && !logoAvailable && (
                                <p className={styles.queueHint}>
                                    <i className="far fa-image" aria-hidden="true"></i>
                                    {NO_LOGO_HINT}
                                </p>
                            )}

                            <div className={styles.queuePatientGroups}>
                                {groupedQueueBatches.map(group => (
                                    <div key={group.personId} className={styles.queuePatientGroup}>
                                        <div className={styles.queuePatientHeader}>
                                            <i className="fas fa-user" aria-hidden="true"></i>
                                            <span className={styles.queuePatientName}>{group.patientName}</span>
                                        </div>
                                        <div className={styles.queuePatientBatches}>
                                            {group.batches.map(batchItem => {
                                                const isExpanded = expandedBatchId === batchItem.id;
                                                return (
                                                    <div key={batchItem.id} className={`${styles.queueBatchItem} ${isExpanded ? styles.queueBatchItemExpanded : ''}`}>
                                                        {/* Batch header - clickable to expand */}
                                                        <div
                                                            className={styles.queueBatchHeader}
                                                            role="button"
                                                            tabIndex={0}
                                                            onClick={() => toggleBatchExpansion(batchItem.id)}
                                                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleBatchExpansion(batchItem.id); } }}
                                                        >
                                                            <div className={styles.queueBatchInfo}>
                                                                <i className={`fas fa-chevron-${isExpanded ? 'down' : 'right'} ${styles.expandIcon}`} aria-hidden="true"></i>
                                                                <span className={styles.queueBatchNumber}>Batch #{batchItem.batchNumber}</span>
                                                                <span className={styles.queueBatchLabels}>{batchItem.labels.length} labels</span>
                                                                {batchItem.doctorName && (
                                                                    <span className={styles.queueBatchDoctor}>{batchItem.doctorName}</span>
                                                                )}
                                                            </div>
                                                            <div className={styles.queueBatchActions} role="button" tabIndex={0} onClick={e => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); } }}>
                                                                <label className={styles.queueLogoToggle} title={logoAvailable ? 'Include logo' : NO_LOGO_HINT}>
                                                                    <input
                                                                        type="checkbox"
                                                                        aria-label="Include logo"
                                                                        checked={batchItem.includeLogo && logoAvailable}
                                                                        disabled={!logoAvailable}
                                                                        onChange={() => toggleQueueBatchLogo(batchItem.id)}
                                                                    />
                                                                    <span className={styles.checkboxIcon}>
                                                                        <i className={batchItem.includeLogo && logoAvailable ? 'fas fa-image' : 'far fa-image'} aria-hidden="true"></i>
                                                                    </span>
                                                                </label>
                                                                <button
                                                                    className={styles.queueBatchRemove}
                                                                    onClick={() => removeQueueBatch(batchItem.id)}
                                                                    title="Remove batch"
                                                                >
                                                                    <i className="fas fa-trash" aria-hidden="true"></i>
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {/* Collapsed view - show label chips */}
                                                        {!isExpanded && (
                                                            <div className={styles.queueBatchLabelList}>
                                                                {batchItem.labels.map((label, idx) => (
                                                                    <span key={idx} className={`${styles.queueLabelChip} ${getQueueLabelTypeClass(label)}`}>{label}</span>
                                                                ))}
                                                                {batchItem.labels.length === 0 && (
                                                                    <span className={styles.queueNoLabels}>No labels</span>
                                                                )}
                                                            </div>
                                                        )}

                                                        {/* Expanded view - full label editor */}
                                                        {isExpanded && (
                                                            <div className={styles.queueBatchEditor}>
                                                                {/* Combined header */}
                                                                <div className={styles.queueEditorHeader}>
                                                                    <span className={styles.editorTitle}>Labels ({batchItem.labels.length})</span>
                                                                    <input
                                                                        type="text"
                                                                        value={queueNewLabelText}
                                                                        onChange={(e) => setQueueNewLabelText(e.target.value)}
                                                                        onKeyDown={(e) => handleQueueNewLabelKeyDown(e, batchItem.id)}
                                                                        placeholder="Add (U7, L5...)"
                                                                        className={styles.addLabelInput}
                                                                    />
                                                                    <button
                                                                        className={styles.btnAddLabel}
                                                                        onClick={() => addLabelToQueueBatch(batchItem.id)}
                                                                        disabled={!queueNewLabelText.trim()}
                                                                        title="Add label"
                                                                    >
                                                                        <i className="fas fa-plus" aria-hidden="true"></i>
                                                                    </button>
                                                                    <div className={styles.queueEditorActions}>
                                                                        <button
                                                                            className={styles.btnResetLabels}
                                                                            onClick={() => resetQueueBatchLabels(batchItem.id)}
                                                                            title="Reset to original"
                                                                        >
                                                                            <i className="fas fa-undo" aria-hidden="true"></i>
                                                                        </button>
                                                                        <button
                                                                            className={styles.btnClearLabels}
                                                                            onClick={() => clearQueueBatchLabels(batchItem.id)}
                                                                            title="Clear all"
                                                                        >
                                                                            <i className="fas fa-trash" aria-hidden="true"></i>
                                                                        </button>
                                                                    </div>
                                                                </div>

                                                                {/* Labels list */}
                                                                <div className={styles.queueLabelsList}>
                                                                    {batchItem.labels.length === 0 ? (
                                                                        <div className={styles.noLabels}>
                                                                            <i className="fas fa-inbox" aria-hidden="true"></i>
                                                                            <p>No labels</p>
                                                                            <p className={styles.noLabelsHint}>Add labels above or click Reset</p>
                                                                        </div>
                                                                    ) : (
                                                                        batchItem.labels.map((label, idx) => {
                                                                            const isEditing = queueEditingLabel?.batchId === batchItem.id && queueEditingLabel?.labelIndex === idx;
                                                                            return (
                                                                                <div
                                                                                    key={idx}
                                                                                    className={`${styles.labelItem} ${getLabelItemTypeClass(label)}`}
                                                                                >
                                                                                    <span className={styles.labelIndex}>{idx + 1}</span>
                                                                                    {isEditing ? (
                                                                                        <input
                                                                                            type="text"
                                                                                            value={queueEditLabelText}
                                                                                            onChange={(e) => setQueueEditLabelText(e.target.value)}
                                                                                            onKeyDown={handleQueueEditLabelKeyDown}
                                                                                            onBlur={saveQueueLabelEdit}
                                                                                            className={styles.labelEditInput}
                                                                                            // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional focus on open
                                                                                            autoFocus
                                                                                        />
                                                                                    ) : (
                                                                                        <span
                                                                                            className={styles.labelText}
                                                                                            role="button"
                                                                                            tabIndex={0}
                                                                                            onClick={() => startQueueLabelEdit(batchItem.id, idx, label)}
                                                                                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startQueueLabelEdit(batchItem.id, idx, label); } }}
                                                                                            title="Click to edit"
                                                                                        >
                                                                                            {label}
                                                                                        </span>
                                                                                    )}
                                                                                    <button
                                                                                        className={styles.btnRemoveLabel}
                                                                                        onClick={() => removeLabelFromQueueBatch(batchItem.id, idx)}
                                                                                        title="Remove"
                                                                                    >
                                                                                        <i className="fas fa-times" aria-hidden="true"></i>
                                                                                    </button>
                                                                                </div>
                                                                            );
                                                                        })
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {queueBatches.length === 0 && (
                                <div className={styles.queueEmpty}>
                                    <i className="fas fa-inbox" aria-hidden="true"></i>
                                    <p>No batches in queue</p>
                                </div>
                            )}
                        </div>

                        {/* Right: Position & Stats */}
                        {renderPositionAndStats()}
                    </div>

                    {/* Footer */}
                    <div className={styles.footer}>
                        <button className={styles.btnCancel} onClick={dismiss}>Cancel</button>
                        <button
                            className={styles.btnGenerate}
                            onClick={() => void handleGenerate()}
                            disabled={!isValid || currentIsGenerating}
                        >
                            {currentIsGenerating ? (
                                <><i className="fas fa-spinner fa-spin" aria-hidden="true"></i> Generating...</>
                            ) : (
                                <><i className="fas fa-file-pdf" aria-hidden="true"></i> Print All Labels ({totalLabels})</>
                            )}
                        </button>
                    </div>
                </>)}
            </Modal>
        );
    }

    // Single batch mode render
    return (
        <Modal isOpen={isModalOpen} onClose={handleClose} contentClassName={`${styles.modal} ${styles.modalWide}`} ariaLabelledBy="label-preview-modal-title" unsavedGuard={unsavedGuard}>
            {(dismiss) => (<>
                <ModalHeader
                    title="Print Aligner Labels"
                    titleId="label-preview-modal-title"
                    icon={<i className="fas fa-print" aria-hidden="true" />}
                    onClose={dismiss}
                />

                {/* Content */}
                <div className={styles.content}>
                    {/* Left: Form */}
                    <div className={styles.form}>
                        <h3>Label Information</h3>

                        <div className={styles.formGroup}>
                            <label htmlFor="label-patient-name">Patient Name</label>
                            <input
                                id="label-patient-name"
                                type="text"
                                value={patientName}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setPatientName(e.target.value)}
                                placeholder="Enter patient name"
                                className={!patientName.trim() ? styles.inputError : ''}
                            />
                        </div>

                        <div className={styles.formGroup}>
                            <label htmlFor="label-doctor-name">Doctor Name</label>
                            <input
                                id="label-doctor-name"
                                type="text"
                                value={doctorName}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setDoctorName(e.target.value)}
                                placeholder="Optional"
                            />
                        </div>

                        <div className={`${styles.formGroup} ${styles.formGroupInline}`}>
                            <label className={styles.checkboxLabel} title={logoAvailable ? undefined : NO_LOGO_HINT}>
                                <input
                                    type="checkbox"
                                    checked={includeLogo && logoAvailable}
                                    disabled={!logoAvailable}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => setIncludeLogo(e.target.checked)}
                                />
                                <span className={styles.checkboxText}>Include Logo on Labels</span>
                            </label>
                        </div>
                        {labelSettings && !logoAvailable && (
                            <p className={styles.labelsHint}>
                                <i className="far fa-image" aria-hidden="true"></i>
                                {NO_LOGO_HINT}
                            </p>
                        )}

                        <div className={styles.formGroup}>
                            <label htmlFor="label-source-batch">Source Batch</label>
                            <input
                                id="label-source-batch"
                                type="text"
                                value={`Batch #${batch?.batch_sequence || 'N/A'} (Set #${set?.set_sequence || 'N/A'})`}
                                disabled
                                className={styles.inputDisabled}
                            />
                        </div>

                        <div className={styles.originalRangesInfo}>
                            <span className={styles.infoLabel}>Original ranges:</span>
                            {batch?.upper_aligner_start_sequence != null && batch?.upper_aligner_end_sequence != null && (
                                <span className={`${styles.rangeBadge} ${styles.rangeBadgeUpper}`}>
                                    U{batch.upper_aligner_start_sequence}-{batch.upper_aligner_end_sequence}
                                </span>
                            )}
                            {batch?.lower_aligner_start_sequence != null && batch?.lower_aligner_end_sequence != null && (
                                <span className={`${styles.rangeBadge} ${styles.rangeBadgeLower}`}>
                                    L{batch.lower_aligner_start_sequence}-{batch.lower_aligner_end_sequence}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Middle: Labels Editor */}
                    <div className={styles.middle}>
                        <div className={styles.labelsEditor}>
                            <div className={styles.labelsEditorHeader}>
                                <h3>Labels to Print ({totalLabels})</h3>
                                <div className={styles.labelsEditorActions}>
                                    <button className={styles.btnResetLabels} onClick={resetToDefault} title="Reset">
                                        <i className="fas fa-undo" aria-hidden="true"></i> Reset
                                    </button>
                                    <button className={styles.btnClearLabels} onClick={() => setLabels([])} title="Clear">
                                        <i className="fas fa-trash" aria-hidden="true"></i> Clear
                                    </button>
                                </div>
                            </div>

                            <p className={styles.labelsHint}>
                                <i className="fas fa-info-circle" aria-hidden="true"></i>
                                Click to edit, x to remove. Use U#/L# format
                            </p>

                            <div className={styles.addLabelRow}>
                                <input
                                    type="text"
                                    value={newLabelText}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => setNewLabelText(e.target.value)}
                                    onKeyDown={handleNewLabelKeyPress}
                                    placeholder="Add label (e.g., U7, L5, U3/L3)"
                                    className={styles.addLabelInput}
                                />
                                <button className={styles.btnAddLabel} onClick={addLabel} disabled={!newLabelText.trim()} aria-label="Add label">
                                    <i className="fas fa-plus" aria-hidden="true"></i>
                                </button>
                            </div>

                            <div className={styles.labelsList}>
                                {labels.length === 0 ? (
                                    <div className={styles.noLabels}>
                                        <i className="fas fa-inbox" aria-hidden="true"></i>
                                        <p>No labels to print</p>
                                        <p className={styles.noLabelsHint}>Add labels above or click Reset</p>
                                    </div>
                                ) : (
                                    labels.map((label, idx) => (
                                        <div
                                            key={label.id}
                                            className={`${styles.labelItem} ${label.type === 'UL' ? styles.labelItemCombined : label.type === 'U' ? styles.labelItemUpper : label.type === 'L' ? styles.labelItemLower : styles.labelItemCustom}`}
                                        >
                                            <span className={styles.labelIndex}>{idx + 1}</span>
                                            {editingLabelId === label.id ? (
                                                <input
                                                    type="text"
                                                    value={editLabelText}
                                                    onChange={(e: ChangeEvent<HTMLInputElement>) => setEditLabelText(e.target.value)}
                                                    onKeyDown={handleEditLabelKeyPress}
                                                    onBlur={saveEditLabel}
                                                    className={styles.labelEditInput}
                                                    // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional focus on open
                                                    autoFocus
                                                />
                                            ) : (
                                                <span className={styles.labelText} role="button" tabIndex={0} onClick={() => startEditLabel(label)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEditLabel(label); } }} title="Click to edit">
                                                    {label.text}
                                                </span>
                                            )}
                                            <button className={styles.btnRemoveLabel} onClick={() => removeLabel(label.id)} title="Remove">
                                                <i className="fas fa-times" aria-hidden="true"></i>
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right: Position & Stats */}
                    {renderPositionAndStats()}
                </div>

                {/* Footer */}
                <div className={styles.footer}>
                    <button className={styles.btnCancel} onClick={dismiss}>Cancel</button>
                    <button
                        className={styles.btnGenerate}
                        onClick={() => void handleGenerate()}
                        disabled={!isValid || currentIsGenerating}
                    >
                        {currentIsGenerating ? (
                            <><i className="fas fa-spinner fa-spin" aria-hidden="true"></i> Generating...</>
                        ) : (
                            <><i className="fas fa-file-pdf" aria-hidden="true"></i> Prepare PDF</>
                        )}
                    </button>
                </div>
            </>)}
        </Modal>
    );
};

export default LabelPreviewModal;
