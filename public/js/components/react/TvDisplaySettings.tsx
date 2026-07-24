import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '../../contexts/ToastContext';
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

/**
 * Mirror of the store's reorder renumbering (`01-`, `02-`, …), used to re-key
 * unsaved per-image durations so they follow their file when the play order is
 * saved. MUST match services/files/tv-display-store.ts#reorderMedia.
 */
function renumber(names: string[]): Map<string, string> {
    const width = String(names.length).length < 2 ? 2 : String(names.length).length;
    const map = new Map<string, string>();
    names.forEach((name, i) => {
        const base = name.replace(/^\d+[-_ ]*/, '');
        map.set(name, `${String(i + 1).padStart(width, '0')}-${base}`);
    });
    return map;
}

const TvDisplaySettings = ({ onChangesUpdate }: TvDisplaySettingsProps) => {
    const toast = useToast();
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
    // Local play order while reordering; null = "same as server".
    const [orderDraft, setOrderDraft] = useState<string[] | null>(null);
    const [uploading, setUploading] = useState(false);
    const [showPreview, setShowPreview] = useState(false);

    const serverSettings = data?.settings ?? null;
    const serverKey = serverSettings ? serialize(serverSettings) : '';

    // Seed/re-seed the draft during render (adjust-state-during-render), keyed on
    // the server payload rather than in an effect, so the React Compiler keeps it.
    if (serverSettings && serverKey !== seededFrom && draft === null) {
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

    const media = useMemo(() => data?.media ?? [], [data]);
    const orderedNames = orderDraft ?? media.map((m) => m.name);
    const orderDirty =
        orderDraft !== null && JSON.stringify(orderDraft) !== JSON.stringify(media.map((m) => m.name));
    const byName = useMemo(() => new Map(media.map((m) => [m.name, m])), [media]);

    // Issues to flag when the tab opens — the state fetch above just re-scanned
    // the folder, so this reflects the folder as it is right now:
    //   • orphanDurations — saved custom times whose picture was renamed/deleted
    //     in the folder by hand (the override can't attach to anything).
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

    const saveOrder = useApiMutation<State, string[]>({
        mutationFn: (names) => putJSON<State, { names: string[] }>('/api/tv-display/media/order', { names }),
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

    const handleReset = (): void => {
        if (serverSettings) setDraft(serverSettings);
    };

    const handleFiles = async (files: FileList | null): Promise<void> => {
        if (!files || files.length === 0) return;
        const form = new FormData();
        for (const file of Array.from(files)) form.append('media', file);
        setUploading(true);
        try {
            await uploadMedia.mutateAsync(form);
            setOrderDraft(null);
            toast.success(files.length === 1 ? 'File added' : `${files.length} files added`);
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Upload failed'));
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleDelete = async (name: string): Promise<void> => {
        if (!window.confirm(`Remove "${name}" from the waiting-room screen?`)) return;
        try {
            await removeMedia.mutateAsync(name);
            setOrderDraft(null);
            // Mirror the store: the deleted file's override is gone too, so an
            // unsaved draft can't carry a stale key back on the next Save.
            setDraft((prev) => {
                if (!prev || !(name in prev.photoMsByName)) return prev;
                const photoMsByName = { ...prev.photoMsByName };
                delete photoMsByName[name];
                return { ...prev, photoMsByName };
            });
            toast.success('File removed');
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Failed to remove file'));
        }
    };

    const move = (index: number, delta: number): void => {
        const next = [...orderedNames];
        const target = index + delta;
        if (target < 0 || target >= next.length) return;
        [next[index], next[target]] = [next[target], next[index]];
        setOrderDraft(next);
    };

    const handleSaveOrder = async (): Promise<void> => {
        try {
            // Re-key durations the same way the store renumbers the files, so an
            // override (saved or not) follows its picture through the reorder.
            const rename = renumber(orderedNames);
            await saveOrder.mutateAsync(orderedNames);
            setOrderDraft(null);
            setDraft((prev) => {
                if (!prev) return prev;
                const photoMsByName: Record<string, number> = {};
                for (const [name, ms] of Object.entries(prev.photoMsByName)) {
                    photoMsByName[rename.get(name) ?? name] = ms;
                }
                return { ...prev, photoMsByName };
            });
            toast.success('Play order saved (files were renumbered)');
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Failed to save order'));
        }
    };

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
                                point to files that aren&apos;t in the folder any more (renamed or deleted by
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
                    <i className="fas fa-photo-video"></i> What&apos;s on screen ({media.length})
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
                    {orderDirty && (
                        <button
                            type="button"
                            className={styles.primaryBtn}
                            onClick={handleSaveOrder}
                            disabled={saveOrder.isPending}
                        >
                            <i className="fas fa-list-ol"></i>
                            {saveOrder.isPending ? 'Saving order…' : 'Save play order'}
                        </button>
                    )}
                    <span className={styles.hint}>
                        Allowed: {data.allowedExtensions.join(' ')}. Other formats (HEIC, MKV) are
                        ignored — convert to JPG or MP4 first.
                    </span>
                </div>

                {media.length === 0 ? (
                    <p className={styles.empty}>
                        Nothing to play yet — the screen shows the clinic name. Add a picture or video
                        above.
                    </p>
                ) : (
                    <ul className={styles.mediaList}>
                        {orderedNames.map((name, index) => {
                            const item = byName.get(name);
                            if (!item) return null;
                            return (
                                <li key={name} className={styles.mediaItem}>
                                    <span className={styles.mediaIndex}>{index + 1}</span>
                                    <div className={styles.thumb}>
                                        {item.type === 'image' ? (
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
                                            {item.type === 'image' ? 'Picture' : 'Video'} ·{' '}
                                            {formatBytes(item.sizeBytes)}
                                        </span>
                                    </div>
                                    <div className={styles.mediaDuration}>
                                        {item.type === 'image' ? (
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
                                        ) : (
                                            <span className={styles.durationNote}>plays to end</span>
                                        )}
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
                                            disabled={index === orderedNames.length - 1}
                                        >
                                            <i className="fas fa-arrow-down"></i>
                                        </button>
                                        <button
                                            type="button"
                                            className={styles.dangerBtn}
                                            title="Remove"
                                            onClick={() => void handleDelete(name)}
                                            disabled={removeMedia.isPending}
                                        >
                                            <i className="fas fa-trash"></i>
                                        </button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}

                <p className={styles.hint}>
                    The <strong>s</strong> box on each picture sets how long it stays on screen; leave
                    it blank to use the default above. Those times are saved with the
                    &ldquo;Save settings&rdquo; button — the play order is saved separately.
                </p>
                <p className={styles.hint}>
                    Saving the play order renames the files with number prefixes (01-, 02-, …) —
                    that numbering IS the order, so dropping files into the folder by hand keeps
                    working exactly as before.
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
                    <dd><code>{data.mediaDir}</code> — dropping files here works too</dd>

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
