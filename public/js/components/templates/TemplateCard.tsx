/**
 * Template Card Component
 * Displays a single template with actions
 */

interface Template {
    template_id: number;
    template_name: string;
    template_file_path: string | null;
    description: string | null;
    document_type_id: number;
    last_used_date: string | null;
    created_by: string | null;
    is_default: boolean;
    is_active: boolean;
    is_system: boolean;
}

interface TemplateStyles {
    readonly [key: string]: string;
}

interface TemplateCardProps {
    template: Template;
    onEdit: (templateId: number) => void;
    onSetDefault: (templateId: number) => void;
    onDelete: (templateId: number, templateName: string) => void;
    styles: TemplateStyles;
}

function TemplateCard({ template, onEdit, onSetDefault, onDelete, styles }: TemplateCardProps) {
    const lastUsed = template.last_used_date
        ? new Date(template.last_used_date).toLocaleDateString()
        : 'Never';

    return (
        <div className={`${styles.templateCard} ${template.is_default ? styles.templateCardDefault : ''}`}>
            <div className={styles.templateCardHeader}>
                <div className={styles.templateTitle}>
                    <h4>{template.template_name}</h4>
                </div>
                <div className={styles.templateBadges}>
                    {template.is_default && (
                        <span className={`${styles.badge} ${styles.badgeDefault}`}>
                            <i className="fas fa-star"></i> Default
                        </span>
                    )}
                    {template.is_active ? (
                        <span className={`${styles.badge} ${styles.badgeActive}`}>
                            <i className="fas fa-check"></i> Active
                        </span>
                    ) : (
                        <span className={`${styles.badge} ${styles.badgeInactive}`}>
                            <i className="fas fa-times"></i> Inactive
                        </span>
                    )}
                    {template.is_system && (
                        <span className={`${styles.badge} ${styles.badgeSystem}`}>
                            <i className="fas fa-shield-alt"></i> System
                        </span>
                    )}
                </div>
                <div className={styles.templateMeta}>
                    <div className={styles.metaItem}>
                        <i className="fas fa-file"></i>
                        <span>{template.template_file_path || 'No file'}</span>
                    </div>
                    <div className={styles.metaItem}>
                        <i className="fas fa-clock"></i>
                        <span>Last used: {lastUsed}</span>
                    </div>
                    <div className={styles.metaItem}>
                        <i className="fas fa-user"></i>
                        <span>Created by: {template.created_by || 'Unknown'}</span>
                    </div>
                </div>
            </div>
            <div className={styles.templateCardBody}>
                {template.description && (
                    <p className={styles.templateDescription}>{template.description}</p>
                )}
                <div className={styles.templateActions}>
                    <button
                        className="btn btn-sm btn-primary"
                        onClick={() => onEdit(template.template_id)}
                    >
                        <i className="fas fa-edit"></i> Edit Design
                    </button>
                    {!template.is_default && (
                        <button
                            className="btn btn-sm btn-success"
                            onClick={() => onSetDefault(template.template_id)}
                        >
                            <i className="fas fa-star"></i> Set Default
                        </button>
                    )}
                    {!template.is_system && (
                        <button
                            className="btn btn-sm btn-danger"
                            onClick={() => onDelete(template.template_id, template.template_name)}
                        >
                            <i className="fas fa-trash"></i> Delete
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

export default TemplateCard;
export type { Template, TemplateCardProps };
