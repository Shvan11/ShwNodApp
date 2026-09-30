/**
 * The calendar grid is built from the appointments, not the `calendar` slot table
 * (audit FE-F10-2). These pin the four ways a real appointment used to drop out
 * of the grid — a past day, a walk-in's arrival minute, a hidden early/late row
 * and a time deleted after booking — plus the clinic-wide `full` rule, and the
 * month-end overflow from the 29th–31st (FE-F10-5).
 */
import { describe, expect, it, vi } from 'vitest';

// The service's two DB-touching helpers are not under test; keep the DB layer out.
vi.mock('../database/queries/options-queries.js', () => ({ getOption: vi.fn(), getOptions: vi.fn() }));
vi.mock('../database/queries/calendar-queries.js', () => ({
  ensureCalendarRange: vi.fn(),
  fillCalendar: vi.fn(),
}));

const { buildGridDays, buildMonthDays, getMonthEnd, getMonthStart, getCalendarGridEnd } =
  await import('./CalendarViewService.js');

type Row = Parameters<typeof buildGridDays>[0]['appointments'][number];
const appt = (id: number, slotDateTime: string, dr_id: number | null = 3): Row => ({
  appointment_id: id,
  person_id: 100 + id,
  dr_id,
  app_detail: 'Follow Up',
  patient_name: `Patient ${id}`,
  slotDateTime,
});

// Sat 2026-09-26 .. Thu 2026-10-01 (Fri 2026-10-02 is outside); "now" = Tue 29th 12:00.
const NOW = new Date(2026, 8, 29, 12, 0, 0);
const base = {
  start: '2026-09-26',
  end: '2026-10-01',
  doctorId: null,
  configuredTimes: ['10:00', '10:30', '11:00', '20:00', '20:30'],
  hiddenTimes: new Set(['20:00', '20:30']),
  maxAppointmentsPerSlot: 2,
  holidayMap: new Map(),
  now: NOW,
};

describe('buildGridDays', () => {
  it('has a column for every working day in the span, past ones included, and no Friday', () => {
    const { days } = buildGridDays({ ...base, start: '2026-09-24', end: '2026-10-03', appointments: [] });
    expect(days.map((d) => d.date)).toEqual([
      '2026-09-24', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-03',
    ]);
    expect(days[0].dayName).toBe('Thursday');
    expect(days[1]).toMatchObject({ dayName: 'Saturday', dayOfWeek: 7 });
  });

  it('shows a past day and a walk-in at an off-slot minute', () => {
    const { days, timeSlots } = buildGridDays({
      ...base,
      appointments: [appt(1, '2026-09-27 10:00:00'), appt(2, '2026-09-29 15:07:23')],
    });
    expect(timeSlots).toEqual(['10:00', '10:30', '11:00', '15:07']);
    expect(days.find((d) => d.date === '2026-09-27')?.appointments['10:00'].appointments).toHaveLength(1);
    const walkIn = days.find((d) => d.date === '2026-09-29')?.appointments['15:07'];
    expect(walkIn?.appointments[0]).toMatchObject({ appointment_id: 2, time: '15:07', personID: 102 });
  });

  it('renders an appointment in a hidden early/late row, and at a deleted time', () => {
    const { timeSlots } = buildGridDays({
      ...base,
      appointments: [appt(1, '2026-10-01 20:30:00'), appt(2, '2026-10-01 18:15:00')],
    });
    expect(timeSlots).toContain('20:30'); // hidden row, but booked
    expect(timeSlots).not.toContain('20:00'); // hidden row, empty
    expect(timeSlots).toContain('18:15'); // not a configured time at all
  });

  it('marks a slot full on the CLINIC-wide count even when filtered to one doctor', () => {
    const { days } = buildGridDays({
      ...base,
      doctorId: 3,
      appointments: [appt(1, '2026-09-30 10:00:00', 3), appt(2, '2026-09-30 10:00:00', 5), appt(3, '2026-09-30 10:30:00', 5)],
    });
    const wed = days.find((d) => d.date === '2026-09-30');
    expect(wed?.appointments['10:00']).toMatchObject({ slotStatus: 'full', appointmentCount: 1 });
    // doctor 5's 10:30 is hidden by the filter; the slot stays available (1 < 2)
    expect(wed?.appointments['10:30']).toMatchObject({ slotStatus: 'available', appointmentCount: 0 });
  });

  it('marks past cells past, and keeps holidays out of the stats', () => {
    const holidayMap = new Map([['2026-10-01', { id: 1, holiday_date: '2026-10-01', holiday_name: 'Holiday', description: '' }]]);
    const { days, stats } = buildGridDays({
      ...base,
      holidayMap,
      appointments: [appt(1, '2026-09-30 11:00:00'), appt(2, '2026-10-01 10:00:00')],
    });
    expect(days.find((d) => d.date === '2026-09-26')?.appointments['10:00'].slotStatus).toBe('past');
    expect(days.find((d) => d.date === '2026-10-01')).toMatchObject({ isHoliday: true, holidayName: 'Holiday' });
    // 5 non-holiday days × 3 visible configured rows
    expect(stats).toMatchObject({ totalSlots: 15, bookedSlots: 1, weekStart: '2026-09-26', weekEnd: '2026-10-01' });
    expect(stats.pastSlots + stats.availableSlots + stats.bookedSlots).toBe(15);
  });
});

