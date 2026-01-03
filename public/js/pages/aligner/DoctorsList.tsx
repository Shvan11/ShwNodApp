// DoctorsList.tsx - Select a doctor to browse their patients
import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import styles from './DoctorsList.module.css';

interface Doctor {
    DrID: number;
    DoctorName: string;
    UnreadDoctorNotes?: number;
}

const DoctorsList: React.FC = () => {
    const navigate = useNavigate();
    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [loading, setLoading] = useState<boolean>(true);

    // Load doctors on mount
    useEffect(() => {
        loadDoctors();
    }, []);

    const loadDoctors = async (): Promise<void> => {
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

    const selectDoctor = (doctor: { DrID: number | string; DoctorName: string }): void => {
        navigate(`/aligner/doctor/${doctor.DrID}`);
    };

    if (loading) {
        return (
            <div className={styles.loadingContainer}>
                <div className={styles.spinner}></div>
                <p>Loading doctors...</p>
            </div>
        );
    }

    return (
        <>
            <div className={styles.sectionHeader}>
                <h2>
                    <i className="fas fa-user-md"></i>
                    Select a Doctor
                </h2>
                <div className={styles.sectionInfo}>
                    <span>{doctors.length} doctor{doctors.length !== 1 ? 's' : ''}</span>
                    <Link
                        to="/settings?tab=alignerDoctors"
                        className={styles.btnManageDoctors}
                        title="Manage aligner doctors and portal access"
                    >
                        <i className="fas fa-cog"></i>
                        Manage Doctors
                    </Link>
                </div>
            </div>

            <div className={styles.doctorsGrid}>
                {/* All Doctors Card */}
                <div
                    className={`${styles.doctorCard} ${styles.allDoctors}`}
                    onClick={() => selectDoctor({ DrID: 'all', DoctorName: 'All Doctors' })}
                >
                    <i className={`fas fa-users ${styles.doctorIcon}`}></i>
                    <h3>All Doctors</h3>
                    <span className={styles.doctorSubtitle}>View all patients</span>
                    <i className={`fas fa-chevron-right ${styles.arrowIcon}`}></i>
                </div>

                {/* Individual Doctor Cards */}
                {doctors.map((doctor) => (
                    <div
                        key={doctor.DrID}
                        className={`${styles.doctorCard} ${doctor.UnreadDoctorNotes && doctor.UnreadDoctorNotes > 0 ? styles.hasActivity : ''}`}
                        onClick={() => selectDoctor(doctor)}
                    >
                        {doctor.UnreadDoctorNotes && doctor.UnreadDoctorNotes > 0 && (
                            <div className={styles.activityBanner}>
                                <i className="fas fa-bell"></i>
                                <strong>{doctor.UnreadDoctorNotes}</strong> unread {doctor.UnreadDoctorNotes === 1 ? 'note' : 'notes'}
                            </div>
                        )}
                        <i className={`fas fa-user-md ${styles.doctorIcon}`}></i>
                        <h3>{doctor.DoctorName === 'Admin' ? doctor.DoctorName : `Dr. ${doctor.DoctorName}`}</h3>
                        <i className={`fas fa-chevron-right ${styles.arrowIcon}`}></i>
                    </div>
                ))}
            </div>
        </>
    );
};

export default DoctorsList;
