import React, { useState, useEffect, useMemo, useRef, FormEvent, ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { useQueries } from '@tanstack/react-query';
import { formatISODate } from '../../core/utils';
import { adminLookupItemsQuery } from '@/query/queries';

// Types
interface ReferenceConfig {
    table: string;
    idColumn: string;
    displayColumn: string;
}

interface ColumnConfig {
    name: string;
    label: string;
    type: string;
    required?: boolean;
    maxLength?: number;
    reference?: ReferenceConfig;
}

type ReferenceOption = { id: string | number; label: string };

interface LookupItem {
    [key: string]: any;
}

interface Position {
    top: number;
    left: number;
}

interface FormData {
    [key: string]: any;
}

interface FormErrors {
    [key: string]: string;
}

interface LookupEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: FormData) => Promise<void>;
    columns: ColumnConfig[];
    editingItem: LookupItem | null;
    tableName: string;
    idColumn: string;
    anchorEl: HTMLElement | null;
}

/**
 * Positioned modal for adding/editing lookup table items
 * Appears next to the anchor element (edit button or add button)
 */
// Pure positioner — module-scoped, takes an already-measured rect (keeps the DOM
// read at the call site).
const calculatePosition = (rect: DOMRect): Position => {
    const modalWidth = 420;
    const modalHeight = 400;
    const padding = 12;

    let left = rect.left - modalWidth - padding;
    let top = rect.top;

    if (left < padding) {
        left = rect.right + padding;
    }

    if (left + modalWidth > window.innerWidth - padding) {
        left = Math.max(padding, window.innerWidth - modalWidth - padding);
    }

    if (top + modalHeight > window.innerHeight - padding) {
        top = Math.max(padding, window.innerHeight - modalHeight - padding);
    }
    top = Math.max(padding, top);

    return { top, left };
};

