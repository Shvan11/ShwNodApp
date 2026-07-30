import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useApiMutation } from '@/query/useApiMutation';
import { tvDisplayQuery } from '@/query/queries';
import { qk } from '@/query/keys';
import { deleteJSON, httpErrorMessage, postFormData, postJSON, putJSON } from '@/core/http';
import * as tvDisplayContract from '@shared/contracts/tv-display.contract';
import styles from './TvDisplaySettings.module.css';

/**
 * Settings tab: the waiting-room TV.
 *
 * Manages the signage slideshow end to end — what plays (the media folder),
 * when (the daily on/off schedule the LG daemon enforces), and how it looks
 * (dwell time, order, fit, sound, volume) — so none of it needs a file edit, a
 * service restart, or a daemon restart any more. Also queues the one-shot
 * "turn the TV on/off now" commands the daemon picks up on its next poll.
 *
 * Everything reads/writes `/api/tv-display*` (any signed-in staff role,
 * contract-validated). A save is PUSHED to the TV and the daemon over the event
 * streams they hold open, so it lands in about a second with no reload and
 * nothing polling in between. The status card reflects those same streams —
 * connected means connected — which is also why the manual buttons are disabled
 * when the scheduler is not there to receive them.
 */

interface TvDisplaySettingsProps {
    onChangesUpdate?: (hasChanges: boolean) => void;
}

type Settings = tvDisplayContract.TvDisplaySettings;
type State = tvDisplayContract.TvDisplayState;

/**
 * How often this tab refreshes its view of the connection status. Nothing else
 * in the feature polls — the TV and the daemon are pushed to — and this stops
 * the moment the tab is closed.
 */
const REFRESH_MS = 20_000;

const pad2 = (n: number): string => String(n).padStart(2, '0');
const toTimeInput = (h: number, m: number): string => `${pad2(h)}:${pad2(m)}`;

function fromTimeInput(value: string): { hour: number; minute: number } | null {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return { hour, minute };
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "12 s" / "4 min" / "3 h", measured against the server's clock. */
function relativeAge(iso: string | null, serverTime: string): string {
    if (!iso) return '';
    const ms = Date.parse(serverTime) - Date.parse(iso);
    if (!Number.isFinite(ms)) return '';
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s} s`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min`;
    const h = Math.round(m / 60);
    return `${h} h`;
}

/**
 * Stable JSON for comparing two settings objects. Sorting the per-image override
 * map's keys keeps the "unsaved changes" flag honest — the map is rebuilt on
 * every edit, and raw JSON.stringify would flag a mere key-order change as dirty.
 */
function serialize(s: Settings): string {
    const photoMsByName: Record<string, number> = {};
    for (const key of Object.keys(s.photoMsByName).sort()) photoMsByName[key] = s.photoMsByName[key];
    return JSON.stringify({
        enabled: s.enabled,
        onHour: s.onHour,
        onMinute: s.onMinute,
        offHour: s.offHour,
        offMinute: s.offMinute,
        volume: s.volume,
        photoMs: s.photoMs,
        photoMsByName,
        shuffle: s.shuffle,
        fit: s.fit,
        sound: s.sound,
    });
}

