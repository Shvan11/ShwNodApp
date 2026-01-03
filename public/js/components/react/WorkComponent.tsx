import React, { useState, useEffect, type FormEvent, type ChangeEvent, type SyntheticEvent, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import WorkCard, { type Work, type WorkStatus } from './WorkCard';
import PaymentModal from './PaymentModal';
import TeethSelector from './TeethSelector';
import { formatCurrency as formatCurrencyUtil, formatNumber } from '../../utils/formatters';
import { useToast } from '../../contexts/ToastContext';
import {
    getWorkTypeConfig,
    MATERIAL_OPTIONS,
    FILLING_TYPE_OPTIONS,
    FILLING_DEPTH_OPTIONS
} from '../../config/workTypeConfig';
import styles from './WorkComponent.module.css';

interface PatientInfo {
    PersonID: number;
    PatientName: string;
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
    ID: number;
    WorkID: number;
    TeethIds?: number[];
    Teeth?: string;
    FillingType?: string;
    FillingDepth?: string;
    CanalsNo?: number;
    WorkingLength?: string;
    ImplantLength?: number;
    ImplantDiameter?: number;
    ImplantManufacturerID?: number;
    Material?: string;
    LabName?: string;
    ItemCost?: number;
    StartDate?: string;
    CompletedDate?: string;
    Note?: string;
    // Allow dynamic access for work type display fields
    [key: string]: string | number | number[] | undefined;
}

interface DetailFormData {
    WorkID: number | null;
    TeethIds: number[];
    FillingType: string;
    FillingDepth: string;
    CanalsNo: string;
    WorkingLength: string;
    ImplantLength: string;
    ImplantDiameter: string;
    ImplantManufacturerID: string;
    Material: string;
    LabName: string;
    ItemCost: string;
    StartDate: string;
    CompletedDate: string;
    Note: string;
}

interface ToothOption {
    ID: number;
    ToothCode: string;
    ToothName: string;
    Quadrant: 'UR' | 'UL' | 'LR' | 'LL';
    IsPermanent: boolean;
}

interface ImplantManufacturer {
    id: number;
    name: string;
}

interface Payment {
    InvoiceID: number;
    Dateofpayment: string;
    Amountpaid: number;
    ActualAmount?: number;
    ActualCur?: string;
    Change?: number;
}

interface WorkComponentProps {
    personId?: number | null;
}

/**
 * Work Component
 * Displays list of patient's treatment works
 * Memoized to prevent unnecessary re-renders when personId hasn't changed
 */
const WorkComponent = ({ personId }: WorkComponentProps) => {
    const navigate = useNavigate();
    const toast = useToast();
    const [works, setWorks] = useState<Work[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
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

    // Work detail form state - includes all possible fields for all work types
    const [detailFormData, setDetailFormData] = useState<DetailFormData>({
        WorkID: null,
        TeethIds: [],
        FillingType: '',
        FillingDepth: '',
        CanalsNo: '',
        WorkingLength: '',
        ImplantLength: '',
        ImplantDiameter: '',
        ImplantManufacturerID: '',
        Material: '',
        LabName: '',
        ItemCost: '',
        StartDate: '',
        CompletedDate: '',
        Note: ''
    });

    // Teeth options for multi-select
    const [teethOptions, setTeethOptions] = useState<ToothOption[]>([]);
    const [showTeethPermanent, setShowTeethPermanent] = useState(true);
    const [showTeethDeciduous, setShowTeethDeciduous] = useState(false);

    // Implant manufacturers for dropdown
    const [implantManufacturers, setImplantManufacturers] = useState<ImplantManufacturer[]>([]);

    // Work Status Constants (must match backend)
    const WORK_STATUS: WorkStatus = {
        ACTIVE: 1,
        FINISHED: 2,
        DISCONTINUED: 3
    };

    useEffect(() => {
        if (personId) {
            loadWorks();
            loadPatientInfo();
            checkAppointmentStatus();
            loadTeethOptions();
            loadImplantManufacturers();
        }
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
            const firstActiveWork = works.find(work => work.Status === WORK_STATUS.ACTIVE);
            if (firstActiveWork) {
                setExpandedWorks(new Set([firstActiveWork.workid]));
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
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setLoading(false);
        }
    };

    const handleAddWork = () => {
        navigate(`/patient/${personId}/new-work`);
    };

    const handleEditWork = (work: Work) => {
        navigate(`/patient/${personId}/new-work?workId=${work.workid}`);
    };

    const handleCompleteWork = async (workId: number) => {
        if (!confirm('Are you sure you want to mark this work as completed?')) return;

        try {
            const response = await fetch('/api/finishwork', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workId })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to complete work');
            }

            toast.success('Work marked as completed');
            await loadWorks();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        }
    };

    const handleDiscontinueWork = async (workId: number) => {
        if (!confirm('Are you sure you want to mark this work as discontinued?\n\nThis indicates the patient has abandoned treatment.')) return;

        try {
            const response = await fetch('/api/discontinuework', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workId })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to discontinue work');
            }

            toast.success('Work marked as discontinued');
            await loadWorks();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        }
    };

    const handleReactivateWork = async (work: Work) => {
        if (!confirm('Are you sure you want to reactivate this work?\n\nThis will make it the active work for this patient.')) return;

        try {
            const response = await fetch('/api/reactivatework', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workId: work.workid, personId: work.PersonID })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || errorData.error || 'Failed to reactivate work');
            }

            toast.success('Work reactivated successfully');
            await loadWorks();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        }
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
                body: JSON.stringify({ workId: work.workid })
            });

            const result = await response.json();

            if (!response.ok) {
                // Handle dependency error with detailed message
                if (response.status === 409 && result.dependencies) {
                    const deps = result.dependencies;
                    let detailMessage = '⚠️ CANNOT DELETE WORK - EXISTING RECORDS FOUND ⚠️\n\n';
                    detailMessage += 'This work has the following records that must be deleted first:\n\n';

                    if (deps.InvoiceCount > 0) detailMessage += `• ${deps.InvoiceCount} payment(s)\n`;
                    if (deps.VisitCount > 0) detailMessage += `• ${deps.VisitCount} visit(s)\n`;
                    if (deps.DetailCount > 0) detailMessage += `• ${deps.DetailCount} treatment detail(s)\n`;
                    if (deps.DiagnosisCount > 0) detailMessage += `• ${deps.DiagnosisCount} diagnosis(es)\n`;
                    if (deps.ImplantCount > 0) detailMessage += `• ${deps.ImplantCount} implant(s)\n`;
                    if (deps.ScrewCount > 0) detailMessage += `• ${deps.ScrewCount} screw(s)\n`;

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

    const handleViewDetails = async (work: Work) => {
        setSelectedWork(work);
        setShowDetailsModal(true);
        await loadWorkDetails(work.workid);
    };

    const loadWorkDetails = async (workId: number) => {
        try {
            const response = await fetch(`/api/getworkdetailslist?workId=${workId}`);
            if (!response.ok) throw new Error('Failed to fetch work details');
            const data: WorkDetail[] = await response.json();
            setWorkDetails(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        }
    };

    const handleAddDetail = () => {
        if (!selectedWork) return;
        setEditingDetail(null);
        setDetailFormData({
            WorkID: selectedWork.workid,
            TeethIds: [],
            FillingType: '',
            FillingDepth: '',
            CanalsNo: '',
            WorkingLength: '',
            ImplantLength: '',
            ImplantDiameter: '',
            ImplantManufacturerID: '',
            Material: '',
            LabName: '',
            ItemCost: '',
            StartDate: '',
            CompletedDate: '',
            Note: ''
        });
        setShowDetailForm(true);
    };

    const handleEditDetail = (detail: WorkDetail) => {
        setEditingDetail(detail);
        setDetailFormData({
            WorkID: detail.WorkID,
            TeethIds: detail.TeethIds || [],
            FillingType: detail.FillingType || '',
            FillingDepth: detail.FillingDepth || '',
            CanalsNo: String(detail.CanalsNo || ''),
            WorkingLength: detail.WorkingLength || '',
            ImplantLength: String(detail.ImplantLength || ''),
            ImplantDiameter: String(detail.ImplantDiameter || ''),
            ImplantManufacturerID: String(detail.ImplantManufacturerID || ''),
            Material: detail.Material || '',
            LabName: detail.LabName || '',
            ItemCost: String(detail.ItemCost || ''),
            StartDate: detail.StartDate ? detail.StartDate.split('T')[0] : '',
            CompletedDate: detail.CompletedDate ? detail.CompletedDate.split('T')[0] : '',
            Note: detail.Note || ''
        });
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
                    body: JSON.stringify({ detailId: editingDetail.ID, ...detailFormData })
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
                await loadWorkDetails(selectedWork.workid);
            }
            setShowDetailForm(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        }
    };

    const handleDeleteDetail = async (detailId: number) => {
        if (!confirm('Are you sure you want to delete this work detail?')) return;

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
                await loadWorkDetails(selectedWork.workid);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        }
    };

    const getProgressPercentage = (work: Work): number => {
        if (work.Status === WORK_STATUS.FINISHED) return 100;
        if (work.Status === WORK_STATUS.DISCONTINUED) return 0;
        if (!work.StartDate) return 0;

        let progress = 25;
        // Note: IPhotoDate, DebondDate, FPhotoDate may need to be added to Work interface
        return progress;
    };

    const filteredWorks = works
        .filter(work => {
            const matchesSearch = work.Notes?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                work.DoctorName?.toLowerCase().includes(searchTerm.toLowerCase());

            const matchesFilter = filterStatus === 'all' ||
                (filterStatus === 'active' && work.Status === WORK_STATUS.ACTIVE) ||
                (filterStatus === 'completed' && work.Status === WORK_STATUS.FINISHED) ||
                (filterStatus === 'discontinued' && work.Status === WORK_STATUS.DISCONTINUED);

            return matchesSearch && matchesFilter;
        })
        .sort((a, b) => {
            if (a.Status === WORK_STATUS.ACTIVE && b.Status !== WORK_STATUS.ACTIVE) return -1;
            if (a.Status !== WORK_STATUS.ACTIVE && b.Status === WORK_STATUS.ACTIVE) return 1;
            if (a.Status === WORK_STATUS.DISCONTINUED && b.Status === WORK_STATUS.FINISHED) return -1;
            if (a.Status === WORK_STATUS.FINISHED && b.Status === WORK_STATUS.DISCONTINUED) return 1;

            const dateA = new Date(a.AdditionDate || 0);
            const dateB = new Date(b.AdditionDate || 0);
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
        return [19, 20, 21].includes(work.Typeofwork);
    };

    const handleAddAlignerSet = (work: Work) => {
        navigate(`/aligner/patient/${work.workid}`);
    };

    const handleAddPayment = (work: Work) => {
        setSelectedWorkForPayment(work);
        setShowPaymentModal(true);
    };

    const handleViewPaymentHistory = async (work: Work) => {
        setSelectedWorkForPayment(work);
        setShowPaymentHistoryModal(true);
        await loadPaymentHistory(work.workid);
    };

    const loadPaymentHistory = async (workId: number) => {
        try {
            setLoadingPayments(true);
            const response = await fetch(`/api/getpaymenthistory?workId=${workId}`);
            if (!response.ok) throw new Error('Failed to fetch payment history');
            const data: Payment[] = await response.json();
            setPaymentHistory(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
            setPaymentHistory([]);
        } finally {
            setLoadingPayments(false);
        }
    };

    const handlePrintReceipt = (work: Work) => {
        console.log('🖨️ [PRINT RECEIPT] Button clicked for work:', work.workid);

        window.open(`/api/templates/receipt/work/${work.workid}`, '_blank');
        console.log('🖨️ [PRINT RECEIPT] Receipt window opened');

        console.log('📱 [WHATSAPP] Starting WhatsApp send for work:', work.workid);
        fetch('/api/wa/send-receipt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workId: work.workid })
        })
            .then(res => {
                console.log('📱 [WHATSAPP] Response status:', res.status);
                return res.json();
            })
            .then(result => {
                console.log('📱 [WHATSAPP] Response data:', result);
                if (result.success) {
                    toast.success('Receipt sent via WhatsApp!', 3000);
                    console.log('✅ [WHATSAPP] Success toast shown');
                } else {
                    const errorMsg = result.message || 'Failed to send WhatsApp receipt';
                    toast.error(errorMsg, 5000);
                    console.error('❌ [WHATSAPP] Error:', errorMsg);
                }
            })
            .catch((err) => {
                toast.error('Network error: Could not send WhatsApp receipt', 5000);
                console.error('❌ [WHATSAPP] Network error:', err);
            });
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
                    PersonID: personId
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
            setError(err instanceof Error ? err.message : 'An error occurred');
            setTimeout(() => setError(null), 5000);
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
                            alt={`${patientInfo.PatientName} - Smile`}
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
                                    {patientInfo.PatientName}
                                </h3>
                                <div className={styles.patientMetaInfo}>
                                    <span><i className="fas fa-id-card"></i>{patientInfo.PersonID}</span>
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
                                    <span className={styles.summaryValueInline}>{works.filter(w => w.Status === WORK_STATUS.ACTIVE).length}</span>
                                    <span className={styles.summaryLabelInline}>Active</span>
                                </div>
                                <div className={styles.summaryCardInline}>
                                    <span className={styles.summaryValueInline}>{works.filter(w => w.Status === WORK_STATUS.FINISHED).length}</span>
                                    <span className={styles.summaryLabelInline}>Completed</span>
                                </div>
                                <div className={styles.summaryCardInline}>
                                    <span className={styles.summaryValueInline}>{works.filter(w => w.Status === WORK_STATUS.DISCONTINUED).length}</span>
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
                            onClick={() => handleAddAlignerSet({ workid: newAlignerWorkId } as Work)}
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
                        key={work.workid}
                        work={work}
                        personId={personId}
                        isAlignerWork={isAlignerWork}
                        isExpanded={expandedWorks.has(work.workid)}
                        onToggleExpanded={() => toggleWorkExpanded(work.workid)}
                        onViewDetails={handleViewDetails}
                        onEdit={handleEditWork}
                        onDelete={handleDeleteWork}
                        onAddPayment={handleAddPayment}
                        onViewPaymentHistory={handleViewPaymentHistory}
                        onAddAlignerSet={handleAddAlignerSet}
                        onComplete={handleCompleteWork}
                        onDiscontinue={handleDiscontinueWork}
                        onReactivate={handleReactivateWork}
                        onViewVisits={(work) => navigate(`/patient/${personId}/visits?workId=${work.workid}`)}
                        onNewVisit={(work) => navigate(`/patient/${personId}/new-visit?workId=${work.workid}`)}
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
                <div className={styles.modalOverlay}>
                    <div className={`${styles.modal} ${styles.detailsModal}`}>
                        <div className={styles.modalHeader}>
                            <h3>Work Details - {selectedWork.TypeName || 'Work #' + selectedWork.workid}</h3>
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
                                        <span className={styles.workId}>{selectedWork.workid}</span>
                                    </div>
                                </div>
                            </div>

                            <div className={styles.detailsSection}>
                                <div className={styles.sectionHeader}>
                                    <h4>
                                        <i className={getWorkTypeConfig(selectedWork.Typeofwork).icon}></i>
                                        {' '}{getWorkTypeConfig(selectedWork.Typeofwork).name} Details
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
                                                {getWorkTypeConfig(selectedWork.Typeofwork).displayFields.map((field: { key: string; label: string }) => (
                                                    <th key={field.key}>{field.label}</th>
                                                ))}
                                                <th>Status</th>
                                                <th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {workDetails.map((detail) => (
                                                <tr key={detail.ID}>
                                                    {getWorkTypeConfig(selectedWork.Typeofwork).displayFields.map((field: { key: string; label: string }) => (
                                                        <td key={field.key}>
                                                            {field.key === 'Teeth' ? (
                                                                <span className={styles.teethBadge}>{detail.Teeth || '-'}</span>
                                                            ) : field.key === 'CanalsNo' ? (
                                                                detail.CanalsNo ? `${detail.CanalsNo} canal${detail.CanalsNo > 1 ? 's' : ''}` : '-'
                                                            ) : field.key === 'ImplantLength' || field.key === 'ImplantDiameter' ? (
                                                                detail[field.key] ? `${detail[field.key]} mm` : '-'
                                                            ) : (
                                                                detail[field.key] || '-'
                                                            )}
                                                        </td>
                                                    ))}
                                                    <td>
                                                        {detail.CompletedDate ? (
                                                            <span className={`${styles.statusBadge} ${styles.statusCompleted}`}>Completed</span>
                                                        ) : detail.StartDate ? (
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
                                                                onClick={() => handleDeleteDetail(detail.ID)}
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
                                                    <td colSpan={getWorkTypeConfig(selectedWork.Typeofwork).displayFields.length + 2} className={styles.noData}>
                                                        No treatment items recorded yet
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Work Detail Form Modal */}
            {showDetailForm && selectedWork && (
                <div className={styles.modalOverlay}>
                    <div className={`${styles.modal} ${styles.detailFormModal}`}>
                        <div className={styles.modalHeader}>
                            <h3>
                                <i className={getWorkTypeConfig(selectedWork.Typeofwork).icon}></i>
                                {' '}{editingDetail ? 'Edit' : 'Add'} {getWorkTypeConfig(selectedWork.Typeofwork).name} Item
                            </h3>
                            <button
                                onClick={() => setShowDetailForm(false)}
                                className={styles.modalClose}
                            >
                                ×
                            </button>
                        </div>

                        <form onSubmit={handleDetailFormSubmit} className={styles.detailForm}>
                            {getWorkTypeConfig(selectedWork.Typeofwork).fields.includes('teeth') && (
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
                                {getWorkTypeConfig(selectedWork.Typeofwork).fields.includes('fillingType') && (
                                    <div className={styles.formGroup}>
                                        <label>Filling Type</label>
                                        <select
                                            value={detailFormData.FillingType}
                                            onChange={(e) => setDetailFormData({ ...detailFormData, FillingType: e.target.value })}
                                        >
                                            <option value="">Select Type</option>
                                            {FILLING_TYPE_OPTIONS.map((opt: string) => (
                                                <option key={opt} value={opt}>{opt}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                {getWorkTypeConfig(selectedWork.Typeofwork).fields.includes('fillingDepth') && (
                                    <div className={styles.formGroup}>
                                        <label>Filling Depth</label>
                                        <select
                                            value={detailFormData.FillingDepth}
                                            onChange={(e) => setDetailFormData({ ...detailFormData, FillingDepth: e.target.value })}
                                        >
                                            <option value="">Select Depth</option>
                                            {FILLING_DEPTH_OPTIONS.map((opt: string) => (
                                                <option key={opt} value={opt}>{opt}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                {getWorkTypeConfig(selectedWork.Typeofwork).fields.includes('canalsNo') && (
                                    <div className={styles.formGroup}>
                                        <label>Number of Canals</label>
                                        <input
                                            type="number"
                                            value={detailFormData.CanalsNo}
                                            onChange={(e) => setDetailFormData({ ...detailFormData, CanalsNo: e.target.value })}
                                            min="1"
                                            max="5"
                                            placeholder="1-5"
                                        />
                                    </div>
                                )}

                                {getWorkTypeConfig(selectedWork.Typeofwork).fields.includes('workingLength') && (
                                    <div className={styles.formGroup}>
                                        <label>Working Length</label>
                                        <input
                                            type="text"
                                            value={detailFormData.WorkingLength}
                                            onChange={(e) => setDetailFormData({ ...detailFormData, WorkingLength: e.target.value })}
                                            placeholder="e.g., 20mm, 18mm, 19mm"
                                        />
                                    </div>
                                )}

                                {getWorkTypeConfig(selectedWork.Typeofwork).fields.includes('implantManufacturer') && (
                                    <div className={styles.formGroup}>
                                        <label>Manufacturer</label>
                                        <select
                                            value={detailFormData.ImplantManufacturerID}
                                            onChange={(e) => setDetailFormData({ ...detailFormData, ImplantManufacturerID: e.target.value })}
                                        >
                                            <option value="">Select Manufacturer...</option>
                                            {implantManufacturers.map(m => (
                                                <option key={m.id} value={m.id}>{m.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                {getWorkTypeConfig(selectedWork.Typeofwork).fields.includes('implantLength') && (
                                    <div className={styles.formGroup}>
                                        <label>Implant Length (mm)</label>
                                        <input
                                            type="number"
                                            step="0.5"
                                            value={detailFormData.ImplantLength}
                                            onChange={(e) => setDetailFormData({ ...detailFormData, ImplantLength: e.target.value })}
                                            placeholder="e.g., 10, 11.5, 13"
                                        />
                                    </div>
                                )}

                                {getWorkTypeConfig(selectedWork.Typeofwork).fields.includes('implantDiameter') && (
                                    <div className={styles.formGroup}>
                                        <label>Implant Diameter (mm)</label>
                                        <input
                                            type="number"
                                            step="0.1"
                                            value={detailFormData.ImplantDiameter}
                                            onChange={(e) => setDetailFormData({ ...detailFormData, ImplantDiameter: e.target.value })}
                                            placeholder="e.g., 3.5, 4.0, 5.0"
                                        />
                                    </div>
                                )}

                                {getWorkTypeConfig(selectedWork.Typeofwork).fields.includes('material') && (
                                    <div className={styles.formGroup}>
                                        <label>Material</label>
                                        <select
                                            value={detailFormData.Material}
                                            onChange={(e) => setDetailFormData({ ...detailFormData, Material: e.target.value })}
                                        >
                                            <option value="">Select Material</option>
                                            {MATERIAL_OPTIONS.map((opt: string) => (
                                                <option key={opt} value={opt}>{opt}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                {getWorkTypeConfig(selectedWork.Typeofwork).fields.includes('labName') && (
                                    <div className={styles.formGroup}>
                                        <label>Lab Name</label>
                                        <input
                                            type="text"
                                            value={detailFormData.LabName}
                                            onChange={(e) => setDetailFormData({ ...detailFormData, LabName: e.target.value })}
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
                                        value={detailFormData.StartDate}
                                        onChange={(e) => setDetailFormData({ ...detailFormData, StartDate: e.target.value })}
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>Completed Date</label>
                                    <input
                                        type="date"
                                        value={detailFormData.CompletedDate}
                                        onChange={(e) => setDetailFormData({ ...detailFormData, CompletedDate: e.target.value })}
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>Item Cost</label>
                                    <input
                                        type="number"
                                        value={detailFormData.ItemCost}
                                        onChange={(e) => setDetailFormData({ ...detailFormData, ItemCost: e.target.value })}
                                        placeholder="Optional"
                                        min="0"
                                    />
                                </div>
                            </div>

                            <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                                <label>Notes</label>
                                <textarea
                                    value={detailFormData.Note}
                                    onChange={(e) => setDetailFormData({ ...detailFormData, Note: e.target.value })}
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
                    </div>
                </div>
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
                <div className={styles.modalOverlay}>
                    <div className={`${styles.modal} ${styles.detailsModal}`}>
                        <div className={styles.modalHeader}>
                            <h3>Payment History - {selectedWorkForPayment.TypeName || 'Work #' + selectedWorkForPayment.workid}</h3>
                            <button
                                onClick={() => {
                                    console.log('CLOSE BUTTON CLICKED!');
                                    setShowPaymentHistoryModal(false);
                                }}
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
                                            {formatCurrency(selectedWorkForPayment.TotalRequired, selectedWorkForPayment.Currency)}
                                        </span>
                                    </div>
                                    <div className={styles.paymentSummaryItem}>
                                        <span className={styles.paymentSummaryLabel}>Total Paid:</span>
                                        <span className={`${styles.paymentSummaryValue} ${styles.paymentSummaryValuePaid}`}>
                                            {formatCurrency(selectedWorkForPayment.TotalPaid, selectedWorkForPayment.Currency)}
                                        </span>
                                    </div>
                                    <div className={styles.paymentSummaryItem}>
                                        <span className={styles.paymentSummaryLabel}>Balance Remaining:</span>
                                        <span className={`${styles.paymentSummaryValue} ${styles.paymentSummaryValueBalance}`}>
                                            {formatCurrency((selectedWorkForPayment.TotalRequired || 0) - (selectedWorkForPayment.TotalPaid || 0), selectedWorkForPayment.Currency)}
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
                                                <th>Amount Paid ({selectedWorkForPayment.Currency})</th>
                                                <th>Actual Amount</th>
                                                <th>Actual Currency</th>
                                                <th>Change</th>
                                                <th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {paymentHistory.map((payment, index) => (
                                                <tr key={payment.InvoiceID || index}>
                                                    <td>{formatDate(payment.Dateofpayment)}</td>
                                                    <td className={styles.paymentAmount}>
                                                        {formatCurrency(payment.Amountpaid, selectedWorkForPayment.Currency)}
                                                    </td>
                                                    <td>{payment.ActualAmount ? formatCurrency(payment.ActualAmount, payment.ActualCur) : '-'}</td>
                                                    <td>{payment.ActualCur || '-'}</td>
                                                    <td>{payment.Change ? formatCurrency(payment.Change, payment.ActualCur) : '-'}</td>
                                                    <td>
                                                        <div className={styles.paymentActions}>
                                                            <button
                                                                onClick={() => {
                                                                    toast.info(`Edit payment functionality coming soon!\n\nPayment ID: ${payment.InvoiceID}\nAmount: ${formatCurrency(payment.Amountpaid, selectedWorkForPayment.Currency)}`);
                                                                }}
                                                                className={styles.btnActionEdit}
                                                                title="Edit Payment"
                                                            >
                                                                <i className="fas fa-edit"></i>
                                                            </button>
                                                            <button
                                                                onClick={async () => {
                                                                    if (window.confirm(`Are you sure you want to delete this payment?\n\nAmount: ${formatCurrency(payment.Amountpaid, selectedWorkForPayment.Currency)}\nDate: ${formatDate(payment.Dateofpayment)}\n\nThis action cannot be undone.`)) {
                                                                        try {
                                                                            const response = await fetch(`/api/deleteInvoice/${payment.InvoiceID}`, {
                                                                                method: 'DELETE'
                                                                            });
                                                                            const result = await response.json();
                                                                            if (result.status === 'success') {
                                                                                toast.success('Payment deleted successfully!');
                                                                                loadPaymentHistory(selectedWorkForPayment.workid);
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
                                {((selectedWorkForPayment.TotalRequired || 0) - (selectedWorkForPayment.TotalPaid || 0)) > 0 ? (
                                    <button
                                        onClick={() => {
                                            setShowPaymentHistoryModal(false);
                                            handleAddPayment(selectedWorkForPayment);
                                        }}
                                        className="btn btn-primary btn-add-payment"
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
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {showDeleteConfirmation && workToDelete && (
                <div className={styles.modalOverlay} onClick={cancelDeleteWork}>
                    <div className="whatsapp-modal" onClick={(e: MouseEvent) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
                        <div className="whatsapp-modal-header">
                            <h3 className="whatsapp-modal-title" style={{ color: 'var(--error-color)' }}>
                                <i className="fas fa-exclamation-triangle"></i> Confirm Delete Work
                            </h3>
                            <button onClick={cancelDeleteWork} className="whatsapp-modal-close">
                                ×
                            </button>
                        </div>
                        <div style={{ marginBottom: 'var(--spacing-lg)' }}>
                            <p style={{ marginBottom: 'var(--spacing-md)', fontSize: 'var(--font-size-base)', color: 'var(--text-primary)' }}>
                                Are you sure you want to delete this work?
                            </p>
                            <div style={{
                                background: 'var(--background-secondary)',
                                padding: 'var(--spacing-md)',
                                borderRadius: 'var(--radius-md)',
                                borderLeft: '4px solid var(--error-color)'
                            }}>
                                <p style={{ margin: '0 0 var(--spacing-sm) 0' }}>
                                    <strong>Work Type:</strong> {workToDelete.TypeName || 'N/A'}
                                </p>
                                <p style={{ margin: '0 0 var(--spacing-sm) 0' }}>
                                    <strong>Doctor:</strong> {workToDelete.DoctorName || 'N/A'}
                                </p>
                                <p style={{ margin: '0' }}>
                                    <strong>Total Required:</strong> {formatCurrency(workToDelete.TotalRequired, workToDelete.Currency)}
                                </p>
                            </div>
                            <p style={{
                                marginTop: 'var(--spacing-md)',
                                color: 'var(--error-color)',
                                fontWeight: 'bold',
                                fontSize: 'var(--font-size-sm)'
                            }}>
                                ⚠️ This action cannot be undone!
                            </p>
                        </div>
                        <div className="whatsapp-actions">
                            <button onClick={cancelDeleteWork} className="whatsapp-btn-cancel">
                                <i className="fas fa-times"></i> Cancel
                            </button>
                            <button
                                onClick={confirmDeleteWork}
                                className="whatsapp-btn-send"
                                style={{ backgroundColor: 'var(--error-color)' }}
                            >
                                <i className="fas fa-trash"></i> Delete Work
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default React.memo(WorkComponent);
