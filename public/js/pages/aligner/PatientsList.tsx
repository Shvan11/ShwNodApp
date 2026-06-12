// PatientsList.tsx - Show patients for a selected doctor
import React, { useState, ChangeEvent, SyntheticEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
    alignerDoctorsQuery,
    alignerAllPatientsQuery,
    alignerPatientsByDoctorQuery,
} from '@/query/queries';
import type { AlignerPatient } from '@shared/contracts/aligner.contract';
import styles from './PatientsList.module.css';

interface Doctor {
    dr_id: number | string;
    doctor_name: string;
}

type Patient = AlignerPatient;

const PatientsList: React.FC = () => {
    const { doctorId } = useParams<{ doctorId: string }>();
    const navigate = useNavigate();

    const [patientFilter, setPatientFilter] = useState<string>('');

    const isAll = doctorId === 'all';

    // Doctor info — only needed for a specific doctor (the "all" view uses a
    // synthetic label). Read from the shared doctors list and pick the match.
    const { data: doctorsData } = useQuery({
        ...alignerDoctorsQuery(),
        enabled: !isAll,
    });
    const doctor: Doctor | null = isAll
        ? { dr_id: 'all', doctor_name: 'All Doctors' }
        : (doctorsData?.doctors.find((d) => d.dr_id === parseInt(doctorId || ''))
            ?? (doctorsData ? { dr_id: 0, doctor_name: 'Unknown Doctor' } : null));

    // Patients — two parameterized reads gated by `enabled`; pick whichever
    // branch is active for this route.
    const allPatientsQ = useQuery({
        ...alignerAllPatientsQuery(),
        enabled: isAll,
    });
    const byDoctorQ = useQuery({
        ...alignerPatientsByDoctorQuery(doctorId ?? ''),
        enabled: !isAll && !!doctorId,
    });
    const activePatientsQ = isAll ? allPatientsQ : byDoctorQ;
    const patients: Patient[] = activePatientsQ.data?.patients ?? [];
    const loading = activePatientsQ.isLoading;

    const selectPatient = (patient: Patient): void => {
        navigate(`/aligner/doctor/${doctorId}/patient/${patient.workid}`);
    };

    const backToDoctors = (): void => {
        navigate('/aligner');
    };

    const formatPatientName = (patient: Patient): string => {
        return patient.patient_name || `${patient.first_name} ${patient.last_name}`;
    };

    const getFilteredPatients = (): Patient[] => {
        if (!patientFilter.trim()) {
            return patients;
        }

        const query = patientFilter.toLowerCase();
        return patients.filter(p => {
            const name = formatPatientName(p).toLowerCase();
            const phone = (p.phone || '').toLowerCase();
            const id = String(p.person_id);

            return name.includes(query) || phone.includes(query) || id.includes(query);
        });
    };

    const handleImageError = (e: SyntheticEvent<HTMLImageElement>): void => {
        const img = e.currentTarget;
        img.style.display = 'none';
        const placeholder = img.nextElementSibling as HTMLElement | null;
        if (placeholder) {
            placeholder.style.display = 'flex';
        }
    };

    if (loading) {
        return (
            <div className={styles.loadingContainer}>
                <div className={styles.spinner}></div>
                <p>Loading patients...</p>
            </div>
        );
    }

    return (
        <>
            {/* Breadcrumb */}
            <div className={styles.breadcrumb}>
                <button onClick={backToDoctors} className={styles.breadcrumbLink}>
                    <i className="fas fa-arrow-left"></i>
                    Back to Doctors
                </button>
            </div>

            <div className={styles.sectionHeader}>
                <h2>
                    <i className="fas fa-user-md"></i>
                    {doctor?.doctor_name === 'Admin' ? doctor.doctor_name : `Dr. ${doctor?.doctor_name}`}'s Patients
                </h2>
                <div className={styles.sectionInfo}>
                    <span>{patients.length} patient{patients.length !== 1 ? 's' : ''}</span>
                </div>
            </div>

            {/* Patient Filter Search */}
            {patients.length > 0 && (
                <div className={styles.patientFilterBox}>
                    <i className={`fas fa-filter ${styles.filterIcon}`}></i>
                    <input
                        type="text"
                        placeholder="Filter patients by name, phone, or ID..."
                        value={patientFilter}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setPatientFilter(e.target.value)}
                    />
                    {patientFilter && (
                        <button
                            className={styles.clearFilterBtn}
                            onClick={() => setPatientFilter('')}
                        >
                            <i className="fas fa-times"></i>
                        </button>
                    )}
                </div>
            )}

            {/* Patients Grid */}
            {getFilteredPatients().length === 0 ? (
                <div className={styles.emptyPatients}>
                    <i className="fas fa-users"></i>
                    <h3>{patientFilter ? 'No matching patients found' : 'No patients with aligner sets'}</h3>
                    {patientFilter && (
                        <button
                            className={`${styles.btnClear} ${styles.btnClearSpaced}`}
                            onClick={() => setPatientFilter('')}
                        >
                            Clear Filter
                        </button>
                    )}
                </div>
            ) : (
                <div className={styles.patientsGrid}>
                    {getFilteredPatients().map((patient) => (
                        <div
                            key={patient.person_id}
                            className={`${styles.patientCard} ${patient.UnreadDoctorNotes && patient.UnreadDoctorNotes > 0 ? styles.hasActivity : ''}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => selectPatient(patient)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPatient(patient); } }}
                        >
                            {patient.UnreadDoctorNotes && patient.UnreadDoctorNotes > 0 && (
                                <div className={styles.activityBanner}>
                                    <i className="fas fa-bell"></i>
                                    <strong>{patient.UnreadDoctorNotes}</strong> unread {patient.UnreadDoctorNotes === 1 ? 'note' : 'notes'}
                                </div>
                            )}
                            <div className={styles.patientCardHeader}>
                                <div className={styles.patientCardPhoto}>
                                    <img
                                        src={`/DolImgs/${patient.person_id}00.i13`}
                                        alt={`${formatPatientName(patient)} - Smile`}
                                        onError={handleImageError}
                                    />
                                    <div className={`${styles.patientPhotoPlaceholder} ${styles.patientPhotoPlaceholderHidden}`}>
                                        <i className="fas fa-user"></i>
                                    </div>
                                </div>
                                <div>
                                    <h3>{formatPatientName(patient)}</h3>
                                    {patient.patient_name && patient.first_name && (
                                        <p className={styles.patientCardSubtitle}>
                                            {patient.first_name} {patient.last_name}
                                        </p>
                                    )}
                                </div>
                            </div>
                            <div className={styles.patientCardMeta}>
                                <span><i className="fas fa-id-card"></i> {patient.person_id}</span>
                                <span><i className="fas fa-phone"></i> {patient.phone || 'N/A'}</span>
                            </div>
                            <div className={styles.patientCardStats}>
                                <div className={styles.stat}>
                                    <i className="fas fa-box"></i>
                                    <span>{patient.TotalSets || 0} Sets</span>
                                </div>
                                <div className={`${styles.stat} ${styles.active}`}>
                                    <i className="fas fa-check-circle"></i>
                                    <span>{patient.ActiveSets || 0} Active</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </>
    );
};

export default PatientsList;
