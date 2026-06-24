import { useState, useEffect, useMemo, useRef, type ChangeEvent, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import cn from 'classnames';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import SimplifiedCalendarPicker from './SimplifiedCalendarPicker';
import { useToast } from '../../contexts/ToastContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { postJSON, putJSON, httpErrorMessage } from '@/core/http';
import { formatAppointmentDateTime } from '@/utils/formatters';
import { qk } from '@/query/keys';
import { employeesQuery, appointmentDetailsQuery, appointmentByIdQuery } from '@/query/queries';
import styles from './AppointmentForm.module.css';

interface AppointmentFormData {
    PersonID: number | string;
    AppDate: string;
    AppTime: string;
    AppDetail: string;
    DrID: string;
}

interface ValidationErrors {
    [key: string]: string | null;
}

interface Doctor {
    id: number;
    employee_name: string;
}

interface AppointmentDetail {
    id: number;
    detail: string | null; // details.detail is nullable in the DB
}

interface ExistingAppointment {
    appointment_id?: number;
    person_id?: number;
    app_date: string;
    app_detail?: string;
    dr_id?: number | string;
}

interface EditAppointmentFormProps {
    personId?: number | null;
    appointmentId?: number | string;
    onClose?: () => void;
    onSuccess?: (result: unknown) => void;
}

/**
 * EditAppointmentForm Component
 *
 * Allows editing existing appointments with prefilled data
 * Uses the same layout as AppointmentForm
 */

const EditAppointmentForm = ({ personId, appointmentId, onClose, onSuccess }: EditAppointmentFormProps) => {
    const { t } = useTranslation('appointments');
    const { language } = useLanguage();
    const location = useLocation();
    const toast = useToast();
    const queryClient = useQueryClient();
    const existingAppointment = (location.state as { appointment?: ExistingAppointment } | null)?.appointment;

    const [formData, setFormData] = useState<AppointmentFormData>({
        PersonID: personId ?? '',
        AppDate: '',
        AppTime: '',
        AppDetail: '',
        DrID: ''
    });
    const [originalDate, setOriginalDate] = useState<string>('');
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [validation, setValidation] = useState<ValidationErrors>({});
    const doctorSelectRef = useRef<HTMLSelectElement>(null);
    const detailSelectRef = useRef<HTMLSelectElement>(null);
    const formColumnRef = useRef<HTMLDivElement>(null);
    const selectedTimeRef = useRef<HTMLDivElement>(null);
    const flashAnimRef = useRef<Animation | null>(null);

    // Doctors + appointment-type options, both on useQuery (cached, shared app-wide).
    const { data: employeesData } = useQuery(employeesQuery('?getAppointments=true'));
    const doctors = useMemo<Doctor[]>(() => {
        const list: Doctor[] = (employeesData?.employees ?? []).slice();
        // "Clinic" floats to the top; everyone else keeps the server's SortOrder.
        list.sort((a, b) => {
            if (a.employee_name === 'Clinic') return -1;
            if (b.employee_name === 'Clinic') return 1;
            return 0;
        });
        return list;
    }, [employeesData]);

    const { data: detailsData } = useQuery(appointmentDetailsQuery());
    const details: AppointmentDetail[] = detailsData ?? [];

    // Fetch the appointment only when it wasn't handed to us via router state.
    const {
        data: appointmentData,
        isLoading: appointmentLoading,
        isError: appointmentIsError,
        error: appointmentError,
    } = useQuery({
        ...appointmentByIdQuery(appointmentId),
        enabled: !existingAppointment && !!appointmentId,
    });

    // The appointment to seed the form from — router state wins, else the fetch.
    const sourceAppointment: ExistingAppointment | null =
        existingAppointment ?? (appointmentData?.appointment as ExistingAppointment | undefined) ?? null;

    // We're still loading only while a fetch is genuinely in flight.
    const loadingData = !existingAppointment && !!appointmentId && appointmentLoading;

    // Surface either a submit error or an appointment-load failure.
    const displayError =
        error ?? (appointmentIsError ? httpErrorMessage(appointmentError, t('form.errorUnknown')) : null);

    // Seed the editable form once the source appointment resolves. Declared before
    // the effect so it isn't "used before declaration"; the setState lives inside
    // this function (not inline in the effect), so it isn't a cascading effect write.
    const prefillFormData = (appt: ExistingAppointment): void => {
        const dateTime = new Date(appt.app_date);
        const year = dateTime.getFullYear();
        const month = String(dateTime.getMonth() + 1).padStart(2, '0');
        const day = String(dateTime.getDate()).padStart(2, '0');
        const hours = String(dateTime.getHours()).padStart(2, '0');
        const minutes = String(dateTime.getMinutes()).padStart(2, '0');

        const datePart = `${year}-${month}-${day}`;
        setFormData({
            PersonID: appt.person_id ?? '',
            AppDate: datePart,
            AppTime: `${hours}:${minutes}`,
            AppDetail: appt.app_detail || '',
            DrID: String(appt.dr_id || '')
        });
        setOriginalDate(datePart);
    };

    // Seed the editable form once the source appointment resolves. Done during
    // render (keyed on the appointment identity) rather than in an effect, so the
    // React Compiler can optimize and there's no extra post-paint render.
    const sourceKey = sourceAppointment
        ? String(sourceAppointment.appointment_id ?? `${sourceAppointment.person_id ?? ''}|${sourceAppointment.app_date}`)
        : '';
    const [prefilledKey, setPrefilledKey] = useState('');
    if (sourceKey !== prefilledKey) {
        setPrefilledKey(sourceKey);
        if (sourceAppointment) {
            prefillFormData(sourceAppointment);
        }
    }

    useEffect(() => {
        return () => {
            flashAnimRef.current?.cancel();
        };
    }, []);

    const handleInputChange = (e: ChangeEvent<HTMLSelectElement | HTMLInputElement>): void => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
        if (validation[name]) {
            setValidation(prev => ({ ...prev, [name]: null }));
        }
        if (name === 'DrID' && value && !formData.AppDetail) {
            setTimeout(() => detailSelectRef.current?.focus(), 0);
        }
    };

    const handleDateTimeSelection = (dateTime: Date | string): void => {
        const date = new Date(dateTime);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');

        setFormData(prev => ({
            ...prev,
            AppDate: `${year}-${month}-${day}`,
            AppTime: `${hours}:${minutes}`
        }));
        setValidation(prev => ({ ...prev, AppDate: null, AppTime: null }));

        // Brief rose flash on .selectedTime via Web Animations API — see
        // AppointmentForm.tsx for the rationale (plays under
        // prefers-reduced-motion since it's color-only, and avoids fighting
        // reset.css's blanket reduced-motion override with !important).
        if (selectedTimeRef.current) {
            flashAnimRef.current?.cancel();
            const cs = getComputedStyle(selectedTimeRef.current);
            const successColor = cs.getPropertyValue('--success-color').trim();
            const success50 = cs.getPropertyValue('--success-50').trim();
            const selectionColor = cs.getPropertyValue('--selection-color').trim();
            const selectionRgb = cs.getPropertyValue('--selection-color-rgb').trim();
            const selectionTint = `rgba(${selectionRgb}, 0.22)`;
            flashAnimRef.current = selectedTimeRef.current.animate([
                { borderColor: successColor, backgroundColor: success50 },
                { borderColor: selectionColor, backgroundColor: selectionTint, offset: 0.15 },
                { borderColor: selectionColor, backgroundColor: selectionTint, offset: 0.70 },
                { borderColor: successColor, backgroundColor: success50 }
            ], { duration: 600, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' });
        }

        // Mobile (<=992px, where columns stack): bring the form into view.
        // On desktop the focus-scroll below handles intra-column scrolling.
        // Smooth + reduced-motion come from html { scroll-behavior }.
        if (typeof window !== 'undefined' && window.matchMedia('(max-width: 992px)').matches) {
            formColumnRef.current?.scrollIntoView({ block: 'start' });
        }

        // In edit mode both fields are usually already filled, so this is a
        // no-op on the common path.
        setTimeout(() => {
            if (!formData.DrID) {
                doctorSelectRef.current?.focus();
            } else if (!formData.AppDetail) {
                detailSelectRef.current?.focus();
            }
        }, 0);
    };

    const validateForm = (): boolean => {
        const errors: ValidationErrors = {};
        if (!formData.AppDate) errors.AppDate = t('form.errorSelectDate');
        if (!formData.AppTime) errors.AppTime = t('form.errorSelectTime');
        if (!formData.DrID) errors.DrID = t('form.errorSelectDoctor');
        if (!formData.AppDetail) errors.AppDetail = t('form.errorSelectType');
        setValidation(errors);
        return Object.keys(errors).length === 0;
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
        e.preventDefault();
        if (!validateForm()) return;

        setLoading(true);
        setError(null);

        try {
            const appointmentDateTime = `${formData.AppDate}T${formData.AppTime}:00`;
            const result = await putJSON<{ success?: boolean; error?: string }>(
                `/api/appointments/${appointmentId || existingAppointment?.appointment_id}`,
                {
                    person_id: parseInt(String(formData.PersonID)),
                    app_date: appointmentDateTime,
                    app_detail: formData.AppDetail,
                    dr_id: parseInt(formData.DrID)
                }
            );

            if (result.success) {
                const dateChanged = formData.AppDate !== originalDate;
                const apptId = appointmentId || existingAppointment?.appointment_id;

                if (dateChanged && apptId) {
                    postJSON<{ success: boolean; message?: string }>('/api/wa/send-appointment', {
                        appointmentId: apptId
                    })
                        .then((waResult) => {
                            if (waResult.success) {
                                toast.success(t('form.waSent'));
                            } else {
                                toast.warning(waResult.message || t('form.waFailed'));
                            }
                        })
                        .catch(err => {
                            toast.error(t('form.waError', { error: httpErrorMessage(err, 'send failed') }));
                        });
                }

                // Refresh the patient's appointment-backed reads so the edited
                // date/doctor/type shows immediately on returning to the list —
                // the 30s-fresh cache would otherwise serve stale rows.
                queryClient.invalidateQueries({ queryKey: qk.patient.all(personId ?? '') });

                onSuccess && onSuccess(result);
                onClose && onClose();
            } else {
                throw new Error(result.error || t('form.errorUpdateFailed'));
            }
        } catch (err) {
            // putJSON throws on non-2xx; httpErrorMessage surfaces the server's
            // error message (this form has no conflict-code branching — M1).
            console.error('Error updating appointment:', err);
            setError(httpErrorMessage(err, t('form.errorUnknown')));
        } finally {
            setLoading(false);
        }
    };

    const getDateTimeDisplay = (): string => {
        if (formData.AppDate && formData.AppTime) {
            return formatAppointmentDateTime(new Date(`${formData.AppDate}T${formData.AppTime}`), language);
        }
        return t('form.noTimeSelected');
    };

    if (loadingData) {
        return (
            <div className={styles.page}>
                <div className={styles.loadingState}>
                    <i className="fas fa-spinner fa-spin"></i>
                    <p>{t('form.loadingData')}</p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.page}>
            {/* Page Header */}
            <header className={styles.pageHeader}>
                <div>
                    <h1><i className="fas fa-calendar-edit"></i> {t('form.editTitle')}</h1>
                    <p>{t('form.patientLabel', { id: personId })}</p>
                </div>
                <button className={styles.closeButton} onClick={onClose} title={t('form.close')}>
                    <i className="fas fa-times"></i>
                </button>
            </header>

            {/* Main Content: 3 Columns */}
            <div className={styles.pageContent}>
                {/* Calendar Picker (LEFT + MIDDLE columns) */}
                <SimplifiedCalendarPicker
                    onSelectDateTime={handleDateTimeSelection}
                    initialDate={formData.AppDate ? new Date(formData.AppDate) : new Date()}
                />

                {/* RIGHT COLUMN: Form */}
                <div className={styles.formColumn} ref={formColumnRef}>
                    <div className={styles.formHeader}>
                        <h2><i className="fas fa-clipboard-list"></i> {t('form.detailsHeading')}</h2>
                    </div>

                    <form onSubmit={handleSubmit} className={styles.form}>
                        {displayError && (
                            <div className={cn(styles.alert, styles.alertError)}>
                                <i className="fas fa-exclamation-circle"></i>
                                <span>{displayError}</span>
                            </div>
                        )}

                        <div className={styles.formField}>
                            <span><i className="fas fa-calendar-check"></i> {t('form.selectedTime')}</span>
                            <div
                                ref={selectedTimeRef}
                                className={cn(styles.selectedTime, {
                                    [styles.hasValue]: formData.AppDate && formData.AppTime
                                })}
                            >
                                {getDateTimeDisplay()}
                            </div>
                            {(validation.AppDate || validation.AppTime) && (
                                <span className={styles.fieldError}>{validation.AppDate || validation.AppTime}</span>
                            )}
                        </div>

                        <div className={styles.formField}>
                            <label htmlFor="doctor"><i className="fas fa-user-md"></i> {t('form.doctor')}</label>
                            <select
                                id="doctor"
                                name="DrID"
                                ref={doctorSelectRef}
                                value={formData.DrID}
                                onChange={handleInputChange}
                                className={validation.DrID ? styles.error : ''}
                            >
                                <option value="">{t('form.selectDoctor')}</option>
                                {doctors.filter(d => d.id).map((doctor) => (
                                    <option key={doctor.id} value={doctor.id}>
                                        {doctor.employee_name}
                                    </option>
                                ))}
                            </select>
                            {validation.DrID && <span className={styles.fieldError}>{validation.DrID}</span>}
                        </div>

                        <div className={styles.formField}>
                            <label htmlFor="details"><i className="fas fa-notes-medical"></i> {t('form.appointmentType')}</label>
                            <select
                                id="details"
                                name="AppDetail"
                                ref={detailSelectRef}
                                value={formData.AppDetail}
                                onChange={handleInputChange}
                                className={validation.AppDetail ? styles.error : ''}
                            >
                                <option value="">{t('form.selectType')}</option>
                                {details.filter(d => d.id).map((detail) => (
                                    <option key={detail.id} value={detail.detail ?? ''}>
                                        {detail.detail}
                                    </option>
                                ))}
                            </select>
                            {validation.AppDetail && <span className={styles.fieldError}>{validation.AppDetail}</span>}
                        </div>

                        <div className={styles.formActions}>
                            <button
                                type="button"
                                className="btn btn-cancel"
                                onClick={onClose}
                                disabled={loading}
                            >
                                <i className="fas fa-times"></i>
                                {t('form.cancel')}
                            </button>
                            <button
                                type="submit"
                                className="btn btn-create"
                                disabled={loading}
                            >
                                {loading ? (
                                    <>
                                        <i className="fas fa-spinner fa-spin"></i>
                                        {t('form.updating')}
                                    </>
                                ) : (
                                    <>
                                        <i className="fas fa-save"></i>
                                        {t('form.update')}
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default EditAppointmentForm;
