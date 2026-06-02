import React, { useState, useEffect, type FormEvent, type ChangeEvent, type SyntheticEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import WorkCard, { type Work, type WorkStatus } from './WorkCard';
import PaymentModal from './PaymentModal';
import TransferWorkModal from './TransferWorkModal';
import Modal from './Modal';
import TeethSelector from './TeethSelector';
import { formatCurrency as formatCurrencyUtil, formatNumber } from '../../utils/formatters';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useGlobalState } from '../../contexts/GlobalStateContext';
import {
    getWorkTypeConfig,
    MATERIAL_OPTIONS,
    FILLING_TYPE_OPTIONS,
    FILLING_DEPTH_OPTIONS
} from '../../config/workTypeConfig';
import styles from './WorkComponent.module.css';

interface PatientInfo {
    person_id: number;
    patient_name: string;
    Name?: string;
    Phone?: string;
    estimatedCost?: number;
    currency?: string;
    name?: string;
    activeAlert?: {
        alertType: string;
        alertSeverity: number;
        alertDetails: string;
    };
}

interface WorkDetail {
    id: number;
    work_id: number;
    TeethIds?: number[];
    Teeth?: string;
    ImplantManufacturerName?: string;
    filling_type?: string;
    filling_depth?: string;
    canals_no?: number;
    working_length?: string;
    implant_length?: number;
    implant_diameter?: number;
    implant_manufacturer_id?: number;
    material?: string;
    lab_name?: string;
    item_cost?: number;
    start_date?: string;
    completed_date?: string;
    note?: string;
    // Allow dynamic access for work type display fields
    [key: string]: string | number | number[] | undefined;
}

interface DetailFormData {
    work_id: number | null;
    TeethIds: number[];
    filling_type: string;
    filling_depth: string;
    canals_no: string;
    working_length: string;
    implant_length: string;
    implant_diameter: string;
    implant_manufacturer_id: string;
    material: string;
    lab_name: string;
    item_cost: string;
    start_date: string;
    completed_date: string;
    note: string;
}

interface ToothOption {
    id: number;
    tooth_code: string;
    tooth_name: string;
    tooth_number?: string;
    quadrant: 'UR' | 'UL' | 'LR' | 'LL';
    is_permanent: boolean;
}

interface ImplantManufacturer {
    id: number;
    name: string;
}

interface Payment {
    InvoiceID: number;
    date_of_payment: string;
    amount_paid: number;
    actual_amount?: number;
    actual_cur?: string;
    change?: number;
}

interface WorkComponentProps {
    personId?: number | null;
}

// Work Status Constants (must match backend)
const WORK_STATUS: WorkStatus = {
    ACTIVE: 1,
    FINISHED: 2,
    DISCONTINUED: 3
};

/**
 * Work Component
 * Displays list of patient's treatment works
 * Memoized to prevent unnecessary re-renders when personId hasn't changed
 */
