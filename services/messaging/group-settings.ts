/**
 * Daily-appointments WhatsApp group settings.
 *
 * Persisted in the key/value `options` table (two rows), so they're editable at
 * runtime from the /send page without a redeploy and survive restarts. The DB is
 * the single source of truth — the default values (send=on, group="Shwan
 * Orthodontics") are SEEDED in the DB by migration
 * `*_seed-whatsapp-group-options.sql`, NOT hardcoded here. If a row is somehow
 * absent (DB not migrated), we fail safe: disabled + empty name (the send path
 * then skips), rather than inventing a default.
 *
 * Consumed by both the WhatsApp service (decides whether/where to post the PDF on
 * each notification batch) and the `/api/wa/group-settings` GET/PUT route.
 */
import { getOption, upsertOption } from '../database/queries/options-queries.js';

/** Option keys in the `options` table. */
export const GROUP_SEND_ENABLED_OPTION = 'whatsapp_send_to_group';
export const GROUP_NAME_OPTION = 'whatsapp_group_name';

/** `type` (not interface) so it's assignable to the contract's z.object input. */
export type GroupSettings = {
  enabled: boolean;
  groupName: string;
};

/**
 * Read the group settings straight from the `options` table.
 */
export async function getGroupSettings(): Promise<GroupSettings> {
  const [enabledRaw, nameRaw] = await Promise.all([
    getOption(GROUP_SEND_ENABLED_OPTION),
    getOption(GROUP_NAME_OPTION),
  ]);

  return {
    enabled: enabledRaw === 'true',
    groupName: nameRaw?.trim() ?? '',
  };
}

/**
 * Persist the group settings (upsert so a value set before the seed migration is
 * still updated in place). Returns the normalized values that were stored. The
 * non-empty group-name guarantee comes from the contract's `validate({ body })`.
 */
export async function saveGroupSettings(settings: GroupSettings): Promise<GroupSettings> {
  const groupName = settings.groupName.trim();

  await Promise.all([
    upsertOption(GROUP_SEND_ENABLED_OPTION, settings.enabled ? 'true' : 'false'),
    upsertOption(GROUP_NAME_OPTION, groupName),
  ]);

  return { enabled: settings.enabled, groupName };
}
