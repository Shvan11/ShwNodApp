/* Strategy B — Initial chips.
   Slot has fixed height.  Each appointment becomes a small pill containing:
     · a colored dot (procedure)
     · a 1-glyph initial (RTL Arabic)
   Chips wrap to a 2-row grid.  At-a-glance count, hover for name.
   All appts are visible regardless of count — never hidden. */

const StrategyB = () => {
  const { TIME_SLOTS, stress } = window.DENSITY_DATA;
  const [hover, setHover] = useState(null);

  const renderSlot = (t) => {
    const appts = stress[t] || [];
    if (!appts.length) return <div className="dsB-slot empty" key={t} />;

    if (appts.length === 1) {
      const a = appts[0];
      return (
        <div className="dsB-slot one" key={t}>
          <div className="dsB-card" style={{ borderLeftColor: window.PROC_HUE[a.p] }}>
            <div className="dsB-name">{a.n}</div>
            <div className="dsB-proc">{a.p}</div>
          </div>
        </div>
      );
    }

    return (
      <div className={`dsB-slot many count-${appts.length}`} key={t}>
        <div className="dsB-count">{appts.length}</div>
        <div className="dsB-chips">
          {appts.map((a, i) => {
            const key = `${t}-${i}`;
            const isHover = hover === key;
            return (
              <div
                className="dsB-chip"
                key={i}
                onMouseEnter={() => setHover(key)}
                onMouseLeave={() => setHover(null)}
                style={{
                  background: window.PROC_TINT[a.p],
                  borderColor: window.PROC_HUE[a.p],
                }}
              >
                <span
                  className="dsB-chip-dot"
                  style={{ background: window.PROC_HUE[a.p] }}
                />
                <span
                  className="dsB-chip-initial"
                  style={{ color: window.PROC_HUE[a.p] }}
                >
                  {window.initialOf(a.n)}
                </span>
                {isHover && (
                  <div className="dsB-tooltip">
                    <div className="dsB-tip-name">{a.n}</div>
                    <div className="dsB-tip-proc">{a.p}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="ds-col dsB">
      <window.DSHead
        title="B · Chip grid"
        subtitle="All appointments always visible as initial chips. Hover for full name."
        accent="oklch(60% 0.16 305)"
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
window.StrategyB = StrategyB;
