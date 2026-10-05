import { useState, useEffect, ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import PhotoSessionDialog from './PhotoSessionDialog';
import AlertModal from './AlertModal';
import WebCephModal from './WebCephModal';
import PortalAccessCard from './PortalAccessCard';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { LANGUAGES } from '../../core/language';
import { parseLocalDate } from '../../utils/calendarDate';
import { formatPhoneForDisplay } from '../../utils/phoneFormatter';
import { putJSON, httpErrorMessage } from '@/core/http';
import { qk } from '@/query/keys';
import { patientLanguageKey } from '@shared/patient-language';
import { useAuthUser } from '../../contexts/GlobalStateContext';
import { roleCaps, type UserRole } from '@shared/auth/roles';
import type * as patientContract from '@shared/contracts/patient.contract';
import { invalidateTasks } from '@/services/tasks';
import { patientInfoQuery, patientAlertsQuery, costPresetsQuery, alertTypesQuery } from '@/query/queries';
import styles from './ViewPatientInfo.module.css';

interface Props {
    personId?: number | null;  // Validated PersonID from loader (null if invalid)
}

// The parsed contract rows, read as they arrive (two hand-written interfaces used
// to re-type them by assertion, with every nullable turned optional: FE-F6-10).
type PatientInfo = z.infer<typeof patientContract.patientInfo.response>;
type Alert = z.infer<typeof patientContract.alerts.response>[number];

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
    const location = useLocation();
    // Patient edit + estimated cost are FINANCE_ROLES on the server (FE-F6-6).
    const user = useAuthUser();
    const caps = roleCaps(user?.role as UserRole | undefined);
    const toast = useToast();
    const confirm = useConfirm();
    const { language } = useLanguage();
    const queryClient = useQueryClient();
    const [searchParams, setSearchParams] = useSearchParams();
    // Patient demographics read from React Query (shared cache key with
    // PatientShell/XraysComponent — one fetch, deduped, live-invalidated).
    const { data: patientInfoData, isLoading: loading, error: queryError, refetch: refetchPatientInfo } = useQuery({
        ...patientInfoQuery(personId ?? ''),
        enabled: !!personId,
    });
    const patientInfo: PatientInfo | null = patientInfoData ?? null;
    const error = queryError ? httpErrorMessage(queryError, 'Unknown error') : null;
    // A failed BACKGROUND refetch keeps the record on screen (React Query keeps
    // `data` and sets `error`); it used to swap a good record for the error card
    // (FE-F6-11a). Say so in a toast instead — once per failure.
    useEffect(() => {
        if (queryError && patientInfoData) {
            toast.error(t('view.toast.refreshFailed', { error: httpErrorMessage(queryError, '') }));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queryError]);
    // Alerts, cost presets, and alert types read from React Query (shared,
    // deduped, live-invalidated).
    const { data: alertsData, isLoading: alertsLoading } = useQuery({
        ...patientAlertsQuery(personId ?? ''),
        enabled: !!personId,
    });
    const alerts: Alert[] = alertsData ?? [];
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

    const formatPhoneDisplay = (countryCode: string | null, phone: string | null): string => {
        if (!phone) return '-';
        const formatted = formatPhoneForDisplay(phone);
        if (!countryCode) return formatted;
        return `+${countryCode.replace('+', '')} ${formatted}`;
    };

    // In the app's language with Western digits (the browser's locale used to pick
    // the digits: FE-F3-3), and date-only strings on their calendar day.
    const formatDateDisplay = (dateStr: string | null): string => {
        if (!dateStr) return '-';
        try {
            const date = parseLocalDate(dateStr);
            return date.toLocaleDateString(LANGUAGES[language].locale, {
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
        new Date(dateStr).toLocaleDateString(LANGUAGES[language].locale, {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });

    const calculateAge = (dateOfBirth: string | null): string => {
        if (!dateOfBirth) return '-';
        try {
            const dob = parseLocalDate(dateOfBirth);
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

    // Codebook shared with the reminder senders (shared/patient-language.ts, FE-F6-2):
    // what this page says is the language the patient's reminders actually go out in.
    const getLanguageDisplay = (langId: number | null | undefined): string => {
        const key = patientLanguageKey(langId);
        return key ? t(`languages.${key}`) : '-';
    };

    // Format cost for display
    const formatCostDisplay = (cost: number | null, currency: string | null): string => {
        if (!cost) return '-';
        const formattedNumber = cost.toLocaleString('en-US');
        return `${formattedNumber} ${currency || 'IQD'}`;
    };

    // Format cost for input (with commas)
    const formatCostInput = (value: string): string => {
        const numericValue = value.replace(/[^0-9]/g, '');
        if (!numericValue) return '';
        return parseInt(numericValue, 10).toLocaleString('en-US');
    };

    // Parse formatted input to numeric value
    const parseCostInput = (value: string): string => {
        return value.replace(/[^0-9]/g, '');
    };

    // Archiving a context alert is final from the UI (the task log lists header
    // tasks only), so it asks first (FE-F6-11b).
    const handleDeleteAlert = async (alertId: number) => {
        const ok = await confirm(t('view.alerts.archiveConfirm'), {
            title: t('view.alerts.archiveConfirmTitle'),
            confirmText: t('view.alerts.archiveConfirmButton'),
            danger: true,
        });
        if (!ok) return;
        try {
            setDeletingAlertId(alertId);
            await putJSON(`/api/alerts/${alertId}/status`, { status: 'dismissed' });

            // The list here, and the bell when this alert was also in the header.
            void invalidateTasks(personId);
            toast.success(t('view.toast.alertArchived'));
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

    if (error && !patientInfo) {
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
                    {/* Patient edit is FINANCE_ROLES on the server (FE-F6-6). */}
                    {caps.editRecords && (
                        <button
                            onClick={() => navigate(`/patient/${validPersonId}/edit-patient`, {
                                // Save/Cancel on the edit form return here instead of the works page
                                state: { from: `${location.pathname}${location.search}` },
                            })}
                            className="btn btn-primary"
                            disabled={!validPersonId}
                        >
                            <i className={`fas fa-edit ${styles.piIconGap}`}></i>
                            {t('view.editPatient')}
                        </button>
                    )}
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
                                        aria-label={t('view.alerts.editTitle')}
                                    >
                                        <i className="fas fa-pencil-alt" aria-hidden="true"></i>
                                    </button>
                                    <button
                                        onClick={() => handleDeleteAlert(alert.alert_id)}
                                        disabled={deletingAlertId === alert.alert_id}
                                        className={styles.patientAlertDelete}
                                        title={t('view.alerts.archiveTitle')}
                                        aria-label={t('view.alerts.archiveTitle')}
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
                                {patientInfo.gender_display || '-'}
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
                                        type="button"
                                        onClick={handleSaveCost}
                                        disabled={savingCost}
                                        className="btn btn-primary btn-sm"
                                        aria-label={t('view.saveCost')}
                                        title={t('view.saveCost')}
                                    >
                                        {savingCost ? (
                                            <i className="fas fa-spinner fa-spin" aria-hidden="true"></i>
                                        ) : (
                                            <i className="fas fa-check" aria-hidden="true"></i>
                                        )}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleCancelEditingCost}
                                        disabled={savingCost}
                                        className="btn btn-secondary btn-sm"
                                        aria-label={t('view.cancelCost')}
                                        title={t('view.cancelCost')}
                                    >
                                        <i className="fas fa-times" aria-hidden="true"></i>
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className={styles.patientInfoRow}>
                                <span className={styles.patientInfoLabel}>{t('view.labels.estimatedCost')}</span>
                                <span className={`${styles.patientInfoValue} ${styles.patientCostDisplay}`}>
                                    {formatCostDisplay(patientInfo.estimated_cost, patientInfo.currency)}
                                    {/* PUT …/estimated-cost is FINANCE_ROLES (FE-F6-6). */}
                                    {caps.editRecords && (
                                        <button
                                            onClick={handleStartEditingCost}
                                            className={styles.patientCostEditBtn}
                                            title={t('view.editCostTitle')}
                                        >
                                            <i className="fas fa-pencil-alt"></i>
                                        </button>
                                    )}
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
                {validPersonId && caps.managePatientPortal && <PortalAccessCard personId={validPersonId} />}
            </div>

            {/* New Photo Session Dialog */}
            {showPhotoSessionDialog && validPersonId && (
                <PhotoSessionDialog
                    personId={String(validPersonId)}
                    onClose={() => setShowPhotoSessionDialog(false)}
                    onPrepared={({ tpCode }) => {
                        setShowPhotoSessionDialog(false);
                        navigate(`/patient/${validPersonId}/photo-editor/tp${tpCode}`);
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
