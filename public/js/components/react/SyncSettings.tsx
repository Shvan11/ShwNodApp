import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { syncFeaturesQuery } from '@/query/queries';
import SupabaseSyncStatus from './SupabaseSyncStatus';
import DolphinSyncStatus from './DolphinSyncStatus';
import styles from './SyncSettings.module.css';

/**
 * Settings → Sync: the live status of every CDC sink this install has — the Supabase mirror
 * (failover + reverse) and the legacy Dolphin Imaging sink. They were two tabs on one shared
 * panel; the Settings tab list shows this one when the install has either sink, and each panel
 * shows only for the sink it reports on. Read-only, so it never reports unsaved changes.
 */

interface SyncSettingsProps {
    onChangesUpdate?: (hasChanges: boolean) => void;
}

const SyncSettings = ({ onChangesUpdate }: SyncSettingsProps) => {
    // Which sinks this install has (cached: the tab list asked already). If the answer fails,
    // both panels show, as the tab list itself keeps the tab.
    const { data: features, isError } = useQuery(syncFeaturesQuery());
    const shows = (sink: 'supabase' | 'dolphin'): boolean => isError || Boolean(features?.[sink]);

    useEffect(() => {
        onChangesUpdate?.(false);
    }, [onChangesUpdate]);

    return (
        <div className={styles.container}>
            {shows('supabase') && <SupabaseSyncStatus />}
            {shows('dolphin') && <DolphinSyncStatus />}
        </div>
    );
};

export default SyncSettings;
