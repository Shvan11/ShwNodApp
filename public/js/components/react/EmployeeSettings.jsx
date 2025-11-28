import React, { useState, useEffect } from 'react';
import { useToast } from '../../contexts/ToastContext.jsx';

const EmployeeSettings = ({ onChangesUpdate }) => {
    const toast = useToast();
    const [employees, setEmployees] = useState([]);
    const [positions, setPositions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [editingId, setEditingId] = useState(null);
    const [showAddForm, setShowAddForm] = useState(false);
    const [formData, setFormData] = useState({
        employeeName: '',
        Position: '',
        Email: '',
        Percentage: false,
        receiveEmail: false,
        getAppointments: false,
        getAppointments: false,
        SortOrder: ''
    });
    const [activeTab, setActiveTab] = useState('basic');

    // Load employees and positions on component mount
    useEffect(() => {
        loadEmployees();
        loadPositions();
    }, []);

    const loadEmployees = async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await fetch('/api/employees');

            if (!response.ok) {
                throw new Error('Failed to load employees');
            }

            const data = await response.json();
            setEmployees(data.employees || []);
        } catch (err) {
            console.error('Error loading employees:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const loadPositions = async () => {
        try {
            const response = await fetch('/api/positions');
            if (response.ok) {
                const data = await response.json();
                setPositions(data.positions || []);
            }
        } catch (err) {
            console.error('Error loading positions:', err);
        }
    };

    const handleAdd = () => {
        setFormData({
            employeeName: '',
            Position: '',
            Email: '',
            Percentage: false,
            receiveEmail: false,
            getAppointments: false,
            SortOrder: ''
        });
        setEditingId(null);
        setActiveTab('basic');
        setShowAddForm(true);
    };

    const handleEdit = (employee) => {
        setFormData({
            employeeName: employee.employeeName || '',
            Position: employee.Position || '',
            Email: employee.Email || '',
            Percentage: employee.Percentage || false,
            receiveEmail: employee.receiveEmail || false,
            getAppointments: employee.getAppointments || false,
            SortOrder: employee.SortOrder || ''
        });
        setEditingId(employee.ID);
        setActiveTab('basic');
        setShowAddForm(true);
    };

    const handleCancel = () => {
        setFormData({
            employeeName: '',
            Position: '',
            Email: '',
            Percentage: false,
            receiveEmail: false,
            getAppointments: false,
            SortOrder: ''
        });
        setEditingId(null);
        setShowAddForm(false);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        try {
            const url = editingId
                ? `/api/employees/${editingId}`
                : '/api/employees';

            const method = editingId ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to save employee');
            }

            await loadEmployees();
            handleCancel();

            toast.success(editingId ? 'Employee updated successfully!' : 'Employee added successfully!');
        } catch (err) {
            console.error('Error saving employee:', err);
            toast.error(err.message);
        }
    };

    const handleDelete = async (employeeId, employeeName) => {
        if (!confirm(`Are you sure you want to delete ${employeeName}?`)) {
            return;
        }

        try {
            const response = await fetch(`/api/employees/${employeeId}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to delete employee');
            }

            await loadEmployees();
            toast.success('Employee deleted successfully!');
        } catch (err) {
            console.error('Error deleting employee:', err);
            toast.error(err.message);
        }
    };

    const handleInputChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const getPositionName = (positionId) => {
        const position = positions.find(p => p.ID === positionId);
        return position ? position.PositionName : 'Unknown';
    };

    if (loading) {
        return (
            <div className="settings-section">
                <div className="loading-container">
                    <i className="fas fa-spinner fa-spin"></i>
                    <p>Loading employees...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="settings-section">
                <div className="error-container">
                    <i className="fas fa-exclamation-triangle"></i>
                    <p>Error: {error}</p>
                    <button onClick={loadEmployees} className="btn-retry">
                        <i className="fas fa-redo"></i> Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="settings-section employee-settings">
            <div className="section-header">
                <div className="header-content">
                    <h2>
                        <i className="fas fa-users"></i>
                        Employee Management
                    </h2>
                    <p className="section-description">
                        Manage staff members and configure email notification preferences
                    </p>
                </div>
                <button
                    className="btn-add-doctor"
                    onClick={handleAdd}
                    disabled={showAddForm}
                >
                    <i className="fas fa-plus"></i>
                    Add Employee
                </button>
            </div>

            {showAddForm && (
                <div className="modal-overlay">
                    <div className="modal-content employee-modal">
                        <div className="modal-header">
                            <h3>
                                <i className={editingId ? 'fas fa-edit' : 'fas fa-plus'}></i>
                                {editingId ? 'Edit Employee' : 'Add New Employee'}
                            </h3>
                            <button className="modal-close" onClick={handleCancel} aria-label="Close">
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        <form onSubmit={handleSubmit}>
                            <div className="modal-body">
                                <div className="employee-tabs">
                                    <button
                                        type="button"
                                        className={`employee-tab-btn ${activeTab === 'basic' ? 'active' : ''}`}
                                        onClick={() => setActiveTab('basic')}
                                    >
                                        <i className="fas fa-id-card"></i> Basic Info
                                    </button>
                                    <button
                                        type="button"
                                        className={`employee-tab-btn ${activeTab === 'other' ? 'active' : ''}`}
                                        onClick={() => setActiveTab('other')}
                                    >
                                        <i className="fas fa-sliders-h"></i> Other Options
                                    </button>
                                </div>

                                <div className="employee-tab-content">
                                    {activeTab === 'basic' && (
                                        <div className="tab-pane">
                                            <div className="employee-form-row">
                                                <div className="form-group">
                                                    <label htmlFor="employeeName">
                                                        Employee Name <span className="required">*</span>
                                                    </label>
                                                    <input
                                                        type="text"
                                                        id="employeeName"
                                                        name="employeeName"
                                                        value={formData.employeeName}
                                                        onChange={handleInputChange}
                                                        required
                                                        placeholder="e.g., John Smith"
                                                    />
                                                </div>

                                                <div className="form-group">
                                                    <label htmlFor="Position">
                                                        Position <span className="required">*</span>
                                                    </label>
                                                    <select
                                                        id="Position"
                                                        name="Position"
                                                        value={formData.Position}
                                                        onChange={handleInputChange}
                                                        required
                                                    >
                                                        <option value="">Select a position</option>
                                                        {positions.map(pos => (
                                                            <option key={pos.ID} value={pos.ID}>
                                                                {pos.PositionName}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>

                                            <div className="employee-form-row">
                                                <div className="form-group">
                                                    <label htmlFor="SortOrder">
                                                        Sort Order
                                                        <span className="field-help">
                                                            (Lower numbers appear first)
                                                        </span>
                                                    </label>
                                                    <input
                                                        type="number"
                                                        id="SortOrder"
                                                        name="SortOrder"
                                                        value={formData.SortOrder}
                                                        onChange={handleInputChange}
                                                        placeholder="e.g., 1"
                                                        min="1"
                                                        max="999"
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    {/* Empty placeholder for grid alignment */}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {activeTab === 'other' && (
                                        <div className="tab-pane">
                                            <div className="employee-form-row">
                                                <div className="form-group">
                                                    <label htmlFor="Email">
                                                        Email Address
                                                        <span className="field-help">
                                                            (Required for notifications)
                                                        </span>
                                                    </label>
                                                    <input
                                                        type="email"
                                                        id="Email"
                                                        name="Email"
                                                        value={formData.Email}
                                                        onChange={handleInputChange}
                                                        placeholder="employee@example.com"
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    {/* Empty placeholder */}
                                                </div>
                                            </div>

                                            <div className="employee-checkbox-group">
                                                <div className="form-group-checkbox">
                                                    <label>
                                                        <input
                                                            type="checkbox"
                                                            name="receiveEmail"
                                                            checked={formData.receiveEmail}
                                                            onChange={handleInputChange}
                                                        />
                                                        <span className="checkbox-label">
                                                            <i className="fas fa-envelope"></i>
                                                            Receive Email Notifications
                                                        </span>
                                                    </label>
                                                </div>

                                                <div className="form-group-checkbox">
                                                    <label>
                                                        <input
                                                            type="checkbox"
                                                            name="getAppointments"
                                                            checked={formData.getAppointments}
                                                            onChange={handleInputChange}
                                                        />
                                                        <span className="checkbox-label">
                                                            <i className="fas fa-calendar-check"></i>
                                                            Include in Appointment Reports
                                                        </span>
                                                    </label>
                                                </div>

                                                <div className="form-group-checkbox">
                                                    <label>
                                                        <input
                                                            type="checkbox"
                                                            name="Percentage"
                                                            checked={formData.Percentage}
                                                            onChange={handleInputChange}
                                                        />
                                                        <span className="checkbox-label">
                                                            <i className="fas fa-percent"></i>
                                                            Percentage-Based Compensation
                                                        </span>
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button type="button" onClick={handleCancel} className="btn-cancel">
                                    Cancel
                                </button>
                                <button type="submit" className="btn-save">
                                    <i className="fas fa-save"></i>
                                    {editingId ? 'Update Employee' : 'Add Employee'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <div className="doctors-list">
                {employees.length === 0 ? (
                    <div className="empty-state">
                        <i className="fas fa-users"></i>
                        <p>No employees found</p>
                        <p className="empty-state-hint">Click "Add Employee" to create your first employee entry</p>
                    </div>
                ) : (
                    <div className="doctors-table-container">
                        <table className="doctors-table">
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>Name</th>
                                    <th>Position</th>
                                    <th>Sort Order</th>
                                    <th>Email</th>
                                    <th>Commission</th>
                                    <th>Email Notifications</th>
                                    <th>Appointments</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {employees.map(employee => (
                                    <tr key={employee.ID}>
                                        <td data-label="ID">{employee.ID}</td>
                                        <td data-label="Name" className="doctor-name">
                                            <i className="fas fa-user"></i>
                                            {employee.employeeName}
                                        </td>
                                        <td data-label="Position">
                                            <span className="position-badge">
                                                {getPositionName(employee.Position)}
                                            </span>
                                        </td>
                                        <td data-label="Sort Order">
                                            <span className="sort-order-value">
                                                {employee.SortOrder || '—'}
                                            </span>
                                        </td>
                                        <td data-label="Email">
                                            {employee.Email ? (
                                                <span className="email-value">
                                                    <i className="fas fa-envelope"></i>
                                                    {employee.Email}
                                                </span>
                                            ) : (
                                                <span className="no-email">No email</span>
                                            )}
                                        </td>
                                        <td data-label="Commission">
                                            {employee.Percentage ? (
                                                <span className="badge badge-success">
                                                    <i className="fas fa-percent"></i>
                                                    Yes
                                                </span>
                                            ) : (
                                                <span className="badge badge-muted">
                                                    <i className="fas fa-minus"></i>
                                                    No
                                                </span>
                                            )}
                                        </td>
                                        <td data-label="Email Notifications">
                                            {employee.receiveEmail ? (
                                                <span className="badge badge-success">
                                                    <i className="fas fa-check-circle"></i>
                                                    Enabled
                                                </span>
                                            ) : (
                                                <span className="badge badge-muted">
                                                    <i className="fas fa-times-circle"></i>
                                                    Disabled
                                                </span>
                                            )}
                                        </td>
                                        <td data-label="Appointments">
                                            {employee.getAppointments ? (
                                                <span className="badge badge-info">
                                                    <i className="fas fa-check"></i>
                                                    Yes
                                                </span>
                                            ) : (
                                                <span className="badge badge-muted">
                                                    <i className="fas fa-minus"></i>
                                                    No
                                                </span>
                                            )}
                                        </td>
                                        <td data-label="Actions" className="actions">
                                            <button
                                                className="btn-icon btn-edit"
                                                onClick={() => handleEdit(employee)}
                                                title="Edit employee"
                                            >
                                                <i className="fas fa-edit"></i>
                                            </button>
                                            <button
                                                className="btn-icon btn-delete"
                                                onClick={() => handleDelete(employee.ID, employee.employeeName)}
                                                title="Delete employee"
                                            >
                                                <i className="fas fa-trash"></i>
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default EmployeeSettings;
