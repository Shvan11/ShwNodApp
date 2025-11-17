/**
 * DoctorFilter Component
 *
 * Dropdown filter for selecting a doctor to filter calendar appointments
 * Fetches doctor list from /api/doctors and provides selection UI
 */

import React, { useState, useEffect } from 'react';

const DoctorFilter = ({ selectedDoctorId, onDoctorChange, className = '' }) => {
    const [doctors, setDoctors] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        fetchDoctors();
    }, []);

    const fetchDoctors = async () => {
        try {
            setLoading(true);
            setError(null);

            const response = await fetch('/api/doctors');

            if (!response.ok) {
                throw new Error(`Failed to fetch doctors: ${response.statusText}`);
            }

            const data = await response.json();

            // Validate data structure
            if (Array.isArray(data)) {
                setDoctors(data);
            } else {
                console.error('Invalid doctors data format:', data);
                setError('Invalid data format');
            }
        } catch (err) {
            console.error('Error fetching doctors:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (event) => {
        const value = event.target.value;
        // Convert empty string to null, otherwise parse as integer
        const doctorId = value === '' ? null : parseInt(value, 10);
        onDoctorChange(doctorId);
    };

    if (loading) {
        return (
            <div className={`doctor-filter ${className}`}>
                <select className="doctor-filter-select" disabled>
                    <option>Loading...</option>
                </select>
            </div>
        );
    }

    if (error) {
        return (
            <div className={`doctor-filter ${className}`}>
                <select className="doctor-filter-select" disabled>
                    <option>Error</option>
                </select>
            </div>
        );
    }

    return (
        <div className={`doctor-filter ${className}`}>
            <select
                id="doctor-select"
                className="doctor-filter-select"
                value={selectedDoctorId || ''}
                onChange={handleChange}
            >
                <option value="">Filter by Doctor...</option>
                {doctors.map((doctor) => (
                    <option key={doctor.ID} value={doctor.ID}>
                        {doctor.employeeName}
                    </option>
                ))}
            </select>
        </div>
    );
};

export default DoctorFilter;
