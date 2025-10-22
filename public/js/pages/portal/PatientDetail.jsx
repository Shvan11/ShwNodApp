// PatientDetail.jsx - Individual patient case detail view
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PortalHeader from '../../components/react/portal/PortalHeader.jsx';
import BatchesSection from '../../components/react/portal/BatchesSection.jsx';
import NotesSection from '../../components/react/portal/NotesSection.jsx';

const PatientDetail = () => {
    const { workId } = useParams();
    const navigate = useNavigate();

    const [loading, setLoading] = useState(true);
    const [doctor, setDoctor] = useState(null);
    const [selectedCase, setSelectedCase] = useState(null);
    const [sets, setSets] = useState([]);
    const [batches, setBatches] = useState({});
    const [notes, setNotes] = useState({});
    const [expandedSets, setExpandedSets] = useState({});

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

    // Load data on mount
    useEffect(() => {
        loadData();
    }, [workId]);

    const loadData = async () => {
        try {
            // Load doctor auth
            const authResponse = await fetch(buildUrl('/api/portal/auth'));
            const authData = await authResponse.json();

            if (authData.success) {
                setDoctor(authData.doctor);
            }

            // Load case details
            const casesResponse = await fetch(buildUrl('/api/portal/cases'));
            const casesData = await casesResponse.json();

            if (casesData.success) {
                const caseData = casesData.cases.find(c => c.workid === parseInt(workId));
                if (caseData) {
                    setSelectedCase(caseData);
                    await loadSets(workId);
                }
            }
        } catch (error) {
            console.error('Error loading data:', error);
        } finally {
            setLoading(false);
        }
    };

    // Load sets for the case
    const loadSets = async (workIdParam) => {
        try {
            const response = await fetch(buildUrl(`/api/portal/sets/${workIdParam}`));
            const data = await response.json();

            if (data.success) {
                setSets(data.sets || []);

                // Auto-expand the active set
                const activeSet = data.sets?.find(set => set.IsActive);
                if (activeSet) {
                    await loadBatches(activeSet.AlignerSetID);
                    await loadNotes(activeSet.AlignerSetID);
                    setExpandedSets(prev => ({ ...prev, [activeSet.AlignerSetID]: true }));
                }
            }
        } catch (error) {
            console.error('Error loading sets:', error);
        }
    };

    // Load batches for a set
    const loadBatches = async (setId) => {
        try {
            const response = await fetch(buildUrl(`/api/portal/batches/${setId}`));
            const data = await response.json();

            if (data.success) {
                setBatches(prev => ({ ...prev, [setId]: data.batches || [] }));
            }
        } catch (error) {
            console.error('Error loading batches:', error);
        }
    };

    // Load notes for a set
    const loadNotes = async (setId) => {
        try {
            const response = await fetch(buildUrl(`/api/portal/notes/${setId}`));
            const data = await response.json();

            if (data.success) {
                setNotes(prev => ({ ...prev, [setId]: data.notes || [] }));
            }
        } catch (error) {
            console.error('Error loading notes:', error);
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
    const addNote = async (setId, noteText) => {
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
                await loadNotes(setId);
            } else {
                throw new Error(data.error || 'Failed to add note');
            }
        } catch (error) {
            console.error('Error adding note:', error);
            alert('Failed to add note');
        }
    };

    // Navigate back to dashboard
    const backToCases = () => {
        navigate(`/portal${window.location.search}`);
    };

    // Format patient name
    const formatPatientName = (caseData) => {
        return caseData?.PatientName || `${caseData?.FirstName} ${caseData?.LastName}`;
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

    // Calculate progress
    const calculateProgress = (set) => {
        const delivered = set.UpperAlignersCount + set.LowerAlignersCount -
                         set.RemainingUpperAligners - set.RemainingLowerAligners;
        const total = set.UpperAlignersCount + set.LowerAlignersCount;
        return total > 0 ? Math.round((delivered / total) * 100) : 0;
    };

    if (loading) {
        return (
            <div className="portal-container">
                <div className="loading-container">
                    <div className="spinner"></div>
                    <p>Loading case details...</p>
                </div>
            </div>
        );
    }

    if (!selectedCase) {
        return (
            <div className="portal-container">
                <PortalHeader doctor={doctor} />
                <div className="error-container">
                    <i className="fas fa-exclamation-triangle"></i>
                    <h2>Case Not Found</h2>
                    <p>The requested case could not be found.</p>
                    <button onClick={backToCases} className="logout-btn">
                        Back to Dashboard
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="portal-container">
            <PortalHeader doctor={doctor} />

            <main className="portal-main">
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
            </main>
        </div>
    );
};

export default PatientDetail;
