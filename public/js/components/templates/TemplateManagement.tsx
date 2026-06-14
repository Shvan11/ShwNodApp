/**
 * Template Management Component
 * Lists and manages document templates with filtering by document type
 */

import { useState, useMemo } from 'react';
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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { postJSON, putJSON, deleteJSON, httpErrorMessage } from '@/core/http';
import { qk } from '@/query/keys';
import { documentTypesQuery, templatesQuery } from '@/query/queries';

function TemplateManagement() {
    const navigate = useNavigate();
    const toast = useToast();
    const confirm = useConfirm();
    const queryClient = useQueryClient();

    // Document types + the full template list, both on useQuery. A template
    // write invalidates qk.templates.all() (a prefix of both keys), so the list
    // and stats refresh app-wide without a manual reload.
    const { data: documentTypesData } = useQuery(documentTypesQuery());
    const documentTypes = (documentTypesData ?? []) as DocumentType[];

    const { data: templatesData, isLoading, isError, refetch } = useQuery(templatesQuery());
    const allTemplates = useMemo(() => (templatesData ?? []) as Template[], [templatesData]);
    const error = isError ? 'Failed to load templates' : null;

    const [currentDocumentType, setCurrentDocumentType] = useState<number | null>(null);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

    // Until the user picks a tab, default to the first document type — derived,
    // not effect-synced, so there's no setState-on-render.
    const effectiveDocumentType = currentDocumentType ?? documentTypes[0]?.type_id ?? null;

    // Stat cards are pure derived data — recomputed (incl. resetting to 0 when the
    // list empties) straight from the loaded templates.
    const stats: TemplateStatsData = useMemo(() => ({
        total: allTemplates.length,
        active: allTemplates.filter(t => t.is_active).length,
        system: allTemplates.filter(t => t.is_system).length,
        usedToday: allTemplates.filter(t => {
            if (!t.last_used_date) return false;
            const lastUsed = new Date(t.last_used_date);
            const today = new Date();
            return lastUsed.toDateString() === today.toDateString();
        }).length
    }), [allTemplates]);

    const handleCreateTemplate = async (templateData: TemplateSubmissionData) => {
        try {
            const data = await postJSON<{ template_id: number }>('/api/templates', templateData);
            queryClient.invalidateQueries({ queryKey: qk.templates.all() });
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
            queryClient.invalidateQueries({ queryKey: qk.templates.all() });
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
            queryClient.invalidateQueries({ queryKey: qk.templates.all() });
            toast.success('Template deleted successfully!');
        } catch (err) {
            console.error('Error deleting template:', err);
            toast.error(httpErrorMessage(err, 'Failed to delete template'));
        }
    };

    const filteredTemplates = allTemplates.filter(
        t => t.document_type_id === effectiveDocumentType
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
                                    className={`${styles.tab} ${effectiveDocumentType === docType.type_id ? styles.tabActive : ''}`}
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
                            <button className="btn btn-primary" onClick={() => refetch()}>
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
                    currentDocumentType={effectiveDocumentType}
                    onClose={() => setIsCreateModalOpen(false)}
                    onCreate={handleCreateTemplate}
                    styles={styles}
                />
            )}
        </main>
    );
}

export default TemplateManagement;
