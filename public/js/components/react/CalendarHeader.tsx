/**
 * CalendarHeader Component for Appointment Calendar
 *
 * The redesigned v4 toolbar: two-line title + navigation on the left,
 * utilisation strip + view segmented control + doctor filter on the right.
 */

import DoctorFilter from './DoctorFilter';

type ViewMode = 'day' | 'week' | 'month';

interface CalendarStats {
    utilizationPercent: number;
    availableSlots: number;
    bookedSlots: number;
    totalSlots: number;
}

interface CalendarHeaderProps {
    titleMain: string;
    titleSub: string;
    onPreviousWeek: () => void;
    onNextWeek: () => void;
    onTodayClick: () => void;
    viewMode: ViewMode;
    onViewModeChange: (mode: ViewMode) => void;
    calendarStats: CalendarStats | null;
    loading: boolean;
    selectedDoctorId: number | null;
    onDoctorChange: (doctorId: number | null) => void;
}

const viewModes: Array<[ViewMode, string]> = [
    ['day', 'Day'],
    ['week', 'Week'],
    ['month', 'Month']
];

const CalendarHeader = ({
    titleMain,
    titleSub,
    onPreviousWeek,
    onNextWeek,
    onTodayClick,
    viewMode,
    onViewModeChange,
    calendarStats,
    loading,
    selectedDoctorId,
    onDoctorChange
}: CalendarHeaderProps) => {
    const utilization = calendarStats?.utilizationPercent ?? 0;

    return (
        <header className="cal-bar">
            <div className="cal-bar-l">
                <div className="cal-title">
                    <span className="cal-title-main">{titleMain}</span>
                    {titleSub && <span className="cal-title-sub">{titleSub}</span>}
                </div>
                <div className="cal-nav">
                    <button
                        type="button"
                        className="cal-nav-btn"
                        onClick={onPreviousWeek}
                        disabled={loading}
                        aria-label="Previous"
                        title="Previous"
                    >
                        ‹
                    </button>
                    <button
                        type="button"
                        className="cal-today"
                        onClick={onTodayClick}
                        disabled={loading}
                        title="Go to today"
                    >
                        Today
                    </button>
                    <button
                        type="button"
                        className="cal-nav-btn"
                        onClick={onNextWeek}
                        disabled={loading}
                        aria-label="Next"
                        title="Next"
                    >
                        ›
                    </button>
                </div>
            </div>

            <div className="cal-bar-r">
                {calendarStats && (
                    <div
                        className="cal-util-inline"
                        title={`${utilization}% of available slots are booked`}
                    >
                        <span className="cal-util-pct">{utilization}%</span>
                        <span className="cal-util-track">
                            <span
                                className="cal-util-fill"
                                style={{ width: `${utilization}%` }}
                            />
                        </span>
                        <span className="cal-util-num">
                            <b>{calendarStats.bookedSlots}</b>/
                            <span>{calendarStats.totalSlots}</span> slots
                        </span>
                    </div>
                )}

                <div className="cal-divider" />

                <div
                    className="cal-seg"
                    role="tablist"
                    aria-label="Calendar view mode"
                >
                    {viewModes.map(([mode, label]) => (
                        <button
                            key={mode}
                            type="button"
                            className={viewMode === mode ? 'active' : ''}
                            onClick={() => onViewModeChange(mode)}
                            disabled={loading}
                            role="tab"
                            aria-selected={viewMode === mode}
                            title={`${label} View`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                <DoctorFilter
                    selectedDoctorId={selectedDoctorId}
                    onDoctorChange={onDoctorChange}
                    className="header-doctor-filter"
                />
            </div>
        </header>
    );
};

export default CalendarHeader;
