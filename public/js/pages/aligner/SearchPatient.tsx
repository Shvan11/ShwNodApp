// SearchPatient.tsx - Quick search for patients by name/ID/phone
import React, { useState, useRef, useEffect, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import PhoneDisplay from '../../components/react/PhoneDisplay';
import { alignerPatientSearchQuery } from '@/query/queries';
import * as alignerContract from '@shared/contracts/aligner.contract';
import styles from './SearchPatient.module.css';

// Row shape comes from the shared contract (single source of truth, drift-checked
// against the schema the search read validates with).
type AlignerPatient = alignerContract.AlignerPatient;

const SearchPatient: React.FC = () => {
    const navigate = useNavigate();

    const [searchQuery, setSearchQuery] = useState<string>('');
    // Debounced term that actually drives the query (the factory is gated on a
    // non-empty term, so an empty/short query never fires a request).
    const [debouncedQuery, setDebouncedQuery] = useState<string>('');
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Clear any pending debounce timer on unmount so it can't fire setState
    // after the component is gone.
    useEffect(() => () => {
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    }, []);

    const { data, isFetching, isSuccess } = useQuery(alignerPatientSearchQuery(debouncedQuery));
    const searchResults = (data?.patients ?? []) as AlignerPatient[];
    const loading = isFetching;
    // Mirror the old behavior: the results panel appears only once a search has
    // resolved successfully (not while the first request is still in flight).
    const showResults = debouncedQuery.trim().length >= 2 && isSuccess;

    const handleSearchChange = (e: ChangeEvent<HTMLInputElement>): void => {
        const query = e.target.value;
        setSearchQuery(query);

        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }

        if (query.trim().length < 2) {
            setDebouncedQuery('');
            return;
        }

        searchTimeoutRef.current = setTimeout(() => {
            setDebouncedQuery(query);
        }, 300);
    };

    const selectPatient = (patient: AlignerPatient): void => {
        navigate(`/aligner/patient/${patient.workid}`);
    };

    const formatPatientName = (patient: AlignerPatient): string => {
        return patient.patient_name || `${patient.first_name} ${patient.last_name}`;
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
                            searchResults.map((patient) => (
                                <div
                                    key={patient.workid}
                                    className={styles.searchResultItem}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => selectPatient(patient)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPatient(patient); } }}
                                >
                                    <div className={styles.resultName}>
                                        {formatPatientName(patient)}
                                        {patient.patient_name && patient.first_name && (
                                            <span className={styles.resultNameSecondary}>
                                                ({patient.first_name} {patient.last_name})
                                            </span>
                                        )}
                                    </div>
                                    <div className={styles.resultMeta}>
                                        <span><i className="fas fa-id-card"></i> {patient.person_id}</span>
                                        <span><i className="fas fa-phone"></i> <PhoneDisplay phone={patient.phone} />{!patient.phone && 'N/A'}</span>
                                        <span><i className="fas fa-tooth"></i> {patient.work_type}</span>
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
