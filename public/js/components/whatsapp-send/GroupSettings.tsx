/**
 * Group Settings Component
 * Configures whether the daily appointment list (PDF) is posted to a WhatsApp
 * group on each notification batch, and which group receives it.
 */

import { useState, useEffect, useCallback, FormEvent } from 'react';
import { fetchJSON, putJSON, httpErrorMessage } from '@/core/http';
import { groupSettings as groupSettingsContract } from '@shared/contracts/whatsapp.contract';
import type { GroupSettingsResponse } from '@shared/contracts/whatsapp.contract';
import { useToast } from '../../contexts/ToastContext';
import { API_ENDPOINTS } from '../../utils/whatsapp-send-constants';
import styles from '../../routes/WhatsAppSend.module.css';

export default function GroupSettings() {
  const toast = useToast();

  const [enabled, setEnabled] = useState(true);
  const [groupName, setGroupName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load current settings on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchJSON<GroupSettingsResponse>(API_ENDPOINTS.WA_GROUP_SETTINGS, {
          schema: groupSettingsContract.response,
        });
        if (!cancelled) {
          setEnabled(data.enabled);
          setGroupName(data.groupName);
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(`Failed to load group settings: ${httpErrorMessage(error, 'Unknown error')}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);

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
        setEnabled(saved.enabled);
        setGroupName(saved.groupName);
        toast.success('Group settings saved');
      } catch (error) {
        toast.error(`Failed to save group settings: ${httpErrorMessage(error, 'Unknown error')}`);
      } finally {
        setSaving(false);
      }
    },
    [enabled, groupName, toast]
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
