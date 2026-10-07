/**
 * Designer Toolbar Component
 * Toolbar for template designer with save/preview/back actions
 */

interface DesignerStyles {
    readonly [key: string]: string;
}

interface DesignerToolbarProps {
    templateName: string;
    onBack: () => void;
    onPreview: () => void;
    onSave: () => void;
    isSaving: boolean;
    styles: DesignerStyles;
}

function DesignerToolbar({ templateName, onBack, onPreview, onSave, isSaving, styles }: DesignerToolbarProps) {
    return (
        <div className={styles.designerHeader}>
            <div className={styles.designerTitle}>
                <button className="btn btn-secondary" onClick={onBack}>
                    <i className="fas fa-arrow-left" aria-hidden="true"></i> Back
                </button>
                {/* Every document type is designed here, not only receipts (FE-F20-9c). */}
                <h1>Template Designer</h1>
                <div className={styles.templateInfo}>
                    <i className="fas fa-file-invoice" aria-hidden="true"></i>
                    <span>{templateName}</span>
                </div>
            </div>
            <div className={styles.designerActions}>
                <button className="btn btn-secondary" onClick={onPreview}>
                    <i className="fas fa-eye" aria-hidden="true"></i> Preview
                </button>
                <button
                    className="btn btn-primary"
                    onClick={onSave}
                    disabled={isSaving}
                >
                    <i className={`fas ${isSaving ? 'fa-spinner fa-spin' : 'fa-save'}`} aria-hidden="true"></i>
                    {isSaving ? ' Saving...' : ' Save Template'}
                </button>
            </div>
        </div>
    );
}

export default DesignerToolbar;
export type { DesignerToolbarProps };