const WorkComponent = ({ personId }: WorkComponentProps) => {
    const navigate = useNavigate();
    const toast = useToast();
    const confirm = useConfirm();
    const { user } = useGlobalState();
    const isAdmin = user?.role === 'admin';
    const [works, setWorks] = useState<Work[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'completed' | 'discontinued'>('all');
    const [showDetailsModal, setShowDetailsModal] = useState(false);
    const [selectedWork, setSelectedWork] = useState<Work | null>(null);
    const [workDetails, setWorkDetails] = useState<WorkDetail[]>([]);
    const [showDetailForm, setShowDetailForm] = useState(false);
    const [editingDetail, setEditingDetail] = useState<WorkDetail | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [newAlignerWorkId, setNewAlignerWorkId] = useState<number | null>(null);

    // Payment-related state
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [showPaymentHistoryModal, setShowPaymentHistoryModal] = useState(false);
    const [selectedWorkForPayment, setSelectedWorkForPayment] = useState<Work | null>(null);
    const [paymentHistory, setPaymentHistory] = useState<Payment[]>([]);
    const [loadingPayments, setLoadingPayments] = useState(false);

    // Patient info state
    const [patientInfo, setPatientInfo] = useState<PatientInfo | null>(null);

    // Check-in state
    const [checkingIn, setCheckingIn] = useState(false);
    const [checkedIn, setCheckedIn] = useState(false);

    // Appointment state for no-work receipt button
    const [hasNextAppointment, setHasNextAppointment] = useState(false);
    const [loadingAppointment, setLoadingAppointment] = useState(true);

    // Expanded works state - track which work IDs are expanded
    const [expandedWorks, setExpandedWorks] = useState<Set<number>>(new Set());

    // Delete confirmation modal state
    const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
    const [workToDelete, setWorkToDelete] = useState<Work | null>(null);

    // Generic confirmation modal state
    const [confirmationModal, setConfirmationModal] = useState<{
        show: boolean;
        type: 'complete' | 'discontinue' | 'reactivate' | null;
        work: Work | null;
    }>({ show: false, type: null, work: null });

    // Transfer work modal state (admin only)
    const [showTransferModal, setShowTransferModal] = useState(false);
    const [workToTransfer, setWorkToTransfer] = useState<Work | null>(null);

    // Work detail form state - includes all possible fields for all work types
    const [detailFormData, setDetailFormData] = useState<DetailFormData>({
        work_id: null,
        TeethIds: [],
        filling_type: '',
        filling_depth: '',
        canals_no: '',
        working_length: '',
        implant_length: '',
        implant_diameter: '',
        implant_manufacturer_id: '',
        material: '',
        lab_name: '',
        item_cost: '',
        start_date: '',
        completed_date: '',
        note: ''
    });
    const [displayItemCost, setDisplayItemCost] = useState('');

    // Teeth options for multi-select
    const [teethOptions, setTeethOptions] = useState<ToothOption[]>([]);
    const [showTeethPermanent, setShowTeethPermanent] = useState(true);
    const [showTeethDeciduous, setShowTeethDeciduous] = useState(false);

    // Implant manufacturers for dropdown
    const [implantManufacturers, setImplantManufacturers] = useState<ImplantManufacturer[]>([]);

    useEffect(() => {
        if (personId) {
            loadWorks();
            loadPatientInfo();
            checkAppointmentStatus();
            loadTeethOptions();
            loadImplantManufacturers();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: these loaders are stable for the lifetime of a given personId
    }, [personId]);

    const loadTeethOptions = async () => {
        try {
            const response = await fetch('/api/teeth');
            if (!response.ok) throw new Error('Failed to fetch teeth options');
            const data = await response.json();
            setTeethOptions(data.teeth || []);
        } catch (err) {
            console.error('Error loading teeth options:', err);
        }
    };

    const loadImplantManufacturers = async () => {
        try {
            const response = await fetch('/api/implant-manufacturers');
            if (!response.ok) throw new Error('Failed to fetch implant manufacturers');
            const data: ImplantManufacturer[] = await response.json();
            setImplantManufacturers(data || []);
        } catch (err) {
            console.error('Error loading implant manufacturers:', err);
        }
    };

    // Auto-expand the first active work when works are loaded
    useEffect(() => {
        if (works.length > 0) {
            const firstActiveWork = works.find(work => work.status === WORK_STATUS.ACTIVE);
            if (firstActiveWork) {
                setExpandedWorks(new Set([firstActiveWork.work_id]));
            }
        }
    }, [works]);

    const loadPatientInfo = async () => {
        try {
            const response = await fetch(`/api/patients/${personId}/info`);
            if (!response.ok) throw new Error('Failed to fetch patient info');
            const data: PatientInfo = await response.json();
            setPatientInfo(data);
        } catch (err) {
            console.error('Error loading patient info:', err);
        }
    };

    const checkAppointmentStatus = async () => {
        try {
            setLoadingAppointment(true);
            const response = await fetch(`/api/patients/${personId}/has-appointment`);
            if (!response.ok) throw new Error('Failed to check appointment status');
            const data = await response.json();
            setHasNextAppointment(data.hasAppointment);
            console.log(`[WORK-COMPONENT] Patient ${personId} has next appointment:`, data.hasAppointment);
        } catch (err) {
            console.error('[WORK-COMPONENT] Error checking appointment status:', err);
            setHasNextAppointment(false);
        } finally {
            setLoadingAppointment(false);
        }
    };

    const handlePrintNoWorkReceipt = () => {
        console.log(`[WORK-COMPONENT] Print no-work receipt clicked for patient ${personId}`);

        if (!hasNextAppointment) {
            toast.warning('Patient has no scheduled appointment');
            return;
        }

        // Open receipt in new window
        const receiptUrl = `/api/templates/receipt/no-work/${personId}`;
        console.log(`[WORK-COMPONENT] Opening receipt window: ${receiptUrl}`);

        const receiptWindow = window.open(receiptUrl, '_blank');

        if (!receiptWindow) {
            toast.error('Failed to open receipt window. Please check your popup blocker settings.');
        } else {
            toast.success('Opening appointment receipt...');
        }
    };

    const loadWorks = async () => {
        try {
            setLoading(true);
            const response = await fetch(`/api/getworks?code=${personId}`);
            if (!response.ok) throw new Error('Failed to fetch works');
            const data: Work[] = await response.json();
            setWorks(data);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'An error occurred', 5000);
        } finally {
            setLoading(false);
        }
    };

    const handleAddWork = () => {
        navigate(`/patient/${personId}/new-work`);
    };

    const handleEditWork = (work: Work) => {
        navigate(`/patient/${personId}/new-work?workId=${work.work_id}`);
    };

    // Show confirmation modal for work status changes
    const handleCompleteWork = (work: Work) => {
        setConfirmationModal({ show: true, type: 'complete', work });
    };

    const handleDiscontinueWork = (work: Work) => {
        setConfirmationModal({ show: true, type: 'discontinue', work });
    };

    const handleReactivateWork = (work: Work) => {
        setConfirmationModal({ show: true, type: 'reactivate', work });
    };

    const closeConfirmationModal = () => {
        setConfirmationModal({ show: false, type: null, work: null });
    };

    const executeConfirmedAction = async () => {
        const { type, work } = confirmationModal;
        if (!type || !work) return;

        closeConfirmationModal();

        try {
            let endpoint = '';
            let body: Record<string, unknown> = {};
            let successMessage = '';

            switch (type) {
                case 'complete':
                    endpoint = '/api/finishwork';
                    body = { workId: work.work_id };
                    successMessage = 'Work marked as completed';
                    break;
                case 'discontinue':
                    endpoint = '/api/discontinuework';
                    body = { workId: work.work_id };
                    successMessage = 'Work marked as discontinued';
                    break;
                case 'reactivate':
                    endpoint = '/api/reactivatework';
                    body = { workId: work.work_id, personId: work.person_id };
                    successMessage = 'Work reactivated successfully';
                    break;
            }

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || errorData.error || `Failed to ${type} work`);
            }

            toast.success(successMessage);
            await loadWorks();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'An error occurred', 5000);
        }
    };

    // Get confirmation modal content based on type
    const getConfirmationModalContent = () => {
        const { type, work } = confirmationModal;
        if (!type || !work) return null;

        const configs = {
            complete: {
                title: 'Complete Work',
                icon: 'fa-check-circle',
                color: 'var(--success-color)',
                message: 'Are you sure you want to mark this work as completed?',
                warning: 'This will change the work status to Finished.',
                buttonText: 'Complete Work',
                buttonIcon: 'fa-check'
            },
            discontinue: {
                title: 'Discontinue Work',
                icon: 'fa-times-circle',
                color: 'var(--warning-color)',
                message: 'Are you sure you want to discontinue this work?',
                warning: 'This indicates the patient has abandoned treatment.',
                buttonText: 'Discontinue',
                buttonIcon: 'fa-times'
            },
            reactivate: {
                title: 'Reactivate Work',
                icon: 'fa-redo',
                color: 'var(--primary-color)',
                message: 'Are you sure you want to reactivate this work?',
                warning: 'This will make it the active work for this patient.',
                buttonText: 'Reactivate',
                buttonIcon: 'fa-redo'
            }
        };

        return { ...configs[type], work };
    };

    const handleDeleteWork = (work: Work) => {
        setWorkToDelete(work);
        setShowDeleteConfirmation(true);
    };

    const confirmDeleteWork = async () => {
        if (!workToDelete) return;

        setShowDeleteConfirmation(false);

        try {
            const work = workToDelete;
            const response = await fetch('/api/deletework', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workId: work.work_id })
            });

            const result = await response.json();

            if (!response.ok) {
                // Handle dependency error with detailed message
                if (response.status === 409 && result.details?.dependencies) {
                    const deps = result.details.dependencies;
                    let detailMessage = '⚠️ CANNOT DELETE WORK - EXISTING RECORDS FOUND ⚠️\n\n';
                    detailMessage += 'This work has the following records that must be deleted first:\n\n';

                    if (deps.InvoiceCount > 0) detailMessage += `• ${deps.InvoiceCount} payment(s)\n`;
                    if (deps.VisitCount > 0) detailMessage += `• ${deps.VisitCount} visit(s)\n`;
                    if (deps.ItemCount > 0) detailMessage += `• ${deps.ItemCount} treatment detail(s)\n`;
                    if (deps.DiagnosisCount > 0) detailMessage += `• ${deps.DiagnosisCount} diagnosis(es)\n`;
                    if (deps.ImplantCount > 0) detailMessage += `• ${deps.ImplantCount} implant(s)\n`;
                    if (deps.ScrewCount > 0) detailMessage += `• ${deps.ScrewCount} screw(s)\n`;
                    if (deps.AlignerSetCount > 0) detailMessage += `• ${deps.AlignerSetCount} aligner set(s)\n`;

                    detailMessage += '\n⚠️ Delete these records first, then try again.';

                    toast.error(detailMessage, 10000);
                    return;
                }

                throw new Error(result.error || 'Failed to delete work');
            }

            setSuccessMessage('Work deleted successfully!');
            setTimeout(() => setSuccessMessage(null), 3000);
            await loadWorks();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'An error occurred', 5000);
        } finally {
            setWorkToDelete(null);
        }
    };

    const cancelDeleteWork = () => {
        setShowDeleteConfirmation(false);
        setWorkToDelete(null);
    };

    // Transfer work handlers (admin only)
    const handleTransferWork = (work: Work) => {
        setWorkToTransfer(work);
        setShowTransferModal(true);
    };

    const handleTransferSuccess = (_result: { sourcePatientId: number; targetPatientId: number }) => {
        setShowTransferModal(false);
        setWorkToTransfer(null);
        // Refresh works since the work was transferred away
        loadWorks();
        toast.success('Work transferred successfully to another patient');
    };

    const handleViewDetails = async (work: Work) => {
        setSelectedWork(work);
        setShowDetailsModal(true);
        await loadWorkDetails(work.work_id);
    };

    const loadWorkDetails = async (workId: number) => {
        try {
            const response = await fetch(`/api/getworkdetailslist?workId=${workId}`);
            if (!response.ok) throw new Error('Failed to fetch work details');
            const data: WorkDetail[] = await response.json();
            setWorkDetails(data);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'An error occurred', 5000);
        }
    };

    const handleAddDetail = () => {
        if (!selectedWork) return;
        setEditingDetail(null);
        setDetailFormData({
            work_id: selectedWork.work_id,
            TeethIds: [],
            filling_type: '',
            filling_depth: '',
            canals_no: '',
            working_length: '',
            implant_length: '',
            implant_diameter: '',
            implant_manufacturer_id: '',
            material: '',
            lab_name: '',
            item_cost: '',
            start_date: '',
            completed_date: '',
            note: ''
        });
        setDisplayItemCost('');
        setShowDetailForm(true);
    };

    const handleEditDetail = (detail: WorkDetail) => {
        setEditingDetail(detail);
        setDetailFormData({
            work_id: detail.work_id,
            TeethIds: detail.TeethIds || [],
            filling_type: detail.filling_type || '',
            filling_depth: detail.filling_depth || '',
            canals_no: String(detail.canals_no || ''),
            working_length: detail.working_length || '',
            implant_length: String(detail.implant_length || ''),
            implant_diameter: String(detail.implant_diameter || ''),
            implant_manufacturer_id: String(detail.implant_manufacturer_id || ''),
            material: detail.material || '',
            lab_name: detail.lab_name || '',
            item_cost: String(detail.item_cost || ''),
            start_date: detail.start_date ? detail.start_date.split('T')[0] : '',
            completed_date: detail.completed_date ? detail.completed_date.split('T')[0] : '',
            note: detail.note || ''
        });
        setDisplayItemCost(detail.item_cost ? formatNumber(detail.item_cost) : '');
        setShowDetailForm(true);
    };

    const handleDetailFormSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        try {
            let response: Response;

            if (editingDetail) {
                response = await fetch('/api/updateworkdetail', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ detailId: editingDetail.id, ...detailFormData })
                });
            } else {
                response = await fetch('/api/addworkdetail', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(detailFormData)
                });
            }

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to save work detail');
            }

            if (selectedWork) {
                await loadWorkDetails(selectedWork.work_id);
            }
            setShowDetailForm(false);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'An error occurred', 5000);
        }
    };

    const handleDeleteDetail = async (detailId: number) => {
        if (!await confirm('Are you sure you want to delete this work detail?', { title: 'Delete Work Detail', danger: true, confirmText: 'Delete' })) return;

        try {
            const response = await fetch('/api/deleteworkdetail', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ detailId })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to delete work detail');
            }

            if (selectedWork) {
                await loadWorkDetails(selectedWork.work_id);
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'An error occurred', 5000);
        }
    };

    const getProgressPercentage = (work: Work): number => {
        if (work.status === WORK_STATUS.FINISHED) return 100;
        if (work.status === WORK_STATUS.DISCONTINUED) return 0;
        if (!work.start_date) return 0;

        let progress = 25;
        // Note: IPhotoDate, DebondDate, FPhotoDate may need to be added to Work interface
        return progress;
    };

    const filteredWorks = works
        .filter(work => {
            const matchesSearch = work.notes?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                work.doctor_name?.toLowerCase().includes(searchTerm.toLowerCase());

            const matchesFilter = filterStatus === 'all' ||
                (filterStatus === 'active' && work.status === WORK_STATUS.ACTIVE) ||
                (filterStatus === 'completed' && work.status === WORK_STATUS.FINISHED) ||
                (filterStatus === 'discontinued' && work.status === WORK_STATUS.DISCONTINUED);

            return matchesSearch && matchesFilter;
        })
        .sort((a, b) => {
            if (a.status === WORK_STATUS.ACTIVE && b.status !== WORK_STATUS.ACTIVE) return -1;
            if (a.status !== WORK_STATUS.ACTIVE && b.status === WORK_STATUS.ACTIVE) return 1;
            if (a.status === WORK_STATUS.DISCONTINUED && b.status === WORK_STATUS.FINISHED) return -1;
            if (a.status === WORK_STATUS.FINISHED && b.status === WORK_STATUS.DISCONTINUED) return 1;

            const dateA = new Date(a.addition_date || 0);
            const dateB = new Date(b.addition_date || 0);
            return dateA.getTime() - dateB.getTime();
        });

    const formatCurrency = (amount?: number, currency?: string): string => {
        if (!amount && amount !== 0) return 'N/A';
        return formatCurrencyUtil(amount, currency || 'USD');
    };

    const formatDate = (dateString?: string): string => {
        if (!dateString) return 'Not set';
        return new Date(dateString).toLocaleDateString();
    };

    const isAlignerWork = (work: Work): boolean => {
        return [19, 20, 21].includes(work.type_of_work);
    };

    const handleAddAlignerSet = (work: Work) => {
        navigate(`/aligner/patient/${work.work_id}`);
    };

    const handleAddPayment = (work: Work) => {
        setSelectedWorkForPayment(work);
        setShowPaymentModal(true);
    };

    const handleViewPaymentHistory = async (work: Work) => {
        setSelectedWorkForPayment(work);
        setShowPaymentHistoryModal(true);
        await loadPaymentHistory(work.work_id);
    };

    const loadPaymentHistory = async (workId: number) => {
        try {
            setLoadingPayments(true);
            const response = await fetch(`/api/getpaymenthistory?workId=${workId}`);
            if (!response.ok) throw new Error('Failed to fetch payment history');
            const data: Payment[] = await response.json();
            setPaymentHistory(data);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'An error occurred', 5000);
            setPaymentHistory([]);
        } finally {
            setLoadingPayments(false);
        }
    };

    const handlePrintReceipt = (work: Work) => {
        window.open(`/api/templates/receipt/work/${work.work_id}`, '_blank');
    };

    const toggleWorkExpanded = (workId: number) => {
        setExpandedWorks(prevExpanded => {
            const newExpanded = new Set(prevExpanded);
            if (newExpanded.has(workId)) {
                newExpanded.delete(workId);
            } else {
                newExpanded.add(workId);
            }
            return newExpanded;
        });
    };

    const handleQuickCheckin = async () => {
        try {
            setCheckingIn(true);
            const response = await fetch('/api/appointments/quick-checkin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    person_id: personId
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to check in patient');
            }

            const result = await response.json();

            if (result.alreadyCheckedIn) {
                setSuccessMessage(`${patientInfo?.name || 'Patient'} is already checked in today!`);
                setCheckedIn(true);
            } else if (result.created) {
                setSuccessMessage(`${patientInfo?.name || 'Patient'} added to today's appointments and checked in!`);
                setCheckedIn(true);
            } else {
                setSuccessMessage(`${patientInfo?.name || 'Patient'} checked in successfully!`);
                setCheckedIn(true);
            }

            setTimeout(() => setSuccessMessage(null), 5000);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'An error occurred', 5000);
        } finally {
            setCheckingIn(false);
        }
    };

    if (loading) return <div className={styles.loading}>Loading works...</div>;

    return (
        <div className={styles.component}>
            {/* Patient Info Card with Controls */}
            {patientInfo && (
                <div className={styles.patientInfoCard}>
                    <div className={styles.patientPhotoContainer}>
                        <img
                            src={`/DolImgs/${personId}00.i13`}
                            alt={`${patientInfo.patient_name} - Smile`}
                            className={styles.patientPhoto}
                            onError={(e: SyntheticEvent<HTMLImageElement>) => {
                                e.currentTarget.style.display = 'none';
                                if (e.currentTarget.parentElement) {
                                    e.currentTarget.parentElement.innerHTML = `<i class="fas fa-user ${styles.patientPhotoFallback}"></i>`;
                                }
                            }}
                        />
                    </div>
                    <div className={styles.patientInfoDetails}>
                        <div className={styles.patientInfoRow}>
                            <div className={styles.patientInfoHeader}>
                                <h3 className={styles.patientName}>
                                    {patientInfo.patient_name}
                                </h3>
                                <div className={styles.patientMetaInfo}>
                                    <span><i className="fas fa-id-card"></i>{patientInfo.person_id}</span>
                                    {patientInfo.Phone && (
                                        <span><i className="fas fa-phone"></i>{patientInfo.Phone}</span>
                                    )}
                                    {patientInfo.estimatedCost && (
                                        <span className={styles.patientCostBadge}>
                                            <i className="fas fa-dollar-sign"></i>
                                            {patientInfo.estimatedCost.toLocaleString()} {patientInfo.currency || 'IQD'}
                                        </span>
                                    )}
                                    {patientInfo.activeAlert && (
                                        <span className={`${styles.patientAlertBadge} ${patientInfo.activeAlert.alertSeverity === 1 ? styles.patientAlertBadgeSeverity1 : patientInfo.activeAlert.alertSeverity === 2 ? styles.patientAlertBadgeSeverity2 : styles.patientAlertBadgeSeverity3}`}>
                                            <i className="fas fa-exclamation-triangle"></i>
                                            {patientInfo.activeAlert.alertType}: {patientInfo.activeAlert.alertDetails}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className={styles.workSummaryInline}>
                                <div className={styles.summaryCardInline}>
                                    <span className={styles.summaryValueInline}>{works.length}</span>
                                    <span className={styles.summaryLabelInline}>Total</span>
                                </div>
                                <div className={styles.summaryCardInline}>
                                    <span className={styles.summaryValueInline}>{works.filter(w => w.status === WORK_STATUS.ACTIVE).length}</span>
                                    <span className={styles.summaryLabelInline}>Active</span>
                                </div>
                                <div className={styles.summaryCardInline}>
                                    <span className={styles.summaryValueInline}>{works.filter(w => w.status === WORK_STATUS.FINISHED).length}</span>
                                    <span className={styles.summaryLabelInline}>Completed</span>
                                </div>
                                <div className={styles.summaryCardInline}>
                                    <span className={styles.summaryValueInline}>{works.filter(w => w.status === WORK_STATUS.DISCONTINUED).length}</span>
                                    <span className={styles.summaryLabelInline}>Discontinued</span>
                                </div>
                            </div>
                        </div>
                        <div className={styles.patientControls}>
                            <input
                                type="text"
                                placeholder="Search works..."
                                value={searchTerm}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
                                className={styles.searchInput}
                            />
                            <select
                                value={filterStatus}
                                onChange={(e: ChangeEvent<HTMLSelectElement>) => setFilterStatus(e.target.value as typeof filterStatus)}
                                className={styles.filterSelect}
                            >
                                <option value="all">All Works</option>
                                <option value="active">Active</option>
                                <option value="completed">Completed</option>
                                <option value="discontinued">Discontinued</option>
                            </select>
                            <button
                                onClick={handleQuickCheckin}
                                className={`btn btn-work-checkin ${checkedIn ? styles.checkedIn : ''} ${checkingIn ? styles.checkingIn : ''}`}
                                disabled={checkingIn || checkedIn}
                                title={checkedIn ? 'Patient already checked in today' : 'Check in patient for today'}
                            >
                                <i className="fas fa-user-check"></i>
                                {checkingIn ? 'Checking In...' : checkedIn ? 'Checked In' : 'Check In'}
                            </button>
                            <button
                                onClick={handlePrintNoWorkReceipt}
                                className="btn btn-secondary"
                                disabled={loadingAppointment || !hasNextAppointment}
                                title={!hasNextAppointment ? 'No future appointment scheduled' : 'Print appointment confirmation receipt'}
                            >
                                <i className="fas fa-print"></i>
                                {loadingAppointment ? 'Loading...' : 'Print Appointment Receipt'}
                            </button>
                            <button onClick={handleAddWork} className="btn btn-primary">
                                <i className="fas fa-plus"></i>
                                Add New Work
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {successMessage && newAlignerWorkId && (
                <div className={styles.success}>
                    <div>
                        <strong>{successMessage}</strong>
                        <p>
                            This is an aligner work. Would you like to add aligner sets now?
                        </p>
                    </div>
                    <div className={styles.successActions}>
                        <button
                            onClick={() => handleAddAlignerSet({ work_id: newAlignerWorkId } as Work)}
                            className={styles.btnSuccessAction}
                        >
                            <i className="fas fa-tooth"></i> Add Aligner Set
                        </button>
                        <button
                            onClick={() => {
                                setSuccessMessage(null);
                                setNewAlignerWorkId(null);
                            }}
                            className={styles.btnSuccessClose}
                        >
                            ×
                        </button>
                    </div>
                </div>
            )}

            {/* Works Card Container */}
            <div className={styles.worksCardContainer}>
                {filteredWorks.map((work) => (
                    <WorkCard
                        key={work.work_id}
                        work={work}
                        personId={personId}
                        isAlignerWork={isAlignerWork}
                        isExpanded={expandedWorks.has(work.work_id)}
                        isAdmin={isAdmin}
                        onToggleExpanded={() => toggleWorkExpanded(work.work_id)}
                        onViewDetails={handleViewDetails}
                        onEdit={handleEditWork}
                        onDelete={handleDeleteWork}
                        onTransfer={handleTransferWork}
                        onAddPayment={handleAddPayment}
                        onViewPaymentHistory={handleViewPaymentHistory}
                        onAddAlignerSet={handleAddAlignerSet}
                        onComplete={handleCompleteWork}
                        onDiscontinue={handleDiscontinueWork}
                        onReactivate={handleReactivateWork}
                        onViewVisits={(work) => navigate(`/patient/${personId}/visits?workId=${work.work_id}`)}
                        onNewVisit={(work) => navigate(`/patient/${personId}/new-visit?workId=${work.work_id}`)}
                        onPrintReceipt={handlePrintReceipt}
                        formatDate={formatDate}
                        formatCurrency={formatCurrency}
                        getProgressPercentage={getProgressPercentage}
                        WORK_STATUS={WORK_STATUS}
                    />
                ))}
                {filteredWorks.length === 0 && (
                    <div className={styles.noWorksMessage}>
                        <i className={`fas fa-tooth ${styles.noWorksIcon}`}></i>
                        <p className={styles.noWorksText}>
                            {searchTerm || filterStatus !== 'all'
                                ? 'No works match your criteria'
                                : 'No works found for this patient'}
                        </p>
                    </div>
                )}
            </div>

            {/* Work Details Modal */}
            {showDetailsModal && selectedWork && (
                <Modal
                    isOpen={true}
                    onClose={() => setShowDetailsModal(false)}
                    contentClassName={`${styles.modal} ${styles.detailsModal}`}
                    ariaLabelledBy="work-details-modal-title"
                >
                        <div className={styles.modalHeader}>
                            <h3 id="work-details-modal-title">Work Details - {selectedWork.type_name || 'Work #' + selectedWork.work_id}</h3>
                            <button
                                onClick={() => setShowDetailsModal(false)}
                                className={styles.modalClose}
                            >
                                ×
                            </button>
                        </div>

                        <div className={styles.detailsContent}>
                            <div className={styles.summaryInfo}>
                                <h4 className={styles.referenceSection}>
                                    <i className="fas fa-info-circle"></i> Reference Information
                                </h4>
                                <div className={styles.infoGrid}>
                                    <div className={styles.infoItem}>
                                        <label>Work ID:</label>
                                        <span className={styles.workId}>{selectedWork.work_id}</span>
                                    </div>
                                </div>
                            </div>

                            <div className={styles.detailsSection}>
                                <div className={styles.sectionHeader}>
                                    <h4>
                                        <i className={getWorkTypeConfig(selectedWork.type_of_work).icon}></i>
                                        {' '}{getWorkTypeConfig(selectedWork.type_of_work).name} Details
                                    </h4>
                                    <button
                                        onClick={handleAddDetail}
                                        className="btn btn-sm btn-primary"
                                    >
                                        <i className="fas fa-plus"></i> Add Item
                                    </button>
                                </div>

                                <div className={styles.detailsTableContainer}>
                                    <table className={styles.detailsTable}>
                                        <thead>
                                            <tr>
                                                {getWorkTypeConfig(selectedWork.type_of_work).displayFields.map((field: { key: string; label: string }) => (
                                                    <th key={field.key}>{field.label}</th>
                                                ))}
                                                <th>Status</th>
                                                <th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {workDetails.map((detail) => (
                                                <tr key={detail.id}>
                                                    {getWorkTypeConfig(selectedWork.type_of_work).displayFields.map((field: { key: string; label: string }) => (
                                                        <td key={field.key}>
                                                            {field.key === 'Teeth' ? (
                                                                <span className={styles.teethBadge}>{detail.Teeth || '-'}</span>
                                                            ) : field.key === 'canals_no' ? (
                                                                detail.canals_no ? `${detail.canals_no} canal${detail.canals_no > 1 ? 's' : ''}` : '-'
                                                            ) : field.key === 'implant_length' || field.key === 'implant_diameter' ? (
                                                                detail[field.key] ? `${detail[field.key]} mm` : '-'
                                                            ) : (
                                                                detail[field.key] || '-'
                                                            )}
                                                        </td>
                                                    ))}
                                                    <td>
                                                        {detail.completed_date ? (
                                                            <span className={`${styles.statusBadge} ${styles.statusCompleted}`}>Completed</span>
                                                        ) : detail.start_date ? (
                                                            <span className={`${styles.statusBadge} ${styles.statusStarted}`}>Started</span>
                                                        ) : (
                                                            <span className={`${styles.statusBadge} ${styles.statusPending}`}>Pending</span>
                                                        )}
                                                    </td>
                                                    <td>
                                                        <div className={styles.actionButtons}>
                                                            <button
                                                                onClick={() => handleEditDetail(detail)}
                                                                className="btn btn-xs btn-secondary"
                                                                title="Edit"
                                                            >
                                                                <i className="fas fa-edit"></i>
                                                            </button>
                                                            <button
                                                                onClick={() => handleDeleteDetail(detail.id)}
                                                                className="btn btn-xs btn-danger"
                                                                title="Delete"
                                                            >
                                                                <i className="fas fa-trash"></i>
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                            {workDetails.length === 0 && (
                                                <tr>
                                                    <td colSpan={getWorkTypeConfig(selectedWork.type_of_work).displayFields.length + 2} className={styles.noData}>
                                                        No treatment items recorded yet
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                </Modal>
            )}

            {/* Work Detail Form Modal */}
            {showDetailForm && selectedWork && (
                <Modal
                    isOpen={true}
                    onClose={() => setShowDetailForm(false)}
                    contentClassName={`${styles.modal} ${styles.detailFormModal}`}
                    ariaLabelledBy="work-detail-form-title"
                >
                        <div className={styles.modalHeader}>
                            <h3 id="work-detail-form-title">
                                <i className={getWorkTypeConfig(selectedWork.type_of_work).icon}></i>
                                {' '}{editingDetail ? 'Edit' : 'Add'} {getWorkTypeConfig(selectedWork.type_of_work).name} Item
                            </h3>
                            <button
                                onClick={() => setShowDetailForm(false)}
                                className={styles.modalClose}
                            >
                                ×
                            </button>
                        </div>

                        <form onSubmit={handleDetailFormSubmit} className={styles.detailForm}>
                            {getWorkTypeConfig(selectedWork.type_of_work).fields.includes('teeth') && (
                                <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                                    <label>Select Teeth</label>
                                    <TeethSelector
                                        teethOptions={teethOptions}
                                        selectedTeethIds={detailFormData.TeethIds}
                                        onSelectionChange={(newTeethIds) => setDetailFormData({ ...detailFormData, TeethIds: newTeethIds })}
                                        showPermanent={showTeethPermanent}
                                        showDeciduous={showTeethDeciduous}
                                        onFilterChange={(type, value) => {
                                            if (type === 'permanent') setShowTeethPermanent(value);
                                            if (type === 'deciduous') setShowTeethDeciduous(value);
                                        }}
                                    />
                                </div>
                            )}

                            <div className={styles.formRow}>
                                {getWorkTypeConfig(selectedWork.type_of_work).fields.includes('fillingType') && (
                                    <div className={styles.formGroup}>
                                        <label>Filling Type</label>
                                        <select
                                            value={detailFormData.filling_type}
                                            onChange={(e) => setDetailFormData({ ...detailFormData, filling_type: e.target.value })}
                                        >
                                            <option value="">Select Type</option>
                                            {FILLING_TYPE_OPTIONS.map((opt: string) => (
                                                <option key={opt} value={opt}>{opt}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                {getWorkTypeConfig(selectedWork.type_of_work).fields.includes('fillingDepth') && (
                                    <div className={styles.formGroup}>
                                        <label>Filling Depth</label>
                                        <select
                                            value={detailFormData.filling_depth}
                                            onChange={(e) => setDetailFormData({ ...detailFormData, filling_depth: e.target.value })}
                                        >
                                            <option value="">Select Depth</option>
                                            {FILLING_DEPTH_OPTIONS.map((opt: string) => (
                                                <option key={opt} value={opt}>{opt}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                {getWorkTypeConfig(selectedWork.type_of_work).fields.includes('canalsNo') && (
                                    <div className={styles.formGroup}>
                                        <label>Number of Canals</label>
                                        <input
                                            type="number"
                                            value={detailFormData.canals_no}
                                            onChange={(e) => setDetailFormData({ ...detailFormData, canals_no: e.target.value })}
                                            min="1"
                                            max="5"
                                            placeholder="1-5"
                                        />
                                    </div>
                                )}

                                {getWorkTypeConfig(selectedWork.type_of_work).fields.includes('workingLength') && (
                                    <div className={styles.formGroup}>
                                        <label>Working Length</label>
                                        <input
                                            type="text"
                                            value={detailFormData.working_length}
                                            onChange={(e) => setDetailFormData({ ...detailFormData, working_length: e.target.value })}
                                            placeholder="e.g., 20mm, 18mm, 19mm"
                                        />
                                    </div>
                                )}

                                {getWorkTypeConfig(selectedWork.type_of_work).fields.includes('implantManufacturer') && (
                                    <div className={styles.formGroup}>
                                        <label>Manufacturer</label>
                                        <select
                                            value={detailFormData.implant_manufacturer_id}
                                            onChange={(e) => setDetailFormData({ ...detailFormData, implant_manufacturer_id: e.target.value })}
                                        >
                                            <option value="">Select Manufacturer...</option>
                                            {implantManufacturers.map(m => (
                                                <option key={m.id} value={m.id}>{m.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                {getWorkTypeConfig(selectedWork.type_of_work).fields.includes('implantLength') && (
                                    <div className={styles.formGroup}>
                                        <label>Implant Length (mm)</label>
                                        <input
                                            type="number"
                                            step="0.5"
                                            value={detailFormData.implant_length}
                                            onChange={(e) => setDetailFormData({ ...detailFormData, implant_length: e.target.value })}
                                            placeholder="e.g., 10, 11.5, 13"
                                        />
                                    </div>
                                )}

                                {getWorkTypeConfig(selectedWork.type_of_work).fields.includes('implantDiameter') && (
                                    <div className={styles.formGroup}>
                                        <label>Implant Diameter (mm)</label>
                                        <input
                                            type="number"
                                            step="0.1"
                                            value={detailFormData.implant_diameter}
                                            onChange={(e) => setDetailFormData({ ...detailFormData, implant_diameter: e.target.value })}
                                            placeholder="e.g., 3.5, 4.0, 5.0"
                                        />
                                    </div>
                                )}

                                {getWorkTypeConfig(selectedWork.type_of_work).fields.includes('material') && (
                                    <div className={styles.formGroup}>
                                        <label>Material</label>
                                        <select
                                            value={detailFormData.material}
                                            onChange={(e) => setDetailFormData({ ...detailFormData, material: e.target.value })}
                                        >
                                            <option value="">Select Material</option>
                                            {MATERIAL_OPTIONS.map((opt: string) => (
                                                <option key={opt} value={opt}>{opt}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                {getWorkTypeConfig(selectedWork.type_of_work).fields.includes('labName') && (
                                    <div className={styles.formGroup}>
                                        <label>Lab Name</label>
                                        <input
                                            type="text"
                                            value={detailFormData.lab_name}
                                            onChange={(e) => setDetailFormData({ ...detailFormData, lab_name: e.target.value })}
                                            placeholder="Enter lab name"
                                        />
                                    </div>
                                )}
                            </div>

                            <div className={styles.formRow}>
                                <div className={styles.formGroup}>
                                    <label>Start Date</label>
                                    <input
                                        type="date"
                                        value={detailFormData.start_date}
                                        onChange={(e) => setDetailFormData({ ...detailFormData, start_date: e.target.value })}
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>Completed Date</label>
                                    <input
                                        type="date"
                                        value={detailFormData.completed_date}
                                        onChange={(e) => setDetailFormData({ ...detailFormData, completed_date: e.target.value })}
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>Item Cost</label>
                                    <input
                                        type="text"
                                        value={displayItemCost}
                                        onChange={(e) => {
                                            const digits = e.target.value.replace(/[^\d]/g, '');
                                            const num = parseInt(digits, 10) || 0;
                                            setDisplayItemCost(num ? num.toLocaleString('en-US') : '');
                                            setDetailFormData({ ...detailFormData, item_cost: String(num) });
                                        }}
                                        onBlur={() => setDisplayItemCost(detailFormData.item_cost ? formatNumber(detailFormData.item_cost) : '')}
                                        placeholder="Optional"
                                    />
                                </div>
                            </div>

                            <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                                <label>Notes</label>
                                <textarea
                                    value={detailFormData.note}
                                    onChange={(e) => setDetailFormData({ ...detailFormData, note: e.target.value })}
                                    rows={3}
                                    placeholder="Additional notes..."
                                />
                            </div>

                            <div className={styles.formActions}>
                                <button
                                    type="button"
                                    onClick={() => setShowDetailForm(false)}
                                    className="btn btn-secondary"
                                >
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary">
                                    {editingDetail ? 'Update Item' : 'Add Item'}
                                </button>
                            </div>
                        </form>
                </Modal>
            )}

            {/* Payment Modal */}
            {showPaymentModal && selectedWorkForPayment && (
                <PaymentModal
                    workData={selectedWorkForPayment}
                    onClose={() => {
                        setShowPaymentModal(false);
                        setSelectedWorkForPayment(null);
                        loadWorks();
                    }}
                    onSuccess={() => {
                        setSuccessMessage('Payment added successfully!');
                    }}
                />
            )}

            {/* Payment History Modal */}
            {showPaymentHistoryModal && selectedWorkForPayment && (
                <Modal
                    isOpen={true}
                    onClose={() => setShowPaymentHistoryModal(false)}
                    contentClassName={`${styles.modal} ${styles.detailsModal}`}
                    ariaLabelledBy="payment-history-title"
                >
                        <div className={styles.modalHeader}>
                            <h3 id="payment-history-title">Payment History - {selectedWorkForPayment.type_name || 'Work #' + selectedWorkForPayment.work_id}</h3>
                            <button
                                onClick={() => setShowPaymentHistoryModal(false)}
                                className={styles.modalClose}
                            >
                                ×
                            </button>
                        </div>
                        <div className={styles.modalContentScroll}>

                            <div className={styles.paymentSummaryBox}>
                                <div className={styles.paymentSummaryGrid}>
                                    <div className={styles.paymentSummaryItem}>
                                        <span className={styles.paymentSummaryLabel}>Total Required:</span>
                                        <span className={`${styles.paymentSummaryValue} ${styles.paymentSummaryValueTotal}`}>
                                            {formatCurrency(selectedWorkForPayment.total_required, selectedWorkForPayment.currency)}
                                        </span>
                                    </div>
                                    <div className={styles.paymentSummaryItem}>
                                        <span className={styles.paymentSummaryLabel}>Total Paid:</span>
                                        <span className={`${styles.paymentSummaryValue} ${styles.paymentSummaryValuePaid}`}>
                                            {formatCurrency(selectedWorkForPayment.TotalPaid, selectedWorkForPayment.currency)}
                                        </span>
                                    </div>
                                    <div className={styles.paymentSummaryItem}>
                                        <span className={styles.paymentSummaryLabel}>Balance Remaining:</span>
                                        <span className={`${styles.paymentSummaryValue} ${styles.paymentSummaryValueBalance}`}>
                                            {formatCurrency((selectedWorkForPayment.total_required || 0) - (selectedWorkForPayment.TotalPaid || 0), selectedWorkForPayment.currency)}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {loadingPayments ? (
                                <div className={styles.loading}>
                                    Loading payment history...
                                </div>
                            ) : (
                                <div className={styles.detailsTableContainer}>
                                    <table className={styles.detailsTable}>
                                        <thead>
                                            <tr>
                                                <th>Date</th>
                                                <th>Amount Paid ({selectedWorkForPayment.currency})</th>
                                                <th>Actual Amount</th>
                                                <th>Actual Currency</th>
                                                <th>Change</th>
                                                <th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {paymentHistory.map((payment, index) => (
                                                <tr key={payment.InvoiceID || index}>
                                                    <td>{formatDate(payment.date_of_payment)}</td>
                                                    <td className={styles.paymentAmount}>
                                                        {formatCurrency(payment.amount_paid, selectedWorkForPayment.currency)}
                                                    </td>
                                                    <td>{payment.actual_amount ? formatCurrency(payment.actual_amount, payment.actual_cur) : '-'}</td>
                                                    <td>{payment.actual_cur || '-'}</td>
                                                    <td>{payment.change ? formatCurrency(payment.change, payment.actual_cur) : '-'}</td>
                                                    <td>
                                                        <div className={styles.paymentActions}>
                                                            <button
                                                                onClick={() => {
                                                                    toast.info(`Edit payment functionality coming soon!\n\nPayment ID: ${payment.InvoiceID}\nAmount: ${formatCurrency(payment.amount_paid, selectedWorkForPayment.currency)}`);
                                                                }}
                                                                className={styles.btnActionEdit}
                                                                title="Edit Payment"
                                                            >
                                                                <i className="fas fa-edit"></i>
                                                            </button>
                                                            <button
                                                                onClick={async () => {
                                                                    if (await confirm(`Are you sure you want to delete this payment?\n\nAmount: ${formatCurrency(payment.amount_paid, selectedWorkForPayment.currency)}\nDate: ${formatDate(payment.date_of_payment)}\n\nThis action cannot be undone.`, { title: 'Delete Payment', danger: true, confirmText: 'Delete' })) {
                                                                        try {
                                                                            const response = await fetch(`/api/deleteInvoice/${payment.InvoiceID}`, {
                                                                                method: 'DELETE'
                                                                            });
                                                                            const result = await response.json();
                                                                            if (result.status === 'success') {
                                                                                toast.success('Payment deleted successfully!');
                                                                                loadPaymentHistory(selectedWorkForPayment.work_id);
                                                                                loadWorks();
                                                                            } else {
                                                                                throw new Error(result.message || 'Failed to delete payment');
                                                                            }
                                                                        } catch (error) {
                                                                            console.error('Error deleting payment:', error);
                                                                            toast.error(`Error deleting payment: ${error instanceof Error ? error.message : 'Unknown error'}`);
                                                                        }
                                                                    }
                                                                }}
                                                                className={styles.btnActionDelete}
                                                                title="Delete Payment"
                                                            >
                                                                <i className="fas fa-trash"></i>
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                            {paymentHistory.length === 0 && (
                                                <tr>
                                                    <td colSpan={6} className={styles.noData}>
                                                        No payments recorded yet for this work
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            <div className={styles.paymentHistoryFooter}>
                                {((selectedWorkForPayment.total_required || 0) - (selectedWorkForPayment.TotalPaid || 0)) > 0 ? (
                                    <button
                                        onClick={() => {
                                            setShowPaymentHistoryModal(false);
                                            handleAddPayment(selectedWorkForPayment);
                                        }}
                                        className={`btn btn-primary ${styles.addPaymentBtn}`}
                                    >
                                        <i className="fas fa-plus"></i> Add New Payment
                                    </button>
                                ) : (
                                    <div className={styles.paymentFullyPaid}>
                                        <i className="fas fa-check-circle"></i> This work is fully paid
                                    </div>
                                )}
                            </div>
                        </div>
                </Modal>
            )}

            {/* Delete Confirmation Modal */}
            {showDeleteConfirmation && workToDelete && (
                <Modal
                    isOpen={true}
                    onClose={cancelDeleteWork}
                    contentClassName={`whatsapp-modal ${styles.confirmDialog}`}
                    ariaLabelledBy="delete-work-title"
                >
                        <div className="whatsapp-modal-header">
                            <h3 id="delete-work-title" className={`whatsapp-modal-title ${styles.confirmTitle}`}>
                                <i className="fas fa-exclamation-triangle"></i> Confirm Delete Work
                            </h3>
                            <button onClick={cancelDeleteWork} className="whatsapp-modal-close">
                                ×
                            </button>
                        </div>
                        <div className={styles.confirmBody}>
                            <p className={styles.confirmIntro}>
                                Are you sure you want to delete this work?
                            </p>
                            <div className={styles.confirmDetailsBox}>
                                <p className={styles.confirmDetailLine}>
                                    <strong>Work Type:</strong> {workToDelete.type_name || 'N/A'}
                                </p>
                                <p className={styles.confirmDetailLine}>
                                    <strong>Doctor:</strong> {workToDelete.doctor_name || 'N/A'}
                                </p>
                                <p className={styles.confirmDetailLine}>
                                    <strong>Total Required:</strong> {formatCurrency(workToDelete.total_required, workToDelete.currency)}
                                </p>
                            </div>
                            <p className={`${styles.confirmWarning} ${styles.confirmWarningStrong}`}>
                                ⚠️ This action cannot be undone!
                            </p>
                        </div>
                        <div className="whatsapp-actions">
                            <button onClick={cancelDeleteWork} className="whatsapp-btn-cancel">
                                <i className="fas fa-times"></i> Cancel
                            </button>
                            <button
                                onClick={confirmDeleteWork}
                                className={`whatsapp-btn-send ${styles.confirmActionButton}`}
                            >
                                <i className="fas fa-trash"></i> Delete Work
                            </button>
                        </div>
                </Modal>
            )}

            {/* Work Status Confirmation Modal */}
            {confirmationModal.show && confirmationModal.work && (() => {
                const config = getConfirmationModalContent();
                if (!config) return null;
                return (
                    <Modal
                        isOpen={true}
                        onClose={closeConfirmationModal}
                        contentClassName={`whatsapp-modal ${styles.confirmDialog}`}
                        ariaLabelledBy="confirm-action-title"
                    >
                            <div style={{ '--confirm-accent': config.color } as React.CSSProperties}>
                                <div className="whatsapp-modal-header">
                                    <h3 id="confirm-action-title" className={`whatsapp-modal-title ${styles.confirmTitle}`}>
                                        <i className={`fas ${config.icon}`}></i> {config.title}
                                    </h3>
                                    <button onClick={closeConfirmationModal} className="whatsapp-modal-close">
                                        ×
                                    </button>
                                </div>
                                <div className={styles.confirmBody}>
                                    <p className={styles.confirmIntro}>
                                        {config.message}
                                    </p>
                                    <div className={styles.confirmDetailsBox}>
                                        <p className={styles.confirmDetailLine}>
                                            <strong>Work Type:</strong> {config.work.type_name || 'N/A'}
                                        </p>
                                        <p className={styles.confirmDetailLine}>
                                            <strong>Doctor:</strong> {config.work.doctor_name || 'N/A'}
                                        </p>
                                        <p className={styles.confirmDetailLine}>
                                            <strong>Total Required:</strong> {formatCurrency(config.work.total_required, config.work.currency)}
                                        </p>
                                    </div>
                                    <p className={styles.confirmWarning}>
                                        {config.warning}
                                    </p>
                                </div>
                                <div className="whatsapp-actions">
                                    <button onClick={closeConfirmationModal} className="whatsapp-btn-cancel">
                                        <i className="fas fa-times"></i> Cancel
                                    </button>
                                    <button
                                        onClick={executeConfirmedAction}
                                        className={`whatsapp-btn-send ${styles.confirmActionButton}`}
                                    >
                                        <i className={`fas ${config.buttonIcon}`}></i> {config.buttonText}
                                    </button>
                                </div>
                            </div>
                    </Modal>
                );
            })()}

            {/* Transfer Work Modal (Admin Only) */}
            {showTransferModal && workToTransfer && (
                <TransferWorkModal
                    work={workToTransfer}
                    onClose={() => {
                        setShowTransferModal(false);
                        setWorkToTransfer(null);
                    }}
                    onSuccess={handleTransferSuccess}
                />
            )}
        </div>
    );
};

export default React.memo(WorkComponent);
