// DoctorsList.tsx - Select a doctor to browse their patients
import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext';
import { fetchJSON, httpErrorMessage } from '@/core/http';
import * as alignerContract from '@shared/contracts/aligner.contract';
import styles from './DoctorsList.module.css';

interface Doctor {
    dr_id: number;
    doctor_name: string;
    UnreadDoctorNotes?: number;
}

const DoctorsList: React.FC = () => {
    const navigate = useNavigate();
    const toast = useToast();
    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [loading, setLoading] = useState<boolean>(true);

    // Load doctors on mount
    useEffect(() => {
        loadDoctors();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const loadDoctors = async (): Promise<void> => {
        try {
            const data = await fetchJSON<{ doctors?: Doctor[] }>(
                '/api/aligner/doctors',
                { schema: alignerContract.alignerDoctors.response }
            );

            setDoctors(data.doctors || []);
        } catch (error) {
            console.error('Error loading doctors:', error);
            toast.error(httpErrorMessage(error, 'Failed to load doctors'));
        } finally {
            setLoading(false);
        }
    };

    const selectDoctor = (doctor: { dr_id: number | string; doctor_name: string }): void => {
        navigate(`/aligner/doctor/${doctor.dr_id}`);
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
                        to="/settings/alignerDoctors"
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
                    onClick={() => selectDoctor({ dr_id: 'all', doctor_name: 'All Doctors' })}
                >
                    <i className={`fas fa-users ${styles.doctorIcon}`}></i>
                    <h3>All Doctors</h3>
                    <span className={styles.doctorSubtitle}>View all patients</span>
                    <i className={`fas fa-chevron-right ${styles.arrowIcon}`}></i>
                </div>

                {/* Individual Doctor Cards */}
                {doctors.map((doctor) => (
                    <div
                        key={doctor.dr_id}
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
                        <h3>{doctor.doctor_name === 'Admin' ? doctor.doctor_name : `Dr. ${doctor.doctor_name}`}</h3>
                        <i className={`fas fa-chevron-right ${styles.arrowIcon}`}></i>
                    </div>
                ))}
            </div>
        </>
    );
};

export default DoctorsList;
