// SearchPatient.tsx - Quick search for patients by name/ID/phone
import React, { useState, ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './SearchPatient.module.css';

interface AlignerPatient {
    workid: number;
    PersonID: number;
    PatientName?: string;
    FirstName?: string;
    LastName?: string;
    Phone?: string;
    WorkType?: string;
}

const SearchPatient: React.FC = () => {
    const navigate = useNavigate();

    const [searchQuery, setSearchQuery] = useState<string>('');
    const [searchResults, setSearchResults] = useState<AlignerPatient[]>([]);
    const [showResults, setShowResults] = useState<boolean>(false);
    const [loading, setLoading] = useState<boolean>(false);
    const [searchTimeout, setSearchTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);

    const handleSearchChange = (e: ChangeEvent<HTMLInputElement>): void => {
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

    const searchPatients = async (query: string): Promise<void> => {
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

    const selectPatient = (patient: AlignerPatient): void => {
        navigate(`/aligner/patient/${patient.workid}`);
    };

    const formatPatientName = (patient: AlignerPatient): string => {
        return patient.PatientName || `${patient.FirstName} ${patient.LastName}`;
    };

    return (
        <>
            {/* Search Box */}
            <div className={styles.searchSection}>
                <div className={styles.searchBox}>
                    <i className={`fas fa-search ${styles.searchIcon}`}></i>
                    <input
                        type="text"
                        id="patient-search"
                        placeholder="Search aligner patients by name, phone, or patient ID..."
                        autoComplete="off"
                        value={searchQuery}
                        onChange={handleSearchChange}
                    />
                    <span className={styles.searchInfo}>Minimum 2 characters</span>
                </div>

                {/* Search Results */}
                {showResults && (
                    <div className={styles.searchResults}>
                        {searchResults.length === 0 ? (
                            <div className={styles.searchNoResults}>
                                <i className="fas fa-user-slash"></i>
                                <p>No aligner patients found</p>
                            </div>
                        ) : (
                            searchResults.map((patient, index) => (
                                <div
                                    key={index}
                                    className={styles.searchResultItem}
                                    onClick={() => selectPatient(patient)}
                                >
                                    <div className={styles.resultName}>
                                        {formatPatientName(patient)}
                                        {patient.PatientName && patient.FirstName && (
                                            <span className={styles.resultNameSecondary}>
                                                ({patient.FirstName} {patient.LastName})
                                            </span>
                                        )}
                                    </div>
                                    <div className={styles.resultMeta}>
                                        <span><i className="fas fa-id-card"></i> {patient.PersonID}</span>
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
                    <div className={styles.emptyState}>
                        <i className="fas fa-search"></i>
                        <h3>Quick Search</h3>
                        <p>Enter a patient name, phone number, or ID to find their aligner records</p>
                    </div>
                )}
            </div>
        </>
    );
};

export default SearchPatient;
