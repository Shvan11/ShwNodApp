import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import WorkCard from './WorkCard.jsx';
import PaymentModal from './PaymentModal.jsx';
import { formatCurrency as formatCurrencyUtil, formatNumber } from '../../utils/formatters.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import {
    getWorkTypeConfig,
    MATERIAL_OPTIONS,
    FILLING_TYPE_OPTIONS,
    FILLING_DEPTH_OPTIONS
} from '../../config/workTypeConfig.js';
import '../../../css/components/work-card.css';

/**
 * Work Component
 * Displays list of patient's treatment works
 * Memoized to prevent unnecessary re-renders when patientId hasn't changed
 */
const WorkComponent = ({ patientId }) => {
    const navigate = useNavigate();
    const toast = useToast();
    const [works, setWorks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState('all');
    const [showDetailsModal, setShowDetailsModal] = useState(false);
    const [selectedWork, setSelectedWork] = useState(null);
    const [workDetails, setWorkDetails] = useState([]);
    const [showDetailForm, setShowDetailForm] = useState(false);
    const [editingDetail, setEditingDetail] = useState(null);
    const [successMessage, setSuccessMessage] = useState(null);
    const [newAlignerWorkId, setNewAlignerWorkId] = useState(null);

    // Payment-related state
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [showPaymentHistoryModal, setShowPaymentHistoryModal] = useState(false);
    const [selectedWorkForPayment, setSelectedWorkForPayment] = useState(null);
    const [paymentHistory, setPaymentHistory] = useState([]);
    const [loadingPayments, setLoadingPayments] = useState(false);

    // Patient info state
    const [patientInfo, setPatientInfo] = useState(null);

    // Check-in state
    const [checkingIn, setCheckingIn] = useState(false);
    const [checkedIn, setCheckedIn] = useState(false);

    // Appointment state for no-work receipt button
    const [hasNextAppointment, setHasNextAppointment] = useState(false);
    const [loadingAppointment, setLoadingAppointment] = useState(true);

    // Expanded works state - track which work IDs are expanded
    const [expandedWorks, setExpandedWorks] = useState(new Set());

    // Delete confirmation modal state
    const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
    const [workToDelete, setWorkToDelete] = useState(null);

    // Work detail form state - includes all possible fields for all work types
    const [detailFormData, setDetailFormData] = useState({
        WorkID: null,
        TeethIds: [],
        FillingType: '',
        FillingDepth: '',
        CanalsNo: '',
        WorkingLength: '',      // For Endo - working length per canal
        ImplantLength: '',      // For Implant
        ImplantDiameter: '',    // For Implant
        Material: '',           // For Crown/Bridge/Veneers
        LabName: '',            // For Crown/Bridge/Veneers
        ItemCost: '',
        StartDate: '',
        CompletedDate: '',
        Note: ''
    });

    // Teeth options for multi-select
    const [teethOptions, setTeethOptions] = useState([]);
    const [showTeethPermanent, setShowTeethPermanent] = useState(true);
    const [showTeethDeciduous, setShowTeethDeciduous] = useState(false);

    useEffect(() => {
        if (patientId && patientId !== 'new') {
            loadWorks();
            loadPatientInfo();
            checkAppointmentStatus();
            loadTeethOptions();
        }
    }, [patientId]);

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

    // Work Status Constants (must match backend)
    const WORK_STATUS = {
        ACTIVE: 1,
        FINISHED: 2,
        DISCONTINUED: 3
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
            const response = await fetch(`/api/getinfos?code=${patientId}`);
            if (!response.ok) throw new Error('Failed to fetch patient info');
            const data = await response.json();
            setPatientInfo(data);
        } catch (err) {
            console.error('Error loading patient info:', err);
        }
    };

    const checkAppointmentStatus = async () => {
        try {
            setLoadingAppointment(true);
            const response = await fetch(`/api/patients/${patientId}/has-appointment`);
            if (!response.ok) throw new Error('Failed to check appointment status');
            const data = await response.json();
            setHasNextAppointment(data.hasAppointment);
            console.log(`[WORK-COMPONENT] Patient ${patientId} has next appointment:`, data.hasAppointment);
        } catch (err) {
            console.error('[WORK-COMPONENT] Error checking appointment status:', err);
            setHasNextAppointment(false);
        } finally {
            setLoadingAppointment(false);
        }
    };

    const handlePrintNoWorkReceipt = () => {
        console.log(`[WORK-COMPONENT] Print no-work receipt clicked for patient ${patientId}`);

        if (!hasNextAppointment) {
            toast.warning('Patient has no scheduled appointment');
            return;
        }

        // Open receipt in new window
        const receiptUrl = `/api/templates/receipt/no-work/${patientId}`;
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
            const response = await fetch(`/api/getworks?code=${patientId}`);
            if (!response.ok) throw new Error('Failed to fetch works');
            const data = await response.json();
            setWorks(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleAddWork = () => {
        // Navigate to new-work page
        navigate(`/patient/${patientId}/new-work`);
    };

    const handleEditWork = (work) => {
        // Navigate to new-work page with workId
        navigate(`/patient/${patientId}/new-work?workId=${work.workid}`);
    };

    const handleCompleteWork = async (workId) => {
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
            setError(err.message);
        }
    };

    const handleDiscontinueWork = async (workId) => {
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
            setError(err.message);
        }
    };

    const handleReactivateWork = async (work) => {
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
            setError(err.message);
        }
    };

    const handleDeleteWork = (work) => {
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

                    toast.error(detailMessage, 10000); // 10 seconds for critical warning
                    return;
                }

                throw new Error(result.error || 'Failed to delete work');
            }

            setSuccessMessage('Work deleted successfully!');
            setTimeout(() => setSuccessMessage(null), 3000);
            await loadWorks();
        } catch (err) {
            toast.error(err.message, 5000);
        } finally {
            setWorkToDelete(null);
        }
    };

    const cancelDeleteWork = () => {
        setShowDeleteConfirmation(false);
        setWorkToDelete(null);
    };

    const handleViewDetails = async (work) => {
        setSelectedWork(work);
        setShowDetailsModal(true);
        await loadWorkDetails(work.workid);
    };

    const loadWorkDetails = async (workId) => {
        try {
            const response = await fetch(`/api/getworkdetailslist?workId=${workId}`);
            if (!response.ok) throw new Error('Failed to fetch work details');
            const data = await response.json();
            setWorkDetails(data);
        } catch (err) {
            setError(err.message);
        }
    };

    const handleAddDetail = () => {
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
            Material: '',
            LabName: '',
            ItemCost: '',
            StartDate: '',
            CompletedDate: '',
            Note: ''
        });
        setShowDetailForm(true);
    };

    const handleEditDetail = (detail) => {
        setEditingDetail(detail);
        setDetailFormData({
            WorkID: detail.WorkID,
            TeethIds: detail.TeethIds || [],
            FillingType: detail.FillingType || '',
            FillingDepth: detail.FillingDepth || '',
            CanalsNo: detail.CanalsNo || '',
            WorkingLength: detail.WorkingLength || '',
            ImplantLength: detail.ImplantLength || '',
            ImplantDiameter: detail.ImplantDiameter || '',
            Material: detail.Material || '',
            LabName: detail.LabName || '',
            ItemCost: detail.ItemCost || '',
            StartDate: detail.StartDate ? detail.StartDate.split('T')[0] : '',
            CompletedDate: detail.CompletedDate ? detail.CompletedDate.split('T')[0] : '',
            Note: detail.Note || ''
        });
        setShowDetailForm(true);
    };

    const handleDetailFormSubmit = async (e) => {
        e.preventDefault();

        try {
            let response;

            if (editingDetail) {
                // Update existing detail
                response = await fetch('/api/updateworkdetail', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ detailId: editingDetail.ID, ...detailFormData })
                });
            } else {
                // Add new detail
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

            await loadWorkDetails(selectedWork.workid);
            setShowDetailForm(false);
        } catch (err) {
            setError(err.message);
        }
    };

    const handleDeleteDetail = async (detailId) => {
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

            await loadWorkDetails(selectedWork.workid);
        } catch (err) {
            setError(err.message);
        }
    };

    const getProgressPercentage = (work) => {
        if (work.Status === WORK_STATUS.FINISHED) return 100;
        if (work.Status === WORK_STATUS.DISCONTINUED) return 0; // Show 0% for discontinued
        if (!work.StartDate) return 0;

        let progress = 25; // Started
        if (work.IPhotoDate) progress = 50;
        if (work.DebondDate) progress = 75;
        if (work.FPhotoDate) progress = 90;

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
            // First, sort by Status (active works first, then discontinued, then finished)
            if (a.Status === WORK_STATUS.ACTIVE && b.Status !== WORK_STATUS.ACTIVE) return -1;
            if (a.Status !== WORK_STATUS.ACTIVE && b.Status === WORK_STATUS.ACTIVE) return 1;
            if (a.Status === WORK_STATUS.DISCONTINUED && b.Status === WORK_STATUS.FINISHED) return -1;
            if (a.Status === WORK_STATUS.FINISHED && b.Status === WORK_STATUS.DISCONTINUED) return 1;

            // Within each group, sort by AdditionDate ascending (oldest first)
            const dateA = new Date(a.AdditionDate || 0);
            const dateB = new Date(b.AdditionDate || 0);
            return dateA - dateB;
        });

    const formatCurrency = (amount, currency) => {
        if (!amount && amount !== 0) return 'N/A';
        return formatCurrencyUtil(amount, currency || 'USD');
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'Not set';
        return new Date(dateString).toLocaleDateString();
    };

    // Check if work is aligner-related (IDs: 19=Ortho(Aligners), 20=Ortho(Mixed), 21=Aligner(Lab))
    const isAlignerWork = (work) => {
        return [19, 20, 21].includes(work.Typeofwork);
    };

    // Navigate to aligner page with pre-selected work
    const handleAddAlignerSet = (work) => {
        // Navigate to patient sets page using direct patient route
        navigate(`/aligner/patient/${work.workid}`);
    };

    // Payment-related handlers
    const handleAddPayment = (work) => {
        setSelectedWorkForPayment(work);
        setShowPaymentModal(true);
    };

    const handleViewPaymentHistory = async (work) => {
        setSelectedWorkForPayment(work);
        setShowPaymentHistoryModal(true);
        await loadPaymentHistory(work.workid);
    };

    const loadPaymentHistory = async (workId) => {
        try {
            setLoadingPayments(true);
            const response = await fetch(`/api/getpaymenthistory?workId=${workId}`);
            if (!response.ok) throw new Error('Failed to fetch payment history');
            const data = await response.json();
            setPaymentHistory(data);
        } catch (err) {
            setError(err.message);
            setPaymentHistory([]);
        } finally {
            setLoadingPayments(false);
        }
    };

    const handlePrintReceipt = (work) => {
        console.log('🖨️ [PRINT RECEIPT] Button clicked for work:', work.workid);

        // Open receipt in new window - template has auto-print on load
        window.open(`/api/templates/receipt/work/${work.workid}`, '_blank');
        console.log('🖨️ [PRINT RECEIPT] Receipt window opened');

        // Auto-send WhatsApp receipt (non-blocking, show errors for debugging)
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
                    // Show error message to user
                    const errorMsg = result.message || 'Failed to send WhatsApp receipt';
                    toast.error(errorMsg, 5000);
                    console.error('❌ [WHATSAPP] Error:', errorMsg);
                }
            })
            .catch((err) => {
                // Show network/server error
                toast.error('Network error: Could not send WhatsApp receipt', 5000);
                console.error('❌ [WHATSAPP] Network error:', err);
            });
    };

    const toggleWorkExpanded = (workId) => {
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

    // Check-in handler
    const handleQuickCheckin = async () => {
        try {
            setCheckingIn(true);
            const response = await fetch('/api/appointments/quick-checkin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    PersonID: patientId
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
            setError(err.message);
            setTimeout(() => setError(null), 5000);
        } finally {
            setCheckingIn(false);
        }
    };

    if (loading) return <div className="work-loading">Loading works...</div>;

    return (
        <div className="work-component">
            {/* Patient Info Card with Controls */}
            {patientInfo && (
                <div className="patient-info-card">
                    <div className="patient-photo-container">
                        <img
                            src={`/DolImgs/${patientId}00.i13`}
                            alt={`${patientInfo.PatientName} - Smile`}
                            className="patient-photo"
                            onError={(e) => {
                                e.target.style.display = 'none';
                                e.target.parentElement.innerHTML = '<i class="fas fa-user patient-photo-fallback"></i>';
                            }}
                        />
                    </div>
                    <div className="patient-info-details">
                        <div className="patient-info-row">
                            <div className="patient-info-header">
                                <h3 className="patient-name">
                                    {patientInfo.PatientName}
                                </h3>
                                <div className="patient-meta-info">
                                    <span><i className="fas fa-id-card"></i>{patientInfo.PersonID}</span>
                                    {patientInfo.Phone && (
                                        <span><i className="fas fa-phone"></i>{patientInfo.Phone}</span>
                                    )}
                                    {patientInfo.estimatedCost && (
                                        <span className="patient-cost-badge">
                                            <i className="fas fa-dollar-sign"></i>
                                            {patientInfo.estimatedCost.toLocaleString()} {patientInfo.currency || 'IQD'}
                                        </span>
                                    )}
                                    {patientInfo.activeAlert && (
                                        <span className={`patient-alert-badge patient-alert-badge--severity-${patientInfo.activeAlert.alertSeverity}`}>
                                            <i className="fas fa-exclamation-triangle"></i>
                                            {patientInfo.activeAlert.alertType}: {patientInfo.activeAlert.alertDetails}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="work-summary-inline">
                                <div className="summary-card-inline">
                                    <span className="summary-value-inline">{works.length}</span>
                                    <span className="summary-label-inline">Total</span>
                                </div>
                                <div className="summary-card-inline">
                                    <span className="summary-value-inline">{works.filter(w => w.Status === WORK_STATUS.ACTIVE).length}</span>
                                    <span className="summary-label-inline">Active</span>
                                </div>
                                <div className="summary-card-inline">
                                    <span className="summary-value-inline">{works.filter(w => w.Status === WORK_STATUS.FINISHED).length}</span>
                                    <span className="summary-label-inline">Completed</span>
                                </div>
                                <div className="summary-card-inline">
                                    <span className="summary-value-inline">{works.filter(w => w.Status === WORK_STATUS.DISCONTINUED).length}</span>
                                    <span className="summary-label-inline">Discontinued</span>
                                </div>
                            </div>
                        </div>
                        <div className="patient-controls">
                            <input
                                type="text"
                                placeholder="Search works..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="search-input"
                            />
                            <select
                                value={filterStatus}
                                onChange={(e) => setFilterStatus(e.target.value)}
                                className="filter-select"
                            >
                                <option value="all">All Works</option>
                                <option value="active">Active</option>
                                <option value="completed">Completed</option>
                                <option value="discontinued">Discontinued</option>
                            </select>
                            <button
                                onClick={handleQuickCheckin}
                                className={`btn btn-work-checkin ${checkedIn ? 'checked-in' : ''} ${checkingIn ? 'checking-in' : ''}`}
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
                <div className="work-success">
                    <div>
                        <strong>{successMessage}</strong>
                        <p>
                            This is an aligner work. Would you like to add aligner sets now?
                        </p>
                    </div>
                    <div className="work-success-actions">
                        <button
                            onClick={() => handleAddAlignerSet({ workid: newAlignerWorkId })}
                            className="work-btn-success-action"
                        >
                            <i className="fas fa-tooth"></i> Add Aligner Set
                        </button>
                        <button
                            onClick={() => {
                                setSuccessMessage(null);
                                setNewAlignerWorkId(null);
                            }}
                            className="work-btn-success-close"
                        >
                            ×
                        </button>
                    </div>
                </div>
            )}

            {/* Works Card Container */}
            <div className="works-card-container">
                {filteredWorks.map((work) => (
                    <WorkCard
                        key={work.workid}
                        work={work}
                        patientId={patientId}
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
                        onViewVisits={(work) => navigate(`/patient/${patientId}/visits?workId=${work.workid}`)}
                        onNewVisit={(work) => navigate(`/patient/${patientId}/new-visit?workId=${work.workid}`)}
                        onPrintReceipt={handlePrintReceipt}
                        formatDate={formatDate}
                        formatCurrency={formatCurrency}
                        getProgressPercentage={getProgressPercentage}
                        WORK_STATUS={WORK_STATUS}
                    />
                ))}
                {filteredWorks.length === 0 && (
                    <div className="no-works-message">
                        <i className="fas fa-tooth no-works-icon"></i>
                        <p className="no-works-text">
                            {searchTerm || filterStatus !== 'all'
                                ? 'No works match your criteria'
                                : 'No works found for this patient'}
                        </p>
                    </div>
                )}
            </div>

            {/* Work Details Modal */}
            {showDetailsModal && selectedWork && (
                <div className="modal-overlay">
                    <div className="work-modal details-modal">
                        <div className="modal-header">
                            <h3>Work Details - {selectedWork.TypeName || 'Work #' + selectedWork.workid}</h3>
                            <button
                                onClick={() => setShowDetailsModal(false)}
                                className="modal-close"
                            >
                                ×
                            </button>
                        </div>

                        <div className="work-details-content">
                            {/* Only show information NOT visible on the card */}
                            <div className="work-summary-info">
                                {/* Reference Information */}
                                <h4 className="reference-section">
                                    <i className="fas fa-info-circle"></i> Reference Information
                                </h4>
                                <div className="info-grid">
                                    <div className="info-item">
                                        <label>Work ID:</label>
                                        <span className="work-id">{selectedWork.workid}</span>
                                    </div>
                                </div>

                                {/* Photo Dates (not on card) */}
                                {(selectedWork.IPhotoDate || selectedWork.FPhotoDate) && (
                                    <>
                                        <h4 className="photo-dates-section">
                                            <i className="fas fa-camera"></i> Photo Dates
                                        </h4>
                                        <div className="info-grid">
                                            {selectedWork.IPhotoDate && (
                                                <div className="info-item">
                                                    <label>Initial Photo Date:</label>
                                                    <span>{formatDate(selectedWork.IPhotoDate)}</span>
                                                </div>
                                            )}
                                            {selectedWork.FPhotoDate && (
                                                <div className="info-item">
                                                    <label>Final Photo Date:</label>
                                                    <span>{formatDate(selectedWork.FPhotoDate)}</span>
                                                </div>
                                            )}
                                            {selectedWork.NotesDate && (
                                                <div className="info-item">
                                                    <label>Notes Date:</label>
                                                    <span>{formatDate(selectedWork.NotesDate)}</span>
                                                </div>
                                            )}
                                        </div>
                                    </>
                                )}

                                {/* Keywords Section */}
                                {(selectedWork.Keyword1 || selectedWork.Keyword2 || selectedWork.Keyword3 || selectedWork.Keyword4 || selectedWork.Keyword5) && (
                                    <>
                                        <h4 className="keywords-section">
                                            <i className="fas fa-tags"></i> Keywords & Tags
                                        </h4>
                                        <div className="keywords-display">
                                            {selectedWork.Keyword1 && (
                                                <span className="keyword-badge keyword-badge-1">
                                                    {selectedWork.Keyword1}
                                                </span>
                                            )}
                                            {selectedWork.Keyword2 && (
                                                <span className="keyword-badge keyword-badge-2">
                                                    {selectedWork.Keyword2}
                                                </span>
                                            )}
                                            {selectedWork.Keyword3 && (
                                                <span className="keyword-badge keyword-badge-3">
                                                    {selectedWork.Keyword3}
                                                </span>
                                            )}
                                            {selectedWork.Keyword4 && (
                                                <span className="keyword-badge keyword-badge-4">
                                                    {selectedWork.Keyword4}
                                                </span>
                                            )}
                                            {selectedWork.Keyword5 && (
                                                <span className="keyword-badge keyword-badge-5">
                                                    {selectedWork.Keyword5}
                                                </span>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* Work Details Table - Type-specific display */}
                            <div className="details-section">
                                <div className="section-header">
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

                                <div className="details-table-container">
                                    <table className="details-table">
                                        <thead>
                                            <tr>
                                                {getWorkTypeConfig(selectedWork.Typeofwork).displayFields.map(field => (
                                                    <th key={field.key}>{field.label}</th>
                                                ))}
                                                <th>Status</th>
                                                <th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {workDetails.map((detail) => (
                                                <tr key={detail.ID}>
                                                    {getWorkTypeConfig(selectedWork.Typeofwork).displayFields.map(field => (
                                                        <td key={field.key}>
                                                            {field.key === 'Teeth' ? (
                                                                <span className="teeth-badge">{detail.Teeth || '-'}</span>
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
                                                            <span className="status-badge status-completed">Completed</span>
                                                        ) : detail.StartDate ? (
                                                            <span className="status-badge status-started">Started</span>
                                                        ) : (
                                                            <span className="status-badge status-pending">Pending</span>
                                                        )}
                                                    </td>
                                                    <td>
                                                        <div className="action-buttons">
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
                                                    <td colSpan={getWorkTypeConfig(selectedWork.Typeofwork).displayFields.length + 2} className="no-data">
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

            {/* Work Detail Form Modal - Type-specific fields */}
            {showDetailForm && selectedWork && (
                <div className="modal-overlay">
                    <div className="work-modal detail-form-modal">
                        <div className="modal-header">
                            <h3>
                                <i className={getWorkTypeConfig(selectedWork.Typeofwork).icon}></i>
                                {' '}{editingDetail ? 'Edit' : 'Add'} {getWorkTypeConfig(selectedWork.Typeofwork).name} Item
                            </h3>
                            <button
                                onClick={() => setShowDetailForm(false)}
                                className="modal-close"
                            >
                                ×
                            </button>
                        </div>

                        <form onSubmit={handleDetailFormSubmit} className="detail-form">
                            {/* Teeth Selection - shown for all types that need it */}
                            {getWorkTypeConfig(selectedWork.Typeofwork).fields.includes('teeth') && (
                                <div className="form-group full-width">
                                    <label>Select Teeth</label>
                                    <div className="teeth-filter-toggle">
                                        <label className="checkbox-label">
                                            <input
                                                type="checkbox"
                                                checked={showTeethPermanent}
                                                onChange={(e) => setShowTeethPermanent(e.target.checked)}
                                            />
                                            Permanent
                                        </label>
                                        <label className="checkbox-label">
                                            <input
                                                type="checkbox"
                                                checked={showTeethDeciduous}
                                                onChange={(e) => setShowTeethDeciduous(e.target.checked)}
                                            />
                                            Deciduous
                                        </label>
                                    </div>
                                    <div className="teeth-selection-grid">
                                        {/* Upper Arch */}
                                        <div className="teeth-arch">
                                            <span className="arch-label">Upper</span>
                                            <div className="teeth-row">
                                                {teethOptions
                                                    .filter(t => t.Quadrant === 'UR' && ((showTeethPermanent && t.IsPermanent) || (showTeethDeciduous && !t.IsPermanent)))
                                                    .sort((a, b) => b.SortOrder - a.SortOrder)
                                                    .map(tooth => (
                                                        <button
                                                            key={tooth.ID}
                                                            type="button"
                                                            className={`tooth-btn ${detailFormData.TeethIds.includes(tooth.ID) ? 'selected' : ''} ${!tooth.IsPermanent ? 'deciduous' : ''}`}
                                                            onClick={() => {
                                                                const newTeethIds = detailFormData.TeethIds.includes(tooth.ID)
                                                                    ? detailFormData.TeethIds.filter(id => id !== tooth.ID)
                                                                    : [...detailFormData.TeethIds, tooth.ID];
                                                                setDetailFormData({ ...detailFormData, TeethIds: newTeethIds });
                                                            }}
                                                            title={tooth.ToothName}
                                                        >
                                                            {tooth.ToothCode.replace('UR', '')}
                                                        </button>
                                                    ))}
                                                <span className="midline">|</span>
                                                {teethOptions
                                                    .filter(t => t.Quadrant === 'UL' && ((showTeethPermanent && t.IsPermanent) || (showTeethDeciduous && !t.IsPermanent)))
                                                    .sort((a, b) => a.SortOrder - b.SortOrder)
                                                    .map(tooth => (
                                                        <button
                                                            key={tooth.ID}
                                                            type="button"
                                                            className={`tooth-btn ${detailFormData.TeethIds.includes(tooth.ID) ? 'selected' : ''} ${!tooth.IsPermanent ? 'deciduous' : ''}`}
                                                            onClick={() => {
                                                                const newTeethIds = detailFormData.TeethIds.includes(tooth.ID)
                                                                    ? detailFormData.TeethIds.filter(id => id !== tooth.ID)
                                                                    : [...detailFormData.TeethIds, tooth.ID];
                                                                setDetailFormData({ ...detailFormData, TeethIds: newTeethIds });
                                                            }}
                                                            title={tooth.ToothName}
                                                        >
                                                            {tooth.ToothCode.replace('UL', '')}
                                                        </button>
                                                    ))}
                                            </div>
                                        </div>
                                        {/* Lower Arch */}
                                        <div className="teeth-arch">
                                            <span className="arch-label">Lower</span>
                                            <div className="teeth-row">
                                                {teethOptions
                                                    .filter(t => t.Quadrant === 'LR' && ((showTeethPermanent && t.IsPermanent) || (showTeethDeciduous && !t.IsPermanent)))
                                                    .sort((a, b) => b.SortOrder - a.SortOrder)
                                                    .map(tooth => (
                                                        <button
                                                            key={tooth.ID}
                                                            type="button"
                                                            className={`tooth-btn ${detailFormData.TeethIds.includes(tooth.ID) ? 'selected' : ''} ${!tooth.IsPermanent ? 'deciduous' : ''}`}
                                                            onClick={() => {
                                                                const newTeethIds = detailFormData.TeethIds.includes(tooth.ID)
                                                                    ? detailFormData.TeethIds.filter(id => id !== tooth.ID)
                                                                    : [...detailFormData.TeethIds, tooth.ID];
                                                                setDetailFormData({ ...detailFormData, TeethIds: newTeethIds });
                                                            }}
                                                            title={tooth.ToothName}
                                                        >
                                                            {tooth.ToothCode.replace('LR', '')}
                                                        </button>
                                                    ))}
                                                <span className="midline">|</span>
                                                {teethOptions
                                                    .filter(t => t.Quadrant === 'LL' && ((showTeethPermanent && t.IsPermanent) || (showTeethDeciduous && !t.IsPermanent)))
                                                    .sort((a, b) => a.SortOrder - b.SortOrder)
                                                    .map(tooth => (
                                                        <button
                                                            key={tooth.ID}
                                                            type="button"
                                                            className={`tooth-btn ${detailFormData.TeethIds.includes(tooth.ID) ? 'selected' : ''} ${!tooth.IsPermanent ? 'deciduous' : ''}`}
                                                            onClick={() => {
                                                                const newTeethIds = detailFormData.TeethIds.includes(tooth.ID)
                                                                    ? detailFormData.TeethIds.filter(id => id !== tooth.ID)
                                                                    : [...detailFormData.TeethIds, tooth.ID];
                                                                setDetailFormData({ ...detailFormData, TeethIds: newTeethIds });
                                                            }}
                                                            title={tooth.ToothName}
                                                        >
                                                            {tooth.ToothCode.replace('LL', '')}
                                                        </button>
                                                    ))}
                                            </div>
                                        </div>
                                    </div>
                                    {detailFormData.TeethIds.length > 0 && (
                                        <div className="selected-teeth-display">
                                            <strong>Selected:</strong> {detailFormData.TeethIds.map(id => {
                                                const tooth = teethOptions.find(t => t.ID === id);
                                                return tooth?.ToothCode;
                                            }).filter(Boolean).join(', ')}
                                            <button
                                                type="button"
                                                className="btn-clear-teeth"
                                                onClick={() => setDetailFormData({ ...detailFormData, TeethIds: [] })}
                                            >
                                                Clear All
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Type-specific fields */}
                            <div className="form-row">
                                {/* Filling fields */}
                                {getWorkTypeConfig(selectedWork.Typeofwork).fields.includes('fillingType') && (
                                    <div className="form-group">
                                        <label>Filling Type</label>
                                        <select
                                            value={detailFormData.FillingType}
                                            onChange={(e) => setDetailFormData({ ...detailFormData, FillingType: e.target.value })}
                                        >
                                            <option value="">Select Type</option>
                                            {FILLING_TYPE_OPTIONS.map(opt => (
                                                <option key={opt} value={opt}>{opt}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                {getWorkTypeConfig(selectedWork.Typeofwork).fields.includes('fillingDepth') && (
                                    <div className="form-group">
                                        <label>Filling Depth</label>
                                        <select
                                            value={detailFormData.FillingDepth}
                                            onChange={(e) => setDetailFormData({ ...detailFormData, FillingDepth: e.target.value })}
                                        >
                                            <option value="">Select Depth</option>
                                            {FILLING_DEPTH_OPTIONS.map(opt => (
                                                <option key={opt} value={opt}>{opt}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                {/* Endo fields */}
                                {getWorkTypeConfig(selectedWork.Typeofwork).fields.includes('canalsNo') && (
                                    <div className="form-group">
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
                                    <div className="form-group">
                                        <label>Working Length</label>
                                        <input
                                            type="text"
                                            value={detailFormData.WorkingLength}
                                            onChange={(e) => setDetailFormData({ ...detailFormData, WorkingLength: e.target.value })}
                                            placeholder="e.g., 20mm, 18mm, 19mm"
                                        />
                                    </div>
                                )}

                                {/* Implant fields */}
                                {getWorkTypeConfig(selectedWork.Typeofwork).fields.includes('implantLength') && (
                                    <div className="form-group">
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
                                    <div className="form-group">
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

                                {/* Crown/Bridge fields */}
                                {getWorkTypeConfig(selectedWork.Typeofwork).fields.includes('material') && (
                                    <div className="form-group">
                                        <label>Material</label>
                                        <select
                                            value={detailFormData.Material}
                                            onChange={(e) => setDetailFormData({ ...detailFormData, Material: e.target.value })}
                                        >
                                            <option value="">Select Material</option>
                                            {MATERIAL_OPTIONS.map(opt => (
                                                <option key={opt} value={opt}>{opt}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                {getWorkTypeConfig(selectedWork.Typeofwork).fields.includes('labName') && (
                                    <div className="form-group">
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

                            {/* Status Dates */}
                            <div className="form-row">
                                <div className="form-group">
                                    <label>Start Date</label>
                                    <input
                                        type="date"
                                        value={detailFormData.StartDate}
                                        onChange={(e) => setDetailFormData({ ...detailFormData, StartDate: e.target.value })}
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Completed Date</label>
                                    <input
                                        type="date"
                                        value={detailFormData.CompletedDate}
                                        onChange={(e) => setDetailFormData({ ...detailFormData, CompletedDate: e.target.value })}
                                    />
                                </div>

                                <div className="form-group">
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

                            {/* Notes - shown for all types */}
                            <div className="form-group full-width">
                                <label>Notes</label>
                                <textarea
                                    value={detailFormData.Note}
                                    onChange={(e) => setDetailFormData({ ...detailFormData, Note: e.target.value })}
                                    rows="3"
                                    placeholder="Additional notes..."
                                />
                            </div>

                            <div className="form-actions">
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
                        // Reload works when modal is closed to show updated balance
                        loadWorks();
                    }}
                    onSuccess={(result) => {
                        // Don't reload works here - let PaymentModal show success state first
                        // Works will be reloaded when modal is closed via onClose
                        setSuccessMessage('Payment added successfully!');
                    }}
                />
            )}

            {/* Payment History Modal */}
            {showPaymentHistoryModal && selectedWorkForPayment && (
                <div className="modal-overlay">
                    <div className="work-modal details-modal">
                        <div className="modal-header">
                            <h3>Payment History - {selectedWorkForPayment.TypeName || 'Work #' + selectedWorkForPayment.workid}</h3>
                            <button
                                onClick={() => {
                                    console.log('CLOSE BUTTON CLICKED!');
                                    setShowPaymentHistoryModal(false);
                                }}
                                className="modal-close"
                            >
                                ×
                            </button>
                        </div>
                        <div className="modal-content-scroll">

                            <div className="payment-summary-box">
                                <div className="payment-summary-grid">
                                    <div className="payment-summary-item">
                                        <span className="payment-summary-label">Total Required:</span>
                                        <span className="payment-summary-value total">
                                            {formatCurrency(selectedWorkForPayment.TotalRequired, selectedWorkForPayment.Currency)}
                                        </span>
                                    </div>
                                    <div className="payment-summary-item">
                                        <span className="payment-summary-label">Total Paid:</span>
                                        <span className="payment-summary-value paid">
                                            {formatCurrency(selectedWorkForPayment.TotalPaid, selectedWorkForPayment.Currency)}
                                        </span>
                                    </div>
                                    <div className="payment-summary-item">
                                        <span className="payment-summary-label">Balance Remaining:</span>
                                        <span className="payment-summary-value balance">
                                            {formatCurrency((selectedWorkForPayment.TotalRequired || 0) - (selectedWorkForPayment.TotalPaid || 0), selectedWorkForPayment.Currency)}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {loadingPayments ? (
                                <div className="work-loading">
                                    Loading payment history...
                                </div>
                            ) : (
                                <div className="details-table-container">
                                    <table className="details-table">
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
                                                    <td className="payment-amount">
                                                        {formatCurrency(payment.Amountpaid, selectedWorkForPayment.Currency)}
                                                    </td>
                                                    <td>{payment.ActualAmount ? formatCurrency(payment.ActualAmount, payment.ActualCur) : '-'}</td>
                                                    <td>{payment.ActualCur || '-'}</td>
                                                    <td>{payment.Change ? formatCurrency(payment.Change, payment.ActualCur) : '-'}</td>
                                                    <td>
                                                        <div className="payment-actions">
                                                            <button
                                                                onClick={() => {
                                                                    toast.info(`Edit payment functionality coming soon!\n\nPayment ID: ${payment.InvoiceID}\nAmount: ${formatCurrency(payment.Amountpaid, selectedWorkForPayment.Currency)}`);
                                                                }}
                                                                className="work-btn-action-edit"
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
                                                                            toast.error(`Error deleting payment: ${error.message}`);
                                                                        }
                                                                    }
                                                                }}
                                                                className="work-btn-action-delete"
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
                                                    <td colSpan="6" className="no-data">
                                                        No payments recorded yet for this work
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            <div className="payment-history-footer">
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
                                    <div className="payment-fully-paid">
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
                <div className="modal-overlay" onClick={cancelDeleteWork}>
                    <div className="whatsapp-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
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

            {/* Toast Notifications now handled globally by ToastProvider in App.jsx */}
        </div>
    );
};

// Memoize to prevent unnecessary re-renders
// Only re-renders when patientId prop changes
export default React.memo(WorkComponent);