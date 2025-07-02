/**
 * VisitsComponent - Patient visit history display and management
 * 
 * Provides full CRUD operations for patient visits with wire tracking
 */

import React, { useState, useEffect } from 'react'

const VisitsComponent = ({ patientId }) => {
    const [visits, setVisits] = useState([]);
    const [wireOptions, setWireOptions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [editingVisit, setEditingVisit] = useState(null);
    const [formData, setFormData] = useState({
        VID: '',
        PID: patientId,
        visitDate: new Date().toISOString().substring(0, 10),
        upperWire: '',
        lowerWire: '',
        others: '',
        next: ''
    });
    
    useEffect(() => {
        loadVisitsData();
        loadWireOptions();
    }, [patientId]);
    
    const loadVisitsData = async () => {
        try {
            setLoading(true);
            console.log('Loading visits for patient:', patientId);
            
            const response = await fetch(`/api/visitsSummary?PID=${patientId}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const visitsData = await response.json();
            console.log('Visits received:', visitsData);
            setVisits(visitsData);
        } catch (err) {
            console.error('Error loading visits:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };
    
    const loadWireOptions = async () => {
        try {
            const response = await fetch('/api/getWires');
            if (!response.ok) {
                throw new Error(`Failed to load wire options`);
            }
            
            const wires = await response.json();
            setWireOptions(wires);
        } catch (err) {
            console.error('Error loading wire options:', err);
            // Continue without wire options
        }
    };
    
    const openAddModal = async () => {
        // Reset form
        setFormData({
            VID: '',
            PID: patientId,
            visitDate: new Date().toISOString().substring(0, 10),
            upperWire: '',
            lowerWire: '',
            others: '',
            next: ''
        });
        
        // Try to get latest wire
        try {
            const response = await fetch(`/api/getLatestwire?PID=${patientId}`);
            if (response.ok) {
                const latestWire = await response.json();
                setFormData(prev => ({
                    ...prev,
                    upperWire: latestWire.upperWireID || '',
                    lowerWire: latestWire.lowerWireID || ''
                }));
            }
        } catch (err) {
            console.error('Error loading latest wire:', err);
        }
        
        setEditingVisit(null);
        setShowModal(true);
    };
    
    const openEditModal = async (visitId) => {
        try {
            const response = await fetch(`/api/getVisitDetailsByID?VID=${visitId}`);
            if (!response.ok) {
                throw new Error('Failed to load visit details');
            }
            
            const visit = await response.json();
            setFormData({
                VID: visitId,
                PID: patientId,
                visitDate: new Date(visit.visitDate).toISOString().slice(0, 10),
                upperWire: visit.upperWireID || '',
                lowerWire: visit.lowerWireID || '',
                others: visit.others || '',
                next: visit.next || ''
            });
            
            setEditingVisit(visitId);
            setShowModal(true);
        } catch (err) {
            console.error('Error loading visit details:', err);
            alert('Failed to load visit details');
        }
    };
    
    const handleSubmit = async (e) => {
        e.preventDefault();
        
        try {
            const endpoint = editingVisit ? '/api/updateVisit' : '/api/addVisit';
            const method = editingVisit ? 'PUT' : 'POST';
            
            const response = await fetch(endpoint, {
                method: method,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });
            
            const result = await response.json();
            
            if (result.status === 'success') {
                alert(editingVisit ? 'Visit updated successfully!' : 'Visit added successfully!');
                setShowModal(false);
                await loadVisitsData();
            } else {
                alert(result.message || 'Error saving visit');
            }
        } catch (err) {
            console.error('Error saving visit:', err);
            alert('Error saving visit');
        }
    };
    
    const handleDelete = async (visitId) => {
        if (!confirm('Are you sure you want to delete this visit?')) {
            return;
        }
        
        try {
            const response = await fetch('/api/deleteVisit', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ VID: visitId })
            });
            
            const result = await response.json();
            
            if (result.status === 'success') {
                alert('Visit deleted successfully!');
                await loadVisitsData();
            } else {
                alert('Error deleting visit');
            }
        } catch (err) {
            console.error('Error deleting visit:', err);
            alert('Error deleting visit');
        }
    };
    
    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };
    
    if (loading) {
        return (
            <div className="loading-spinner">
                Loading visits...
            </div>
        );
    }
    
    if (error) {
        return (
            <div className="error-message">
                Error: {error}
            </div>
        );
    }
    
    console.log('🎯 Visits Component Rendering:', { patientId, visitsCount: visits.length });
    
    return (
        <div style={{ padding: '20px' }}>
            <h1>Visits Summary</h1>
            
            <button
                onClick={openAddModal}
                style={{ 
                    marginBottom: '20px',
                    backgroundColor: '#28a745',
                    color: 'white',
                    border: 'none',
                    padding: '10px 20px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '14px'
                }}
            >
                Add Visit
            </button>
            
            {/* Visits table */}
            {visits.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px' }}>
                    No visits found for this patient.
                </div>
            ) : (
                <table style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    marginBottom: '20px'
                }}>
                    <thead>
                        <tr style={{ backgroundColor: '#f8f9fa' }}>
                            <th style={{
                                border: '1px solid #dee2e6',
                                padding: '12px',
                                textAlign: 'left'
                            }}>
                                Visit Date
                            </th>
                            <th style={{
                                border: '1px solid #dee2e6',
                                padding: '12px',
                                textAlign: 'left'
                            }}>
                                Summary
                            </th>
                            <th style={{
                                border: '1px solid #dee2e6',
                                padding: '12px',
                                textAlign: 'center',
                                width: '150px'
                            }}>
                                Actions
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {visits.map((visit, index) => (
                            <tr 
                                key={index}
                                style={index % 2 === 0 ? { backgroundColor: '#f8f9fa' } : {}}
                            >
                                <td style={{
                                    border: '1px solid #dee2e6',
                                    padding: '12px'
                                }}>
                                    {new Date(visit.VisitDate).toLocaleDateString()}
                                </td>
                                <td 
                                    style={{
                                        border: '1px solid #dee2e6',
                                        padding: '12px'
                                    }}
                                    dangerouslySetInnerHTML={{ __html: visit.Summary || 'No summary' }}
                                />
                                <td style={{
                                    border: '1px solid #dee2e6',
                                    padding: '12px',
                                    textAlign: 'center'
                                }}>
                                    <button
                                        onClick={() => openEditModal(visit.ID)}
                                        style={{ 
                                            marginRight: '5px',
                                            backgroundColor: '#007bff',
                                            color: 'white',
                                            border: 'none',
                                            padding: '5px 10px',
                                            borderRadius: '3px',
                                            cursor: 'pointer',
                                            fontSize: '12px'
                                        }}
                                    >
                                        Edit
                                    </button>
                                    <button
                                        onClick={() => handleDelete(visit.ID)}
                                        style={{
                                            backgroundColor: '#dc3545',
                                            color: 'white',
                                            border: 'none',
                                            padding: '5px 10px',
                                            borderRadius: '3px',
                                            cursor: 'pointer',
                                            fontSize: '12px'
                                        }}
                                    >
                                        Delete
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            
            {/* Modal */}
            {showModal && (
                <div style={{
                    position: 'fixed',
                    zIndex: 1000,
                    left: 0,
                    top: 0,
                    width: '100%',
                    height: '100%',
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    <div style={{
                        backgroundColor: 'white',
                        padding: '30px',
                        borderRadius: '8px',
                        width: '90%',
                        maxWidth: '500px',
                        maxHeight: '90vh',
                        overflow: 'auto',
                        position: 'relative'
                    }}>
                        <span
                            onClick={() => setShowModal(false)}
                            style={{
                                position: 'absolute',
                                right: '15px',
                                top: '15px',
                                fontSize: '28px',
                                fontWeight: 'bold',
                                cursor: 'pointer',
                                color: '#aaa'
                            }}
                        >
                            ×
                        </span>
                        
                        <form
                            onSubmit={handleSubmit}
                            style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}
                        >
                            <h2 style={{ margin: '0 0 20px 0' }}>
                                {editingVisit ? 'Edit Visit' : 'Add Visit'}
                            </h2>
                            
                            <div>
                                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                                    Visit Date:
                                </label>
                                <input
                                    type="date"
                                    name="visitDate"
                                    value={formData.visitDate}
                                    onChange={handleInputChange}
                                    required
                                    style={{
                                        width: '100%',
                                        padding: '8px',
                                        border: '1px solid #ddd',
                                        borderRadius: '4px'
                                    }}
                                />
                            </div>
                            
                            <div>
                                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                                    Upper Wire:
                                </label>
                                <select
                                    name="upperWire"
                                    value={formData.upperWire}
                                    onChange={handleInputChange}
                                    style={{
                                        width: '100%',
                                        padding: '8px',
                                        border: '1px solid #ddd',
                                        borderRadius: '4px'
                                    }}
                                >
                                    <option value="">Select Wire</option>
                                    {wireOptions.map(wire => (
                                        <option key={wire.id} value={wire.id}>
                                            {wire.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            
                            <div>
                                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                                    Lower Wire:
                                </label>
                                <select
                                    name="lowerWire"
                                    value={formData.lowerWire}
                                    onChange={handleInputChange}
                                    style={{
                                        width: '100%',
                                        padding: '8px',
                                        border: '1px solid #ddd',
                                        borderRadius: '4px'
                                    }}
                                >
                                    <option value="">Select Wire</option>
                                    {wireOptions.map(wire => (
                                        <option key={wire.id} value={wire.id}>
                                            {wire.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            
                            <div>
                                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                                    Others:
                                </label>
                                <textarea
                                    name="others"
                                    value={formData.others}
                                    onChange={handleInputChange}
                                    rows={3}
                                    style={{
                                        width: '100%',
                                        padding: '8px',
                                        border: '1px solid #ddd',
                                        borderRadius: '4px',
                                        resize: 'vertical'
                                    }}
                                />
                            </div>
                            
                            <div>
                                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                                    Next:
                                </label>
                                <textarea
                                    name="next"
                                    value={formData.next}
                                    onChange={handleInputChange}
                                    rows={3}
                                    style={{
                                        width: '100%',
                                        padding: '8px',
                                        border: '1px solid #ddd',
                                        borderRadius: '4px',
                                        resize: 'vertical'
                                    }}
                                />
                            </div>
                            
                            <button
                                type="submit"
                                style={{
                                    backgroundColor: '#28a745',
                                    color: 'white',
                                    border: 'none',
                                    padding: '12px 24px',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '16px',
                                    marginTop: '10px'
                                }}
                            >
                                {editingVisit ? 'Update Visit' : 'Add Visit'}
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default VisitsComponent;