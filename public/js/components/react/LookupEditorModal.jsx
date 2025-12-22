import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * Positioned modal for adding/editing lookup table items
 * Appears next to the anchor element (edit button or add button)
 */
const LookupEditorModal = ({ isOpen, onClose, onSave, columns, editingItem, tableName, idColumn, anchorEl }) => {
    const [formData, setFormData] = useState({});
    const [errors, setErrors] = useState({});
    const [isSaving, setIsSaving] = useState(false);
    const [position, setPosition] = useState(null);
    const modalRef = useRef(null);

    // Initialize form data when modal opens or editingItem changes
    useEffect(() => {
        if (isOpen) {
            if (editingItem) {
                // Edit mode: populate form with existing values
                const data = {};
                columns.forEach(col => {
                    data[col.name] = editingItem[col.name] ?? '';
                });
                setFormData(data);
            } else {
                // Add mode: initialize with empty values
                const data = {};
                columns.forEach(col => {
                    data[col.name] = col.type === 'bit' ? false : '';
                });
                setFormData(data);
            }
            setErrors({});
        }
    }, [isOpen, editingItem, columns]);

    // Calculate position - runs synchronously before paint to prevent flicker
    const calculatePosition = (anchor) => {
        if (!anchor) return null;

        const rect = anchor.getBoundingClientRect();
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

    // Position modal next to anchor element - useLayoutEffect prevents flicker
    useLayoutEffect(() => {
        if (!isOpen || !anchorEl) {
            setPosition(null);
            return;
        }

        setPosition(calculatePosition(anchorEl));

        const updatePosition = () => setPosition(calculatePosition(anchorEl));
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
        const handleEscape = (e) => {
            if (e.key === 'Escape' && !isSaving) onClose();
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isOpen, isSaving, onClose]);

    const handleInputChange = (columnName, value) => {
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

    const validate = () => {
        const newErrors = {};

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

    const handleSubmit = async (e) => {
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

    const handleBackdropClick = () => {
        if (!isSaving) {
            onClose();
        }
    };

    const renderInput = (column) => {
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
                            onChange={(e) => handleInputChange(column.name, e.target.checked)}
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
                        onChange={(e) => handleInputChange(column.name, e.target.value)}
                        disabled={isSaving}
                        className={errors[column.name] ? 'input-error' : ''}
                    />
                );

            case 'date':
                // Format date value for input (YYYY-MM-DD)
                const dateValue = value ? (
                    value instanceof Date
                        ? value.toISOString().split('T')[0]
                        : String(value).split('T')[0]
                ) : '';
                return (
                    <input
                        type="date"
                        id={inputId}
                        value={dateValue}
                        onChange={(e) => handleInputChange(column.name, e.target.value)}
                        disabled={isSaving}
                        className={errors[column.name] ? 'input-error' : ''}
                    />
                );

            case 'varchar':
            case 'nvarchar':
            default:
                // Use textarea for longer text fields
                if (column.maxLength && column.maxLength > 100) {
                    return (
                        <textarea
                            id={inputId}
                            value={value}
                            onChange={(e) => handleInputChange(column.name, e.target.value)}
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
                        onChange={(e) => handleInputChange(column.name, e.target.value)}
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
            <div className="popover-backdrop" onClick={handleBackdropClick} />
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
