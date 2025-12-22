import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom';

/**
 * SimplifiedCalendarPicker Component - CLEAN REWRITE
 *
 * Three-column layout:
 * LEFT: Monthly calendar
 * MIDDLE: Day schedule (2 slots per row grid)
 * RIGHT: Handled by parent (AppointmentForm)
 */

const SimplifiedCalendarPicker = ({ onSelectDateTime, initialDate = new Date() }) => {
    const [currentMonth, setCurrentMonth] = useState(new Date(initialDate));
    const [selectedDate, setSelectedDate] = useState(null);
    const [availableSlots, setAvailableSlots] = useState([]);
    const [dayAvailability, setDayAvailability] = useState({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [showAfternoonSlots, setShowAfternoonSlots] = useState(false);
    const [daysAhead, setDaysAhead] = useState('');

    // Rarely-used afternoon times
    const rareAfternoonTimes = ['12:00', '12:30', '13:00', '13:30', '14:00', '14:30'];

    // Fetch month availability
    const fetchMonthAvailability = useCallback(async (monthDate) => {
        try {
            setLoading(true);
            const year = monthDate.getFullYear();
            const month = monthDate.getMonth();
            const firstDay = new Date(year, month, 1);
            const lastDay = new Date(year, month + 1, 0);

            // Format dates in local timezone to avoid UTC conversion issues
            const formatLocalDate = (date) => {
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
            };

            const response = await fetch(
                `/api/calendar/month-availability?` +
                `startDate=${formatLocalDate(firstDay)}&` +
                `endDate=${formatLocalDate(lastDay)}`
            );

            if (!response.ok) throw new Error('Failed to fetch availability');
            const data = await response.json();

            if (data.success) {
                setDayAvailability(data.availability || {});
            }
        } catch (err) {
            console.error('Error fetching month availability:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    // Fetch slots for selected date
    const fetchAvailableSlots = useCallback(async (date) => {
        try {
            setLoading(true);
            // Format date without timezone conversion
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;
            const response = await fetch(`/api/calendar/available-slots?date=${dateStr}`);

            if (!response.ok) throw new Error('Failed to fetch slots');
            const data = await response.json();

            if (data.success) {
                const slots = data.slots || [];
                setAvailableSlots(slots);

                // Auto-expand afternoon slots if any have appointments
                const afternoonWithAppointments = slots.some(slot =>
                    rareAfternoonTimes.includes(slot.time) &&
                    slot.appointments &&
                    slot.appointments.length > 0
                );
                setShowAfternoonSlots(afternoonWithAppointments);
            }
        } catch (err) {
            console.error('Error fetching slots:', err);
            setError(err.message);
            setAvailableSlots([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchMonthAvailability(currentMonth);
    }, [currentMonth, fetchMonthAvailability]);

    const handleDateClick = (date) => {
        setSelectedDate(date);
        fetchAvailableSlots(date);
    };

    const handleSlotClick = (slot) => {
        const dateTime = new Date(`${slot.date}T${slot.time}:00`);
        onSelectDateTime(dateTime);
    };

    const goToPreviousMonth = () => {
        setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
        setSelectedDate(null);
        setAvailableSlots([]);
        setShowAfternoonSlots(false);
    };

    const goToNextMonth = () => {
        setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
        setSelectedDate(null);
        setAvailableSlots([]);
        setShowAfternoonSlots(false);
    };

    const goToToday = () => {
        const today = new Date();
        setCurrentMonth(new Date(today.getFullYear(), today.getMonth(), 1));
        handleDateClick(today);
    };

    const handleJumpToDays = () => {
        const days = parseInt(daysAhead);
        if (!isNaN(days) && days >= 0) {
            const targetDate = new Date();
            targetDate.setDate(targetDate.getDate() + days);
            setCurrentMonth(new Date(targetDate.getFullYear(), targetDate.getMonth(), 1));
            handleDateClick(targetDate);
            setDaysAhead(''); // Clear input after jump
        }
    };

    // Generate calendar days
    const generateCalendarDays = () => {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startDay = firstDay.getDay(); // 0 = Sunday, 6 = Saturday
        const daysInMonth = lastDay.getDate();
        const days = [];

        // Adjust start to Saturday (6) - if Saturday, offset is 0, if Sunday, offset is 1, etc.
        const offset = (startDay + 1) % 7;
        for (let i = 0; i < offset; i++) {
            days.push(null);
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const dayOfWeek = date.getDay(); // 0 = Sunday, 5 = Friday

            // Skip Friday (5)
            if (dayOfWeek === 5) {
                continue;
            }

            // Format date in local timezone
            const dateYear = date.getFullYear();
            const dateMonth = String(date.getMonth() + 1).padStart(2, '0');
            const dateDay = String(date.getDate()).padStart(2, '0');
            const dateStr = `${dateYear}-${dateMonth}-${dateDay}`;
            const availability = dayAvailability[dateStr] || { availableCount: 0, appointmentCount: 0 };
            const isPast = date < new Date(new Date().setHours(0, 0, 0, 0));
            const isToday = date.toDateString() === new Date().toDateString();
            const isSelected = selectedDate && date.toDateString() === selectedDate.toDateString();
            const hasAvailability = availability.availableCount > 0;
            const appointmentCount = availability.appointmentCount || 0;
            const isHoliday = availability.isHoliday || false;
            const holidayName = availability.holidayName || null;

            days.push({
                date,
                day,
                dateStr,
                isPast,
                isToday,
                isSelected,
                hasAvailability,
                availableCount: availability.availableCount,
                appointmentCount: appointmentCount,
                isHoliday,
                holidayName
            });
        }

        return days;
    };

    const calendarDays = generateCalendarDays();
    const monthNumber = currentMonth.getMonth() + 1;
    const monthNameOnly = currentMonth.toLocaleDateString('en-US', { month: 'long' });
    const year = currentMonth.getFullYear();
    const monthName = `${monthNumber}/${year}`;

    return (
        <div className="calendar-picker-container">
            {/* LEFT COLUMN: Monthly Calendar */}
            <div className="calendar-column">
                {/* Jump to Days Ahead */}
                <div className="jump-to-days">
                    <input
                        type="number"
                        min="0"
                        placeholder="Days ahead..."
                        value={daysAhead}
                        onChange={(e) => setDaysAhead(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleJumpToDays()}
                        className="days-ahead-input"
                    />
                    <button className="jump-btn" onClick={handleJumpToDays} title="Jump to date">
                        <i className="fas fa-arrow-right"></i>
                    </button>
                </div>

                {/* View Full Calendar Button */}
                <Link to="/calendar" className="full-calendar-link">
                    <i className="fas fa-calendar-alt"></i> Full Calendar
                </Link>

                <div className="calendar-header">
                    <button className="month-nav-btn" onClick={goToPreviousMonth}>
                        <i className="fas fa-chevron-left"></i>
                    </button>
                    <div className="month-display">
                        <h3 className="month-name">{monthName}</h3>
                        <div className="month-name-text">{monthNameOnly}</div>
                    </div>
                    <button className="month-nav-btn" onClick={goToNextMonth}>
                        <i className="fas fa-chevron-right"></i>
                    </button>
                </div>

                <div className="calendar-weekdays">
                    {['S', 'S', 'M', 'T', 'W', 'T'].map((day, i) => (
                        <div key={i} className="weekday">{day}</div>
                    ))}
                </div>

                <div className="calendar-days">
                    {calendarDays.map((dayInfo, index) => {
                        if (!dayInfo) {
                            return <div key={`empty-${index}`} className="calendar-day empty"></div>;
                        }

                        // Holiday days are not clickable
                        const isClickable = !dayInfo.isPast && dayInfo.hasAvailability && !dayInfo.isHoliday;

                        const classes = [
                            'calendar-day',
                            dayInfo.isPast && 'past',
                            dayInfo.isToday && 'today',
                            dayInfo.isSelected && 'selected',
                            dayInfo.isHoliday && 'holiday',
                            dayInfo.hasAvailability && !dayInfo.isHoliday && 'has-slots',
                            isClickable && 'clickable'
                        ].filter(Boolean).join(' ');

                        // Build tooltip
                        let tooltip = '';
                        if (dayInfo.isHoliday) {
                            tooltip = dayInfo.holidayName || 'Holiday';
                        } else if (dayInfo.appointmentCount > 0) {
                            tooltip = `${dayInfo.appointmentCount} appointments`;
                        } else {
                            tooltip = 'No appointments';
                        }

                        return (
                            <div
                                key={dayInfo.dateStr}
                                className={classes}
                                onClick={() => isClickable && handleDateClick(dayInfo.date)}
                                title={tooltip}
                            >
                                <span className="day-num">{dayInfo.day}</span>
                                {dayInfo.isHoliday && (
                                    <span className="holiday-indicator"><i className="fas fa-star"></i></span>
                                )}
                                {dayInfo.appointmentCount > 0 && !dayInfo.isPast && !dayInfo.isHoliday && (
                                    <span className="slot-count">{dayInfo.appointmentCount}</span>
                                )}
                            </div>
                        );
                    })}
                </div>

                <button className="today-btn" onClick={goToToday}>
                    <i className="fas fa-calendar-day"></i> Today
                </button>
            </div>

            {/* MIDDLE COLUMN: Day Schedule */}
            <div className="schedule-column">
                {!selectedDate ? (
                    <div className="empty-state">
                        <i className="fas fa-hand-pointer"></i>
                        <p>Select a date to view available time slots</p>
                    </div>
                ) : loading ? (
                    <div className="empty-state">
                        <i className="fas fa-spinner fa-spin"></i>
                        <p>Loading...</p>
                    </div>
                ) : error ? (
                    <div className="empty-state error">
                        <i className="fas fa-exclamation-triangle"></i>
                        <p>{error}</p>
                    </div>
                ) : availableSlots.length === 0 ? (
                    <div className="empty-state">
                        <i className="fas fa-calendar-times"></i>
                        <p>No slots for this date</p>
                    </div>
                ) : (
                    <>
                        <div className="schedule-header">
                            <h3>
                                {selectedDate.toLocaleDateString('en-US', {
                                    weekday: 'long',
                                    month: 'short',
                                    day: 'numeric'
                                })}
                            </h3>
                            <span className="available-count">
                                {availableSlots.filter(s => s.slotStatus === 'available' || s.slotStatus === 'booked').length} available
                            </span>
                        </div>

                        <div className="slots-grid">
                            {(() => {
                                // Separate slots into regular and afternoon slots
                                const regularSlots = [];
                                const afternoonSlots = [];
                                const emptyAfternoonSlots = [];

                                availableSlots.forEach(slot => {
                                    if (rareAfternoonTimes.includes(slot.time)) {
                                        afternoonSlots.push(slot);
                                        // Check if slot is empty (no appointments)
                                        if (!slot.appointments || slot.appointments.length === 0) {
                                            emptyAfternoonSlots.push(slot);
                                        }
                                    } else {
                                        regularSlots.push(slot);
                                    }
                                });

                                const hasEmptyAfternoonSlots = emptyAfternoonSlots.length > 0;

                                const renderSlot = (slot) => {
                                    const isAvailable = slot.slotStatus === 'available';
                                    const isBooked = slot.slotStatus === 'booked';
                                    const isFull = slot.slotStatus === 'full';
                                    const isPast = slot.slotStatus === 'past';
                                    const canBook = isAvailable || isBooked;

                                    const slotClasses = [
                                        'time-slot',
                                        isAvailable && 'available',
                                        isBooked && 'booked',
                                        isFull && 'full',
                                        isPast && 'past',
                                        canBook && 'clickable'
                                    ].filter(Boolean).join(' ');

                                    return (
                                        <div
                                            key={slot.time}
                                            className={slotClasses}
                                            onClick={() => canBook && handleSlotClick(slot)}
                                        >
                                            <div className="slot-header">
                                                <span className="slot-time">{slot.time}</span>
                                            </div>

                                            {slot.appointments && slot.appointments.length > 0 ? (
                                                <div className="slot-appointments">
                                                    {slot.appointments.map((apt, idx) => (
                                                        <div key={idx} className="apt-item">
                                                            <div className="apt-name">{apt.patientName}</div>
                                                            <div className="apt-type">{apt.appDetail}</div>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="slot-empty">
                                                    <i className="fas fa-check-circle"></i> Available
                                                </div>
                                            )}
                                        </div>
                                    );
                                };

                                return (
                                    <>
                                        {hasEmptyAfternoonSlots && (
                                            <div
                                                className="afternoon-toggle"
                                                onClick={() => setShowAfternoonSlots(!showAfternoonSlots)}
                                            >
                                                <div className="afternoon-toggle-text">
                                                    <i className="fas fa-clock"></i>
                                                    {showAfternoonSlots ? 'Hide' : 'Show'} afternoon slots (12:00 - 2:30 PM)
                                                </div>
                                                <i className={`fas fa-chevron-down afternoon-toggle-icon ${showAfternoonSlots ? 'expanded' : ''}`}></i>
                                            </div>
                                        )}

                                        {showAfternoonSlots && afternoonSlots.map(renderSlot)}

                                        {regularSlots.map(renderSlot)}

                                        {!hasEmptyAfternoonSlots && afternoonSlots.map(renderSlot)}
                                    </>
                                );
                            })()}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default SimplifiedCalendarPicker;
