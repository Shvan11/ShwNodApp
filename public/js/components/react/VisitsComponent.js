// VisitsComponent.js - Visits summary component for patient portal
const VisitsComponent = ({ patientId }) => {
    const { useState, useEffect } = React;
    
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
        return React.createElement('div', { 
            className: 'loading-spinner' 
        }, 'Loading visits...');
    }
    
    if (error) {
        return React.createElement('div', { 
            className: 'error-message' 
        }, `Error: ${error}`);
    }
    
    console.log('🎯 Visits Component Rendering:', { patientId, visitsCount: visits.length });
    
    return React.createElement('div', { 
        style: { padding: '20px' }
    }, [
        React.createElement('h1', { key: 'title' }, 'Visits Summary'),
        
        React.createElement('button', {
            key: 'add-btn',
            onClick: openAddModal,
            style: { 
                marginBottom: '20px',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                padding: '10px 20px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px'
            }
        }, 'Add Visit'),
        
        // Visits table
        visits.length === 0 
            ? React.createElement('div', { 
                key: 'empty',
                style: { textAlign: 'center', padding: '20px' }
            }, 'No visits found for this patient.')
            : React.createElement('table', { 
                key: 'table',
                style: {
                    width: '100%',
                    borderCollapse: 'collapse',
                    marginBottom: '20px'
                }
            }, [
                React.createElement('thead', { key: 'thead' },
                    React.createElement('tr', { 
                        key: 'header-row',
                        style: { backgroundColor: '#f8f9fa' }
                    }, [
                        React.createElement('th', { 
                            key: 'date',
                            style: {
                                border: '1px solid #dee2e6',
                                padding: '12px',
                                textAlign: 'left'
                            }
                        }, 'Visit Date'),
                        React.createElement('th', { 
                            key: 'summary',
                            style: {
                                border: '1px solid #dee2e6',
                                padding: '12px',
                                textAlign: 'left'
                            }
                        }, 'Summary'),
                        React.createElement('th', { 
                            key: 'actions',
                            style: {
                                border: '1px solid #dee2e6',
                                padding: '12px',
                                textAlign: 'center',
                                width: '150px'
                            }
                        }, 'Actions')
                    ])
                ),
                React.createElement('tbody', { key: 'tbody' },
                    visits.map((visit, index) =>
                        React.createElement('tr', { 
                            key: index,
                            style: index % 2 === 0 ? { backgroundColor: '#f8f9fa' } : {}
                        }, [
                            React.createElement('td', { 
                                key: 'date',
                                style: {
                                    border: '1px solid #dee2e6',
                                    padding: '12px'
                                }
                            }, new Date(visit.VisitDate).toLocaleDateString()),
                            React.createElement('td', { 
                                key: 'summary',
                                style: {
                                    border: '1px solid #dee2e6',
                                    padding: '12px'
                                },
                                dangerouslySetInnerHTML: { __html: visit.Summary || 'No summary' }
                            }),
                            React.createElement('td', { 
                                key: 'actions',
                                style: {
                                    border: '1px solid #dee2e6',
                                    padding: '12px',
                                    textAlign: 'center'
                                }
                            }, [
                                React.createElement('button', {
                                    key: 'edit',
                                    onClick: () => openEditModal(visit.ID),
                                    style: { 
                                        marginRight: '5px',
                                        backgroundColor: '#007bff',
                                        color: 'white',
                                        border: 'none',
                                        padding: '5px 10px',
                                        borderRadius: '3px',
                                        cursor: 'pointer',
                                        fontSize: '12px'
                                    }
                                }, 'Edit'),
                                React.createElement('button', {
                                    key: 'delete',
                                    onClick: () => handleDelete(visit.ID),
                                    style: {
                                        backgroundColor: '#dc3545',
                                        color: 'white',
                                        border: 'none',
                                        padding: '5px 10px',
                                        borderRadius: '3px',
                                        cursor: 'pointer',
                                        fontSize: '12px'
                                    }
                                }, 'Delete')
                            ])
                        ])
                    )
                )
            ]),
        
        // Modal
        showModal && React.createElement('div', {
            key: 'modal',
            style: {
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
            }
        }, React.createElement('div', { 
            style: {
                backgroundColor: 'white',
                padding: '30px',
                borderRadius: '8px',
                width: '90%',
                maxWidth: '500px',
                maxHeight: '90vh',
                overflow: 'auto',
                position: 'relative'
            }
        }, [
            React.createElement('span', {
                key: 'close',
                onClick: () => setShowModal(false),
                style: {
                    position: 'absolute',
                    right: '15px',
                    top: '15px',
                    fontSize: '28px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    color: '#aaa'
                }
            }, '×'),
            
            React.createElement('form', {
                key: 'form',
                onSubmit: handleSubmit,
                style: { display: 'flex', flexDirection: 'column', gap: '15px' }
            }, [
                React.createElement('h2', { 
                    key: 'title',
                    style: { margin: '0 0 20px 0' }
                }, editingVisit ? 'Edit Visit' : 'Add Visit'),
                
                React.createElement('div', { key: 'date-group' }, [
                    React.createElement('label', { 
                        key: 'date-label',
                        style: { display: 'block', marginBottom: '5px', fontWeight: 'bold' }
                    }, 'Visit Date:'),
                    React.createElement('input', {
                        key: 'date-input',
                        type: 'date',
                        name: 'visitDate',
                        value: formData.visitDate,
                        onChange: handleInputChange,
                        required: true,
                        style: {
                            width: '100%',
                            padding: '8px',
                            border: '1px solid #ddd',
                            borderRadius: '4px'
                        }
                    })
                ]),
                
                React.createElement('div', { key: 'upper-group' }, [
                    React.createElement('label', { 
                        key: 'upper-label',
                        style: { display: 'block', marginBottom: '5px', fontWeight: 'bold' }
                    }, 'Upper Wire:'),
                    React.createElement('select', {
                        key: 'upper-select',
                        name: 'upperWire',
                        value: formData.upperWire,
                        onChange: handleInputChange,
                        style: {
                            width: '100%',
                            padding: '8px',
                            border: '1px solid #ddd',
                            borderRadius: '4px'
                        }
                    }, [
                        React.createElement('option', { key: 'empty', value: '' }, 'Select Wire'),
                        ...wireOptions.map(wire =>
                            React.createElement('option', {
                                key: wire.id,
                                value: wire.id
                            }, wire.name)
                        )
                    ])
                ]),
                
                React.createElement('div', { key: 'lower-group' }, [
                    React.createElement('label', { 
                        key: 'lower-label',
                        style: { display: 'block', marginBottom: '5px', fontWeight: 'bold' }
                    }, 'Lower Wire:'),
                    React.createElement('select', {
                        key: 'lower-select',
                        name: 'lowerWire',
                        value: formData.lowerWire,
                        onChange: handleInputChange,
                        style: {
                            width: '100%',
                            padding: '8px',
                            border: '1px solid #ddd',
                            borderRadius: '4px'
                        }
                    }, [
                        React.createElement('option', { key: 'empty', value: '' }, 'Select Wire'),
                        ...wireOptions.map(wire =>
                            React.createElement('option', {
                                key: wire.id,
                                value: wire.id
                            }, wire.name)
                        )
                    ])
                ]),
                
                React.createElement('div', { key: 'others-group' }, [
                    React.createElement('label', { 
                        key: 'others-label',
                        style: { display: 'block', marginBottom: '5px', fontWeight: 'bold' }
                    }, 'Others:'),
                    React.createElement('textarea', {
                        key: 'others-input',
                        name: 'others',
                        value: formData.others,
                        onChange: handleInputChange,
                        rows: 3,
                        style: {
                            width: '100%',
                            padding: '8px',
                            border: '1px solid #ddd',
                            borderRadius: '4px',
                            resize: 'vertical'
                        }
                    })
                ]),
                
                React.createElement('div', { key: 'next-group' }, [
                    React.createElement('label', { 
                        key: 'next-label',
                        style: { display: 'block', marginBottom: '5px', fontWeight: 'bold' }
                    }, 'Next:'),
                    React.createElement('textarea', {
                        key: 'next-input',
                        name: 'next',
                        value: formData.next,
                        onChange: handleInputChange,
                        rows: 3,
                        style: {
                            width: '100%',
                            padding: '8px',
                            border: '1px solid #ddd',
                            borderRadius: '4px',
                            resize: 'vertical'
                        }
                    })
                ]),
                
                React.createElement('button', {
                    key: 'submit',
                    type: 'submit',
                    style: {
                        backgroundColor: '#28a745',
                        color: 'white',
                        border: 'none',
                        padding: '12px 24px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '16px',
                        marginTop: '10px'
                    }
                }, editingVisit ? 'Update Visit' : 'Add Visit')
            ])
        ]))
    ]);
};

window.VisitsComponent = VisitsComponent;