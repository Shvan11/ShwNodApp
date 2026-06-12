// DoctorsList.tsx - Select a doctor to browse their patients
import React, { useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '../../contexts/ToastContext';
import { httpErrorMessage } from '@/core/http';
import { alignerDoctorsQuery } from '@/query/queries';
import type { AlignerDoctor } from '@shared/contracts/aligner.contract';
import styles from './DoctorsList.module.css';

const DoctorsList: React.FC = () => {
    const navigate = useNavigate();
    const toast = useToast();
    const { data, isLoading: loading, error } = useQuery(alignerDoctorsQuery());
    const doctors: AlignerDoctor[] = data?.doctors ?? [];

    // Surface a load failure as a toast (preserves the previous on-error UX).
    useEffect(() => {
        if (error) {
            toast.error(httpErrorMessage(error, 'Failed to load doctors'));
        }
    }, [error, toast]);

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
