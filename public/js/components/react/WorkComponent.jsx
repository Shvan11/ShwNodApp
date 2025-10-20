import React, { useState, useEffect } from 'react';

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

    // Work detail form state
    const [detailFormData, setDetailFormData] = useState({
        WorkID: null,
        Tooth: '',
        FillingType: '',
        FillingDepth: '',
        CanalsNo: '',
        Note: ''
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
        }
    }, [patientId]);

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
            // Sort by AdditionDate ascending (oldest first)
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

    if (loading) return <div className="work-loading">Loading works...</div>;

    return (
        <div className="work-component">
            <div className="work-header">
                <h2>Work Management</h2>
                <div className="work-controls">
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
                    <button onClick={handleAddWork} className="btn btn-primary">
                        Add New Work
                    </button>
                </div>
            </div>

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

            <div className="work-table-container">
                <table className="work-table">
                    <thead>
                        <tr>
                            <th>Addition Date</th>
                            <th>Type</th>
                            <th>Doctor</th>
                            <th>Status</th>
                            <th>Progress</th>
                            <th>Start Date</th>
                            <th>Total</th>
                            <th>Paid</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredWorks.map((work) => (
                            <tr
                                key={work.workid}
                                className={work.Finished ? 'completed-row' : 'active-row'}
                                style={!work.Finished ? {
                                    background: '#f0fdf4',
                                    backgroundColor: '#f0fdf4',
                                    borderLeft: '4px solid #059669'
                                } : undefined}
                            >
                                <td>{formatDate(work.AdditionDate)}</td>
                                <td>
                                    <strong>{work.TypeName || 'Other'}</strong>
                                </td>
                                <td>{work.DoctorName || 'Not assigned'}</td>
                                <td>{getStatusBadge(work)}</td>
                                <td>
                                    <div className="progress-container">
                                        <div
                                            className="progress-bar"
                                            style={{ width: `${getProgressPercentage(work)}%` }}
                                        ></div>
                                        <span className="progress-text">{getProgressPercentage(work)}%</span>
                                    </div>
                                </td>
                                <td>{formatDate(work.StartDate)}</td>
                                <td>{formatCurrency(work.TotalRequired, work.Currency)}</td>
                                <td>{formatCurrency(work.TotalPaid, work.Currency)}</td>
                                <td>
                                    <div className="action-buttons">
                                        <button
                                            onClick={() => window.location.href = `/views/visits.html?workId=${work.workid}&patient=${patientId}`}
                                            className="btn btn-sm"
                                            style={{
                                                backgroundColor: '#059669',
                                                color: 'white',
                                                border: 'none'
                                            }}
                                            title="View visits for this work"
                                        >
                                            <i className="fas fa-calendar-check"></i> Visits
                                        </button>
                                        <button
                                            onClick={() => handleViewDetails(work)}
                                            className="btn btn-sm btn-info"
                                            title="View work details"
                                        >
                                            Details
                                        </button>
                                        <button
                                            onClick={() => handleEditWork(work)}
                                            className="btn btn-sm btn-secondary"
                                            title="Edit work"
                                        >
                                            Edit
                                        </button>
                                        {isAlignerWork(work) && (
                                            <button
                                                onClick={() => handleAddAlignerSet(work)}
                                                className="btn btn-sm"
                                                style={{
                                                    backgroundColor: '#8b5cf6',
                                                    color: 'white',
                                                    border: 'none'
                                                }}
                                                title="Add or manage aligner sets"
                                            >
                                                <i className="fas fa-tooth"></i> Add Set
                                            </button>
                                        )}
                                        {!work.Finished && (
                                            <button
                                                onClick={() => handleCompleteWork(work.workid)}
                                                className="btn btn-sm btn-success"
                                                title="Mark work as completed"
                                            >
                                                Complete
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {filteredWorks.length === 0 && (
                            <tr>
                                <td colSpan="9" className="no-data">
                                    {searchTerm || filterStatus !== 'all' 
                                        ? 'No works match your criteria' 
                                        : 'No works found for this patient'}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
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
                            {/* Comprehensive Work Information */}
                            <div className="work-summary-info">
                                <h4 style={{ marginBottom: '1rem', color: '#4f46e5', borderBottom: '2px solid #e0e7ff', paddingBottom: '0.5rem' }}>
                                    <i className="fas fa-info-circle"></i> General Information
                                </h4>
                                <div className="info-grid" style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                                    gap: '1rem',
                                    marginBottom: '1.5rem'
                                }}>
                                    <div className="info-item">
                                        <label style={{ fontWeight: '600', color: '#6b7280', display: 'block', marginBottom: '0.25rem' }}>Work ID:</label>
                                        <span style={{ fontSize: '1rem' }}>{selectedWork.workid}</span>
                                    </div>
                                    <div className="info-item">
                                        <label style={{ fontWeight: '600', color: '#6b7280', display: 'block', marginBottom: '0.25rem' }}>Work Type:</label>
                                        <span style={{ fontSize: '1rem' }}>{selectedWork.TypeName || 'Other'}</span>
                                    </div>
                                    <div className="info-item">
                                        <label style={{ fontWeight: '600', color: '#6b7280', display: 'block', marginBottom: '0.25rem' }}>Doctor:</label>
                                        <span style={{ fontSize: '1rem' }}>{selectedWork.DoctorName || 'Not assigned'}</span>
                                    </div>
                                    <div className="info-item">
                                        <label style={{ fontWeight: '600', color: '#6b7280', display: 'block', marginBottom: '0.25rem' }}>Status:</label>
                                        <span>{getStatusBadge(selectedWork)}</span>
                                    </div>
                                    <div className="info-item">
                                        <label style={{ fontWeight: '600', color: '#6b7280', display: 'block', marginBottom: '0.25rem' }}>Progress:</label>
                                        <span style={{ fontSize: '1rem', fontWeight: '600', color: '#4f46e5' }}>{getProgressPercentage(selectedWork)}%</span>
                                    </div>
                                    <div className="info-item">
                                        <label style={{ fontWeight: '600', color: '#6b7280', display: 'block', marginBottom: '0.25rem' }}>Finished:</label>
                                        <span style={{ fontSize: '1rem' }}>{selectedWork.Finished ? '✓ Yes' : '✗ No'}</span>
                                    </div>
                                </div>

                                <h4 style={{ marginBottom: '1rem', color: '#059669', borderBottom: '2px solid #d1fae5', paddingBottom: '0.5rem' }}>
                                    <i className="fas fa-dollar-sign"></i> Financial Information
                                </h4>
                                <div className="info-grid" style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                                    gap: '1rem',
                                    marginBottom: '1.5rem'
                                }}>
                                    <div className="info-item">
                                        <label style={{ fontWeight: '600', color: '#6b7280', display: 'block', marginBottom: '0.25rem' }}>Total Required:</label>
                                        <span style={{ fontWeight: '600', color: '#059669', fontSize: '1.1rem' }}>
                                            {formatCurrency(selectedWork.TotalRequired, selectedWork.Currency)}
                                        </span>
                                    </div>
                                    <div className="info-item">
                                        <label style={{ fontWeight: '600', color: '#6b7280', display: 'block', marginBottom: '0.25rem' }}>Total Paid:</label>
                                        <span style={{ fontWeight: '600', color: '#0891b2', fontSize: '1.1rem' }}>
                                            {formatCurrency(selectedWork.TotalPaid, selectedWork.Currency)}
                                        </span>
                                    </div>
                                    <div className="info-item">
                                        <label style={{ fontWeight: '600', color: '#6b7280', display: 'block', marginBottom: '0.25rem' }}>Balance:</label>
                                        <span style={{ fontWeight: '600', color: '#dc2626', fontSize: '1.1rem' }}>
                                            {formatCurrency((selectedWork.TotalRequired || 0) - (selectedWork.TotalPaid || 0), selectedWork.Currency)}
                                        </span>
                                    </div>
                                    <div className="info-item">
                                        <label style={{ fontWeight: '600', color: '#6b7280', display: 'block', marginBottom: '0.25rem' }}>Currency:</label>
                                        <span style={{ fontSize: '1rem' }}>{selectedWork.Currency || 'USD'}</span>
                                    </div>
                                </div>

                                <h4 style={{ marginBottom: '1rem', color: '#7c3aed', borderBottom: '2px solid #ede9fe', paddingBottom: '0.5rem' }}>
                                    <i className="fas fa-calendar-alt"></i> Timeline & Dates
                                </h4>
                                <div className="info-grid" style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                                    gap: '1rem',
                                    marginBottom: '1.5rem'
                                }}>
                                    <div className="info-item">
                                        <label style={{ fontWeight: '600', color: '#6b7280', display: 'block', marginBottom: '0.25rem' }}>Addition Date:</label>
                                        <span style={{ fontSize: '1rem' }}>{formatDate(selectedWork.AdditionDate)}</span>
                                    </div>
                                    <div className="info-item">
                                        <label style={{ fontWeight: '600', color: '#6b7280', display: 'block', marginBottom: '0.25rem' }}>Start Date:</label>
                                        <span style={{ fontSize: '1rem' }}>{formatDate(selectedWork.StartDate)}</span>
                                    </div>
                                    <div className="info-item">
                                        <label style={{ fontWeight: '600', color: '#6b7280', display: 'block', marginBottom: '0.25rem' }}>Initial Photo Date:</label>
                                        <span style={{ fontSize: '1rem' }}>{formatDate(selectedWork.IPhotoDate)}</span>
                                    </div>
                                    <div className="info-item">
                                        <label style={{ fontWeight: '600', color: '#6b7280', display: 'block', marginBottom: '0.25rem' }}>Debond Date:</label>
                                        <span style={{ fontSize: '1rem' }}>{formatDate(selectedWork.DebondDate)}</span>
                                    </div>
                                    <div className="info-item">
                                        <label style={{ fontWeight: '600', color: '#6b7280', display: 'block', marginBottom: '0.25rem' }}>Final Photo Date:</label>
                                        <span style={{ fontSize: '1rem' }}>{formatDate(selectedWork.FPhotoDate)}</span>
                                    </div>
                                    <div className="info-item">
                                        <label style={{ fontWeight: '600', color: '#6b7280', display: 'block', marginBottom: '0.25rem' }}>Notes Date:</label>
                                        <span style={{ fontSize: '1rem' }}>{formatDate(selectedWork.NotesDate)}</span>
                                    </div>
                                    <div className="info-item">
                                        <label style={{ fontWeight: '600', color: '#6b7280', display: 'block', marginBottom: '0.25rem' }}>Estimated Duration:</label>
                                        <span style={{ fontSize: '1rem' }}>{selectedWork.EstimatedDuration ? `${selectedWork.EstimatedDuration} months` : 'Not set'}</span>
                                    </div>
                                </div>

                                {/* Keywords Section */}
                                {(selectedWork.Keyword1 || selectedWork.Keyword2 || selectedWork.Keyword3 || selectedWork.Keyword4 || selectedWork.Keyword5) && (
                                    <>
                                        <h4 style={{ marginBottom: '1rem', color: '#ea580c', borderBottom: '2px solid #fed7aa', paddingBottom: '0.5rem' }}>
                                            <i className="fas fa-tags"></i> Keywords
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

                                {/* Notes Section */}
                                {selectedWork.Notes && (
                                    <>
                                        <h4 style={{ marginBottom: '0.5rem', color: '#0891b2', borderBottom: '2px solid #cffafe', paddingBottom: '0.5rem' }}>
                                            <i className="fas fa-sticky-note"></i> Notes
                                        </h4>
                                        <div style={{
                                            backgroundColor: '#f0fdfa',
                                            padding: '1rem',
                                            borderRadius: '8px',
                                            borderLeft: '4px solid #0891b2',
                                            marginBottom: '1.5rem'
                                        }}>
                                            <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>{selectedWork.Notes}</p>
                                        </div>
                                    </>
                                )}

                                {/* View Visits Button */}
                                <div style={{
                                    marginTop: '2rem',
                                    paddingTop: '1.5rem',
                                    borderTop: '2px solid #e5e7eb',
                                    display: 'flex',
                                    gap: '1rem'
                                }}>
                                    <button
                                        onClick={() => window.location.href = `/views/visits.html?workId=${selectedWork.workid}&patient=${patientId}`}
                                        className="btn btn-primary"
                                        style={{
                                            backgroundColor: '#059669',
                                            padding: '0.75rem 1.5rem',
                                            fontSize: '1rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem',
                                            border: 'none',
                                            borderRadius: '6px',
                                            cursor: 'pointer',
                                            color: 'white',
                                            fontWeight: '600'
                                        }}
                                    >
                                        <i className="fas fa-calendar-check"></i> View All Visits
                                    </button>
                                </div>
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
        </div>
    );
};

export default WorkComponent;