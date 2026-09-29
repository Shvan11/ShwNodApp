import { useState, type ChangeEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import cn from 'classnames';
import type { DiagnosisBody } from '@shared/contracts/work.contract';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { useUnsavedRouteGuard } from '../hooks/useUnsavedRouteGuard';
import styles from './Diagnosis.module.css';
import { formatISODate } from '../core/utils';
import { postJSON, deleteJSON, httpErrorMessage } from '@/core/http';
import { worksQuery, diagnosisQuery } from '@/query/queries';
import { qk } from '@/query/keys';
import {
    DIAGNOSIS_TABS,
    diagnosisFieldId,
    diagnosisFormFromRow,
    emptyDiagnosisForm,
    type DiagnosisField,
    type DiagnosisFieldSpec,
    type DiagnosisForm,
    type DiagnosisTabId,
} from './diagnosis-fields';

/**
 * Diagnosis Page
 * Comprehensive diagnosis and treatment plan page with tabbed interface.
 * Route: /patient/:personId/work/:workId/diagnosis
 *
 * The fields themselves are data (`diagnosis-fields.ts`); this file owns the
 * load → edit → save lifecycle.
 */
const Diagnosis = () => {
    const { personId, workId } = useParams<{ personId: string; workId: string }>();
    // Keyed on the work: another work's diagnosis is a fresh form with its own
    // post-mount read, never the previous work's seeded state.
    return <DiagnosisEditor key={workId ?? ''} personId={personId ?? ''} workId={workId ?? ''} />;
};

interface DiagnosisEditorProps {
    personId: string;
    workId: string;
}

const DiagnosisEditor = ({ personId, workId }: DiagnosisEditorProps) => {
    const navigate = useNavigate();
    const toast = useToast();
    const confirm = useConfirm();
    const queryClient = useQueryClient();

    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [activeTab, setActiveTab] = useState<DiagnosisTabId>('general');
    // `null` until seeded from a read made by THIS mount (below). The form is not
    // rendered before that, so there is nothing to type into — or to Save.
    const [form, setForm] = useState<DiagnosisForm | null>(null);
    const [diagnosisExists, setDiagnosisExists] = useState(false);
    const [dirty, setDirty] = useState(false);
    const { allowNextNavigation } = useUnsavedRouteGuard(dirty);

    // The works list is read only for the work type named in the delete confirm;
    // it never gates the page.
    const { data: works } = useQuery({ ...worksQuery(personId), enabled: !!personId });
    const workInfo = works?.find(w => w.work_id === parseInt(workId, 10)) ?? null;

    // Diagnosis row read — the row, or a literal `null` for "no diagnosis yet".
    // A FAILED read throws (diagnosisQuery no longer maps errors to `null`), and
    // `refetchOnMount: 'always'` makes every open read the server afresh: the
    // seed below takes only that read, never a cached row from an earlier visit
    // that a later edit (another tab, another user) may have superseded.
    const diagnosisRead = useQuery({ ...diagnosisQuery(workId), refetchOnMount: 'always' });

    // Seed once, during render (no set-state-in-effect), from the post-mount read.
    // Before FE-F9-1 a failed read was cached as `null`, seeded a blank "new"
    // form with no error, and Save then overwrote the stored work-up (the
    // upsert rewrites all 45 columns).
    if (
        form === null
        && diagnosisRead.isFetchedAfterMount
        && diagnosisRead.isSuccess
        && !diagnosisRead.isFetching
    ) {
        const today = formatISODate();
        const row = diagnosisRead.data;
        setForm(row ? diagnosisFormFromRow(row, today, formatISODate) : emptyDiagnosisForm(today));
        setDiagnosisExists(!!row);
    }

    const backToWorks = () => navigate(`/patient/${personId}/works`);

    const handleChange = (field: DiagnosisField, value: string) => {
        setForm(prev => (prev ? { ...prev, [field]: value } : prev));
        setDirty(true);
    };

    const handleSave = async () => {
        if (!form) return;
        // Validate required fields
        if (!form.diagnosis.trim()) {
            toast.warning('Diagnosis is required');
            setActiveTab('general');
            return;
        }
        if (!form.treatment_plan.trim()) {
            toast.warning('Treatment Plan is required');
            setActiveTab('general');
            return;
        }

        const body: DiagnosisBody = { work_id: parseInt(workId, 10), ...form };
        setSaving(true);
        try {
            await postJSON('/api/diagnosis', body);
        } catch (err) {
            // Surface the server's actual reason (e.g. a validation message) — a
            // bare toast hid which field the 400 rejected. See httpErrorMessage.
            toast.error(httpErrorMessage(err, 'Failed to save diagnosis'));
            setSaving(false);
            return;
        }
        toast.success('Diagnosis saved successfully');
        void queryClient.invalidateQueries({ queryKey: qk.work.diagnosis(workId) });
        // Leave straight away (the toast is global, it survives the route change).
        // The buttons stay disabled until the page unmounts — the old 500 ms timer
        // re-enabled them and could yank a user who had already moved on back to Works.
        allowNextNavigation();
        backToWorks();
    };

    const handleReset = async () => {
        if (!form) return;
        const confirmMessage = `Are you sure you want to reset/delete this diagnosis?\n\nWork: ${workInfo?.type_name || 'N/A'}\nDate: ${form.dx_date}\n\n⚠️ This action cannot be undone!`;

        if (!await confirm(confirmMessage, { title: 'Delete Diagnosis', danger: true, confirmText: 'Delete' })) return;

        setDeleting(true);
        try {
            await deleteJSON(`/api/diagnosis/${workId}`);
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Failed to delete diagnosis'));
            setDeleting(false);
            return;
        }
        toast.success('Diagnosis deleted successfully');
        void queryClient.invalidateQueries({ queryKey: qk.work.diagnosis(workId) });
        allowNextNavigation();
        backToWorks();
    };

    if (form === null) {
        const failed = diagnosisRead.isFetchedAfterMount && diagnosisRead.isError && !diagnosisRead.isFetching;
        return (
            <div className={styles.diagnosisPage}>
                {failed ? (
                    <div className={styles.diagnosisLoadError} role="alert">
                        <i className="fas fa-exclamation-triangle" aria-hidden="true"></i>
                        <h1 className={styles.loadErrorTitle}>Couldn’t load this diagnosis</h1>
                        <p>
                            {httpErrorMessage(diagnosisRead.error, 'The server did not respond.')}
                        </p>
                        <p className={styles.loadErrorHint}>
                            The form stays closed until the diagnosis loads, so a saved
                            diagnosis can never be replaced by a blank one.
                        </p>
                        <div className={styles.loadErrorActions}>
                            <button type="button" className={styles.btnCancel} onClick={backToWorks}>
                                <i className="fas fa-arrow-left" aria-hidden="true"></i>
                                Back to works
                            </button>
                            <button
                                type="button"
                                className={styles.btnSave}
                                onClick={() => void diagnosisRead.refetch()}
                            >
                                <i className="fas fa-redo" aria-hidden="true"></i>
                                Retry
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className={styles.diagnosisLoading}>
                        <i className="fas fa-spinner fa-spin" aria-hidden="true"></i>
                        <span>Loading diagnosis data...</span>
                    </div>
                )}
            </div>
        );
    }

    const renderField = (field: DiagnosisFieldSpec) => {
        const id = diagnosisFieldId(field.key);
        const onChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
            handleChange(field.key, e.target.value);
        return (
            <div key={field.key} className={cn(styles.formGroup, field.full && styles.fullWidth)}>
                <label htmlFor={id}>
                    {field.label}
                    {field.required && <> <span className={styles.required}>*</span></>}
                </label>
                {field.kind === 'textarea' ? (
                    <textarea
                        id={id}
                        className={styles.formTextarea}
                        rows={field.rows}
                        value={form[field.key]}
                        onChange={onChange}
                        placeholder={field.placeholder}
                        required={field.required}
                    />
                ) : (
                    <input
                        id={id}
                        type={field.kind === 'date' ? 'date' : 'text'}
                        className={styles.formInput}
                        value={form[field.key]}
                        onChange={onChange}
                        placeholder={field.placeholder}
                        required={field.required}
                    />
                )}
            </div>
        );
    };

    const tab = DIAGNOSIS_TABS.find(t => t.id === activeTab) ?? DIAGNOSIS_TABS[0];
    const busy = saving || deleting;

    return (
        <div className={styles.diagnosisPage}>
            {/* Page Header — single compact row; patient/work identity lives in
                the PatientShell breadcrumb, actions live in the footer */}
            <div className={styles.diagnosisHeader}>
                <button
                    type="button"
                    className={styles.btnBack}
                    onClick={backToWorks}
                    title="Back to work"
                    aria-label="Back to work"
                >
                    <i className="fas fa-arrow-left" aria-hidden="true"></i>
                </button>
                <h1 className={styles.diagnosisTitle}>
                    <i className="fas fa-stethoscope" aria-hidden="true"></i>
                    Diagnosis & Treatment Plan
                </h1>
            </div>

            {/* Tab Navigation */}
            <div className={styles.diagnosisTabs} role="tablist" aria-label="Diagnosis sections">
                {DIAGNOSIS_TABS.map(t => (
                    <button
                        key={t.id}
                        id={`dx-tab-${t.id}`}
                        type="button"
                        role="tab"
                        aria-selected={activeTab === t.id}
                        aria-controls="dx-tabpanel"
                        className={cn(styles.diagnosisTab, activeTab === t.id && styles.diagnosisTabActive)}
                        onClick={() => setActiveTab(t.id)}
                    >
                        <i className={t.icon} aria-hidden="true"></i>
                        <span>{t.label}</span>
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div className={styles.diagnosisContent}>
                <div
                    id="dx-tabpanel"
                    role="tabpanel"
                    aria-labelledby={`dx-tab-${tab.id}`}
                    className={styles.diagnosisTabContent}
                >
                    <h2 className={styles.sectionTitle}>{tab.title}</h2>
                    {tab.sections.map((section, i) =>
                        section.title ? (
                            <div key={section.title} className={styles.cephSection}>
                                <h3>{section.title}</h3>
                                <div className={styles.formGrid}>{section.fields.map(renderField)}</div>
                            </div>
                        ) : (
                            <div key={i} className={styles.formGrid}>{section.fields.map(renderField)}</div>
                        )
                    )}
                </div>
            </div>

            {/* Sticky Footer — the single actions row */}
            <div className={styles.diagnosisFooter}>
                {diagnosisExists && (
                    <button
                        type="button"
                        className={`btn-delete ${styles.deleteButton}`}
                        onClick={handleReset}
                        disabled={busy}
                    >
                        {deleting ? (
                            <>
                                <i className="fas fa-spinner fa-spin" aria-hidden="true"></i>
                                Deleting...
                            </>
                        ) : (
                            <>
                                <i className="fas fa-trash" aria-hidden="true"></i>
                                Reset Diagnosis
                            </>
                        )}
                    </button>
                )}
                <button
                    type="button"
                    className={styles.btnCancel}
                    onClick={backToWorks}
                    disabled={busy}
                >
                    <i className="fas fa-times" aria-hidden="true"></i>
                    Cancel
                </button>
                <button
                    type="button"
                    className={styles.btnSave}
                    onClick={handleSave}
                    disabled={busy}
                >
                    {saving ? (
                        <>
                            <i className="fas fa-spinner fa-spin" aria-hidden="true"></i>
                            Saving...
                        </>
                    ) : (
                        <>
                            <i className="fas fa-save" aria-hidden="true"></i>
                            Save Diagnosis
                        </>
                    )}
                </button>
            </div>
        </div>
    );
};

export default Diagnosis;
