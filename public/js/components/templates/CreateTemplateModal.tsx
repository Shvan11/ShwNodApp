/**
 * Create Template Modal Component
 * Modal for creating new templates
 */

import { useState, type ChangeEvent, type FormEvent, type MouseEvent } from 'react';

interface DocumentType {
    type_id: number;
    type_name: string;
    icon: string;
}

interface TemplateFormData {
    template_name: string;
    description: string;
    document_type_id: string | number;
    paper_width: number;
    paper_height: number;
    paper_orientation: 'portrait' | 'landscape';
    is_default: boolean;
    is_active: boolean;
    created_by: string;
}

interface TemplateSubmissionData {
    template_name: string;
    description: string;
    document_type_id: number;
    paper_width: number;
    paper_height: number;
    paper_orientation: 'portrait' | 'landscape';
    is_default: boolean;
    is_active: boolean;
    created_by: string;
}

interface ModalStyles {
    readonly [key: string]: string;
}

interface CreateTemplateModalProps {
    documentTypes: DocumentType[];
    currentDocumentType: number | null;
    onClose: () => void;
    onCreate: (data: TemplateSubmissionData) => void;
    styles: ModalStyles;
}

function CreateTemplateModal({ documentTypes, currentDocumentType, onClose, onCreate, styles }: CreateTemplateModalProps) {
    const [formData, setFormData] = useState<TemplateFormData>({
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

    const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value, type } = e.target;
        const checked = (e.target as HTMLInputElement).checked;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        // Convert string values to numbers
        const submissionData: TemplateSubmissionData = {
            ...formData,
            document_type_id: parseInt(String(formData.document_type_id)),
            paper_width: Number(formData.paper_width),
            paper_height: Number(formData.paper_height)
        };

        onCreate(submissionData);
    };

    const handleOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
        if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
            onClose();
        }
    };

    return (
        <div className={styles.modalOverlay} onClick={handleOverlayClick}>
            <div className={styles.modalDialog}>
                <div className={styles.modalHeader}>
                    <h3>
                        <i className="fas fa-plus"></i> Create New Template
                    </h3>
                    <button className={styles.modalClose} onClick={onClose}>×</button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className={styles.modalBody}>
                        <div className={styles.formGroup}>
                            <label htmlFor="template_name">
                                Template Name <span className={styles.required}>*</span>
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

                        <div className={styles.formGroup}>
                            <label htmlFor="document_type_id">
                                Document Type <span className={styles.required}>*</span>
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

                        <div className={styles.formGroup}>
                            <label htmlFor="description">Description</label>
                            <textarea
                                id="description"
                                name="description"
                                className="form-control"
                                rows={3}
                                placeholder="Optional description of this template's purpose"
                                value={formData.description}
                                onChange={handleChange}
                            />
                        </div>

                        <div className={styles.formRow}>
                            <div className={styles.formGroup}>
                                <label htmlFor="paper_width">
                                    Paper Width (mm) <span className={styles.required}>*</span>
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
                            <div className={styles.formGroup}>
                                <label htmlFor="paper_height">
                                    Paper Height (mm) <span className={styles.required}>*</span>
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

                        <div className={styles.formGroup}>
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

                        <div className={styles.formGroup}>
                            <label className={styles.checkboxLabel}>
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
                    <div className={styles.modalFooter}>
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
}

export default CreateTemplateModal;
export type { DocumentType, TemplateFormData, TemplateSubmissionData, CreateTemplateModalProps };
