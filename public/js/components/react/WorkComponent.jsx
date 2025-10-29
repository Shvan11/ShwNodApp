import React, { useState, useEffect } from 'react';
import WorkCard from './WorkCard.jsx';
import PaymentModal from './PaymentModal.jsx';
import '../../../css/components/work-card.css';

const WorkComponent = ({ patientId }) => {
    const [works, setWorks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [editingWork, setEditingWork] = useState(null);
    const [workTypes, setWorkTypes] = useState([]);
    const [keywords, setKeywords] = useState([]);
    const [doctors, setDoctors] = useState([]);
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

    // Work detail form state
    const [detailFormData, setDetailFormData] = useState({
        WorkID: null,
        Tooth: '',
        FillingType: '',
        FillingDepth: '',
        CanalsNo: '',
        Note: ''
    });

    // Payment form state
    const [paymentFormData, setPaymentFormData] = useState({
        workid: null,
        Amountpaid: '',
        Dateofpayment: new Date().toISOString().split('T')[0],
        ActualAmount: '',
        ActualCur: 'USD',
        Change: 0
    });

    // Form state
    const [formData, setFormData] = useState({
        PersonID: patientId,
        TotalRequired: 0, // Default to 0 as it's required (NOT NULL)
        Currency: 'USD',
        Typeofwork: '',
        Notes: '',
        Finished: false,
        StartDate: '',
        DebondDate: '',
        FPhotoDate: '',
        IPhotoDate: '',
        EstimatedDuration: '',
        DrID: '',
        NotesDate: '',
        KeyWordID1: '',
        KeyWordID2: '',
        KeywordID3: '',
        KeywordID4: '',
        KeywordID5: ''
    });

    useEffect(() => {
        if (patientId) {
            loadWorks();
            loadDropdownData();
            loadPatientInfo();
        }
    }, [patientId]);

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

    const loadDropdownData = async () => {
        try {
            const [typesRes, keywordsRes, doctorsRes] = await Promise.all([
                fetch('/api/getworktypes'),
                fetch('/api/getworkkeywords'),
                fetch('/api/doctors')
            ]);

            if (typesRes.ok) {
                const types = await typesRes.json();
                setWorkTypes(types);
            }
            if (keywordsRes.ok) {
                const kw = await keywordsRes.json();
                setKeywords(kw);
            }
            if (doctorsRes.ok) {
                const docs = await doctorsRes.json();
                setDoctors(docs);
            }
        } catch (err) {
            console.error('Error loading dropdown data:', err);
        }
    };

    const handleAddWork = () => {
        setEditingWork(null);
        setFormData({
            PersonID: patientId,
            TotalRequired: 0, // Default to 0 as it's required (NOT NULL)
            Currency: 'USD',
            Typeofwork: '',
            Notes: '',
            Finished: false,
            StartDate: '',
            DebondDate: '',
            FPhotoDate: '',
            IPhotoDate: '',
            EstimatedDuration: '',
            DrID: '',
            NotesDate: '',
            KeyWordID1: '',
            KeyWordID2: '',
            KeywordID3: '',
            KeywordID4: '',
            KeywordID5: ''
        });
        setShowModal(true);
    };

    const handleEditWork = (work) => {
        setEditingWork(work);
        setFormData({
            PersonID: work.PersonID,
            TotalRequired: work.TotalRequired || '',
            Currency: work.Currency || 'USD',
            Typeofwork: work.Typeofwork || '',
            Notes: work.Notes || '',
            Finished: work.Finished || false,
            StartDate: work.StartDate ? new Date(work.StartDate).toISOString().split('T')[0] : '',
            DebondDate: work.DebondDate ? new Date(work.DebondDate).toISOString().split('T')[0] : '',
            FPhotoDate: work.FPhotoDate ? new Date(work.FPhotoDate).toISOString().split('T')[0] : '',
            IPhotoDate: work.IPhotoDate ? new Date(work.IPhotoDate).toISOString().split('T')[0] : '',
            EstimatedDuration: work.EstimatedDuration || '',
            DrID: work.DrID || '',
            NotesDate: work.NotesDate ? new Date(work.NotesDate).toISOString().split('T')[0] : '',
            KeyWordID1: work.KeyWordID1 || '',
            KeyWordID2: work.KeyWordID2 || '',
            KeywordID3: work.KeywordID3 || '',
            KeywordID4: work.KeywordID4 || '',
            KeywordID5: work.KeywordID5 || ''
        });
        setShowModal(true);
    };

    const handleFormSubmit = async (e) => {
        e.preventDefault();

        try {
            let response;
            const isNewAlignerWork = !editingWork && isAlignerWork({ Typeofwork: parseInt(formData.Typeofwork) });

            if (editingWork) {
                // Update existing work
                response = await fetch('/api/updatework', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ workId: editingWork.workid, ...formData })
                });
            } else {
                // Add new work
                response = await fetch('/api/addwork', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });
            }

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to save work');
            }

            const result = await response.json();
            await loadWorks();
            setShowModal(false);

            // Show success message for new aligner works
            if (isNewAlignerWork && result.workId) {
                setNewAlignerWorkId(result.workId);
                setSuccessMessage('Work created successfully!');
                // Auto-hide message after 10 seconds
                setTimeout(() => {
                    setSuccessMessage(null);
                    setNewAlignerWorkId(null);
                }, 10000);
            }
        } catch (err) {
            setError(err.message);
        }
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

    const getStatusBadge = (work) => {
        if (work.Finished) {
            return <span className="status-badge completed">Completed</span>;
        } else if (work.StartDate) {
            return <span className="status-badge in-progress">In Progress</span>;
        } else {
            return <span className="status-badge planned">Planned</span>;
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
        if (!amount) return 'N/A';
        return `${amount.toLocaleString()} ${currency || 'USD'}`;
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
        // Redirect to aligner page with workId parameter
        window.location.href = `/aligner?workId=${work.workid}`;
    };

    // Payment-related handlers
    const handleAddPayment = (work) => {
        setSelectedWorkForPayment(work);
        setPaymentFormData({
            workid: work.workid,
            Amountpaid: '',
            Dateofpayment: new Date().toISOString().split('T')[0],
            ActualAmount: '',
            ActualCur: work.Currency || 'USD',
            Change: 0
        });
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

    const handlePaymentFormSubmit = async (e) => {
        e.preventDefault();

        try {
            // Convert form data to match API expectations
            const payload = {
                workid: paymentFormData.workid,
                amountPaid: parseFloat(paymentFormData.Amountpaid),
                paymentDate: paymentFormData.Dateofpayment,
                actualAmount: paymentFormData.ActualAmount ? parseFloat(paymentFormData.ActualAmount) : null,
                actualCurrency: paymentFormData.ActualCur,
                change: paymentFormData.Change ? parseFloat(paymentFormData.Change) : 0
            };

            const response = await fetch('/api/addInvoice', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to add payment');
            }

            await loadWorks(); // Refresh works to update paid amounts
            setShowPaymentModal(false);
            setShowPaymentHistoryModal(false); // Close history modal if open
            setSuccessMessage('Payment added successfully!');
            setTimeout(() => setSuccessMessage(null), 5000);
        } catch (err) {
            setError(err.message);
        }
    };

    if (loading) return <div className="work-loading">Loading works...</div>;

    return (
        <div className="work-component">
            {/* Patient Info Card with Controls */}
            {patientInfo && (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1.5rem',
                    padding: '1.5rem',
                    backgroundColor: '#f9fafb',
                    borderRadius: '12px',
                    marginBottom: '1.5rem',
                    border: '1px solid #e5e7eb',
                    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
                }}>
                    <div style={{
                        width: '120px',
                        height: '150px',
                        borderRadius: '8px',
                        overflow: 'hidden',
                        flexShrink: 0,
                        backgroundColor: '#e5e7eb',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
                    }}>
                        <img
                            src={`/DolImgs/${patientId}00.i13`}
                            alt={`${patientInfo.PatientName} - Smile`}
                            style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover'
                            }}
                            onError={(e) => {
                                e.target.style.display = 'none';
                                e.target.parentElement.innerHTML = '<i class="fas fa-user" style="font-size: 48px; color: #9ca3af;"></i>';
                            }}
                        />
                    </div>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div>
                            <h3 style={{ margin: 0, fontSize: '1.5rem', fontWeight: '600', color: '#111827' }}>
                                {patientInfo.PatientName}
                            </h3>
                            <div style={{ display: 'flex', gap: '2rem', marginTop: '0.5rem', fontSize: '0.95rem', color: '#6b7280' }}>
                                <span><i className="fas fa-id-card" style={{ marginRight: '0.5rem' }}></i>{patientInfo.PersonID}</span>
                                {patientInfo.Phone && (
                                    <span><i className="fas fa-phone" style={{ marginRight: '0.5rem' }}></i>{patientInfo.Phone}</span>
                                )}
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <input
                                type="text"
                                placeholder="Search works..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="search-input"
                                style={{ flex: '1 1 250px', minWidth: '200px' }}
                            />
                            <select
                                value={filterStatus}
                                onChange={(e) => setFilterStatus(e.target.value)}
                                className="filter-select"
                                style={{ flex: '0 1 auto' }}
                            >
                                <option value="all">All Works</option>
                                <option value="active">Active</option>
                                <option value="completed">Completed</option>
                            </select>
                            <button onClick={handleAddWork} className="btn btn-primary" style={{ flex: '0 1 auto', whiteSpace: 'nowrap' }}>
                                <i className="fas fa-plus" style={{ marginRight: '0.5rem' }}></i>
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
                <div className="work-success" style={{
                    backgroundColor: '#10b981',
                    color: 'white',
                    padding: '1rem',
                    borderRadius: '8px',
                    marginBottom: '1rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                }}>
                    <div>
                        <strong>{successMessage}</strong>
                        <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem' }}>
                            This is an aligner work. Would you like to add aligner sets now?
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                            onClick={() => handleAddAlignerSet({ workid: newAlignerWorkId })}
                            className="btn btn-sm"
                            style={{
                                backgroundColor: 'white',
                                color: '#10b981',
                                fontWeight: 'bold'
                            }}
                        >
                            <i className="fas fa-tooth"></i> Add Aligner Set
                        </button>
                        <button
                            onClick={() => {
                                setSuccessMessage(null);
                                setNewAlignerWorkId(null);
                            }}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'white',
                                cursor: 'pointer',
                                fontSize: '1.5rem',
                                padding: '0 0.5rem'
                            }}
                        >
                            ×
                        </button>
                    </div>
                </div>
            )}

            <div className="work-summary">
                <div className="summary-card">
                    <h3>Total Works</h3>
                    <span className="summary-value">{works.length}</span>
                </div>
                <div className="summary-card">
                    <h3>Active</h3>
                    <span className="summary-value">{works.filter(w => !w.Finished).length}</span>
                </div>
                <div className="summary-card">
                    <h3>Completed</h3>
                    <span className="summary-value">{works.filter(w => w.Finished).length}</span>
                </div>
            </div>

            {/* Works Card Container */}
            <div className="works-card-container">
                {filteredWorks.map((work) => (
                    <WorkCard
                        key={work.workid}
                        work={work}
                        patientId={patientId}
                        isAlignerWork={isAlignerWork}
                        onViewDetails={handleViewDetails}
                        onEdit={handleEditWork}
                        onAddPayment={handleAddPayment}
                        onViewPaymentHistory={handleViewPaymentHistory}
                        onAddAlignerSet={handleAddAlignerSet}
                        onComplete={handleCompleteWork}
                        onViewVisits={(work) => window.location.href = `/views/visits.html?workId=${work.workid}&patient=${patientId}`}
                        formatDate={formatDate}
                        formatCurrency={formatCurrency}
                        getProgressPercentage={getProgressPercentage}
                    />
                ))}
                {filteredWorks.length === 0 && (
                    <div className="no-works-message">
                        <i className="fas fa-tooth" style={{ fontSize: '3rem', color: '#d1d5db', marginBottom: '1rem' }}></i>
                        <p style={{ color: '#6b7280', fontSize: '1rem' }}>
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
                    <div className="work-modal details-modal" style={{ maxWidth: '900px', maxHeight: '90vh', overflow: 'auto' }}>
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
                                <h4 style={{ marginBottom: '1rem', color: '#4f46e5', borderBottom: '2px solid #e0e7ff', paddingBottom: '0.5rem' }}>
                                    <i className="fas fa-info-circle"></i> Reference Information
                                </h4>
                                <div className="info-grid" style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                                    gap: '1rem',
                                    marginBottom: '1.5rem'
                                }}>
                                    <div className="info-item">
                                        <label style={{ fontWeight: '600', color: '#6b7280', display: 'block', marginBottom: '0.25rem' }}>Work ID:</label>
                                        <span style={{ fontSize: '1rem', fontFamily: 'monospace', fontWeight: '600' }}>{selectedWork.workid}</span>
                                    </div>
                                </div>

                                {/* Photo Dates (not on card) */}
                                {(selectedWork.IPhotoDate || selectedWork.FPhotoDate) && (
                                    <>
                                        <h4 style={{ marginBottom: '1rem', color: '#7c3aed', borderBottom: '2px solid #ede9fe', paddingBottom: '0.5rem' }}>
                                            <i className="fas fa-camera"></i> Photo Dates
                                        </h4>
                                        <div className="info-grid" style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                                            gap: '1rem',
                                            marginBottom: '1.5rem'
                                        }}>
                                            {selectedWork.IPhotoDate && (
                                                <div className="info-item">
                                                    <label style={{ fontWeight: '600', color: '#6b7280', display: 'block', marginBottom: '0.25rem' }}>Initial Photo Date:</label>
                                                    <span style={{ fontSize: '1rem' }}>{formatDate(selectedWork.IPhotoDate)}</span>
                                                </div>
                                            )}
                                            {selectedWork.FPhotoDate && (
                                                <div className="info-item">
                                                    <label style={{ fontWeight: '600', color: '#6b7280', display: 'block', marginBottom: '0.25rem' }}>Final Photo Date:</label>
                                                    <span style={{ fontSize: '1rem' }}>{formatDate(selectedWork.FPhotoDate)}</span>
                                                </div>
                                            )}
                                            {selectedWork.NotesDate && (
                                                <div className="info-item">
                                                    <label style={{ fontWeight: '600', color: '#6b7280', display: 'block', marginBottom: '0.25rem' }}>Notes Date:</label>
                                                    <span style={{ fontSize: '1rem' }}>{formatDate(selectedWork.NotesDate)}</span>
                                                </div>
                                            )}
                                        </div>
                                    </>
                                )}

                                {/* Keywords Section */}
                                {(selectedWork.Keyword1 || selectedWork.Keyword2 || selectedWork.Keyword3 || selectedWork.Keyword4 || selectedWork.Keyword5) && (
                                    <>
                                        <h4 style={{ marginBottom: '1rem', color: '#ea580c', borderBottom: '2px solid #fed7aa', paddingBottom: '0.5rem' }}>
                                            <i className="fas fa-tags"></i> Keywords & Tags
                                        </h4>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.5rem' }}>
                                            {selectedWork.Keyword1 && (
                                                <span style={{
                                                    backgroundColor: '#e0e7ff',
                                                    color: '#4f46e5',
                                                    padding: '0.5rem 1rem',
                                                    borderRadius: '9999px',
                                                    fontSize: '0.875rem',
                                                    fontWeight: '500'
                                                }}>
                                                    {selectedWork.Keyword1}
                                                </span>
                                            )}
                                            {selectedWork.Keyword2 && (
                                                <span style={{
                                                    backgroundColor: '#dbeafe',
                                                    color: '#1e40af',
                                                    padding: '0.5rem 1rem',
                                                    borderRadius: '9999px',
                                                    fontSize: '0.875rem',
                                                    fontWeight: '500'
                                                }}>
                                                    {selectedWork.Keyword2}
                                                </span>
                                            )}
                                            {selectedWork.Keyword3 && (
                                                <span style={{
                                                    backgroundColor: '#d1fae5',
                                                    color: '#065f46',
                                                    padding: '0.5rem 1rem',
                                                    borderRadius: '9999px',
                                                    fontSize: '0.875rem',
                                                    fontWeight: '500'
                                                }}>
                                                    {selectedWork.Keyword3}
                                                </span>
                                            )}
                                            {selectedWork.Keyword4 && (
                                                <span style={{
                                                    backgroundColor: '#fef3c7',
                                                    color: '#92400e',
                                                    padding: '0.5rem 1rem',
                                                    borderRadius: '9999px',
                                                    fontSize: '0.875rem',
                                                    fontWeight: '500'
                                                }}>
                                                    {selectedWork.Keyword4}
                                                </span>
                                            )}
                                            {selectedWork.Keyword5 && (
                                                <span style={{
                                                    backgroundColor: '#fce7f3',
                                                    color: '#9f1239',
                                                    padding: '0.5rem 1rem',
                                                    borderRadius: '9999px',
                                                    fontSize: '0.875rem',
                                                    fontWeight: '500'
                                                }}>
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

            {/* Work Form Modal */}
            {showModal && (
                <div className="modal-overlay">
                    <div className="work-modal">
                        <div className="modal-header">
                            <h3>{editingWork ? 'Edit Work' : 'Add New Work'}</h3>
                            <button
                                type="button"
                                onClick={() => setShowModal(false)}
                                className="modal-close"
                            >
                                ×
                            </button>
                        </div>
                        
                        <form onSubmit={handleFormSubmit} className="work-form">
                            <div className="form-row">
                                <div className="form-group">
                                    <label>Work Type <span style={{ color: '#dc2626' }}>*</span></label>
                                    <select
                                        value={formData.Typeofwork}
                                        onChange={(e) => setFormData({...formData, Typeofwork: e.target.value})}
                                        required
                                    >
                                        <option value="">Select Type</option>
                                        {workTypes.map(type => (
                                            <option key={type.ID} value={type.ID}>
                                                {type.TypeName}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label>Doctor <span style={{ color: '#dc2626' }}>*</span></label>
                                    <select
                                        value={formData.DrID}
                                        onChange={(e) => setFormData({...formData, DrID: e.target.value})}
                                        required
                                    >
                                        <option value="">Select Doctor</option>
                                        {doctors.map(doctor => (
                                            <option key={doctor.ID} value={doctor.ID}>
                                                {doctor.employeeName}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label>Total Required <span style={{ color: '#dc2626' }}>*</span></label>
                                    <input
                                        type="number"
                                        value={formData.TotalRequired}
                                        onChange={(e) => setFormData({...formData, TotalRequired: e.target.value})}
                                        min="0"
                                        step="0.01"
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Currency</label>
                                    <select
                                        value={formData.Currency}
                                        onChange={(e) => setFormData({...formData, Currency: e.target.value})}
                                    >
                                        <option value="USD">USD</option>
                                        <option value="IQD">IQD</option>
                                        <option value="EUR">EUR</option>
                                    </select>
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label>Start Date</label>
                                    <input
                                        type="date"
                                        value={formData.StartDate}
                                        onChange={(e) => setFormData({...formData, StartDate: e.target.value})}
                                    />
                                </div>
                                
                                <div className="form-group">
                                    <label>Estimated Duration (months)</label>
                                    <input
                                        type="number"
                                        value={formData.EstimatedDuration}
                                        onChange={(e) => setFormData({...formData, EstimatedDuration: e.target.value})}
                                        min="1"
                                        max="255"
                                    />
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label>Initial Photo Date</label>
                                    <input
                                        type="date"
                                        value={formData.IPhotoDate}
                                        onChange={(e) => setFormData({...formData, IPhotoDate: e.target.value})}
                                    />
                                </div>
                                
                                <div className="form-group">
                                    <label>Final Photo Date</label>
                                    <input
                                        type="date"
                                        value={formData.FPhotoDate}
                                        onChange={(e) => setFormData({...formData, FPhotoDate: e.target.value})}
                                    />
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label>Debond Date</label>
                                    <input
                                        type="date"
                                        value={formData.DebondDate}
                                        onChange={(e) => setFormData({...formData, DebondDate: e.target.value})}
                                    />
                                </div>
                                
                                <div className="form-group">
                                    <label>Notes Date</label>
                                    <input
                                        type="date"
                                        value={formData.NotesDate}
                                        onChange={(e) => setFormData({...formData, NotesDate: e.target.value})}
                                    />
                                </div>
                            </div>

                            <div className="form-group full-width">
                                <label>Notes</label>
                                <textarea
                                    value={formData.Notes}
                                    onChange={(e) => setFormData({...formData, Notes: e.target.value})}
                                    rows="3"
                                    placeholder="Additional notes about this work..."
                                />
                            </div>

                            <div className="keywords-section">
                                <h4>Keywords</h4>
                                <div className="keywords-grid">
                                    {[1, 2, 3, 4, 5].map(num => (
                                        <div key={num} className="form-group">
                                            <label>Keyword {num}</label>
                                            <select
                                                value={formData[`KeyWordID${num}`] || formData[`KeywordID${num}`]}
                                                onChange={(e) => {
                                                    const field = num === 3 ? 'KeywordID3' : `KeyWordID${num}`;
                                                    setFormData({...formData, [field]: e.target.value});
                                                }}
                                            >
                                                <option value="">Select Keyword</option>
                                                {keywords.map(kw => (
                                                    <option key={kw.ID} value={kw.ID}>
                                                        {kw.KeyWord}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="form-actions">
                                <button 
                                    type="button" 
                                    onClick={() => setShowModal(false)}
                                    className="btn btn-secondary"
                                >
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary">
                                    {editingWork ? 'Update Work' : 'Add Work'}
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
                    onClose={() => setShowPaymentModal(false)}
                    onSuccess={(result) => {
                        setSuccessMessage('Payment added successfully!');
                        loadWorks(); // Reload works to show updated balance
                    }}
                />
            )}

            {/* Payment History Modal */}
            {showPaymentHistoryModal && selectedWorkForPayment && (
                <div className="modal-overlay">
                    <div className="work-modal details-modal" style={{ maxWidth: '900px' }}>
                        <div className="modal-header">
                            <h3>Payment History - {selectedWorkForPayment.TypeName || 'Work #' + selectedWorkForPayment.workid}</h3>
                            <button
                                onClick={() => setShowPaymentHistoryModal(false)}
                                className="modal-close"
                            >
                                ×
                            </button>
                        </div>

                        <div style={{
                            padding: '1rem',
                            backgroundColor: '#f0fdf4',
                            borderRadius: '8px',
                            marginBottom: '1rem',
                            border: '1px solid #86efac'
                        }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', fontSize: '1rem' }}>
                                <div>
                                    <strong>Total Required:</strong><br/>
                                    <span style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#059669' }}>
                                        {formatCurrency(selectedWorkForPayment.TotalRequired, selectedWorkForPayment.Currency)}
                                    </span>
                                </div>
                                <div>
                                    <strong>Total Paid:</strong><br/>
                                    <span style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#0891b2' }}>
                                        {formatCurrency(selectedWorkForPayment.TotalPaid, selectedWorkForPayment.Currency)}
                                    </span>
                                </div>
                                <div>
                                    <strong>Balance Remaining:</strong><br/>
                                    <span style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#dc2626' }}>
                                        {formatCurrency((selectedWorkForPayment.TotalRequired || 0) - (selectedWorkForPayment.TotalPaid || 0), selectedWorkForPayment.Currency)}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {loadingPayments ? (
                            <div className="work-loading" style={{ padding: '2rem', textAlign: 'center' }}>
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
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {paymentHistory.map((payment, index) => (
                                            <tr key={payment.InvoiceID || index}>
                                                <td>{formatDate(payment.Dateofpayment)}</td>
                                                <td style={{ fontWeight: '600', color: '#059669' }}>
                                                    {formatCurrency(payment.Amountpaid, selectedWorkForPayment.Currency)}
                                                </td>
                                                <td>{payment.ActualAmount ? formatCurrency(payment.ActualAmount, payment.ActualCur) : '-'}</td>
                                                <td>{payment.ActualCur || '-'}</td>
                                                <td>{payment.Change ? formatCurrency(payment.Change, payment.ActualCur) : '-'}</td>
                                            </tr>
                                        ))}
                                        {paymentHistory.length === 0 && (
                                            <tr>
                                                <td colSpan="5" className="no-data">
                                                    No payments recorded yet for this work
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '2px solid #e5e7eb' }}>
                            {((selectedWorkForPayment.TotalRequired || 0) - (selectedWorkForPayment.TotalPaid || 0)) > 0 ? (
                                <button
                                    onClick={() => {
                                        setShowPaymentHistoryModal(false);
                                        handleAddPayment(selectedWorkForPayment);
                                    }}
                                    className="btn btn-primary"
                                    style={{
                                        backgroundColor: '#10b981',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem'
                                    }}
                                >
                                    <i className="fas fa-plus"></i> Add New Payment
                                </button>
                            ) : (
                                <div style={{
                                    padding: '1rem',
                                    backgroundColor: '#f0fdf4',
                                    borderRadius: '8px',
                                    border: '1px solid #86efac',
                                    textAlign: 'center',
                                    color: '#059669',
                                    fontWeight: '600'
                                }}>
                                    <i className="fas fa-check-circle"></i> This work is fully paid
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WorkComponent;