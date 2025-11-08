/**
 * VisitsComponent - Work-based visit history display and management
 *
 * Provides full CRUD operations for visits tied to specific work IDs
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import NewVisitComponent from './NewVisitComponent.jsx';

const VisitsComponent = ({ workId, patientId, autoShowForm = false }) => {
    const navigate = useNavigate();
    const [visits, setVisits] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showForm, setShowForm] = useState(autoShowForm);
    const [editingVisitId, setEditingVisitId] = useState(null);

    useEffect(() => {
        if (workId) {
            loadVisits();
        }
    }, [workId]);

    const loadVisits = async () => {
        try {
            setLoading(true);
            const response = await fetch(`/api/getvisitsbywork?workId=${workId}`);
            if (!response.ok) throw new Error('Failed to fetch visits');
            const data = await response.json();
            // Sort by visit date ascending (oldest first)
            const sortedData = data.sort((a, b) => new Date(a.VisitDate) - new Date(b.VisitDate));
            setVisits(sortedData);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleAddVisit = () => {
        setEditingVisitId(null);
        setShowForm(true);
    };

    const handleEditVisit = (visit) => {
        setEditingVisitId(visit.ID);
        setShowForm(true);
    };

    const handleDeleteVisit = async (visitId) => {
        if (!confirm('Are you sure you want to delete this visit? This action cannot be undone.')) return;

        try {
            const response = await fetch('/api/deletevisitbywork', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ visitId })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to delete visit');
            }

            await loadVisits();
        } catch (err) {
            setError(err.message);
        }
    };

    const handleFormSave = async () => {
        await loadVisits();
        setShowForm(false);
        setEditingVisitId(null);
    };

    const handleFormCancel = () => {
        setShowForm(false);
        setEditingVisitId(null);
    };

    const formatDateTime = (dateString) => {
        if (!dateString) return 'Not set';
        return new Date(dateString).toLocaleString();
    };

    if (loading) return <div className="work-loading">Loading visits...</div>;

    return (
        <div className="work-component">
            <div className="work-header">
                <h2>Visit History</h2>
                <div className="work-controls">
                    {patientId && (
                        <button
                            onClick={() => navigate(`/patient/${patientId}/works`)}
                            className="btn btn-secondary"
                        >
                            <i className="fas fa-arrow-left"></i> Back
                        </button>
                    )}
                    {!showForm && (
                        <button onClick={handleAddVisit} className="btn btn-primary">
                            <i className="fas fa-plus"></i> Add Visit
                        </button>
                    )}
                </div>
            </div>

            {error && (
                <div className="work-error">
                    {error}
                    <button onClick={() => setError(null)} className="error-close">×</button>
                </div>
            )}

            {!showForm && (
                <div className="work-summary">
                    <div className="summary-card">
                        <h3>Total Visits</h3>
                        <span className="summary-value">{visits.length}</span>
                    </div>
                    <div className="summary-card">
                        <h3>OPG Taken</h3>
                        <span className="summary-value">{visits.filter(v => v.OPG).length}</span>
                    </div>
                    <div className="summary-card">
                        <h3>Photos Taken</h3>
                        <span className="summary-value">{visits.filter(v => v.IPhoto || v.PPhoto || v.FPhoto).length}</span>
                    </div>
                </div>
            )}

            {/* New Visit Form Component */}
            {showForm && (
                <div className="form-container">
                    <NewVisitComponent
                        workId={workId}
                        visitId={editingVisitId}
                        onSave={handleFormSave}
                        onCancel={handleFormCancel}
                    />
                </div>
            )}

            {/* Visit Cards View - Shows all details including Others and NextVisit */}
            {!showForm && (
            <div className="visit-cards-container">
                {visits.map((visit) => (
                    <div key={visit.ID} className="visit-card">
                        {/* Header Row */}
                        <div className="visit-card-header">
                            <div>
                                <h3 className="visit-card-title">
                                    <i className="fas fa-calendar-check"></i> {formatDateTime(visit.VisitDate)}
                                </h3>
                                <div className="visit-card-meta">
                                    {visit.OperatorName && (
                                        <span><i className="fas fa-user-md"></i> {visit.OperatorName}</span>
                                    )}
                                    {visit.OPG && (
                                        <span className="meta-success"><i className="fas fa-x-ray"></i> OPG</span>
                                    )}
                                    {visit.ApplianceRemoved && (
                                        <span className="meta-danger"><i className="fas fa-times-circle"></i> Removed</span>
                                    )}
                                </div>
                            </div>
                            <div className="action-buttons">
                                <button
                                    onClick={() => handleEditVisit(visit)}
                                    className="btn btn-sm btn-secondary"
                                    title="Edit visit"
                                >
                                    <i className="fas fa-edit"></i>
                                </button>
                                <button
                                    onClick={() => handleDeleteVisit(visit.ID)}
                                    className="btn btn-sm btn-danger"
                                    title="Delete visit"
                                >
                                    <i className="fas fa-trash"></i>
                                </button>
                            </div>
                        </div>

                        {/* Wire Info */}
                        {(visit.UpperWireName || visit.LowerWireName) && (
                            <div className="wire-info">
                                {visit.UpperWireName && (
                                    <div className="wire-info-item">
                                        <div className="wire-info-label">Upper Wire:</div>
                                        <div className="wire-info-value">{visit.UpperWireName}</div>
                                    </div>
                                )}
                                {visit.LowerWireName && (
                                    <div className="wire-info-item">
                                        <div className="wire-info-label">Lower Wire:</div>
                                        <div className="wire-info-value">{visit.LowerWireName}</div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Treatment Info */}
                        {(visit.BracketChange || visit.WireBending || visit.Elastics) && (
                            <div className="treatment-info">
                                {visit.BracketChange && (
                                    <div className="treatment-info-item">
                                        <span className="treatment-info-label">Bracket: </span>
                                        <span className="treatment-info-value">{visit.BracketChange}</span>
                                    </div>
                                )}
                                {visit.WireBending && (
                                    <div className="treatment-info-item">
                                        <span className="treatment-info-label">Bending: </span>
                                        <span className="treatment-info-value">{visit.WireBending}</span>
                                    </div>
                                )}
                                {visit.Elastics && (
                                    <div className="treatment-info-item">
                                        <span className="treatment-info-label">Elastics: </span>
                                        <span className="treatment-info-value">{visit.Elastics}</span>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Photos */}
                        {(visit.IPhoto || visit.PPhoto || visit.FPhoto) && (
                            <div className="photo-badges">
                                {visit.IPhoto && <span className="photo-badge"><i className="fas fa-camera"></i> Initial</span>}
                                {visit.PPhoto && <span className="photo-badge"><i className="fas fa-camera"></i> Progress</span>}
                                {visit.FPhoto && <span className="photo-badge"><i className="fas fa-camera"></i> Final</span>}
                            </div>
                        )}

                        {/* IMPORTANT: Others (Notes) Section */}
                        {visit.Others && (
                            <div className="notes-section">
                                <strong><i className="fas fa-sticky-note"></i> Notes</strong>
                                <p>{visit.Others}</p>
                            </div>
                        )}

                        {/* IMPORTANT: Next Visit Instructions Section */}
                        {visit.NextVisit && (
                            <div className="next-visit-section">
                                <strong><i className="fas fa-arrow-circle-right"></i> Next Visit</strong>
                                <p>{visit.NextVisit}</p>
                            </div>
                        )}
                    </div>
                ))}
                {visits.length === 0 && (
                    <div className="empty-state">
                        <i className="fas fa-calendar-times"></i>
                        <p>No visits recorded yet.</p>
                    </div>
                )}
            </div>)}
        </div>
    );
};

export default VisitsComponent;
