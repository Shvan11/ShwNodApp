/**
 * Create Template Modal Component
 * Modal for creating new templates
 */

import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { CreateTemplateBody, DocumentTypeRow } from '@shared/contracts/template.contract';
import Modal from '../react/Modal';
import ModalHeader from '../react/ModalHeader';

/** The form as typed — numbers arrive from inputs as strings until submit. */
interface TemplateFormData {
    template_name: string;
    description: string;
    document_type_id: string | number;
    paper_width: number | string;
    paper_height: number | string;
    paper_orientation: 'portrait' | 'landscape';
    is_default: boolean;
    is_active: boolean;
}

interface ModalStyles {
    readonly [key: string]: string;
}

interface CreateTemplateModalProps {
    documentTypes: DocumentTypeRow[];
    currentDocumentType: number | null;
    onClose: () => void;
    /** Resolves when the create settled (either way), so the form can take another submit. */
    onCreate: (data: CreateTemplateBody) => Promise<void>;
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
    });
    // One create at a time: a double submit made two templates (FE-F20-9d).
    const [isCreating, setIsCreating] = useState(false);
    const creatingRef = useRef(false);

    const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value, type } = e.target;
        const checked = (e.target as HTMLInputElement).checked;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (creatingRef.current) return;
        creatingRef.current = true;
        setIsCreating(true);

        // Convert string values to numbers. No `created_by`: the server records the
        // session's user (the literal 'user' this sent was what every card showed).
        const submissionData: CreateTemplateBody = {
            ...formData,
            document_type_id: parseInt(String(formData.document_type_id), 10),
            paper_width: Number(formData.paper_width),
            paper_height: Number(formData.paper_height)
        };

        try {
            await onCreate(submissionData);
        } finally {
            creatingRef.current = false;
            setIsCreating(false);
        }
    };

    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            contentClassName={styles.modalDialog}
            ariaLabelledBy="create-template-modal-title"
            unsavedGuard={{ watchInput: true }}
        >
            {(dismiss) => (<>
                <ModalHeader
                    titleId="create-template-modal-title"
                    icon={<i className="fas fa-plus" />}
                    title="Create New Template"
                    onClose={dismiss}
                />
                <form onSubmit={(e) => void handleSubmit(e)}>
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
                        <button type="button" className="btn btn-secondary" onClick={dismiss}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={isCreating}>
                            <i className={`fas ${isCreating ? 'fa-spinner fa-spin' : 'fa-check'}`}></i>
                            {isCreating ? ' Creating…' : ' Create & Open Designer'}
                        </button>
                    </div>
                </form>
            </>)}
        </Modal>
    );
}

export default CreateTemplateModal;
export type { TemplateFormData, CreateTemplateModalProps };
