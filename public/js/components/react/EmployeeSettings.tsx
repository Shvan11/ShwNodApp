import { useState, useEffect, ChangeEvent, FormEvent } from 'react';
import cn from 'classnames';
import { useToast } from '../../contexts/ToastContext';
import styles from './EmployeeSettings.module.css';

interface Position {
    ID: number;
    PositionName: string;
}

interface Employee {
    ID: number;
    employeeName: string;
    Position: number | string;
    Email: string | null;
    Percentage: boolean;
    receiveEmail: boolean;
    getAppointments: boolean;
    SortOrder: number | string | null;
}

interface FormData {
    employeeName: string;
    Position: string;
    Email: string;
    Percentage: boolean;
    receiveEmail: boolean;
    getAppointments: boolean;
    SortOrder: string;
}

interface EmployeeSettingsProps {
    onChangesUpdate?: (hasChanges: boolean) => void;
}

const EmployeeSettings = ({ onChangesUpdate }: EmployeeSettingsProps) => {
    const toast = useToast();
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [positions, setPositions] = useState<Position[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [showAddForm, setShowAddForm] = useState(false);
    const [formData, setFormData] = useState<FormData>({
        employeeName: '',
        Position: '',
        Email: '',
        Percentage: false,
        receiveEmail: false,
        getAppointments: false,
        SortOrder: ''
    });
    const [activeTab, setActiveTab] = useState<'basic' | 'other'>('basic');

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
            setError((err as Error).message);
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

    const handleEdit = (employee: Employee) => {
        setFormData({
            employeeName: employee.employeeName || '',
            Position: String(employee.Position || ''),
            Email: employee.Email || '',
            Percentage: employee.Percentage || false,
            receiveEmail: employee.receiveEmail || false,
            getAppointments: employee.getAppointments || false,
            SortOrder: String(employee.SortOrder || '')
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

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
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
            toast.error((err as Error).message);
        }
    };

    const handleDelete = async (employeeId: number, employeeName: string) => {
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
            toast.error((err as Error).message);
        }
    };

    const handleInputChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const target = e.target;
        const name = target.name;
        const value = target.type === 'checkbox' ? (target as HTMLInputElement).checked : target.value;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const getPositionName = (positionId: number | string): string => {
        const position = positions.find(p => p.ID === Number(positionId));
        return position ? position.PositionName : 'Unknown';
    };

    if (loading) {
        return (
            <div className={styles.container}>
                <div className={styles.loadingContainer}>
                    <i className="fas fa-spinner fa-spin"></i>
                    <p>Loading employees...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.container}>
                <div className={styles.errorContainer}>
                    <i className="fas fa-exclamation-triangle"></i>
                    <p>Error: {error}</p>
                    <button onClick={loadEmployees} className={styles.btnRetry}>
                        <i className="fas fa-redo"></i> Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.sectionHeader}>
                <div className={styles.headerContent}>
                    <h2>
                        <i className="fas fa-users"></i>
                        Employee Management
                    </h2>
                    <p className={styles.sectionDescription}>
                        Manage staff members and configure email notification preferences
                    </p>
                </div>
                <button
                    className={styles.btnAdd}
                    onClick={handleAdd}
                    disabled={showAddForm}
                >
                    <i className="fas fa-plus"></i>
                    Add Employee
                </button>
            </div>

            {showAddForm && (
                <div className={styles.modalOverlay}>
                    <div className={styles.modal}>
                        <div className={styles.modalHeader}>
                            <h3>
                                <i className={editingId ? 'fas fa-edit' : 'fas fa-plus'}></i>
                                {editingId ? 'Edit Employee' : 'Add New Employee'}
                            </h3>
                            <button className={styles.modalClose} onClick={handleCancel} aria-label="Close">
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        <form onSubmit={handleSubmit}>
                            <div className={styles.modalBody}>
                                <div className={styles.tabs}>
                                    <button
                                        type="button"
                                        className={cn(styles.tabBtn, activeTab === 'basic' && styles.active)}
                                        onClick={() => setActiveTab('basic')}
                                    >
                                        <i className="fas fa-id-card"></i> Basic Info
                                    </button>
                                    <button
                                        type="button"
                                        className={cn(styles.tabBtn, activeTab === 'other' && styles.active)}
                                        onClick={() => setActiveTab('other')}
                                    >
                                        <i className="fas fa-sliders-h"></i> Other Options
                                    </button>
                                </div>

                                <div className={styles.tabContent}>
                                    {activeTab === 'basic' && (
                                        <div>
                                            <div className={styles.formRow}>
                                                <div className={styles.formGroup}>
                                                    <label htmlFor="employeeName">
                                                        Employee Name <span className={styles.required}>*</span>
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

                                                <div className={styles.formGroup}>
                                                    <label htmlFor="Position">
                                                        Position <span className={styles.required}>*</span>
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

                                            <div className={styles.formRow}>
                                                <div className={styles.formGroup}>
                                                    <label htmlFor="SortOrder">
                                                        Sort Order
                                                        <span className={styles.fieldHelp}>
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
                                                <div className={styles.formGroup}>
                                                    {/* Empty placeholder for grid alignment */}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {activeTab === 'other' && (
                                        <div>
                                            <div className={styles.formRow}>
                                                <div className={styles.formGroup}>
                                                    <label htmlFor="Email">
                                                        Email Address
                                                        <span className={styles.fieldHelp}>
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
                                                <div className={styles.formGroup}>
                                                    {/* Empty placeholder */}
                                                </div>
                                            </div>

                                            <div className={styles.checkboxGroup}>
                                                <div className={styles.checkboxItem}>
                                                    <label>
                                                        <input
                                                            type="checkbox"
                                                            name="receiveEmail"
                                                            checked={formData.receiveEmail}
                                                            onChange={handleInputChange}
                                                        />
                                                        <span className={styles.checkboxLabel}>
                                                            <i className="fas fa-envelope"></i>
                                                            Receive Email Notifications
                                                        </span>
                                                    </label>
                                                </div>

                                                <div className={styles.checkboxItem}>
                                                    <label>
                                                        <input
                                                            type="checkbox"
                                                            name="getAppointments"
                                                            checked={formData.getAppointments}
                                                            onChange={handleInputChange}
                                                        />
                                                        <span className={styles.checkboxLabel}>
                                                            <i className="fas fa-calendar-check"></i>
                                                            Include in Appointment Reports
                                                        </span>
                                                    </label>
                                                </div>

                                                <div className={styles.checkboxItem}>
                                                    <label>
                                                        <input
                                                            type="checkbox"
                                                            name="Percentage"
                                                            checked={formData.Percentage}
                                                            onChange={handleInputChange}
                                                        />
                                                        <span className={styles.checkboxLabel}>
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
                            <div className={styles.modalFooter}>
                                <button type="button" onClick={handleCancel} className={styles.btnCancel}>
                                    Cancel
                                </button>
                                <button type="submit" className={styles.btnSave}>
                                    <i className="fas fa-save"></i>
                                    {editingId ? 'Update Employee' : 'Add Employee'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <div className={styles.list}>
                {employees.length === 0 ? (
                    <div className={styles.emptyState}>
                        <i className="fas fa-users"></i>
                        <p>No employees found</p>
                        <p className={styles.emptyStateHint}>Click "Add Employee" to create your first employee entry</p>
                    </div>
                ) : (
                    <div className={styles.tableContainer}>
                        <table className={styles.table}>
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
                                        <td data-label="Name" className={styles.employeeName}>
                                            <i className="fas fa-user"></i>
                                            {employee.employeeName}
                                        </td>
                                        <td data-label="Position">
                                            <span className={styles.positionBadge}>
                                                {getPositionName(employee.Position)}
                                            </span>
                                        </td>
                                        <td data-label="Sort Order">
                                            <span className={styles.sortOrderValue}>
                                                {employee.SortOrder || '—'}
                                            </span>
                                        </td>
                                        <td data-label="Email">
                                            {employee.Email ? (
                                                <span className={styles.emailValue}>
                                                    <i className="fas fa-envelope"></i>
                                                    {employee.Email}
                                                </span>
                                            ) : (
                                                <span className={styles.noEmail}>No email</span>
                                            )}
                                        </td>
                                        <td data-label="Commission">
                                            {employee.Percentage ? (
                                                <span className={`${styles.badge} ${styles.badgeSuccess}`}>
                                                    <i className="fas fa-percent"></i>
                                                    Yes
                                                </span>
                                            ) : (
                                                <span className={`${styles.badge} ${styles.badgeMuted}`}>
                                                    <i className="fas fa-minus"></i>
                                                    No
                                                </span>
                                            )}
                                        </td>
                                        <td data-label="Email Notifications">
                                            {employee.receiveEmail ? (
                                                <span className={`${styles.badge} ${styles.badgeSuccess}`}>
                                                    <i className="fas fa-check-circle"></i>
                                                    Enabled
                                                </span>
                                            ) : (
                                                <span className={`${styles.badge} ${styles.badgeMuted}`}>
                                                    <i className="fas fa-times-circle"></i>
                                                    Disabled
                                                </span>
                                            )}
                                        </td>
                                        <td data-label="Appointments">
                                            {employee.getAppointments ? (
                                                <span className={`${styles.badge} ${styles.badgeInfo}`}>
                                                    <i className="fas fa-check"></i>
                                                    Yes
                                                </span>
                                            ) : (
                                                <span className={`${styles.badge} ${styles.badgeMuted}`}>
                                                    <i className="fas fa-minus"></i>
                                                    No
                                                </span>
                                            )}
                                        </td>
                                        <td data-label="Actions" className={styles.actions}>
                                            <button
                                                className={`${styles.btnIcon} ${styles.btnEdit}`}
                                                onClick={() => handleEdit(employee)}
                                                title="Edit employee"
                                            >
                                                <i className="fas fa-edit"></i>
                                            </button>
                                            <button
                                                className={`${styles.btnIcon} ${styles.btnDelete}`}
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