describe('buildMonthDays', () => {
  it('counts every appointment of the day, whatever its time, and follows the doctor filter', () => {
    const { days } = buildMonthDays({
      gridStart: '2026-09-26',
      gridEnd: '2026-10-01',
      monthStart: '2026-09-01',
      monthEnd: '2026-09-30',
      appointments: [appt(1, '2026-09-30 10:00:00', 3), appt(2, '2026-09-30 15:07:00', 3), appt(3, '2026-09-30 10:00:00', 5)],
      doctorId: 3,
      configuredTimes: base.configuredTimes,
      maxAppointmentsPerSlot: 2,
      holidayMap: new Map(),
      now: NOW,
    });
    const wed = days.find((d) => d.date === '2026-09-30');
    expect(wed?.appointmentCount).toBe(2);
    expect(wed?.appointments.map((a) => a.time)).toEqual(['10:00', '15:07']);
    // 10:00 is full clinic-wide (2 of 2), so 4 of the 5 configured slots stay open
    expect(wed).toMatchObject({ totalSlots: 5, bookedSlots: 1, availableSlots: 4 });
  });

  it("returns the month's own stats: its days only, the visible rows, the doctor filter (FE-F10-6)", () => {
    const holidayMap = new Map([['2026-09-28', { id: 1, holiday_date: '2026-09-28', holiday_name: 'Holiday', description: '' }]]);
    const { stats } = buildMonthDays({
      // The grid spills into October; the stats must not.
      gridStart: '2026-09-26',
      gridEnd: '2026-10-01',
      monthStart: '2026-09-01',
      monthEnd: '2026-09-30',
      appointments: [
        appt(1, '2026-09-30 10:00:00', 3),
        appt(2, '2026-09-30 10:30:00', 5), // another doctor: not booked for doctor 3
        appt(3, '2026-10-01 10:00:00', 3), // next month
        appt(4, '2026-09-30 20:00:00', 3), // hidden row: not a capacity slot
      ],
      doctorId: 3,
      configuredTimes: base.configuredTimes,
      hiddenTimes: base.hiddenTimes,
      maxAppointmentsPerSlot: 2,
      holidayMap,
      now: NOW,
    });
    // Sep 26, 27, 29, 30 (28 is a holiday) × 3 visible rows
    expect(stats).toMatchObject({ weekStart: '2026-09-01', weekEnd: '2026-09-30', totalSlots: 12, bookedSlots: 1 });
    expect(stats.pastSlots + stats.availableSlots + stats.bookedSlots).toBe(12);
    expect(stats.utilizationPercent).toBe(8.33);
  });
});

describe('month boundaries', () => {
  it('never overflow from the 29th–31st', () => {
    expect(getMonthEnd(new Date(2026, 9, 31))).toBe('2026-10-31');
    expect(getMonthEnd(new Date(2026, 0, 31))).toBe('2026-01-31');
    expect(getMonthEnd(new Date(2028, 1, 29))).toBe('2028-02-29');
    expect(getMonthStart(new Date(2026, 2, 31))).toBe('2026-03-01');
    expect(getCalendarGridEnd(new Date(2026, 9, 31))).toBe('2026-11-05');
  });
});
