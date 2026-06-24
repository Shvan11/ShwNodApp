/**
 * VisitsComponent - Work-based visit history display
 *
 * Simple list view of visits for a specific work
 * Form functionality handled by separate NewVisitComponent via routing
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useConfirm } from '../../contexts/ConfirmContext';
import { deleteJSON, httpErrorMessage } from '@/core/http';
import { formatDate } from '@/core/utils';
import { qk } from '@/query/keys';
import { visitsByWorkQuery } from '@/query/queries';
import type { VisitRow } from '@shared/contracts/visit.contract';
import styles from './VisitsComponent.module.css';

// The visit wire row is owned by the visit contract (single source of truth for
// both the list and single-visit endpoints) — no parallel hand-written copy.
type Visit = VisitRow;

interface VisitsComponentProps {
    workId: number | null;
    personId?: number | null;
}

const SEARCHABLE_FIELDS: (keyof Visit)[] = [
    'others', 'bracket_change', 'wire_bending', 'elastics', 'next_visit',
];

const visitMatches = (visit: Visit, term: string): boolean => {
    if (!term) return true;
    const needle = term.toLowerCase();
    return SEARCHABLE_FIELDS.some(f => {
        const value = visit[f];
        return typeof value === 'string' && value.toLowerCase().includes(needle);
    });
};

const highlight = (text: string | undefined, term: string, markClass: string): React.ReactNode => {
    if (!text) return text;
    if (!term) return text;
    const needle = term.toLowerCase();
    const lower = text.toLowerCase();
    const parts: React.ReactNode[] = [];
    let i = 0;
    let key = 0;
    let idx = lower.indexOf(needle, i);
    while (idx !== -1) {
        if (idx > i) parts.push(text.slice(i, idx));
        parts.push(<mark key={key++} className={markClass}>{text.slice(idx, idx + term.length)}</mark>);
        i = idx + term.length;
        idx = lower.indexOf(needle, i);
    }
    if (i < text.length) parts.push(text.slice(i));
    return parts;
};

const VisitsComponent = ({ workId, personId }: VisitsComponentProps) => {
    const navigate = useNavigate();
    const confirm = useConfirm();
    const queryClient = useQueryClient();
    const [searchTerm, setSearchTerm] = useState('');
    // Error raised by the delete mutation / dismissed by the banner's close
    // button. Kept separate from the query's read error so each can clear
    // independently. The visitsByWork response is a loose contract array (only
    // `id` is modeled), so the rows are cast to Visit below.
    const [actionError, setActionError] = useState<string | null>(null);

    // Visit list now reads from React Query (keyed by workId; the monotonic
    // request guard is handled by RQ's per-key in-flight dedup + cancellation).
    const { data, isLoading: loading, error: queryError } = useQuery({
        ...visitsByWorkQuery(workId ?? ''),
        enabled: !!workId,
    });

    // Sort by visit date descending (most recent first) on a copy, leaving the
    // cached array untouched.
    const visits: Visit[] = [...(data ?? [])].sort(
        (a, b) => new Date(b.visit_date).getTime() - new Date(a.visit_date).getTime()
    );

    const error = actionError ?? (queryError ? httpErrorMessage(queryError, 'An error occurred') : null);

    const handleAddVisit = () => {
        navigate(`/patient/${personId}/new-visit?workId=${workId}`);
    };

    const handleEditVisit = (visitId: number) => {
        navigate(`/patient/${personId}/new-visit?workId=${workId}&visitId=${visitId}`);
    };

    const handleDeleteVisit = async (visitId: number) => {
        if (!await confirm('Are you sure you want to delete this visit? This action cannot be undone.', { title: 'Delete Visit', danger: true, confirmText: 'Delete' })) return;

        try {
            await deleteJSON('/api/deletevisitbywork', { body: JSON.stringify({ visitId }) });
            // Invalidate the work's data (qk.work.all covers qk.work.visits) so the
            // list refreshes here AND in any other observer of this work's visits.
            await queryClient.invalidateQueries({ queryKey: qk.work.all(workId ?? '') });
        } catch (err) {
            setActionError(httpErrorMessage(err, 'Failed to delete visit'));
        }
    };

    if (loading) return <div className={styles.loading}>Loading visits...</div>;

    const filteredVisits = searchTerm
        ? visits.filter(v => visitMatches(v, searchTerm))
        : visits;

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
                    <button onClick={() => setActionError(null)} className={styles.errorClose}>×</button>
                </div>
            )}

            <div className={styles.searchBar}>
                <i className="fas fa-search"></i>
                <input
                    type="search"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search notes, bracket, bending, elastics, next visit…"
                    className={styles.searchInput}
                />
                {searchTerm && (
                    <span className={styles.searchCount}>
                        {filteredVisits.length} of {visits.length}
                    </span>
                )}
            </div>

            <div className={styles.summary}>
                <div className={styles.summaryCard}>
                    <h3>Total Visits</h3>
                    <span className={styles.summaryValue}>{visits.length}</span>
                </div>
                <div className={styles.summaryCard}>
                    <h3>OPG Taken</h3>
                    <span className={styles.summaryValue}>{visits.filter(v => v.opg).length}</span>
                </div>
                <div className={styles.summaryCard}>
                    <h3>Photos Taken</h3>
                    <span className={styles.summaryValue}>{visits.filter(v => v.i_photo || v.p_photo || v.f_photo).length}</span>
                </div>
            </div>

            {/* Visit Cards View */}
            <div className={styles.cardsContainer}>
                {filteredVisits.map((visit) => (
                    <div key={visit.id} className={styles.card}>
                        {/* Header Row */}
                        <div className={styles.cardHeader}>
                            <div>
                                <h3 className={styles.cardTitle}>
                                    <i className="fas fa-calendar-check"></i> {formatDate(visit.visit_date) || 'Not set'}
                                </h3>
                                <div className={styles.cardMeta}>
                                    {visit.OperatorName && (
                                        <span><i className="fas fa-user-md"></i> {visit.OperatorName}</span>
                                    )}
                                    {visit.opg && (
                                        <span className={styles.metaSuccess}><i className="fas fa-x-ray"></i> OPG</span>
                                    )}
                                    {visit.appliance_removed && (
                                        <span className={styles.metaDanger}><i className="fas fa-times-circle"></i> Removed</span>
                                    )}
                                </div>
                            </div>
                            <div className={styles.actionButtons}>
                                <button
                                    onClick={() => handleEditVisit(visit.id)}
                                    className="btn-edit"
                                    title="Edit visit"
                                >
                                    Edit
                                </button>
                                <button
                                    onClick={() => handleDeleteVisit(visit.id)}
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
                        {(visit.bracket_change || visit.wire_bending || visit.elastics) && (
                            <div className={styles.treatmentInfo}>
                                {visit.bracket_change && (
                                    <div className={styles.treatmentInfoItem}>
                                        <span className={styles.treatmentInfoLabel}>Bracket: </span>
                                        <span className={styles.treatmentInfoValue}>{highlight(visit.bracket_change, searchTerm, styles.highlight)}</span>
                                    </div>
                                )}
                                {visit.wire_bending && (
                                    <div className={styles.treatmentInfoItem}>
                                        <span className={styles.treatmentInfoLabel}>Bending: </span>
                                        <span className={styles.treatmentInfoValue}>{highlight(visit.wire_bending, searchTerm, styles.highlight)}</span>
                                    </div>
                                )}
                                {visit.elastics && (
                                    <div className={styles.treatmentInfoItem}>
                                        <span className={styles.treatmentInfoLabel}>Elastics: </span>
                                        <span className={styles.treatmentInfoValue}>{highlight(visit.elastics, searchTerm, styles.highlight)}</span>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Photos */}
                        {(visit.i_photo || visit.p_photo || visit.f_photo) && (
                            <div className={styles.photoBadges}>
                                {visit.i_photo && <span className={styles.photoBadge}><i className="fas fa-camera"></i> Initial</span>}
                                {visit.p_photo && <span className={styles.photoBadge}><i className="fas fa-camera"></i> Progress</span>}
                                {visit.f_photo && <span className={styles.photoBadge}><i className="fas fa-camera"></i> Final</span>}
                            </div>
                        )}

                        {/* Notes Section */}
                        {visit.others && (
                            <div className={styles.notesSection}>
                                <strong><i className="fas fa-sticky-note"></i> Notes</strong>
                                <p>{highlight(visit.others, searchTerm, styles.highlight)}</p>
                            </div>
                        )}

                        {/* Next Visit Instructions */}
                        {visit.next_visit && (
                            <div className={styles.nextVisitSection}>
                                <strong><i className="fas fa-arrow-circle-right"></i> Next Visit</strong>
                                <p>{highlight(visit.next_visit, searchTerm, styles.highlight)}</p>
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
                {visits.length > 0 && filteredVisits.length === 0 && (
                    <div className={styles.emptyState}>
                        <i className="fas fa-search"></i>
                        <p>No visits match your search.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default VisitsComponent;
