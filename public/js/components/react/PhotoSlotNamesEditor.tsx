/**
 * Settings → Lookups → Photo Slot Names: the clinic's own name for each of Dolphin's photo
 * slots outside the 8 grid views.
 *
 * Dolphin files every photo under a 2-digit slot code. Only the grid views and the X-ray
 * slots say what they hold, so the others read "Image" until the clinic names them (this
 * clinic keeps smile close-ups in `02`, which Dolphin calls "Ceph Front"). The names show on
 * the Working files page and in the photo grid's "also in this session" chip, through the
 * working-files listing.
 *
 * Rename only: the codes come from Dolphin's files, so there is no Add or Delete. Slots no
 * photo uses stay folded away. Server: routes/api/photo-slot.routes.ts.
 */
import { useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { photoSlotsQuery } from '@/query/queries';
import { qk } from '@/query/keys';
import { useApiMutation } from '@/query/useApiMutation';
import { invalidateAllWorkingFiles } from '@/query/photos';
import { httpErrorMessage, putJSON } from '@/core/http';
import { formatNumber } from '@/utils/formatters';
import { useToast } from '../../contexts/ToastContext';
import { slotLabel } from '@shared/photo-views';
import { updateSlot, type PhotoSlot } from '@shared/contracts/photo-slot.contract';
import styles from './PhotoSlotNamesEditor.module.css';

const MAX_NAME = 40;

const PhotoSlotNamesEditor = () => {
    const toast = useToast();
    const { data, isLoading, isError } = useQuery(photoSlotsQuery());
    // A row's box while it differs from the saved name, by slot code.
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [showUnused, setShowUnused] = useState(false);

    const forget = (code: string) =>
        setDrafts((d) => {
            const next = { ...d };
            delete next[code];
            return next;
        });

    const save = useApiMutation({
        mutationFn: ({ code, label }: { code: string; label: string | null }) =>
            putJSON<PhotoSlot>(`/api/photo-slots/${code}`, { label }, { schema: updateSlot.response }),
        invalidate: () => [qk.lookups.photoSlots()],
        onSuccess: async (slot) => {
            await invalidateAllWorkingFiles();
            forget(slot.code);
            toast.success(
                slot.label
                    ? `Slot ${slot.code} is now called "${slot.label}"`
                    : `Slot ${slot.code} is back to its built-in name`
            );
        },
        onError: (err) => toast.error(httpErrorMessage(err, 'Could not save the name')),
    });

    if (isLoading) {
        return (
            <div className="lookup-loading">
                <i className="fas fa-spinner fa-spin" aria-hidden="true"></i>
                <span>Loading photo slots...</span>
            </div>
        );
    }
    if (isError || !data) return <p className={styles.error}>Could not load the photo slots.</p>;

    const unused = data.filter((s) => s.images === 0);
    const rows = showUnused ? data : data.filter((s) => s.images > 0);
    const draftOf = (s: PhotoSlot): string => drafts[s.code] ?? s.label ?? '';
    const changed = (s: PhotoSlot): boolean => draftOf(s).trim() !== (s.label ?? '');
    const submit = (s: PhotoSlot): void => {
        if (!changed(s) || save.isPending) return;
        save.mutate({ code: s.code, label: draftOf(s).trim() || null });
    };
    const onKeyDown = (s: PhotoSlot) => (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submit(s);
        } else if (e.key === 'Escape' && drafts[s.code] !== undefined) {
            e.preventDefault();
            forget(s.code);
        }
    };

    return (
        <div className="lookup-editor">
            <p className={styles.intro}>
                Dolphin files each photo under a slot code. Only the grid views and the X-rays say what they
                hold, so the other slots show as “Image” until you name them after what your clinic keeps
                there. The names appear on the Working files page and in the photo grid. Clear a name to go
                back to the built-in one.
            </p>
            <div className="lookup-table-container">
                <table className="lookup-table">
                    <thead>
                        <tr>
                            <th className="id-column">Slot</th>
                            <th>Dolphin’s name</th>
                            <th className={styles.count}>Photos</th>
                            <th>Name in the app</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((s) => (
                            <tr key={s.code}>
                                <td className="id-cell">{s.code}</td>
                                <td>{s.dolphinName ?? '—'}</td>
                                <td className={styles.count}>{formatNumber(s.images)}</td>
                                <td>
                                    <div className={styles.nameCell}>
                                        <input
                                            type="text"
                                            className={styles.nameInput}
                                            value={draftOf(s)}
                                            placeholder={slotLabel(`i${s.code}`)}
                                            maxLength={MAX_NAME}
                                            aria-label={`Name for slot ${s.code}`}
                                            onChange={(e) => setDrafts((d) => ({ ...d, [s.code]: e.target.value }))}
                                            onKeyDown={onKeyDown(s)}
                                        />
                                        {changed(s) && (
                                            <>
                                                <button
                                                    type="button"
                                                    className="btn btn-primary btn-sm"
                                                    onClick={() => submit(s)}
                                                    disabled={save.isPending}
                                                >
                                                    Save
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => forget(s.code)}
                                                    disabled={save.isPending}
                                                >
                                                    Cancel
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {unused.length > 0 && (
                <button
                    type="button"
                    className={styles.toggle}
                    aria-expanded={showUnused}
                    onClick={() => setShowUnused((v) => !v)}
                >
                    {showUnused ? 'Hide the slots no photo uses' : `Show the ${unused.length} slots no photo uses`}
                </button>
            )}
        </div>
    );
};

export default PhotoSlotNamesEditor;
