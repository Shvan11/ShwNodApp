/**
 * Designer Toolbar Component
 * Toolbar for template designer with save/preview/back actions
 */

interface DesignerToolbarProps {
    templateName: string;
    onBack: () => void;
    onPreview: () => void;
    onSave: () => void;
    isSaving: boolean;
}

function DesignerToolbar({ templateName, onBack, onPreview, onSave, isSaving }: DesignerToolbarProps) {
    return (
        <div className="designer-header">
            <div className="designer-title">
                <button className="btn btn-secondary" onClick={onBack}>
                    <i className="fas fa-arrow-left"></i> Back
                </button>
                <h1>Receipt Template Designer</h1>
                <div className="template-info">
                    <i className="fas fa-file-invoice"></i>
                    <span>{templateName}</span>
                </div>
            </div>
            <div className="designer-actions">
                <button className="btn btn-secondary" onClick={onPreview}>
                    <i className="fas fa-eye"></i> Preview
                </button>
                <button
                    className="btn btn-primary"
                    onClick={onSave}
                    disabled={isSaving}
                >
                    <i className={`fas ${isSaving ? 'fa-spinner fa-spin' : 'fa-save'}`}></i>
                    {isSaving ? ' Saving...' : ' Save Template'}
                </button>
            </div>
        </div>
    );
}

export default DesignerToolbar;
export type { DesignerToolbarProps };
