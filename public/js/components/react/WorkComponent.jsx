import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import WorkCard from './WorkCard.jsx';
import PaymentModal from './PaymentModal.jsx';
import { formatCurrency as formatCurrencyUtil, formatNumber } from '../../utils/formatters.js';
import '../../../css/components/work-card.css';

/**
 * Work Component
 * Displays list of patient's treatment works
 * Memoized to prevent unnecessary re-renders when patientId hasn't changed
 */
const WorkComponent = ({ patientId }) => {
    const navigate = useNavigate();
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

    // Expanded works state - track which work IDs are expanded
    const [expandedWorks, setExpandedWorks] = useState(new Set());

    // Work detail form state
    const [detailFormData, setDetailFormData] = useState({
        WorkID: null,
        Tooth: '',
        FillingType: '',
        FillingDepth: '',
        CanalsNo: '',
        Note: ''
    });

    useEffect(() => {
        if (patientId && patientId !== 'new') {
            loadWorks();
            loadPatientInfo();
        }
    }, [patientId]);

    // Auto-expand the first active work when works are loaded
    useEffect(() => {
        if (works.length > 0) {
            const firstActiveWork = works.find(work => !work.Finished);
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

            await loadWorks();
        } catch (err) {
            setError(err.message);
        }
    };

    const handleDeleteWork = async (work) => {
        const confirmMessage = `Are you sure you want to delete this work?\n\nWork Type: ${work.TypeName || 'N/A'}\nDoctor: ${work.DoctorName || 'N/A'}\nTotal Required: ${formatCurrency(work.TotalRequired, work.Currency)}\n\nThis action cannot be undone!`;

        if (!confirm(confirmMessage)) return;

        try {
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
                    let detailMessage = 'Cannot delete this work because it has:\n\n';

                    if (deps.InvoiceCount > 0) detailMessage += `• ${deps.InvoiceCount} payment(s)\n`;
                    if (deps.VisitCount > 0) detailMessage += `• ${deps.VisitCount} visit(s)\n`;
                    if (deps.DetailCount > 0) detailMessage += `• ${deps.DetailCount} treatment detail(s)\n`;
                    if (deps.DiagnosisCount > 0) detailMessage += `• ${deps.DiagnosisCount} diagnosis(es)\n`;
                    if (deps.ImplantCount > 0) detailMessage += `• ${deps.ImplantCount} implant(s)\n`;
                    if (deps.ScrewCount > 0) detailMessage += `• ${deps.ScrewCount} screw(s)\n`;

                    detailMessage += '\nPlease delete these records first before deleting the work.';

                    alert(detailMessage);
                    return;
                }

                throw new Error(result.error || 'Failed to delete work');
            }

            setSuccessMessage('Work deleted successfully!');
            setTimeout(() => setSuccessMessage(null), 3000);
            await loadWorks();
        } catch (err) {
            setError(err.message);
            setTimeout(() => setError(null), 5000);
        }
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
            Tooth: '',
            FillingType: '',
            FillingDepth: '',
            CanalsNo: '',
            Note: ''
        });
        setShowDetailForm(true);
    };

    const handleEditDetail = (detail) => {
        setEditingDetail(detail);
        setDetailFormData({
            WorkID: detail.WorkID,
            Tooth: detail.Tooth || '',
            FillingType: detail.FillingType || '',
            FillingDepth: detail.FillingDepth || '',
            CanalsNo: detail.CanalsNo || '',
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
        if (work.Finished) return 100;
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
                                (filterStatus === 'active' && !work.Finished) ||
                                (filterStatus === 'completed' && work.Finished);

            return matchesSearch && matchesFilter;
        })
        .sort((a, b) => {
            // First, sort by Finished status (active works first)
            if (!a.Finished && b.Finished) return -1;
            if (a.Finished && !b.Finished) return 1;

            // Within each group (active or completed), sort by AdditionDate ascending (oldest first)
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
        window.location.href = `/aligner/patient/${work.workid}`;
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
        // Open receipt in new window - template has auto-print on load
        window.open(`/api/templates/receipt/work/${work.workid}`, '_blank');
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
                                e.target.parentElement.innerHTML = '<i class="fas fa-user" style="font-size: 48px; color: #9ca3af;"></i>';
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
                                </div>
                            </div>
                            <div className="work-summary-inline">
                                <div className="summary-card-inline">
                                    <span className="summary-value-inline">{works.length}</span>
                                    <span className="summary-label-inline">Total</span>
                                </div>
                                <div className="summary-card-inline">
                                    <span className="summary-value-inline">{works.filter(w => !w.Finished).length}</span>
                                    <span className="summary-label-inline">Active</span>
                                </div>
                                <div className="summary-card-inline">
                                    <span className="summary-value-inline">{works.filter(w => w.Finished).length}</span>
                                    <span className="summary-label-inline">Completed</span>
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
                            </select>
                            <button
                                onClick={handleQuickCheckin}
                                className={`btn-checkin ${checkedIn ? 'checked-in' : ''} ${checkingIn ? 'checking-in' : ''}`}
                                disabled={checkingIn || checkedIn}
                                title={checkedIn ? 'Patient already checked in today' : 'Check in patient for today'}
                            >
                                <i className={`fas ${checkedIn ? 'fa-check-circle' : 'fa-calendar-check'}`}></i>
                                {checkingIn ? 'Checking In...' : checkedIn ? 'Checked In' : 'Check In'}
                            </button>
                            <button onClick={handleAddWork} className="btn-primary">
                                <i className="fas fa-plus"></i>
                                Add New Work
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {error && (
                <div className="work-error">
                    {error}
                    <button onClick={() => setError(null)} className="error-close">×</button>
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
                            className="btn-success-action"
                        >
                            <i className="fas fa-tooth"></i> Add Aligner Set
                        </button>
                        <button
                            onClick={() => {
                                setSuccessMessage(null);
                                setNewAlignerWorkId(null);
                            }}
                            className="btn-success-close"
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
                        onViewVisits={(work) => navigate(`/patient/${patientId}/visits?workId=${work.workid}`)}
                        onNewVisit={(work) => navigate(`/patient/${patientId}/new-visit?workId=${work.workid}`)}
                        onPrintReceipt={handlePrintReceipt}
                        formatDate={formatDate}
                        formatCurrency={formatCurrency}
                        getProgressPercentage={getProgressPercentage}
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

                            {/* Work Details Table */}
                            <div className="details-section">
                                <div className="section-header">
                                    <h4>Treatment Details</h4>
                                    <button 
                                        onClick={handleAddDetail}
                                        className="btn btn-sm btn-primary"
                                    >
                                        Add Detail
                                    </button>
                                </div>

                                <div className="details-table-container">
                                    <table className="details-table">
                                        <thead>
                                            <tr>
                                                <th>Tooth</th>
                                                <th>Filling Type</th>
                                                <th>Filling Depth</th>
                                                <th>Canals No.</th>
                                                <th>Note</th>
                                                <th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {workDetails.map((detail) => (
                                                <tr key={detail.ID}>
                                                    <td>{detail.Tooth || '-'}</td>
                                                    <td>{detail.FillingType || '-'}</td>
                                                    <td>{detail.FillingDepth || '-'}</td>
                                                    <td>{detail.CanalsNo || '-'}</td>
                                                    <td>{detail.Note || '-'}</td>
                                                    <td>
                                                        <div className="action-buttons">
                                                            <button 
                                                                onClick={() => handleEditDetail(detail)}
                                                                className="btn btn-xs btn-secondary"
                                                            >
                                                                Edit
                                                            </button>
                                                            <button 
                                                                onClick={() => handleDeleteDetail(detail.ID)}
                                                                className="btn btn-xs btn-danger"
                                                            >
                                                                Delete
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                            {workDetails.length === 0 && (
                                                <tr>
                                                    <td colSpan="6" className="no-data">
                                                        No treatment details recorded yet
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
            {showDetailForm && (
                <div className="modal-overlay">
                    <div className="work-modal detail-form-modal">
                        <div className="modal-header">
                            <h3>{editingDetail ? 'Edit Treatment Detail' : 'Add Treatment Detail'}</h3>
                            <button 
                                onClick={() => setShowDetailForm(false)}
                                className="modal-close"
                            >
                                ×
                            </button>
                        </div>
                        
                        <form onSubmit={handleDetailFormSubmit} className="detail-form">
                            <div className="form-row">
                                <div className="form-group">
                                    <label>Tooth Number</label>
                                    <input
                                        type="text"
                                        value={detailFormData.Tooth}
                                        onChange={(e) => setDetailFormData({...detailFormData, Tooth: e.target.value})}
                                        placeholder="e.g., 14, 27, etc."
                                    />
                                </div>
                                
                                <div className="form-group">
                                    <label>Filling Type</label>
                                    <select
                                        value={detailFormData.FillingType}
                                        onChange={(e) => setDetailFormData({...detailFormData, FillingType: e.target.value})}
                                    >
                                        <option value="">Select Type</option>
                                        <option value="Composite">Composite</option>
                                        <option value="Amalgam">Amalgam</option>
                                        <option value="Crown">Crown</option>
                                        <option value="Inlay">Inlay</option>
                                        <option value="Onlay">Onlay</option>
                                        <option value="Root Canal">Root Canal</option>
                                        <option value="Extraction">Extraction</option>
                                        <option value="Other">Other</option>
                                    </select>
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label>Filling Depth</label>
                                    <select
                                        value={detailFormData.FillingDepth}
                                        onChange={(e) => setDetailFormData({...detailFormData, FillingDepth: e.target.value})}
                                    >
                                        <option value="">Select Depth</option>
                                        <option value="Superficial">Superficial</option>
                                        <option value="Medium">Medium</option>
                                        <option value="Deep">Deep</option>
                                        <option value="Pulp">Pulp</option>
                                    </select>
                                </div>
                                
                                <div className="form-group">
                                    <label>Number of Canals</label>
                                    <input
                                        type="number"
                                        value={detailFormData.CanalsNo}
                                        onChange={(e) => setDetailFormData({...detailFormData, CanalsNo: e.target.value})}
                                        min="1"
                                        max="5"
                                        placeholder="1-5"
                                    />
                                </div>
                            </div>

                            <div className="form-group full-width">
                                <label>Notes</label>
                                <textarea
                                    value={detailFormData.Note}
                                    onChange={(e) => setDetailFormData({...detailFormData, Note: e.target.value})}
                                    rows="3"
                                    placeholder="Additional notes about this treatment..."
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
                                    {editingDetail ? 'Update Detail' : 'Add Detail'}
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
                                                                alert(`Edit payment functionality coming soon!\n\nPayment ID: ${payment.InvoiceID}\nAmount: ${formatCurrency(payment.Amountpaid, selectedWorkForPayment.Currency)}`);
                                                            }}
                                                            className="btn-action-edit"
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
                                                                            alert('Payment deleted successfully!');
                                                                            loadPaymentHistory(selectedWorkForPayment.workid);
                                                                            loadWorks();
                                                                        } else {
                                                                            throw new Error(result.message || 'Failed to delete payment');
                                                                        }
                                                                    } catch (error) {
                                                                        console.error('Error deleting payment:', error);
                                                                        alert(`Error deleting payment: ${error.message}`);
                                                                    }
                                                                }
                                                            }}
                                                            className="btn-action-delete"
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
                                    className="btn-primary btn-add-payment"
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
        </div>
    );
};

// Memoize to prevent unnecessary re-renders
// Only re-renders when patientId prop changes
export default React.memo(WorkComponent);