import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '../../contexts/ToastContext.jsx';
import LookupEditorModal from './LookupEditorModal.jsx';

/**
 * Reusable component for editing any lookup table
 * Displays items in a table with search, add, edit, and delete functionality
 */
const LookupEditor = ({ tableKey, tableName, columns, idColumn }) => {
    const toast = useToast();
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState(null);

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

    const handleAdd = () => {
        setEditingItem(null);
        setModalOpen(true);
    };

    const handleEdit = (item) => {
        setEditingItem(item);
        setModalOpen(true);
    };

    const handleDeleteClick = (item) => {
        setDeleteConfirm(item);
    };

    const handleDeleteCancel = () => {
        setDeleteConfirm(null);
    };

    const handleDeleteConfirm = async () => {
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
        }
    };

    const handleSave = async (data) => {
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
    const getCellValue = (item, column) => {
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
    const getDisplayValue = (item) => {
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
                <button className="btn btn-primary btn-sm" onClick={handleAdd}>
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
                                                onClick={() => handleEdit(item)}
                                                title="Edit"
                                            >
                                                <i className="fas fa-edit"></i>
                                            </button>
                                            <button
                                                className="btn-icon btn-delete"
                                                onClick={() => handleDeleteClick(item)}
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
                onClose={() => setModalOpen(false)}
                onSave={handleSave}
                columns={columns}
                editingItem={editingItem}
                tableName={tableName}
                idColumn={idColumn}
            />

            {/* Delete Confirmation Modal */}
            {deleteConfirm && (
                <div className="modal delete-confirm-modal" onClick={handleDeleteCancel}>
                    <div className="modal-content modal-sm" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>
                                <i className="fas fa-exclamation-triangle text-warning"></i>
                                Confirm Delete
                            </h3>
                            <button className="modal-close" onClick={handleDeleteCancel} type="button">
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        <div className="modal-body">
                            <p>Are you sure you want to delete <strong>{getDisplayValue(deleteConfirm)}</strong>?</p>
                            <p className="text-muted">This action cannot be undone.</p>
                        </div>
                        <div className="modal-footer">
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={handleDeleteCancel}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn btn-danger"
                                onClick={handleDeleteConfirm}
                            >
                                <i className="fas fa-trash"></i>
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LookupEditor;
