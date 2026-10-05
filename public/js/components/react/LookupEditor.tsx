import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { postJSON, putJSON, deleteJSON, httpErrorMessage } from '@/core/http';
import { qk } from '@/query/keys';
import { lookupFeedKeys } from '@/query/lookupFeeds';
import { adminLookupItemsQuery } from '@/query/queries';
import { formatLocaleDate } from '../../utils/formatters';
import type { LookupColumn } from '@shared/contracts/lookup-admin.contract';
import LookupEditorModal, { type LookupFormData, type LookupItem } from './LookupEditorModal';

export interface LookupEditorLabels {
    /** Toolbar button. Default "Add New". */
    add?: string;
    /** Search placeholder. Default "Search <tableName>...". */
    search?: string;
    /** Empty-table text. Default "No items found". */
    empty?: string;
    /** Plural noun in the footer count. Default "items". */
    noun?: string;
}

interface LookupEditorProps {
    tableKey: string;
    tableName: string;
    columns: LookupColumn[];
    idColumn: string;
    /** Rows the code names by id: no Delete is offered (the server refuses one too). */
    protectedIds?: readonly number[];
    /**
     * Fired after any successful create/update/delete. Lets a host (e.g. the
     * right-click LookupManagerModal) refresh whatever else it owns — the editor
     * already refreshes its own table and the feeds in `lookupFeedKeys`.
     */
    onChanged?: () => void;
    /**
     * Runs after the form validates and before the write is sent; resolve `false`
     * to keep the form open without saving. HolidayEditor checks the day's
     * appointments here.
     */
    beforeSave?: (data: LookupFormData, editingItem: LookupItem | null) => Promise<boolean>;
    /** Second line of the delete question. Default "This cannot be undone." */
    deleteNote?: string;
    labels?: LookupEditorLabels;
}

/**
 * Reusable component for editing any lookup table
 * Displays items in a table with search, add, edit, and delete functionality
 */
