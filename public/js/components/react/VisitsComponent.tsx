/**
 * VisitsComponent - Work-based visit history display
 *
 * Simple list view of visits for a specific work
 * Form functionality handled by separate NewVisitComponent via routing
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface Visit {
    ID: number;
    WorkID: number;
    VisitDate: string;
    OperatorID?: number;
    OperatorName?: string;
    UpperWireID?: number;
    UpperWireName?: string;
    LowerWireID?: number;
    LowerWireName?: string;
    BracketChange?: string;
    WireBending?: string;
    Elastics?: string;
    OPG?: boolean;
    IPhoto?: boolean;
    PPhoto?: boolean;
    FPhoto?: boolean;
    Others?: string;
    NextVisit?: string;
    ApplianceRemoved?: boolean;
}

interface VisitsComponentProps {
    workId: number | null;
    patientId?: string | number | null;
}

const VisitsComponent = ({ workId, patientId }: VisitsComponentProps) => {
    const navigate = useNavigate();
    const [visits, setVisits] = useState<Visit[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

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
            const data: Visit[] = await response.json();
            // Sort by visit date descending (most recent first)
            const sortedData = data.sort((a, b) => new Date(b.VisitDate).getTime() - new Date(a.VisitDate).getTime());
            setVisits(sortedData);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setLoading(false);
        }
    };

    const handleAddVisit = () => {
        navigate(`/patient/${patientId}/new-visit?workId=${workId}`);
    };

    const handleEditVisit = (visitId: number) => {
        navigate(`/patient/${patientId}/new-visit?workId=${workId}&visitId=${visitId}`);
    };

    const handleDeleteVisit = async (visitId: number) => {
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
            setError(err instanceof Error ? err.message : 'An error occurred');
        }
    };

    const formatDate = (dateString: string): string => {
        if (!dateString) return 'Not set';
        return new Date(dateString).toLocaleDateString();
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
                    <button onClick={handleAddVisit} className="btn btn-primary">
                        <i className="fas fa-plus"></i> Add Visit
                    </button>
                </div>
            </div>

            {error && (
                <div className="work-error">
                    {error}
                    <button onClick={() => setError(null)} className="error-close">×</button>
                </div>
            )}

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

            {/* Visit Cards View */}
            <div className="visit-cards-container">
                {visits.map((visit) => (
                    <div key={visit.ID} className="visit-card">
                        {/* Header Row */}
                        <div className="visit-card-header">
                            <div>
                                <h3 className="visit-card-title">
                                    <i className="fas fa-calendar-check"></i> {formatDate(visit.VisitDate)}
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
                                    onClick={() => handleEditVisit(visit.ID)}
                                    className="btn-edit"
                                    title="Edit visit"
                                >
                                    Edit
                                </button>
                                <button
                                    onClick={() => handleDeleteVisit(visit.ID)}
                                    className="btn-delete"
                                    title="Delete visit"
                                >
                                    Delete
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

                        {/* Notes Section */}
                        {visit.Others && (
                            <div className="notes-section">
                                <strong><i className="fas fa-sticky-note"></i> Notes</strong>
                                <p>{visit.Others}</p>
                            </div>
                        )}

                        {/* Next Visit Instructions */}
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
            </div>
        </div>
    );
};

export default VisitsComponent;
