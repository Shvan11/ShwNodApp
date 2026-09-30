/**
 * CalendarHeader Component for Appointment Calendar
 *
 * The redesigned v4 toolbar: two-line title + navigation on the left,
 * utilisation strip + view segmented control + doctor filter on the right.
 */

import DoctorFilter from './DoctorFilter';
import type { CalendarStats, ViewMode } from './calendar.types';

interface CalendarHeaderProps {
    titleMain: string;
    titleSub: string;
    onPreviousWeek: () => void;
    onNextWeek: () => void;
    onTodayClick: () => void;
    viewMode: ViewMode;
    onViewModeChange: (mode: ViewMode) => void;
    calendarStats: CalendarStats | null;
    /** A read is in flight. The previous data stays on screen meanwhile, and
     *  nothing here is disabled: the zoom slider used to be disabled, then
     *  unmounted, under the pointer mid-drag (audit FE-F10-4). */
    fetching: boolean;
    selectedDoctorId: number | null;
    onDoctorChange: (doctorId: number | null) => void;
    /* Density-zoom (week/day grid only — Month has its own layout). The slider +
       buttons set how many day-columns N fill the grid; − = fewer days (zoom in,
       bigger cells), + = more days (zoom out). Fit auto-fills the screen. */
    showZoom: boolean;
    dayCount: number;
    minDayCount: number;
    maxDayCount: number;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onZoomSlider: (n: number) => void;
    onZoomFit: () => void;
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
    fetching,
    selectedDoctorId,
    onDoctorChange,
    showZoom,
    dayCount,
    minDayCount,
    maxDayCount,
    onZoomIn,
    onZoomOut,
    onZoomSlider,
    onZoomFit
}: CalendarHeaderProps) => {
    // The server keeps two decimals ("33.33"); the strip shows a whole percent.
    const utilization = Math.round(calendarStats?.utilizationPercent ?? 0);

    return (
        <header className="cal-bar">
            <div className="cal-bar-l">
                <div className="cal-title" aria-busy={fetching}>
                    <span className="cal-title-main">
                        {titleMain}
                        {fetching && (
                            <i className="fas fa-circle-notch fa-spin cal-fetching" aria-hidden="true"></i>
                        )}
                    </span>
                    {titleSub && <span className="cal-title-sub">{titleSub}</span>}
                </div>
                <div className="cal-nav">
                    <button
                        type="button"
                        className="cal-nav-btn"
                        onClick={onPreviousWeek}
                        aria-label="Previous"
                        title="Previous"
                    >
                        ‹
                    </button>
                    <button
                        type="button"
                        className="cal-today"
                        onClick={onTodayClick}
                        title="Go to today"
                    >
                        Today
                    </button>
                    <button
                        type="button"
                        className="cal-nav-btn"
                        onClick={onNextWeek}
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
                                role="tab"
                            aria-selected={viewMode === mode}
                            title={`${label} View`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {showZoom && (
                    <>
                        <div className="cal-divider" />
                        <div className="cal-zoom" role="group" aria-label="Calendar zoom">
                            <button
                                type="button"
                                className="cal-zoom-btn"
                                onClick={onZoomIn}
                                disabled={dayCount <= minDayCount}
                                aria-label="Zoom in — fewer days"
                                title="Fewer days"
                            >
                                −
                            </button>
                            <input
                                type="range"
                                className="cal-zoom-slider"
                                min={minDayCount}
                                max={maxDayCount}
                                value={dayCount}
                                onChange={e => onZoomSlider(Number(e.target.value))}
                                        aria-label="Days shown"
                                title={`${dayCount} day${dayCount === 1 ? '' : 's'} shown`}
                            />
                            <button
                                type="button"
                                className="cal-zoom-btn"
                                onClick={onZoomOut}
                                disabled={dayCount >= maxDayCount}
                                aria-label="Zoom out — more days"
                                title="More days"
                            >
                                +
                            </button>
                            <span className="cal-zoom-readout">
                                {dayCount}<span className="cal-zoom-unit">d</span>
                            </span>
                            <button
                                type="button"
                                className="cal-zoom-fit"
                                onClick={onZoomFit}
                                        title="Fit all time rows on screen"
                            >
                                Fit
                            </button>
                        </div>
                    </>
                )}

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
