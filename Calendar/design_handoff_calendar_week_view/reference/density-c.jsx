/* Strategy C — Vertical lanes.
   Multi-appointment slot splits horizontally into N narrow lanes
   (Google Cal / Cal.com style for overlapping events).
   Each lane shows compact name + procedure stacked.
   Keeps perfect time-axis alignment; trades width for parallelism. */

const StrategyC = () => {
  const { TIME_SLOTS, stress } = window.DENSITY_DATA;

  const renderSlot = (t) => {
    const appts = stress[t] || [];
    if (!appts.length) return <div className="dsC-slot empty" key={t} />;

    // Cap visible lanes at 4; overflow goes into a "+N" lane.
    const MAX = 4;
    let visible = appts;
    let overflow = 0;
    if (appts.length > MAX) {
      visible = appts.slice(0, MAX - 1);
      overflow = appts.length - (MAX - 1);
    }

    return (
      <div className={`dsC-slot many lanes-${Math.min(appts.length, MAX)}`} key={t}>
        {visible.map((a, i) => (
          <div
            className="dsC-lane"
            key={i}
            style={{
              background: window.PROC_TINT[a.p],
              borderTopColor: window.PROC_HUE[a.p],
            }}
          >
            <div className="dsC-name">{a.n}</div>
            <div className="dsC-proc">{a.p}</div>
          </div>
        ))}
        {overflow > 0 && (
          <div className="dsC-lane overflow">
            <span className="dsC-over-num">+{overflow}</span>
            <span className="dsC-over-label">more</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="ds-col dsC">
      <window.DSHead
        title="C · Vertical lanes"
        subtitle="Multi-appt slot splits into N side-by-side lanes. Time alignment preserved."
        accent="oklch(58% 0.13 145)"
      />
      <div className="ds-body">
        <window.TimeRail />
        <div className="ds-day">
          {TIME_SLOTS.map(t => renderSlot(t))}
        </div>
      </div>
    </div>
  );
};
window.StrategyC = StrategyC;
