import React, { useState, useEffect } from 'react';
import ConfirmDialog from './ConfirmDialog.jsx';
import SetFormDrawer from './SetFormDrawer.jsx';
import BatchFormDrawer from './BatchFormDrawer.jsx';
import PaymentFormDrawer from './PaymentFormDrawer.jsx';
import { copyToClipboard } from '../../core/utils.js';

const AlignerComponent = () => {
    const [viewMode, setViewMode] = useState('doctor'); // 'doctor' or 'search'
    const [doctors, setDoctors] = useState([]);
    const [selectedDoctor, setSelectedDoctor] = useState(null);
    const [patients, setPatients] = useState([]);
    const [selectedPatient, setSelectedPatient] = useState(null);
    const [alignerSets, setAlignerSets] = useState([]);
    const [expandedSets, setExpandedSets] = useState({});
    const [batchesData, setBatchesData] = useState({});
    const [notesData, setNotesData] = useState({});
    const [expandedCommunication, setExpandedCommunication] = useState({});
    const [loading, setLoading] = useState(false);

    // Search mode states
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [showResults, setShowResults] = useState(false);
    const [searchTimeout, setSearchTimeout] = useState(null);

    // Patient list filter (for filtering within doctor's patients)
    const [patientFilter, setPatientFilter] = useState('');

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


    // Load doctors on mount and check for workId URL parameter
    useEffect(() => {
        const loadDoctors = async () => {
            try {
                const response = await fetch('/api/aligner/doctors');
                const data = await response.json();

                if (data.success) {
                    setDoctors(data.doctors || []);
                }
            } catch (error) {
                console.error('Error loading doctors:', error);
            }
        };

        loadDoctors();

        // Check for workId URL parameter
        const urlParams = new URLSearchParams(window.location.search);
        const workId = urlParams.get('workId');

        if (workId) {
            // Load patient information from work
            loadPatientFromWork(parseInt(workId));
        }
    }, []);

    // Load patient and select them based on workId
    const loadPatientFromWork = async (workId) => {
        try {
            console.log('🔍 Loading patient from workId:', workId);
            setLoading(true);

            const response = await fetch(`/api/getwork/${workId}`);
            console.log('📥 Work response status:', response.status);
            const data = await response.json();
            console.log('📦 Work data:', data);

            if (data.success && data.work) {
                console.log('✅ Work found, PersonID:', data.work.PersonID);

                // Load patient info
                const patientResponse = await fetch(`/api/getpatient/${data.work.PersonID}`);
                console.log('📥 Patient response status:', patientResponse.status);
                const patientData = await patientResponse.json();
                console.log('📦 Patient data:', patientData);

                if (patientData) {
                    const patientWithWork = {
                        ...patientData,
                        workid: parseInt(workId)
                    };
                    console.log('👤 Setting patient:', patientWithWork);

                    // Manually set the patient and load sets (even if empty)
                    setViewMode('search');
                    setSelectedPatient(patientWithWork);

                    // Load aligner sets (will be empty for new work, that's OK)
                    console.log('📋 Loading aligner sets for workId:', workId);
                    await loadAlignerSets(parseInt(workId));
                    console.log('✅ Patient loaded successfully');
                }
            } else {
                console.error('❌ Work not found or invalid response');
            }
        } catch (error) {
            console.error('💥 Error loading work:', error);
            alert('Failed to load patient: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    // Load patients when doctor is selected in doctor mode
    const selectDoctor = async (doctor) => {
        setSelectedDoctor(doctor);
        setSelectedPatient(null);
        setAlignerSets([]);
        setPatients([]);

        if (!doctor) return;

        try {
            setLoading(true);

            // If "All Doctors" is selected (DrID === 'all'), fetch all patients
            const url = doctor.DrID === 'all'
                ? '/api/aligner/patients/all'
                : `/api/aligner/patients/by-doctor/${doctor.DrID}`;

            const response = await fetch(url);
            const data = await response.json();

            if (data.success) {
                setPatients(data.patients || []);
            } else {
                throw new Error(data.error || 'Failed to load patients');
            }
        } catch (error) {
            console.error('Error loading patients:', error);
            setPatients([]);
        } finally {
            setLoading(false);
        }
    };

    // Search mode - debounced search
    const handleSearchChange = (e) => {
        const query = e.target.value;
        setSearchQuery(query);

        if (searchTimeout) {
            clearTimeout(searchTimeout);
        }

        if (query.trim().length < 2) {
            setShowResults(false);
            return;
        }

        const timeout = setTimeout(() => {
            searchPatients(query);
        }, 300);

        setSearchTimeout(timeout);
    };

    const searchPatients = async (query) => {
        try {
            setLoading(true);
            const response = await fetch(`/api/aligner/patients?search=${encodeURIComponent(query)}`);
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to search patients');
            }

            setSearchResults(data.patients || []);
            setShowResults(true);
        } catch (error) {
            console.error('Search error:', error);
            setSearchResults([]);
        } finally {
            setLoading(false);
        }
    };

    // Select a patient (from either doctor browse or search)
    const selectPatient = async (patient) => {
        setSelectedPatient(patient);
        setShowResults(false);
        await loadAlignerSets(patient.workid);
    };

    // Load aligner sets for the selected patient
    const loadAlignerSets = async (workId) => {
        try {
            setLoading(true);
            const response = await fetch(`/api/aligner/sets/${workId}`);
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to load aligner sets');
            }

            const sets = data.sets || [];
            setAlignerSets(sets);

            // Auto-expand the active set with communication section
            const activeSet = sets.find(s => s.IsActive === true);
            if (activeSet) {
                const setId = activeSet.AlignerSetID;

                // Load batches and notes for the active set
                if (!batchesData[setId]) {
                    await loadBatches(setId);
                }
                if (!notesData[setId]) {
                    await loadNotes(setId, workId);
                }

                // Expand the active set and its communication section
                setExpandedSets(prev => ({ ...prev, [setId]: true }));
                setExpandedCommunication(prev => ({ ...prev, [setId]: true }));
            }
        } catch (error) {
            console.error('Error loading aligner sets:', error);
            alert('Failed to load aligner sets: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    // Toggle batches visibility
    const toggleBatches = async (setId) => {
        if (expandedSets[setId]) {
            setExpandedSets(prev => ({ ...prev, [setId]: false }));
            setExpandedCommunication(prev => ({ ...prev, [setId]: false }));
            return;
        }

        if (!batchesData[setId]) {
            await loadBatches(setId);
        }

        // Auto-expand communication section and load notes
        if (!notesData[setId]) {
            await loadNotes(setId, selectedPatient?.workid);
        }

        setExpandedSets(prev => ({ ...prev, [setId]: true }));
        setExpandedCommunication(prev => ({ ...prev, [setId]: true }));
    };

    // Load batches for a set
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

    // Load notes for a set
    const loadNotes = async (setId, workId = null, autoMarkRead = true) => {
        try {
            const response = await fetch(`/api/aligner/notes/${setId}`);
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to load notes');
            }

            setNotesData(prev => ({ ...prev, [setId]: data.notes || [] }));

            // Auto-mark unread doctor notes as read when viewing (only if autoMarkRead is true)
            if (autoMarkRead) {
                const unreadDoctorNotes = (data.notes || []).filter(note =>
                    note.NoteType === 'Doctor' && note.IsRead === false
                );

                if (unreadDoctorNotes.length > 0) {
                    // Mark all unread doctor notes as read
                    for (const note of unreadDoctorNotes) {
                        await markNoteAsRead(note.NoteID);
                    }
                    // Reload notes ONLY (not the whole sets) to get updated read status
                    await loadNotes(setId, workId, false); // false = don't auto-mark again (prevent loop)
                }
            }
        } catch (error) {
            console.error('Error loading notes:', error);
            setNotesData(prev => ({ ...prev, [setId]: [] }));
        }
    };

    // Mark a note as read (without toggling)
    const markNoteAsRead = async (noteId) => {
        try {
            // First check current status
            const checkResponse = await fetch(`/api/aligner/notes/${noteId}/status`);
            const checkData = await checkResponse.json();

            // Only toggle if it's currently unread
            if (checkData.success && checkData.isRead === false) {
                await fetch(`/api/aligner/notes/${noteId}/toggle-read`, {
                    method: 'PATCH'
                });
            }
        } catch (error) {
            console.error('Error marking note as read:', error);
        }
    };

    // Toggle note read/unread status
    const handleToggleNoteRead = async (noteId, setId) => {
        try {
            const response = await fetch(`/api/aligner/notes/${noteId}/toggle-read`, {
                method: 'PATCH'
            });
            const data = await response.json();

            if (data.success) {
                // Reload notes WITHOUT auto-marking (user is manually toggling)
                await loadNotes(setId, selectedPatient?.workid, false);
                if (selectedPatient?.workid) {
                    await loadAlignerSets(selectedPatient.workid); // Refresh to update highlighting
                }
            } else {
                throw new Error(data.error || 'Failed to toggle read status');
            }
        } catch (error) {
            console.error('Error toggling note read status:', error);
            alert('Error updating read status: ' + error.message);
        }
    };

    // Toggle communication section
    const toggleCommunication = async (setId) => {
        if (expandedCommunication[setId]) {
            setExpandedCommunication(prev => ({ ...prev, [setId]: false }));
            return;
        }

        if (!notesData[setId]) {
            await loadNotes(setId, selectedPatient?.workid);
        }

        setExpandedCommunication(prev => ({ ...prev, [setId]: true }));
    };

    // Go back to patients list
    const backToPatients = () => {
        setSelectedPatient(null);
        setAlignerSets([]);
        setExpandedSets({});
        setBatchesData({});
    };

    // Go back to doctor selection
    const backToDoctors = () => {
        setSelectedDoctor(null);
        setPatients([]);
        setSelectedPatient(null);
        setAlignerSets([]);
        setPatientFilter('');
    };

    // Filter patients based on search term
    const getFilteredPatients = () => {
        if (!patientFilter.trim()) {
            return patients;
        }

        const filterLower = patientFilter.toLowerCase().trim();
        return patients.filter(patient => {
            const patientName = (patient.PatientName || '').toLowerCase();
            const firstName = (patient.FirstName || '').toLowerCase();
            const lastName = (patient.LastName || '').toLowerCase();
            const phone = (patient.Phone || '').toLowerCase();
            const patientID = (patient.patientID || '').toLowerCase();
            const fullName = `${firstName} ${lastName}`.toLowerCase();

            return patientName.includes(filterLower) ||
                   firstName.includes(filterLower) ||
                   lastName.includes(filterLower) ||
                   fullName.includes(filterLower) ||
                   phone.includes(filterLower) ||
                   patientID.includes(filterLower);
        });
    };

    // Switch view mode
    const switchViewMode = (mode) => {
        setViewMode(mode);
        // Reset states
        setSelectedDoctor(null);
        setPatients([]);
        setSelectedPatient(null);
        setAlignerSets([]);
        setSearchQuery('');
        setSearchResults([]);
        setShowResults(false);
    };

    // Format date
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

    // Calculate progress
    const calculateProgress = (set) => {
        const delivered = set.UpperAlignersCount + set.LowerAlignersCount - set.RemainingUpperAligners - set.RemainingLowerAligners;
        const total = set.UpperAlignersCount + set.LowerAlignersCount;
        return total > 0 ? Math.round((delivered / total) * 100) : 0;
    };

    // Format patient name
    const formatPatientName = (patient) => {
        return patient.PatientName || `${patient.FirstName} ${patient.LastName}`;
    };

    // Generate folder path for aligner set
    const generateFolderPath = (set) => {
        if (!selectedPatient || !set) return null;

        const patientName = formatPatientName(selectedPatient).replace(/ /g, '_');
        const folderPath = `\\\\WORK_PC\\Aligner_Sets\\${set.AlignerDrID}\\${patientName}\\${set.SetSequence}`;

        return folderPath;
    };

    // ===== CRUD HANDLERS =====

    // Add new set
    const handleAddSet = () => {
        setEditingSet(null);
        setShowSetDrawer(true);
    };

    // Edit set
    const handleEditSet = (set, e) => {
        e.stopPropagation();
        setEditingSet(set);
        setShowSetDrawer(true);
    };

    // Delete set
    const handleDeleteSet = (set, e) => {
        e.stopPropagation();
        setConfirmDialog({
            isOpen: true,
            title: 'Delete Aligner Set',
            message: `Are you sure you want to delete Set #${set.SetSequence}? This will also delete all batches in this set. This action cannot be undone.`,
            onConfirm: async () => {
                try {
                    const response = await fetch(`/api/aligner/sets/${set.AlignerSetID}`, {
                        method: 'DELETE'
                    });
                    const result = await response.json();

                    if (result.success) {
                        await loadAlignerSets(selectedPatient.workid);
                        setConfirmDialog({ isOpen: false });
                    } else {
                        alert('Error: ' + (result.error || 'Failed to delete set'));
                    }
                } catch (error) {
                    console.error('Error deleting set:', error);
                    alert('Error deleting set: ' + error.message);
                }
            }
        });
    };

    // Save set (after form submission)
    const handleSaveSet = async () => {
        await loadAlignerSets(selectedPatient.workid);
    };

    // Add new batch
    const handleAddBatch = (set, e) => {
        e.stopPropagation();

        // Prevent adding batches to inactive sets
        if (!set.IsActive) {
            alert('Cannot add batches to inactive sets. Please activate the set first.');
            return;
        }

        setCurrentSetForBatch(set);
        setEditingBatch(null);
        setShowBatchDrawer(true);
    };

    // Edit batch
    const handleEditBatch = (batch, set, e) => {
        e.stopPropagation();
        setCurrentSetForBatch(set);
        setEditingBatch(batch);
        setShowBatchDrawer(true);
    };

    // Delete batch
    const handleDeleteBatch = (batch, e) => {
        e.stopPropagation();
        setConfirmDialog({
            isOpen: true,
            title: 'Delete Batch',
            message: `Are you sure you want to delete Batch #${batch.BatchSequence}? This action cannot be undone.`,
            onConfirm: async () => {
                try {
                    const response = await fetch(`/api/aligner/batches/${batch.AlignerBatchID}`, {
                        method: 'DELETE'
                    });
                    const result = await response.json();

                    if (result.success) {
                        await loadBatches(batch.AlignerSetID);
                        await loadAlignerSets(selectedPatient.workid);
                        setConfirmDialog({ isOpen: false });
                    } else {
                        alert('Error: ' + (result.error || 'Failed to delete batch'));
                    }
                } catch (error) {
                    console.error('Error deleting batch:', error);
                    alert('Error deleting batch: ' + error.message);
                }
            }
        });
    };

    // Mark batch as delivered
    const handleMarkDelivered = async (batch, e) => {
        e.stopPropagation();
        try {
            const response = await fetch(`/api/aligner/batches/${batch.AlignerBatchID}/deliver`, {
                method: 'PATCH'
            });
            const result = await response.json();

            if (result.success) {
                await loadBatches(batch.AlignerSetID);
                await loadAlignerSets(selectedPatient.workid);
            } else {
                alert('Error: ' + (result.error || 'Failed to mark as delivered'));
            }
        } catch (error) {
            console.error('Error marking as delivered:', error);
            alert('Error: ' + error.message);
        }
    };

    // Save batch (after form submission)
    const handleSaveBatch = async () => {
        if (currentSetForBatch) {
            await loadBatches(currentSetForBatch.AlignerSetID);
            await loadAlignerSets(selectedPatient.workid);
        }
    };

    // Handle adding payment
    const handleAddPayment = (set) => {
        setCurrentSetForPayment(set);
        setShowPaymentDrawer(true);
    };

    // Handle saving payment
    const handleSavePayment = async (paymentData) => {
        try {
            const response = await fetch('/api/aligner/payments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...paymentData,
                    workid: selectedPatient.workid,
                    AlignerSetID: currentSetForPayment.AlignerSetID
                })
            });

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to save payment');
            }

            // Reload sets to get updated payment info
            await loadAlignerSets(selectedPatient.workid);

            alert('Payment added successfully!');
        } catch (error) {
            console.error('Error saving payment:', error);
            throw error;
        }
    };

    // Handle PDF upload
    const handlePdfUpload = async (setId, file) => {
        if (!file) return;

        // Validate file type
        if (file.type !== 'application/pdf') {
            alert('Please select a PDF file');
            return;
        }

        // Validate file size (100MB max)
        if (file.size > 100 * 1024 * 1024) {
            alert('File is too large. Maximum size is 100MB.');
            return;
        }

        setUploadingPdf(prev => ({ ...prev, [setId]: true }));

        try {
            const formData = new FormData();
            formData.append('pdf', file);

            const response = await fetch(`/api/aligner/sets/${setId}/upload-pdf`, {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (data.success) {
                alert('PDF uploaded successfully!');
                // Reload sets to get updated PDF URL
                await loadAlignerSets(selectedPatient.workid);
            } else {
                throw new Error(data.error || 'Failed to upload PDF');
            }
        } catch (error) {
            console.error('Error uploading PDF:', error);
            alert(`Failed to upload PDF: ${error.message}`);
        } finally {
            setUploadingPdf(prev => ({ ...prev, [setId]: false }));
        }
    };

    // Handle PDF delete
    const handlePdfDelete = async (setId) => {
        if (!confirm('Are you sure you want to delete this PDF?')) {
            return;
        }

        try {
            const response = await fetch(`/api/aligner/sets/${setId}/pdf`, {
                method: 'DELETE'
            });

            const data = await response.json();

            if (data.success) {
                alert('PDF deleted successfully');
                // Reload sets to remove PDF URL
                await loadAlignerSets(selectedPatient.workid);
            } else {
                throw new Error(data.error || 'Failed to delete PDF');
            }
        } catch (error) {
            console.error('Error deleting PDF:', error);
            alert(`Failed to delete PDF: ${error.message}`);
        }
    };

    // Open folder - try to open directly or copy to clipboard
    const openSetFolder = async (set) => {
        const folderPath = generateFolderPath(set);

        if (!folderPath) {
            alert('Unable to generate folder path');
            return;
        }

        try {
            // For local paths (C:\, D:\, etc.), try to open using file:/// protocol
            const isLocalPath = /^[A-Za-z]:\\/.test(folderPath);

            if (isLocalPath) {
                // Convert backslashes to forward slashes for file:/// URL
                const fileUrl = 'file:///' + folderPath.replace(/\\/g, '/');

                // Try to open in a new window (File Explorer will handle it)
                const newWindow = window.open(fileUrl, '_blank');

                if (newWindow) {
                    // Also copy to clipboard as backup using the utility
                    await copyToClipboard(folderPath);
                    return;
                }
            }

            // For network paths or if opening failed, copy to clipboard using the utility
            const success = await copyToClipboard(folderPath);

            if (success) {
                // Show success message with instructions
                const message = `Folder path copied to clipboard!\n\n${folderPath}\n\n` +
                              `To open in File Explorer:\n` +
                              `1. Press Win+R (or Win+E)\n` +
                              `2. Paste (Ctrl+V) the path\n` +
                              `3. Press Enter\n\n` +
                              `If the folder doesn't exist, you'll be prompted to create it.`;

                alert(message);
            } else {
                // Fallback if clipboard utility fails
                const message = `Folder Path:\n\n${folderPath}\n\n` +
                              `Please copy this path and open it in File Explorer:\n` +
                              `1. Press Win+R (or Win+E)\n` +
                              `2. Paste the path above\n` +
                              `3. Press Enter`;

                alert(message);
            }

        } catch (error) {
            console.error('Error accessing folder:', error);

            // Fallback if everything fails
            const message = `Folder Path:\n\n${folderPath}\n\n` +
                          `Please copy this path and open it in File Explorer:\n` +
                          `1. Press Win+R (or Win+E)\n` +
                          `2. Paste the path above\n` +
                          `3. Press Enter`;

            alert(message);
        }
    };

    // Add lab note to communicate with doctor
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
                    NoteText: labNoteText.trim()
                })
            });

            const data = await response.json();
            console.log('Add note response:', data);

            if (data.success) {
                setLabNoteText('');
                setShowAddLabNote(prev => ({ ...prev, [setId]: false }));
                await loadNotes(setId, selectedPatient?.workid, false); // Don't auto-mark when adding notes
                alert('Note sent to doctor successfully!');
            } else {
                console.error('Server error:', data);
                throw new Error(data.error || data.message || 'Failed to add note');
            }
        } catch (error) {
            console.error('Error adding lab note:', error);
            alert('Failed to send note: ' + error.message);
        }
    };

    // Start editing a note
    const handleStartEditNote = (note) => {
        setEditingNoteId(note.NoteID);
        setEditNoteText(note.NoteText);
    };

    // Cancel editing
    const handleCancelEditNote = () => {
        setEditingNoteId(null);
        setEditNoteText('');
    };

    // Save edited note
    const handleSaveEditNote = async (noteId, setId) => {
        if (!editNoteText.trim()) {
            alert('Please enter note text');
            return;
        }

        try {
            const response = await fetch(`/api/aligner/notes/${noteId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    NoteText: editNoteText.trim()
                })
            });

            const data = await response.json();

            if (data.success) {
                setEditingNoteId(null);
                setEditNoteText('');
                await loadNotes(setId, selectedPatient?.workid, false); // Don't auto-mark when editing notes
                alert('Note updated successfully!');
            } else {
                throw new Error(data.error || 'Failed to update note');
            }
        } catch (error) {
            console.error('Error updating note:', error);
            alert('Failed to update note: ' + error.message);
        }
    };

    // Delete a note
    const handleDeleteNote = (noteId, setId) => {
        setConfirmDialog({
            isOpen: true,
            title: 'Delete Note',
            message: 'Are you sure you want to delete this note? This action cannot be undone.',
            onConfirm: async () => {
                try {
                    const response = await fetch(`/api/aligner/notes/${noteId}`, {
                        method: 'DELETE'
                    });

                    const data = await response.json();

                    if (data.success) {
                        await loadNotes(setId, selectedPatient?.workid, false); // Don't auto-mark when deleting notes
                        setConfirmDialog({ isOpen: false });
                        alert('Note deleted successfully!');
                    } else {
                        throw new Error(data.error || 'Failed to delete note');
                    }
                } catch (error) {
                    console.error('Error deleting note:', error);
                    alert('Failed to delete note: ' + error.message);
                }
            }
        });
    };

    // Close search results when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (!e.target.closest('.search-section')) {
                setShowResults(false);
            }
        };

        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, []);

    return (
        <div className="container">
            {/* View Mode Toggle */}
            <div className="view-mode-toggle">
                <button
                    className={`mode-btn ${viewMode === 'doctor' ? 'active' : ''}`}
                    onClick={() => switchViewMode('doctor')}
                >
                    <i className="fas fa-user-md"></i>
                    Browse by Doctor
                </button>
                <button
                    className={`mode-btn ${viewMode === 'search' ? 'active' : ''}`}
                    onClick={() => switchViewMode('search')}
                >
                    <i className="fas fa-search"></i>
                    Quick Search
                </button>
            </div>

            {/* DOCTOR BROWSE MODE */}
            {viewMode === 'doctor' && (
                <>
                    {/* Show aligner sets if patient selected */}
                    {selectedPatient ? (
                        <>
                            {/* Breadcrumb Navigation */}
                            <div className="breadcrumb">
                                <button onClick={backToDoctors} className="breadcrumb-link">
                                    <i className="fas fa-user-md"></i>
                                    {selectedDoctor?.DoctorName}
                                </button>
                                <i className="fas fa-chevron-right"></i>
                                <button onClick={backToPatients} className="breadcrumb-link">
                                    <i className="fas fa-users"></i>
                                    Patients ({patients.length})
                                </button>
                                <i className="fas fa-chevron-right"></i>
                                <span className="breadcrumb-current">
                                    {formatPatientName(selectedPatient)}
                                </span>
                            </div>

                            {/* Patient Info Header */}
                            <div className="patient-info">
                                <div className="patient-header">
                                    <div className="patient-details">
                                        <h2>
                                            {formatPatientName(selectedPatient)}
                                            {selectedPatient.PatientName && selectedPatient.FirstName && (
                                                <span className="patient-subtitle">
                                                    ({selectedPatient.FirstName} {selectedPatient.LastName})
                                                </span>
                                            )}
                                        </h2>
                                        <div className="patient-meta">
                                            <span><i className="fas fa-id-card"></i> {selectedPatient.patientID || 'N/A'}</span>
                                            <span><i className="fas fa-phone"></i> {selectedPatient.Phone || 'N/A'}</span>
                                            <span><i className="fas fa-tooth"></i> {selectedPatient.WorkType}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Aligner Sets */}
                            {renderAlignerSets()}
                        </>
                    ) : selectedDoctor ? (
                        /* Show patients list if doctor selected */
                        <>
                            <div className="breadcrumb">
                                <button onClick={backToDoctors} className="breadcrumb-link">
                                    <i className="fas fa-arrow-left"></i>
                                    Back to Doctors
                                </button>
                            </div>

                            <div className="section-header">
                                <h2>
                                    <i className="fas fa-user-md"></i>
                                    {selectedDoctor.DoctorName}'s Patients
                                </h2>
                                <div className="section-info">
                                    <span>{patients.length} patient{patients.length !== 1 ? 's' : ''}</span>
                                </div>
                            </div>

                            {/* Patient Filter Search */}
                            {patients.length > 0 && (
                                <div className="patient-filter-box">
                                    <i className="fas fa-filter filter-icon"></i>
                                    <input
                                        type="text"
                                        placeholder="Filter patients by name, phone, or ID..."
                                        value={patientFilter}
                                        onChange={(e) => setPatientFilter(e.target.value)}
                                    />
                                    {patientFilter && (
                                        <button
                                            className="clear-filter-btn"
                                            onClick={() => setPatientFilter('')}
                                        >
                                            <i className="fas fa-times"></i>
                                        </button>
                                    )}
                                    {patientFilter && (
                                        <span className="filter-count">
                                            {getFilteredPatients().length} of {patients.length}
                                        </span>
                                    )}
                                </div>
                            )}

                            {loading ? (
                                <div className="loading">
                                    <div className="spinner"></div>
                                    <p>Loading patients...</p>
                                </div>
                            ) : patients.length === 0 ? (
                                <div className="empty-state">
                                    <i className="fas fa-user-slash"></i>
                                    <h3>No Patients Found</h3>
                                    <p>This doctor has no aligner patients yet.</p>
                                </div>
                            ) : getFilteredPatients().length === 0 ? (
                                <div className="empty-state">
                                    <i className="fas fa-search"></i>
                                    <h3>No Matching Patients</h3>
                                    <p>No patients match your filter: "{patientFilter}"</p>
                                    <button
                                        className="btn-clear"
                                        onClick={() => setPatientFilter('')}
                                        style={{ marginTop: '1rem' }}
                                    >
                                        Clear Filter
                                    </button>
                                </div>
                            ) : (
                                <div className="patients-grid">
                                    {getFilteredPatients().map((patient) => (
                                        <div
                                            key={patient.PersonID}
                                            className={`patient-card ${patient.UnreadDoctorNotes > 0 ? 'has-activity' : ''}`}
                                            onClick={() => selectPatient(patient)}
                                        >
                                            {patient.UnreadDoctorNotes > 0 && (
                                                <div className="activity-banner">
                                                    <i className="fas fa-bell"></i>
                                                    <strong>{patient.UnreadDoctorNotes}</strong> unread {patient.UnreadDoctorNotes === 1 ? 'note' : 'notes'}
                                                </div>
                                            )}
                                            <div className="patient-card-header">
                                                <div className="patient-card-photo">
                                                    <img
                                                        src={`/DolImgs/${patient.PersonID}00.i13`}
                                                        alt={`${formatPatientName(patient)} - Smile`}
                                                        onError={(e) => {
                                                            e.target.style.display = 'none';
                                                            e.target.nextElementSibling.style.display = 'flex';
                                                        }}
                                                    />
                                                    <div className="patient-photo-placeholder" style={{ display: 'none' }}>
                                                        <i className="fas fa-user"></i>
                                                    </div>
                                                </div>
                                                <div>
                                                    <h3>{formatPatientName(patient)}</h3>
                                                    {patient.PatientName && patient.FirstName && (
                                                        <p className="patient-card-subtitle">
                                                            {patient.FirstName} {patient.LastName}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="patient-card-meta">
                                                <span><i className="fas fa-id-card"></i> {patient.patientID || 'N/A'}</span>
                                                <span><i className="fas fa-phone"></i> {patient.Phone || 'N/A'}</span>
                                            </div>
                                            <div className="patient-card-stats">
                                                <div className="stat">
                                                    <i className="fas fa-box"></i>
                                                    <span>{patient.TotalSets || 0} Sets</span>
                                                </div>
                                                <div className="stat active">
                                                    <i className="fas fa-check-circle"></i>
                                                    <span>{patient.ActiveSets || 0} Active</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    ) : (
                        /* Show doctor selection */
                        <>
                            <div className="section-header">
                                <h2>
                                    <i className="fas fa-user-md"></i>
                                    Select a Doctor
                                </h2>
                                <div className="section-info">
                                    <span>{doctors.length} doctor{doctors.length !== 1 ? 's' : ''}</span>
                                    <a
                                        href="/settings?tab=alignerDoctors"
                                        className="btn-link"
                                        style={{
                                            marginLeft: '1rem',
                                            padding: '0.5rem 1rem',
                                            backgroundColor: '#2563eb',
                                            color: 'white',
                                            borderRadius: '6px',
                                            textDecoration: 'none',
                                            fontSize: '0.875rem',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '0.5rem',
                                            transition: 'background-color 0.2s'
                                        }}
                                        onMouseEnter={(e) => e.target.style.backgroundColor = '#1d4ed8'}
                                        onMouseLeave={(e) => e.target.style.backgroundColor = '#2563eb'}
                                        title="Manage aligner doctors and portal access"
                                    >
                                        <i className="fas fa-cog"></i>
                                        Manage Doctors
                                    </a>
                                </div>
                            </div>

                            <div className="doctors-grid">
                                {/* All Doctors Card */}
                                <div
                                    className="doctor-card all-doctors"
                                    onClick={() => selectDoctor({ DrID: 'all', DoctorName: 'All Doctors' })}
                                >
                                    <i className="fas fa-users doctor-icon"></i>
                                    <h3>All Doctors</h3>
                                    <span className="doctor-subtitle">View all patients</span>
                                    <i className="fas fa-chevron-right arrow-icon"></i>
                                </div>

                                {/* Individual Doctor Cards */}
                                {doctors.map((doctor) => (
                                    <div
                                        key={doctor.DrID}
                                        className={`doctor-card ${doctor.UnreadDoctorNotes > 0 ? 'has-activity' : ''}`}
                                        onClick={() => selectDoctor(doctor)}
                                    >
                                        {doctor.UnreadDoctorNotes > 0 && (
                                            <div className="activity-banner">
                                                <i className="fas fa-bell"></i>
                                                <strong>{doctor.UnreadDoctorNotes}</strong> unread {doctor.UnreadDoctorNotes === 1 ? 'note' : 'notes'}
                                            </div>
                                        )}
                                        <i className="fas fa-user-md doctor-icon"></i>
                                        <h3>{doctor.DoctorName}</h3>
                                        <i className="fas fa-chevron-right arrow-icon"></i>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </>
            )}

            {/* SEARCH MODE */}
            {viewMode === 'search' && (
                <>
                    {selectedPatient ? (
                        <>
                            {/* Breadcrumb */}
                            <div className="breadcrumb">
                                <button onClick={backToPatients} className="breadcrumb-link">
                                    <i className="fas fa-arrow-left"></i>
                                    Back to Search
                                </button>
                            </div>

                            {/* Patient Info */}
                            <div className="patient-info">
                                <div className="patient-header">
                                    <div className="patient-details">
                                        <h2>
                                            {formatPatientName(selectedPatient)}
                                            {selectedPatient.PatientName && selectedPatient.FirstName && (
                                                <span className="patient-subtitle">
                                                    ({selectedPatient.FirstName} {selectedPatient.LastName})
                                                </span>
                                            )}
                                        </h2>
                                        <div className="patient-meta">
                                            <span><i className="fas fa-id-card"></i> {selectedPatient.patientID || 'N/A'}</span>
                                            <span><i className="fas fa-phone"></i> {selectedPatient.Phone || 'N/A'}</span>
                                            <span><i className="fas fa-tooth"></i> {selectedPatient.WorkType}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Aligner Sets */}
                            {renderAlignerSets()}
                        </>
                    ) : (
                        /* Search Box */
                        <div className="search-section">
                            <div className="search-box">
                                <i className="fas fa-search search-icon"></i>
                                <input
                                    type="text"
                                    id="patient-search"
                                    placeholder="Search aligner patients by name, phone, or patient ID..."
                                    autoComplete="off"
                                    value={searchQuery}
                                    onChange={handleSearchChange}
                                />
                                <span className="search-info">Minimum 2 characters</span>
                            </div>

                            {/* Search Results */}
                            {showResults && (
                                <div className="search-results">
                                    {searchResults.length === 0 ? (
                                        <div className="search-no-results">
                                            <i className="fas fa-user-slash"></i>
                                            <p>No aligner patients found</p>
                                        </div>
                                    ) : (
                                        searchResults.map((patient, index) => (
                                            <div
                                                key={index}
                                                className="search-result-item"
                                                onClick={() => selectPatient(patient)}
                                            >
                                                <div className="result-name">
                                                    {formatPatientName(patient)}
                                                    {patient.PatientName && patient.FirstName && (
                                                        <span className="result-name-secondary">
                                                            ({patient.FirstName} {patient.LastName})
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="result-meta">
                                                    <span><i className="fas fa-id-card"></i> {patient.patientID || 'N/A'}</span>
                                                    <span><i className="fas fa-phone"></i> {patient.Phone || 'N/A'}</span>
                                                    <span><i className="fas fa-tooth"></i> {patient.WorkType}</span>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}

                            {/* Empty State */}
                            {!loading && !showResults && (
                                <div className="empty-state">
                                    <i className="fas fa-search"></i>
                                    <h3>Quick Search</h3>
                                    <p>Enter a patient name, phone number, or ID to find their aligner records</p>
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}

            {/* Loading State */}
            {loading && !selectedPatient && !patients.length && (
                <div className="loading">
                    <div className="spinner"></div>
                    <p>Loading...</p>
                </div>
            )}

            {/* Dialogs and Drawers */}
            <ConfirmDialog
                isOpen={confirmDialog.isOpen}
                title={confirmDialog.title}
                message={confirmDialog.message}
                onConfirm={confirmDialog.onConfirm}
                onCancel={() => setConfirmDialog({ isOpen: false })}
                isDangerous={true}
            />

            <SetFormDrawer
                isOpen={showSetDrawer}
                onClose={() => {
                    setShowSetDrawer(false);
                    setEditingSet(null);
                }}
                onSave={handleSaveSet}
                set={editingSet}
                workId={selectedPatient?.workid}
                doctors={doctors}
                allSets={alignerSets}
            />

            <BatchFormDrawer
                isOpen={showBatchDrawer}
                onClose={() => {
                    setShowBatchDrawer(false);
                    setEditingBatch(null);
                    setCurrentSetForBatch(null);
                }}
                onSave={handleSaveBatch}
                batch={editingBatch}
                set={currentSetForBatch}
                existingBatches={currentSetForBatch ? (batchesData[currentSetForBatch.AlignerSetID] || []) : []}
            />

            <PaymentFormDrawer
                isOpen={showPaymentDrawer}
                onClose={() => {
                    setShowPaymentDrawer(false);
                    setCurrentSetForPayment(null);
                }}
                onSave={handleSavePayment}
                set={currentSetForPayment}
                workInfo={selectedPatient}
            />
        </div>
    );

    // Render aligner sets (shared between both modes)
    function renderAlignerSets() {
        return (
            <div className="aligner-sets-container">
                <div className="section-header">
                    <h3>Aligner Sets</h3>
                    <div className="section-info">
                        <span>{alignerSets.length} set{alignerSets.length !== 1 ? 's' : ''}</span>
                        <button className="fab-button" onClick={handleAddSet} title="Add New Set">
                            <i className="fas fa-plus"></i>
                        </button>
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

                            // DEBUG: Log highlighting status
                            if (set.UnreadActivityCount > 0) {
                                console.log('🎨 [FRONTEND] Applying has-activity class to set:', {
                                    SetID: set.AlignerSetID,
                                    SetSequence: set.SetSequence,
                                    UnreadCount: set.UnreadActivityCount
                                });
                            }

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
                                                    onClick={(e) => handleEditSet(set, e)}
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
                                                        handleAddPayment(set);
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
                                                    onClick={(e) => handleAddBatch(set, e)}
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
                                                                        onClick={(e) => handleEditBatch(batch, set, e)}
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
                                                                                        onClick={() => handleSaveEditNote(note.NoteID, set.AlignerSetID)}
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
        );
    }
};

export default AlignerComponent;
