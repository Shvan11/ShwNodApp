/* V4 — Uniform-height slots, adaptive 2-lane packing,
        drag-to-reschedule, "+N more" popover. */

const { useState: useStateV4, useEffect: useEffectV4, useMemo: useMemoV4, useCallback: useCallbackV4 } = React;

/* ── Colour system ────────────────────────────────────────────
   14 hues stepped at the golden angle (137.5°) so EVERY consecutive
   pair of 30-minute rows sits ~137° apart on the wheel — uniformly
   high contrast, never two similar hues touching. */
const V4_TIME_TINT = {
  '14:00': { row: 'oklch(96% 0.038 220)', label: 'oklch(86% 0.078 220)' }, // blue
  '14:30': { row: 'oklch(96% 0.038 358)', label: 'oklch(86% 0.078 358)' }, // red
  '15:00': { row: 'oklch(96% 0.040 135)', label: 'oklch(86% 0.082 135)' }, // green
  '15:30': { row: 'oklch(96% 0.038 273)', label: 'oklch(86% 0.078 273)' }, // purple
  '16:00': { row: 'oklch(96% 0.040 50)',  label: 'oklch(86% 0.082 50)'  }, // gold
  '16:30': { row: 'oklch(96% 0.040 188)', label: 'oklch(86% 0.082 188)' }, // cyan
  '17:00': { row: 'oklch(96% 0.038 325)', label: 'oklch(86% 0.078 325)' }, // pink
  '17:30': { row: 'oklch(96% 0.040 103)', label: 'oklch(86% 0.082 103)' }, // lime
  '18:00': { row: 'oklch(96% 0.038 240)', label: 'oklch(86% 0.078 240)' }, // indigo
  '18:30': { row: 'oklch(96% 0.040 18)',  label: 'oklch(86% 0.082 18)'  }, // red-orange
  '19:00': { row: 'oklch(96% 0.040 155)', label: 'oklch(86% 0.082 155)' }, // mint
  '19:30': { row: 'oklch(96% 0.038 293)', label: 'oklch(86% 0.078 293)' }, // violet
  '20:00': { row: 'oklch(96% 0.040 70)',  label: 'oklch(86% 0.082 70)'  }, // yellow
  '20:30': { row: 'oklch(96% 0.040 208)', label: 'oklch(86% 0.082 208)' }, // sky
};

const V4_PROC = {
  'Check-up':     'oklch(60% 0.14 250)',
  'Bonding':      'oklch(58% 0.16 305)',
  'Wire change':  'oklch(55% 0.13 175)',
  'Adjustment':   'oklch(56% 0.13 145)',
  'Consultation': 'oklch(64% 0.13 60)',
  'Records':      'oklch(60% 0.15 25)',
  'Extraction':   'oklch(54% 0.18 25)',
  'Retainer fit': 'oklch(60% 0.14 305)',
  'Cleaning':     'oklch(58% 0.13 195)',
  'Debonding':    'oklch(58% 0.14 305)',
  'Emergency':    'oklch(52% 0.20 25)',
  'Separator':    'oklch(56% 0.13 145)',
};
const v4Hue = (p) => V4_PROC[p] || 'oklch(58% 0.13 250)';
const v4Tint = (t) => V4_TIME_TINT[t] || V4_TIME_TINT['14:00'];

/* Single appointment card.  Draggable.
   `keyIdx` is the absolute index inside the original appointment array — so
   drag handlers can find the source after the popover shifts indices. */
function V4Lane({ a, span2, span, dragId, isDragging, onDragStart, onDragEnd }) {
  return (
    <div
      draggable="true"
      className={`v4-lane ${span2 ? 'span2' : ''} ${isDragging ? 'dragging' : ''}`}
      style={{ borderLeftColor: v4Hue(a.p), gridColumn: span }}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragId);
        onDragStart(dragId);
      }}
      onDragEnd={onDragEnd}
      title={`${a.n} — ${a.p}\nDrag to reschedule`}
    >
      <div className="v4-name">{a.n}</div>
      <div className="v4-proc">{a.p}</div>
    </div>
  );
}

