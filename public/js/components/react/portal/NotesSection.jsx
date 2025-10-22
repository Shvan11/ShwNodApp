// NotesSection.jsx - Notes/communication display and management
import React, { useState } from 'react';

const NotesSection = ({ setId, notes, onAddNote, formatDateTime }) => {
    const [showAddNote, setShowAddNote] = useState(false);
    const [noteText, setNoteText] = useState('');

    const handleSubmit = async () => {
        await onAddNote(setId, noteText);
        setNoteText('');
        setShowAddNote(false);
    };

    return (
        <div className="notes-section">
            <div className="notes-header">
                <h3>Communication</h3>
                {!showAddNote && (
                    <button className="btn-add-note" onClick={() => setShowAddNote(true)}>
                        <i className="fas fa-plus"></i>
                        Add Note
                    </button>
                )}
            </div>

            {showAddNote && (
                <div className="add-note-form">
                    <textarea
                        className="note-textarea"
                        placeholder="Type your message to the lab..."
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                    />
                    <div className="note-form-actions">
                        <button className="btn-cancel" onClick={() => setShowAddNote(false)}>
                            Cancel
                        </button>
                        <button className="btn-submit" onClick={handleSubmit}>
                            <i className="fas fa-paper-plane"></i>
                            Send Note
                        </button>
                    </div>
                </div>
            )}

            <div className="notes-timeline">
                {notes.length === 0 ? (
                    <div className="empty-state" style={{ padding: '2rem 1rem' }}>
                        <i className="fas fa-comments"></i>
                        <p>No messages yet</p>
                    </div>
                ) : (
                    notes.map((note) => (
                        <div key={note.NoteID} className={`note-item ${note.NoteType === 'Lab' ? 'lab-note' : ''}`}>
                            <div className="note-header-row">
                                <div className={`note-author ${note.NoteType === 'Lab' ? 'lab' : ''}`}>
                                    <i className={note.NoteType === 'Lab' ? 'fas fa-flask' : 'fas fa-user-md'}></i>
                                    {note.NoteType === 'Lab' ? 'Shwan Lab' : `Dr. ${note.DoctorName}`}
                                </div>
                                <div className="note-date">
                                    {formatDateTime(note.CreatedAt)}
                                    {note.IsEdited && ' (edited)'}
                                </div>
                            </div>
                            <p className="note-text">{note.NoteText}</p>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default NotesSection;
