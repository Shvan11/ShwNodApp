import { useState, useEffect, useRef, useCallback, ChangeEvent, FormEvent } from 'react';
import cn from 'classnames';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { fetchJSON, postJSON, putJSON, deleteJSON, httpErrorMessage } from '@/core/http';
import * as employeeContract from '@shared/contracts/employee.contract';
import Modal from './Modal';
import { resolveDoctorColor, DEFAULT_PICKER_HEX, NEUTRAL_PICKER_HEX } from './doctorColors';
import styles from './EmployeeSettings.module.css';

interface Position {
    id: number;
    position_name: string;
}

interface Employee {
    id: number;
    employee_name: string;
    position: number | string;
    position_name: string | null;
    email: string | null;
    phone: string | null;
    percentage: boolean;
    receive_email: boolean;
    get_appointments: boolean;
    is_active: boolean;
    sort_order: number | string | null;
    appointment_color: string | null;
}

interface FormData {
    employee_name: string;
    position: string;
    email: string;
    phone: string;
    percentage: boolean;
    receiveEmail: boolean;
    getAppointments: boolean;
    is_active: boolean;
    sort_order: string;
    appointment_color: string;
}

interface EmployeeSettingsProps {
    onChangesUpdate?: (hasChanges: boolean) => void;
}

