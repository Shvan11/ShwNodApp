import React, { useState, useEffect } from 'react';

const AlignerPortalComponent = () => {
    // State management
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [doctor, setDoctor] = useState(null);
    const [cases, setCases] = useState([]);
    const [selectedCase, setSelectedCase] = useState(null);
    const [sets, setSets] = useState([]);
    const [batches, setBatches] = useState({});
    const [notes, setNotes] = useState({});
    const [expandedSets, setExpandedSets] = useState({});
    const [searchQuery, setSearchQuery] = useState('');
    const [showAddNote, setShowAddNote] = useState({});
    const [noteText, setNoteText] = useState('');

    // Logout via Cloudflare Access
    const handleLogout = () => {
        // Redirect to Cloudflare Access logout endpoint
        window.location.href = '/cdn-cgi/access/logout';
    };

    // Get email from URL query parameter
    const getEmailParam = () => {
        const params = new URLSearchParams(window.location.search);
        return params.get('email');
    };

    // Build URL with email parameter
    const buildUrl = (path) => {
        const email = getEmailParam();
        if (email) {
            const separator = path.includes('?') ? '&' : '?';
            return `${path}${separator}email=${encodeURIComponent(email)}`;
        }
        return path;
    };

    // Load doctor info on mount
    useEffect(() => {
        loadDoctorAuth();
    }, []);

    // Load doctor authentication
    const loadDoctorAuth = async () => {
        try {
            const response = await fetch(buildUrl('/api/portal/auth'));

            // Check if response is ok (status 200-299)
            if (!response.ok) {
                // Try to parse error response
                try {
                    const data = await response.json();
                    setError(data.error || 'Authentication failed. Please check your access.');
                } catch (parseError) {
                    console.error('Failed to parse error response:', parseError);
                    setError('Authentication failed. Please check your access.');
                }
                return;
            }

            const data = await response.json();

            if (data.success) {
                setDoctor(data.doctor);
                await loadCases();
            } else {
                setError(data.error || 'Authentication failed. Please check your access.');
            }
        } catch (error) {
            console.error('Error loading doctor auth:', error);
            setError('Failed to authenticate. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    // Load all cases for this doctor
    const loadCases = async () => {
        try {
            const response = await fetch(buildUrl('/api/portal/cases'));
            const data = await response.json();

            if (data.success) {
                setCases(data.cases || []);
            } else {
                throw new Error(data.error || 'Failed to load cases');
            }
        } catch (error) {
            console.error('Error loading cases:', error);
            setError('Failed to load cases');
        }
    };

    // Load sets for a specific case
    const loadSets = async (workId) => {
        try {
            const response = await fetch(buildUrl(`/api/portal/sets/${workId}`));
            const data = await response.json();

            if (data.success) {
                setSets(data.sets || []);

                // Auto-expand the active set
                const activeSet = data.sets?.find(set => set.IsActive);
                if (activeSet) {
                    // Load batches and notes for the active set and expand it
                    await loadBatches(activeSet.AlignerSetID);
                    await loadNotes(activeSet.AlignerSetID);
                    setExpandedSets(prev => ({ ...prev, [activeSet.AlignerSetID]: true }));
                }
            } else {
                throw new Error(data.error || 'Failed to load sets');
            }
        } catch (error) {
            console.error('Error loading sets:', error);
            alert('Failed to load aligner sets');
        }
    };

    // Load batches for a set
    const loadBatches = async (setId) => {
        try {
            const response = await fetch(buildUrl(`/api/portal/batches/${setId}`));
            const data = await response.json();

            if (data.success) {
                setBatches(prev => ({ ...prev, [setId]: data.batches || [] }));
            } else {
                throw new Error(data.error || 'Failed to load batches');
            }
        } catch (error) {
            console.error('Error loading batches:', error);
            alert('Failed to load batches');
        }
    };

    // Load notes for a set
    const loadNotes = async (setId) => {
        try {
            const response = await fetch(buildUrl(`/api/portal/notes/${setId}`));
            const data = await response.json();

            if (data.success) {
                setNotes(prev => ({ ...prev, [setId]: data.notes || [] }));
            } else {
                throw new Error(data.error || 'Failed to load notes');
            }
        } catch (error) {
            console.error('Error loading notes:', error);
            alert('Failed to load notes');
        }
    };

    // Toggle set expansion
    const toggleSet = async (setId) => {
        if (expandedSets[setId]) {
            setExpandedSets(prev => ({ ...prev, [setId]: false }));
        } else {
            if (!batches[setId]) {
                await loadBatches(setId);
            }
            if (!notes[setId]) {
                await loadNotes(setId);
            }
            setExpandedSets(prev => ({ ...prev, [setId]: true }));
        }
    };

    // Select a case to view details
    const selectCase = async (caseData) => {
        setSelectedCase(caseData);
        await loadSets(caseData.workid);
    };

    // Go back to cases list
    const backToCases = () => {
        setSelectedCase(null);
        setSets([]);
        setBatches({});
        setNotes({});
        setExpandedSets({});
    };

    // Update days per aligner
    const updateDays = async (batchId, newDays) => {
        try {
            const response = await fetch(buildUrl(`/api/portal/batches/${batchId}/days`), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ Days: newDays })
            });

            const data = await response.json();

            if (data.success) {
                // Reload batches to get updated computed values
                const batch = Object.values(batches)
                    .flat()
                    .find(b => b.AlignerBatchID === batchId);

                if (batch) {
                    await loadBatches(batch.AlignerSetID);
                }

                alert('Days per aligner updated successfully');
            } else {
                throw new Error(data.error || 'Failed to update days');
            }
        } catch (error) {
            console.error('Error updating days:', error);
            alert('Failed to update days per aligner');
        }
    };

    // Add a note
    const addNote = async (setId) => {
        if (!noteText.trim()) {
            alert('Please enter a note');
            return;
        }

        try {
            const response = await fetch(buildUrl('/api/portal/notes'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    AlignerSetID: setId,
                    NoteText: noteText.trim()
                })
            });

            const data = await response.json();

            if (data.success) {
                setNoteText('');
                setShowAddNote(prev => ({ ...prev, [setId]: false }));
                await loadNotes(setId);
            } else {
                throw new Error(data.error || 'Failed to add note');
            }
        } catch (error) {
            console.error('Error adding note:', error);
            alert('Failed to add note');
        }
    };

    // Format date
    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    };

    // Format datetime for notes
    const formatDateTime = (dateString) => {
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

    // Format patient name
    const formatPatientName = (caseData) => {
        return caseData.PatientName || `${caseData.FirstName} ${caseData.LastName}`;
    };


    // Calculate progress
    const calculateProgress = (set) => {
        const delivered = set.UpperAlignersCount + set.LowerAlignersCount -
                         set.RemainingUpperAligners - set.RemainingLowerAligners;
        const total = set.UpperAlignersCount + set.LowerAlignersCount;
        return total > 0 ? Math.round((delivered / total) * 100) : 0;
    };

    // Filter cases by search query
    const getFilteredCases = () => {
        if (!searchQuery.trim()) {
            return cases;
        }

        const query = searchQuery.toLowerCase();
        return cases.filter(c => {
            const patientName = formatPatientName(c).toLowerCase();
            const patientID = (c.patientID || '').toLowerCase();
            const phone = (c.Phone || '').toLowerCase();

            return patientName.includes(query) ||
                   patientID.includes(query) ||
                   phone.includes(query);
        });
    };

    // Get active and total cases count
    const getActiveCasesCount = () => cases.filter(c => c.ActiveSets > 0).length;

    // Render loading state
    if (loading) {
        return (
            <div className="portal-container">
                <div className="loading-container">
                    <div className="spinner"></div>
                    <p>Loading portal...</p>
                </div>
            </div>
        );
    }

    // Render error state
    if (error) {
        return (
            <div className="portal-container">
                <div className="error-container">
                    <i className="fas fa-exclamation-triangle"></i>
                    <h2>Authentication Error</h2>
                    <p>{error}</p>
                    <p style={{ marginTop: '1rem', fontSize: '0.875rem', color: '#666' }}>
                        Please contact your administrator to ensure your email is authorized for portal access.
                    </p>
                    <button className="logout-btn" onClick={handleLogout} style={{ marginTop: '1.5rem' }}>
                        <i className="fas fa-sign-out-alt"></i>
                        Logout
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="portal-container">
            {/* Header */}
            <header className="portal-header">
                <div className="portal-header-content">
                    <div className="portal-branding">
                        <i className="fas fa-tooth portal-logo"></i>
                        <div className="portal-title">
                            <h1>Shwan Aligner Portal</h1>
                            <div className="portal-subtitle">Doctor Access</div>
                        </div>
                    </div>
                    <div className="portal-doctor-info">
                        <span className="doctor-name">
                            <i className="fas fa-user-md"></i> Dr. {doctor?.DoctorName}
                        </span>
                        <button className="logout-btn" onClick={handleLogout}>
                            <i className="fas fa-sign-out-alt"></i>
                            Logout
                        </button>
                    </div>
                </div>
            </header>

            <main className="portal-main">
                {!selectedCase ? (
                    /* Dashboard View - Cases List */
                    <>
                        <div className="dashboard-header">
                            <h2 className="dashboard-title">My Cases</h2>
                        </div>

                        {/* Stats */}
                        <div className="dashboard-stats">
                            <div className="stat-card">
                                <div className="stat-value">{cases.length}</div>
                                <div className="stat-label">Total Cases</div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-value" style={{ color: 'var(--portal-success)' }}>
                                    {getActiveCasesCount()}
                                </div>
                                <div className="stat-label">Active Cases</div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-value" style={{ color: 'var(--portal-grey)' }}>
                                    {cases.length - getActiveCasesCount()}
                                </div>
                                <div className="stat-label">Completed</div>
                            </div>
                        </div>

                        {/* Search */}
                        <div className="search-container">
                            <i className="fas fa-search search-icon"></i>
                            <input
                                type="text"
                                className="search-input"
                                placeholder="Search by patient name, ID, or phone..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>

                        {/* Cases Grid */}
                        {getFilteredCases().length === 0 ? (
                            <div className="empty-state">
                                <i className="fas fa-inbox"></i>
                                <h3>No cases found</h3>
                                <p>
                                    {searchQuery ? 'Try a different search term' : 'No aligner cases assigned yet'}
                                </p>
                            </div>
                        ) : (
                            <div className="cases-grid">
                                {getFilteredCases().map((caseData) => (
                                    <div
                                        key={caseData.workid}
                                        className="case-card"
                                        onClick={() => selectCase(caseData)}
                                    >
                                        <div className="case-header">
                                            <div className="case-patient-info">
                                                <h3>{formatPatientName(caseData)}</h3>
                                                <div className="case-patient-id">#{caseData.patientID}</div>
                                            </div>
                                            {caseData.ActiveSets > 0 ? (
                                                <span className="case-active-badge">Active</span>
                                            ) : (
                                                <span className="case-inactive-badge">Completed</span>
                                            )}
                                        </div>

                                        {/* Active Set Info */}
                                        {caseData.ActiveSets > 0 ? (
                                            <div className="case-active-set-info">
                                                <div className="active-set-header">
                                                    <i className="fas fa-layer-group"></i>
                                                    <strong>Active Set Info</strong>
                                                </div>
                                                <div className="active-set-details">
                                                    <span><i className="fas fa-hashtag"></i> Set #{caseData.ActiveSetSequence || '?'}</span>
                                                    <span><i className="fas fa-teeth"></i> {caseData.ActiveUpperCount || 0}U / {caseData.ActiveLowerCount || 0}L</span>
                                                    <span><i className="fas fa-box-open"></i> Remaining: {caseData.ActiveRemainingUpper || 0}U / {caseData.ActiveRemainingLower || 0}L</span>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="case-no-active-set">
                                                <i className="fas fa-check-circle"></i> No active sets
                                            </div>
                                        )}

                                        {/* Payment Summary */}
                                        <div className="case-payment-summary">
                                            <div className="case-payment-item">
                                                <div className="case-payment-label">Total Required</div>
                                                <div className="case-payment-value">{caseData.SetCost || 0} {caseData.Currency || 'USD'}</div>
                                            </div>
                                            <div className="case-payment-divider"></div>
                                            <div className="case-payment-item">
                                                <div className="case-payment-label">Total Paid</div>
                                                <div className="case-payment-value paid">{caseData.TotalPaid || 0} {caseData.Currency || 'USD'}</div>
                                            </div>
                                            <div className="case-payment-divider"></div>
                                            <div className="case-payment-item">
                                                <div className="case-payment-label">Balance</div>
                                                <div className="case-payment-value balance">{caseData.Balance !== null && caseData.Balance !== undefined ? caseData.Balance : (caseData.SetCost || 0)} {caseData.Currency || 'USD'}</div>
                                            </div>
                                        </div>

                                        {/* URLs for Active Set */}
                                        {(caseData.SetUrl || caseData.SetPdfUrl) && (
                                            <div className="case-urls">
                                                {caseData.SetUrl && (
                                                    <a
                                                        href={caseData.SetUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="case-url-btn"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        <i className="fas fa-link"></i>
                                                        Setup URL
                                                    </a>
                                                )}
                                                {caseData.SetPdfUrl && (
                                                    <a
                                                        href={caseData.SetPdfUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="case-url-btn pdf"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        <i className="fas fa-file-pdf"></i>
                                                        View PDF
                                                    </a>
                                                )}
                                            </div>
                                        )}

                                        <div className="case-stats">
                                            <div className="case-stat">
                                                <div className="case-stat-value">{caseData.TotalSets}</div>
                                                <div className="case-stat-label">Sets</div>
                                            </div>
                                            <div className="case-stat">
                                                <div className="case-stat-value" style={{ color: 'var(--portal-success)' }}>
                                                    {caseData.ActiveSets}
                                                </div>
                                                <div className="case-stat-label">Active</div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                ) : (
                    /* Case Detail View */
                    <div className="case-detail-container">
                        <button className="back-button" onClick={backToCases}>
                            <i className="fas fa-arrow-left"></i>
                            Back to Cases
                        </button>

                        <div className="patient-header-card">
                            <h2>{formatPatientName(selectedCase)}</h2>
                            <div className="patient-meta-row">
                                <span><i className="fas fa-id-card"></i> Patient ID: {selectedCase.patientID}</span>
                            </div>
                        </div>

                        {/* Sets List */}
                        {sets.length === 0 ? (
                            <div className="empty-state">
                                <i className="fas fa-inbox"></i>
                                <h3>No aligner sets found</h3>
                            </div>
                        ) : (
                            <div className="sets-list">
                                {sets.map((set) => {
                                    const progress = calculateProgress(set);
                                    const delivered = set.UpperAlignersCount + set.LowerAlignersCount -
                                                    set.RemainingUpperAligners - set.RemainingLowerAligners;
                                    const total = set.UpperAlignersCount + set.LowerAlignersCount;

                                    return (
                                        <div key={set.AlignerSetID} className={`set-card ${set.IsActive ? '' : 'inactive'}`}>
                                            <div className="set-header" onClick={() => toggleSet(set.AlignerSetID)}>
                                                <div className="set-title-row">
                                                    <h3>Set #{set.SetSequence}</h3>
                                                    {set.Type && (
                                                        <span className="set-type-badge">{set.Type}</span>
                                                    )}
                                                    <span className={set.IsActive ? 'case-active-badge' : 'case-inactive-badge'}>
                                                        {set.IsActive ? 'Active' : 'Inactive'}
                                                    </span>
                                                </div>
                                                <button className={`set-expand-btn ${expandedSets[set.AlignerSetID] ? 'expanded' : ''}`}>
                                                    <i className="fas fa-chevron-down"></i>
                                                </button>
                                            </div>

                                            <div className="set-info-grid">
                                                <div className="set-info-item">
                                                    <i className="fas fa-teeth"></i>
                                                    <span>Upper: <strong>{set.UpperAlignersCount}</strong></span>
                                                </div>
                                                <div className="set-info-item">
                                                    <i className="fas fa-teeth"></i>
                                                    <span>Lower: <strong>{set.LowerAlignersCount}</strong></span>
                                                </div>
                                                <div className="set-info-item">
                                                    <i className="fas fa-calendar"></i>
                                                    <span>Created: <strong>{formatDate(set.CreationDate)}</strong></span>
                                                </div>
                                                <div className="set-info-item">
                                                    <i className="fas fa-box"></i>
                                                    <span>Batches: <strong>{set.TotalBatches}</strong></span>
                                                </div>
                                            </div>

                                            {/* Payment Summary */}
                                            <div className="set-payment-summary">
                                                <div className="payment-summary-item">
                                                    <div className="payment-summary-label">Total Required</div>
                                                    <div className="payment-summary-value">{set.SetCost || 0} {set.Currency || 'USD'}</div>
                                                </div>
                                                <div className="payment-summary-divider"></div>
                                                <div className="payment-summary-item">
                                                    <div className="payment-summary-label">Total Paid</div>
                                                    <div className="payment-summary-value paid">{set.TotalPaid || 0} {set.Currency || 'USD'}</div>
                                                </div>
                                                <div className="payment-summary-divider"></div>
                                                <div className="payment-summary-item">
                                                    <div className="payment-summary-label">Balance</div>
                                                    <div className="payment-summary-value balance">{set.Balance !== null && set.Balance !== undefined ? set.Balance : (set.SetCost || 0)} {set.Currency || 'USD'}</div>
                                                </div>
                                                <div className="payment-summary-status">
                                                    <span className={`payment-status-badge ${set.PaymentStatus?.toLowerCase() || 'unpaid'}`}>
                                                        {set.PaymentStatus || 'Unpaid'}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* URLs */}
                                            <div className="set-urls">
                                                {set.SetUrl && (
                                                    <a href={set.SetUrl} target="_blank" rel="noopener noreferrer" className="url-btn">
                                                        <i className="fas fa-link"></i>
                                                        Setup URL
                                                    </a>
                                                )}
                                                {set.SetPdfUrl && (
                                                    <a href={set.SetPdfUrl} target="_blank" rel="noopener noreferrer" className="url-btn pdf">
                                                        <i className="fas fa-file-pdf"></i>
                                                        View PDF
                                                    </a>
                                                )}
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

                                            {expandedSets[set.AlignerSetID] && (
                                                <>
                                                    {/* Batches */}
                                                    {batches[set.AlignerSetID] && batches[set.AlignerSetID].length > 0 && (
                                                        <BatchesSection
                                                            batches={batches[set.AlignerSetID]}
                                                            onUpdateDays={updateDays}
                                                            formatDate={formatDate}
                                                        />
                                                    )}

                                                    {/* Notes */}
                                                    <NotesSection
                                                        setId={set.AlignerSetID}
                                                        notes={notes[set.AlignerSetID] || []}
                                                        showAddNote={showAddNote[set.AlignerSetID]}
                                                        noteText={noteText}
                                                        onToggleAddNote={(show) => setShowAddNote(prev => ({ ...prev, [set.AlignerSetID]: show }))}
                                                        onNoteTextChange={setNoteText}
                                                        onAddNote={addNote}
                                                        formatDateTime={formatDateTime}
                                                    />
                                                </>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
};

// Batches Section Component
const BatchesSection = ({ batches, onUpdateDays, formatDate }) => {
    const [editingDays, setEditingDays] = useState({});
    const [daysValues, setDaysValues] = useState({});

    const handleStartEdit = (batchId, currentDays) => {
        setEditingDays(prev => ({ ...prev, [batchId]: true }));
        setDaysValues(prev => ({ ...prev, [batchId]: currentDays || '' }));
    };

    const handleSave = async (batchId) => {
        const newDays = parseInt(daysValues[batchId]);
        if (isNaN(newDays) || newDays < 1) {
            alert('Please enter a valid number of days (minimum 1)');
            return;
        }

        await onUpdateDays(batchId, newDays);
        setEditingDays(prev => ({ ...prev, [batchId]: false }));
    };

    const handleCancel = (batchId) => {
        setEditingDays(prev => ({ ...prev, [batchId]: false }));
        setDaysValues(prev => ({ ...prev, [batchId]: '' }));
    };

    return (
        <div className="batches-section">
            <h4>Batches</h4>
            {batches.map((batch) => {
                const isDelivered = batch.DeliveredToPatientDate !== null;

                return (
                    <div key={batch.AlignerBatchID} className={`batch-card ${isDelivered ? 'delivered' : ''}`}>
                        <div className="batch-header">
                            <div className="batch-title">Batch #{batch.BatchSequence}</div>
                            <span className={`batch-status ${isDelivered ? 'delivered' : 'pending'}`}>
                                {isDelivered ? 'Delivered' : 'Pending'}
                            </span>
                        </div>

                        <div className="batch-info-grid">
                            <div className="batch-info-item">
                                <i className="fas fa-teeth"></i>
                                Upper: {batch.UpperAlignerStartSequence}-{batch.UpperAlignerEndSequence} ({batch.UpperAlignerCount})
                            </div>
                            <div className="batch-info-item">
                                <i className="fas fa-teeth"></i>
                                Lower: {batch.LowerAlignerStartSequence}-{batch.LowerAlignerEndSequence} ({batch.LowerAlignerCount})
                            </div>
                            <div className="batch-info-item">
                                <i className="fas fa-industry"></i>
                                Manufactured: {formatDate(batch.ManufactureDate)}
                            </div>
                            {isDelivered && (
                                <div className="batch-info-item">
                                    <i className="fas fa-truck"></i>
                                    Delivered: {formatDate(batch.DeliveredToPatientDate)}
                                </div>
                            )}
                            <div className="batch-info-item">
                                <i className="fas fa-clock"></i>
                                <span>Days per Aligner: </span>
                                {editingDays[batch.AlignerBatchID] ? (
                                    <div className="days-editor">
                                        <input
                                            type="number"
                                            className="days-input"
                                            value={daysValues[batch.AlignerBatchID]}
                                            onChange={(e) => setDaysValues(prev => ({
                                                ...prev,
                                                [batch.AlignerBatchID]: e.target.value
                                            }))}
                                            min="1"
                                        />
                                        <button
                                            className="days-save-btn"
                                            onClick={() => handleSave(batch.AlignerBatchID)}
                                        >
                                            Save
                                        </button>
                                        <button
                                            className="btn-cancel"
                                            onClick={() => handleCancel(batch.AlignerBatchID)}
                                            style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <strong>{batch.Days || 'N/A'}</strong>
                                        <button
                                            onClick={() => handleStartEdit(batch.AlignerBatchID, batch.Days)}
                                            style={{
                                                background: 'none',
                                                border: 'none',
                                                color: 'var(--portal-primary)',
                                                cursor: 'pointer',
                                                marginLeft: '0.5rem'
                                            }}
                                        >
                                            <i className="fas fa-edit"></i>
                                        </button>
                                    </>
                                )}
                            </div>
                            <div className="batch-info-item">
                                <i className="fas fa-hourglass-half"></i>
                                Validity: {batch.ValidityPeriod || 'N/A'} days
                            </div>
                            {batch.NextBatchReadyDate && (
                                <div className="batch-info-item">
                                    <i className="fas fa-calendar-check"></i>
                                    Next Batch: {formatDate(batch.NextBatchReadyDate)}
                                </div>
                            )}
                        </div>

                        {batch.Notes && (
                            <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--portal-grey)' }}>
                                <i className="fas fa-sticky-note"></i> {batch.Notes}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

// Notes Section Component
const NotesSection = ({
    setId,
    notes,
    showAddNote,
    noteText,
    onToggleAddNote,
    onNoteTextChange,
    onAddNote,
    formatDateTime
}) => {
    return (
        <div className="notes-section">
            <div className="notes-header">
                <h3>Communication</h3>
                {!showAddNote && (
                    <button className="btn-add-note" onClick={() => onToggleAddNote(true)}>
                        <i className="fas fa-plus"></i>
                        Add Note
                    </button>
                )}
            </div>

            {showAddNote && (
                <div className="add-note-form">
                    <textarea
                        className="note-textarea"
                        placeholder="Type your message to the lab..."
                        value={noteText}
                        onChange={(e) => onNoteTextChange(e.target.value)}
                    />
                    <div className="note-form-actions">
                        <button className="btn-cancel" onClick={() => onToggleAddNote(false)}>
                            Cancel
                        </button>
                        <button className="btn-submit" onClick={() => onAddNote(setId)}>
                            <i className="fas fa-paper-plane"></i>
                            Send Note
                        </button>
                    </div>
                </div>
            )}

            <div className="notes-timeline">
                {notes.length === 0 ? (
                    <div className="empty-state" style={{ padding: '2rem 1rem' }}>
                        <i className="fas fa-comments"></i>
                        <p>No messages yet</p>
                    </div>
                ) : (
                    notes.map((note) => (
                        <div key={note.NoteID} className={`note-item ${note.NoteType === 'Lab' ? 'lab-note' : ''}`}>
                            <div className="note-header-row">
                                <div className={`note-author ${note.NoteType === 'Lab' ? 'lab' : ''}`}>
                                    <i className={note.NoteType === 'Lab' ? 'fas fa-flask' : 'fas fa-user-md'}></i>
                                    {note.NoteType === 'Lab' ? 'Shwan Lab' : `Dr. ${note.DoctorName}`}
                                </div>
                                <div className="note-date">
                                    {formatDateTime(note.CreatedAt)}
                                    {note.IsEdited && ' (edited)'}
                                </div>
                            </div>
                            <p className="note-text">{note.NoteText}</p>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default AlignerPortalComponent;
