// DoctorsList.tsx - Select a doctor to browse their patients
import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { httpErrorMessage } from '@/core/http';
import { alignerDoctorsQuery, alignerFeaturesQuery } from '@/query/queries';
import type { AlignerDoctor } from '@shared/contracts/aligner.contract';
import { doctorLabel } from '../../utils/aligner-labels';
import AlignerLoadError from './AlignerLoadError';
import styles from './DoctorsList.module.css';

const DoctorsList: React.FC = () => {
    const navigate = useNavigate();
    const { data, isLoading: loading, isError, error, refetch } = useQuery(alignerDoctorsQuery());
    const doctors: AlignerDoctor[] = data?.doctors ?? [];
    // Announcements exist only for a doctor portal (owner decision, FE-F18-12).
    const hasPortal = useQuery(alignerFeaturesQuery()).data?.portal ?? false;

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

    // A failed read says so, with Retry; it used to toast, then show "0 doctors"
    // and the All Doctors card as if the clinic had none (FE-F18-6).
    if (isError) {
        return <AlignerLoadError what="the doctors" message={httpErrorMessage(error, 'Unknown error')} onRetry={() => void refetch()} />;
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
                    {hasPortal && (
                        <Link
                            to="/aligner/announcements"
                            className={styles.btnManageDoctors}
                            title="Compose and manage portal announcements"
                        >
                            <i className="fas fa-bullhorn" aria-hidden="true"></i>
                            Announcements
                        </Link>
                    )}
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
                    role="button"
                    tabIndex={0}
                    onClick={() => selectDoctor({ dr_id: 'all', doctor_name: 'All Doctors' })}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectDoctor({ dr_id: 'all', doctor_name: 'All Doctors' }); } }}
                >
                    <i className={`fas fa-users ${styles.doctorIcon}`}></i>
                    <h3>All Doctors</h3>
                    <span className={styles.doctorSubtitle}>View all patients</span>
                    <i className={`fas fa-chevron-right ${styles.arrowIcon}`}></i>
                </div>

                {/* Individual Doctor Cards */}
                {doctors.map((doctor) => {
                    // A number, not `x && x > 0 &&`: a 0 count rendered a stray "0" on
                    // every card (FE-F18-5).
                    const unread = doctor.UnreadDoctorNotes ?? 0;
                    return (
                        <div
                            key={doctor.dr_id}
                            className={`${styles.doctorCard} ${unread > 0 ? styles.hasActivity : ''}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => selectDoctor(doctor)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectDoctor(doctor); } }}
                        >
                            {unread > 0 ? (
                                <div className={styles.activityBanner}>
                                    <i className="fas fa-bell" aria-hidden="true"></i>
                                    <strong>{unread}</strong> unread {unread === 1 ? 'note' : 'notes'}
                                </div>
                            ) : null}
                            <i className={`fas fa-user-md ${styles.doctorIcon}`} aria-hidden="true"></i>
                            <h3>{doctorLabel(doctor.doctor_name)}</h3>
                            <i className={`fas fa-chevron-right ${styles.arrowIcon}`} aria-hidden="true"></i>
                        </div>
                    );
                })}
            </div>
        </>
    );
};

export default DoctorsList;
