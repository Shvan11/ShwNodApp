import { useState, useEffect, type ChangeEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import '../../css/pages/diagnosis.css';

/**
 * Diagnosis Page
 * Comprehensive diagnosis and treatment plan page with tabbed interface
 * Route: /patient/:patientId/work/:workId/diagnosis
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
    const { patientId, workId } = useParams<{ patientId: string; workId: string }>();
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
    }, [patientId, workId]);

    const loadData = async () => {
        try {
            setLoading(true);

            // Load patient info, work info, and diagnosis data in parallel
            const [patientResponse, worksResponse, diagnosisResponse] = await Promise.all([
                fetch(`/api/patients/${patientId}/info`),
                fetch(`/api/getworks?code=${patientId}`),
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
                navigate(`/patient/${patientId}/work`);
            }, 500);
        } catch (err) {
            console.error('Error saving diagnosis:', err);
            toast.error('Failed to save diagnosis');
        } finally {
            setSaving(false);
        }
    };

    const handleCancel = () => {
        navigate(`/patient/${patientId}/work`);
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
                navigate(`/patient/${patientId}/work`);
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
            <div className="diagnosis-page">
                <div className="diagnosis-loading">
                    <i className="fas fa-spinner fa-spin"></i>
                    <span>Loading diagnosis data...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="diagnosis-page">
            {/* Page Header */}
            <div className="diagnosis-header">
                <div className="diagnosis-header-content">
                    <button
                        type="button"
                        className="btn-back"
                        onClick={handleCancel}
                        title="Back to work"
                    >
                        <i className="fas fa-arrow-left"></i>
                    </button>
                    <div className="diagnosis-header-info">
                        <h1>
                            <i className="fas fa-stethoscope"></i>
                            Diagnosis & Treatment Plan
                        </h1>
                        <div className="diagnosis-meta">
                            {patientInfo && (
                                <span className="patient-name">
                                    <i className="fas fa-user"></i>
                                    {patientInfo.Name}
                                </span>
                            )}
                            {workInfo && (
                                <span className="work-type">
                                    <i className="fas fa-tooth"></i>
                                    {workInfo.TypeName || 'Treatment'}
                                </span>
                            )}
                            <span className="work-id">
                                <i className="fas fa-hashtag"></i>
                                Work ID: {workId}
                            </span>
                        </div>
                    </div>
                </div>
                <div className="diagnosis-header-actions">
                    <button
                        type="button"
                        className="btn-cancel"
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
                        className="btn-save"
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
            <div className="diagnosis-tabs">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        type="button"
                        className={`diagnosis-tab ${activeTab === tab.id ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab.id as TabId)}
                    >
                        <i className={tab.icon}></i>
                        <span>{tab.label}</span>
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div className="diagnosis-content">
                {/* General Tab */}
                {activeTab === 'general' && (
                    <div className="diagnosis-tab-content">
                        <h2 className="section-title">General Information</h2>
                        <div className="form-grid">
                            <div className="form-group">
                                <label>Diagnosis Date</label>
                                <input
                                    type="date"
                                    className="form-input"
                                    value={diagnosisData.DxDate}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('DxDate', e.target.value)}
                                />
                            </div>

                            <div className="form-group">
                                <label>Appliance</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={diagnosisData.Appliance || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('Appliance', e.target.value)}
                                    placeholder="e.g., Roth, MBT, Damon..."
                                />
                            </div>

                            <div className="form-group full-width">
                                <label>Chief Complaint</label>
                                <textarea
                                    className="form-textarea"
                                    rows={3}
                                    value={diagnosisData.ChiefComplain || ''}
                                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => handleChange('ChiefComplain', e.target.value)}
                                    placeholder="Patient's main concern or reason for seeking treatment..."
                                />
                            </div>

                            <div className="form-group full-width">
                                <label>
                                    Diagnosis <span className="required">*</span>
                                </label>
                                <textarea
                                    className="form-textarea"
                                    rows={5}
                                    value={diagnosisData.Diagnosis || ''}
                                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => handleChange('Diagnosis', e.target.value)}
                                    placeholder="Complete orthodontic diagnosis (e.g., Class II Division 1 malocclusion, severe crowding, deep bite...)"
                                    required
                                />
                            </div>

                            <div className="form-group full-width">
                                <label>
                                    Treatment Plan <span className="required">*</span>
                                </label>
                                <textarea
                                    className="form-textarea"
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
                    <div className="diagnosis-tab-content">
                        <h2 className="section-title">Facial Analysis</h2>
                        <div className="form-grid">
                            <div className="form-group">
                                <label>Antero-Posterior</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={diagnosisData.fAnteroPosterior || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('fAnteroPosterior', e.target.value)}
                                    placeholder="e.g., Convex, Straight, Concave"
                                />
                            </div>

                            <div className="form-group">
                                <label>Vertical</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={diagnosisData.fVertical || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('fVertical', e.target.value)}
                                    placeholder="e.g., Average, Long, Short"
                                />
                            </div>

                            <div className="form-group">
                                <label>Transverse</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={diagnosisData.fTransverse || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('fTransverse', e.target.value)}
                                    placeholder="e.g., Symmetric, Asymmetric"
                                />
                            </div>

                            <div className="form-group">
                                <label>Lip Competence</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={diagnosisData.fLipCompetence || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('fLipCompetence', e.target.value)}
                                    placeholder="e.g., Competent, Incompetent"
                                />
                            </div>

                            <div className="form-group">
                                <label>Nasolabial Angle</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={diagnosisData.fNasoLabialAngle || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('fNasoLabialAngle', e.target.value)}
                                    placeholder="e.g., 90-110°, Normal: 102°±8"
                                />
                            </div>

                            <div className="form-group">
                                <label>Upper Incisor Show (Rest)</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={diagnosisData.fUpperIncisorShowRest || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('fUpperIncisorShowRest', e.target.value)}
                                    placeholder="e.g., 2-3mm (normal)"
                                />
                            </div>

                            <div className="form-group">
                                <label>Upper Incisor Show (Smile)</label>
                                <input
                                    type="text"
                                    className="form-input"
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
                    <div className="diagnosis-tab-content">
                        <h2 className="section-title">Intraoral Analysis</h2>
                        <div className="form-grid">
                            <div className="form-group full-width">
                                <label>Teeth Present</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={diagnosisData.ITeethPresent || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('ITeethPresent', e.target.value)}
                                    placeholder="e.g., All permanent teeth, Mixed dentition"
                                />
                            </div>

                            <div className="form-group full-width">
                                <label>Dental Health</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={diagnosisData.IDentalHealth || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('IDentalHealth', e.target.value)}
                                    placeholder="e.g., Good oral hygiene, No active caries"
                                />
                            </div>

                            <div className="form-group">
                                <label>Upper Crowding</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={diagnosisData.IUpperCrowding || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('IUpperCrowding', e.target.value)}
                                    placeholder="e.g., -5mm (negative = crowding)"
                                />
                            </div>

                            <div className="form-group">
                                <label>Upper Incisor Inclination</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={diagnosisData.IUpperIncisorInclination || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('IUpperIncisorInclination', e.target.value)}
                                    placeholder="e.g., Proclined, Retroclined, Normal"
                                />
                            </div>

                            <div className="form-group">
                                <label>Lower Crowding</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={diagnosisData.ILowerCrowding || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('ILowerCrowding', e.target.value)}
                                    placeholder="e.g., -3mm (negative = crowding)"
                                />
                            </div>

                            <div className="form-group">
                                <label>Lower Incisor Inclination</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={diagnosisData.ILowerIncisorInclination || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('ILowerIncisorInclination', e.target.value)}
                                    placeholder="e.g., Upright, Proclined, Retroclined"
                                />
                            </div>

                            <div className="form-group full-width">
                                <label>Curve of Spee</label>
                                <input
                                    type="text"
                                    className="form-input"
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
                    <div className="diagnosis-tab-content">
                        <h2 className="section-title">Occlusion Analysis</h2>
                        <div className="form-grid">
                            <div className="form-group">
                                <label>Incisor Relation</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={diagnosisData.OIncisorRelation || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('OIncisorRelation', e.target.value)}
                                    placeholder="e.g., Class I, Class II, Class III"
                                />
                            </div>

                            <div className="form-group">
                                <label>Overjet</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={diagnosisData.OOverjet || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('OOverjet', e.target.value)}
                                    placeholder="e.g., 5mm (normal: 2-3mm)"
                                />
                            </div>

                            <div className="form-group">
                                <label>Overbite</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={diagnosisData.OOverbite || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('OOverbite', e.target.value)}
                                    placeholder="e.g., 50%, Deep, Open"
                                />
                            </div>

                            <div className="form-group">
                                <label>Centerlines</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={diagnosisData.OCenterlines || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('OCenterlines', e.target.value)}
                                    placeholder="e.g., Coincident, Upper right 2mm"
                                />
                            </div>

                            <div className="form-group">
                                <label>Molar Relation (Right / Left)</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={diagnosisData.OMolarRelation || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('OMolarRelation', e.target.value)}
                                    placeholder="e.g., Class I / Class II, Full cusp Class II"
                                />
                            </div>

                            <div className="form-group">
                                <label>Canine Relation (Right / Left)</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={diagnosisData.OCanineRelation || ''}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('OCanineRelation', e.target.value)}
                                    placeholder="e.g., Class I / Class II"
                                />
                            </div>

                            <div className="form-group full-width">
                                <label>Functional Occlusion</label>
                                <input
                                    type="text"
                                    className="form-input"
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
                    <div className="diagnosis-tab-content">
                        <h2 className="section-title">Cephalometric Analysis</h2>

                        <div className="ceph-section">
                            <h3>Skeletal Relationships</h3>
                            <div className="form-grid">
                                <div className="form-group">
                                    <label>SNA (°)</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={diagnosisData.C_SNA || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_SNA', e.target.value)}
                                        placeholder="Normal: 82° ±2"
                                    />
                                </div>

                                <div className="form-group">
                                    <label>SNB (°)</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={diagnosisData.C_SNB || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_SNB', e.target.value)}
                                        placeholder="Normal: 80° ±2"
                                    />
                                </div>

                                <div className="form-group">
                                    <label>ANB (°)</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={diagnosisData.C_ANB || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_ANB', e.target.value)}
                                        placeholder="Normal: 2° ±2"
                                    />
                                </div>

                                <div className="form-group">
                                    <label>SN-Mx (°)</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={diagnosisData.C_SNMx || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_SNMx', e.target.value)}
                                        placeholder="Normal: 8° ±3"
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Wits (mm)</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={diagnosisData.C_Wits || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_Wits', e.target.value)}
                                        placeholder="Normal: -1mm ±2"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="ceph-section">
                            <h3>Vertical Relationships</h3>
                            <div className="form-grid">
                                <div className="form-group">
                                    <label>FMA (°)</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={diagnosisData.C_FMA || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_FMA', e.target.value)}
                                        placeholder="Normal: 25° ±5"
                                    />
                                </div>

                                <div className="form-group">
                                    <label>MMA (°)</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={diagnosisData.C_MMA || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_MMA', e.target.value)}
                                        placeholder="Normal: 27° ±5"
                                    />
                                </div>

                                <div className="form-group">
                                    <label>TAFH (mm)</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={diagnosisData.C_TAFH || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_TAFH', e.target.value)}
                                        placeholder="Total anterior face height"
                                    />
                                </div>

                                <div className="form-group">
                                    <label>UAFH (mm)</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={diagnosisData.C_UAFH || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_UAFH', e.target.value)}
                                        placeholder="Upper anterior face height"
                                    />
                                </div>

                                <div className="form-group">
                                    <label>LAFH (mm)</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={diagnosisData.C_LAFH || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_LAFH', e.target.value)}
                                        placeholder="Lower anterior face height"
                                    />
                                </div>

                                <div className="form-group">
                                    <label>LAFH (%)</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={diagnosisData.C_PercentLAFH || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_PercentLAFH', e.target.value)}
                                        placeholder="Normal: 55% ±2"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="ceph-section">
                            <h3>Dental Relationships</h3>
                            <div className="form-grid">
                                <div className="form-group">
                                    <label>UI-Mx (°)</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={diagnosisData.C_UIMX || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_UIMX', e.target.value)}
                                        placeholder="Normal: 110° ±6"
                                    />
                                </div>

                                <div className="form-group">
                                    <label>LI-Md (°)</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={diagnosisData.C_LIMd || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_LIMd', e.target.value)}
                                        placeholder="Normal: 90° ±3"
                                    />
                                </div>

                                <div className="form-group">
                                    <label>UI-LI (°)</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={diagnosisData.C_UI_LI || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_UI_LI', e.target.value)}
                                        placeholder="Normal: 130° ±10"
                                    />
                                </div>

                                <div className="form-group">
                                    <label>LI-APo (mm)</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={diagnosisData.C_LI_APo || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_LI_APo', e.target.value)}
                                        placeholder="Normal: 1mm ±2"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="ceph-section">
                            <h3>Soft Tissue Analysis</h3>
                            <div className="form-grid">
                                <div className="form-group">
                                    <label>ULip-E (mm)</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={diagnosisData.C_Ulip_E || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_Ulip_E', e.target.value)}
                                        placeholder="Normal: -4mm ±2"
                                    />
                                </div>

                                <div className="form-group">
                                    <label>LLip-E (mm)</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={diagnosisData.C_Llip_E || ''}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('C_Llip_E', e.target.value)}
                                        placeholder="Normal: -2mm ±2"
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Nasolabial (°)</label>
                                    <input
                                        type="text"
                                        className="form-input"
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
            <div className="diagnosis-footer">
                <button
                    type="button"
                    className="btn-cancel"
                    onClick={handleCancel}
                    disabled={saving}
                >
                    <i className="fas fa-times"></i>
                    Cancel
                </button>
                <button
                    type="button"
                    className="btn-save"
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
