// PatientSets.jsx - Patient's aligner sets, batches, and notes with full CRUD
// This page handles both doctor-browse and search routes
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ConfirmDialog from '../../components/react/ConfirmDialog.jsx';
import SetFormDrawer from '../../components/react/SetFormDrawer.jsx';
import BatchFormDrawer from '../../components/react/BatchFormDrawer.jsx';
import PaymentFormDrawer from '../../components/react/PaymentFormDrawer.jsx';
import { copyToClipboard } from '../../core/utils.js';

const PatientSets = () => {
    const { doctorId, workId } = useParams();
    const navigate = useNavigate();

    // Determine if we came from doctor browse or direct search
    const isFromDoctorBrowse = doctorId !== undefined;

    const [patient, setPatient] = useState(null);
    const [alignerSets, setAlignerSets] = useState([]);
    const [expandedSets, setExpandedSets] = useState({});
    const [batchesData, setBatchesData] = useState({});
    const [notesData, setNotesData] = useState({});
    const [expandedCommunication, setExpandedCommunication] = useState({});
    const [loading, setLoading] = useState(false);

    // CRUD states
    const [showSetDrawer, setShowSetDrawer] = useState(false);
    const [editingSet, setEditingSet] = useState(null);
    const [showBatchDrawer, setShowBatchDrawer] = useState(false);
    const [editingBatch, setEditingBatch] = useState(null);
    const [currentSetForBatch, setCurrentSetForBatch] = useState(null);
    const [showPaymentDrawer, setShowPaymentDrawer] = useState(false);
    const [currentSetForPayment, setCurrentSetForPayment] = useState(null);
    const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: '', message: '', onConfirm: null });
    const [uploadingPdf, setUploadingPdf] = useState({});

    // Note states for lab communication
    const [showAddLabNote, setShowAddLabNote] = useState({});
    const [labNoteText, setLabNoteText] = useState('');
    const [editingNoteId, setEditingNoteId] = useState(null);
    const [editNoteText, setEditNoteText] = useState('');

    // Load patient and sets on mount
    useEffect(() => {
        loadPatientAndSets();
    }, [workId]);

    const loadPatientAndSets = async () => {
        try {
            setLoading(true);

            // Load patient info from work
            const workResponse = await fetch(`/api/getwork/${workId}`);
            const workData = await workResponse.json();

            if (workData.success && workData.work) {
                const patientResponse = await fetch(`/api/getpatient/${workData.work.PersonID}`);
                const patientData = await patientResponse.json();

                const patientWithWork = {
                    ...patientData,
                    workid: parseInt(workId),
                    WorkType: workData.work.TypeOfWork
                };
                setPatient(patientWithWork);
            }

            // Load aligner sets
            await loadAlignerSets(parseInt(workId));

        } catch (error) {
            console.error('Error loading patient:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadAlignerSets = async (workIdParam) => {
        try {
            const response = await fetch(`/api/aligner/sets/${workIdParam}`);
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to load aligner sets');
            }

            const sets = data.sets || [];
            setAlignerSets(sets);

            // Auto-expand the active set
            const activeSet = sets.find(s => s.IsActive === true);
            if (activeSet) {
                const setId = activeSet.AlignerSetID;
                if (!batchesData[setId]) {
                    await loadBatches(setId);
                }
                if (!notesData[setId]) {
                    await loadNotes(setId, workIdParam);
                }
                setExpandedSets(prev => ({ ...prev, [setId]: true }));
                setExpandedCommunication(prev => ({ ...prev, [setId]: true }));
            }
        } catch (error) {
            console.error('Error loading aligner sets:', error);
            alert('Failed to load aligner sets: ' + error.message);
        }
    };

    const loadBatches = async (setId) => {
        try {
            const response = await fetch(`/api/aligner/batches/${setId}`);
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to load batches');
            }

            setBatchesData(prev => ({ ...prev, [setId]: data.batches || [] }));
        } catch (error) {
            console.error('Error loading batches:', error);
            setBatchesData(prev => ({ ...prev, [setId]: [] }));
        }
    };

    const loadNotes = async (setId, workIdParam, autoMarkRead = true) => {
        try {
            const response = await fetch(`/api/aligner/notes/${setId}`);
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to load notes');
            }

            setNotesData(prev => ({ ...prev, [setId]: data.notes || [] }));

            // Auto-mark unread doctor notes as read
            if (autoMarkRead) {
                const unreadDoctorNotes = (data.notes || []).filter(note =>
                    note.NoteType === 'Doctor' && note.IsRead === false
                );

                if (unreadDoctorNotes.length > 0) {
                    for (const note of unreadDoctorNotes) {
                        await markNoteAsRead(note.NoteID);
                    }
                    await loadNotes(setId, workIdParam, false);
                }
            }
        } catch (error) {
            console.error('Error loading notes:', error);
            setNotesData(prev => ({ ...prev, [setId]: [] }));
        }
    };

    const markNoteAsRead = async (noteId) => {
        try {
            await fetch(`/api/aligner/notes/${noteId}/read`, { method: 'PUT' });
        } catch (error) {
            console.error('Error marking note as read:', error);
        }
    };

    const toggleBatches = async (setId) => {
        if (expandedSets[setId]) {
            setExpandedSets(prev => ({ ...prev, [setId]: false }));
            setExpandedCommunication(prev => ({ ...prev, [setId]: false }));
            return;
        }

        if (!batchesData[setId]) {
            await loadBatches(setId);
        }

        if (!notesData[setId]) {
            await loadNotes(setId, patient?.workid);
        }

        setExpandedSets(prev => ({ ...prev, [setId]: true }));
        setExpandedCommunication(prev => ({ ...prev, [setId]: true }));
    };

    const toggleCommunication = (setId) => {
        setExpandedCommunication(prev => ({ ...prev, [setId]: !prev[setId] }));
    };

    // Helper functions
    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    };

    const formatDateTime = (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const calculateProgress = (set) => {
        const delivered = set.UpperAlignersCount + set.LowerAlignersCount - set.RemainingUpperAligners - set.RemainingLowerAligners;
        const total = set.UpperAlignersCount + set.LowerAlignersCount;
        return total > 0 ? Math.round((delivered / total) * 100) : 0;
    };

    const formatPatientName = (patient) => {
        return patient?.PatientName || `${patient?.FirstName || ''} ${patient?.LastName || ''}`.trim() || 'N/A';
    };

    const generateFolderPath = (set) => {
        if (!patient || !set) return null;
        const patientName = formatPatientName(patient).replace(/ /g, '_');
        const folderPath = `\\\\WORK_PC\\Aligner_Sets\\${set.AlignerDrID}\\${patientName}\\${set.SetSequence}`;
        return folderPath;
    };

    const openSetFolder = async (set) => {
        const folderPath = generateFolderPath(set);
        if (!folderPath) {
            alert('Unable to generate folder path');
            return;
        }

        // Use the utility function to copy to clipboard
        const success = await copyToClipboard(folderPath);

        if (success) {
            // Show success notification
            const notification = document.createElement('div');
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: linear-gradient(135deg, #4caf50, #45a049);
                color: white;
                padding: 1rem 1.5rem;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                z-index: 10000;
                animation: slideIn 0.3s ease-out;
                font-size: 0.95rem;
                max-width: 400px;
            `;
            notification.innerHTML = `
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <i class="fas fa-check-circle" style="font-size: 1.2rem;"></i>
                    <div>
                        <div style="font-weight: 600; margin-bottom: 0.25rem;">Folder path copied!</div>
                        <div style="font-size: 0.85rem; opacity: 0.9;">${folderPath}</div>
                    </div>
                </div>
            `;

            document.body.appendChild(notification);

            // Remove notification after 4 seconds
            setTimeout(() => {
                notification.style.animation = 'slideOut 0.3s ease-out';
                setTimeout(() => notification.remove(), 300);
            }, 4000);
        } else {
            // Fallback - show path in alert
            alert(`Folder path:\n${folderPath}\n\nCould not copy to clipboard automatically.`);
        }
    };

    const backToList = () => {
        if (isFromDoctorBrowse) {
            navigate(`/aligner/doctor/${doctorId}`);
        } else {
            navigate('/aligner/search');
        }
    };

    // CRUD Operations
    const openAddSetDrawer = () => {
        setEditingSet(null);
        setShowSetDrawer(true);
    };

    const openEditSetDrawer = (set) => {
        setEditingSet(set);
        setShowSetDrawer(true);
    };

    const handleSetSaved = () => {
        setShowSetDrawer(false);
        setEditingSet(null);
        loadAlignerSets(patient.workid);
    };

    const openAddBatchDrawer = (set) => {
        setCurrentSetForBatch(set);
        setEditingBatch(null);
        setShowBatchDrawer(true);
    };

    const openEditBatchDrawer = (batch, set) => {
        setCurrentSetForBatch(set);
        setEditingBatch(batch);
        setShowBatchDrawer(true);
    };

    const handleBatchSaved = () => {
        setShowBatchDrawer(false);
        setEditingBatch(null);
        setCurrentSetForBatch(null);
        if (currentSetForBatch) {
            loadBatches(currentSetForBatch.AlignerSetID);
        }
    };

    const openPaymentDrawer = (set) => {
        setCurrentSetForPayment(set);
        setShowPaymentDrawer(true);
    };

    const handlePaymentSaved = () => {
        setShowPaymentDrawer(false);
        setCurrentSetForPayment(null);
        loadAlignerSets(patient.workid);
    };

    const handleDeleteSet = (set, e) => {
        e.stopPropagation();
        setConfirmDialog({
            isOpen: true,
            title: 'Delete Aligner Set?',
            message: `Are you sure you want to delete Set #${set.SetSequence}? This will also delete all associated batches and notes. This action cannot be undone.`,
            onConfirm: async () => {
                try {
                    const response = await fetch(`/api/aligner/sets/${set.AlignerSetID}`, {
                        method: 'DELETE'
                    });
                    const data = await response.json();

                    if (!data.success) {
                        throw new Error(data.error || 'Failed to delete set');
                    }

                    alert('Set deleted successfully');
                    loadAlignerSets(patient.workid);
                } catch (error) {
                    console.error('Error deleting set:', error);
                    alert('Failed to delete set: ' + error.message);
                }
                setConfirmDialog({ isOpen: false, title: '', message: '', onConfirm: null });
            }
        });
    };

    const handleMarkDelivered = async (batch, e) => {
        e.stopPropagation();
        try {
            const response = await fetch(`/api/aligner/batches/${batch.AlignerBatchID}/deliver`, {
                method: 'PATCH'
            });
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to mark as delivered');
            }

            alert('Batch marked as delivered');
            await loadBatches(batch.AlignerSetID);
            await loadAlignerSets(patient.workid);
        } catch (error) {
            console.error('Error marking as delivered:', error);
            alert('Failed to mark as delivered: ' + error.message);
        }
    };

    const handleDeleteBatch = (batch, e) => {
        e.stopPropagation();
        setConfirmDialog({
            isOpen: true,
            title: 'Delete Batch?',
            message: `Are you sure you want to delete Batch #${batch.BatchSequence}? This action cannot be undone.`,
            onConfirm: async () => {
                try {
                    const response = await fetch(`/api/aligner/batches/${batch.AlignerBatchID}`, {
                        method: 'DELETE'
                    });
                    const data = await response.json();

                    if (!data.success) {
                        throw new Error(data.error || 'Failed to delete batch');
                    }

                    alert('Batch deleted successfully');
                    await loadBatches(batch.AlignerSetID);
                    await loadAlignerSets(patient.workid);
                } catch (error) {
                    console.error('Error deleting batch:', error);
                    alert('Failed to delete batch: ' + error.message);
                }
                setConfirmDialog({ isOpen: false, title: '', message: '', onConfirm: null });
            }
        });
    };

    // PDF Upload
    const handlePdfUpload = async (setId, file) => {
        if (!file) return;

        if (file.type !== 'application/pdf') {
            alert('Please select a PDF file');
            return;
        }

        if (file.size > 100 * 1024 * 1024) {
            alert('File is too large. Maximum size is 100MB.');
            return;
        }

        try {
            setUploadingPdf(prev => ({ ...prev, [setId]: true }));

            const formData = new FormData();
            formData.append('pdf', file);

            const response = await fetch(`/api/aligner/sets/${setId}/upload-pdf`, {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to upload PDF');
            }

            alert('PDF uploaded successfully');
            await loadAlignerSets(patient.workid);

        } catch (error) {
            console.error('Error uploading PDF:', error);
            alert('Failed to upload PDF: ' + error.message);
        } finally {
            setUploadingPdf(prev => ({ ...prev, [setId]: false }));
        }
    };

    const handlePdfDelete = async (setId) => {
        if (!confirm('Are you sure you want to delete this PDF?')) {
            return;
        }

        try {
            const response = await fetch(`/api/aligner/sets/${setId}/pdf`, {
                method: 'DELETE'
            });

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to delete PDF');
            }

            alert('PDF deleted successfully');
            await loadAlignerSets(patient.workid);
        } catch (error) {
            console.error('Error deleting PDF:', error);
            alert('Failed to delete PDF: ' + error.message);
        }
    };

    // Notes Operations
    const handleAddLabNote = async (setId) => {
        if (!labNoteText.trim()) {
            alert('Please enter a note');
            return;
        }

        try {
            const response = await fetch('/api/aligner/notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    AlignerSetID: setId,
                    NoteType: 'Lab',
                    NoteText: labNoteText.trim()
                })
            });

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to add note');
            }

            setLabNoteText('');
            setShowAddLabNote(prev => ({ ...prev, [setId]: false }));
            await loadNotes(setId, patient.workid, false);

        } catch (error) {
            console.error('Error adding note:', error);
            alert('Failed to add note: ' + error.message);
        }
    };

    const handleStartEditNote = (note) => {
        setEditingNoteId(note.NoteID);
        setEditNoteText(note.NoteText);
    };

    const handleCancelEditNote = () => {
        setEditingNoteId(null);
        setEditNoteText('');
    };

    const saveEditNote = async (noteId, setId) => {
        if (!editNoteText.trim()) {
            alert('Please enter a note');
            return;
        }

        try {
            const response = await fetch(`/api/aligner/notes/${noteId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    NoteText: editNoteText.trim()
                })
            });

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to update note');
            }

            setEditingNoteId(null);
            setEditNoteText('');
            await loadNotes(setId, patient.workid, false);

        } catch (error) {
            console.error('Error updating note:', error);
            alert('Failed to update note: ' + error.message);
        }
    };

    const handleToggleNoteRead = async (noteId, setId) => {
        try {
            const response = await fetch(`/api/aligner/notes/${noteId}/toggle-read`, {
                method: 'PUT'
            });
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to toggle note read status');
            }

            await loadNotes(setId, patient.workid, false);
        } catch (error) {
            console.error('Error toggling note read status:', error);
        }
    };

    const handleDeleteNote = (noteId, setId) => {
        setConfirmDialog({
            isOpen: true,
            title: 'Delete Note?',
            message: 'Are you sure you want to delete this note? This action cannot be undone.',
            onConfirm: async () => {
                try {
                    const response = await fetch(`/api/aligner/notes/${noteId}`, {
                        method: 'DELETE'
                    });
                    const data = await response.json();

                    if (!data.success) {
                        throw new Error(data.error || 'Failed to delete note');
                    }

                    await loadNotes(setId, patient.workid, false);

                } catch (error) {
                    console.error('Error deleting note:', error);
                    alert('Failed to delete note: ' + error.message);
                }
                setConfirmDialog({ isOpen: false, title: '', message: '', onConfirm: null });
            }
        });
    };

    if (loading) {
        return (
            <div className="aligner-container">
                <div className="loading-container">
                    <div className="spinner"></div>
                    <p>Loading patient sets...</p>
                </div>
            </div>
        );
    }

    if (!patient) {
        return (
            <div className="aligner-container">
                <div className="error-container">
                    <i className="fas fa-exclamation-triangle"></i>
                    <h2>Patient Not Found</h2>
                    <button onClick={backToList} className="btn-primary">
                        Back to List
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="aligner-container">
            {/* Mode Toggle */}
            <div className="mode-toggle">
                <button
                    className={`mode-btn ${isFromDoctorBrowse ? 'active' : ''}`}
                    onClick={() => navigate('/aligner')}
                >
                    <i className="fas fa-user-md"></i>
                    Browse by Doctor
                </button>
                <button
                    className={`mode-btn ${!isFromDoctorBrowse ? 'active' : ''}`}
                    onClick={() => navigate('/aligner/search')}
                >
                    <i className="fas fa-search"></i>
                    Quick Search
                </button>
            </div>

            {/* Breadcrumb */}
            <div className="breadcrumb">
                <button onClick={backToList} className="breadcrumb-link">
                    <i className="fas fa-arrow-left"></i>
                    Back to {isFromDoctorBrowse ? 'Patients' : 'Search'}
                </button>
            </div>

            {/* Patient Info Header */}
            <div className="patient-info">
                <div className="patient-header">
                    <div className="patient-details">
                        <h2>
                            {formatPatientName(patient)}
                            {patient.PatientName && patient.FirstName && (
                                <span className="patient-subtitle">
                                    ({patient.FirstName} {patient.LastName})
                                </span>
                            )}
                        </h2>
                        <div className="patient-meta">
                            <span><i className="fas fa-id-card"></i> {patient.patientID || 'N/A'}</span>
                            <span><i className="fas fa-phone"></i> {patient.Phone || 'N/A'}</span>
                            <span><i className="fas fa-tooth"></i> {patient.WorkType}</span>
                        </div>
                    </div>
                    <button className="btn-add-set" onClick={openAddSetDrawer}>
                        <i className="fas fa-plus"></i>
                        Add New Set
                    </button>
                </div>
            </div>

            {/* Aligner Sets - Complete rendering */}
            <div className="aligner-sets-container">
                <div className="section-header">
                    <h3>Aligner Sets</h3>
                    <div className="section-info">
                        <span>{alignerSets.length} set{alignerSets.length !== 1 ? 's' : ''}</span>
                    </div>
                </div>

                {loading ? (
                    <div className="loading">
                        <div className="spinner"></div>
                        <p>Loading aligner sets...</p>
                    </div>
                ) : alignerSets.length === 0 ? (
                    <div className="empty-state">
                        <i className="fas fa-inbox"></i>
                        <p>No aligner sets found for this patient</p>
                    </div>
                ) : (
                    <div className="aligner-sets">
                        {alignerSets.map((set) => {
                            const progress = calculateProgress(set);
                            const delivered = set.UpperAlignersCount + set.LowerAlignersCount - set.RemainingUpperAligners - set.RemainingLowerAligners;
                            const total = set.UpperAlignersCount + set.LowerAlignersCount;

                            return (
                                <div key={set.AlignerSetID} className={`aligner-set-card ${set.IsActive ? 'active' : 'inactive'} ${set.UnreadActivityCount > 0 ? 'has-activity' : ''}`}>
                                    {/* Activity Banner */}
                                    {set.UnreadActivityCount > 0 && (
                                        <div className="activity-banner">
                                            <i className="fas fa-bell"></i>
                                            <strong>{set.UnreadActivityCount}</strong> new {set.UnreadActivityCount === 1 ? 'update' : 'updates'} from doctor
                                        </div>
                                    )}

                                    <div className="set-header" onClick={() => toggleBatches(set.AlignerSetID)}>
                                        <div className="set-title">
                                            <h4>
                                                Set #{set.SetSequence}
                                                <span className={`set-badge ${set.IsActive ? 'active' : 'inactive'}`}>
                                                    {set.IsActive ? 'Active' : 'Inactive'}
                                                </span>
                                                {set.Type && <span className="set-type">{set.Type}</span>}
                                            </h4>
                                            <div className="set-title-actions">
                                                <button
                                                    className="action-icon-btn edit"
                                                    onClick={(e) => openEditSetDrawer(set, e)}
                                                    title="Edit Set"
                                                >
                                                    <i className="fas fa-edit"></i>
                                                </button>
                                                <button
                                                    className="action-icon-btn delete"
                                                    onClick={(e) => handleDeleteSet(set, e)}
                                                    title="Delete Set"
                                                >
                                                    <i className="fas fa-trash"></i>
                                                </button>
                                            </div>
                                        </div>
                                        <div className="set-header-actions">
                                            <button
                                                className="folder-btn"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    openSetFolder(set);
                                                }}
                                                title={generateFolderPath(set)}
                                            >
                                                <i className="fas fa-folder-open"></i>
                                                <span>Open Folder</span>
                                            </button>
                                            {set.SetUrl && (
                                                <button
                                                    className="url-btn"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        window.open(set.SetUrl, '_blank');
                                                    }}
                                                    title={set.SetUrl}
                                                >
                                                    <i className="fas fa-external-link-alt"></i>
                                                    <span>View Online</span>
                                                </button>
                                            )}
                                            {set.SetPdfUrl ? (
                                                <>
                                                    <button
                                                        className="pdf-btn"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            window.open(set.SetPdfUrl, '_blank');
                                                        }}
                                                        title={set.SetPdfUrl}
                                                    >
                                                        <i className="fas fa-file-pdf"></i>
                                                        <span>View PDF</span>
                                                    </button>
                                                    <label
                                                        className="replace-pdf-btn"
                                                        style={{ cursor: 'pointer' }}
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        <i className="fas fa-upload"></i>
                                                        <span>Replace PDF</span>
                                                        <input
                                                            type="file"
                                                            accept=".pdf,application/pdf"
                                                            style={{ display: 'none' }}
                                                            onChange={(e) => {
                                                                if (e.target.files && e.target.files[0]) {
                                                                    handlePdfUpload(set.AlignerSetID, e.target.files[0]);
                                                                    e.target.value = '';
                                                                }
                                                            }}
                                                            disabled={uploadingPdf[set.AlignerSetID]}
                                                        />
                                                    </label>
                                                    <button
                                                        className="delete-pdf-btn"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handlePdfDelete(set.AlignerSetID);
                                                        }}
                                                        title="Delete PDF"
                                                    >
                                                        <i className="fas fa-trash"></i>
                                                        <span>Delete PDF</span>
                                                    </button>
                                                </>
                                            ) : (
                                                <label
                                                    className="upload-pdf-btn"
                                                    style={{ cursor: 'pointer' }}
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    {uploadingPdf[set.AlignerSetID] ? (
                                                        <>
                                                            <i className="fas fa-spinner fa-spin"></i>
                                                            <span>Uploading...</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <i className="fas fa-upload"></i>
                                                            <span>Upload PDF</span>
                                                        </>
                                                    )}
                                                    <input
                                                        type="file"
                                                        accept=".pdf,application/pdf"
                                                        style={{ display: 'none' }}
                                                        onChange={(e) => {
                                                            if (e.target.files && e.target.files[0]) {
                                                                handlePdfUpload(set.AlignerSetID, e.target.files[0]);
                                                                e.target.value = '';
                                                            }
                                                        }}
                                                        disabled={uploadingPdf[set.AlignerSetID]}
                                                    />
                                                </label>
                                            )}
                                            {set.SetCost && set.Balance > 0 && (
                                                <button
                                                    className="payment-btn"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        openPaymentDrawer(set);
                                                    }}
                                                    title="Add Payment"
                                                >
                                                    <i className="fas fa-money-bill-wave"></i>
                                                    <span>Add Payment</span>
                                                </button>
                                            )}
                                            <button className={`toggle-batches-btn ${expandedSets[set.AlignerSetID] ? 'expanded' : ''}`}>
                                                <span>View Batches ({set.TotalBatches})</span>
                                                <i className="fas fa-chevron-down"></i>
                                            </button>
                                        </div>
                                    </div>

                                    <div className="set-info">
                                        <div className="set-info-item">
                                            <i className="fas fa-teeth"></i>
                                            <span>Upper: <strong>{set.UpperAlignersCount}</strong></span>
                                        </div>
                                        <div className="set-info-item">
                                            <i className="fas fa-teeth"></i>
                                            <span>Lower: <strong>{set.LowerAlignersCount}</strong></span>
                                        </div>
                                        <div className="set-info-item">
                                            <i className="fas fa-box-open"></i>
                                            <span>Remaining Upper: <strong>{set.RemainingUpperAligners}</strong></span>
                                        </div>
                                        <div className="set-info-item">
                                            <i className="fas fa-box-open"></i>
                                            <span>Remaining Lower: <strong>{set.RemainingLowerAligners}</strong></span>
                                        </div>
                                        <div className="set-info-item">
                                            <i className="fas fa-calendar"></i>
                                            <span>Created: <strong>{formatDate(set.CreationDate)}</strong></span>
                                        </div>
                                        <div className="set-info-item">
                                            <i className="fas fa-clock"></i>
                                            <span>Days: <strong>{set.Days || 'N/A'}</strong></span>
                                        </div>
                                        <div className="set-info-item">
                                            <i className="fas fa-user-md"></i>
                                            <span>Doctor: <strong>{set.AlignerDoctorName || 'N/A'}</strong></span>
                                        </div>
                                        <div className="set-info-item">
                                            <i className="fas fa-check-circle"></i>
                                            <span>Delivered Batches: <strong>{set.DeliveredBatches}/{set.TotalBatches}</strong></span>
                                        </div>
                                        <div className="set-info-item">
                                            <i className="fas fa-dollar-sign"></i>
                                            <span>Cost: <strong>{set.SetCost ? `${set.SetCost} ${set.Currency || 'USD'}` : 'Not set'}</strong></span>
                                        </div>
                                        {set.SetCost && (
                                            <>
                                                <div className="set-info-item">
                                                    <i className="fas fa-money-bill-wave"></i>
                                                    <span>Paid: <strong>{set.TotalPaid || 0} {set.Currency || 'USD'}</strong></span>
                                                </div>
                                                <div className="set-info-item">
                                                    <i className="fas fa-balance-scale"></i>
                                                    <span>Balance: <strong>{set.Balance || set.SetCost} {set.Currency || 'USD'}</strong></span>
                                                </div>
                                                <div className="set-info-item">
                                                    <span className={`payment-status-badge ${set.PaymentStatus?.toLowerCase().replace(/\s+/g, '-') || 'unpaid'}`}>
                                                        {set.PaymentStatus || 'Unpaid'}
                                                    </span>
                                                </div>
                                            </>
                                        )}
                                        <div className="set-info-item" style={{ gridColumn: '1 / -1' }}>
                                            <i className="fas fa-external-link-alt"></i>
                                            <span>Set URL: {set.SetUrl ? (
                                                <a href={set.SetUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'underline' }}>
                                                    {set.SetUrl}
                                                </a>
                                            ) : (
                                                <em style={{ color: '#6b7280' }}>Not set</em>
                                            )}</span>
                                        </div>
                                        <div className="set-info-item" style={{ gridColumn: '1 / -1' }}>
                                            <i className="fas fa-file-pdf"></i>
                                            <span>PDF URL: {set.SetPdfUrl ? (
                                                <a href={set.SetPdfUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'underline' }}>
                                                    {set.SetPdfUrl}
                                                </a>
                                            ) : (
                                                <em style={{ color: '#6b7280' }}>Not set</em>
                                            )}</span>
                                        </div>
                                    </div>

                                    {set.Notes && (
                                        <div className="set-info-item">
                                            <i className="fas fa-sticky-note"></i>
                                            <span>Notes: {set.Notes}</span>
                                        </div>
                                    )}

                                    <div className="set-progress">
                                        <div className="progress-bar-container">
                                            <div className="progress-bar" style={{ width: `${progress}%` }}></div>
                                        </div>
                                        <div className="progress-text">
                                            <span>{delivered} of {total} aligners delivered</span>
                                            <span>{progress}%</span>
                                        </div>
                                    </div>

                                    {/* Batches Container */}
                                    {expandedSets[set.AlignerSetID] && (
                                        <div className="batches-container expanded">
                                            <div className="batches-header">
                                                <h5>Batches</h5>
                                                <button
                                                    className="add-batch-btn"
                                                    onClick={(e) => openAddBatchDrawer(set, e)}
                                                    disabled={!set.IsActive}
                                                    title={!set.IsActive ? 'Cannot add batches to inactive sets' : 'Add new batch'}
                                                >
                                                    <i className="fas fa-plus"></i> Add Batch
                                                </button>
                                            </div>
                                            {!batchesData[set.AlignerSetID] ? (
                                                <div className="loading">
                                                    <div className="spinner"></div>
                                                    <p>Loading batches...</p>
                                                </div>
                                            ) : batchesData[set.AlignerSetID].length === 0 ? (
                                                <p className="empty-state">No batches found for this set</p>
                                            ) : (
                                                batchesData[set.AlignerSetID].map((batch) => {
                                                    const isDelivered = batch.DeliveredToPatientDate !== null;
                                                    return (
                                                        <div key={batch.AlignerBatchID} className={`batch-item ${isDelivered ? 'delivered' : 'pending'}`}>
                                                            <div className="batch-header">
                                                                <div className="batch-title">Batch #{batch.BatchSequence}</div>
                                                                <div className="batch-actions">
                                                                    <span className={`batch-status ${isDelivered ? 'delivered' : 'pending'}`}>
                                                                        {isDelivered ? 'Delivered' : 'Pending'}
                                                                    </span>
                                                                    {!isDelivered && (
                                                                        <button
                                                                            className="action-icon-btn deliver"
                                                                            onClick={(e) => handleMarkDelivered(batch, e)}
                                                                            title="Mark as Delivered"
                                                                        >
                                                                            <i className="fas fa-check-circle"></i>
                                                                        </button>
                                                                    )}
                                                                    <button
                                                                        className="action-icon-btn edit"
                                                                        onClick={(e) => openEditBatchDrawer(batch, set, e)}
                                                                        title="Edit Batch"
                                                                    >
                                                                        <i className="fas fa-edit"></i>
                                                                    </button>
                                                                    <button
                                                                        className="action-icon-btn delete"
                                                                        onClick={(e) => handleDeleteBatch(batch, e)}
                                                                        title="Delete Batch"
                                                                    >
                                                                        <i className="fas fa-times"></i>
                                                                    </button>
                                                                </div>
                                                            </div>
                                                            <div className="batch-details">
                                                                <div className="batch-detail">
                                                                    <i className="fas fa-teeth"></i>
                                                                    <span>Upper: {batch.UpperAlignerStartSequence}-{batch.UpperAlignerEndSequence} ({batch.UpperAlignerCount})</span>
                                                                </div>
                                                                <div className="batch-detail">
                                                                    <i className="fas fa-teeth"></i>
                                                                    <span>Lower: {batch.LowerAlignerStartSequence}-{batch.LowerAlignerEndSequence} ({batch.LowerAlignerCount})</span>
                                                                </div>
                                                                <div className="batch-detail">
                                                                    <i className="fas fa-industry"></i>
                                                                    <span>Manufactured: {formatDate(batch.ManufactureDate)}</span>
                                                                </div>
                                                                {isDelivered && (
                                                                    <div className="batch-detail">
                                                                        <i className="fas fa-truck"></i>
                                                                        <span>Delivered: {formatDate(batch.DeliveredToPatientDate)}</span>
                                                                    </div>
                                                                )}
                                                                <div className="batch-detail">
                                                                    <i className="fas fa-clock"></i>
                                                                    <span>Days: {batch.Days || 'N/A'}</span>
                                                                </div>
                                                                <div className="batch-detail">
                                                                    <i className="fas fa-hourglass-half"></i>
                                                                    <span>Validity: {batch.ValidityPeriod || 'N/A'} days</span>
                                                                </div>
                                                                {batch.NextBatchReadyDate && (
                                                                    <div className="batch-detail">
                                                                        <i className="fas fa-calendar-check"></i>
                                                                        <span>Next Batch: {formatDate(batch.NextBatchReadyDate)}</span>
                                                                    </div>
                                                                )}
                                                                {batch.Notes && (
                                                                    <div className="batch-detail" style={{ gridColumn: '1 / -1' }}>
                                                                        <i className="fas fa-sticky-note"></i>
                                                                        <span>Notes: {batch.Notes}</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    )}

                                    {/* Communication Section */}
                                    <div className="communication-section">
                                        <button
                                            className={`communication-toggle-btn ${expandedCommunication[set.AlignerSetID] ? 'expanded' : ''}`}
                                            onClick={() => toggleCommunication(set.AlignerSetID)}
                                        >
                                            <i className="fas fa-comments"></i>
                                            <span>Communication with Doctor</span>
                                            <i className="fas fa-chevron-down"></i>
                                        </button>

                                        {expandedCommunication[set.AlignerSetID] && (
                                            <div className="communication-content expanded">
                                                {!notesData[set.AlignerSetID] ? (
                                                    <div className="loading">
                                                        <div className="spinner"></div>
                                                        <p>Loading communication...</p>
                                                    </div>
                                                ) : (
                                                    <>
                                                        {/* Add Note Form */}
                                                        <div className="add-note-section" style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '6px' }}>
                                                            {!showAddLabNote[set.AlignerSetID] ? (
                                                                <button
                                                                    className="add-batch-btn"
                                                                    onClick={() => setShowAddLabNote(prev => ({ ...prev, [set.AlignerSetID]: true }))}
                                                                    style={{ width: 'auto' }}
                                                                >
                                                                    <i className="fas fa-plus"></i> Send Note to Doctor
                                                                </button>
                                                            ) : (
                                                                <div className="note-form">
                                                                    <textarea
                                                                        className="note-textarea"
                                                                        placeholder="Type your message to the doctor..."
                                                                        value={labNoteText}
                                                                        onChange={(e) => setLabNoteText(e.target.value)}
                                                                        style={{
                                                                            width: '100%',
                                                                            minHeight: '100px',
                                                                            padding: '0.75rem',
                                                                            border: '1px solid #d1d5db',
                                                                            borderRadius: '6px',
                                                                            fontSize: '0.875rem',
                                                                            resize: 'vertical',
                                                                            marginBottom: '0.75rem'
                                                                        }}
                                                                    />
                                                                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                                                        <button
                                                                            className="btn-cancel"
                                                                            onClick={() => {
                                                                                setShowAddLabNote(prev => ({ ...prev, [set.AlignerSetID]: false }));
                                                                                setLabNoteText('');
                                                                            }}
                                                                            style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
                                                                        >
                                                                            Cancel
                                                                        </button>
                                                                        <button
                                                                            className="add-batch-btn"
                                                                            onClick={() => handleAddLabNote(set.AlignerSetID)}
                                                                            style={{ width: 'auto' }}
                                                                        >
                                                                            <i className="fas fa-paper-plane"></i> Send Note
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>

                                                        {/* Notes Timeline */}
                                                        {notesData[set.AlignerSetID].length === 0 ? (
                                                            <div className="empty-communication">
                                                                <i className="fas fa-inbox"></i>
                                                                <p>No messages yet</p>
                                                                <p className="hint">Communication between doctor and lab will appear here</p>
                                                            </div>
                                                        ) : (
                                                            <div className="notes-timeline">
                                                                {notesData[set.AlignerSetID].map((note) => (
                                                                    <div key={note.NoteID} className={`note-item ${note.NoteType === 'Lab' ? 'lab-note' : 'doctor-note'}`}>
                                                                        {editingNoteId === note.NoteID ? (
                                                                            /* Editing Mode */
                                                                            <div className="note-edit-form">
                                                                                <textarea
                                                                                    className="note-textarea"
                                                                                    value={editNoteText}
                                                                                    onChange={(e) => setEditNoteText(e.target.value)}
                                                                                    style={{
                                                                                        width: '100%',
                                                                                        minHeight: '80px',
                                                                                        padding: '0.75rem',
                                                                                        border: '1px solid #d1d5db',
                                                                                        borderRadius: '6px',
                                                                                        fontSize: '0.875rem',
                                                                                        resize: 'vertical',
                                                                                        marginBottom: '0.5rem'
                                                                                    }}
                                                                                />
                                                                                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                                                                    <button
                                                                                        className="btn-cancel"
                                                                                        onClick={handleCancelEditNote}
                                                                                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                                                                                    >
                                                                                        Cancel
                                                                                    </button>
                                                                                    <button
                                                                                        className="days-save-btn"
                                                                                        onClick={() => saveEditNote(note.NoteID, set.AlignerSetID)}
                                                                                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                                                                                    >
                                                                                        Save
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                        ) : (
                                                                            /* View Mode */
                                                                            <>
                                                                                <div className="note-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                                                                        {/* Read/Unread Checkbox */}
                                                                                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '0.95rem' }}>
                                                                                            <input
                                                                                                type="checkbox"
                                                                                                checked={note.IsRead !== false}
                                                                                                onChange={() => handleToggleNoteRead(note.NoteID, set.AlignerSetID)}
                                                                                                style={{ marginRight: '0.5rem', cursor: 'pointer', width: '16px', height: '16px' }}
                                                                                                title={note.IsRead !== false ? 'Mark as unread' : 'Mark as read'}
                                                                                            />
                                                                                        </label>
                                                                                        <div className={`note-author ${note.NoteType === 'Lab' ? 'lab' : 'doctor'}`} style={{ fontWeight: note.IsRead === false ? 'bold' : 'normal' }}>
                                                                                            <i className={note.NoteType === 'Lab' ? 'fas fa-flask' : 'fas fa-user-md'}></i>
                                                                                            {note.NoteType === 'Lab' ? 'Shwan Lab' : `Dr. ${note.DoctorName}`}
                                                                                        </div>
                                                                                        <div className="note-date">
                                                                                            {formatDateTime(note.CreatedAt)}
                                                                                            {note.IsEdited && ' (edited)'}
                                                                                        </div>
                                                                                    </div>
                                                                                    {/* Show edit/delete buttons */}
                                                                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                                                        {/* Only Lab notes can be edited */}
                                                                                        {note.NoteType === 'Lab' && (
                                                                                            <button
                                                                                                className="action-icon-btn edit"
                                                                                                onClick={() => handleStartEditNote(note)}
                                                                                                title="Edit Note"
                                                                                                style={{ padding: '0.25rem 0.5rem' }}
                                                                                            >
                                                                                                <i className="fas fa-edit"></i>
                                                                                            </button>
                                                                                        )}
                                                                                        {/* All notes can be deleted */}
                                                                                        <button
                                                                                            className="action-icon-btn delete"
                                                                                            onClick={() => handleDeleteNote(note.NoteID, set.AlignerSetID)}
                                                                                            title="Delete Note"
                                                                                            style={{ padding: '0.25rem 0.5rem' }}
                                                                                        >
                                                                                            <i className="fas fa-trash"></i>
                                                                                        </button>
                                                                                    </div>
                                                                                </div>
                                                                                <p className="note-text" style={{ fontWeight: note.IsRead === false ? 'bold' : 'normal' }}>{note.NoteText}</p>
                                                                            </>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Drawers and Dialogs */}
            {showSetDrawer && (
                <SetFormDrawer
                    isOpen={showSetDrawer}
                    onClose={() => setShowSetDrawer(false)}
                    onSave={handleSetSaved}
                    editingSet={editingSet}
                    workId={patient.workid}
                />
            )}

            {showBatchDrawer && (
                <BatchFormDrawer
                    isOpen={showBatchDrawer}
                    onClose={() => setShowBatchDrawer(false)}
                    onSave={handleBatchSaved}
                    editingBatch={editingBatch}
                    set={currentSetForBatch}
                />
            )}

            {showPaymentDrawer && (
                <PaymentFormDrawer
                    isOpen={showPaymentDrawer}
                    onClose={() => setShowPaymentDrawer(false)}
                    onSave={handlePaymentSaved}
                    set={currentSetForPayment}
                />
            )}

            <ConfirmDialog
                isOpen={confirmDialog.isOpen}
                title={confirmDialog.title}
                message={confirmDialog.message}
                onConfirm={confirmDialog.onConfirm}
                onCancel={() => setConfirmDialog({ isOpen: false, title: '', message: '', onConfirm: null })}
            />
        </div>
    );
};

export default PatientSets;