const V4Stacked = () => {
  const { TIME_SLOTS, days: initialDays } = window.CAL_DATA;

  // Deep copy the data into state so drag-and-drop can mutate it.
  const [days, setDays] = useStateV4(() =>
    initialDays.map(d => ({
      ...d,
      appts: Object.fromEntries(
        Object.entries(d.appts || {}).map(([k, v]) => [k, v.map(x => ({ ...x }))])
      ),
    }))
  );

  // Track which appointment is currently being dragged.
  // dragId === `${date}|${time}|${index}`.  Index is into the *full* appts array.
  const [draggingId, setDraggingId] = useStateV4(null);
  const [dropTarget, setDropTarget] = useStateV4(null); // {date, time}
  const [popover, setPopover] = useStateV4(null); // {date, time, anchorEl}

  // Live stats reflect the (possibly modified) state.
  const stats = useMemoV4(() => {
    let bookedSlots = 0, totalAppointments = 0;
    days.forEach(d => {
      if (d.isHoliday) return;
      Object.values(d.appts).forEach(arr => {
        if (arr && arr.length) {
          bookedSlots += 1;
          totalAppointments += arr.length;
        }
      });
    });
    const totalSlots = TIME_SLOTS.length * days.filter(d => !d.isHoliday).length;
    const available = totalSlots - bookedSlots;
    const utilization = Math.round((bookedSlots / totalSlots) * 100);
    return { booked: bookedSlots, available, totalSlots, utilization, appointments: totalAppointments };
  }, [days, TIME_SLOTS]);

  /* Move an appointment from one slot to another.  Same-slot drop is a no-op. */
  const reschedule = useCallbackV4((src, dst) => {
    if (src.date === dst.date && src.time === dst.time) return;

    setDays(prev => {
      let appt = null;
      // First pass: pluck the appt from source.
      const phaseOne = prev.map(d => {
        if (d.date !== src.date) return d;
        const arr = (d.appts[src.time] || []).slice();
        appt = arr[src.index];
        if (!appt) return d;
        arr.splice(src.index, 1);
        const newAppts = { ...d.appts };
        if (arr.length === 0) delete newAppts[src.time];
        else newAppts[src.time] = arr;
        return { ...d, appts: newAppts };
      });
      if (!appt) return prev;

      // Second pass: insert at destination.
      return phaseOne.map(d => {
        if (d.date !== dst.date) return d;
        if (d.isHoliday) return d;
        const arr = (d.appts[dst.time] || []).slice();
        arr.push(appt);
        return { ...d, appts: { ...d.appts, [dst.time]: arr } };
      });
    });

    // Close popover on successful reschedule (in case drag started from one).
    setPopover(null);
  }, []);

  /* Click-outside closes the popover. */
  useEffectV4(() => {
    if (!popover) return;
    const handler = (e) => {
      if (e.target.closest('.v4-popover') || e.target.closest('.v4-more-cell')) return;
      setPopover(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [popover]);

  /* Helpers */
  const parseDragId = (id) => {
    const [date, time, idx] = id.split('|');
    return { date, time, index: parseInt(idx, 10) };
  };
  const handleLaneDragStart = (id) => setDraggingId(id);
  const handleLaneDragEnd = () => {
    setDraggingId(null);
    setDropTarget(null);
  };

  /* Slot drop handlers */
  const onSlotDragOver = (date, time, isHoliday) => (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = isHoliday ? 'none' : 'move';
    setDropTarget(prev => (prev && prev.date === date && prev.time === time) ? prev : { date, time, isHoliday });
  };
  const onSlotDrop = (date, time, isHoliday) => (e) => {
    e.preventDefault();
    if (isHoliday) { handleLaneDragEnd(); return; }
    const id = e.dataTransfer.getData('text/plain') || draggingId;
    if (!id) { handleLaneDragEnd(); return; }
    const src = parseDragId(id);
    reschedule(src, { date, time });
    handleLaneDragEnd();
  };

  /* Build slot content */
  const renderSlot = (day, time) => {
    const appts = day.appts[time] || [];
    const n = appts.length;

    const makeLane = (a, idx, opts = {}) => {
      const dragId = `${day.date}|${time}|${idx}`;
      return (
        <V4Lane
          key={idx}
          a={a}
          span2={opts.span2}
          span={opts.span}
          dragId={dragId}
          isDragging={draggingId === dragId}
          onDragStart={handleLaneDragStart}
          onDragEnd={handleLaneDragEnd}
        />
      );
    };

    if (n === 0) {
      return <div className="v4-slot count-0"><span className="v4-empty-mark">＋</span></div>;
    }
    if (n === 1) {
      return <div className="v4-slot count-1">{makeLane(appts[0], 0, { span2: true })}</div>;
    }
    if (n === 2) {
      return (
        <div className="v4-slot count-2">
          {makeLane(appts[0], 0, { span2: true })}
          {makeLane(appts[1], 1, { span2: true })}
        </div>
      );
    }
    if (n === 3) {
      return (
        <div className="v4-slot count-3">
          {makeLane(appts[0], 0)}
          {makeLane(appts[1], 1)}
          {makeLane(appts[2], 2, { span2: true })}
        </div>
      );
    }
    if (n === 4) {
      return (
        <div className="v4-slot count-4">
          {makeLane(appts[0], 0)}
          {makeLane(appts[1], 1)}
          {makeLane(appts[2], 2)}
          {makeLane(appts[3], 3)}
        </div>
      );
    }
    // 5+
    const overflow = n - 3;
    const isPopOpen = popover && popover.date === day.date && popover.time === time;
    return (
      <div className="v4-slot count-many">
        {makeLane(appts[0], 0)}
        {makeLane(appts[1], 1)}
        {makeLane(appts[2], 2)}
        <button
          type="button"
          className={`v4-more-cell ${isPopOpen ? 'open' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            if (isPopOpen) {
              setPopover(null);
            } else {
              setPopover({ date: day.date, time });
            }
          }}
        >
          <span className="v4-more-plus">+{overflow}</span>
          <span className="v4-more-label">more</span>
        </button>
      </div>
    );
  };

  return (
    <div className="v4-root">
      {/* Top bar */}
      <header className="v4-bar">
        <div className="v4-bar-l">
          <div className="v4-title">
            <span className="v4-title-main">May 2026</span>
            <span className="v4-title-sub">Week 21 · Sat 16 – Thu 21</span>
          </div>
          <div className="v4-nav">
            <button className="v4-nav-btn" aria-label="Previous">‹</button>
            <button className="v4-today">Today</button>
            <button className="v4-nav-btn" aria-label="Next">›</button>
          </div>
        </div>
        <div className="v4-bar-r">
          <div className="v4-util-inline">
            <span className="v4-util-pct">{stats.utilization}%</span>
            <span className="v4-util-track"><span className="v4-util-fill" style={{ width: `${stats.utilization}%` }} /></span>
            <span className="v4-util-num"><b>{stats.booked}</b>/<span>{stats.totalSlots}</span> slots</span>
          </div>
          <div className="v4-divider" />
          <div className="v4-seg">
            <button>Day</button>
            <button className="active">Week</button>
            <button>Month</button>
          </div>
          <select className="v4-select"><option>All doctors</option></select>
        </div>
      </header>

      {/* Day headers */}
      <div className="v4-day-headers">
        <div className="v4-time-head"><span>TIME</span></div>
        {days.map(d => {
          const dt = new Date(d.date);
          const total = Object.values(d.appts).reduce((a, b) => a + b.length, 0);
          return (
            <div key={d.date} className={`v4-day-head ${d.isToday ? 'today' : ''} ${d.isHoliday ? 'holiday' : ''}`}>
              <div className="v4-day-row">
                <span className="v4-day-name">{d.dayName.slice(0, 3).toUpperCase()}</span>
                <span className="v4-day-num">{dt.getDate()}</span>
              </div>
              {d.isHoliday
                ? <div className="v4-day-tag holiday">Holiday</div>
                : <div className="v4-day-tag">{total} appt{total === 1 ? '' : 's'}</div>
              }
            </div>
          );
        })}
      </div>

      {/* Grid */}
      <div className="v4-grid">
        <div className="v4-time-col">
          {TIME_SLOTS.map(t => {
            const tint = v4Tint(t);
            return (
              <div key={t} className="v4-time-cell" style={{ background: tint.label }}>
                <span className="v4-time-h">{t.split(':')[0]}</span>
                <span className="v4-time-m">{t.split(':')[1]}</span>
              </div>
            );
          })}
        </div>

        {days.map(d => (
          <div key={d.date} className={`v4-day-col ${d.isToday ? 'today' : ''} ${d.isHoliday ? 'holiday' : ''}`}>
            {d.isHoliday && (
              <div className="v4-holiday-sash">
                <div className="v4-holiday-card">
                  <div className="v4-holiday-eyebrow">Holiday</div>
                  <div className="v4-holiday-name">{d.holidayName}</div>
                  <div className="v4-holiday-note">Clinic closed</div>
                </div>
              </div>
            )}
            {TIME_SLOTS.map(t => {
              const tint = v4Tint(t);
              const isDropTarget = dropTarget && dropTarget.date === d.date && dropTarget.time === t;
              const isPopOpen = popover && popover.date === d.date && popover.time === t;
              return (
                <div
                  key={t}
                  className={`v4-slot-wrap
                    ${isDropTarget ? 'drop-target' : ''}
                    ${isDropTarget && d.isHoliday ? 'drop-forbidden' : ''}
                    ${isPopOpen ? 'pop-open' : ''}`}
                  style={{ background: tint.row }}
                  onDragOver={d.isHoliday ? undefined : onSlotDragOver(d.date, t, d.isHoliday)}
                  onDrop={d.isHoliday ? undefined : onSlotDrop(d.date, t, d.isHoliday)}
                >
                  {!d.isHoliday && renderSlot(d, t)}

                  {isPopOpen && (
                    <V4Popover
                      day={d}
                      time={t}
                      appts={d.appts[t] || []}
                      onClose={() => setPopover(null)}
                      onDragStart={handleLaneDragStart}
                      onDragEnd={handleLaneDragEnd}
                      draggingId={draggingId}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

/* "+N more" popover — lists the appointments hidden behind the badge.
   Each row is itself draggable so it can be rescheduled out of the slot. */
function V4Popover({ day, time, appts, onClose, onDragStart, onDragEnd, draggingId }) {
  const hidden = appts.slice(3);
  return (
    <div
      className="v4-popover"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="v4-popover-head">
        <div>
          <div className="v4-popover-title">{time} · {appts.length} appointments</div>
          <div className="v4-popover-sub">Showing the {hidden.length} hidden — drag to reschedule</div>
        </div>
        <button className="v4-popover-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="v4-popover-list">
        {hidden.map((a, i) => {
          const absIdx = 3 + i;
          const dragId = `${day.date}|${time}|${absIdx}`;
          return (
            <div
              key={i}
              draggable="true"
              className={`v4-popover-row ${draggingId === dragId ? 'dragging' : ''}`}
              style={{ borderLeftColor: v4Hue(a.p) }}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', dragId);
                onDragStart(dragId);
              }}
              onDragEnd={onDragEnd}
            >
              <div className="v4-popover-name">{a.n}</div>
              <div className="v4-popover-proc">{a.p}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

window.V4Stacked = V4Stacked;
