/**
 * The lab ↔ doctor messages of one set.
 *
 * READ WHEN SEEN (owner decision 2026-10-04, FE-F17-12). Opening the patient used to
 * mark every unread doctor note read at once — the active set's on page load — so
 * opening a patient for any reason cleared the doctor's unread badges whether or
 * not anyone looked. Now a note is marked read only once the message list has been
 * on screen for a moment (an IntersectionObserver plus a short dwell). The write is
 * a SET, not a toggle, so two tabs can't flip it back to unread, and it refreshes
 * the aligner reads, so the set's "N new updates" banner and the doctors' badges
 * follow.
 */
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { alignerNotesQuery } from '@/query/queries';
import { invalidateAligner } from '@/query/aligner';
import { deleteJSON, patchJSON, postJSON, putJSON, httpErrorMessage } from '@/core/http';
import * as alignerContract from '@shared/contracts/aligner.contract';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useToast } from '../../../contexts/ToastContext';
import { doctorLabel } from '../../../utils/aligner-labels';
import type { AlignerNote } from '../aligner.types';
import { formatSetDateTime } from './setHelpers';
import styles from '../PatientSets.module.css';

/** How long the message list must stay on screen before its doctor notes count as read. */
const READ_DWELL_MS = 1500;

interface SetCommunicationProps {
    setId: number;
    open: boolean;
    onToggle: () => void;
    /** Who the lab's own notes are from — the clinic's name, or "Lab" (FE-F17-7: it was "Shwan Lab"). */
    labName: string;
}

async function setNotesRead(noteIds: number[], isRead: boolean): Promise<void> {
    await patchJSON('/api/aligner/notes/read', { noteIds, isRead }, { schema: alignerContract.markNotesRead.response });
    await invalidateAligner();
}

export default function SetCommunication({ setId, open, onToggle, labName }: SetCommunicationProps) {
    return (
        <div className="communication-section">
            <button
                type="button"
                className={`communication-toggle-btn ${open ? 'expanded' : ''}`}
                onClick={onToggle}
                aria-expanded={open}
            >
                <i className="fas fa-comments" aria-hidden="true"></i>
                <span>Communication with Doctor</span>
                <i className="fas fa-chevron-down" aria-hidden="true"></i>
            </button>
            {open && <CommunicationBody setId={setId} labName={labName} />}
        </div>
    );
}