const LookupEditorModal: React.FC<LookupEditorModalProps> = ({ isOpen, onClose, onSave, columns, editingItem, tableName, idColumn: _idColumn, anchorEl }) => {
    const [formData, setFormData] = useState<FormData>({});
    const [errors, setErrors] = useState<FormErrors>({});
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [position, setPosition] = useState<Position | null>(null);
    const modalRef = useRef<HTMLDivElement>(null);

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
    const refQueries = useQueries({
        queries: refTables.map(table => adminLookupItemsQuery(table)),
    });

    // Map fetched rows into { id, label } per table for the select inputs. A table
    // whose fetch failed/pending stays absent → renderInput shows a disabled select.
    const referenceOptions = useMemo(() => {
        const out: Record<string, ReferenceOption[]> = {};
        refTables.forEach((table, i) => {
            const rows = refQueries[i]?.data as LookupItem[] | undefined;
            if (!rows) return;
            const refCol = refColumns.find(c => c.reference!.table === table)!.reference!;
            out[table] = rows.map(r => ({
                id: r[refCol.idColumn],
                label: String(r[refCol.displayColumn] ?? ''),
            }));
        });
        return out;
    }, [refTables, refQueries, refColumns]);

    // Initialize form data when the modal opens or the edited item changes — keyed
    // adjust-during-render, no setState-in-effect. `columns` is the stable per-table
    // schema (read here, not part of the key, so an unstable prop ref can't loop).
    const [seededItem, setSeededItem] = useState<{ open: boolean; item: unknown }>({ open: false, item: null });
    if (seededItem.open !== isOpen || seededItem.item !== editingItem) {
        setSeededItem({ open: isOpen, item: editingItem });
        if (isOpen) {
            if (editingItem) {
                // Edit mode: populate form with existing values
                const data: FormData = {};
                columns.forEach(col => {
                    data[col.name] = editingItem[col.name] ?? '';
                });
                setFormData(data);
            } else {
                // Add mode: initialize with empty values
                const data: FormData = {};
                columns.forEach(col => {
                    data[col.name] = col.type === 'bit' ? false : '';
                });
                setFormData(data);
            }
            setErrors({});
        }
    }

    // Position modal next to the anchor. Seeded by measuring during render (keyed
    // adjust-during-render, mirroring the form seeding above) so the only
    // synchronous setState stays out of the effect (react-hooks/set-state-in-effect).
    const [seededPos, setSeededPos] = useState<{ open: boolean; anchor: HTMLElement | null }>({ open: false, anchor: null });
    if (seededPos.open !== isOpen || seededPos.anchor !== anchorEl) {
        setSeededPos({ open: isOpen, anchor: anchorEl });
        setPosition(isOpen && anchorEl ? calculatePosition(anchorEl.getBoundingClientRect()) : null);
    }

    // Keep the modal pinned to the anchor as the viewport changes — setState lives
    // in the event callback, never synchronously in the effect body.
    useEffect(() => {
        if (!isOpen || !anchorEl) return;
        const updatePosition = (): void => setPosition(calculatePosition(anchorEl.getBoundingClientRect()));
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);

        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [isOpen, anchorEl]);

    // Close on escape key
    useEffect(() => {
        if (!isOpen) return;
        const handleEscape = (e: KeyboardEvent): void => {
            if (e.key === 'Escape' && !isSaving) onClose();
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isOpen, isSaving, onClose]);

    const handleInputChange = (columnName: string, value: any): void => {
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

            // Check required
            if (col.required) {
                if (col.type === 'bit') {
                    // Bit fields are always valid (false is a valid value)
                } else if (!value && value !== 0) {
                    newErrors[col.name] = `${col.label} is required`;
                }
            }

            // Check max length for string fields
            if (col.maxLength && value && String(value).length > col.maxLength) {
                newErrors[col.name] = `${col.label} must be ${col.maxLength} characters or less`;
            }

            // Check numeric fields
            if (col.type === 'int' && value !== '' && value !== null && value !== undefined) {
                const numVal = parseInt(value, 10);
                if (isNaN(numVal)) {
                    newErrors[col.name] = `${col.label} must be a number`;
                }
            }
        });

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
        e.preventDefault();

        if (!validate()) {
            return;
        }

        setIsSaving(true);
        try {
            await onSave(formData);
        } finally {
            setIsSaving(false);
        }
    };

    const handleBackdropClick = (): void => {
        if (!isSaving) {
            onClose();
        }
    };

    const renderInput = (column: ColumnConfig): React.ReactNode => {
        const value = formData[column.name] ?? '';
        const inputId = `lookup-field-${column.name}`;

        switch (column.type) {
            case 'bit':
                return (
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            id={inputId}
                            checked={value === true || value === 1 || value === '1'}
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
                        value={value === null || value === undefined ? '' : String(value)}
                        onChange={(e: ChangeEvent<HTMLSelectElement>) => handleInputChange(column.name, e.target.value)}
                        disabled={isSaving || isLoading}
                        className={errors[column.name] ? 'input-error' : ''}
                    >
                        <option value="">{isLoading ? 'Loading…' : '— Select —'}</option>
                        {(options ?? []).map(opt => (
                            <option key={String(opt.id)} value={String(opt.id)}>{opt.label}</option>
                        ))}
                    </select>
                );
            }

            case 'date': {
                // Format date value for input (YYYY-MM-DD) using local getters —
                // avoids the UTC-midnight day-shift of toISOString() in a +tz browser.
                const dateValue = formatISODate(value as string | Date | null | undefined);
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

    if (!isOpen || !position) return null;

    const isEditMode = !!editingItem;
    const singularName = tableName.endsWith('s') ? tableName.slice(0, -1) : tableName;

    return createPortal(
        <>
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- backdrop click-to-dismiss */}
            <div className="popover-backdrop" onClick={handleBackdropClick} />
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- backdrop click-to-dismiss */}
            <div
                ref={modalRef}
                className="lookup-editor-popover"
                style={{ top: position.top, left: position.left }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="popover-header">
                    <h3>
                        <i className={isEditMode ? 'fas fa-edit' : 'fas fa-plus'}></i>
                        {isEditMode ? `Edit ${singularName}` : `Add ${singularName}`}
                    </h3>
                    <button
                        className="popover-close"
                        onClick={onClose}
                        disabled={isSaving}
                        type="button"
                    >
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="popover-body">
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

                    <div className="popover-footer">
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={onClose}
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
            </div>
        </>,
        document.body
    );
};

export default LookupEditorModal;
