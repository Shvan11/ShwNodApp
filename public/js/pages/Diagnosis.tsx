import { useState, useEffect, type ChangeEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import styles from './Diagnosis.module.css';
import { formatISODate } from '../core/utils';
import { fetchJSON, postJSON, deleteJSON } from '@/core/http';
import { getWorks as getWorksContract } from '@shared/contracts/work.contract';
import * as patientContract from '@shared/contracts/patient.contract';

/**
 * Diagnosis Page
 * Comprehensive diagnosis and treatment plan page with tabbed interface
 * Route: /patient/:personId/work/:workId/diagnosis
 */

interface DiagnosisData {
    work_id: number;
    dx_date: string;
    diagnosis: string;
    treatment_plan: string;
    chief_complain: string;
    appliance: string;
    // Facial Analysis
    f_antero_posterior: string;
    f_vertical: string;
    f_transverse: string;
    f_lip_competence: string;
    f_naso_labial_angle: string;
    f_upper_incisor_show_rest: string;
    f_upper_incisor_show_smile: string;
    // Intraoral Analysis
    i_teeth_present: string;
    i_dental_health: string;
    i_lower_crowding: string;
    i_lower_incisor_inclination: string;
    i_curveof_spee: string;
    i_upper_crowding: string;
    i_upper_incisor_inclination: string;
    // Occlusion Analysis
    o_incisor_relation: string;
    o_overjet: string;
    o_overbite: string;
    o_centerlines: string;
    o_molar_relation: string;
    o_canine_relation: string;
    o_functional_occlusion: string;
    // Cephalometric Analysis
    c_sna: string;
    c_snb: string;
    c_anb: string;
    c_sn_mx: string;
    c_wits: string;
    c_fma: string;
    c_mma: string;
    c_uimx: string;
    c_li_md: string;
    c_ui_li: string;
    c_li_a_po: string;
    c_ulip_e: string;
    c_llip_e: string;
    c_naso_lip: string;
    c_tafh: string;
    c_uafh: string;
    c_lafh: string;
    c_percent_lafh: string;
}

interface PatientInfo {
    patient_name?: string;
    name?: string;
    person_id?: number;
    [key: string]: unknown;
}

interface WorkInfo {
    work_id: number;
    type_name?: string;
    [key: string]: unknown;
}

interface Tab {
    id: string;
    label: string;
    icon: string;
}

type TabId = 'general' | 'facial' | 'intraoral' | 'occlusion' | 'cephalometric';

const Diagnosis = () => {
    const { personId, workId } = useParams<{ personId: string; workId: string }>();
    const navigate = useNavigate();
    const toast = useToast();
    const confirm = useConfirm();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [activeTab, setActiveTab] = useState<TabId>('general');
    const [workInfo, setWorkInfo] = useState<WorkInfo | null>(null);
    const [patientInfo, setPatientInfo] = useState<PatientInfo | null>(null);
    const [diagnosisExists, setDiagnosisExists] = useState(false);

    const [diagnosisData, setDiagnosisData] = useState<DiagnosisData>({
        work_id: parseInt(workId || '0'),
        dx_date: formatISODate(),
        diagnosis: '',
        treatment_plan: '',
        chief_complain: '',
        appliance: '',
        // Facial Analysis
        f_antero_posterior: '',
        f_vertical: '',
        f_transverse: '',
        f_lip_competence: '',
        f_naso_labial_angle: '',
        f_upper_incisor_show_rest: '',
        f_upper_incisor_show_smile: '',
        // Intraoral Analysis
        i_teeth_present: '',
        i_dental_health: '',
        i_lower_crowding: '',
        i_lower_incisor_inclination: '',
        i_curveof_spee: '',
        i_upper_crowding: '',
        i_upper_incisor_inclination: '',
        // Occlusion Analysis
        o_incisor_relation: '',
        o_overjet: '',
        o_overbite: '',
        o_centerlines: '',
        o_molar_relation: '',
        o_canine_relation: '',
        o_functional_occlusion: '',
        // Cephalometric Analysis
        c_sna: '',
        c_snb: '',
        c_anb: '',
        c_sn_mx: '',
        c_wits: '',
        c_fma: '',
        c_mma: '',
        c_uimx: '',
        c_li_md: '',
        c_ui_li: '',
        c_li_a_po: '',
        c_ulip_e: '',
        c_llip_e: '',
        c_naso_lip: '',
        c_tafh: '',
        c_uafh: '',
        c_lafh: '',
        c_percent_lafh: ''
    });

    useEffect(() => {
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [personId, workId]);

    const loadData = async () => {
        try {
            setLoading(true);

            // Load patient info, work info, and diagnosis data in parallel. Each GET is
            // independent — a failure of one shouldn't blank the others — so each is
            // wrapped in .catch(() => null) (the N14 tolerant-Promise.all mechanic),
            // replacing the old per-res.ok guards. /api/diagnosis/:workId returns HTTP 200
            // with a null body when no diagnosis exists yet (NOT a non-2xx — see audit
            // N18), so the `if (diagnosis)` null-check still means "new diagnosis".
            const [patient, works, diagnosis] = await Promise.all([
                fetchJSON<PatientInfo>(`/api/patients/${personId}/info`, { schema: patientContract.patientInfo.response }).catch(() => null),
                fetchJSON<WorkInfo[]>(`/api/getworks?code=${personId}`, { schema: getWorksContract.response }).catch(() => null),
                // Raw, un-enveloped: `/api/diagnosis/:workId` returns the row or literal
                // `null` (the "no diagnosis yet" signal) — not the sendSuccess envelope —
                // so it stays out of the contract and carries no client schema by design.
                // eslint-disable-next-line no-restricted-syntax -- raw literal-null signal; no contract response
                fetchJSON<Partial<DiagnosisData> | null>(`/api/diagnosis/${workId}`).catch(() => null)
            ]);

            if (patient) {
                setPatientInfo(patient);
            }

            if (works) {
                const work = works.find(w => w.work_id === parseInt(workId || '0'));
                setWorkInfo(work || null);
            }

            if (diagnosis) {
                // Format date to YYYY-MM-DD for input
                if (diagnosis.dx_date) {
                    diagnosis.dx_date = formatISODate(diagnosis.dx_date);
                }
                setDiagnosisData(prev => ({ ...prev, ...diagnosis }));
                setDiagnosisExists(true);
            }
        } catch (err) {
            console.error('Error loading data:', err);
            toast.error('Failed to load diagnosis data');
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (field: keyof DiagnosisData, value: string) => {
        setDiagnosisData(prev => ({ ...prev, [field]: value }));
    };

    const handleSave = async () => {
        // Validate required fields
        if (!diagnosisData.diagnosis.trim()) {
            toast.warning('Diagnosis is required');
            setActiveTab('general');
            return;
        }
        if (!diagnosisData.treatment_plan.trim()) {
            toast.warning('Treatment Plan is required');
            setActiveTab('general');
            return;
        }

        try {
            setSaving(true);
            await postJSON('/api/diagnosis', diagnosisData);

            toast.success('Diagnosis saved successfully');
            setDiagnosisExists(true);

            // Navigate back to the works list
            setTimeout(() => {
                navigate(`/patient/${personId}/works`);
            }, 500);
        } catch (err) {
            console.error('Error saving diagnosis:', err);
            toast.error('Failed to save diagnosis');
        } finally {
            setSaving(false);
        }
    };

    const handleCancel = () => {
        navigate(`/patient/${personId}/works`);
    };

    const handleReset = async () => {
        // Show confirmation
        const confirmMessage = `Are you sure you want to reset/delete this diagnosis?\n\nWork: ${workInfo?.type_name || 'N/A'}\nDate: ${diagnosisData.dx_date}\n\n⚠️ This action cannot be undone!`;

        if (!await confirm(confirmMessage, { title: 'Delete Diagnosis', danger: true, confirmText: 'Delete' })) return;

        try {
            setDeleting(true);
            await deleteJSON(`/api/diagnosis/${workId}`);

            toast.success('Diagnosis deleted successfully');

            // Navigate back to the works list
            setTimeout(() => {
                navigate(`/patient/${personId}/works`);
            }, 500);
        } catch (err) {
            console.error('Error deleting diagnosis:', err);
            toast.error('Failed to delete diagnosis');
        } finally {
            setDeleting(false);
        }
    };

    const tabs: Tab[] = [
        { id: 'general', label: 'General', icon: 'fas fa-clipboard-list' },
        { id: 'facial', label: 'Facial Analysis', icon: 'fas fa-user' },
        { id: 'intraoral', label: 'Intraoral', icon: 'fas fa-teeth' },
        { id: 'occlusion', label: 'Occlusion', icon: 'fas fa-grip-horizontal' },
        { id: 'cephalometric', label: 'Cephalometric', icon: 'fas fa-ruler-combined' }
    ];

    if (loading) {
        return (
            <div className={styles.diagnosisPage}>
                <div className={styles.diagnosisLoading}>
                    <i className="fas fa-spinner fa-spin"></i>
                    <span>Loading diagnosis data...</span>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.diagnosisPage}>
            {/* Page Header */}
            <div className={styles.diagnosisHeader}>
                <div className={styles.diagnosisHeaderContent}>
                    <button
                        type="button"
                        className={styles.btnBack}
                        onClick={handleCancel}
                        title="Back to work"
                    >
                        <i className="fas fa-arrow-left"></i>
                    </button>
                    <div className={styles.diagnosisHeaderInfo}>
                        <h1>
                            <i className="fas fa-stethoscope"></i>
                            Diagnosis & Treatment Plan
                        </h1>
                        <div className={styles.diagnosisMeta}>
                            {patientInfo && (
                                <span className={styles.patientName}>
                                    <i className="fas fa-user"></i>
                                    {patientInfo.patient_name || patientInfo.name}
                                </span>
                            )}
                            {workInfo && (
                                <span className={styles.workType}>
                                    <i className="fas fa-tooth"></i>
                                    {workInfo.type_name || 'Treatment'}
                                </span>
                            )}
                            <span className={styles.workId}>
                                <i className="fas fa-hashtag"></i>
                                Work ID: {workId}
                            </span>
                        </div>
                    </div>
                </div>
                <div className={styles.diagnosisHeaderActions}>
                    <button
                        type="button"
                        className={styles.btnCancel}
                        onClick={handleCancel}
                        disabled={saving || deleting}
                    >
                        <i className="fas fa-times"></i>
                        Cancel
                    </button>
                    {diagnosisExists && (
                        <button
                            type="button"
                            className={`btn-delete ${styles.deleteButton}`}
                            onClick={handleReset}
                            disabled={saving || deleting}
                        >
                            {deleting ? (
                                <>
                                    <i className="fas fa-spinner fa-spin"></i>
                                    Deleting...
                                </>
                            ) : (
                                <>
                                    <i className="fas fa-trash"></i>
                                    Reset Diagnosis
                                </>
                            )}
                        </button>
                    )}
                    <button
                        type="button"
                        className={styles.btnSave}
                        onClick={handleSave}
                        disabled={saving || deleting}
                    >
                        {saving ? (
                            <>
                                <i className="fas fa-spinner fa-spin"></i>
                                Saving...
                            </>
                        ) : (
                            <>
                                <i className="fas fa-save"></i>
                                Save Diagnosis
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Tab Navigation */}
            <div className={styles.diagnosisTabs}>
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        type="button"
                        className={`${styles.diagnosisTab} ${activeTab === tab.id ? styles.diagnosisTabActive : ''}`}
                        onClick={() => setActiveTab(tab.id as TabId)}
                    >
                        <i className={tab.icon}></i>
                        <span>{tab.label}</span>
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div className={styles.diagnosisContent}>
                {/* General Tab */}
                {activeTab === 'general' && (
                    <div className={styles.diagnosisTabContent}>
                        <h2 className={styles.sectionTitle}>General Information</h2>
                        <div className={styles.formGrid}>
                            <div className={styles.formGroup}>
                                <label>Diagnosis Date</label>
                                <input
                                    type="date"
                                    className={styles.formInput}
                                    value={diagnosisData.dx_date}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('dx_date', e.target.value)}
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Appliance</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.appliance || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('appliance', e.target.value)}
                                    placeholder="e.g., Roth, MBT, Damon..."
                                />
                            </div>

                            <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                                <label>Chief Complaint</label>
                                <textarea
                                    className={styles.formTextarea}
                                    rows={3}
                                    value={diagnosisData.chief_complain || ''}
                                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => handleChange('chief_complain', e.target.value)}
                                    placeholder="Patient's main concern or reason for seeking treatment..."
                                />
                            </div>

                            <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                                <label>
                                    Diagnosis <span className={styles.required}>*</span>
                                </label>
                                <textarea
                                    className={styles.formTextarea}
                                    rows={5}
                                    value={diagnosisData.diagnosis || ''}
                                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => handleChange('diagnosis', e.target.value)}
                                    placeholder="Complete orthodontic diagnosis (e.g., Class II Division 1 malocclusion, severe crowding, deep bite...)"
                                    required
                                />
                            </div>

                            <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                                <label>
                                    Treatment Plan <span className={styles.required}>*</span>
                                </label>
                                <textarea
                                    className={styles.formTextarea}
                                    rows={5}
                                    value={diagnosisData.treatment_plan || ''}
                                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => handleChange('treatment_plan', e.target.value)}
                                    placeholder="Detailed treatment plan including extractions, mechanics, duration, etc..."
                                    required
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* Facial Analysis Tab */}
                {activeTab === 'facial' && (
                    <div className={styles.diagnosisTabContent}>
                        <h2 className={styles.sectionTitle}>Facial Analysis</h2>
                        <div className={styles.formGrid}>
                            <div className={styles.formGroup}>
                                <label>Antero-Posterior</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.f_antero_posterior || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('f_antero_posterior', e.target.value)}
                                    placeholder="e.g., Convex, Straight, Concave"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Vertical</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.f_vertical || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('f_vertical', e.target.value)}
                                    placeholder="e.g., Average, Long, Short"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Transverse</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.f_transverse || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('f_transverse', e.target.value)}
                                    placeholder="e.g., Symmetric, Asymmetric"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Lip Competence</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.f_lip_competence || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('f_lip_competence', e.target.value)}
                                    placeholder="e.g., Competent, Incompetent"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Nasolabial Angle</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.f_naso_labial_angle || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('f_naso_labial_angle', e.target.value)}
                                    placeholder="e.g., 90-110°, Normal: 102°±8"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Upper Incisor Show (Rest)</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.f_upper_incisor_show_rest || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('f_upper_incisor_show_rest', e.target.value)}
                                    placeholder="e.g., 2-3mm (normal)"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Upper Incisor Show (Smile)</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.f_upper_incisor_show_smile || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('f_upper_incisor_show_smile', e.target.value)}
                                    placeholder="e.g., 100%, with gingiva"
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* Intraoral Analysis Tab */}
                {activeTab === 'intraoral' && (
                    <div className={styles.diagnosisTabContent}>
                        <h2 className={styles.sectionTitle}>Intraoral Analysis</h2>
                        <div className={styles.formGrid}>
                            <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                                <label>Teeth Present</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.i_teeth_present || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('i_teeth_present', e.target.value)}
                                    placeholder="e.g., All permanent teeth, Mixed dentition"
                                />
                            </div>

                            <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                                <label>Dental Health</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.i_dental_health || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('i_dental_health', e.target.value)}
                                    placeholder="e.g., Good oral hygiene, No active caries"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Upper Crowding</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.i_upper_crowding || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('i_upper_crowding', e.target.value)}
                                    placeholder="e.g., -5mm (negative = crowding)"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Upper Incisor Inclination</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.i_upper_incisor_inclination || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('i_upper_incisor_inclination', e.target.value)}
                                    placeholder="e.g., Proclined, Retroclined, Normal"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Lower Crowding</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.i_lower_crowding || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('i_lower_crowding', e.target.value)}
                                    placeholder="e.g., -3mm (negative = crowding)"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Lower Incisor Inclination</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.i_lower_incisor_inclination || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('i_lower_incisor_inclination', e.target.value)}
                                    placeholder="e.g., Upright, Proclined, Retroclined"
                                />
                            </div>

                            <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                                <label>Curve of Spee</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.i_curveof_spee || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('i_curveof_spee', e.target.value)}
                                    placeholder="e.g., Moderate 3mm, Flat, Deep"
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* Occlusion Analysis Tab */}
                {activeTab === 'occlusion' && (
                    <div className={styles.diagnosisTabContent}>
                        <h2 className={styles.sectionTitle}>Occlusion Analysis</h2>
                        <div className={styles.formGrid}>
                            <div className={styles.formGroup}>
                                <label>Incisor Relation</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.o_incisor_relation || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('o_incisor_relation', e.target.value)}
                                    placeholder="e.g., Class I, Class II, Class III"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Overjet</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.o_overjet || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('o_overjet', e.target.value)}
                                    placeholder="e.g., 5mm (normal: 2-3mm)"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Overbite</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.o_overbite || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('o_overbite', e.target.value)}
                                    placeholder="e.g., 50%, Deep, Open"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Centerlines</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.o_centerlines || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('o_centerlines', e.target.value)}
                                    placeholder="e.g., Coincident, Upper right 2mm"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Molar Relation (Right / Left)</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.o_molar_relation || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('o_molar_relation', e.target.value)}
                                    placeholder="e.g., Class I / Class II, Full cusp Class II"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Canine Relation (Right / Left)</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.o_canine_relation || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('o_canine_relation', e.target.value)}
                                    placeholder="e.g., Class I / Class II"
                                />
                            </div>

                            <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                                <label>Functional Occlusion</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.o_functional_occlusion || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('o_functional_occlusion', e.target.value)}
                                    placeholder="e.g., No premature contacts, Crossbite on #24"
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* Cephalometric Analysis Tab */}
                {activeTab === 'cephalometric' && (
                    <div className={styles.diagnosisTabContent}>
                        <h2 className={styles.sectionTitle}>Cephalometric Analysis</h2>

                        <div className={styles.cephSection}>
                            <h3>Skeletal Relationships</h3>
                            <div className={styles.formGrid}>
                                <div className={styles.formGroup}>
                                    <label>SNA (°)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.c_sna || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('c_sna', e.target.value)}
                                        placeholder="Normal: 82° ±2"
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>SNB (°)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.c_snb || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('c_snb', e.target.value)}
                                        placeholder="Normal: 80° ±2"
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>ANB (°)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.c_anb || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('c_anb', e.target.value)}
                                        placeholder="Normal: 2° ±2"
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>SN-Mx (°)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.c_sn_mx || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('c_sn_mx', e.target.value)}
                                        placeholder="Normal: 8° ±3"
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>Wits (mm)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.c_wits || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('c_wits', e.target.value)}
                                        placeholder="Normal: -1mm ±2"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className={styles.cephSection}>
                            <h3>Vertical Relationships</h3>
                            <div className={styles.formGrid}>
                                <div className={styles.formGroup}>
                                    <label>FMA (°)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.c_fma || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('c_fma', e.target.value)}
                                        placeholder="Normal: 25° ±5"
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>MMA (°)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.c_mma || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('c_mma', e.target.value)}
                                        placeholder="Normal: 27° ±5"
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>TAFH (mm)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.c_tafh || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('c_tafh', e.target.value)}
                                        placeholder="Total anterior face height"
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>UAFH (mm)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.c_uafh || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('c_uafh', e.target.value)}
                                        placeholder="Upper anterior face height"
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>LAFH (mm)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.c_lafh || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('c_lafh', e.target.value)}
                                        placeholder="Lower anterior face height"
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>LAFH (%)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.c_percent_lafh || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('c_percent_lafh', e.target.value)}
                                        placeholder="Normal: 55% ±2"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className={styles.cephSection}>
                            <h3>Dental Relationships</h3>
                            <div className={styles.formGrid}>
                                <div className={styles.formGroup}>
                                    <label>UI-Mx (°)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.c_uimx || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('c_uimx', e.target.value)}
                                        placeholder="Normal: 110° ±6"
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>LI-Md (°)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.c_li_md || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('c_li_md', e.target.value)}
                                        placeholder="Normal: 90° ±3"
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>UI-LI (°)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.c_ui_li || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('c_ui_li', e.target.value)}
                                        placeholder="Normal: 130° ±10"
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>LI-APo (mm)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.c_li_a_po || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('c_li_a_po', e.target.value)}
                                        placeholder="Normal: 1mm ±2"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className={styles.cephSection}>
                            <h3>Soft Tissue Analysis</h3>
                            <div className={styles.formGrid}>
                                <div className={styles.formGroup}>
                                    <label>ULip-E (mm)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.c_ulip_e || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('c_ulip_e', e.target.value)}
                                        placeholder="Normal: -4mm ±2"
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>LLip-E (mm)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.c_llip_e || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('c_llip_e', e.target.value)}
                                        placeholder="Normal: -2mm ±2"
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>Nasolabial (°)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.c_naso_lip || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('c_naso_lip', e.target.value)}
                                        placeholder="Normal: 102° ±8"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Sticky Footer with Actions */}
            <div className={styles.diagnosisFooter}>
                <button
                    type="button"
                    className={styles.btnCancel}
                    onClick={handleCancel}
                    disabled={saving}
                >
                    <i className="fas fa-times"></i>
                    Cancel
                </button>
                <button
                    type="button"
                    className={styles.btnSave}
                    onClick={handleSave}
                    disabled={saving}
                >
                    {saving ? (
                        <>
                            <i className="fas fa-spinner fa-spin"></i>
                            Saving...
                        </>
                    ) : (
                        <>
                            <i className="fas fa-save"></i>
                            Save Diagnosis
                        </>
                    )}
                </button>
            </div>
        </div>
    );
};

export default Diagnosis;