function CommunicationBody({ setId, labName }: { setId: number; labName: string }) {
    const toast = useToast();
    const confirm = useConfirm();
    const { data, isPending, isError, refetch } = useQuery(alignerNotesQuery(setId));
    const notes = data?.notes ?? [];

    // Per set, not one string shared by every set's open note box (FE-F17-14).
    const [composing, setComposing] = useState(false);
    const [noteText, setNoteText] = useState('');
    const [sending, setSending] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editText, setEditText] = useState('');
    const [savingEdit, setSavingEdit] = useState(false);

    // Mark the doctor's unread notes read once the list has actually been seen.
    const timelineRef = useRef<HTMLDivElement>(null);
    const unreadKey = notes
        .filter((n) => n.note_type === 'Doctor' && n.is_read === false)
        .map((n) => n.note_id)
        .join(',');
    useEffect(() => {
        const el = timelineRef.current;
        if (!unreadKey || !el || typeof IntersectionObserver === 'undefined') return;
        const ids = unreadKey.split(',').map(Number);
        let timer: ReturnType<typeof setTimeout> | null = null;
        const observer = new IntersectionObserver(([entry]) => {
            if (entry?.isIntersecting) {
                timer ??= setTimeout(() => {
                    observer.disconnect();
                    setNotesRead(ids, true).catch((error) => {
                        console.error('Could not mark the doctor notes read:', error);
                    });
                }, READ_DWELL_MS);
            } else if (timer) {
                clearTimeout(timer);
                timer = null;
            }
        });
        observer.observe(el);
        return () => {
            observer.disconnect();
            if (timer) clearTimeout(timer);
        };
    }, [unreadKey]);

    const handleSend = async (): Promise<void> => {
        if (sending) return;
        if (!noteText.trim()) {
            toast.warning('Please enter a note');
            return;
        }
        // One message per click: a double click used to send the doctor the same
        // note twice (FE-F17-10).
        setSending(true);
        try {
            await postJSON(
                '/api/aligner/notes',
                { aligner_set_id: setId, note_text: noteText.trim() },
                { schema: alignerContract.createNote.response }
            );
            setNoteText('');
            setComposing(false);
            await invalidateAligner();
        } catch (error) {
            toast.error('Failed to add note: ' + httpErrorMessage(error, 'unknown error'));
        } finally {
            setSending(false);
        }
    };

    const saveEdit = async (noteId: number): Promise<void> => {
        if (savingEdit) return;
        if (!editText.trim()) {
            toast.warning('Please enter a note');
            return;
        }
        setSavingEdit(true);
        try {
            await putJSON(`/api/aligner/notes/${noteId}`, { note_text: editText.trim() });
            setEditingId(null);
            setEditText('');
            await invalidateAligner();
        } catch (error) {
            toast.error('Failed to update note: ' + httpErrorMessage(error, 'unknown error'));
        } finally {
            setSavingEdit(false);
        }
    };

    const toggleRead = async (note: AlignerNote): Promise<void> => {
        try {
            await setNotesRead([note.note_id], note.is_read === false);
        } catch (error) {
            toast.error('Failed to update the read status: ' + httpErrorMessage(error, 'unknown error'));
        }
    };

    // A doctor's note is two-way: deleting it removes it from the doctor's portal too.
    const handleDelete = async (note: AlignerNote): Promise<void> => {
        const fromDoctor = note.note_type === 'Doctor';
        const ok = await confirm(
            fromDoctor
                ? "Delete this message from the doctor?\nIt is removed from the doctor's portal as well, and cannot be undone."
                : 'Delete this note?\nThe doctor will no longer see it in the portal. This cannot be undone.',
            { title: 'Delete Note', danger: true, confirmText: 'Delete' }
        );
        if (!ok) return;
        try {
            await deleteJSON(`/api/aligner/notes/${note.note_id}`);
            await invalidateAligner();
        } catch (error) {
            toast.error('Failed to delete note: ' + httpErrorMessage(error, 'unknown error'));
        }
    };

    if (isPending) {
        return (
            <div className="communication-content expanded">
                <div className="loading">
                    <div className="spinner"></div>
                    <p>Loading communication...</p>
                </div>
            </div>
        );
    }
    if (isError) {
        return (
            <div className="communication-content expanded">
                <p className="empty-state">
                    Could not load the messages.{' '}
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void refetch()}>
                        Retry
                    </button>
                </p>
            </div>
        );
    }

    return (
        <div className="communication-content expanded">
            <div className="add-note-section">
                {!composing ? (
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => setComposing(true)}>
                        <i className="fas fa-plus" aria-hidden="true"></i> Send Note to Doctor
                    </button>
                ) : (
                    <div className="note-form">
                        <textarea
                            className="note-textarea"
                            placeholder="Type your message to the doctor..."
                            aria-label="Message to the doctor"
                            value={noteText}
                            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNoteText(e.target.value)}
                        />
                        <div className={styles.noteFormActions}>
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => {
                                    setComposing(false);
                                    setNoteText('');
                                }}
                                disabled={sending}
                            >
                                Cancel
                            </button>
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleSend()} disabled={sending}>
                                <i className={sending ? 'fas fa-spinner fa-spin' : 'fas fa-paper-plane'} aria-hidden="true"></i>{' '}
                                {sending ? 'Sending…' : 'Send Note'}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {notes.length === 0 ? (
                <div className="empty-communication">
                    <i className="fas fa-inbox" aria-hidden="true"></i>
                    <p>No messages yet</p>
                    <p className="hint">Communication between doctor and lab will appear here</p>
                </div>
            ) : (
                <div className="notes-timeline" ref={timelineRef}>
                    {notes.map((note) => {
                        const unread = note.is_read === false;
                        const isLab = note.note_type === 'Lab';
                        return (
                            <div key={note.note_id} className={`note-item ${isLab ? 'lab-note' : 'doctor-note'}`}>
                                {editingId === note.note_id ? (
                                    <div className="note-edit-form">
                                        <textarea
                                            className="note-textarea note-textarea-edit"
                                            aria-label="Edit note"
                                            value={editText}
                                            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setEditText(e.target.value)}
                                        />
                                        <div className="flex-justify-end">
                                            <button
                                                type="button"
                                                className="btn-cancel btn-small"
                                                onClick={() => {
                                                    setEditingId(null);
                                                    setEditText('');
                                                }}
                                                disabled={savingEdit}
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                type="button"
                                                className="days-save-btn btn-small"
                                                onClick={() => void saveEdit(note.note_id)}
                                                disabled={savingEdit}
                                            >
                                                Save
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div className="note-header-row">
                                            <div className="note-author-container">
                                                <label className="note-checkbox-label">
                                                    <input
                                                        type="checkbox"
                                                        checked={!unread}
                                                        onChange={() => void toggleRead(note)}
                                                        className="note-checkbox"
                                                        aria-label={unread ? 'Mark as read' : 'Mark as unread'}
                                                        title={unread ? 'Mark as read' : 'Mark as unread'}
                                                    />
                                                </label>
                                                <div className={`note-author ${isLab ? 'lab' : 'doctor'} ${unread ? 'font-bold' : 'font-normal'}`}>
                                                    <i className={isLab ? 'fas fa-flask' : 'fas fa-user-md'} aria-hidden="true"></i>
                                                    {isLab ? labName : doctorLabel(note.doctor_name) || 'Doctor'}
                                                </div>
                                                <div className="note-date">
                                                    {formatSetDateTime(note.created_at)}
                                                    {note.is_edited && ' (edited)'}
                                                </div>
                                            </div>
                                            <div className="flex-gap-sm">
                                                {/* Only the lab's own notes can be edited. */}
                                                {isLab && (
                                                    <button
                                                        type="button"
                                                        className="action-icon-btn edit btn-compact"
                                                        onClick={() => {
                                                            setEditingId(note.note_id);
                                                            setEditText(note.note_text);
                                                        }}
                                                        title="Edit Note"
                                                        aria-label="Edit note"
                                                    >
                                                        <i className="fas fa-edit" aria-hidden="true"></i>
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    className="action-icon-btn delete btn-compact"
                                                    onClick={() => void handleDelete(note)}
                                                    title="Delete Note"
                                                    aria-label="Delete note"
                                                >
                                                    <i className="fas fa-trash" aria-hidden="true"></i>
                                                </button>
                                            </div>
                                        </div>
                                        <p className={`note-text ${unread ? 'font-bold' : 'font-normal'}`}>{note.note_text}</p>
                                    </>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
