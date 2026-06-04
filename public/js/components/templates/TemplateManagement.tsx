/**
 * Template Management Component
 * Lists and manages document templates with filtering by document type
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './TemplateManagement.module.css';
import TemplateCard from './TemplateCard';
import CreateTemplateModal from './CreateTemplateModal';
import TemplateStats from './TemplateStats';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import type { Template } from './TemplateCard';
import type { DocumentType, TemplateSubmissionData } from './CreateTemplateModal';
import type { TemplateStatsData } from './TemplateStats';
import { fetchJSON, postJSON, putJSON, deleteJSON, httpErrorMessage } from '@/core/http';

function TemplateManagement() {
    const navigate = useNavigate();
    const toast = useToast();
    const confirm = useConfirm();

    const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([]);
    const [allTemplates, setAllTemplates] = useState<Template[]>([]);
    const [currentDocumentType, setCurrentDocumentType] = useState<number | null>(null);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [stats, setStats] = useState<TemplateStatsData>({
        total: 0,
        active: 0,
        system: 0,
        usedToday: 0
    });

    useEffect(() => {
        loadDocumentTypes();
        loadAllTemplates();
    }, []);

    useEffect(() => {
        // Recalculate unconditionally — including when the list becomes empty
        // (e.g. after deleting the last template) so the stat cards reset to 0.
        calculateStats();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allTemplates]);

    useEffect(() => {
        if (!currentDocumentType && documentTypes.length > 0) {
            setCurrentDocumentType(documentTypes[0].type_id);
        }
    }, [documentTypes, currentDocumentType]);

    const loadDocumentTypes = async () => {
        try {
            const data = await fetchJSON<DocumentType[]>('/api/templates/document-types');
            setDocumentTypes(data ?? []);
        } catch (err) {
            console.error('Error loading document types:', err);
            setError('Failed to load document types');
        }
    };

    const loadAllTemplates = async () => {
        try {
            setIsLoading(true);
            const data = await fetchJSON<Template[]>('/api/templates');
            setAllTemplates(data ?? []);
            setError(null);
        } catch (err) {
            console.error('Error loading templates:', err);
            setError('Failed to load templates');
        } finally {
            setIsLoading(false);
        }
    };

    const calculateStats = () => {
        setStats({
            total: allTemplates.length,
            active: allTemplates.filter(t => t.is_active).length,
            system: allTemplates.filter(t => t.is_system).length,
            usedToday: allTemplates.filter(t => {
                if (!t.last_used_date) return false;
                const lastUsed = new Date(t.last_used_date);
                const today = new Date();
                return lastUsed.toDateString() === today.toDateString();
            }).length
        });
    };

    const handleCreateTemplate = async (templateData: TemplateSubmissionData) => {
        try {
            const data = await postJSON<{ template_id: number }>('/api/templates', templateData);
            setIsCreateModalOpen(false);
            // Navigate to designer
            navigate(`/templates/designer/${data.template_id}`);
        } catch (err) {
            console.error('Error creating template:', err);
            toast.error(httpErrorMessage(err, 'Failed to create template'));
        }
    };

    const handleEditTemplate = (templateId: number) => {
        navigate(`/templates/designer/${templateId}`);
    };

    const handleSetDefault = async (templateId: number) => {
        if (!await confirm('Set this template as the default for this document type?', { title: 'Set Default Template', confirmText: 'Set Default' })) {
            return;
        }

        try {
            await putJSON(`/api/templates/${templateId}`, { is_default: true, modified_by: 'user' });
            await loadAllTemplates();
            toast.success('Template set as default!');
        } catch (err) {
            console.error('Error setting default:', err);
            toast.error(httpErrorMessage(err, 'Failed to set as default'));
        }
    };

    const handleDeleteTemplate = async (templateId: number, templateName: string) => {
        if (!await confirm(`Are you sure you want to delete "${templateName}"?\n\nThis action cannot be undone.`, { title: 'Delete Template', danger: true, confirmText: 'Delete' })) {
            return;
        }

        try {
            await deleteJSON(`/api/templates/${templateId}`);
            await loadAllTemplates();
            toast.success('Template deleted successfully!');
        } catch (err) {
            console.error('Error deleting template:', err);
            toast.error(httpErrorMessage(err, 'Failed to delete template'));
        }
    };

    const filteredTemplates = allTemplates.filter(
        t => t.document_type_id === currentDocumentType
    );

    return (
        <main className={styles.mainContent}>
            <div className={styles.container}>
                {/* Page Header */}
                <div className={styles.pageHeader}>
                    <div className={styles.headerContent}>
                        <h2>
                            <i className="fas fa-file-alt"></i> Document Template Management
                        </h2>
                        <p>Design and manage templates for receipts, invoices, prescriptions, and more</p>
                    </div>
                    <button
                        className="btn btn-primary"
                        onClick={() => setIsCreateModalOpen(true)}
                    >
                        <i className="fas fa-plus"></i> Create New Template
                    </button>
                </div>

                {/* Statistics */}
                <TemplateStats stats={stats} styles={styles} />

                {/* Document Type Tabs */}
                <div className={styles.tabsContainer}>
                    <div className={styles.tabs}>
                        {documentTypes.map(docType => {
                            const templateCount = allTemplates.filter(
                                t => t.document_type_id === docType.type_id
                            ).length;

                            return (
                                <button
                                    key={docType.type_id}
                                    className={`${styles.tab} ${currentDocumentType === docType.type_id ? styles.tabActive : ''}`}
                                    onClick={() => setCurrentDocumentType(docType.type_id)}
                                >
                                    <i className={`fas ${docType.icon}`}></i>
                                    {docType.type_name}
                                    <span className={styles.tabBadge}>{templateCount}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Templates List */}
                <div className={styles.templatesContainer}>
                    {isLoading ? (
                        <div className={styles.loadingState}>
                            <i className="fas fa-spinner fa-spin"></i>
                            <p>Loading templates...</p>
                        </div>
                    ) : error ? (
                        <div className={styles.errorState}>
                            <i className="fas fa-exclamation-circle"></i>
                            <p>{error}</p>
                            <button className="btn btn-primary" onClick={loadAllTemplates}>
                                Retry
                            </button>
                        </div>
                    ) : filteredTemplates.length === 0 ? (
                        <div className={styles.emptyState}>
                            <i className="fas fa-file-alt"></i>
                            <h3>No templates found</h3>
                            <p>Create your first template to get started</p>
                            <button
                                className="btn btn-primary"
                                onClick={() => setIsCreateModalOpen(true)}
                            >
                                <i className="fas fa-plus"></i> Create Template
                            </button>
                        </div>
                    ) : (
                        <div className={styles.templatesGrid}>
                            {filteredTemplates.map(template => (
                                <TemplateCard
                                    key={template.template_id}
                                    template={template}
                                    onEdit={handleEditTemplate}
                                    onSetDefault={handleSetDefault}
                                    onDelete={handleDeleteTemplate}
                                    styles={styles}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Create Template Modal */}
            {isCreateModalOpen && (
                <CreateTemplateModal
                    documentTypes={documentTypes}
                    currentDocumentType={currentDocumentType}
                    onClose={() => setIsCreateModalOpen(false)}
                    onCreate={handleCreateTemplate}
                    styles={styles}
                />
            )}
        </main>
    );
}

export default TemplateManagement;
