import { useState, ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import PhotoSessionDialog from './PhotoSessionDialog';
import AlertModal from './AlertModal';
import WebCephModal from './WebCephModal';
import PortalAccessCard from './PortalAccessCard';
import { useToast } from '../../contexts/ToastContext';
import { formatPhoneForDisplay } from '../../utils/phoneFormatter';
import { putJSON, httpErrorMessage } from '@/core/http';
import { qk } from '@/query/keys';
import { notifyTasksChanged } from '@/services/tasks';
import { patientInfoQuery, patientAlertsQuery, costPresetsQuery, alertTypesQuery } from '@/query/queries';
import styles from './ViewPatientInfo.module.css';

interface Props {
    personId?: number | null;  // Validated PersonID from loader (null if invalid)
}

interface Alert {
    alert_id: number;
    alert_details: string;
    alert_type_id?: number;
    alert_severity?: number;
    creation_date?: string;
    surface_mode?: string;
    expires_at?: string | null;
    escalate_at?: string | null;
}

interface PatientInfo {
    person_id: number;
    patient_name?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    phone2?: string;
    email?: string;
    DateOfBirth?: string;
    gender?: string;
    gender_display?: string;
    address_name?: string;
    referral_source?: string;
    patient_type_name?: string;
    tag_name?: string;
    notes?: string;
    date_added?: string;
    country_code?: string;
    DolphinId?: number | null;
    estimated_cost?: string | number;
    currency?: string;
    language?: number;
    AlertCount?: number;
}

interface EditingCostState {
    value: string;
    currency: string;
}

type Currency = 'IQD' | 'USD' | 'EUR';

interface CostPreset {
    preset_id: number;
    amount: number;
    currency: Currency;
    display_order: number;
}

interface AlertType {
    alert_type_id: number;
    type_name: string;
}

const ViewPatientInfo = ({ personId }: Props) => {
    const { t } = useTranslation('patients');
    const navigate = useNavigate();
    const toast = useToast();
    const queryClient = useQueryClient();
    const [searchParams, setSearchParams] = useSearchParams();
    // Patient demographics now read from React Query (shared cache key with
    // PatientShell/XraysComponent — one fetch, deduped, live-invalidated). The
    // patientInfo response is a loose contract object; cast to the local
    // PatientInfo shape the JSX/helpers expect, mirroring the original
    // fetchJSON<PatientInfo> typing.
    const { data: patientInfoData, isLoading: loading, error: queryError, refetch: refetchPatientInfo } = useQuery({
        ...patientInfoQuery(personId ?? ''),
        enabled: !!personId,
    });
    const patientInfo = (patientInfoData ?? null) as PatientInfo | null;
    const error = queryError ? httpErrorMessage(queryError, 'Unknown error') : null;
    // Alerts, cost presets, and alert types now read from React Query (shared,
    // deduped, live-invalidated). Casts mirror the original fetchJSON typings.
    const { data: alertsData, isLoading: alertsLoading } = useQuery({
        ...patientAlertsQuery(personId ?? ''),
        enabled: !!personId,
    });
    const alerts = (alertsData ?? []) as Alert[];
    const { data: alertTypesData } = useQuery(alertTypesQuery());
    const alertTypes: AlertType[] = alertTypesData ?? [];
    const { data: costPresetsData, isLoading: presetsLoading } = useQuery(costPresetsQuery());
    const costPresets: CostPreset[] = costPresetsData ?? [];
    const [showAlertModal, setShowAlertModal] = useState(false);
    const [deletingAlertId, setDeletingAlertId] = useState<number | null>(null);
    const [showPhotoSessionDialog, setShowPhotoSessionDialog] = useState(false);
    const [editingAlert, setEditingAlert] = useState<Alert | null>(null);

    // Cost editing state
    const [editingCost, setEditingCost] = useState<EditingCostState | null>(null);
    const [savingCost, setSavingCost] = useState(false);

    const reloadAlerts = () =>
        queryClient.invalidateQueries({ queryKey: qk.patient.alerts(personId ?? '') });

    // Use validated PersonID from loader, fallback to patientInfo.person_id
    const validPersonId = personId ?? patientInfo?.person_id ?? null;

    // WebCeph modal open-state lives in the URL (?webceph=1) so browser Back/Forward
    // and deep-links work; the functional updater preserves any other query params.
    const webcephOpen = searchParams.get('webceph') === '1';
    const openWebceph = () => setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('webceph', '1');
        return next;
    });
    const closeWebceph = () => setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('webceph');
        return next;
    });

    const formatPhoneDisplay = (countryCode: string | undefined, phone: string | undefined): string => {
        if (!phone) return '-';
        const formatted = formatPhoneForDisplay(phone);
        if (!countryCode) return formatted;
        return `+${countryCode.replace('+', '')} ${formatted}`;
    };

    const formatDateDisplay = (dateStr: string | undefined): string => {
        if (!dateStr) return '-';
        try {
            const date = new Date(dateStr);
            return date.toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        } catch {
            return dateStr;
        }
    };

    // Short-month date for the alert list (defined outside JSX so the format
    // option literals aren't flagged by the i18n ratchet; digits stay Western).
    const formatAlertDate = (dateStr: string): string =>
        new Date(dateStr).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });

    const calculateAge = (dateOfBirth: string | undefined): string => {
        if (!dateOfBirth) return '-';
        try {
            const dob = new Date(dateOfBirth);
            const today = new Date();
            let age = today.getFullYear() - dob.getFullYear();
            const monthDiff = today.getMonth() - dob.getMonth();
            if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
                age--;
            }
            return t('view.ageValue', { age });
        } catch {
            return '-';
        }
    };

    const getLanguageDisplay = (langId: number | undefined): string => {
        switch (langId) {
            case 0: return t('languages.kurdish');
            case 1: return t('languages.arabic');
            case 2: return t('languages.english');
            default: return '-';
        }
    };

    // Format cost for display
    const formatCostDisplay = (cost: string | number | undefined, currency: string | undefined): string => {
        if (!cost) return '-';
        const numericCost = typeof cost === 'string' ? parseFloat(cost) : cost;
        if (isNaN(numericCost)) return '-';

        const formattedNumber = numericCost.toLocaleString('en-US');
        return `${formattedNumber} ${currency || 'IQD'}`;
    };

    // Format cost for input (with commas)
    const formatCostInput = (value: string): string => {
        const numericValue = value.replace(/[^0-9]/g, '');
        if (!numericValue) return '';
        return parseInt(numericValue).toLocaleString('en-US');
    };

    // Parse formatted input to numeric value
    const parseCostInput = (value: string): string => {
        return value.replace(/[^0-9]/g, '');
    };

    // Handle alert modal save - refresh alerts list
    const handleAlertSaved = async () => {
        await reloadAlerts();
    };

    const handleDeleteAlert = async (alertId: number) => {
        try {
            setDeletingAlertId(alertId);
            await putJSON(`/api/alerts/${alertId}/status`, { status: 'dismissed' });

            reloadAlerts(); // Reload alerts
            notifyTasksChanged();
            toast.success(t('view.toast.alertDeleted'));
        } catch (err) {
            console.error('Error deleting alert:', err);
            toast.error(httpErrorMessage(err, t('view.toast.alertDeleteFailed')));
        } finally {
            setDeletingAlertId(null);
        }
    };

    // Cost editing handlers
    const handleStartEditingCost = () => {
        setEditingCost({
            value: patientInfo?.estimated_cost?.toString() || '',
            currency: patientInfo?.currency || 'IQD'
        });
    };

    const handleSaveCost = async () => {
        if (!editingCost || !validPersonId) return;

        try {
            setSavingCost(true);

            await putJSON(`/api/patients/${validPersonId}/estimated-cost`, {
                estimatedCost: parseCostInput(editingCost.value),
                currency: editingCost.currency
            });
            queryClient.invalidateQueries({ queryKey: qk.patient.all(validPersonId) });

            toast.success(t('view.toast.costSaved'));
            setEditingCost(null);
        } catch (err) {
            console.error('Error saving cost:', err);
            toast.error(httpErrorMessage(err, t('view.toast.costSaveFailed')));
        } finally {
            setSavingCost(false);
        }
    };

    const handleCancelEditingCost = () => {
        setEditingCost(null);
    };

    // Handle preset selection
    const handleSelectPreset = (preset: CostPreset) => {
        setEditingCost({
            value: preset.amount.toString(),
            currency: preset.currency
        });
    };

    // Get presets filtered by current currency
    const getFilteredPresets = (): CostPreset[] => {
        if (!editingCost) return [];
        return costPresets
            .filter(p => p.currency === editingCost.currency)
            .sort((a, b) => a.display_order - b.display_order);
    };

    // Format preset amount for display
    const formatPresetAmount = (amount: number): string => {
        return amount.toLocaleString('en-US');
    };

    if (loading) {
        return (
            <div className={styles.patientInfoLoading}>
                <i className={`fas fa-spinner fa-spin ${styles.patientLoadingSpinner}`}></i>
                <p>{t('view.loading')}</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.patientInfoError}>
                <i className={`fas fa-exclamation-triangle ${styles.patientErrorIcon}`}></i>
                <p>{error}</p>
                <button onClick={() => refetchPatientInfo()}>{t('view.retry')}</button>
            </div>
        );
    }

    if (!patientInfo) {
        return (
            <div className={styles.patientInfoEmpty}>
                <i className={`fas fa-user ${styles.patientEmptyIcon}`}></i>
                <p>{t('view.empty')}</p>
            </div>
        );
    }

    return (
        <div className={styles.patientInfoContainer}>
            {/* Header Section */}
            <div className={styles.patientInfoHeader}>
                <div className={styles.patientAvatar}>
                    <i className={`fas fa-user-circle ${styles.patientAvatarIcon}`}></i>
                </div>
                <div className={styles.patientHeaderDetails}>
                    <h2 className={styles.patientPrimaryName}>{patientInfo.patient_name}</h2>
                    <p className={styles.patientSecondaryName}>
                        {(patientInfo.first_name || patientInfo.last_name) && (
                            <span>{patientInfo.first_name} {patientInfo.last_name}</span>
                        )}
                        <span className={styles.patientId}>{t('view.idLabel', { id: patientInfo.person_id })}</span>
                    </p>
                </div>
                <div className={styles.patientHeaderActions}>
                    <button
                        onClick={() => navigate(`/patient/${validPersonId}/edit-patient`)}
                        className="btn btn-primary"
                        disabled={!validPersonId}
                    >
                        <i className={`fas fa-edit ${styles.piIconGap}`}></i>
                        {t('view.editPatient')}
                    </button>
                    <button
                        onClick={() => setShowPhotoSessionDialog(true)}
                        className="btn btn-secondary"
                    >
                        <i className={`fas fa-camera ${styles.piIconGap}`}></i>
                        {t('view.addPhotos')}
                    </button>
                    <button
                        onClick={openWebceph}
                        className="btn btn-secondary"
                        disabled={!validPersonId}
                    >
                        <i className={`fas fa-brain ${styles.piIconGap}`}></i>
                        {t('view.webceph')}
                    </button>
                </div>
            </div>

            {/* Alerts Section */}
            <div className={styles.patientAlertsSection}>
                <div className={styles.patientAlertHeader}>
                    <h3 className={styles.patientSectionTitle}>
                        <i className={`fas fa-exclamation-triangle ${styles.alertIcon} ${styles.piIconGap}`}></i>
                        {t('view.alerts.title')}
                    </h3>
                    <button
                        onClick={() => {
                            setEditingAlert(null);
                            setShowAlertModal(true);
                        }}
                        className="btn btn-warning btn-sm"
                        disabled={!validPersonId}
                    >
                        <i className={`fas fa-plus ${styles.piIconGap}`}></i>
                        {t('view.alerts.add')}
                    </button>
                </div>
                {alertsLoading ? (
                    <div className={styles.patientAlertsLoading}>
                        <i className="fas fa-spinner fa-spin"></i>
                        {t('view.alerts.loading')}
                    </div>
                ) : alerts.length > 0 ? (
                    <div className={styles.patientAlertsList}>
                        {alerts.map(alert => (
                            <div key={alert.alert_id} className={styles.patientAlertItem}>
                                <div className={styles.patientAlertContent}>
                                    <span className={styles.patientAlertText}>{alert.alert_details}</span>
                                    {alert.creation_date && (
                                        <span className={styles.patientAlertDate}>
                                            {formatAlertDate(alert.creation_date)}
                                        </span>
                                    )}
                                </div>
                                <div className={styles.patientAlertActions}>
                                    <button
                                        onClick={() => {
                                            setEditingAlert(alert);
                                            setShowAlertModal(true);
                                        }}
                                        className={styles.patientAlertEdit}
                                        title={t('view.alerts.editTitle')}
                                    >
                                        <i className="fas fa-pencil-alt"></i>
                                    </button>
                                    <button
                                        onClick={() => handleDeleteAlert(alert.alert_id)}
                                        disabled={deletingAlertId === alert.alert_id}
                                        className={styles.patientAlertDelete}
                                        title={t('view.alerts.archiveTitle')}
                                    >
                                        {deletingAlertId === alert.alert_id ? (
                                            <i className="fas fa-spinner fa-spin"></i>
                                        ) : (
                                            <i className="fas fa-times"></i>
                                        )}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className={styles.patientAlertsEmpty}>
                        {t('view.alerts.empty')}
                    </div>
                )}
            </div>

            {/* Info Grid */}
            <div className={styles.patientInfoGrid}>
                {/* Contact Information */}
                <div className={styles.patientInfoCard}>
                    <h3 className={styles.patientCardTitle}>
                        <i className={`fas fa-address-book ${styles.piIconGap}`}></i>
                        {t('view.cards.contact')}
                    </h3>
                    <div className={styles.patientInfoRows}>
                        <div className={styles.patientInfoRow}>
                            <span className={styles.patientInfoLabel}>{t('view.labels.phone')}</span>
                            {/* dir="ltr" keeps the number's groups in order under RTL */}
                            <span className={styles.patientInfoValue} dir="ltr">
                                {formatPhoneDisplay(patientInfo.country_code, patientInfo.phone)}
                            </span>
                        </div>
                        {patientInfo.phone2 && (
                            <div className={styles.patientInfoRow}>
                                <span className={styles.patientInfoLabel}>{t('view.labels.phone2')}</span>
                                <span className={styles.patientInfoValue} dir="ltr">{formatPhoneForDisplay(patientInfo.phone2)}</span>
                            </div>
                        )}
                        <div className={styles.patientInfoRow}>
                            <span className={styles.patientInfoLabel}>{t('view.labels.email')}</span>
                            {/* dir="ltr" keeps the address in order under RTL */}
                            <span className={styles.patientInfoValue} dir="ltr">{patientInfo.email || '-'}</span>
                        </div>
                        <div className={styles.patientInfoRow}>
                            <span className={styles.patientInfoLabel}>{t('view.labels.address')}</span>
                            <span className={styles.patientInfoValue}>{patientInfo.address_name || '-'}</span>
                        </div>
                    </div>
                </div>

                {/* Personal Information */}
                <div className={styles.patientInfoCard}>
                    <h3 className={styles.patientCardTitle}>
                        <i className={`fas fa-user ${styles.piIconGap}`}></i>
                        {t('view.cards.personal')}
                    </h3>
                    <div className={styles.patientInfoRows}>
                        <div className={styles.patientInfoRow}>
                            <span className={styles.patientInfoLabel}>{t('view.labels.dateOfBirth')}</span>
                            <span className={styles.patientInfoValue}>
                                {formatDateDisplay(patientInfo.DateOfBirth)}
                            </span>
                        </div>
                        <div className={styles.patientInfoRow}>
                            <span className={styles.patientInfoLabel}>{t('view.labels.age')}</span>
                            <span className={styles.patientInfoValue}>
                                {calculateAge(patientInfo.DateOfBirth)}
                            </span>
                        </div>
                        <div className={styles.patientInfoRow}>
                            <span className={styles.patientInfoLabel}>{t('view.labels.gender')}</span>
                            <span className={styles.patientInfoValue}>
                                {patientInfo.gender_display || patientInfo.gender || '-'}
                            </span>
                        </div>
                        <div className={styles.patientInfoRow}>
                            <span className={styles.patientInfoLabel}>{t('view.labels.language')}</span>
                            <span className={styles.patientInfoValue}>
                                {getLanguageDisplay(patientInfo.language)}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Additional Information */}
                <div className={styles.patientInfoCard}>
                    <h3 className={styles.patientCardTitle}>
                        <i className={`fas fa-info-circle ${styles.piIconGap}`}></i>
                        {t('view.cards.additional')}
                    </h3>
                    <div className={styles.patientInfoRows}>
                        <div className={styles.patientInfoRow}>
                            <span className={styles.patientInfoLabel}>{t('view.labels.patientType')}</span>
                            <span className={styles.patientInfoValue}>{patientInfo.patient_type_name || '-'}</span>
                        </div>
                        <div className={styles.patientInfoRow}>
                            <span className={styles.patientInfoLabel}>{t('view.labels.referralSource')}</span>
                            <span className={styles.patientInfoValue}>{patientInfo.referral_source || '-'}</span>
                        </div>
                        {patientInfo.tag_name && (
                            <div className={styles.patientInfoRow}>
                                <span className={styles.patientInfoLabel}>{t('view.labels.tag')}</span>
                                <span className={`${styles.patientInfoValue} ${styles.patientTag}`}>{patientInfo.tag_name}</span>
                            </div>
                        )}
                        <div className={styles.patientInfoRow}>
                            <span className={styles.patientInfoLabel}>{t('view.labels.dolphinId')}</span>
                            <span className={styles.patientInfoValue}>
                                {patientInfo.DolphinId || '-'}
                            </span>
                        </div>
                        <div className={styles.patientInfoRow}>
                            <span className={styles.patientInfoLabel}>{t('view.labels.dateAdded')}</span>
                            <span className={styles.patientInfoValue}>
                                {formatDateDisplay(patientInfo.date_added)}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Cost Information */}
                <div className={styles.patientInfoCard}>
                    <h3 className={styles.patientCardTitle}>
                        <i className={`fas fa-dollar-sign ${styles.piIconGap}`}></i>
                        {t('view.cards.estimatedCost')}
                    </h3>
                    <div className={styles.patientInfoRows}>
                        {editingCost ? (
                            <div className={styles.patientCostEditForm}>
                                <div className={styles.patientCostInputGroup}>
                                    <input
                                        type="text"
                                        value={formatCostInput(editingCost.value)}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => setEditingCost({
                                            ...editingCost,
                                            value: parseCostInput(e.target.value)
                                        })}
                                        className={styles.patientCostInput}
                                        placeholder={t('view.costPlaceholder')}
                                    />
                                    <select
                                        value={editingCost.currency}
                                        onChange={(e: ChangeEvent<HTMLSelectElement>) => setEditingCost({
                                            ...editingCost,
                                            currency: e.target.value
                                        })}
                                        className={styles.patientCostCurrency}
                                    >
                                        <option value="IQD">IQD</option>
                                        <option value="USD">USD</option>
                                        <option value="EUR">EUR</option>
                                    </select>
                                </div>
                                {/* Cost Presets */}
                                {presetsLoading ? (
                                    <div className={styles.patientCostPresetsLoading}>
                                        <i className="fas fa-spinner fa-spin"></i>
                                    </div>
                                ) : getFilteredPresets().length > 0 && (
                                    <div className={styles.patientCostPresets}>
                                        {getFilteredPresets().map(preset => (
                                            <button
                                                key={preset.preset_id}
                                                type="button"
                                                onClick={() => handleSelectPreset(preset)}
                                                className={styles.patientCostPresetBtn}
                                            >
                                                {formatPresetAmount(preset.amount)}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <div className={styles.patientCostEditActions}>
                                    <button
                                        onClick={handleSaveCost}
                                        disabled={savingCost}
                                        className="btn btn-primary btn-sm"
                                    >
                                        {savingCost ? (
                                            <i className="fas fa-spinner fa-spin"></i>
                                        ) : (
                                            <i className="fas fa-check"></i>
                                        )}
                                    </button>
                                    <button
                                        onClick={handleCancelEditingCost}
                                        disabled={savingCost}
                                        className="btn btn-secondary btn-sm"
                                    >
                                        <i className="fas fa-times"></i>
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className={styles.patientInfoRow}>
                                <span className={styles.patientInfoLabel}>{t('view.labels.estimatedCost')}</span>
                                <span className={`${styles.patientInfoValue} ${styles.patientCostDisplay}`}>
                                    {formatCostDisplay(patientInfo.estimated_cost, patientInfo.currency)}
                                    <button
                                        onClick={handleStartEditingCost}
                                        className={styles.patientCostEditBtn}
                                        title={t('view.editCostTitle')}
                                    >
                                        <i className="fas fa-pencil-alt"></i>
                                    </button>
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Notes */}
                <div className={`${styles.patientInfoCard} ${styles.patientNotesCard}`}>
                    <h3 className={styles.patientCardTitle}>
                        <i className={`fas fa-sticky-note ${styles.piIconGap}`}></i>
                        {t('view.cards.notes')}
                    </h3>
                    <div className={styles.patientNotesContent}>
                        {patientInfo.notes || <span className={styles.patientNotesEmpty}>{t('view.notesEmpty')}</span>}
                    </div>
                </div>

                {/* Portal Access */}
                {validPersonId && <PortalAccessCard personId={validPersonId} />}
            </div>

            {/* New Photo Session Dialog */}
            {showPhotoSessionDialog && validPersonId && (
                <PhotoSessionDialog
                    personId={String(validPersonId)}
                    patientInfo={patientInfo}
                    onClose={() => setShowPhotoSessionDialog(false)}
                    onPrepared={({ tpCode, tpName, tpDate }) => {
                        setShowPhotoSessionDialog(false);
                        navigate(
                            `/patient/${validPersonId}/photo-editor/tp${tpCode}?tpName=${encodeURIComponent(tpName)}&date=${tpDate}`
                        );
                    }}
                />
            )}

            {/* Alert Modal */}
            {validPersonId && (
                <AlertModal
                    isOpen={showAlertModal}
                    onClose={() => {
                        setShowAlertModal(false);
                        setEditingAlert(null);
                    }}
                    onSave={handleAlertSaved}
                    personId={validPersonId}
                    alertTypes={alertTypes}
                    editAlert={editingAlert}
                />
            )}

            {/* WebCeph Modal */}
            {validPersonId && (
                <WebCephModal
                    isOpen={webcephOpen}
                    onClose={closeWebceph}
                    personId={validPersonId}
                    patientInfo={patientInfo}
                />
            )}
        </div>
    );
};

export default ViewPatientInfo;
