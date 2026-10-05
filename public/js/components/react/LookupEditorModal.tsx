import React, { useState, useMemo, FormEvent, ChangeEvent } from 'react';
import { useQueries } from '@tanstack/react-query';
import { formatISODate } from '../../core/utils';
import { adminLookupItemsQuery } from '@/query/queries';
import type { LookupColumn } from '@shared/contracts/lookup-admin.contract';
import Modal from './Modal';
import ModalHeader from './ModalHeader';

/** A lookup row as the generic admin feed returns it (columns vary per table). */
export type LookupItem = Record<string, unknown>;
/** What the form sends: one value per configured column. */
export type LookupFormData = Record<string, unknown>;

type ReferenceOption = { id: string; label: string };

interface FormErrors {
    [key: string]: string;
}

interface LookupEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: LookupFormData) => Promise<void>;
    columns: LookupColumn[];
    editingItem: LookupItem | null;
    tableName: string;
}

const TITLE_ID = 'lookup-editor-dialog-title';

/**
 * The add/edit form for one lookup row, in the shared `<Modal>`.
 *
 * It was a hand-rolled portal positioned beside the button that opened it, with no
 * focus handling: focus stayed on the page behind, Tab walked out of it, and the
 * icon-only close had no name (audit FE-F21-14). `<Modal>` brings the focus trap
 * and return, the Escape stack (it opens over LookupManagerModal, and only the top
 * one closes — what the old capture-phase listener did by hand) and the unsaved
 * guard.
 */
