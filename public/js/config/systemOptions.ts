/**
 * What Settings → General → System Options shows (audit FE-F21-9).
 *
 * The section used to render every `options` row as a free-text box labelled by its
 * key: nine legacy rows nothing reads, and runtime state other screens own (a JSON
 * blob the demo remover parses, the label sheet position, the WhatsApp group flags)
 * sat beside the real settings, editable as plain text. Owner decision (RF1,
 * 2026-10-05): show the known settings with a label and a description, and list
 * whatever else is stored read-only, collapsed.
 *
 * `option_name` is `citext`, so names are matched case-insensitively.
 */
import { ALIGNER_SETS_FOLDER_OPTION, ARCHFORM_DB_PATH_OPTION } from '@shared/clinic-options';
import { DEFAULT_WORK_CURRENCY_OPTION } from '@shared/work-currency';

export interface SystemOption {
    name: string;
    label: string;
    description: string;
    kind: 'text' | 'number' | 'currency';
}

/** The settings an admin edits here, in display order. */
export const SYSTEM_OPTIONS: readonly SystemOption[] = [
    {
        name: 'PatientsFolder',
        label: 'Patients folder',
        description:
            "The network share each staff PC opens for a patient's files (e.g. \\\\SERVER\\clinic1). " +
            "It is opened on the user's own PC, so it must be a network path, not the server's local drive.",
        kind: 'text',
    },
    {
        name: ALIGNER_SETS_FOLDER_OPTION,
        label: 'Aligner sets folder',
        description:
            'The network share holding the per-set aligner folders (<share>\\<doctor id>\\<patient id>\\<set #>). ' +
            'Empty = the folder links are not offered.',
        kind: 'text',
    },
    {
        name: 'VideosPath',
        label: 'Educational videos folder',
        description: 'Folder on the server holding the patient-education videos. They stream through the server.',
        kind: 'text',
    },
    {
        name: ARCHFORM_DB_PATH_OPTION,
        label: 'Archform database file',
        description: "Path the server reads Archform's database from. Empty = the Archform matcher is not offered.",
        kind: 'text',
    },
    {
        name: 'MaxAppointmentsPerSlot',
        label: 'Appointments per time slot',
        description: 'How many appointments the booking calendar allows in one time slot.',
        kind: 'number',
    },
    {
        name: DEFAULT_WORK_CURRENCY_OPTION,
        label: 'Default currency for new works',
        description: 'The currency a new work starts in. Not set = staff choose it on every new work.',
        kind: 'currency',
    },
];

/**
 * Rows with a screen of their own, or written by the app itself — never shown here.
 * (Credentials don't reach the browser at all: the server withholds them.)
 */
const MANAGED_PREFIXES = ['clinic_', 'email_', 'calendar_', 'gemini_', 'whatsapp_'];
const MANAGED_NAMES = new Set([
    'alignerlabelnextposition', // AlignerLabelNextPosition — the label dialog's sheet position
    'demo_seed_manifest', // DEMO_SEED_MANIFEST — the demo seeder's undo record
    'drive_backup_folder_id', // DRIVE_BACKUP_FOLDER_ID — the Google Drive backup folder (Settings → Database)
]);

const KNOWN = new Map(SYSTEM_OPTIONS.map(o => [o.name.toLowerCase(), o]));

export function findSystemOption(name: string): SystemOption | undefined {
    return KNOWN.get(name.toLowerCase());
}

/** Owned by another screen or by the app — kept out of System Options entirely. */
export function isManagedOption(name: string): boolean {
    const lower = name.toLowerCase();
    return MANAGED_PREFIXES.some(p => lower.startsWith(p)) || MANAGED_NAMES.has(lower);
}
