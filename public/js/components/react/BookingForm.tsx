import { useState, useEffect, useMemo, useRef, type ChangeEvent, type FormEvent } from 'react';
import cn from 'classnames';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import SimplifiedCalendarPicker from './SimplifiedCalendarPicker';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatAppointmentDateTime } from '@/utils/formatters';
import { parseLocalDate } from '@/utils/calendarDate';
import { doctorsQuery, appointmentDetailsQuery } from '@/query/queries';
import styles from './AppointmentForm.module.css';
import { isClinicDoctorName } from '@shared/clinic-doctor';

/** The four booking fields, as the form's selects and the picker hold them. */
export interface BookingValues {
    AppDate: string; // 'YYYY-MM-DD'
    AppTime: string; // 'HH:MM'
    AppDetail: string;
    DrID: string;
}

type ValidationErrors = Partial<Record<keyof BookingValues, string | null>>;

const EMPTY: BookingValues = { AppDate: '', AppTime: '', AppDetail: '', DrID: '' };

interface BookingFormProps {
    /** Editing an existing appointment (title, button wording); otherwise a new booking. */
    isEdit?: boolean;
    personId?: number | null;
    /** Edit: the stored values. The form re-seeds whenever `seedKey` changes. */
    seed?: BookingValues | null;
    seedKey?: string;
    /**
     * Edit: the appointment's own doctor. When they are no longer a calendar
     * doctor (they left), they are still offered as "<name> (current)", so an
     * edit never forces a re-attribution (audit FE-F10-13; cf. FE-F7-1).
     */
    currentDoctor?: { id: number; name: string } | null;
    submitting: boolean;
    error: string | null;
    onSubmit: (values: BookingValues) => void;
    onClose?: () => void;
}

/**
 * The booking page shared by the new and edit forms: the month + day picker on
 * the left, the details column on the right. The two forms used to carry about
 * 180 identical lines each (audit FE-F10-18); each now only reads/writes.
 *
 * The Doctor list is `/api/doctors` — active employees whose position is Doctor,
 * the one definition the calendar, the daily board and the server share (owner's
 * call on FE-F10-13). It used to be the `get_appointments` flag, so an Assistant
 * carrying it was offered and then refused with an English 400.
 */
