import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../contexts/ToastContext';
import { httpErrorMessage } from '@/core/http';
import { portalActivityQuery, HEADER_BELL_POLL } from '@/query/queries';
import {
    markPortalActivityRead,
    markAllPortalActivityRead,
    invalidatePortalActivity,
    type PortalActivityRow,
} from '@/services/portal-activity';
import HeaderPopover, { RelativeAge } from './HeaderPopover';
import { toLocalDateString } from '@/utils/calendarDate';
import styles from './PortalActivityBell.module.css';

const TYPE_ICON: Record<PortalActivityRow['activity_type'], string> = {
    DoctorNote: 'fa-comment-medical',
    DaysChanged: 'fa-calendar-day',
    PhotoUploaded: 'fa-camera',
    FileUploaded: 'fa-file-arrow-up',
    CaseSubmitted: 'fa-folder-plus',
};

/** Local calendar day of an ISO timestamp, for the (set, type, day) grouping. */
function dayKey(iso: string | null): string {
    if (!iso) return 'unknown';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? 'unknown' : toLocalDateString(d);
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
 * Freshness: `HEADER_BELL_POLL` + `invalidatePortalActivity()` after a mark-read.
 *
 * The headline is composed here from the server-joined doctor/patient names —
 * the portal-authored activity_description is shown only as secondary text.
 */
const PortalActivityBell = () => {
    const { t } = useTranslation('common');
    const navigate = useNavigate();
    const toast = useToast();

    const [open, setOpen] = useState(false);

    const { data: rows = [] } = useQuery({ ...portalActivityQuery(), ...HEADER_BELL_POLL });

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
            case 'CaseSubmitted':
                return t('portalActivity.event.caseSubmitted', vars);
        }
    };

    const runAction = async (fn: () => Promise<unknown>) => {
        try {
            await fn();
            await invalidatePortalActivity();
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

    return (
        <HeaderPopover
            open={open}
            onOpenChange={setOpen}
            bellLabel={`${t('portalActivity.title')}${unreadCount ? ` (${unreadCount})` : ''}`}
            title={t('portalActivity.title')}
            icon="fa-tower-broadcast"
            width={380}
            badge={unreadCount > 0 && <span className={styles.badge}>{unreadCount}</span>}
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
                                        <RelativeAge iso={g.latest.created_at} className={styles.age} />
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
        </HeaderPopover>
    );
};

export default PortalActivityBell;
