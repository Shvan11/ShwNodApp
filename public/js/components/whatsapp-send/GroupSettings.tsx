/**
 * Group Settings Component
 * Configures whether the daily appointment list (PDF) is posted to a WhatsApp
 * group on each notification batch, and which group receives it.
 */

import { useState, useEffect, useCallback, FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { putJSON, httpErrorMessage } from '@/core/http';
import { groupSettings as groupSettingsContract } from '@shared/contracts/whatsapp.contract';
import type { GroupSettingsResponse } from '@shared/contracts/whatsapp.contract';
import { qk } from '@/query/keys';
import { whatsappGroupSettingsQuery } from '@/query/queries';
import { useToast } from '../../contexts/ToastContext';
import { API_ENDPOINTS } from '../../utils/whatsapp-send-constants';
import styles from '../../routes/WhatsAppSend.module.css';

export default function GroupSettings() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [enabled, setEnabled] = useState(true);
  const [groupName, setGroupName] = useState('');
  const [saving, setSaving] = useState(false);

  // Load current settings on mount via React Query, then seed the editable form
  // fields from them. Adjust-during-render keyed on the fetched payload's identity
  // so a fresh load re-seeds the editable fields without a setState-in-effect bailout.
  const { data, isLoading: loading, isError, error } = useQuery(whatsappGroupSettingsQuery());
  const [seededData, setSeededData] = useState<typeof data>(undefined);
  if (data && data !== seededData) {
    setSeededData(data);
    setEnabled(data.enabled);
    setGroupName(data.groupName);
  }
  useEffect(() => {
    if (isError) {
      toast.error(`Failed to load group settings: ${httpErrorMessage(error, 'Unknown error')}`);
    }
  }, [isError, error, toast]);

  const handleSave = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();

      const trimmed = groupName.trim();
      if (enabled && !trimmed) {
        toast.error('Group name is required when sending to a group is enabled');
        return;
      }

      setSaving(true);
      try {
        const saved = await putJSON<GroupSettingsResponse>(
          API_ENDPOINTS.WA_GROUP_SETTINGS,
          { enabled, groupName: trimmed || groupName },
          { schema: groupSettingsContract.response }
        );
        // Write the saved payload back to the query cache so it stays the single
        // source of truth — the seed-on-identity logic above then re-syncs the
        // form fields. Without this the cache keeps the pre-save value and a
        // remount within staleTime would re-seed the form with stale data.
        queryClient.setQueryData(qk.settings.whatsappGroupSettings(), saved);
        setEnabled(saved.enabled);
        setGroupName(saved.groupName);
        toast.success('Group settings saved');
      } catch (error) {
        toast.error(`Failed to save group settings: ${httpErrorMessage(error, 'Unknown error')}`);
      } finally {
        setSaving(false);
      }
    },
    [enabled, groupName, toast, queryClient]
  );

  return (
    <section className={styles.controlsArea}>
      <form className={styles.dateSelectionPanel} onSubmit={handleSave}>
        <fieldset className={styles.groupSettingsFieldset} disabled={loading || saving}>
          <legend className={styles.groupSettingsLegend}>Appointment List → WhatsApp Group</legend>

          <label className={styles.groupToggleRow}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>Post the daily appointment list (PDF) to a group when sending notifications</span>
          </label>

          <div className={styles.dateControls}>
            <label htmlFor="groupNameInput">Group name:</label>
            <input
              id="groupNameInput"
              type="text"
              className={styles.dateDropdown}
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Shwan Orthodontics"
              maxLength={100}
              autoComplete="off"
              disabled={!enabled}
            />
            <button type="submit" className="btn btn-primary" disabled={loading || saving}>
              <span className={styles.btnIcon} aria-hidden="true">
                💾
              </span>
              <span>{saving ? 'Saving...' : 'Save'}</span>
            </button>
          </div>

          <p className={styles.groupSettingsHint}>
            The group must already exist in WhatsApp with this account as a member; the name must
            match exactly.
          </p>
        </fieldset>
      </form>
    </section>
  );
}
