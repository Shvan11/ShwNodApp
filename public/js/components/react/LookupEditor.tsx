import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../../contexts/ToastContext';
import LookupEditorModal from './LookupEditorModal';

// Types
interface ColumnConfig {
    name: string;
    label: string;
    type: string;
    required?: boolean;
    maxLength?: number;
}

interface LookupItem {
    [key: string]: any;
}

interface Position {
    top: number;
    left: number;
}

interface DeleteConfirmPopoverProps {
    anchorEl: HTMLElement;
    itemName: string;
    onCancel: () => void;
    onConfirm: () => void;
}

interface LookupEditorProps {
    tableKey: string;
    tableName: string;
    columns: ColumnConfig[];
    idColumn: string;
}

/**
 * Positioned delete confirmation popover
 * Appears next to the delete button instead of center screen
 */
const DeleteConfirmPopover: React.FC<DeleteConfirmPopoverProps> = ({ anchorEl, itemName, onCancel, onConfirm }) => {
    const [position, setPosition] = useState<Position | null>(null);

    // Calculate position synchronously to prevent flicker
    const calculatePosition = (anchor: HTMLElement): Position | null => {
        if (!anchor) return null;

        const rect = anchor.getBoundingClientRect();
        const popoverWidth = 280;
        const popoverHeight = 160;
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

        const updatePosition = (): void => setPosition(calculatePosition(anchorEl));
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);

        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [anchorEl]);

    // Close on escape key
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent): void => {
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
                    <p className="text-muted">This cannot be undone.</p>
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

/**
 * Reusable component for editing any lookup table
 * Displays items in a table with search, add, edit, and delete functionality
 */
const LookupEditor: React.FC<LookupEditorProps> = ({ tableKey, tableName, columns, idColumn }) => {
    const toast = useToast();
    const [items, setItems] = useState<LookupItem[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [modalOpen, setModalOpen] = useState<boolean>(false);
    const [editingItem, setEditingItem] = useState<LookupItem | null>(null);
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [deleteConfirm, setDeleteConfirm] = useState<LookupItem | null>(null);
    const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
    const [deleteAnchorEl, setDeleteAnchorEl] = useState<HTMLElement | null>(null);
    const addButtonRef = useRef<HTMLButtonElement>(null);

    const loadItems = useCallback(async (): Promise<void> => {
        try {
            setLoading(true);
            const response = await fetch(`/api/admin/lookups/${tableKey}`);
            if (response.ok) {
                const data: LookupItem[] = await response.json();
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

    const handleAdd = (e: MouseEvent<HTMLButtonElement>): void => {
        setEditingItem(null);
        setAnchorEl(e.currentTarget);
        setModalOpen(true);
    };

    const handleEdit = (item: LookupItem, e: MouseEvent<HTMLButtonElement>): void => {
        setEditingItem(item);
        setAnchorEl(e.currentTarget);
        setModalOpen(true);
    };

    const handleDeleteClick = (item: LookupItem, e: MouseEvent<HTMLButtonElement>): void => {
        setDeleteAnchorEl(e.currentTarget);
        setDeleteConfirm(item);
    };

    const handleDeleteCancel = (): void => {
        setDeleteConfirm(null);
        setDeleteAnchorEl(null);
    };

    const handleModalClose = (): void => {
        setModalOpen(false);
        setAnchorEl(null);
    };

    const handleDeleteConfirm = async (): Promise<void> => {
        if (!deleteConfirm) return;

        const itemId = deleteConfirm[idColumn];

        try {
            const response = await fetch(`/api/admin/lookups/${tableKey}/${itemId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                toast.success('Item deleted successfully');
                loadItems();
            } else {
                const error = await response.json();
                toast.error(error.error || 'Failed to delete item');
            }
        } catch (error) {
            toast.error('Error deleting item');
        } finally {
            setDeleteConfirm(null);
            setDeleteAnchorEl(null);
        }
    };

    const handleSave = async (data: Record<string, any>): Promise<void> => {
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
                toast.success(isEdit ? 'Item updated successfully' : 'Item created successfully');
                setModalOpen(false);
                setAnchorEl(null);
                loadItems();
            } else {
                const error = await response.json();
                toast.error(error.error || 'Failed to save item');
            }
        } catch (error) {
            toast.error('Error saving item');
        }
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

    // Get display value for a cell
    const getCellValue = (item: LookupItem, column: ColumnConfig): React.ReactNode => {
        const value = item[column.name];
        if (value === null || value === undefined) return '-';
        if (column.type === 'bit') {
            return value ? (
                <i className="fas fa-check text-success"></i>
            ) : (
                <i className="fas fa-times text-muted"></i>
            );
        }
        return String(value);
    };

    // Get the primary display column (first column usually)
    const getDisplayValue = (item: LookupItem): string => {
        if (columns.length === 0) return 'Item';
        const displayCol = columns[0];
        return item[displayCol.name] || 'Unnamed';
    };

    return (
        <div className="lookup-editor">
            <div className="lookup-editor-toolbar">
                <div className="search-box">
                    <i className="fas fa-search"></i>
                    <input
                        type="text"
                        placeholder={`Search ${tableName}...`}
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
                <button
                    ref={addButtonRef}
                    className="btn btn-primary btn-sm"
                    onClick={handleAdd}
                >
                    <i className="fas fa-plus"></i> Add New
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
                                                <span>No items match your search</span>
                                            </>
                                        ) : (
                                            <>
                                                <i className="fas fa-inbox"></i>
                                                <span>No items found</span>
                                            </>
                                        )}
                                    </td>
                                </tr>
                            ) : (
                                filteredItems.map((item, idx) => (
                                    <tr key={item[idColumn] || idx}>
                                        <td className="id-cell">{item[idColumn]}</td>
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
                            {filteredItems.length} of {items.length} items
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

export default LookupEditor;
