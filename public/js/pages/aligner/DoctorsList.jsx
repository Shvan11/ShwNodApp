// DoctorsList.jsx - Select a doctor to browse their patients
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const DoctorsList = () => {
    const navigate = useNavigate();
    const [doctors, setDoctors] = useState([]);
    const [loading, setLoading] = useState(true);

    // Load doctors on mount
    useEffect(() => {
        loadDoctors();
    }, []);

    const loadDoctors = async () => {
        try {
            const response = await fetch('/api/aligner/doctors');
            const data = await response.json();

            if (data.success) {
                setDoctors(data.doctors || []);
            }
        } catch (error) {
            console.error('Error loading doctors:', error);
        } finally {
            setLoading(false);
        }
    };

    const selectDoctor = (doctor) => {
        navigate(`/aligner/doctor/${doctor.DrID}`);
    };

    if (loading) {
        return (
            <div className="aligner-container">
                <div className="loading-container">
                    <div className="spinner"></div>
                    <p>Loading doctors...</p>
                </div>
            </div>
        );
    }

    return (
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
                        <h3>{doctor.DoctorName === 'Admin' ? doctor.DoctorName : `Dr. ${doctor.DoctorName}`}</h3>
                        <i className="fas fa-chevron-right arrow-icon"></i>
                    </div>
                ))}
            </div>
        </>
    );
};

export default DoctorsList;
