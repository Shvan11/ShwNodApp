// SearchPatient.jsx - Quick search for patients by name/ID/phone
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AlignerModeToggle from '../../components/react/AlignerModeToggle.jsx';

const SearchPatient = () => {
    const navigate = useNavigate();

    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [showResults, setShowResults] = useState(false);
    const [loading, setLoading] = useState(false);
    const [searchTimeout, setSearchTimeout] = useState(null);

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

    const selectPatient = (patient) => {
        navigate(`/aligner/patient/${patient.workid}`);
    };

    const formatPatientName = (patient) => {
        return patient.PatientName || `${patient.FirstName} ${patient.LastName}`;
    };

    return (
        <div className="aligner-container">
            <AlignerModeToggle activeMode="search" />

            {/* Search Box */}
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
        </div>
    );
};

export default SearchPatient;
