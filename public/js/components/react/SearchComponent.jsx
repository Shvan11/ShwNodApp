import React, { useState, useEffect, useRef } from 'react';

const SearchComponent = () => {
    const [patients, setPatients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedName, setSelectedName] = useState('');
    const [selectedPhone, setSelectedPhone] = useState('');
    const [selectedId, setSelectedId] = useState('');

    const nameSelectRef = useRef(null);
    const phoneSelectRef = useRef(null);
    const idSelectRef = useRef(null);
    const tomSelectRefs = useRef({});

    useEffect(() => {
        loadPatientData();
    }, []);

    useEffect(() => {
        if (patients.length > 0) {
            initializeTomSelect();
        }
        return () => {
            Object.values(tomSelectRefs.current).forEach(select => {
                if (select && select.destroy) {
                    select.destroy();
                }
            });
        };
    }, [patients]);

    const loadPatientData = async () => {
        try {
            setLoading(true);
            const response = await fetch('/api/patientsPhones');
            if (!response.ok) {
                throw new Error('Failed to fetch patient data');
            }
            const data = await response.json();
            setPatients(data);
            setError(null);
        } catch (error) {
            console.error('Failed to fetch data:', error);
            setError('Failed to load patient data. Please try again later.');
        } finally {
            setLoading(false);
        }
    };

    const formatDataForSelects = (patients) => {
        return {
            names: patients.map(patient => ({
                value: patient.id,
                text: patient.name
            })),
            phones: patients.map(patient => ({
                value: patient.id,
                text: patient.phone
            })),
            ids: patients.map(patient => ({
                value: patient.id,
                text: patient.id
            }))
        };
    };

    const initializeTomSelect = () => {
        if (typeof window.TomSelect === 'undefined') {
            console.error('TomSelect is not available');
            return;
        }

        const formattedData = formatDataForSelects(patients);
        const baseSettings = {
            maxItems: 1,
            placeholder: 'Select...'
        };

        const handleChange = (value, selectType) => {
            clearAllSelects();
            if (value) {
                window.location.href = `/views/patient/react-shell.html?patient=${value}`;
            }
        };

        const clearAllSelects = () => {
            Object.values(tomSelectRefs.current).forEach(select => {
                if (select && select.clear) {
                    select.clear();
                }
            });
        };

        if (nameSelectRef.current) {
            tomSelectRefs.current.name = new window.TomSelect(nameSelectRef.current, {
                ...baseSettings,
                options: formattedData.names,
                onChange: (value) => handleChange(value, 'name')
            });
        }

        if (phoneSelectRef.current) {
            tomSelectRefs.current.phone = new window.TomSelect(phoneSelectRef.current, {
                ...baseSettings,
                options: formattedData.phones,
                onChange: (value) => handleChange(value, 'phone')
            });
        }

        if (idSelectRef.current) {
            tomSelectRefs.current.id = new window.TomSelect(idSelectRef.current, {
                ...baseSettings,
                options: formattedData.ids,
                onChange: (value) => handleChange(value, 'id')
            });
        }
    };

    const handleCrossNavigation = (destination) => {
        if (destination === 'appointments') {
            if (window.navigationContext?.navigateToPage) {
                window.navigationContext.navigateToPage('appointments');
            } else {
                window.location.href = '/appointments';
            }
        } else if (destination === 'calendar') {
            window.location.href = '/calendar';
        }
    };

    if (loading) {
        return (
            <div className="container">
                <div className="loading-message">Loading patient data...</div>
            </div>
        );
    }

    return (
        <div className="container">
            <h1>Search Database</h1>
            
            {error && (
                <div id="error-message" className="error-message" role="alert">
                    {error}
                </div>
            )}

            <form id="searchForm">
                <div className="form-group">
                    <label htmlFor="firstName">First Name:</label>
                    <select 
                        id="firstName" 
                        name="firstName" 
                        aria-label="Select patient name"
                        ref={nameSelectRef}
                        value={selectedName}
                        onChange={(e) => setSelectedName(e.target.value)}
                    />
                </div>
                
                <div className="form-group">
                    <label htmlFor="phone">Phone:</label>
                    <select 
                        id="phone" 
                        name="phone" 
                        aria-label="Select patient phone"
                        ref={phoneSelectRef}
                        value={selectedPhone}
                        onChange={(e) => setSelectedPhone(e.target.value)}
                    />
                </div>
                
                <div className="form-group">
                    <label htmlFor="patientId">Patient ID:</label>
                    <select 
                        id="id" 
                        name="patientId" 
                        aria-label="Select patient ID"
                        ref={idSelectRef}
                        value={selectedId}
                        onChange={(e) => setSelectedId(e.target.value)}
                    />
                </div>
                
                <button type="submit">Search</button>
            </form>
            
            <div id="results" role="alert" aria-live="polite"></div>
            
            <div className="cross-nav-section">
                <button 
                    type="button" 
                    id="view-appointments-btn" 
                    className="nav-action-btn"
                    onClick={() => handleCrossNavigation('appointments')}
                >
                    <i className="fas fa-calendar-day"></i>
                    View Today's Appointments
                </button>
                <button 
                    type="button" 
                    id="view-calendar-btn" 
                    className="nav-action-btn"
                    onClick={() => handleCrossNavigation('calendar')}
                >
                    <i className="fas fa-calendar-alt"></i>
                    View Full Calendar
                </button>
            </div>
        </div>
    );
};

export default SearchComponent;