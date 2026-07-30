import { useQuery } from '@tanstack/react-query';
import { supabaseStatusQuery } from '@/query/queries';
import SyncStatusPanel, { SYNC_STATUS_POLL_MS } from './SyncStatusPanel';

/**
 * Read-only Settings tab: live status of the two CDC sinks against the single
 * Supabase database — 'failover' (local → Supabase mirror, the aligner portal's
 * serving source) and 'reverse' (Supabase → local). The card, poll cadence and
 * health rules live in the shared SyncStatusPanel.
 */

const SINK_META = {
    failover: {
        label: 'Database mirror',
        description: 'Raw 1:1 mirror → the single Supabase database (the portal\'s serving source).',
    },
    reverse: {
        label: 'Reverse sync',
        description: 'Two-way path: web/portal edits on Supabase → applied back to local (last-write-wins).',
    },
};

interface SupabaseStatusSettingsProps {
    onChangesUpdate?: (hasChanges: boolean) => void;
}

const SupabaseStatusSettings = ({ onChangesUpdate }: SupabaseStatusSettingsProps) => {
    const result = useQuery({ ...supabaseStatusQuery(), refetchInterval: SYNC_STATUS_POLL_MS });
    return (
        <SyncStatusPanel
            result={result}
            icon="fas fa-cloud"
            title="Supabase Sync Status"
            subject="Supabase"
            description="Live reachability of the Supabase replication sinks."
            sinkMeta={SINK_META}
            notConfiguredHint="env vars missing"
            onChangesUpdate={onChangesUpdate}
        />
    );
};

export default SupabaseStatusSettings;
