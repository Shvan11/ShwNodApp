/* V0 — Current design, rebuilt faithfully from the live app.
   Baseline reference so improvements can be compared like-for-like. */
const { useMemo } = React;

const V0Current = () => {
  const { TIME_SLOTS, days } = window.CAL_DATA;
  const stats = window.CAL_DATA.totals();

  return (
    <div className="v0-root">
      {/* Calendar Header (gradient bar) */}
      <div className="v0-header">
        <div className="v0-nav">
          <button className="v0-today">This Week</button>
          <button className="v0-navbtn">‹</button>
          <h2 className="v0-week-text">Week of May 16 – May 21, 2026</h2>
          <button className="v0-navbtn">›</button>
        </div>

        <div className="v0-view-controls">
          <div className="v0-view-toggle">
            <button>Day</button>
            <button className="active">Week</button>
            <button>Month</button>
          </div>
          <select className="v0-doctor">
            <option>All Doctors</option>
          </select>
          <button className="v0-early-toggle">
            <span>⏱</span>Show Early & Late Slots
          </button>
        </div>

        <div className="v0-stats">
          <div className="v0-stat v0-stat-util">
            <span className="v0-stat-label">Utilization</span>
            <span className="v0-stat-value">{stats.utilization}%</span>
          </div>
          <div className="v0-stat v0-stat-avail">
            <span className="v0-stat-label">Available</span>
            <span className="v0-stat-value">{stats.available}</span>
          </div>
          <div className="v0-stat v0-stat-book">
            <span className="v0-stat-label">Booked</span>
            <span className="v0-stat-value">{stats.booked}</span>
          </div>
          <div className="v0-stat v0-stat-total">
            <span className="v0-stat-label">Total</span>
            <span className="v0-stat-value">{stats.totalSlots}</span>
          </div>
        </div>
      </div>

      {/* Day header row */}
      <div className="v0-day-headers">
        <div className="v0-time-label">Time</div>
        {days.map(d => {
          const dt = new Date(d.date);
          const text = `${d.dayName} ${dt.getDate()}/${dt.getMonth() + 1}`;
          const total = Object.values(d.appts).reduce((a, b) => a + b.length, 0);
          return (
            <div
              key={d.date}
              className={`v0-day-head ${d.isToday ? 'today' : ''} ${d.isHoliday ? 'holiday' : ''}`}
            >
              <div className="v0-day-date">{text}</div>
              {d.isHoliday ? (
                <div className="v0-day-pill v0-day-pill-holiday">✕</div>
              ) : total > 0 ? (
                <div className="v0-day-pill">{total}</div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Grid */}
      <div className="v0-grid">
        <div className="v0-time-col">
          {TIME_SLOTS.map(t => (
            <div className="v0-time-slot-label" key={t}>{t}</div>
          ))}
        </div>

        {days.map(d => (
          <div key={d.date} className={`v0-day-col ${d.isHoliday ? 'holiday' : ''} ${d.isToday ? 'today' : ''}`}>
            {TIME_SLOTS.map(t => {
              const appts = d.appts[t] || [];
              return (
                <div
                  key={t}
                  className={`v0-slot ${appts.length > 1 ? 'multi' : ''} ${appts.length ? 'booked' : 'available'}`}
                >
                  {appts.length > 1 && (
                    <div className="v0-count-pill">{appts.length} APPTS</div>
                  )}
                  {appts.map((a, i) => (
                    <div className="v0-appt" key={i}>
                      <div className="v0-pname">{a.n}</div>
                      <div className="v0-pdetail">{a.p}</div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

window.V0Current = V0Current;
