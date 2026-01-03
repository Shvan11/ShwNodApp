/**
 * VisitsComponent - Work-based visit history display
 *
 * Simple list view of visits for a specific work
 * Form functionality handled by separate NewVisitComponent via routing
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './VisitsComponent.module.css';

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
    personId?: number | null;
}

const VisitsComponent = ({ workId, personId }: VisitsComponentProps) => {
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
        navigate(`/patient/${personId}/new-visit?workId=${workId}`);
    };

    const handleEditVisit = (visitId: number) => {
        navigate(`/patient/${personId}/new-visit?workId=${workId}&visitId=${visitId}`);
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

    if (loading) return <div className={styles.loading}>Loading visits...</div>;

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h2>Visit History</h2>
                <div className={styles.controls}>
                    {personId && (
                        <button
                            onClick={() => navigate(`/patient/${personId}/works`)}
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
                <div className={styles.error}>
                    {error}
                    <button onClick={() => setError(null)} className={styles.errorClose}>×</button>
                </div>
            )}

            <div className={styles.summary}>
                <div className={styles.summaryCard}>
                    <h3>Total Visits</h3>
                    <span className={styles.summaryValue}>{visits.length}</span>
                </div>
                <div className={styles.summaryCard}>
                    <h3>OPG Taken</h3>
                    <span className={styles.summaryValue}>{visits.filter(v => v.OPG).length}</span>
                </div>
                <div className={styles.summaryCard}>
                    <h3>Photos Taken</h3>
                    <span className={styles.summaryValue}>{visits.filter(v => v.IPhoto || v.PPhoto || v.FPhoto).length}</span>
                </div>
            </div>

            {/* Visit Cards View */}
            <div className={styles.cardsContainer}>
                {visits.map((visit) => (
                    <div key={visit.ID} className={styles.card}>
                        {/* Header Row */}
                        <div className={styles.cardHeader}>
                            <div>
                                <h3 className={styles.cardTitle}>
                                    <i className="fas fa-calendar-check"></i> {formatDate(visit.VisitDate)}
                                </h3>
                                <div className={styles.cardMeta}>
                                    {visit.OperatorName && (
                                        <span><i className="fas fa-user-md"></i> {visit.OperatorName}</span>
                                    )}
                                    {visit.OPG && (
                                        <span className={styles.metaSuccess}><i className="fas fa-x-ray"></i> OPG</span>
                                    )}
                                    {visit.ApplianceRemoved && (
                                        <span className={styles.metaDanger}><i className="fas fa-times-circle"></i> Removed</span>
                                    )}
                                </div>
                            </div>
                            <div className={styles.actionButtons}>
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
                            <div className={styles.wireInfo}>
                                {visit.UpperWireName && (
                                    <div className={styles.wireInfoItem}>
                                        <div className={styles.wireInfoLabel}>Upper Wire:</div>
                                        <div className={styles.wireInfoValue}>{visit.UpperWireName}</div>
                                    </div>
                                )}
                                {visit.LowerWireName && (
                                    <div className={styles.wireInfoItem}>
                                        <div className={styles.wireInfoLabel}>Lower Wire:</div>
                                        <div className={styles.wireInfoValue}>{visit.LowerWireName}</div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Treatment Info */}
                        {(visit.BracketChange || visit.WireBending || visit.Elastics) && (
                            <div className={styles.treatmentInfo}>
                                {visit.BracketChange && (
                                    <div className={styles.treatmentInfoItem}>
                                        <span className={styles.treatmentInfoLabel}>Bracket: </span>
                                        <span className={styles.treatmentInfoValue}>{visit.BracketChange}</span>
                                    </div>
                                )}
                                {visit.WireBending && (
                                    <div className={styles.treatmentInfoItem}>
                                        <span className={styles.treatmentInfoLabel}>Bending: </span>
                                        <span className={styles.treatmentInfoValue}>{visit.WireBending}</span>
                                    </div>
                                )}
                                {visit.Elastics && (
                                    <div className={styles.treatmentInfoItem}>
                                        <span className={styles.treatmentInfoLabel}>Elastics: </span>
                                        <span className={styles.treatmentInfoValue}>{visit.Elastics}</span>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Photos */}
                        {(visit.IPhoto || visit.PPhoto || visit.FPhoto) && (
                            <div className={styles.photoBadges}>
                                {visit.IPhoto && <span className={styles.photoBadge}><i className="fas fa-camera"></i> Initial</span>}
                                {visit.PPhoto && <span className={styles.photoBadge}><i className="fas fa-camera"></i> Progress</span>}
                                {visit.FPhoto && <span className={styles.photoBadge}><i className="fas fa-camera"></i> Final</span>}
                            </div>
                        )}

                        {/* Notes Section */}
                        {visit.Others && (
                            <div className={styles.notesSection}>
                                <strong><i className="fas fa-sticky-note"></i> Notes</strong>
                                <p>{visit.Others}</p>
                            </div>
                        )}

                        {/* Next Visit Instructions */}
                        {visit.NextVisit && (
                            <div className={styles.nextVisitSection}>
                                <strong><i className="fas fa-arrow-circle-right"></i> Next Visit</strong>
                                <p>{visit.NextVisit}</p>
                            </div>
                        )}
                    </div>
                ))}
                {visits.length === 0 && (
                    <div className={styles.emptyState}>
                        <i className="fas fa-calendar-times"></i>
                        <p>No visits recorded yet.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default VisitsComponent;
