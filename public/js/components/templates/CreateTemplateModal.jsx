/**
 * Create Template Modal Component
 * Modal for creating new templates
 */

import React, { useState } from 'react';

const CreateTemplateModal = ({ documentTypes, currentDocumentType, onClose, onCreate }) => {
    const [formData, setFormData] = useState({
        template_name: '',
        description: '',
        document_type_id: currentDocumentType || '',
        paper_width: 80,
        paper_height: 297,
        paper_orientation: 'portrait',
        is_default: false,
        is_active: true,
        created_by: 'user'
    });

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();

        // Convert string values to numbers
        const submissionData = {
            ...formData,
            document_type_id: parseInt(formData.document_type_id),
            paper_width: parseInt(formData.paper_width),
            paper_height: parseInt(formData.paper_height)
        };

        onCreate(submissionData);
    };

    const handleOverlayClick = (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            onClose();
        }
    };

    return (
        <div className="modal-overlay" onClick={handleOverlayClick}>
            <div className="modal-dialog">
                <div className="modal-header">
                    <h3>
                        <i className="fas fa-plus"></i> Create New Template
                    </h3>
                    <button className="modal-close" onClick={onClose}>×</button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className="modal-body">
                        <div className="form-group">
                            <label htmlFor="template_name">
                                Template Name <span className="required">*</span>
                            </label>
                            <input
                                type="text"
                                id="template_name"
                                name="template_name"
                                className="form-control"
                                required
                                placeholder="e.g., Standard Receipt, Detailed Invoice"
                                value={formData.template_name}
                                onChange={handleChange}
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="document_type_id">
                                Document Type <span className="required">*</span>
                            </label>
                            <select
                                id="document_type_id"
                                name="document_type_id"
                                className="form-control"
                                required
                                value={formData.document_type_id}
                                onChange={handleChange}
                            >
                                <option value="">Select document type...</option>
                                {documentTypes.map(docType => (
                                    <option key={docType.type_id} value={docType.type_id}>
                                        {docType.type_name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="form-group">
                            <label htmlFor="description">Description</label>
                            <textarea
                                id="description"
                                name="description"
                                className="form-control"
                                rows="3"
                                placeholder="Optional description of this template's purpose"
                                value={formData.description}
                                onChange={handleChange}
                            />
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label htmlFor="paper_width">
                                    Paper Width (mm) <span className="required">*</span>
                                </label>
                                <input
                                    type="number"
                                    id="paper_width"
                                    name="paper_width"
                                    className="form-control"
                                    required
                                    value={formData.paper_width}
                                    onChange={handleChange}
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="paper_height">
                                    Paper Height (mm) <span className="required">*</span>
                                </label>
                                <input
                                    type="number"
                                    id="paper_height"
                                    name="paper_height"
                                    className="form-control"
                                    required
                                    value={formData.paper_height}
                                    onChange={handleChange}
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label htmlFor="paper_orientation">Orientation</label>
                            <select
                                id="paper_orientation"
                                name="paper_orientation"
                                className="form-control"
                                value={formData.paper_orientation}
                                onChange={handleChange}
                            >
                                <option value="portrait">Portrait</option>
                                <option value="landscape">Landscape</option>
                            </select>
                        </div>

                        <div className="form-group">
                            <label className="checkbox-label">
                                <input
                                    type="checkbox"
                                    id="is_default"
                                    name="is_default"
                                    checked={formData.is_default}
                                    onChange={handleChange}
                                />
                                <span>Set as default template for this document type</span>
                            </label>
                        </div>
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" onClick={onClose}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-primary">
                            <i className="fas fa-check"></i> Create & Open Designer
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CreateTemplateModal;
