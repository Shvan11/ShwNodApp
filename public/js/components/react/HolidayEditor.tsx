import { useState, useEffect, useLayoutEffect, useCallback, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../../contexts/ToastContext';
import LookupEditorModal from './LookupEditorModal';

interface Column {
    name: string;
    label: string;
    type: string;
    required?: boolean;
    maxLength?: number;
}

interface HolidayItem {
    ID?: number;
    HolidayName?: string;
    Holidaydate?: string;
    Description?: string;
    [key: string]: unknown;
}

interface AppointmentInfo {
    PatientName: string;
    AppDetail?: string;
    AppDate?: string;
}

interface AppointmentWarning {
    date: string;
    appointments: AppointmentInfo[];
    count: number;
}

interface DeleteConfirmPopoverProps {
    anchorEl: HTMLElement;
    itemName: string;
    onCancel: () => void;
    onConfirm: () => void;
}

interface Position {
    top: number;
    left: number;
}

/**
 * Positioned delete confirmation popover for holidays
 */
const DeleteConfirmPopover = ({ anchorEl, itemName, onCancel, onConfirm }: DeleteConfirmPopoverProps) => {
    const [position, setPosition] = useState<Position | null>(null);

    // Calculate position synchronously to prevent flicker
    const calculatePosition = (anchor: HTMLElement): Position | null => {
        if (!anchor) return null;

        const rect = anchor.getBoundingClientRect();
        const popoverWidth = 300;
        const popoverHeight = 180;
        const padding = 8;

        let left = rect.left - popoverWidth - padding;
        let top = rect.top + (rect.height / 2) - (popoverHeight / 2);

        if (left < padding) {
            left = rect.right + padding;
        }

        if (left + popoverWidth > window.innerWidth - padding) {
            left = rect.left + (rect.width / 2) - (popoverWidth / 2);
            top = rect.top - popoverHeight - padding;
        }

        top = Math.max(padding, Math.min(top, window.innerHeight - popoverHeight - padding));
        left = Math.max(padding, Math.min(left, window.innerWidth - popoverWidth - padding));

        return { top, left };
    };

    // useLayoutEffect prevents flicker by calculating before paint
    useLayoutEffect(() => {
        if (!anchorEl) return;

        setPosition(calculatePosition(anchorEl));

        const updatePosition = () => setPosition(calculatePosition(anchorEl));
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);

        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [anchorEl]);

    useEffect(() => {
        const handleEscape = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'Escape') onCancel();
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [onCancel]);

    if (!position) return null;

    return createPortal(
        <>
            <div className="popover-backdrop" onClick={onCancel} />
            <div
                className="delete-confirm-popover"
                style={{ top: position.top, left: position.left }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="popover-header">
                    <i className="fas fa-exclamation-triangle text-warning"></i>
                    <span>Confirm Delete</span>
                </div>
                <div className="popover-body">
                    <p>Delete <strong>{itemName}</strong>?</p>
                    <p className="text-muted">This will allow appointments on this date again.</p>
                </div>
                <div className="popover-actions">
                    <button type="button" className="btn btn-sm btn-secondary" onClick={onCancel}>
                        Cancel
                    </button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={onConfirm}>
                        <i className="fas fa-trash"></i> Delete
                    </button>
                </div>
            </div>
        </>,
        document.body
    );
};

interface HolidayEditorProps {
    tableKey: string;
    tableName: string;
    columns: Column[];
    idColumn: string;
}

/**
 * Specialized editor for holidays table
 * Extends LookupEditor with appointment warning functionality
 * Shows existing appointments when adding a holiday on a date with scheduled appointments
 */
const HolidayEditor = ({ tableKey, tableName, columns, idColumn }: HolidayEditorProps) => {
    const toast = useToast();
    const [items, setItems] = useState<HolidayItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<HolidayItem | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState<HolidayItem | null>(null);
    const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
    const [deleteAnchorEl, setDeleteAnchorEl] = useState<HTMLElement | null>(null);

    // Appointment warning state
    const [appointmentWarning, setAppointmentWarning] = useState<AppointmentWarning | null>(null);
    const [pendingHolidayData, setPendingHolidayData] = useState<Record<string, unknown> | null>(null);
    const [checkingAppointments, setCheckingAppointments] = useState(false);

    const loadItems = useCallback(async () => {
        try {
            setLoading(true);
            const response = await fetch(`/api/admin/lookups/${tableKey}`);
            if (response.ok) {
                const data = await response.json();
                setItems(data);
            } else {
                const error = await response.json();
                toast.error(error.error || `Failed to load ${tableName}`);
            }
        } catch (error) {
            toast.error(`Error loading ${tableName}`);
        } finally {
            setLoading(false);
        }
    }, [tableKey, tableName, toast]);

    useEffect(() => {
        loadItems();
    }, [loadItems]);

    const handleAdd = (e: MouseEvent<HTMLButtonElement>) => {
        setEditingItem(null);
        setAnchorEl(e.currentTarget);
        setModalOpen(true);
    };

    const handleEdit = (item: HolidayItem, e: MouseEvent<HTMLButtonElement>) => {
        setEditingItem(item);
        setAnchorEl(e.currentTarget);
        setModalOpen(true);
    };

    const handleDeleteClick = (item: HolidayItem, e: MouseEvent<HTMLButtonElement>) => {
        setDeleteAnchorEl(e.currentTarget);
        setDeleteConfirm(item);
    };

    const handleDeleteCancel = () => {
        setDeleteConfirm(null);
        setDeleteAnchorEl(null);
    };

    const handleModalClose = () => {
        setModalOpen(false);
        setAnchorEl(null);
    };

    const handleDeleteConfirm = async () => {
        if (!deleteConfirm) return;

        const itemId = deleteConfirm[idColumn];

        try {
            const response = await fetch(`/api/admin/lookups/${tableKey}/${itemId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                toast.success('Holiday deleted successfully');
                loadItems();
            } else {
                const error = await response.json();
                toast.error(error.error || 'Failed to delete holiday');
            }
        } catch (error) {
            toast.error('Error deleting holiday');
        } finally {
            setDeleteConfirm(null);
            setDeleteAnchorEl(null);
        }
    };

    // Check for appointments on the selected date
    const checkAppointmentsOnDate = async (date: string): Promise<AppointmentWarning | null> => {
        try {
            setCheckingAppointments(true);
            const response = await fetch(`/api/holidays/appointments-on-date?date=${date}`);
            const data = await response.json();

            if (data.success && data.count > 0) {
                return {
                    date,
                    appointments: data.appointments,
                    count: data.count
                };
            }
            return null;
        } catch (error) {
            console.error('Error checking appointments:', error);
            return null;
        } finally {
            setCheckingAppointments(false);
        }
    };

    // Modified save handler with appointment checking
    const handleSave = async (data: Record<string, unknown>) => {
        // If editing, skip appointment check (date can't change the appointment status)
        // Or if we've already confirmed via warning modal
        if (editingItem || pendingHolidayData) {
            await saveHoliday(data);
            return;
        }

        // For new holidays, check if there are existing appointments
        const holidayDate = data.Holidaydate as string | undefined;
        if (holidayDate) {
            const warning = await checkAppointmentsOnDate(holidayDate);
            if (warning) {
                setAppointmentWarning(warning);
                setPendingHolidayData(data);
                return; // Don't save yet, show warning first
            }
        }

        // No appointments, save directly
        await saveHoliday(data);
    };

    // Actual save function
    const saveHoliday = async (data: Record<string, unknown>) => {
        try {
            const isEdit = !!editingItem;
            const method = isEdit ? 'PUT' : 'POST';
            const itemId = isEdit ? editingItem[idColumn] : null;
            const url = isEdit
                ? `/api/admin/lookups/${tableKey}/${itemId}`
                : `/api/admin/lookups/${tableKey}`;

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (response.ok) {
                toast.success(isEdit ? 'Holiday updated successfully' : 'Holiday created successfully');
                setModalOpen(false);
                setAnchorEl(null);
                setAppointmentWarning(null);
                setPendingHolidayData(null);
                loadItems();
            } else {
                const error = await response.json();
                toast.error(error.error || 'Failed to save holiday');
            }
        } catch (error) {
            toast.error('Error saving holiday');
        }
    };

    // Handle confirmation from warning modal
    const handleConfirmWithAppointments = async () => {
        if (pendingHolidayData) {
            await saveHoliday(pendingHolidayData);
        }
    };

    // Handle cancel from warning modal
    const handleCancelWarning = () => {
        setAppointmentWarning(null);
        setPendingHolidayData(null);
    };

    // Filter items based on search term
    const filteredItems = items.filter(item => {
        if (!searchTerm) return true;
        const lowerSearch = searchTerm.toLowerCase();
        return columns.some(col => {
            const value = item[col.name];
            if (value === null || value === undefined) return false;
            return String(value).toLowerCase().includes(lowerSearch);
        });
    });

    // Format date for display
    const formatDate = (dateValue: unknown): string => {
        if (!dateValue) return '-';
        const date = new Date(dateValue as string);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    };

    // Get display value for a cell (specialized for holidays)
    const getCellValue = (item: HolidayItem, column: Column): React.ReactNode => {
        const value = item[column.name];
        if (value === null || value === undefined) return '-';

        // Format date columns
        if (column.type === 'date' || column.type === 'datetime') {
            return formatDate(value as string);
        }

        if (column.type === 'bit' || column.type === 'boolean') {
            return value ? (
                <i className="fas fa-check text-success"></i>
            ) : (
                <i className="fas fa-times text-muted"></i>
            );
        }
        return String(value);
    };

    // Get the primary display column
    const getDisplayValue = (item: HolidayItem): string => {
        return item.HolidayName || 'Unnamed Holiday';
    };

    return (
        <div className="lookup-editor holiday-editor">
            <div className="lookup-editor-toolbar">
                <div className="search-box">
                    <i className="fas fa-search"></i>
                    <input
                        type="text"
                        placeholder="Search holidays..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    {searchTerm && (
                        <button
                            className="search-clear"
                            onClick={() => setSearchTerm('')}
                            type="button"
                        >
                            <i className="fas fa-times"></i>
                        </button>
                    )}
                </div>
                <button className="btn btn-primary btn-sm" onClick={handleAdd}>
                    <i className="fas fa-plus"></i> Add Holiday
                </button>
            </div>

            {loading ? (
                <div className="lookup-loading">
                    <i className="fas fa-spinner fa-spin"></i>
                    <span>Loading...</span>
                </div>
            ) : (
                <div className="lookup-table-container">
                    <table className="lookup-table">
                        <thead>
                            <tr>
                                <th className="id-column">ID</th>
                                {columns.map(col => (
                                    <th key={col.name}>{col.label}</th>
                                ))}
                                <th className="actions-column">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredItems.length === 0 ? (
                                <tr>
                                    <td colSpan={columns.length + 2} className="empty-row">
                                        {searchTerm ? (
                                            <>
                                                <i className="fas fa-search"></i>
                                                <span>No holidays match your search</span>
                                            </>
                                        ) : (
                                            <>
                                                <i className="fas fa-calendar-times"></i>
                                                <span>No holidays defined</span>
                                            </>
                                        )}
                                    </td>
                                </tr>
                            ) : (
                                filteredItems.map((item, idx) => (
                                    <tr key={item[idColumn] as string | number || idx}>
                                        <td className="id-cell">{item[idColumn] as string | number}</td>
                                        {columns.map(col => (
                                            <td key={col.name}>{getCellValue(item, col)}</td>
                                        ))}
                                        <td className="actions-cell">
                                            <button
                                                className="btn-icon btn-edit"
                                                onClick={(e) => handleEdit(item, e)}
                                                title="Edit"
                                            >
                                                <i className="fas fa-edit"></i>
                                            </button>
                                            <button
                                                className="btn-icon btn-delete"
                                                onClick={(e) => handleDeleteClick(item, e)}
                                                title="Delete"
                                            >
                                                <i className="fas fa-trash"></i>
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>

                    <div className="lookup-table-footer">
                        <span className="item-count">
                            {filteredItems.length} of {items.length} holidays
                        </span>
                    </div>
                </div>
            )}

            {/* Edit/Add Modal */}
            <LookupEditorModal
                isOpen={modalOpen}
                onClose={handleModalClose}
                onSave={handleSave}
                columns={columns}
                editingItem={editingItem}
                tableName={tableName}
                idColumn={idColumn}
                anchorEl={anchorEl}
            />

            {/* Appointment Warning Modal */}
            {appointmentWarning && (
                <div className="modal-overlay appointment-warning-modal" onClick={handleCancelWarning}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header warning-header">
                            <h3>
                                <i className="fas fa-exclamation-triangle"></i>
                                Existing Appointments Found
                            </h3>
                            <button className="modal-close" onClick={handleCancelWarning} type="button">
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        <div className="modal-body">
                            <p className="warning-text">
                                There are <strong>{appointmentWarning.count}</strong> appointment(s)
                                scheduled on <strong>{formatDate(appointmentWarning.date)}</strong>.
                            </p>
                            <p className="warning-subtext">
                                Adding this date as a holiday will NOT automatically cancel these appointments.
                                You may need to contact these patients to reschedule:
                            </p>
                            <div className="appointment-list">
                                {appointmentWarning.appointments.slice(0, 10).map((apt, idx) => (
                                    <div key={idx} className="appointment-item">
                                        <span className="patient-name">
                                            <i className="fas fa-user"></i>
                                            {apt.PatientName}
                                        </span>
                                        <span className="appointment-detail">{apt.AppDetail}</span>
                                        <span className="appointment-time">
                                            {apt.AppDate ? new Date(apt.AppDate).toLocaleTimeString('en-US', {
                                                hour: 'numeric',
                                                minute: '2-digit'
                                            }) : ''}
                                        </span>
                                    </div>
                                ))}
                                {appointmentWarning.count > 10 && (
                                    <div className="appointment-item more-items">
                                        <span>... and {appointmentWarning.count - 10} more</span>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={handleCancelWarning}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn btn-warning"
                                onClick={handleConfirmWithAppointments}
                                disabled={checkingAppointments}
                            >
                                <i className="fas fa-calendar-times"></i>
                                Add Holiday Anyway
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Popover */}
            {deleteConfirm && deleteAnchorEl && (
                <DeleteConfirmPopover
                    anchorEl={deleteAnchorEl}
                    itemName={getDisplayValue(deleteConfirm)}
                    onCancel={handleDeleteCancel}
                    onConfirm={handleDeleteConfirm}
                />
            )}
        </div>
    );
};

export default HolidayEditor;
