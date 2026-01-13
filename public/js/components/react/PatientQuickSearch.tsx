import React, { useState, useEffect, useCallback } from 'react';
import AsyncSelect from 'react-select/async';
import type { StylesConfig } from 'react-select';
import cn from 'classnames';
import styles from './PatientQuickSearch.module.css';

/**
 * Patient data from /api/patients/phones endpoint
 */
export interface PatientOption {
    id: number;
    name?: string;
    phone?: string;
}

/**
 * Select option format for react-select
 */
interface SelectOption {
    value: number;
    label: string;
}

/**
 * Selected patient data returned to parent
 */
export interface SelectedPatient {
    PersonID: number;
    PatientName: string;
    Phone?: string;
}

/**
 * Props for PatientQuickSearch component
 */
export interface PatientQuickSearchProps {
    /** Callback when a patient is selected */
    onSelect: (patient: SelectedPatient) => void;
    /** Array of patient IDs to exclude from results */
    excludePatientIds?: number[];
    /** Layout orientation */
    layout?: 'horizontal' | 'vertical';
    /** Whether to show the header section */
    showHeader?: boolean;
    /** Whether to auto-focus the first input */
    autoFocus?: boolean;
    /** Pre-loaded patient data (from route loader) */
    allPatients?: PatientOption[];
    /** Custom class name for container */
    className?: string;
}

/**
 * PatientQuickSearch Component
 *
 * Reusable patient search component with 3 search modes:
 * - Name (Arabic/RTL)
 * - Phone
 * - ID
 *
 * Uses client-side filtering for instant results.
 */
