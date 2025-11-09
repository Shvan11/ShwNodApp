// PatientsList.jsx - Show patients for a selected doctor
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

const PatientsList = () => {
    const { doctorId } = useParams();
    const navigate = useNavigate();

    const [doctor, setDoctor] = useState(null);
    const [patients, setPatients] = useState([]);
    const [patientFilter, setPatientFilter] = useState('');
    const [loading, setLoading] = useState(true);

    // Load doctor and patients on mount
    useEffect(() => {
        loadDoctorAndPatients();
    }, [doctorId]);

    const loadDoctorAndPatients = async () => {
        try {
            setLoading(true);

            // Load doctor info (unless it's "all")
            if (doctorId !== 'all') {
                const doctorResponse = await fetch('/api/aligner/doctors');
                const doctorData = await doctorResponse.json();

                if (doctorData.success) {
                    const foundDoctor = doctorData.doctors.find(d => d.DrID === parseInt(doctorId));
                    setDoctor(foundDoctor || { DoctorName: 'Unknown Doctor' });
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

    const selectPatient = (patient) => {
        navigate(`/aligner/doctor/${doctorId}/patient/${patient.workid}`);
    };

    const backToDoctors = () => {
        navigate('/aligner');
    };

    const formatPatientName = (patient) => {
        return patient.PatientName || `${patient.FirstName} ${patient.LastName}`;
    };

    const getFilteredPatients = () => {
        if (!patientFilter.trim()) {
            return patients;
        }

        const query = patientFilter.toLowerCase();
        return patients.filter(p => {
            const name = formatPatientName(p).toLowerCase();
            const phone = (p.Phone || '').toLowerCase();
            const id = (p.patientID || '').toLowerCase();

            return name.includes(query) || phone.includes(query) || id.includes(query);
        });
    };

    if (loading) {
        return (
            <div className="aligner-container">
                <div className="loading-container">
                    <div className="spinner"></div>
                    <p>Loading patients...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="aligner-container">
            {/* Mode Toggle */}
            <div className="mode-toggle">
                <button className="mode-btn active">
                    <i className="fas fa-user-md"></i>
                    Browse by Doctor
                </button>
                <button
                    className="mode-btn"
                    onClick={() => navigate('/aligner/search')}
                >
                    <i className="fas fa-search"></i>
                    Quick Search
                </button>
            </div>

            {/* Breadcrumb */}
            <div className="breadcrumb">
                <button onClick={backToDoctors} className="breadcrumb-link">
                    <i className="fas fa-arrow-left"></i>
                    Back to Doctors
                </button>
            </div>

            <div className="section-header">
                <h2>
                    <i className="fas fa-user-md"></i>
                    {doctor?.DoctorName === 'Admin' ? doctor.DoctorName : `Dr. ${doctor?.DoctorName}`}'s Patients
                </h2>
                <div className="section-info">
                    <span>{patients.length} patient{patients.length !== 1 ? 's' : ''}</span>
                </div>
            </div>

            {/* Patient Filter Search */}
            {patients.length > 0 && (
                <div className="patient-filter-box">
                    <i className="fas fa-filter filter-icon"></i>
                    <input
                        type="text"
                        placeholder="Filter patients by name, phone, or ID..."
                        value={patientFilter}
                        onChange={(e) => setPatientFilter(e.target.value)}
                    />
                    {patientFilter && (
                        <button
                            className="clear-filter-btn"
                            onClick={() => setPatientFilter('')}
                        >
                            <i className="fas fa-times"></i>
                        </button>
                    )}
                </div>
            )}

            {/* Patients Grid */}
            {getFilteredPatients().length === 0 ? (
                <div className="empty-patients">
                    <i className="fas fa-users"></i>
                    <h3>{patientFilter ? 'No matching patients found' : 'No patients with aligner sets'}</h3>
                    {patientFilter && (
                        <button
                            className="btn-clear"
                            onClick={() => setPatientFilter('')}
                            style={{ marginTop: '1rem' }}
                        >
                            Clear Filter
                        </button>
                    )}
                </div>
            ) : (
                <div className="patients-grid">
                    {getFilteredPatients().map((patient) => (
                        <div
                            key={patient.PersonID}
                            className={`patient-card ${patient.UnreadDoctorNotes > 0 ? 'has-activity' : ''}`}
                            onClick={() => selectPatient(patient)}
                        >
                            {patient.UnreadDoctorNotes > 0 && (
                                <div className="activity-banner">
                                    <i className="fas fa-bell"></i>
                                    <strong>{patient.UnreadDoctorNotes}</strong> unread {patient.UnreadDoctorNotes === 1 ? 'note' : 'notes'}
                                </div>
                            )}
                            <div className="patient-card-header">
                                <div className="patient-card-photo">
                                    <img
                                        src={`/DolImgs/${patient.PersonID}00.i13`}
                                        alt={`${formatPatientName(patient)} - Smile`}
                                        onError={(e) => {
                                            e.target.style.display = 'none';
                                            e.target.nextElementSibling.style.display = 'flex';
                                        }}
                                    />
                                    <div className="patient-photo-placeholder" style={{ display: 'none' }}>
                                        <i className="fas fa-user"></i>
                                    </div>
                                </div>
                                <div>
                                    <h3>{formatPatientName(patient)}</h3>
                                    {patient.PatientName && patient.FirstName && (
                                        <p className="patient-card-subtitle">
                                            {patient.FirstName} {patient.LastName}
                                        </p>
                                    )}
                                </div>
                            </div>
                            <div className="patient-card-meta">
                                <span><i className="fas fa-id-card"></i> {patient.patientID || 'N/A'}</span>
                                <span><i className="fas fa-phone"></i> {patient.Phone || 'N/A'}</span>
                            </div>
                            <div className="patient-card-stats">
                                <div className="stat">
                                    <i className="fas fa-box"></i>
                                    <span>{patient.TotalSets || 0} Sets</span>
                                </div>
                                <div className="stat active">
                                    <i className="fas fa-check-circle"></i>
                                    <span>{patient.ActiveSets || 0} Active</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default PatientsList;
