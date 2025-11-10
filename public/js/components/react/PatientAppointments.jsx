import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * PatientAppointments Component
 * Display and manage all appointments for a specific patient
 */
const PatientAppointments = ({ patientId }) => {
    const navigate = useNavigate()
    const [appointments, setAppointments] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [deleteConfirm, setDeleteConfirm] = useState(null)

    useEffect(() => {
        loadAppointments()
    }, [patientId])

    const loadAppointments = async () => {
        try {
            setLoading(true)
            setError(null)
            const response = await fetch(`/api/patient-appointments/${patientId}`)

            if (!response.ok) {
                throw new Error('Failed to load appointments')
            }

            const data = await response.json()
            setAppointments(data.appointments || [])
        } catch (err) {
            console.error('Error loading appointments:', err)
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const handleEdit = (appointment) => {
        // Navigate to edit page with appointment data as state
        navigate(`/patient/${patientId}/edit-appointment/${appointment.appointmentID}`, {
            state: { appointment }
        })
    }

    const handleDelete = async (appointmentId) => {
        try {
            const response = await fetch(`/api/appointments/${appointmentId}`, {
                method: 'DELETE'
            })

            if (!response.ok) {
                throw new Error('Failed to delete appointment')
            }

            // Reload appointments after deletion
            await loadAppointments()
            setDeleteConfirm(null)
        } catch (err) {
            console.error('Error deleting appointment:', err)
            alert('Failed to delete appointment: ' + err.message)
        }
    }

    const formatDateTime = (dateTime) => {
        const date = new Date(dateTime)

        // Get day name
        const dayName = date.toLocaleString('en-US', { weekday: 'short' })

        // Get date components
        const day = String(date.getDate()).padStart(2, '0')
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const year = date.getFullYear()

        // Get time
        const time = date.toLocaleString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        })

        // Format: "Mon 25/12/2024 2:30 PM"
        return `${dayName} ${day}/${month}/${year} ${time}`
    }

    const isPastAppointment = (dateTime) => {
        return new Date(dateTime) < new Date()
    }

    if (loading) {
        return (
            <div className="patient-appointments-container">
                <div className="loading-state">
                    <i className="fas fa-spinner fa-spin"></i>
                    <p>Loading appointments...</p>
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="patient-appointments-container">
                <div className="error-state">
                    <i className="fas fa-exclamation-circle"></i>
                    <p>{error}</p>
                    <button onClick={loadAppointments} className="btn btn-retry">
                        <i className="fas fa-redo"></i> Retry
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div className="patient-appointments-container">
            <div className="appointments-header">
                <h2>
                    <i className="fas fa-calendar-check"></i> Patient Appointments
                </h2>
                <button
                    className="btn btn-new-appointment"
                    onClick={() => navigate(`/patient/${patientId}/new-appointment`)}
                >
                    <i className="fas fa-plus"></i> New Appointment
                </button>
            </div>

            {appointments.length === 0 ? (
                <div className="empty-state">
                    <i className="fas fa-calendar-times"></i>
                    <h3>No Appointments</h3>
                    <p>This patient has no appointments scheduled.</p>
                    <button
                        className="btn btn-new-appointment"
                        onClick={() => navigate(`/patient/${patientId}/new-appointment`)}
                    >
                        <i className="fas fa-plus"></i> Schedule First Appointment
                    </button>
                </div>
            ) : (
                <div className="appointments-list">
                    {appointments.map(appointment => {
                        const isPast = isPastAppointment(appointment.AppDate)

                        return (
                            <div
                                key={appointment.appointmentID}
                                className={`appointment-card ${isPast ? 'past' : 'upcoming'}`}
                            >
                                <div className="appointment-main">
                                    <div className="appointment-icon">
                                        <i className={`fas ${isPast ? 'fa-check-circle' : 'fa-calendar'}`}></i>
                                    </div>
                                    <div className="appointment-details">
                                        <div className="appointment-date">
                                            {formatDateTime(appointment.AppDate)}
                                        </div>
                                        <div className="appointment-type">
                                            {appointment.AppDetail || 'No details'}
                                        </div>
                                        {appointment.DrName && (
                                            <div className="appointment-doctor">
                                                <i className="fas fa-user-md"></i> {appointment.DrName}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="appointment-actions">
                                    {!isPast && (
                                        <button
                                            className="btn-edit"
                                            onClick={() => handleEdit(appointment)}
                                            title="Edit appointment"
                                        >
                                            <i className="fas fa-edit"></i>
                                        </button>
                                    )}
                                    <button
                                        className="btn-delete"
                                        onClick={() => setDeleteConfirm(appointment.appointmentID)}
                                        title="Delete appointment"
                                    >
                                        <i className="fas fa-trash"></i>
                                    </button>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deleteConfirm && (
                <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <h3>
                            <i className="fas fa-exclamation-triangle"></i> Confirm Delete
                        </h3>
                        <p>Are you sure you want to delete this appointment?</p>
                        <div className="modal-actions">
                            <button
                                className="btn btn-cancel"
                                onClick={() => setDeleteConfirm(null)}
                            >
                                Cancel
                            </button>
                            <button
                                className="btn btn-delete"
                                onClick={() => handleDelete(deleteConfirm)}
                            >
                                <i className="fas fa-trash"></i> Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
                .patient-appointments-container {
                    padding: 2rem;
                    max-width: 1200px;
                    margin: 0 auto;
                }

                .appointments-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 2rem;
                    gap: 1rem;
                    flex-wrap: wrap;
                }

                .appointments-header h2 {
                    margin: 0;
                    font-size: 1.75rem;
                    color: #1f2937;
                    flex: 1;
                    min-width: 200px;
                }

                .appointments-header h2 i {
                    margin-right: 0.75rem;
                    color: #3b82f6;
                }

                .btn-new-appointment {
                    background: #3b82f6;
                    color: white;
                    border: none;
                    padding: 0.75rem 1.5rem;
                    border-radius: 0.5rem;
                    cursor: pointer;
                    font-size: 1rem;
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    transition: all 0.2s;
                    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
                    white-space: nowrap;
                    flex-shrink: 0;
                }

                .btn-new-appointment:hover {
                    background: #2563eb;
                    transform: translateY(-1px);
                    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.15);
                }

                .appointments-list {
                    display: flex;
                    flex-direction: column;
                    gap: 1rem;
                }

                .appointment-card {
                    background: white;
                    border: 1px solid #e5e7eb;
                    border-radius: 0.75rem;
                    padding: 1.5rem;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    transition: box-shadow 0.2s;
                }

                .appointment-card:hover {
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
                }

                .appointment-card.past {
                    opacity: 0.7;
                    background: #f9fafb;
                }

                .appointment-main {
                    display: flex;
                    align-items: center;
                    gap: 1.5rem;
                }

                .appointment-icon {
                    font-size: 2rem;
                    color: #3b82f6;
                }

                .appointment-card.past .appointment-icon {
                    color: #6b7280;
                }

                .appointment-details {
                    display: flex;
                    flex-direction: column;
                    gap: 0.5rem;
                }

                .appointment-date {
                    font-size: 1.125rem;
                    font-weight: 600;
                    color: #1f2937;
                }

                .appointment-type {
                    color: #6b7280;
                    font-size: 0.95rem;
                }

                .appointment-doctor {
                    color: #059669;
                    font-size: 0.9rem;
                    display: flex;
                    align-items: center;
                    gap: 0.25rem;
                }

                .appointment-actions {
                    display: flex;
                    gap: 0.5rem;
                    flex-shrink: 0;
                }

                .btn-edit {
                    background: #10b981;
                    color: white;
                    border: none;
                    padding: 0.5rem 1rem;
                    border-radius: 0.375rem;
                    cursor: pointer;
                    transition: all 0.2s;
                    display: flex;
                    align-items: center;
                    gap: 0.25rem;
                }

                .btn-edit:hover {
                    background: #059669;
                    transform: translateY(-1px);
                }

                .btn-delete {
                    background: #ef4444;
                    color: white;
                    border: none;
                    padding: 0.5rem 1rem;
                    border-radius: 0.375rem;
                    cursor: pointer;
                    transition: all 0.2s;
                    display: flex;
                    align-items: center;
                    gap: 0.25rem;
                }

                .btn-delete:hover {
                    background: #dc2626;
                    transform: translateY(-1px);
                }

                .empty-state, .loading-state, .error-state {
                    text-align: center;
                    padding: 4rem 2rem;
                    color: #6b7280;
                }

                .empty-state i, .loading-state i, .error-state i {
                    font-size: 4rem;
                    margin-bottom: 1rem;
                    color: #9ca3af;
                }

                .empty-state h3 {
                    font-size: 1.5rem;
                    color: #1f2937;
                    margin-bottom: 0.5rem;
                }

                .modal-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.5);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 1000;
                }

                .modal-content {
                    background: white;
                    padding: 2rem;
                    border-radius: 0.75rem;
                    max-width: 400px;
                    width: 90%;
                }

                .modal-content h3 {
                    margin: 0 0 1rem 0;
                    color: #dc2626;
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                }

                .modal-actions {
                    display: flex;
                    gap: 1rem;
                    margin-top: 1.5rem;
                }

                .btn {
                    flex: 1;
                    padding: 0.75rem;
                    border-radius: 0.5rem;
                    border: none;
                    cursor: pointer;
                    font-size: 1rem;
                }

                .btn-cancel {
                    background: #e5e7eb;
                    color: #1f2937;
                }

                .btn-cancel:hover {
                    background: #d1d5db;
                }

                .btn-retry {
                    background: #3b82f6;
                    color: white;
                    margin-top: 1rem;
                }

                .btn-retry:hover {
                    background: #2563eb;
                }
            `}</style>
        </div>
    )
}

export default PatientAppointments
