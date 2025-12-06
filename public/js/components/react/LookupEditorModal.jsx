import React, { useState, useEffect } from 'react';

/**
 * Modal for adding/editing lookup table items
 * Dynamically generates form fields based on column configuration
 */
const LookupEditorModal = ({ isOpen, onClose, onSave, columns, editingItem, tableName, idColumn }) => {
    const [formData, setFormData] = useState({});
    const [errors, setErrors] = useState({});
    const [isSaving, setIsSaving] = useState(false);

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

    const handleOverlayClick = (e) => {
        if (e.target === e.currentTarget && !isSaving) {
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

    if (!isOpen) return null;

    const isEditMode = !!editingItem;
    const singularName = tableName.endsWith('s') ? tableName.slice(0, -1) : tableName;

    return (
        <div className="modal lookup-editor-modal" onClick={handleOverlayClick}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>
                        <i className={isEditMode ? 'fas fa-edit' : 'fas fa-plus'}></i>
                        {isEditMode ? `Edit ${singularName}` : `Add ${singularName}`}
                    </h3>
                    <button
                        className="modal-close"
                        onClick={onClose}
                        disabled={isSaving}
                        type="button"
                    >
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="modal-body">
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

                    <div className="modal-footer">
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={onClose}
                            disabled={isSaving}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="btn btn-primary"
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
        </div>
    );
};

export default LookupEditorModal;