const EmployeeSettings = ({ onChangesUpdate: _onChangesUpdate }: EmployeeSettingsProps) => {
    const toast = useToast();
    const confirm = useConfirm();
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [positions, setPositions] = useState<Position[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [showAddForm, setShowAddForm] = useState(false);
    const [formData, setFormData] = useState<FormData>({
        employee_name: '',
        position: '',
        email: '',
        phone: '',
        percentage: false,
        receiveEmail: false,
        getAppointments: false,
        is_active: true,
        sort_order: '',
        appointment_color: ''
    });
    const [activeTab, setActiveTab] = useState<'basic' | 'other'>('basic');
    // Right-click menu on the employee name → Edit/Delete without horizontal-
    // scrolling the wide table to reach the Actions column.
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; employee: Employee } | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const closeContextMenu = useCallback(() => setContextMenu(null), []);

    // Load employees and positions on component mount
    useEffect(() => {
        loadEmployees();
        loadPositions();
    }, []);

    // Close the right-click menu on outside-click or Escape (only while open).
    useEffect(() => {
        if (!contextMenu) return;
        const handleOutside = (event: MouseEvent): void => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) closeContextMenu();
        };
        const handleEsc = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') closeContextMenu();
        };
        // Defer the outside listener a frame so the opening right-click doesn't close it.
        const raf = requestAnimationFrame(() => document.addEventListener('mousedown', handleOutside));
        document.addEventListener('keydown', handleEsc);
        return () => {
            cancelAnimationFrame(raf);
            document.removeEventListener('mousedown', handleOutside);
            document.removeEventListener('keydown', handleEsc);
        };
    }, [contextMenu, closeContextMenu]);

    const loadEmployees = async () => {
        try {
            setLoading(true);
            setError(null);
            // Settings is the ONLY place quit (inactive) employees appear — they are
            // hidden everywhere else, so opt back in here to manage them.
            const data = await fetchJSON<{ employees?: Employee[] }>('/api/employees?includeInactive=true', { schema: employeeContract.employees.response });
            setEmployees(data.employees || []);
        } catch (err) {
            console.error('Error loading employees:', err);
            setError(httpErrorMessage(err, 'Failed to load employees'));
        } finally {
            setLoading(false);
        }
    };

    const loadPositions = async () => {
        try {
            const data = await fetchJSON<{ positions?: Position[] }>('/api/positions', { schema: employeeContract.positions.response });
            setPositions(data.positions || []);
        } catch (err) {
            console.error('Error loading positions:', err);
        }
    };

    const handleAdd = () => {
        setFormData({
            employee_name: '',
            position: '',
            email: '',
            phone: '',
            percentage: false,
            receiveEmail: false,
            getAppointments: false,
            is_active: true,
            sort_order: '',
            appointment_color: ''
        });
        setEditingId(null);
        setActiveTab('basic');
        setShowAddForm(true);
    };

    const handleEdit = (employee: Employee) => {
        setFormData({
            employee_name: employee.employee_name || '',
            position: String(employee.position || ''),
            email: employee.email || '',
            phone: employee.phone || '',
            percentage: employee.percentage || false,
            receiveEmail: employee.receive_email || false,
            getAppointments: employee.get_appointments || false,
            is_active: employee.is_active ?? true,
            sort_order: String(employee.sort_order || ''),
            appointment_color: employee.appointment_color || ''
        });
        setEditingId(employee.id);
        setActiveTab('basic');
        setShowAddForm(true);
    };

    const handleCancel = () => {
        setFormData({
            employee_name: '',
            position: '',
            email: '',
            phone: '',
            percentage: false,
            receiveEmail: false,
            getAppointments: false,
            is_active: true,
            sort_order: '',
            appointment_color: ''
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

            await (editingId ? putJSON(url, formData) : postJSON(url, formData));

            await loadEmployees();
            handleCancel();

            toast.success(editingId ? 'Employee updated successfully!' : 'Employee added successfully!');
        } catch (err) {
            console.error('Error saving employee:', err);
            toast.error(httpErrorMessage(err, 'Failed to save employee'));
        }
    };

    const handleDelete = async (employeeId: number, employee_name: string) => {
        if (!await confirm(`Are you sure you want to delete ${employee_name}?`, { title: 'Delete Employee', danger: true, confirmText: 'Delete' })) {
            return;
        }

        try {
            await deleteJSON(`/api/employees/${employeeId}`);

            await loadEmployees();
            toast.success('Employee deleted successfully!');
        } catch (err) {
            console.error('Error deleting employee:', err);
            toast.error(httpErrorMessage(err, 'Failed to delete employee'));
        }
    };

    const handleInputChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const target = e.target;
        const name = target.name;
        const value = target.type === 'checkbox' ? (target as HTMLInputElement).checked : target.value;
        setFormData(prev => {
            const next = { ...prev, [name]: value };
            // Marking someone as quit clears their commission / email / appointment
            // flags (mirrors the server's auto-clear) so the form stays truthful.
            if (name === 'is_active' && value === false) {
                next.percentage = false;
                next.receiveEmail = false;
                next.getAppointments = false;
            }
            return next;
        });
    };

    // Clearing the picker stores no colour, so the doctor falls back to their
    // built-in default (or neutral) on the calendar.
    const handleClearColor = () => {
        setFormData(prev => ({ ...prev, appointment_color: '' }));
    };

    const getPositionName = (positionId: number | string): string => {
        const pos = positions.find(p => p.id === Number(positionId));
        return pos ? pos.position_name : 'Unknown';
    };

    // Effective calendar swatch for the table (only meaningful for doctors who
    // can be assigned appointments).
    const renderColorSwatch = (employee: Employee) => {
        const color = employee.get_appointments
            ? resolveDoctorColor({
                  id: employee.id,
                  employee_name: employee.employee_name,
                  appointment_color: employee.appointment_color
              })
            : null;
        if (!color) return <span className={styles.noEmail}>—</span>;
        return (
            <span
                className={styles.colorDot}
                style={{ background: color.fill, borderColor: color.edge }}
                title={employee.appointment_color || 'Default'}
            />
        );
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

            <Modal
                isOpen={showAddForm}
                onClose={handleCancel}
                contentClassName={styles.modal}
                ariaLabelledBy="employee-modal-title"
            >
                <div className={styles.modalHeader}>
                    <h3 id="employee-modal-title">
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
                                                    <label htmlFor="employee_name">
                                                        Employee Name <span className={styles.required}>*</span>
                                                    </label>
                                                    <input
                                                        type="text"
                                                        id="employee_name"
                                                        name="employee_name"
                                                        value={formData.employee_name}
                                                        onChange={handleInputChange}
                                                        required
                                                        placeholder="e.g., John Smith"
                                                    />
                                                </div>

                                                <div className={styles.formGroup}>
                                                    <label htmlFor="position">
                                                        Position <span className={styles.required}>*</span>
                                                    </label>
                                                    <select
                                                        id="position"
                                                        name="position"
                                                        value={formData.position}
                                                        onChange={handleInputChange}
                                                        required
                                                    >
                                                        <option value="">Select a position</option>
                                                        {positions.map(pos => (
                                                            <option key={pos.id} value={pos.id}>
                                                                {pos.position_name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>

                                            <div className={styles.formRow}>
                                                <div className={styles.formGroup}>
                                                    <label htmlFor="phone">
                                                        Phone Number
                                                    </label>
                                                    <input
                                                        type="tel"
                                                        id="phone"
                                                        name="phone"
                                                        value={formData.phone}
                                                        onChange={handleInputChange}
                                                        placeholder="e.g., 0750 123 4567"
                                                    />
                                                </div>
                                                <div className={styles.formGroup}>
                                                    <label htmlFor="sort_order">
                                                        Sort Order
                                                        <span className={styles.fieldHelp}>
                                                            (Lower numbers appear first)
                                                        </span>
                                                    </label>
                                                    <input
                                                        type="number"
                                                        id="sort_order"
                                                        name="sort_order"
                                                        value={formData.sort_order}
                                                        onChange={handleInputChange}
                                                        placeholder="e.g., 1"
                                                        min="1"
                                                        max="999"
                                                    />
                                                </div>
                                            </div>

                                            <div className={styles.checkboxGroup}>
                                                <div className={styles.checkboxItem}>
                                                    <label>
                                                        <input
                                                            type="checkbox"
                                                            name="is_active"
                                                            checked={formData.is_active}
                                                            onChange={handleInputChange}
                                                        />
                                                        <span className={styles.checkboxLabel}>
                                                            <i className="fas fa-user-check"></i>
                                                            Currently employed
                                                            <span className={styles.fieldHelp}>
                                                                (Uncheck if this employee has left / quit)
                                                            </span>
                                                        </span>
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {activeTab === 'other' && (
                                        <div>
                                            <div className={styles.formRow}>
                                                <div className={styles.formGroup}>
                                                    <label htmlFor="email">
                                                        Email Address
                                                        <span className={styles.fieldHelp}>
                                                            (Required for notifications)
                                                        </span>
                                                    </label>
                                                    <input
                                                        type="email"
                                                        id="email"
                                                        name="email"
                                                        value={formData.email}
                                                        onChange={handleInputChange}
                                                        placeholder="employee@example.com"
                                                    />
                                                </div>
                                                <div className={styles.formGroup}>
                                                    {/* Empty placeholder */}
                                                </div>
                                            </div>

                                            <div className={styles.formRow}>
                                                <div className={styles.formGroup}>
                                                    <label htmlFor="appointment_color">
                                                        Calendar Color
                                                        <span className={styles.fieldHelp}>
                                                            (Shown on the appointment calendar)
                                                        </span>
                                                    </label>
                                                    <div className={styles.colorField}>
                                                        <input
                                                            type="color"
                                                            id="appointment_color"
                                                            name="appointment_color"
                                                            className={styles.colorInput}
                                                            value={formData.appointment_color || (editingId != null ? DEFAULT_PICKER_HEX[editingId] : undefined) || NEUTRAL_PICKER_HEX}
                                                            onChange={handleInputChange}
                                                        />
                                                        <span className={styles.colorValue}>
                                                            {formData.appointment_color ? formData.appointment_color.toUpperCase() : 'Default'}
                                                        </span>
                                                        {formData.appointment_color && (
                                                            <button
                                                                type="button"
                                                                className={styles.colorClear}
                                                                onClick={handleClearColor}
                                                            >
                                                                <i className="fas fa-times"></i> Clear
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className={styles.formGroup}></div>
                                            </div>

                                            {!formData.is_active && (
                                                <p className={styles.fieldHelp}>
                                                    <i className="fas fa-info-circle"></i> This employee is marked as having quit, so email, appointment and commission options are disabled.
                                                </p>
                                            )}
                                            <div className={styles.checkboxGroup}>
                                                <div className={styles.checkboxItem}>
                                                    <label>
                                                        <input
                                                            type="checkbox"
                                                            name="receiveEmail"
                                                            checked={formData.receiveEmail}
                                                            onChange={handleInputChange}
                                                            disabled={!formData.is_active}
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
                                                            disabled={!formData.is_active}
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
                                                            name="percentage"
                                                            checked={formData.percentage}
                                                            onChange={handleInputChange}
                                                            disabled={!formData.is_active}
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
            </Modal>

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
                                    <th>Status</th>
                                    <th>Sort Order</th>
                                    <th>Phone</th>
                                    <th>Email</th>
                                    <th>Commission</th>
                                    <th>Email Notifications</th>
                                    <th>Appointments</th>
                                    <th>Color</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {employees.map(employee => (
                                    <tr key={employee.id}>
                                        <td data-label="ID">{employee.id}</td>
                                        <td
                                            data-label="Name"
                                            className={styles.employeeName}
                                            onContextMenu={(e) => {
                                                e.preventDefault();
                                                setContextMenu({ x: e.clientX, y: e.clientY, employee });
                                            }}
                                            title="Right-click for actions"
                                        >
                                            <i className="fas fa-user"></i>
                                            {employee.employee_name}
                                        </td>
                                        <td data-label="Position">
                                            <span className={styles.positionBadge}>
                                                {getPositionName(employee.position)}
                                            </span>
                                        </td>
                                        <td data-label="Status">
                                            {employee.is_active ? (
                                                <span className={`${styles.badge} ${styles.badgeSuccess}`}>
                                                    <i className="fas fa-user-check"></i>
                                                    Active
                                                </span>
                                            ) : (
                                                <span className={`${styles.badge} ${styles.badgeQuit}`}>
                                                    <i className="fas fa-user-slash"></i>
                                                    Quit
                                                </span>
                                            )}
                                        </td>
                                        <td data-label="Sort Order">
                                            <span className={styles.sortOrderValue}>
                                                {employee.sort_order || '—'}
                                            </span>
                                        </td>
                                        <td data-label="Phone">
                                            {employee.phone ? (
                                                <span className={styles.emailValue}>
                                                    <i className="fas fa-phone"></i>
                                                    {employee.phone}
                                                </span>
                                            ) : (
                                                <span className={styles.noEmail}>No phone</span>
                                            )}
                                        </td>
                                        <td data-label="Email">
                                            {employee.email ? (
                                                <span className={styles.emailValue}>
                                                    <i className="fas fa-envelope"></i>
                                                    {employee.email}
                                                </span>
                                            ) : (
                                                <span className={styles.noEmail}>No email</span>
                                            )}
                                        </td>
                                        <td data-label="Commission">
                                            {employee.percentage ? (
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
                                            {employee.receive_email ? (
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
                                            {employee.get_appointments ? (
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
                                        <td data-label="Color">
                                            {renderColorSwatch(employee)}
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
                                                onClick={() => handleDelete(employee.id, employee.employee_name)}
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

            {contextMenu && (
                <div
                    ref={menuRef}
                    className={styles.contextMenu}
                    style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
                    role="menu"
                >
                    <button
                        type="button"
                        role="menuitem"
                        className={styles.contextMenuItem}
                        onClick={() => {
                            handleEdit(contextMenu.employee);
                            closeContextMenu();
                        }}
                    >
                        <i className="fas fa-edit" aria-hidden="true"></i>
                        <span>Edit</span>
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        className={`${styles.contextMenuItem} ${styles.contextMenuItemDanger}`}
                        onClick={() => {
                            const { id, employee_name } = contextMenu.employee;
                            closeContextMenu();
                            handleDelete(id, employee_name);
                        }}
                    >
                        <i className="fas fa-trash" aria-hidden="true"></i>
                        <span>Delete</span>
                    </button>
                </div>
            )}
        </div>
    );
};

export default EmployeeSettings;
