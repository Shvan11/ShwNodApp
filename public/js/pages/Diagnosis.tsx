import { useState, useEffect, type ChangeEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import styles from './Diagnosis.module.css';

/**
 * Diagnosis Page
 * Comprehensive diagnosis and treatment plan page with tabbed interface
 * Route: /patient/:personId/work/:workId/diagnosis
 */

interface DiagnosisData {
    WorkID: number;
    DxDate: string;
    Diagnosis: string;
    TreatmentPlan: string;
    ChiefComplain: string;
    Appliance: string;
    // Facial Analysis
    fAnteroPosterior: string;
    fVertical: string;
    fTransverse: string;
    fLipCompetence: string;
    fNasoLabialAngle: string;
    fUpperIncisorShowRest: string;
    fUpperIncisorShowSmile: string;
    // Intraoral Analysis
    ITeethPresent: string;
    IDentalHealth: string;
    ILowerCrowding: string;
    ILowerIncisorInclination: string;
    ICurveofSpee: string;
    IUpperCrowding: string;
    IUpperIncisorInclination: string;
    // Occlusion Analysis
    OIncisorRelation: string;
    OOverjet: string;
    OOverbite: string;
    OCenterlines: string;
    OMolarRelation: string;
    OCanineRelation: string;
    OFunctionalOcclusion: string;
    // Cephalometric Analysis
    C_SNA: string;
    C_SNB: string;
    C_ANB: string;
    C_SNMx: string;
    C_Wits: string;
    C_FMA: string;
    C_MMA: string;
    C_UIMX: string;
    C_LIMd: string;
    C_UI_LI: string;
    C_LI_APo: string;
    C_Ulip_E: string;
    C_Llip_E: string;
    C_Naso_lip: string;
    C_TAFH: string;
    C_UAFH: string;
    C_LAFH: string;
    C_PercentLAFH: string;
}

interface PatientInfo {
    Name: string;
    PersonID?: number;
    [key: string]: unknown;
}

interface WorkInfo {
    workid: number;
    TypeName?: string;
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

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [activeTab, setActiveTab] = useState<TabId>('general');
    const [workInfo, setWorkInfo] = useState<WorkInfo | null>(null);
    const [patientInfo, setPatientInfo] = useState<PatientInfo | null>(null);
    const [diagnosisExists, setDiagnosisExists] = useState(false);

    const [diagnosisData, setDiagnosisData] = useState<DiagnosisData>({
        WorkID: parseInt(workId || '0'),
        DxDate: new Date().toISOString().split('T')[0],
        Diagnosis: '',
        TreatmentPlan: '',
        ChiefComplain: '',
        Appliance: '',
        // Facial Analysis
        fAnteroPosterior: '',
        fVertical: '',
        fTransverse: '',
        fLipCompetence: '',
        fNasoLabialAngle: '',
        fUpperIncisorShowRest: '',
        fUpperIncisorShowSmile: '',
        // Intraoral Analysis
        ITeethPresent: '',
        IDentalHealth: '',
        ILowerCrowding: '',
        ILowerIncisorInclination: '',
        ICurveofSpee: '',
        IUpperCrowding: '',
        IUpperIncisorInclination: '',
        // Occlusion Analysis
        OIncisorRelation: '',
        OOverjet: '',
        OOverbite: '',
        OCenterlines: '',
        OMolarRelation: '',
        OCanineRelation: '',
        OFunctionalOcclusion: '',
        // Cephalometric Analysis
        C_SNA: '',
        C_SNB: '',
        C_ANB: '',
        C_SNMx: '',
        C_Wits: '',
        C_FMA: '',
        C_MMA: '',
        C_UIMX: '',
        C_LIMd: '',
        C_UI_LI: '',
        C_LI_APo: '',
        C_Ulip_E: '',
        C_Llip_E: '',
        C_Naso_lip: '',
        C_TAFH: '',
        C_UAFH: '',
        C_LAFH: '',
        C_PercentLAFH: ''
    });

    useEffect(() => {
        loadData();
    }, [personId, workId]);

    const loadData = async () => {
        try {
            setLoading(true);

            // Load patient info, work info, and diagnosis data in parallel
            const [patientResponse, worksResponse, diagnosisResponse] = await Promise.all([
                fetch(`/api/patients/${personId}/info`),
                fetch(`/api/getworks?code=${personId}`),
                fetch(`/api/diagnosis/${workId}`)
            ]);

            if (patientResponse.ok) {
                const patient: PatientInfo = await patientResponse.json();
                setPatientInfo(patient);
            }

            if (worksResponse.ok) {
                const works: WorkInfo[] = await worksResponse.json();
                const work = works.find(w => w.workid === parseInt(workId || '0'));
                setWorkInfo(work || null);
            }

            if (diagnosisResponse.ok) {
                const diagnosis: Partial<DiagnosisData> = await diagnosisResponse.json();
                if (diagnosis) {
                    // Format date to YYYY-MM-DD for input
                    if (diagnosis.DxDate) {
                        diagnosis.DxDate = new Date(diagnosis.DxDate).toISOString().split('T')[0];
                    }
                    setDiagnosisData(prev => ({ ...prev, ...diagnosis }));
                    setDiagnosisExists(true);
                }
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
        if (!diagnosisData.Diagnosis.trim()) {
            toast.warning('Diagnosis is required');
            setActiveTab('general');
            return;
        }
        if (!diagnosisData.TreatmentPlan.trim()) {
            toast.warning('Treatment Plan is required');
            setActiveTab('general');
            return;
        }

        try {
            setSaving(true);
            const response = await fetch('/api/diagnosis', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(diagnosisData)
            });

            if (!response.ok) throw new Error('Failed to save diagnosis');

            toast.success('Diagnosis saved successfully');
            setDiagnosisExists(true);

            // Navigate back to work page
            setTimeout(() => {
                navigate(`/patient/${personId}/work`);
            }, 500);
        } catch (err) {
            console.error('Error saving diagnosis:', err);
            toast.error('Failed to save diagnosis');
        } finally {
            setSaving(false);
        }
    };

    const handleCancel = () => {
        navigate(`/patient/${personId}/work`);
    };

    const handleReset = async () => {
        // Show confirmation
        const confirmMessage = `Are you sure you want to reset/delete this diagnosis?\n\nWork: ${workInfo?.TypeName || 'N/A'}\nDate: ${diagnosisData.DxDate}\n\n⚠️ This action cannot be undone!`;

        if (!confirm(confirmMessage)) return;

        try {
            setDeleting(true);
            const response = await fetch(`/api/diagnosis/${workId}`, {
                method: 'DELETE'
            });

            if (!response.ok) throw new Error('Failed to delete diagnosis');

            toast.success('Diagnosis deleted successfully');

            // Navigate back to work page
            setTimeout(() => {
                navigate(`/patient/${personId}/work`);
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
                                    {patientInfo.Name}
                                </span>
                            )}
                            {workInfo && (
                                <span className={styles.workType}>
                                    <i className="fas fa-tooth"></i>
                                    {workInfo.TypeName || 'Treatment'}
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
                            className="btn-delete"
                            onClick={handleReset}
                            disabled={saving || deleting}
                            style={{ backgroundColor: 'var(--error-color)', color: 'white' }}
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
                                    value={diagnosisData.DxDate}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('DxDate', e.target.value)}
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Appliance</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.Appliance || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('Appliance', e.target.value)}
                                    placeholder="e.g., Roth, MBT, Damon..."
                                />
                            </div>

                            <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                                <label>Chief Complaint</label>
                                <textarea
                                    className={styles.formTextarea}
                                    rows={3}
                                    value={diagnosisData.ChiefComplain || ''}
                                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => handleChange('ChiefComplain', e.target.value)}
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
                                    value={diagnosisData.Diagnosis || ''}
                                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => handleChange('Diagnosis', e.target.value)}
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
                                    value={diagnosisData.TreatmentPlan || ''}
                                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => handleChange('TreatmentPlan', e.target.value)}
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
                                    value={diagnosisData.fAnteroPosterior || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('fAnteroPosterior', e.target.value)}
                                    placeholder="e.g., Convex, Straight, Concave"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Vertical</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.fVertical || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('fVertical', e.target.value)}
                                    placeholder="e.g., Average, Long, Short"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Transverse</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.fTransverse || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('fTransverse', e.target.value)}
                                    placeholder="e.g., Symmetric, Asymmetric"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Lip Competence</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.fLipCompetence || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('fLipCompetence', e.target.value)}
                                    placeholder="e.g., Competent, Incompetent"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Nasolabial Angle</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.fNasoLabialAngle || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('fNasoLabialAngle', e.target.value)}
                                    placeholder="e.g., 90-110°, Normal: 102°±8"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Upper Incisor Show (Rest)</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.fUpperIncisorShowRest || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('fUpperIncisorShowRest', e.target.value)}
                                    placeholder="e.g., 2-3mm (normal)"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Upper Incisor Show (Smile)</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.fUpperIncisorShowSmile || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('fUpperIncisorShowSmile', e.target.value)}
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
                                    value={diagnosisData.ITeethPresent || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('ITeethPresent', e.target.value)}
                                    placeholder="e.g., All permanent teeth, Mixed dentition"
                                />
                            </div>

                            <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                                <label>Dental Health</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.IDentalHealth || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('IDentalHealth', e.target.value)}
                                    placeholder="e.g., Good oral hygiene, No active caries"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Upper Crowding</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.IUpperCrowding || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('IUpperCrowding', e.target.value)}
                                    placeholder="e.g., -5mm (negative = crowding)"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Upper Incisor Inclination</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.IUpperIncisorInclination || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('IUpperIncisorInclination', e.target.value)}
                                    placeholder="e.g., Proclined, Retroclined, Normal"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Lower Crowding</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.ILowerCrowding || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('ILowerCrowding', e.target.value)}
                                    placeholder="e.g., -3mm (negative = crowding)"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Lower Incisor Inclination</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.ILowerIncisorInclination || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('ILowerIncisorInclination', e.target.value)}
                                    placeholder="e.g., Upright, Proclined, Retroclined"
                                />
                            </div>

                            <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                                <label>Curve of Spee</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.ICurveofSpee || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('ICurveofSpee', e.target.value)}
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
                                    value={diagnosisData.OIncisorRelation || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('OIncisorRelation', e.target.value)}
                                    placeholder="e.g., Class I, Class II, Class III"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Overjet</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.OOverjet || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('OOverjet', e.target.value)}
                                    placeholder="e.g., 5mm (normal: 2-3mm)"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Overbite</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.OOverbite || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('OOverbite', e.target.value)}
                                    placeholder="e.g., 50%, Deep, Open"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Centerlines</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.OCenterlines || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('OCenterlines', e.target.value)}
                                    placeholder="e.g., Coincident, Upper right 2mm"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Molar Relation (Right / Left)</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.OMolarRelation || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('OMolarRelation', e.target.value)}
                                    placeholder="e.g., Class I / Class II, Full cusp Class II"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Canine Relation (Right / Left)</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.OCanineRelation || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('OCanineRelation', e.target.value)}
                                    placeholder="e.g., Class I / Class II"
                                />
                            </div>

                            <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                                <label>Functional Occlusion</label>
                                <input
                                    type="text"
                                    className={styles.formInput}
                                    value={diagnosisData.OFunctionalOcclusion || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('OFunctionalOcclusion', e.target.value)}
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
                                        value={diagnosisData.C_SNA || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_SNA', e.target.value)}
                                        placeholder="Normal: 82° ±2"
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>SNB (°)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.C_SNB || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_SNB', e.target.value)}
                                        placeholder="Normal: 80° ±2"
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>ANB (°)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.C_ANB || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_ANB', e.target.value)}
                                        placeholder="Normal: 2° ±2"
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>SN-Mx (°)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.C_SNMx || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_SNMx', e.target.value)}
                                        placeholder="Normal: 8° ±3"
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>Wits (mm)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.C_Wits || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_Wits', e.target.value)}
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
                                        value={diagnosisData.C_FMA || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_FMA', e.target.value)}
                                        placeholder="Normal: 25° ±5"
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>MMA (°)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.C_MMA || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_MMA', e.target.value)}
                                        placeholder="Normal: 27° ±5"
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>TAFH (mm)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.C_TAFH || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_TAFH', e.target.value)}
                                        placeholder="Total anterior face height"
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>UAFH (mm)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.C_UAFH || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_UAFH', e.target.value)}
                                        placeholder="Upper anterior face height"
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>LAFH (mm)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.C_LAFH || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_LAFH', e.target.value)}
                                        placeholder="Lower anterior face height"
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>LAFH (%)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.C_PercentLAFH || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_PercentLAFH', e.target.value)}
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
                                        value={diagnosisData.C_UIMX || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_UIMX', e.target.value)}
                                        placeholder="Normal: 110° ±6"
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>LI-Md (°)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.C_LIMd || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_LIMd', e.target.value)}
                                        placeholder="Normal: 90° ±3"
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>UI-LI (°)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.C_UI_LI || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_UI_LI', e.target.value)}
                                        placeholder="Normal: 130° ±10"
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>LI-APo (mm)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.C_LI_APo || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_LI_APo', e.target.value)}
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
                                        value={diagnosisData.C_Ulip_E || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_Ulip_E', e.target.value)}
                                        placeholder="Normal: -4mm ±2"
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>LLip-E (mm)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.C_Llip_E || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_Llip_E', e.target.value)}
                                        placeholder="Normal: -2mm ±2"
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>Nasolabial (°)</label>
                                    <input
                                        type="text"
                                        className={styles.formInput}
                                        value={diagnosisData.C_Naso_lip || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_Naso_lip', e.target.value)}
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
