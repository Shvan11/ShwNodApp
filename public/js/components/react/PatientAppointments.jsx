import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../../contexts/ToastContext.jsx';
import '../../../css/components/patient-appointments.css';

/**
 * PatientAppointments Component
 * Display and manage all appointments for a specific patient
 */
const PatientAppointments = ({ patientId }) => {
    const navigate = useNavigate()
    const toast = useToast();
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
            toast.error('Failed to delete appointment: ' + err.message)
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
                                            Edit
                                        </button>
                                    )}
                                    <button
                                        className="btn-delete"
                                        onClick={() => setDeleteConfirm(appointment.appointmentID)}
                                        title="Delete appointment"
                                    >
                                        Delete
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
                                className="btn-delete"
                                onClick={() => handleDelete(deleteConfirm)}
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default PatientAppointments
