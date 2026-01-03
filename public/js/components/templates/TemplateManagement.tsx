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
import type { Template } from './TemplateCard';
import type { DocumentType, TemplateSubmissionData } from './CreateTemplateModal';
import type { TemplateStatsData } from './TemplateStats';

interface ApiResponse<T> {
    status: 'success' | 'error';
    data: T;
    message?: string;
}

function TemplateManagement() {
    const navigate = useNavigate();
    const toast = useToast();

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
        if (allTemplates.length > 0) {
            calculateStats();
        }
    }, [allTemplates]);

    useEffect(() => {
        if (!currentDocumentType && documentTypes.length > 0) {
            setCurrentDocumentType(documentTypes[0].type_id);
        }
    }, [documentTypes, currentDocumentType]);

    const loadDocumentTypes = async () => {
        try {
            const response = await fetch('/api/templates/document-types');
            const result: ApiResponse<DocumentType[]> = await response.json();

            if (result.status === 'success') {
                setDocumentTypes(result.data);
            } else {
                throw new Error(result.message || 'Failed to load document types');
            }
        } catch (err) {
            console.error('Error loading document types:', err);
            setError('Failed to load document types');
        }
    };

    const loadAllTemplates = async () => {
        try {
            setIsLoading(true);
            const response = await fetch('/api/templates');
            const result: ApiResponse<Template[]> = await response.json();

            if (result.status === 'success') {
                setAllTemplates(result.data);
                setError(null);
            } else {
                throw new Error(result.message || 'Failed to load templates');
            }
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
            const response = await fetch('/api/templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(templateData)
            });

            const result: ApiResponse<{ template_id: number }> = await response.json();

            if (result.status === 'success') {
                setIsCreateModalOpen(false);
                // Navigate to designer
                navigate(`/templates/designer/${result.data.template_id}`);
            } else {
                throw new Error(result.message || 'Failed to create template');
            }
        } catch (err) {
            console.error('Error creating template:', err);
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            toast.error(errorMessage);
        }
    };

    const handleEditTemplate = (templateId: number) => {
        navigate(`/templates/designer/${templateId}`);
    };

    const handleSetDefault = async (templateId: number) => {
        if (!confirm('Set this template as the default for this document type?')) {
            return;
        }

        try {
            const response = await fetch(`/api/templates/${templateId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    is_default: true,
                    modified_by: 'user'
                })
            });

            const result: ApiResponse<unknown> = await response.json();

            if (result.status === 'success') {
                await loadAllTemplates();
                toast.success('Template set as default!');
            } else {
                throw new Error(result.message || 'Failed to set as default');
            }
        } catch (err) {
            console.error('Error setting default:', err);
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            toast.error(errorMessage);
        }
    };

    const handleDeleteTemplate = async (templateId: number, templateName: string) => {
        if (!confirm(`Are you sure you want to delete "${templateName}"?\n\nThis action cannot be undone.`)) {
            return;
        }

        try {
            const response = await fetch(`/api/templates/${templateId}`, {
                method: 'DELETE'
            });

            const result: ApiResponse<unknown> = await response.json();

            if (result.status === 'success') {
                await loadAllTemplates();
                toast.success('Template deleted successfully!');
            } else {
                throw new Error(result.message || 'Failed to delete template');
            }
        } catch (err) {
            console.error('Error deleting template:', err);
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            toast.error(errorMessage);
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
