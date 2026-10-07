import { useState } from 'react';
import { useConfirm } from '../../contexts/ConfirmContext';
import LookupEditor from './LookupEditor';
import type { LookupFormData, LookupItem } from './LookupEditorModal';
import Modal from './Modal';
import ModalHeader from './ModalHeader';
import { formatLocaleDate, formatLocaleTime } from '../../utils/formatters';
import { formatISODate } from '../../core/utils';
import { fetchJSON, httpErrorMessage } from '@/core/http';
import * as holiday from '@shared/contracts/holiday.contract';
import type { LookupColumn } from '@shared/contracts/lookup-admin.contract';

type AppointmentsOnDate = holiday.AppointmentsOnDateResponse;

interface AppointmentWarning {
    date: string;
    appointments: AppointmentsOnDate['appointments'];
    count: number;
    /** Settles the save that is waiting on this warning. */
    resolve: (proceed: boolean) => void;
}

interface HolidayEditorProps {
    tableKey: string;
    tableName: string;
    columns: LookupColumn[];
    idColumn: string;
}

const formatDate = (date: string): string =>
    formatLocaleDate(date, { year: 'numeric', month: 'short', day: 'numeric' }) || date;

/**
 * The holidays table: the generic LookupEditor plus one check — before a holiday
 * lands on a day, the staff see that day's appointments (a holiday does not cancel
 * them). The check runs for a new holiday AND for an edit that moves the date: an
 * edit used to skip it ("the date can't change"), though the date is editable, and
 * a failed check used to save as if the day were empty (audit FE-F21-7).
 */
const HolidayEditor = ({ tableKey, tableName, columns, idColumn }: HolidayEditorProps) => {
    const confirm = useConfirm();
    const [warning, setWarning] = useState<AppointmentWarning | null>(null);

    const settleWarning = (proceed: boolean): void => {
        warning?.resolve(proceed);
        setWarning(null);
    };

    const beforeSave = async (data: LookupFormData, editingItem: LookupItem | null): Promise<boolean> => {
        const date = typeof data.holiday_date === 'string' ? data.holiday_date : '';
        if (!date) return true;
        // An edit that keeps its date changes nothing about that day.
        if (editingItem && formatISODate(editingItem.holiday_date as string | null | undefined) === date) return true;

        let found: AppointmentsOnDate;
        try {
            found = await fetchJSON<AppointmentsOnDate>(
                `/api/holidays/appointments-on-date?date=${encodeURIComponent(date)}`,
                { schema: holiday.appointmentsOnDate.response }
            );
        } catch (err) {
            return confirm(
                `Couldn't check the appointments on ${formatDate(date)} (${httpErrorMessage(err, 'request failed')}). Save the holiday anyway?`,
                { title: 'Appointments not checked', confirmText: 'Save anyway' }
            );
        }
        if (!found.count) return true;

        return new Promise<boolean>((resolve) => {
            setWarning({ date, appointments: found.appointments ?? [], count: found.count, resolve });
        });
    };

    return (
        <div className="holiday-editor">
            <LookupEditor
                tableKey={tableKey}
                tableName={tableName}
                columns={columns}
                idColumn={idColumn}
                beforeSave={beforeSave}
                deleteNote="This will allow appointments on this date again."
                labels={{
                    add: 'Add Holiday',
                    search: 'Search holidays...',
                    empty: 'No holidays defined',
                    noun: 'holidays',
                }}
            />

            {/* Appointment Warning Modal */}
            <Modal
                isOpen={warning !== null}
                onClose={() => settleWarning(false)}
                contentClassName="modal-content"
                overlayClassName="appointment-warning-modal"
                ariaLabelledBy="appt-warning-modal-title"
            >
                {warning && (
                    <>
                        <ModalHeader
                            variant="warning"
                            title="Existing Appointments Found"
                            titleId="appt-warning-modal-title"
                            icon={<i className="fas fa-exclamation-triangle" aria-hidden="true" />}
                            onClose={() => settleWarning(false)}
                        />
                        <div className="modal-body">
                            <p className="warning-text">
                                There are <strong>{warning.count}</strong> appointment(s)
                                scheduled on <strong>{formatDate(warning.date)}</strong>.
                            </p>
                            <p className="warning-subtext">
                                Making this date a holiday will NOT automatically cancel these appointments.
                                You may need to contact these patients to reschedule:
                            </p>
                            <div className="appointment-list">
                                {warning.appointments.slice(0, 10).map((apt, idx) => (
                                    <div key={idx} className="appointment-item">
                                        <span className="patient-name">
                                            <i className="fas fa-user" aria-hidden="true"></i>
                                            {apt.patient_name}
                                        </span>
                                        <span className="appointment-detail">{apt.app_detail}</span>
                                        <span className="appointment-time">
                                            {formatLocaleTime(apt.app_date, { hour: 'numeric', minute: '2-digit' })}
                                        </span>
                                    </div>
                                ))}
                                {warning.count > 10 && (
                                    <div className="appointment-item more-items">
                                        <span>... and {warning.count - 10} more</span>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => settleWarning(false)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn btn-warning"
                                onClick={() => settleWarning(true)}
                            >
                                <i className="fas fa-calendar-times" aria-hidden="true"></i>
                                Save Holiday Anyway
                            </button>
                        </div>
                    </>
                )}
            </Modal>
        </div>
    );
};

export default HolidayEditor;
