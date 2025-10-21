/**
 * Aligner Portal Component - Supabase Version
 * This version connects directly to Supabase PostgreSQL instead of Express API
 */

import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'your-anon-key';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const AlignerPortalSupabase = () => {
    // State management
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [doctor, setDoctor] = useState(null);
    const [cases, setCases] = useState([]);
    const [selectedCase, setSelectedCase] = useState(null);
    const [sets, setSets] = useState([]);
    const [batches, setBatches] = useState({});
    const [notes, setNotes] = useState({});
    const [expandedSets, setExpandedSets] = useState({});
    const [searchQuery, setSearchQuery] = useState('');
    const [showAddNote, setShowAddNote] = useState({});
    const [noteText, setNoteText] = useState('');

    // Get doctor email from Cloudflare Access header or query param
    const getDoctorEmail = () => {
        // Try query param first (for testing)
        const params = new URLSearchParams(window.location.search);
        const emailParam = params.get('email');
        if (emailParam) return emailParam;

        // In production, Cloudflare Access will inject this
        // We'll need to pass it from server-side rendering or API
        return sessionStorage.getItem('doctor_email');
    };

    // Load doctor info on mount
    useEffect(() => {
        loadDoctorAuth();
    }, []);

    // Load doctor authentication
    const loadDoctorAuth = async () => {
        try {
            const email = getDoctorEmail();
            if (!email) {
                setError('No doctor email found. Please check authentication.');
                setLoading(false);
                return;
            }

            // Query Supabase for doctor
            const { data, error: queryError } = await supabase
                .from('aligner_doctors')
                .select('*')
                .eq('doctor_email', email.toLowerCase())
                .single();

            if (queryError || !data) {
                setError('Doctor not found or not authorized for portal access.');
                setLoading(false);
                return;
            }

            setDoctor(data);
            await loadCases(data.dr_id);

        } catch (error) {
            console.error('Error loading doctor auth:', error);
            setError('Failed to authenticate. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    // Load all cases for this doctor
    const loadCases = async (drId) => {
        try {
            // Complex query to get cases with active set info and payment summary
            // Using Supabase RPC (stored procedure) for complex joins
            const { data, error: queryError } = await supabase
                .rpc('get_doctor_cases', { doctor_id: drId });

            if (queryError) {
                throw queryError;
            }

            setCases(data || []);

        } catch (error) {
            console.error('Error loading cases:', error);
            setError('Failed to load cases');
        }
    };

    // Load sets for a specific case
    const loadSets = async (workId) => {
        try {
            const { data, error: queryError } = await supabase
                .from('aligner_sets')
                .select(`
                    *,
                    aligner_batches (count),
                    aligner_set_payments (*)
                `)
                .eq('work_id', workId)
                .eq('aligner_dr_id', doctor.dr_id)
                .order('set_sequence');

            if (queryError) throw queryError;

            setSets(data || []);

            // Auto-expand the active set
            const activeSet = data?.find(set => set.is_active);
            if (activeSet) {
                await loadBatches(activeSet.aligner_set_id);
                await loadNotes(activeSet.aligner_set_id);
                setExpandedSets(prev => ({ ...prev, [activeSet.aligner_set_id]: true }));
            }

        } catch (error) {
            console.error('Error loading sets:', error);
            alert('Failed to load aligner sets');
        }
    };

    // Load batches for a set
    const loadBatches = async (setId) => {
        try {
            const { data, error: queryError } = await supabase
                .from('aligner_batches')
                .select('*')
                .eq('aligner_set_id', setId)
                .order('batch_sequence');

            if (queryError) throw queryError;

            setBatches(prev => ({ ...prev, [setId]: data || [] }));

        } catch (error) {
            console.error('Error loading batches:', error);
            alert('Failed to load batches');
        }
    };

    // Load notes for a set
    const loadNotes = async (setId) => {
        try {
            const { data, error: queryError } = await supabase
                .from('aligner_notes')
                .select(`
                    *,
                    aligner_sets!inner (
                        aligner_doctors (doctor_name)
                    )
                `)
                .eq('aligner_set_id', setId)
                .order('created_at', { ascending: false });

            if (queryError) throw queryError;

            setNotes(prev => ({ ...prev, [setId]: data || [] }));

        } catch (error) {
            console.error('Error loading notes:', error);
            alert('Failed to load notes');
        }
    };

    // Toggle set expansion
    const toggleSet = async (setId) => {
        if (expandedSets[setId]) {
            setExpandedSets(prev => ({ ...prev, [setId]: false }));
        } else {
            if (!batches[setId]) {
                await loadBatches(setId);
            }
            if (!notes[setId]) {
                await loadNotes(setId);
            }
            setExpandedSets(prev => ({ ...prev, [setId]: true }));
        }
    };

    // Select a case to view details
    const selectCase = async (caseData) => {
        setSelectedCase(caseData);
        await loadSets(caseData.work_id);
    };

    // Go back to cases list
    const backToCases = () => {
        setSelectedCase(null);
        setSets([]);
        setBatches({});
        setNotes({});
        setExpandedSets({});
    };

    // Update days per aligner
    const updateDays = async (batchId, newDays) => {
        try {
            const { error: updateError } = await supabase
                .from('aligner_batches')
                .update({ days: newDays })
                .eq('aligner_batch_id', batchId);

            if (updateError) throw updateError;

            // Reload batches to get updated computed values
            const batch = Object.values(batches)
                .flat()
                .find(b => b.aligner_batch_id === batchId);

            if (batch) {
                await loadBatches(batch.aligner_set_id);
            }

            alert('Days per aligner updated successfully');

        } catch (error) {
            console.error('Error updating days:', error);
            alert('Failed to update days per aligner');
        }
    };

    // Add a note
    const addNote = async (setId) => {
        if (!noteText.trim()) {
            alert('Please enter a note');
            return;
        }

        try {
            const { error: insertError } = await supabase
                .from('aligner_notes')
                .insert({
                    aligner_set_id: setId,
                    note_type: 'Doctor',
                    note_text: noteText.trim()
                });

            if (insertError) throw insertError;

            setNoteText('');
            setShowAddNote(prev => ({ ...prev, [setId]: false }));
            await loadNotes(setId);

        } catch (error) {
            console.error('Error adding note:', error);
            alert('Failed to add note');
        }
    };

    // Subscribe to real-time updates for notes (optional)
    useEffect(() => {
        if (!doctor) return;

        // Subscribe to new notes for this doctor's sets
        const subscription = supabase
            .channel('aligner_notes_changes')
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'aligner_notes'
            }, (payload) => {
                console.log('New note received:', payload);
                // Refresh notes for the affected set
                if (payload.new.aligner_set_id) {
                    loadNotes(payload.new.aligner_set_id);
                }
            })
            .subscribe();

        return () => {
            subscription.unsubscribe();
        };
    }, [doctor]);

    // Logout via Cloudflare Access
    const handleLogout = () => {
        window.location.href = '/cdn-cgi/access/logout';
    };

    // Format date
    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    };

    // Format datetime for notes
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

    // Rest of the component is identical to original...
    // (Using same UI rendering logic from AlignerPortalComponent.jsx)

    // For brevity, I'll note that the render logic remains the same
    // Just replace the data source from Express API to Supabase

    if (loading) {
        return (
            <div className="portal-container">
                <div className="loading-container">
                    <div className="spinner"></div>
                    <p>Loading portal...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="portal-container">
                <div className="error-container">
                    <i className="fas fa-exclamation-triangle"></i>
                    <h2>Authentication Error</h2>
                    <p>{error}</p>
                    <button className="logout-btn" onClick={handleLogout}>
                        <i className="fas fa-sign-out-alt"></i>
                        Logout
                    </button>
                </div>
            </div>
        );
    }

    // ... (rest of the render logic remains identical to original component)
    return (
        <div className="portal-container">
            {/* Use same JSX as original AlignerPortalComponent */}
            <p>Portal UI goes here (same as original component)</p>
        </div>
    );
};

export default AlignerPortalSupabase;