const BookingForm = ({
    isEdit = false,
    personId,
    seed,
    seedKey = '',
    currentDoctor,
    submitting,
    error,
    onSubmit,
    onClose
}: BookingFormProps) => {
    const { t } = useTranslation('appointments');
    const { language } = useLanguage();
    const [values, setValues] = useState<BookingValues>(seed ?? EMPTY);
    const [validation, setValidation] = useState<ValidationErrors>({});
    const doctorSelectRef = useRef<HTMLSelectElement>(null);
    const detailSelectRef = useRef<HTMLSelectElement>(null);
    const formColumnRef = useRef<HTMLDivElement>(null);
    const selectedTimeRef = useRef<HTMLDivElement>(null);
    const flashAnimRef = useRef<Animation | null>(null);

    // Re-seed when the stored appointment changes (render-phase, keyed).
    const [seededKey, setSeededKey] = useState(seedKey);
    if (seedKey !== seededKey) {
        setSeededKey(seedKey);
        setValues(seed ?? EMPTY);
        setValidation({});
    }

    const { data: doctorsData } = useQuery(doctorsQuery());
    const doctors = useMemo(() => {
        const list = (doctorsData ?? []).map(d => ({ id: d.id, label: d.employee_name }));
        // "Clinic" is the most common assignment, so it floats to the top; everyone
        // else keeps the server's order (Array.sort is stable).
        list.sort((a, b) => (isClinicDoctorName(a.label) ? -1 : isClinicDoctorName(b.label) ? 1 : 0));
        if (currentDoctor && !list.some(d => d.id === currentDoctor.id)) {
            list.push({ id: currentDoctor.id, label: t('form.currentDoctor', { name: currentDoctor.name }) });
        }
        return list;
    }, [doctorsData, currentDoctor, t]);

    const { data: detailsData } = useQuery(appointmentDetailsQuery());
    const details = detailsData ?? [];

    useEffect(() => {
        return () => {
            flashAnimRef.current?.cancel();
        };
    }, []);

    const handleInputChange = (e: ChangeEvent<HTMLSelectElement>): void => {
        const name = e.target.name as keyof BookingValues;
        const { value } = e.target;
        setValues(prev => ({ ...prev, [name]: value }));
        if (validation[name]) {
            setValidation(prev => ({ ...prev, [name]: null }));
        }
        // Keyboard flow: after Doctor is picked, move to Type if it is still empty.
        if (name === 'DrID' && value && !values.AppDetail) {
            setTimeout(() => detailSelectRef.current?.focus(), 0);
        }
    };

    const handleDateTimeSelection = (date: string, time: string): void => {
        setValues(prev => ({ ...prev, AppDate: date, AppTime: time }));
        setValidation(prev => ({ ...prev, AppDate: null, AppTime: null }));

        // Brief rose flash on .selectedTime — compensates for slot feedback being
        // scrolled off-screen on mobile, and ties the slot click to the form
        // readout on PC. Driven via the Web Animations API rather than a CSS
        // @keyframes rule so it plays under prefers-reduced-motion: reduce (a
        // colour-only flash with no positional motion) without needing !important
        // to beat reset.css's blanket reduced-motion override.
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

        // Mobile (<=992px, where columns stack): bring the form into view. On
        // desktop the focus below handles intra-column scrolling.
        if (typeof window !== 'undefined' && window.matchMedia('(max-width: 992px)').matches) {
            formColumnRef.current?.scrollIntoView({ block: 'start' });
        }

        // Focus the next un-filled field.
        setTimeout(() => {
            if (!values.DrID) doctorSelectRef.current?.focus();
            else if (!values.AppDetail) detailSelectRef.current?.focus();
        }, 0);
    };

    const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
        e.preventDefault();
        const errors: ValidationErrors = {};
        if (!values.AppDate) errors.AppDate = t('form.errorSelectDate');
        if (!values.AppTime) errors.AppTime = t('form.errorSelectTime');
        if (!values.DrID) errors.DrID = t('form.errorSelectDoctor');
        if (!values.AppDetail) errors.AppDetail = t('form.errorSelectType');
        setValidation(errors);
        if (Object.keys(errors).length > 0) return;
        onSubmit(values);
    };

    const dateTimeDisplay = values.AppDate && values.AppTime
        ? formatAppointmentDateTime(new Date(`${values.AppDate}T${values.AppTime}`), language)
        : t('form.noTimeSelected');

    return (
        <div className={styles.page}>
            <header className={styles.pageHeader}>
                <div>
                    <h1>
                        <i className={`fas ${isEdit ? 'fa-calendar-edit' : 'fa-calendar-plus'}`}></i>{' '}
                        {isEdit ? t('form.editTitle') : t('form.newTitle')}
                    </h1>
                    <p>{t('form.patientLabel', { id: personId })}</p>
                </div>
                <button
                    type="button"
                    className={styles.closeButton}
                    onClick={onClose}
                    title={t('form.close')}
                    aria-label={t('form.close')}
                >
                    <i className="fas fa-times"></i>
                </button>
            </header>

            <div className={styles.pageContent}>
                {/* Calendar picker (LEFT + MIDDLE columns). Local midnight, never
                    `new Date('YYYY-MM-DD')`: that is UTC, a month early for an
                    appointment on the 1st west of UTC (FE-F10-16). */}
                <SimplifiedCalendarPicker
                    onSelectDateTime={handleDateTimeSelection}
                    initialDate={values.AppDate ? parseLocalDate(values.AppDate) : new Date()}
                />

                {/* RIGHT COLUMN: Form */}
                <div className={styles.formColumn} ref={formColumnRef}>
                    <div className={styles.formHeader}>
                        <h2><i className="fas fa-clipboard-list"></i> {t('form.detailsHeading')}</h2>
                    </div>

                    <form onSubmit={handleSubmit} className={styles.form}>
                        {error && (
                            <div className={cn(styles.alert, styles.alertError)} role="alert">
                                <i className="fas fa-exclamation-circle"></i>
                                <span>{error}</span>
                            </div>
                        )}

                        <div className={styles.formField}>
                            <span><i className="fas fa-calendar-check"></i> {t('form.selectedTime')}</span>
                            <div
                                ref={selectedTimeRef}
                                className={cn(styles.selectedTime, {
                                    [styles.hasValue]: values.AppDate && values.AppTime
                                })}
                            >
                                {dateTimeDisplay}
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
                                value={values.DrID}
                                onChange={handleInputChange}
                                className={validation.DrID ? styles.error : ''}
                            >
                                <option value="">{t('form.selectDoctor')}</option>
                                {doctors.map(doctor => (
                                    <option key={doctor.id} value={doctor.id}>
                                        {doctor.label}
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
                                value={values.AppDetail}
                                onChange={handleInputChange}
                                className={validation.AppDetail ? styles.error : ''}
                            >
                                <option value="">{t('form.selectType')}</option>
                                {details.filter(d => d.id).map(detail => (
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
                                disabled={submitting}
                            >
                                <i className="fas fa-times"></i>
                                {t('form.cancel')}
                            </button>
                            <button
                                type="submit"
                                className="btn btn-create"
                                disabled={submitting}
                            >
                                {submitting ? (
                                    <>
                                        <i className="fas fa-spinner fa-spin"></i>
                                        {isEdit ? t('form.updating') : t('form.creating')}
                                    </>
                                ) : (
                                    <>
                                        <i className={`fas ${isEdit ? 'fa-save' : 'fa-check'}`}></i>
                                        {isEdit ? t('form.update') : t('form.create')}
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

export default BookingForm;
