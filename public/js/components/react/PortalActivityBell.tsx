import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../contexts/ToastContext';
import { httpErrorMessage } from '@/core/http';
import { portalActivityQuery } from '@/query/queries';
import {
    markPortalActivityRead,
    markAllPortalActivityRead,
    notifyPortalActivityChanged,
    PORTAL_ACTIVITY_CHANGED_EVENT,
    PORTAL_ACTIVITY_REFRESH_MS,
    type PortalActivityRow,
} from '@/services/portal-activity';
import styles from './PortalActivityBell.module.css';

const POPOVER_WIDTH = 380;

const TYPE_ICON: Record<PortalActivityRow['activity_type'], string> = {
    DoctorNote: 'fa-comment-medical',
    DaysChanged: 'fa-calendar-day',
    PhotoUploaded: 'fa-camera',
    FileUploaded: 'fa-file-arrow-up',
};

function relAge(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(diff)) return '';
    const day = 86_400_000;
    if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m`;
    if (diff < day) return `${Math.floor(diff / 3_600_000)}h`;
    return `${Math.floor(diff / day)}d`;
}

/** Local calendar day of an ISO timestamp, for the (set, type, day) grouping. */
function dayKey(iso: string | null): string {
    if (!iso) return 'unknown';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? 'unknown' : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// A per-file upload burst (or repeated notes/day-tweaks) collapses into one
// feed entry: same set + same type + same local day. The feed arrives newest
// first, so the first row seen per group is its `latest`.
type ActivityGroup = {
    key: string;
    type: PortalActivityRow['activity_type'];
    latest: PortalActivityRow;
    count: number;
    unreadIds: number[];
};

function groupRows(rows: PortalActivityRow[]): ActivityGroup[] {
    const groups = new Map<string, ActivityGroup>();
    for (const r of rows) {
        const key = `${r.aligner_set_id}|${r.activity_type}|${dayKey(r.created_at)}`;
        let g = groups.get(key);
        if (!g) {
            g = { key, type: r.activity_type, latest: r, count: 0, unreadIds: [] };
            groups.set(key, g);
        }
        g.count += 1;
        if (!r.is_read) g.unreadIds.push(r.activity_id);
    }
    return Array.from(groups.values());
}

/**
 * PortalActivityBell — the header surface of doctor-portal activity (photo/scan
 * uploads, notes, wear-days changes written by the external aligner portal and
 * reverse-synced home). Mirrors TasksBell: quiet bell with an unread badge, a
 * portaled popover listing day-grouped events, per-group + mark-all read.
 * Freshness: mount + 5-min poll + visibility refetch + `portal-activity:changed`.
 *
 * The headline is composed here from the server-joined doctor/patient names —
 * the portal-authored activity_description is shown only as secondary text.
 */
const PortalActivityBell = () => {
    const { t } = useTranslation('common');
    const navigate = useNavigate();
    const toast = useToast();

    const [open, setOpen] = useState(false);
    // Portaled to <body> (the fixed, overflow:hidden header would clip it), so
    // it's positioned with viewport-fixed coords off the bell (same as TasksBell).
    const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

    const wrapRef = useRef<HTMLDivElement | null>(null);
    const bellRef = useRef<HTMLButtonElement | null>(null);
    const popRef = useRef<HTMLDivElement | null>(null);

    const placePopover = useCallback(() => {
        const r = bellRef.current?.getBoundingClientRect();
        if (!r) return;
        const left = Math.min(Math.max(8, r.right - POPOVER_WIDTH), window.innerWidth - POPOVER_WIDTH - 8);
        setCoords({ top: r.bottom + 8, left: Math.max(8, left) });
    }, []);

    const { data, refetch } = useQuery({ ...portalActivityQuery(), refetchInterval: PORTAL_ACTIVITY_REFRESH_MS });
    const rows = data ?? [];

    useEffect(() => {
        const onVisible = () => { if (document.visibilityState === 'visible') void refetch(); };
        const onChanged = () => void refetch();
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener(PORTAL_ACTIVITY_CHANGED_EVENT, onChanged);
        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener(PORTAL_ACTIVITY_CHANGED_EVENT, onChanged);
        };
    }, [refetch]);

    // Close on outside click / Escape; keep anchored on resize.
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            const target = e.target as Node;
            if (wrapRef.current?.contains(target) || popRef.current?.contains(target)) return;
            setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        window.addEventListener('resize', placePopover);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
            window.removeEventListener('resize', placePopover);
        };
    }, [open, placePopover]);

    const groups = groupRows(rows);
    const unreadCount = groups.filter((g) => g.unreadIds.length > 0).length;

    const headline = (g: ActivityGroup): string => {
        const doctor = g.latest.doctor_name
            ? t('portalActivity.dr', { name: g.latest.doctor_name })
            : t('portalActivity.doctorFallback');
        const patient = g.latest.patient_name ?? t('portalActivity.patientFallback');
        const vars = { doctor, patient, count: g.count };
        switch (g.type) {
            case 'DoctorNote':
                return g.count === 1 ? t('portalActivity.event.noteOne', vars) : t('portalActivity.event.noteMany', vars);
            case 'PhotoUploaded':
                return g.count === 1 ? t('portalActivity.event.photoOne', vars) : t('portalActivity.event.photoMany', vars);
            case 'FileUploaded':
                return g.count === 1 ? t('portalActivity.event.fileOne', vars) : t('portalActivity.event.fileMany', vars);
            case 'DaysChanged':
                return t('portalActivity.event.days', vars);
        }
    };

    const runAction = async (fn: () => Promise<unknown>) => {
        try {
            await fn();
            notifyPortalActivityChanged();
        } catch (error) {
            toast.error(httpErrorMessage(error, t('portalActivity.markFailed')));
        }
    };

    const markGroup = (g: ActivityGroup) => runAction(() => markPortalActivityRead(g.unreadIds));
    const markAll = () => runAction(() => markAllPortalActivityRead());

    const openCase = (g: ActivityGroup) => {
        if (g.latest.work_id == null) return;
        setOpen(false);
        navigate(`/aligner/patient/${g.latest.work_id}`);
    };

    const toggleOpen = () => {
        if (!open) placePopover();
        setOpen((o) => !o);
    };

    return (
        <div className={styles.wrap} ref={wrapRef}>
            <button
                type="button"
                ref={bellRef}
                className={styles.bellBtn}
                onClick={toggleOpen}
                aria-label={`${t('portalActivity.title')}${unreadCount ? ` (${unreadCount})` : ''}`}
                aria-expanded={open}
                title={t('portalActivity.title')}
            >
                <i className="fas fa-tower-broadcast" aria-hidden="true" />
                {unreadCount > 0 && <span className={styles.badge}>{unreadCount}</span>}
            </button>

            {open && coords && createPortal(
                <div
                    className={styles.popover}
                    role="dialog"
                    aria-label={t('portalActivity.title')}
                    ref={popRef}
                    style={{ position: 'fixed', top: coords.top, left: coords.left }}
                >
                    <div className={styles.popHeader}>
                        <span>
                            {t('portalActivity.title')}
                            {unreadCount > 0 && <span className={styles.popCount}>{unreadCount}</span>}
                        </span>
                        {unreadCount > 0 && (
                            <button type="button" className={styles.markAllBtn} onClick={markAll}>
                                <i className="fas fa-check-double" aria-hidden="true" /> {t('portalActivity.markAll')}
                            </button>
                        )}
                    </div>

                    <div className={styles.list}>
                        {groups.length === 0 ? (
                            <div className={styles.empty}>
                                <i className="fas fa-satellite-dish" aria-hidden="true" />
                                <span>{t('portalActivity.empty')}</span>
                            </div>
                        ) : (
                            groups.map((g) => {
                                const unread = g.unreadIds.length > 0;
                                return (
                                    <div key={g.key} className={`${styles.item} ${unread ? styles.itemUnread : ''}`}>
                                        <span className={styles.typeIcon}>
                                            <i className={`fas ${TYPE_ICON[g.type]}`} aria-hidden="true" />
                                        </span>
                                        <button
                                            type="button"
                                            className={styles.itemBody}
                                            onClick={() => openCase(g)}
                                            disabled={g.latest.work_id == null}
                                            title={t('portalActivity.openCase')}
                                        >
                                            <span className={styles.itemText}>{headline(g)}</span>
                                            {g.latest.activity_description && (
                                                <span className={styles.itemDesc}>{g.latest.activity_description}</span>
                                            )}
                                            <span className={styles.itemMeta}>
                                                {g.latest.set_sequence != null && (
                                                    <span className={styles.setTag}>
                                                        {t('portalActivity.set', { seq: g.latest.set_sequence })}
                                                    </span>
                                                )}
                                                {g.latest.created_at && (
                                                    <span className={styles.age}>{relAge(g.latest.created_at)}</span>
                                                )}
                                            </span>
                                        </button>
                                        {unread && (
                                            <div className={styles.actions}>
                                                <button
                                                    type="button"
                                                    title={t('portalActivity.markRead')}
                                                    aria-label={t('portalActivity.markRead')}
                                                    onClick={() => markGroup(g)}
                                                >
                                                    <i className="fas fa-check" aria-hidden="true" />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default PortalActivityBell;
