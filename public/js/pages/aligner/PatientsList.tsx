// PatientsList.tsx - Show patients for a selected doctor
import React, { useState, ChangeEvent, SyntheticEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { httpErrorMessage } from '@/core/http';
import {
    alignerDoctorsQuery,
    alignerAllPatientsQuery,
    alignerPatientsByDoctorQuery,
} from '@/query/queries';
import type { AlignerPatient } from '@shared/contracts/aligner.contract';
import PhoneDisplay from '../../components/react/PhoneDisplay';
import { doctorLabel } from '../../utils/aligner-labels';
import AlignerLoadError from './AlignerLoadError';
import styles from './PatientsList.module.css';
import { buildWorkingContentUrl } from '../../components/react/files/fileHelpers';

type Patient = AlignerPatient;

const PAGE_SIZE = 120;

const PatientsList: React.FC = () => {
    const { doctorId } = useParams<{ doctorId: string }>();
    const navigate = useNavigate();

    const [patientFilter, setPatientFilter] = useState<string>('');
    // Cards drawn at once: All Doctors lists every aligner patient ever, each a card
    // with a photo (FE-F18-13). The filter narrows; "Show more" extends.
    const [shownCount, setShownCount] = useState(PAGE_SIZE);

    const isAll = doctorId === 'all';

    // Doctor info — only needed for a specific doctor. The header reads "Patients"
    // until the doctor is known: it read "Dr. undefined's Patients" on a deep link
    // while the doctors read was still in flight (FE-F18-6).
    const { data: doctorsData } = useQuery({
        ...alignerDoctorsQuery(),
        enabled: !isAll,
    });
    const doctorName = isAll
        ? null
        : doctorsData
          ? (doctorsData.doctors.find((d) => d.dr_id === parseInt(doctorId || '', 10))?.doctor_name ?? 'Unknown Doctor')
          : null;
    const heading = isAll ? 'All Patients' : doctorName ? `${doctorLabel(doctorName)}'s Patients` : 'Patients';

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

    // Computed once per render (it ran twice per render, on every keystroke).
    const query = patientFilter.trim().toLowerCase();
    const filteredPatients = !query
        ? patients
        : patients.filter((p) => {
              const name = formatPatientName(p).toLowerCase();
              const phone = (p.phone || '').toLowerCase();
              return name.includes(query) || phone.includes(query) || String(p.person_id).includes(query);
          });

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

    // A failed read is not "No patients with aligner sets" (FE-F18-6).
    if (activePatientsQ.isError) {
        return (
            <AlignerLoadError
                what="the patients"
                message={httpErrorMessage(activePatientsQ.error, 'Unknown error')}
                onRetry={() => void activePatientsQ.refetch()}
            />
        );
    }

    return (
        <>
            {/* Breadcrumb */}
            <div className={styles.breadcrumb}>
                <button type="button" onClick={backToDoctors} className={styles.breadcrumbLink}>
                    <i className="fas fa-arrow-left" aria-hidden="true"></i>
                    Back to Doctors
                </button>
            </div>

            <div className={styles.sectionHeader}>
                <h2>
                    <i className="fas fa-user-md" aria-hidden="true"></i>
                    {heading}
                </h2>
                <div className={styles.sectionInfo}>
                    <span>{patients.length} patient{patients.length !== 1 ? 's' : ''}</span>
                </div>
            </div>

            {/* Patient Filter Search */}
            {patients.length > 0 && (
                <div className={styles.patientFilterBox}>
                    <i className={`fas fa-filter ${styles.filterIcon}`} aria-hidden="true"></i>
                    <input
                        type="text"
                        placeholder="Filter patients by name, phone, or ID..."
                        aria-label="Filter patients"
                        value={patientFilter}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setPatientFilter(e.target.value)}
                    />
                    {patientFilter && (
                        <button
                            type="button"
                            className={styles.clearFilterBtn}
                            onClick={() => setPatientFilter('')}
                            aria-label="Clear the filter"
                        >
                            <i className="fas fa-times" aria-hidden="true"></i>
                        </button>
                    )}
                </div>
            )}

            {/* Patients Grid */}
            {filteredPatients.length === 0 ? (
                <div className={styles.emptyPatients}>
                    <i className="fas fa-users" aria-hidden="true"></i>
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
                    {filteredPatients.slice(0, shownCount).map((patient) => {
                        // A number, not `x && x > 0 &&` — that rendered a stray "0" (FE-F18-5).
                        const unread = patient.UnreadDoctorNotes ?? 0;
                        return (
                        <div
                            // One row per WORK: a re-treated patient has two (FE-F18-8).
                            key={patient.workid}
                            className={`${styles.patientCard} ${unread > 0 ? styles.hasActivity : ''}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => selectPatient(patient)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPatient(patient); } }}
                        >
                            {unread > 0 ? (
                                <div className={styles.activityBanner}>
                                    <i className="fas fa-bell" aria-hidden="true"></i>
                                    <strong>{unread}</strong> unread {unread === 1 ? 'note' : 'notes'}
                                </div>
                            ) : null}
                            <div className={styles.patientCardHeader}>
                                <div className={styles.patientCardPhoto}>
                                    {/* The first session's Smile, by the real file name the
                                        server found (FE-F18-8: a guessed lower-case name 404s
                                        for Dolphin's `.I13` on a case-sensitive volume, and a
                                        patient without one cost a failed request per card). */}
                                    {patient.smile_file ? (
                                        <img
                                            src={buildWorkingContentUrl(patient.person_id, patient.smile_file, { thumb: 240 })}
                                            loading="lazy"
                                            alt={`${formatPatientName(patient)} - Smile`}
                                            onError={handleImageError}
                                        />
                                    ) : null}
                                    <div
                                        className={`${styles.patientPhotoPlaceholder} ${patient.smile_file ? styles.patientPhotoPlaceholderHidden : ''}`}
                                    >
                                        <i className="fas fa-user" aria-hidden="true"></i>
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
                                <span><i className="fas fa-id-card" aria-hidden="true"></i> {patient.person_id}</span>
                                <span>
                                    <i className="fas fa-phone" aria-hidden="true"></i>{' '}
                                    {patient.phone ? <PhoneDisplay phone={patient.phone} /> : 'N/A'}
                                </span>
                            </div>
                            <div className={styles.patientCardStats}>
                                <div className={styles.stat}>
                                    <i className="fas fa-box" aria-hidden="true"></i>
                                    <span>{patient.TotalSets || 0} Sets</span>
                                </div>
                                <div className={`${styles.stat} ${styles.active}`}>
                                    <i className="fas fa-check-circle" aria-hidden="true"></i>
                                    <span>{patient.ActiveSets || 0} Active</span>
                                </div>
                            </div>
                        </div>
                        );
                    })}
                </div>
            )}
            {filteredPatients.length > shownCount && (
                <div className={styles.showMoreRow}>
                    <button type="button" className={styles.btnClear} onClick={() => setShownCount((n) => n + PAGE_SIZE)}>
                        Show more ({filteredPatients.length - shownCount} more)
                    </button>
                </div>
            )}
        </>
    );
};

export default PatientsList;