const TvDisplaySettings = ({ onChangesUpdate }: TvDisplaySettingsProps) => {
    const toast = useToast();
    const confirm = useConfirm();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const { data, isLoading, error } = useQuery({
        ...tvDisplayQuery(),
        refetchInterval: REFRESH_MS,
    });

    // Draft settings (the only local state — media edits write through at once).
    const [draft, setDraft] = useState<Settings | null>(null);
    // Server copy the draft was seeded from, so a background refetch doesn't
    // clobber edits in progress but a real remote change still re-seeds.
    const [seededFrom, setSeededFrom] = useState<string>('');
    // Local edits to the play sequence (reorder / add / remove-instance /
    // duplicate) while arranging; null = "same as the server's playlist".
    const [playlistDraft, setPlaylistDraft] = useState<string[] | null>(null);
    const [uploading, setUploading] = useState(false);
    const [showPreview, setShowPreview] = useState(false);

    const serverSettings = data?.settings ?? null;
    const serverKey = serverSettings ? serialize(serverSettings) : '';

    // Does this user have edits the server hasn't seen? Measured against the
    // snapshot the draft was SEEDED from, not the live server copy — that is what
    // separates "I typed something" from "somebody else saved", and it is the only
    // thing that may block a re-seed.
    const hasLocalEdits = draft !== null && serialize(draft) !== seededFrom;

    // Seed/re-seed the draft during render (adjust-state-during-render), keyed on
    // the server payload rather than in an effect, so the React Compiler keeps it.
    // A remote change is adopted whenever nothing local is pending (including the
    // first load, where `draft` is null); edits in progress are never clobbered.
    // Terminates: the branch sets `seededFrom` to `serverKey`, so the re-render
    // fails the `serverKey !== seededFrom` test.
    if (serverSettings && serverKey !== seededFrom && !hasLocalEdits) {
        setSeededFrom(serverKey);
        setDraft(serverSettings);
    }

    const dirty = useMemo(
        () => (draft && serverSettings ? serialize(draft) !== serialize(serverSettings) : false),
        [draft, serverSettings]
    );

    useEffect(() => {
        onChangesUpdate?.(dirty);
    }, [dirty, onChangesUpdate]);

    // The media library (every file on disk, with size/type) and the play
    // sequence (ordered, repeats allowed) are now separate: the library is the
    // pool, the playlist is the single source of truth for what plays.
    const media = useMemo(() => data?.media ?? [], [data]);
    const serverPlaylist = useMemo(() => data?.playlist ?? [], [data]);
    // The sequence being edited: the local draft, or the server's if untouched.
    const playlist = playlistDraft ?? serverPlaylist;
    const playlistDirty =
        playlistDraft !== null && JSON.stringify(playlistDraft) !== JSON.stringify(serverPlaylist);
    const byName = useMemo(() => new Map(media.map((m) => [m.name, m])), [media]);

    // Files sitting in the folder that AREN'T in the playlist — the "you dropped
    // a file, add it?" prompt. Membership ignores repeats: a file is available
    // iff it appears zero times in the sequence.
    const inPlaylist = useMemo(() => new Set(playlist), [playlist]);
    const available = useMemo(
        () => media.filter((m) => !inPlaylist.has(m.name)),
        [media, inPlaylist]
    );

    // Issues to flag when the tab opens — the state fetch above just re-scanned
    // the folder, so this reflects the folder as it is right now:
    //   • orphanDurations — saved custom times whose picture was deleted from the
    //     folder by hand (the override can't attach to anything).
    //   • ignoredFiles — files the TV can't play (unsupported type), reported by
    //     the server so "I dropped a file and it won't show" has an explanation.
    const orphanDurations = useMemo(
        () => (draft ? Object.keys(draft.photoMsByName).filter((name) => !byName.has(name)) : []),
        [draft, byName]
    );
    const ignoredFiles = useMemo(() => data?.ignoredFiles ?? [], [data]);

    // --- mutations ---------------------------------------------------------

    const saveSettings = useApiMutation<State, Settings>({
        mutationFn: (body) => putJSON<State, Settings>('/api/tv-display/settings', body),
        invalidate: () => [qk.tvDisplay()],
    });

    const uploadMedia = useApiMutation<State, FormData>({
        mutationFn: (form) => postFormData<State>('/api/tv-display/media', form),
        invalidate: () => [qk.tvDisplay()],
    });

    const removeMedia = useApiMutation<State, string>({
        mutationFn: (name) => deleteJSON<State>(`/api/tv-display/media/${encodeURIComponent(name)}`),
        invalidate: () => [qk.tvDisplay()],
    });

    const savePlaylistMut = useApiMutation<State, string[]>({
        mutationFn: (playlistNames) =>
            putJSON<State, { playlist: string[] }>('/api/tv-display/playlist', { playlist: playlistNames }),
        invalidate: () => [qk.tvDisplay()],
    });

    const sendCommand = useApiMutation<State, tvDisplayContract.SendCommandBody['action']>({
        mutationFn: (action) => postJSON<State, { action: string }>('/api/tv-display/command', { action }),
        invalidate: () => [qk.tvDisplay()],
    });

    // --- handlers ----------------------------------------------------------

    const patch = (change: Partial<Settings>): void => {
        setDraft((prev) => (prev ? { ...prev, ...change } : prev));
    };

    // Drop every orphaned custom time from the draft, then the user Saves to
    // persist the tidy-up. Only touches keys with no matching file.
    const clearOrphanDurations = (): void => {
        setDraft((prev) => {
            if (!prev) return prev;
            const photoMsByName = { ...prev.photoMsByName };
            for (const name of orphanDurations) delete photoMsByName[name];
            return { ...prev, photoMsByName };
        });
    };

    // Set/clear one picture's dwell override. Blank or non-positive = clear it
    // (that picture falls back to the default). Saved with the main Save bar.
    const setPhotoDuration = (name: string, value: string): void => {
        setDraft((prev) => {
            if (!prev) return prev;
            const photoMsByName = { ...prev.photoMsByName };
            const seconds = Number(value);
            if (!value.trim() || !Number.isFinite(seconds) || seconds <= 0) {
                delete photoMsByName[name];
            } else {
                photoMsByName[name] = Math.min(120, Math.max(1, Math.round(seconds))) * 1000;
            }
            return { ...prev, photoMsByName };
        });
    };

    const handleSave = async (): Promise<void> => {
        if (!draft) return;
        try {
            await saveSettings.mutateAsync(draft);
            setSeededFrom(serialize(draft));
            toast.success('TV settings saved — sent to the screen');
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Failed to save TV settings'));
        }
    };

    // Reset means "discard my edits", so the seed snapshot has to move with the
    // draft — otherwise the stale snapshot would keep reading as a local edit and
    // go on blocking re-seeds after the user had explicitly given them up.
    const handleReset = (): void => {
        if (!serverSettings) return;
        setDraft(serverSettings);
        setSeededFrom(serverKey);
    };

    const handleFiles = async (files: FileList | null): Promise<void> => {
        if (!files || files.length === 0) return;
        const form = new FormData();
        for (const file of Array.from(files)) form.append('media', file);
        setUploading(true);
        try {
            await uploadMedia.mutateAsync(form);
            // The server appended the upload(s) to the playlist; take its copy.
            setPlaylistDraft(null);
            toast.success(files.length === 1 ? 'File added to the playlist' : `${files.length} files added to the playlist`);
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Upload failed'));
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // Delete the actual FILE from disk (distinct from removing it from the
    // playlist below). The server prunes every playlist instance and forgets the
    // file's custom time; we mirror both locally so an unsaved draft can't carry
    // a stale entry back on the next Save.
    //
    // That mirror leaves the draft one edit ahead of `seededFrom`, so it reads as
    // a local edit until the next Save/Reset and suppresses auto-adopt of a remote
    // change in the meantime. Deliberate: it is the conservative direction (never
    // clobbers), it has no visible effect (`dirty` still compares against the live
    // server copy, which made the same removal), and syncing `seededFrom` here
    // would mean either an impure state updater or dropping a concurrent edit.
    const handleDelete = async (name: string): Promise<void> => {
        const uses = playlist.filter((n) => n === name).length;
        const warning =
            uses > 1
                ? `Delete "${name}" from the server? It's in the playlist ${uses} times — all of them will be removed.`
                : `Delete "${name}" from the server?`;
        if (!await confirm(warning, { title: 'Delete file', danger: true, confirmText: 'Delete' })) return;
        try {
            await removeMedia.mutateAsync(name);
            setPlaylistDraft(null);
            setDraft((prev) => {
                if (!prev || !(name in prev.photoMsByName)) return prev;
                const photoMsByName = { ...prev.photoMsByName };
                delete photoMsByName[name];
                return { ...prev, photoMsByName };
            });
            toast.success('File deleted');
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Failed to delete file'));
        }
    };

    // --- playlist editing (draft; persisted with "Save playlist") ----------
    // All four operations seed the draft from the server's playlist on first edit
    // (via `playlist`), then mutate a fresh copy.

    const move = (index: number, delta: number): void => {
        const next = [...playlist];
        const target = index + delta;
        if (target < 0 || target >= next.length) return;
        [next[index], next[target]] = [next[target], next[index]];
        setPlaylistDraft(next);
    };

    // Remove ONE instance (this position), leaving the file on disk and any other
    // instances in place.
    const removeAt = (index: number): void => {
        setPlaylistDraft(playlist.filter((_, i) => i !== index));
    };

    // Add another instance right after this one — how a single logo/bumper is
    // repeated between clips with no duplicate file on disk.
    const duplicateAt = (index: number): void => {
        const next = [...playlist];
        next.splice(index + 1, 0, playlist[index]);
        setPlaylistDraft(next);
    };

    // Add an available (on-disk but unscheduled) file to the end of the sequence.
    const addToPlaylist = (name: string): void => {
        setPlaylistDraft([...playlist, name]);
    };

    const handleSavePlaylist = async (): Promise<void> => {
        try {
            await savePlaylistMut.mutateAsync(playlist);
            setPlaylistDraft(null);
            toast.success('Playlist saved — sent to the screen');
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Failed to save playlist'));
        }
    };

    const handleDiscardPlaylist = (): void => setPlaylistDraft(null);

    const handleCommand = async (action: 'on' | 'off' | 'reload'): Promise<void> => {
        try {
            await sendCommand.mutateAsync(action);
            toast.success('Sent to the TV scheduler');
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Failed to send command'));
        }
    };

    // --- render ------------------------------------------------------------

    if (isLoading || !data || !draft) {
        return (
            <div className={styles.container}>
                <p className={styles.hint}>
                    {error ? httpErrorMessage(error, 'Failed to load TV display settings') : 'Loading…'}
                </p>
            </div>
        );
    }

    const { status } = data;
    const pageAlive = status.pageConnected;
    const daemonAlive = status.daemonConnected;
    const slideshowUrl = `${window.location.origin}/tv-display`;

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div>
                    <h3 className={styles.title}>
                        <i className="fas fa-tv"></i>
                        TV Display
                    </h3>
                    <p className={styles.description}>
                        The waiting-room screen. Drop in pictures and videos, set when the TV turns
                        itself on and off, and control how the loop looks — saved changes appear on
                        the screen within a second or two, with no restart.
                    </p>
                </div>
                <div className={styles.headerActions}>
                    <a className={styles.linkBtn} href={slideshowUrl} target="_blank" rel="noreferrer">
                        <i className="fas fa-external-link-alt"></i> Open the slideshow
                    </a>
                </div>
            </div>

            {/* ---------------- Folder health (only when something's off) ---------------- */}
            {(orphanDurations.length > 0 || ignoredFiles.length > 0) && (
                <section className={styles.warning} role="status">
                    <i className={`fas fa-exclamation-triangle ${styles.warningIcon}`}></i>
                    <div className={styles.warningBody}>
                        <h4 className={styles.warningTitle}>A couple of things in the media folder need a look</h4>
                        {orphanDurations.length > 0 && (
                            <p className={styles.warningText}>
                                <strong>
                                    {orphanDurations.length} custom picture time
                                    {orphanDurations.length > 1 ? 's' : ''}
                                </strong>{' '}
                                point to files that aren&apos;t in the folder any more (deleted by
                                hand): {orphanDurations.join(', ')}. They&apos;re ignored on screen — remove
                                them to tidy up, then Save.
                            </p>
                        )}
                        {ignoredFiles.length > 0 && (
                            <p className={styles.warningText}>
                                <strong>
                                    {ignoredFiles.length} file{ignoredFiles.length > 1 ? 's' : ''} the TV can&apos;t
                                    play
                                </strong>{' '}
                                (unsupported type): {ignoredFiles.join(', ')}. Convert{' '}
                                {ignoredFiles.length > 1 ? 'them' : 'it'} to JPG or MP4, or remove{' '}
                                {ignoredFiles.length > 1 ? 'them' : 'it'} from the folder.
                            </p>
                        )}
                    </div>
                    {orphanDurations.length > 0 && (
                        <button type="button" className={styles.secondaryBtn} onClick={clearOrphanDurations}>
                            <i className="fas fa-broom"></i> Remove the {orphanDurations.length} stale time
                            {orphanDurations.length > 1 ? 's' : ''}
                        </button>
                    )}
                </section>
            )}

            {/* ---------------- Live status + manual control ---------------- */}
            <section className={styles.card}>
                <h4 className={styles.cardTitle}>
                    <i className="fas fa-heartbeat"></i> Right now
                </h4>
                <div className={styles.statusGrid}>
                    <div className={styles.statusItem}>
                        <span className={pageAlive ? styles.dotOk : styles.dotIdle}></span>
                        <div>
                            <div className={styles.statusLabel}>Screen</div>
                            <div className={styles.statusValue}>
                                {pageAlive ? 'Playing the slideshow' : 'Not showing the slideshow'}
                                {pageAlive && (
                                    <span className={styles.statusAge}>
                                        (for {relativeAge(status.pageSince, status.serverTime)})
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className={styles.statusItem}>
                        <span className={daemonAlive ? styles.dotOk : styles.dotWarn}></span>
                        <div>
                            <div className={styles.statusLabel}>TV scheduler</div>
                            <div className={styles.statusValue}>
                                {daemonAlive ? 'Connected' : 'Not connected'}
                                {daemonAlive && (
                                    <span className={styles.statusAge}>
                                        (for {relativeAge(status.daemonSince, status.serverTime)})
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className={styles.buttonRow}>
                    <button
                        type="button"
                        className={styles.secondaryBtn}
                        onClick={() => handleCommand('on')}
                        disabled={!daemonAlive || sendCommand.isPending}
                    >
                        <i className="fas fa-power-off"></i> Turn TV on now
                    </button>
                    <button
                        type="button"
                        className={styles.secondaryBtn}
                        onClick={() => handleCommand('off')}
                        disabled={!daemonAlive || sendCommand.isPending}
                    >
                        <i className="fas fa-power-off"></i> Turn TV off now
                    </button>
                    <button
                        type="button"
                        className={styles.secondaryBtn}
                        onClick={() => handleCommand('reload')}
                        disabled={!daemonAlive || sendCommand.isPending}
                    >
                        <i className="fas fa-sync"></i> Reload the slideshow
                    </button>
                    {!daemonAlive && (
                        <span className={styles.pending}>
                            <i className="fas fa-exclamation-triangle"></i> Scheduler offline — check the
                            “LG TV Signage” task on the server
                        </span>
                    )}
                </div>
                <p className={styles.hint}>
                    “Screen” means the TV itself has the slideshow open; “TV scheduler” is the
                    background service on this server that powers the TV on and off. Both keep a
                    live connection to this app, so these are current — and anything you save here
                    reaches them in about a second.
                </p>
                <p className={styles.hint}>
                    During opening hours the scheduler keeps the TV on: if it goes dark (power cut,
                    turned off with the remote), it is woken back up within a minute or two.
                    “Turn TV off now” is the real off switch — the TV then stays off for the rest
                    of the day, until tomorrow’s on-time or “Turn TV on now”. To stop the screen
                    for longer (maintenance, holidays), turn off the schedule switch below.
                </p>
            </section>

            {/* ---------------- Schedule ---------------- */}
            <section className={styles.card}>
                <h4 className={styles.cardTitle}>
                    <i className="fas fa-clock"></i> Schedule
                </h4>

                <label className={styles.switchRow}>
                    <input
                        type="checkbox"
                        checked={draft.enabled}
                        onChange={(e) => patch({ enabled: e.target.checked })}
                    />
                    <span className={styles.switchText}>Run the waiting-room screen automatically</span>
                </label>
                <p className={styles.hint}>
                    Off = the scheduler leaves the TV alone entirely (no daily on, no off, no
                    relaunch). Use it during maintenance or holidays.
                </p>

                <div className={styles.fieldGrid}>
                    <label className={styles.field}>
                        <span className={styles.fieldLabel}>Turn on at</span>
                        <input
                            type="time"
                            className={styles.input}
                            value={toTimeInput(draft.onHour, draft.onMinute)}
                            onChange={(e) => {
                                const t = fromTimeInput(e.target.value);
                                if (t) patch({ onHour: t.hour, onMinute: t.minute });
                            }}
                        />
                    </label>
                    <label className={styles.field}>
                        <span className={styles.fieldLabel}>Turn off at</span>
                        <input
                            type="time"
                            className={styles.input}
                            value={toTimeInput(draft.offHour, draft.offMinute)}
                            onChange={(e) => {
                                const t = fromTimeInput(e.target.value);
                                if (t) patch({ offHour: t.hour, offMinute: t.minute });
                            }}
                        />
                    </label>
                    <label className={styles.field}>
                        <span className={styles.fieldLabel}>Volume ({draft.volume})</span>
                        <input
                            type="range"
                            min={0}
                            max={100}
                            value={draft.volume}
                            className={styles.range}
                            onChange={(e) => patch({ volume: Number(e.target.value) })}
                        />
                        <span className={styles.hint}>
                            Set when the TV comes on. Staff can still adjust it with the remote during
                            the day — the scheduler will not fight them.
                        </span>
                    </label>
                </div>
            </section>

            {/* ---------------- Appearance ---------------- */}
            <section className={styles.card}>
                <h4 className={styles.cardTitle}>
                    <i className="fas fa-sliders-h"></i> How the loop plays
                </h4>
                <div className={styles.fieldGrid}>
                    <label className={styles.field}>
                        <span className={styles.fieldLabel}>Seconds per picture (default)</span>
                        <input
                            type="number"
                            min={1}
                            max={120}
                            className={styles.input}
                            value={Math.round(draft.photoMs / 1000)}
                            onChange={(e) => {
                                const seconds = Math.min(120, Math.max(1, Number(e.target.value) || 1));
                                patch({ photoMs: seconds * 1000 });
                            }}
                        />
                        <span className={styles.hint}>
                            The starting point for every picture — give any single picture its own time
                            in the list below. Videos always play to the end.
                        </span>
                    </label>
                    <label className={styles.field}>
                        <span className={styles.fieldLabel}>Picture fit</span>
                        <select
                            className={styles.input}
                            value={draft.fit}
                            onChange={(e) => patch({ fit: e.target.value === 'cover' ? 'cover' : 'contain' })}
                        >
                            <option value="contain">Fit whole picture (black bars)</option>
                            <option value="cover">Fill the screen (crops edges)</option>
                        </select>
                    </label>
                </div>
                <label className={styles.switchRow}>
                    <input
                        type="checkbox"
                        checked={draft.sound}
                        onChange={(e) => patch({ sound: e.target.checked })}
                    />
                    <span className={styles.switchText}>Play video sound</span>
                </label>
                <p className={styles.hint}>Applies to the clip playing right now, too.</p>

                <label className={styles.switchRow}>
                    <input
                        type="checkbox"
                        checked={draft.shuffle}
                        onChange={(e) => patch({ shuffle: e.target.checked })}
                    />
                    <span className={styles.switchText}>Shuffle</span>
                </label>
                <p className={styles.hint}>
                    Random order, reshuffled each time the loop restarts. Off = the order below.
                </p>
            </section>

            {/* ---------------- Save bar ---------------- */}
            <div className={styles.saveBar}>
                <button
                    type="button"
                    className={styles.primaryBtn}
                    onClick={handleSave}
                    disabled={!dirty || saveSettings.isPending}
                >
                    <i className={`fas ${saveSettings.isPending ? 'fa-spinner fa-spin' : 'fa-save'}`}></i>
                    {saveSettings.isPending ? 'Saving…' : 'Save settings'}
                </button>
                <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={handleReset}
                    disabled={!dirty || saveSettings.isPending}
                >
                    Discard changes
                </button>
                {dirty && <span className={styles.hint}>Unsaved changes</span>}
            </div>

            {/* ---------------- Media ---------------- */}
            <section className={styles.card}>
                <h4 className={styles.cardTitle}>
                    <i className="fas fa-photo-video"></i> Playlist — what plays, in order ({playlist.length})
                </h4>

                <div className={styles.uploadRow}>
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept={data.allowedExtensions.join(',')}
                        className={styles.fileInput}
                        onChange={(e) => void handleFiles(e.target.files)}
                    />
                    <button
                        type="button"
                        className={styles.primaryBtn}
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                    >
                        <i className={`fas ${uploading ? 'fa-spinner fa-spin' : 'fa-upload'}`}></i>
                        {uploading ? 'Uploading…' : 'Add pictures / videos'}
                    </button>
                    {playlistDirty && (
                        <>
                            <button
                                type="button"
                                className={styles.primaryBtn}
                                onClick={handleSavePlaylist}
                                disabled={savePlaylistMut.isPending}
                            >
                                <i className={`fas ${savePlaylistMut.isPending ? 'fa-spinner fa-spin' : 'fa-list-ol'}`}></i>
                                {savePlaylistMut.isPending ? 'Saving…' : 'Save playlist'}
                            </button>
                            <button
                                type="button"
                                className={styles.secondaryBtn}
                                onClick={handleDiscardPlaylist}
                                disabled={savePlaylistMut.isPending}
                            >
                                Discard changes
                            </button>
                            <span className={styles.hint}>Unsaved playlist changes</span>
                        </>
                    )}
                    <span className={styles.hint}>
                        Allowed: {data.allowedExtensions.join(' ')}. Other formats (HEIC, MKV) are
                        ignored — convert to JPG or MP4 first.
                    </span>
                </div>

                {/* Files on disk that aren't in the playlist — the "add me?" prompt. */}
                {available.length > 0 && (
                    <div className={styles.notice} role="status">
                        <i className={`fas fa-inbox ${styles.noticeIcon}`}></i>
                        <div className={styles.noticeBody}>
                            <h5 className={styles.noticeTitle}>
                                {available.length} file{available.length > 1 ? 's are' : ' is'} in the folder but not in
                                the playlist
                            </h5>
                            <p className={styles.noticeText}>
                                Dropped into the media folder, or taken out of the playlist earlier.{' '}
                                {available.length > 1 ? 'They' : 'It'} won&apos;t play until added.
                            </p>
                            <ul className={styles.mediaList}>
                                {available.map((item) => (
                                    <li key={item.name} className={styles.mediaItem}>
                                        <div className={styles.thumb}>
                                            {item.type === 'image' ? (
                                                <img
                                                    src={`/tv-display/media/${encodeURIComponent(item.name)}`}
                                                    alt=""
                                                    loading="lazy"
                                                />
                                            ) : (
                                                <i className="fas fa-film"></i>
                                            )}
                                        </div>
                                        <div className={styles.mediaMeta}>
                                            <span className={styles.mediaName}>{item.name}</span>
                                            <span className={styles.hint}>
                                                {item.type === 'image' ? 'Picture' : 'Video'} ·{' '}
                                                {formatBytes(item.sizeBytes)}
                                            </span>
                                        </div>
                                        <div className={styles.mediaActions}>
                                            <button
                                                type="button"
                                                className={styles.secondaryBtn}
                                                onClick={() => addToPlaylist(item.name)}
                                            >
                                                <i className="fas fa-plus"></i> Add
                                            </button>
                                            <button
                                                type="button"
                                                className={styles.dangerBtn}
                                                title="Delete file from server"
                                                onClick={() => void handleDelete(item.name)}
                                                disabled={removeMedia.isPending}
                                            >
                                                <i className="fas fa-trash"></i>
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                            {available.length > 1 && (
                                <button
                                    type="button"
                                    className={styles.secondaryBtn}
                                    onClick={() => setPlaylistDraft([...playlist, ...available.map((a) => a.name)])}
                                >
                                    <i className="fas fa-plus"></i> Add all {available.length} to the playlist
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {media.length === 0 ? (
                    <p className={styles.empty}>
                        Nothing here yet — the screen shows the clinic name. Add a picture or video
                        above.
                    </p>
                ) : playlist.length === 0 ? (
                    <p className={styles.empty}>
                        The playlist is empty — nothing plays. Add files from the list above.
                    </p>
                ) : (
                    <ul className={styles.mediaList}>
                        {playlist.map((name, index) => {
                            const item = byName.get(name);
                            const isImage = item?.type === 'image';
                            return (
                                <li
                                    key={`${name}-${index}`}
                                    className={item ? styles.mediaItem : `${styles.mediaItem} ${styles.mediaItemMissing}`}
                                >
                                    <span className={styles.mediaIndex}>{index + 1}</span>
                                    <div className={styles.thumb}>
                                        {!item ? (
                                            <i className="fas fa-exclamation-triangle"></i>
                                        ) : isImage ? (
                                            <img
                                                src={`/tv-display/media/${encodeURIComponent(name)}`}
                                                alt=""
                                                loading="lazy"
                                            />
                                        ) : (
                                            <i className="fas fa-film"></i>
                                        )}
                                    </div>
                                    <div className={styles.mediaMeta}>
                                        <span className={styles.mediaName}>{name}</span>
                                        <span className={styles.hint}>
                                            {item
                                                ? `${isImage ? 'Picture' : 'Video'} · ${formatBytes(item.sizeBytes)}`
                                                : 'Missing — this file is no longer in the folder'}
                                        </span>
                                    </div>
                                    <div className={styles.mediaDuration}>
                                        {isImage ? (
                                            <label
                                                className={styles.durationField}
                                                title="Seconds this picture stays on screen — leave blank to use the default"
                                            >
                                                <input
                                                    type="number"
                                                    min={1}
                                                    max={120}
                                                    inputMode="numeric"
                                                    className={styles.durationInput}
                                                    placeholder={String(Math.round(draft.photoMs / 1000))}
                                                    value={
                                                        draft.photoMsByName[name]
                                                            ? String(Math.round(draft.photoMsByName[name] / 1000))
                                                            : ''
                                                    }
                                                    onChange={(e) => setPhotoDuration(name, e.target.value)}
                                                    aria-label={`Seconds on screen for ${name}`}
                                                />
                                                <span className={styles.durationUnit}>s</span>
                                            </label>
                                        ) : item ? (
                                            <span className={styles.durationNote}>plays to end</span>
                                        ) : null}
                                    </div>
                                    <div className={styles.mediaActions}>
                                        <button
                                            type="button"
                                            className={styles.iconBtn}
                                            title="Move earlier"
                                            onClick={() => move(index, -1)}
                                            disabled={index === 0}
                                        >
                                            <i className="fas fa-arrow-up"></i>
                                        </button>
                                        <button
                                            type="button"
                                            className={styles.iconBtn}
                                            title="Move later"
                                            onClick={() => move(index, 1)}
                                            disabled={index === playlist.length - 1}
                                        >
                                            <i className="fas fa-arrow-down"></i>
                                        </button>
                                        <button
                                            type="button"
                                            className={styles.iconBtn}
                                            title="Play this again — add another slot for it"
                                            onClick={() => duplicateAt(index)}
                                            disabled={!item}
                                        >
                                            <i className="fas fa-clone"></i>
                                        </button>
                                        <button
                                            type="button"
                                            className={styles.iconBtn}
                                            title="Remove this slot from the playlist (keeps the file)"
                                            onClick={() => removeAt(index)}
                                        >
                                            <i className="fas fa-times"></i>
                                        </button>
                                        {item && (
                                            <button
                                                type="button"
                                                className={styles.dangerBtn}
                                                title="Delete the file from the server"
                                                onClick={() => void handleDelete(name)}
                                                disabled={removeMedia.isPending}
                                            >
                                                <i className="fas fa-trash"></i>
                                            </button>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}

                <p className={styles.hint}>
                    Order is the list order. <i className="fas fa-clone"></i> repeats a clip — the way to
                    put one logo between every video with no duplicate file. <i className="fas fa-times"></i>{' '}
                    removes just that slot (the file stays); <i className="fas fa-trash"></i> deletes the
                    file from the server. Playlist changes are saved with “Save playlist”.
                </p>
                <p className={styles.hint}>
                    The <strong>s</strong> box on each picture sets how long it stays on screen; leave
                    it blank to use the default above. Those times are saved with the
                    &ldquo;Save settings&rdquo; button, and a picture used more than once shares one time.
                </p>
            </section>

            {/* ---------------- Preview ---------------- */}
            <section className={styles.card}>
                <h4 className={styles.cardTitle}>
                    <i className="fas fa-desktop"></i> Preview
                </h4>
                {showPreview ? (
                    <>
                        <div className={styles.previewFrame}>
                            <iframe
                                title="Waiting-room slideshow preview"
                                src="/tv-display?sound=0&amp;photoMs=3000"
                                className={styles.preview}
                            />
                        </div>
                        <button
                            type="button"
                            className={styles.secondaryBtn}
                            onClick={() => setShowPreview(false)}
                        >
                            Stop preview
                        </button>
                    </>
                ) : (
                    <button
                        type="button"
                        className={styles.secondaryBtn}
                        onClick={() => setShowPreview(true)}
                    >
                        <i className="fas fa-play"></i> Show a preview here
                    </button>
                )}
                <p className={styles.hint}>
                    The preview runs muted and faster (3s per picture) so it is quick to check. The
                    real screen uses the settings above.
                </p>
            </section>

            {/* ---------------- Where everything lives ---------------- */}
            <section className={styles.card}>
                <h4 className={styles.cardTitle}>
                    <i className="fas fa-folder-open"></i> Where everything lives
                </h4>
                <dl className={styles.pathList}>
                    <dt>Media folder (on this server)</dt>
                    <dd>
                        <code>{data.mediaDir}</code> — dropping files here adds them to the server; this
                        tab then prompts to put them in the playlist
                    </dd>

                    <dt>Settings file</dt>
                    <dd><code>{data.settingsFile}</code> — written by this page; not in the database</dd>

                    <dt>Slideshow address (what the TV opens)</dt>
                    <dd><code>{slideshowUrl}</code></dd>

                    <dt>TV scheduler (separate service on this server)</dt>
                    <dd>
                        <code>C:\Users\Administrator\lgtv-scheduler\tv_daemon.py</code>, log{' '}
                        <code>lgtv-watch.log</code>, Windows scheduled task{' '}
                        <code>LG TV Signage</code> — this deployment&apos;s install location
                    </dd>

                    <dt>Source files (this app)</dt>
                    <dd>
                        <code>routes/public/tv-display.routes.ts</code> — the slideshow page the TV loads
                        <br />
                        <code>routes/api/tv-display.routes.ts</code> — the admin API behind this tab
                        <br />
                        <code>services/files/tv-display-store.ts</code> — media folder + settings file
                        <br />
                        <code>shared/contracts/tv-display.contract.ts</code> — the shared API contract
                        <br />
                        <code>public/js/components/react/TvDisplaySettings.tsx</code> — this page
                    </dd>
                </dl>
                <p className={styles.hint}>
                    The media folder and the settings file are deliberately outside the database and
                    outside version control — they are this clinic&apos;s content and machine
                    configuration, so backups of the database do not include them.
                </p>
            </section>
        </div>
    );
};

export default TvDisplaySettings;