const PatientQuickSearch: React.FC<PatientQuickSearchProps> = ({
    onSelect,
    excludePatientIds = [],
    layout = 'horizontal',
    showHeader = true,
    autoFocus = false,
    allPatients: providedPatients,
    className
}) => {
    const [patients, setPatients] = useState<PatientOption[]>(providedPatients || []);
    const [loading, setLoading] = useState(!providedPatients);
    const [error, setError] = useState<string | null>(null);

    // Fetch patients if not provided via props
    useEffect(() => {
        if (providedPatients) {
            setPatients(providedPatients);
            setLoading(false);
            return;
        }

        const fetchPatients = async () => {
            try {
                setLoading(true);
                const response = await fetch('/api/patients/phones');
                if (!response.ok) {
                    throw new Error('Failed to load patients');
                }
                const data = await response.json() as PatientOption[];
                setPatients(data);
                setError(null);
            } catch (err) {
                console.error('Failed to fetch patients:', err);
                setError(err instanceof Error ? err.message : 'Failed to load patients');
            } finally {
                setLoading(false);
            }
        };

        fetchPatients();
    }, [providedPatients]);

    // Filter out excluded patients
    const filteredPatients = patients.filter(
        p => !excludePatientIds.includes(p.id)
    );

    // Handle selection - convert to SelectedPatient format
    const handleSelect = useCallback((option: SelectOption | null) => {
        if (!option) return;

        const patient = filteredPatients.find(p => p.id === option.value);
        if (patient) {
            onSelect({
                PersonID: patient.id,
                PatientName: patient.name || '',
                Phone: patient.phone
            });
        }
    }, [filteredPatients, onSelect]);

    // Search by Name (Arabic)
    const loadNameOptions = useCallback((input: string, callback: (options: SelectOption[]) => void) => {
        if (input.length < 2) {
            callback([]);
            return;
        }
        const results = filteredPatients
            .filter(p => p.name?.startsWith(input))
            .slice(0, 50)
            .map(p => ({ value: p.id, label: p.name || '' }));
        callback(results);
    }, [filteredPatients]);

    // Search by Phone
    const loadPhoneOptions = useCallback((input: string, callback: (options: SelectOption[]) => void) => {
        if (input.length < 2) {
            callback([]);
            return;
        }
        const results = filteredPatients
            .filter(p => p.phone?.includes(input))
            .slice(0, 50)
            .map(p => ({ value: p.id, label: p.phone || '' }));
        callback(results);
    }, [filteredPatients]);

    // Search by ID
    const loadIdOptions = useCallback((input: string, callback: (options: SelectOption[]) => void) => {
        if (input.length < 1) {
            callback([]);
            return;
        }
        const results = filteredPatients
            .filter(p => p.id?.toString().includes(input))
            .slice(0, 50)
            .map(p => ({ value: p.id, label: p.id.toString() }));
        callback(results);
    }, [filteredPatients]);

    // Base styles for all selects - use CSS variable for consistent height
    const selectStylesBase: StylesConfig<SelectOption, false> = {
        control: (provided) => ({
            ...provided,
            minHeight: 'var(--input-height)'
        })
    };

    // RTL styles for Arabic name search
    const selectStylesRTL: StylesConfig<SelectOption, false> = {
        control: (provided) => ({
            ...provided,
            minHeight: 'var(--input-height)'
        }),
        input: (provided) => ({
            ...provided,
            direction: 'rtl' as const,
            textAlign: 'right' as const
        }),
        singleValue: (provided) => ({
            ...provided,
            direction: 'rtl' as const,
            textAlign: 'right' as const
        }),
        placeholder: (provided) => ({
            ...provided,
            direction: 'rtl' as const,
            textAlign: 'right' as const
        })
    };

    // Loading state
    if (loading) {
        return (
            <div className={cn(styles.container, className)}>
                <div className={styles.loadingState}>
                    <i className="fas fa-spinner fa-spin"></i>
                    <span>Loading patients...</span>
                </div>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className={cn(styles.container, className)}>
                <div className={styles.errorState}>
                    <i className="fas fa-exclamation-circle"></i>
                    <span>{error}</span>
                </div>
            </div>
        );
    }

    return (
        <div className={cn(styles.container, className)}>
            {showHeader && (
                <div className={styles.header}>
                    <i className="fas fa-bolt"></i>
                    <h3>Quick Search - Select & Go</h3>
                </div>
            )}

            <div className={cn(
                styles.searchGrid,
                layout === 'vertical' && styles.searchGridVertical
            )}>
                {/* Search by Name (Arabic) */}
                <div className={styles.searchField}>
                    <label>
                        <i className={cn('fas fa-user', styles.iconGap)}></i>
                        Search by Name (Arabic)
                    </label>
                    <AsyncSelect<SelectOption, false>
                        cacheOptions
                        defaultOptions={false}
                        loadOptions={loadNameOptions}
                        onChange={handleSelect}
                        placeholder="اكتب للبحث..."
                        isClearable
                        classNamePrefix="pqs-select"
                        styles={selectStylesRTL}
                        autoFocus={autoFocus}
                        noOptionsMessage={({ inputValue }) =>
                            inputValue.length < 2 ? 'Type at least 2 characters...' : 'No patients found'
                        }
                    />
                </div>

                {/* Search by Phone */}
                <div className={styles.searchField}>
                    <label>
                        <i className={cn('fas fa-phone', styles.iconGap)}></i>
                        Search by Phone
                    </label>
                    <AsyncSelect<SelectOption, false>
                        cacheOptions
                        defaultOptions={false}
                        loadOptions={loadPhoneOptions}
                        onChange={handleSelect}
                        placeholder="Search phone..."
                        isClearable
                        classNamePrefix="pqs-select"
                        styles={selectStylesBase}
                        noOptionsMessage={({ inputValue }) =>
                            inputValue.length < 2 ? 'Type at least 2 characters...' : 'No patients found'
                        }
                    />
                </div>

                {/* Search by ID */}
                <div className={styles.searchField}>
                    <label>
                        <i className={cn('fas fa-id-card', styles.iconGap)}></i>
                        Search by ID
                    </label>
                    <AsyncSelect<SelectOption, false>
                        cacheOptions
                        defaultOptions={false}
                        loadOptions={loadIdOptions}
                        onChange={handleSelect}
                        placeholder="Search ID..."
                        isClearable
                        classNamePrefix="pqs-select"
                        styles={selectStylesBase}
                        noOptionsMessage={({ inputValue }) =>
                            inputValue.length < 1 ? 'Type at least 1 character...' : 'No patients found'
                        }
                    />
                </div>
            </div>
        </div>
    );
};

export default React.memo(PatientQuickSearch);
