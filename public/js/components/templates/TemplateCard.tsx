/**
 * Template Card Component
 * Displays a single template with actions
 */
import type { DocumentTemplateRow } from '@shared/contracts/template.contract';
import { formatLocaleDate } from '../../utils/formatters';

// The contract's row, not a hand-written copy cast into place (FE-F20-11).
type Template = DocumentTemplateRow;

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
    const lastUsed = formatLocaleDate(template.last_used_date) || 'Never';

    return (
        <div className={`${styles.templateCard} ${template.is_default ? styles.templateCardDefault : ''}`}>
            <div className={styles.templateCardHeader}>
                <div className={styles.templateTitle}>
                    <h4>{template.template_name}</h4>
                </div>
                <div className={styles.templateBadges}>
                    {template.is_default && (
                        <span className={`${styles.badge} ${styles.badgeDefault}`}>
                            <i className="fas fa-star" aria-hidden="true"></i> Default
                        </span>
                    )}
                    {template.is_active ? (
                        <span className={`${styles.badge} ${styles.badgeActive}`}>
                            <i className="fas fa-check" aria-hidden="true"></i> Active
                        </span>
                    ) : (
                        <span className={`${styles.badge} ${styles.badgeInactive}`}>
                            <i className="fas fa-times" aria-hidden="true"></i> Inactive
                        </span>
                    )}
                    {template.is_system && (
                        <span className={`${styles.badge} ${styles.badgeSystem}`}>
                            <i className="fas fa-shield-alt" aria-hidden="true"></i> System
                        </span>
                    )}
                </div>
                <div className={styles.templateMeta}>
                    <div className={styles.metaItem}>
                        <i className="fas fa-file" aria-hidden="true"></i>
                        <span>{template.template_file_path || 'No file'}</span>
                    </div>
                    <div className={styles.metaItem}>
                        <i className="fas fa-clock" aria-hidden="true"></i>
                        <span>Last used: {lastUsed}</span>
                    </div>
                    <div className={styles.metaItem}>
                        <i className="fas fa-user" aria-hidden="true"></i>
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
                        <i className="fas fa-edit" aria-hidden="true"></i> Edit Design
                    </button>
                    {!template.is_default && (
                        <button
                            className="btn btn-sm btn-success"
                            onClick={() => onSetDefault(template.template_id)}
                        >
                            <i className="fas fa-star" aria-hidden="true"></i> Set Default
                        </button>
                    )}
                    {!template.is_system && (
                        <button
                            className="btn btn-sm btn-danger"
                            onClick={() => onDelete(template.template_id, template.template_name)}
                        >
                            <i className="fas fa-trash" aria-hidden="true"></i> Delete
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

export default TemplateCard;
export type { Template, TemplateCardProps };
