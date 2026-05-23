/* Strategy D — Spotlight + roster.
   For multi-appt slots: one appointment is shown in full ("spotlight"),
   the others live in a thin roster strip below as tiny initial chips.
   Clicking a chip swaps it into the spotlight.
   Slot height stays uniform; you always see one full name + know the rest. */

const StrategyD = () => {
  const { TIME_SLOTS, stress } = window.DENSITY_DATA;
  // Track which appointment is "featured" per slot (default 0).
  const [featured, setFeatured] = useState({});

  const renderSlot = (t) => {
    const appts = stress[t] || [];
    if (!appts.length) return <div className="dsD-slot empty" key={t} />;

    if (appts.length === 1) {
      const a = appts[0];
      return (
        <div className="dsD-slot one" key={t}>
          <div className="dsD-card" style={{ borderLeftColor: window.PROC_HUE[a.p] }}>
            <div className="dsD-name">{a.n}</div>
            <div className="dsD-proc">{a.p}</div>
          </div>
        </div>
      );
    }

    const idx = featured[t] ?? 0;
    const spot = appts[idx];

    return (
      <div className="dsD-slot many" key={t}>
        <div className="dsD-card" style={{ borderLeftColor: window.PROC_HUE[spot.p] }}>
          <div className="dsD-name">{spot.n}</div>
          <div className="dsD-proc-row">
            <span className="dsD-proc">{spot.p}</span>
            <span className="dsD-pos">{idx + 1} / {appts.length}</span>
          </div>
        </div>
        <div className="dsD-roster">
          {appts.map((a, i) => (
            <button
              type="button"
              className={`dsD-pill ${i === idx ? 'active' : ''}`}
              key={i}
              onClick={() => setFeatured(prev => ({ ...prev, [t]: i }))}
              title={`${a.n} — ${a.p}`}
              style={{
                background: i === idx ? window.PROC_HUE[a.p] : window.PROC_TINT[a.p],
                color: i === idx ? 'white' : window.PROC_HUE[a.p],
                borderColor: window.PROC_HUE[a.p],
              }}
            >
              {window.initialOf(a.n)}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="ds-col dsD">
      <window.DSHead
        title="D · Spotlight + roster"
        subtitle="One appointment featured in full. Others as initial pills below. Tap to swap."
        accent="oklch(60% 0.15 25)"
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
window.StrategyD = StrategyD;
