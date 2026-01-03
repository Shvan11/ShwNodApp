// PatientsList.tsx - Show patients for a selected doctor
import React, { useState, useEffect, ChangeEvent, SyntheticEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import styles from './PatientsList.module.css';

interface Doctor {
    DrID: number | string;
    DoctorName: string;
}

interface Patient {
    PersonID: number;
    workid: number;
    PatientName?: string;
    FirstName?: string;
    LastName?: string;
    Phone?: string;
    TotalSets?: number;
    ActiveSets?: number;
    UnreadDoctorNotes?: number;
}

const PatientsList: React.FC = () => {
    const { doctorId } = useParams<{ doctorId: string }>();
    const navigate = useNavigate();

    const [doctor, setDoctor] = useState<Doctor | null>(null);
    const [patients, setPatients] = useState<Patient[]>([]);
    const [patientFilter, setPatientFilter] = useState<string>('');
    const [loading, setLoading] = useState<boolean>(true);

    // Load doctor and patients on mount
    useEffect(() => {
        loadDoctorAndPatients();
    }, [doctorId]);

    const loadDoctorAndPatients = async (): Promise<void> => {
        try {
            setLoading(true);

            // Load doctor info (unless it's "all")
            if (doctorId !== 'all') {
                const doctorResponse = await fetch('/api/aligner/doctors');
                const doctorData = await doctorResponse.json();

                if (doctorData.success) {
                    const foundDoctor = doctorData.doctors.find((d: Doctor) => d.DrID === parseInt(doctorId || ''));
                    setDoctor(foundDoctor || { DrID: 0, DoctorName: 'Unknown Doctor' });
                }
            } else {
                setDoctor({ DrID: 'all', DoctorName: 'All Doctors' });
            }

            // Load patients
            const url = doctorId === 'all'
                ? '/api/aligner/patients/all'
                : `/api/aligner/patients/by-doctor/${doctorId}`;

            const response = await fetch(url);
            const data = await response.json();

            if (data.success) {
                setPatients(data.patients || []);
            }
        } catch (error) {
            console.error('Error loading data:', error);
        } finally {
            setLoading(false);
        }
    };

    const selectPatient = (patient: Patient): void => {
        navigate(`/aligner/doctor/${doctorId}/patient/${patient.workid}`);
    };

    const backToDoctors = (): void => {
        navigate('/aligner');
    };

    const formatPatientName = (patient: Patient): string => {
        return patient.PatientName || `${patient.FirstName} ${patient.LastName}`;
    };

    const getFilteredPatients = (): Patient[] => {
        if (!patientFilter.trim()) {
            return patients;
        }

        const query = patientFilter.toLowerCase();
        return patients.filter(p => {
            const name = formatPatientName(p).toLowerCase();
            const phone = (p.Phone || '').toLowerCase();
            const id = String(p.PersonID);

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
                    {doctor?.DoctorName === 'Admin' ? doctor.DoctorName : `Dr. ${doctor?.DoctorName}`}'s Patients
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
                            key={patient.PersonID}
                            className={`${styles.patientCard} ${patient.UnreadDoctorNotes && patient.UnreadDoctorNotes > 0 ? styles.hasActivity : ''}`}
                            onClick={() => selectPatient(patient)}
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
                                        src={`/DolImgs/${patient.PersonID}00.i13`}
                                        alt={`${formatPatientName(patient)} - Smile`}
                                        onError={handleImageError}
                                    />
                                    <div className={`${styles.patientPhotoPlaceholder} ${styles.patientPhotoPlaceholderHidden}`}>
                                        <i className="fas fa-user"></i>
                                    </div>
                                </div>
                                <div>
                                    <h3>{formatPatientName(patient)}</h3>
                                    {patient.PatientName && patient.FirstName && (
                                        <p className={styles.patientCardSubtitle}>
                                            {patient.FirstName} {patient.LastName}
                                        </p>
                                    )}
                                </div>
                            </div>
                            <div className={styles.patientCardMeta}>
                                <span><i className="fas fa-id-card"></i> {patient.PersonID}</span>
                                <span><i className="fas fa-phone"></i> {patient.Phone || 'N/A'}</span>
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