const LookupEditor: React.FC<LookupEditorProps> = ({
    tableKey,
    tableName,
    columns,
    idColumn,
    protectedIds = [],
    onChanged,
    beforeSave,
    deleteNote = 'This cannot be undone.',
    labels = {},
}) => {
    const toast = useToast();
    const confirm = useConfirm();
    const queryClient = useQueryClient();
    const { data: itemsData, isLoading: loading, isError, error: itemsError } =
        useQuery(adminLookupItemsQuery(tableKey));
    // `lookupAdmin.items.response` is `anyArray` on purpose — rows are generic
    // per-table key/value pairs whose columns vary by tableName — so the row shape
    // is asserted once here, off `unknown[]`.
    const items = (itemsData ?? []) as LookupItem[];
    const [modalOpen, setModalOpen] = useState<boolean>(false);
    const [editingItem, setEditingItem] = useState<LookupItem | null>(null);
    const [searchTerm, setSearchTerm] = useState<string>('');
    // One delete at a time: a second click on the confirm used to send a second
    // DELETE, whose 404 toasted an error after the success (FE-F21-10).
    const deletingRef = useRef(false);

    // Surface a load failure once (the list query itself retries transient errors).
    useEffect(() => {
        if (isError) toast.error(httpErrorMessage(itemsError, `Failed to load ${tableName}`));
    }, [isError, itemsError, tableName, toast]);

    // The column a row is named by in the delete question: the first one that
    // holds text (a holiday's first column is its date).
    const nameColumn = columns.find(c => c.type !== 'date' && c.type !== 'bit') ?? columns[0];

    const refreshAfterWrite = (): void => {
        void queryClient.invalidateQueries({ queryKey: qk.adminLookups.table(tableKey) });
        // …and every form that reads this table, not only this editor (FE-F21-11).
        lookupFeedKeys(tableKey).forEach(queryKey => {
            void queryClient.invalidateQueries({ queryKey });
        });
        onChanged?.();
    };

    const handleAdd = (): void => {
        setEditingItem(null);
        setModalOpen(true);
    };

    const handleEdit = (item: LookupItem): void => {
        setEditingItem(item);
        setModalOpen(true);
    };

    const handleModalClose = (): void => {
        setModalOpen(false);
    };

    const handleDelete = async (item: LookupItem): Promise<void> => {
        if (deletingRef.current) return;
        const name = nameColumn ? String(item[nameColumn.name] ?? '') : '';
        const ok = await confirm(`Delete ${name || 'this item'}? ${deleteNote}`, {
            title: 'Confirm Delete',
            danger: true,
            confirmText: 'Delete',
        });
        if (!ok) return;

        deletingRef.current = true;
        try {
            await deleteJSON(`/api/admin/lookups/${tableKey}/${String(item[idColumn])}`);
            toast.success('Item deleted successfully');
            refreshAfterWrite();
        } catch (err) {
            // A row in use comes back 409 with the reason ("Cannot delete: 2,442 works use this item.").
            toast.error(httpErrorMessage(err, 'Failed to delete item'));
        } finally {
            deletingRef.current = false;
        }
    };

    const handleSave = async (data: LookupFormData): Promise<void> => {
        if (beforeSave && !(await beforeSave(data, editingItem))) return;
        try {
            const isEdit = !!editingItem;
            const url = isEdit
                ? `/api/admin/lookups/${tableKey}/${String(editingItem[idColumn])}`
                : `/api/admin/lookups/${tableKey}`;

            await (isEdit ? putJSON(url, data) : postJSON(url, data));

            toast.success(isEdit ? 'Item updated successfully' : 'Item created successfully');
            setModalOpen(false);
            refreshAfterWrite();
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Failed to save item'));
        }
    };

    // Filter items based on search term
    const filteredItems = items.filter(item => {
        if (!searchTerm) return true;
        const lowerSearch = searchTerm.toLowerCase();
        return columns.some(col => {
            const lookupKey = col.type === 'reference' ? `${col.name}_display` : col.name;
            const value = item[lookupKey];
            if (value === null || value === undefined) return false;
            return String(value).toLowerCase().includes(lowerSearch);
        });
    });

    // Get display value for a cell
    const getCellValue = (item: LookupItem, column: LookupColumn): React.ReactNode => {
        if (column.type === 'reference') {
            const display = item[`${column.name}_display`];
            return display === null || display === undefined || display === '' ? '-' : String(display);
        }
        const value = item[column.name];
        if (value === null || value === undefined) return '-';
        if (column.type === 'date') {
            return formatLocaleDate(String(value), { year: 'numeric', month: 'short', day: 'numeric' }) || '-';
        }
        if (column.type === 'bit') {
            return value ? (
                <i className="fas fa-check text-success" aria-label="Yes"></i>
            ) : (
                <i className="fas fa-times text-muted" aria-label="No"></i>
            );
        }
        return String(value);
    };

    return (
        <div className="lookup-editor">
            <div className="lookup-editor-toolbar">
                <div className="search-box">
                    <i className="fas fa-search" aria-hidden="true"></i>
                    <input
                        type="text"
                        placeholder={labels.search ?? `Search ${tableName}...`}
                        aria-label={labels.search ?? `Search ${tableName}`}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    {searchTerm && (
                        <button
                            className="search-clear"
                            onClick={() => setSearchTerm('')}
                            type="button"
                            aria-label="Clear search"
                        >
                            <i className="fas fa-times" aria-hidden="true"></i>
                        </button>
                    )}
                </div>
                <button type="button" className="btn btn-primary btn-sm" onClick={handleAdd}>
                    <i className="fas fa-plus"></i> {labels.add ?? 'Add New'}
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
                                                <span>{labels.empty ?? 'No items found'}</span>
                                            </>
                                        )}
                                    </td>
                                </tr>
                            ) : (
                                filteredItems.map((item) => {
                                    const id = item[idColumn];
                                    const isProtected = protectedIds.includes(Number(id));
                                    return (
                                        <tr key={String(id)}>
                                            <td className="id-cell">{String(id)}</td>
                                            {columns.map(col => (
                                                <td key={col.name}>{getCellValue(item, col)}</td>
                                            ))}
                                            <td className="actions-cell">
                                                <button
                                                    type="button"
                                                    className="btn-icon btn-edit"
                                                    onClick={() => handleEdit(item)}
                                                    title="Edit"
                                                    aria-label="Edit"
                                                >
                                                    <i className="fas fa-edit" aria-hidden="true"></i>
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn-icon btn-delete"
                                                    onClick={() => handleDelete(item)}
                                                    disabled={isProtected}
                                                    title={isProtected ? 'Used by the app — it can be renamed but not deleted' : 'Delete'}
                                                    aria-label="Delete"
                                                >
                                                    <i className="fas fa-trash" aria-hidden="true"></i>
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>

                    <div className="lookup-table-footer">
                        <span className="item-count">
                            {filteredItems.length} of {items.length} {labels.noun ?? 'items'}
                        </span>
                    </div>
                </div>
            )}

            <LookupEditorModal
                isOpen={modalOpen}
                onClose={handleModalClose}
                onSave={handleSave}
                columns={columns}
                editingItem={editingItem}
                tableName={tableName}
            />
        </div>
    );
};

export default LookupEditor;