const LookupEditorModal: React.FC<LookupEditorModalProps> = ({ isOpen, onClose, onSave, columns, editingItem, tableName }) => {
    const [formData, setFormData] = useState<LookupFormData>({});
    const [errors, setErrors] = useState<FormErrors>({});
    const [isSaving, setIsSaving] = useState<boolean>(false);

    // Distinct reference-type columns (one fetch per referenced table). Derived
    // from the columns config while the modal is open; closed → no reads fire.
    const refColumns = useMemo(
        () => columns.filter(c => c.type === 'reference' && c.reference),
        [columns]
    );
    const refTables = useMemo(
        () => (isOpen ? Array.from(new Set(refColumns.map(c => c.reference!.table))) : []),
        [isOpen, refColumns]
    );

    // Fetch dropdown options for any reference columns. One query per referenced
    // table; React Query dedups + caches by key, so multiple columns pointing at
    // the same table share one fetch and re-opens reuse the cache.
    // `combine` keeps the result's identity stable across renders (it is
    // structurally shared), so the memo below recomputes only when a table's rows
    // actually change — without it useQueries hands back a new array every render.
    // `lookupAdmin.items.response` is `anyArray` on purpose (columns vary by
    // tableName), so the row shape is asserted here, off `unknown[]`.
    const refRows = useQueries({
        queries: refTables.map(table => adminLookupItemsQuery(table)),
        combine: results => results.map(r => r.data as LookupItem[] | undefined),
    });

    // Map fetched rows into { id, label } per table for the select inputs. A table
    // whose fetch failed/pending stays absent → renderInput shows a disabled select.
    const referenceOptions = useMemo(() => {
        const out: Record<string, ReferenceOption[]> = {};
        refTables.forEach((table, i) => {
            const rows = refRows[i];
            if (!rows) return;
            const refCol = refColumns.find(c => c.reference!.table === table)!.reference!;
            out[table] = rows.map(r => ({
                id: String(r[refCol.idColumn]),
                label: String(r[refCol.displayColumn] ?? ''),
            }));
        });
        return out;
    }, [refTables, refRows, refColumns]);

    // Initialize form data when the modal opens or the edited item changes — keyed
    // adjust-during-render, no setState-in-effect. `columns` is the stable per-table
    // schema (read here, not part of the key, so an unstable prop ref can't loop).
    const [seededItem, setSeededItem] = useState<{ open: boolean; item: unknown }>({ open: false, item: null });
    if (seededItem.open !== isOpen || seededItem.item !== editingItem) {
        setSeededItem({ open: isOpen, item: editingItem });
        if (isOpen) {
            const data: LookupFormData = {};
            columns.forEach(col => {
                // Edit mode: the row's values. Add mode: empty, except bit columns —
                // every bit in the whitelist is an "Active"-style flag (labs.is_active,
                // document_types.is_active, each DB-default true), so a new row starts
                // ACTIVE and shows up at once in the dropdowns that filter on it.
                data[col.name] = editingItem ? editingItem[col.name] ?? '' : col.type === 'bit' ? true : '';
            });
            setFormData(data);
            setErrors({});
        }
    }

    const handleInputChange = (columnName: string, value: unknown): void => {
        setFormData(prev => ({
            ...prev,
            [columnName]: value
        }));
        // Clear error when user starts typing
        if (errors[columnName]) {
            setErrors(prev => {
                const updated = { ...prev };
                delete updated[columnName];
                return updated;
            });
        }
    };

    const validate = (): boolean => {
        const newErrors: FormErrors = {};

        columns.forEach(col => {
            const value = formData[col.name];

            // Bit fields are always valid (false is a valid value).
            if (col.required && col.type !== 'bit' && !value && value !== 0) {
                newErrors[col.name] = `${col.label} is required`;
            }

            // Check max length for string fields
            if (col.maxLength && value && String(value).length > col.maxLength) {
                newErrors[col.name] = `${col.label} must be ${col.maxLength} characters or less`;
            }

            // Check numeric fields
            if (col.type === 'int' && value !== '' && value !== null && value !== undefined) {
                if (isNaN(parseInt(String(value), 10))) {
                    newErrors[col.name] = `${col.label} must be a number`;
                }
            }
        });

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
        e.preventDefault();
        if (isSaving || !validate()) return;

        setIsSaving(true);
        try {
            await onSave(formData);
        } finally {
            setIsSaving(false);
        }
    };

    // Closing mid-save would drop the write's outcome on the floor.
    const close = (): void => {
        if (!isSaving) onClose();
    };

    const renderInput = (column: LookupColumn): React.ReactNode => {
        const raw = formData[column.name];
        const value = raw === null || raw === undefined ? '' : String(raw);
        const inputId = `lookup-field-${column.name}`;

        switch (column.type) {
            case 'bit':
                return (
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            id={inputId}
                            checked={raw === true || raw === 1 || raw === '1'}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange(column.name, e.target.checked)}
                            disabled={isSaving}
                        />
                        <span>{column.label}</span>
                    </label>
                );

            case 'int':
                return (
                    <input
                        type="number"
                        id={inputId}
                        value={value}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange(column.name, e.target.value)}
                        disabled={isSaving}
                        className={errors[column.name] ? 'input-error' : ''}
                    />
                );

            case 'reference': {
                const options = column.reference ? referenceOptions[column.reference.table] : undefined;
                const isLoading = column.reference && !options;
                return (
                    <select
                        id={inputId}
                        value={value}
                        onChange={(e: ChangeEvent<HTMLSelectElement>) => handleInputChange(column.name, e.target.value)}
                        disabled={isSaving || isLoading}
                        className={errors[column.name] ? 'input-error' : ''}
                    >
                        <option value="">{isLoading ? 'Loading…' : '— Select —'}</option>
                        {(options ?? []).map(opt => (
                            <option key={opt.id} value={opt.id}>{opt.label}</option>
                        ))}
                    </select>
                );
            }

            case 'date': {
                // Format date value for input (YYYY-MM-DD) using local getters —
                // avoids the UTC-midnight day-shift of toISOString() in a +tz browser.
                const dateValue = formatISODate(raw as string | Date | null | undefined);
                return (
                    <input
                        type="date"
                        id={inputId}
                        value={dateValue}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange(column.name, e.target.value)}
                        disabled={isSaving}
                        className={errors[column.name] ? 'input-error' : ''}
                    />
                );
            }

            case 'varchar':
            case 'nvarchar':
            default:
                // Use textarea for longer text fields
                if (column.maxLength && column.maxLength > 100) {
                    return (
                        <textarea
                            id={inputId}
                            value={value}
                            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => handleInputChange(column.name, e.target.value)}
                            disabled={isSaving}
                            rows={3}
                            maxLength={column.maxLength}
                            className={errors[column.name] ? 'input-error' : ''}
                        />
                    );
                }
                return (
                    <input
                        type="text"
                        id={inputId}
                        value={value}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleInputChange(column.name, e.target.value)}
                        disabled={isSaving}
                        maxLength={column.maxLength}
                        className={errors[column.name] ? 'input-error' : ''}
                    />
                );
        }
    };

    const isEditMode = !!editingItem;
    const singularName = tableName.endsWith('s') ? tableName.slice(0, -1) : tableName;

    return (
        <Modal
            isOpen={isOpen}
            onClose={close}
            ariaLabelledBy={TITLE_ID}
            contentClassName="lookup-editor-dialog"
            closeOnEscape={!isSaving}
            closeOnBackdropClick={!isSaving}
            unsavedGuard={{ watchInput: true }}
        >
            {(dismiss) => (
                <>
                    <ModalHeader
                        titleId={TITLE_ID}
                        icon={<i className={isEditMode ? 'fas fa-edit' : 'fas fa-plus'} />}
                        title={isEditMode ? `Edit ${singularName}` : `Add ${singularName}`}
                        onClose={dismiss}
                        dense
                    />
                    <form onSubmit={handleSubmit}>
                        <div className="lookup-dialog-body">
                            {columns.map(column => (
                                <div
                                    key={column.name}
                                    className={`form-group ${column.type === 'bit' ? 'form-group-checkbox' : ''}`}
                                >
                                    {column.type !== 'bit' && (
                                        <label htmlFor={`lookup-field-${column.name}`}>
                                            {column.label}
                                            {column.required && <span className="required">*</span>}
                                        </label>
                                    )}
                                    {renderInput(column)}
                                    {errors[column.name] && (
                                        <span className="field-error">{errors[column.name]}</span>
                                    )}
                                    {column.maxLength && column.type !== 'bit' && column.type !== 'int' && (
                                        <span className="field-hint">
                                            Max {column.maxLength} characters
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>

                        <div className="lookup-dialog-footer">
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={dismiss}
                                disabled={isSaving}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="btn btn-primary btn-sm"
                                disabled={isSaving}
                            >
                                {isSaving ? (
                                    <>
                                        <i className="fas fa-spinner fa-spin"></i>
                                        Saving...
                                    </>
                                ) : (
                                    <>
                                        <i className="fas fa-save"></i>
                                        {isEditMode ? 'Update' : 'Create'}
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                </>
            )}
        </Modal>
    );
};

export default LookupEditorModal;
