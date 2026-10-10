import { useQuery } from '@tanstack/react-query';
import { dolphinStatusQuery } from '@/query/queries';
import SyncStatusPanel, { SYNC_STATUS_POLL_MS } from './SyncStatusPanel';

/**
 * Settings → Sync, one panel: live status of the one-way 'dolphin' CDC sink (native
 * timepoints/images → the legacy Dolphin Imaging SQL Server). Its feed is local;
 * the reachability ping targets the mssql server. The card, poll cadence and
 * health rules live in the shared SyncStatusPanel.
 */

const SINK_META = {
    dolphin: {
        label: 'Dolphin Imaging',
        description:
            'One-way sink: native timepoints/images → the legacy Dolphin Imaging SQL Server (temporary; slated for removal).',
    },
};

const DolphinSyncStatus = () => {
    const result = useQuery({ ...dolphinStatusQuery(), refetchInterval: SYNC_STATUS_POLL_MS });
    return (
        <SyncStatusPanel
            result={result}
            icon="fas fa-database"
            title="Dolphin Sync Status"
            subject="Dolphin"
            description="Live reachability of the legacy Dolphin Imaging SQL Server sink."
            sinkMeta={SINK_META}
            notConfiguredHint="DB_* vars missing"
        />
    );
};

export default DolphinSyncStatus;
