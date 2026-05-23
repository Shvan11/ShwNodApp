/* Strategy A — Adaptive density (recommended default).
   Uniform slot height.  Content adapts to count.
   1 = full card, 2 = stacked compact, 3 = condensed list,
   4+ = top 2 + "+N" pill that expands inline. */

const StrategyA = () => {
  const { TIME_SLOTS, stress } = window.DENSITY_DATA;
  const [expanded, setExpanded] = useState(null);

  const renderSlot = (t) => {
    const appts = stress[t] || [];
    const isExpanded = expanded === t;
    if (!appts.length) {
      return <div className="dsA-slot empty" key={t} />;
    }
    if (appts.length === 1) {
      const a = appts[0];
      return (
        <div className="dsA-slot one" key={t}>
          <div className="dsA-card" style={{ borderLeftColor: window.PROC_HUE[a.p] }}>
            <div className="dsA-name">{a.n}</div>
            <div className="dsA-proc">{a.p}</div>
          </div>
        </div>
      );
    }
    if (appts.length === 2) {
      return (
        <div className="dsA-slot two" key={t}>
          {appts.map((a, i) => (
            <div className="dsA-row" key={i} style={{ borderLeftColor: window.PROC_HUE[a.p] }}>
              <div className="dsA-name sm">{a.n}</div>
              <div className="dsA-proc sm">{a.p}</div>
            </div>
          ))}
        </div>
      );
    }
    if (appts.length === 3) {
      return (
        <div className="dsA-slot three" key={t}>
          {appts.map((a, i) => (
            <div className="dsA-line" key={i}>
              <span className="dsA-dot" style={{ background: window.PROC_HUE[a.p] }} />
              <span className="dsA-name xs">{a.n}</span>
              <span className="dsA-proc xs">{a.p}</span>
            </div>
          ))}
        </div>
      );
    }
    // 4+
    const visible = isExpanded ? appts : appts.slice(0, 2);
    const overflow = appts.length - 2;
    return (
      <div className={`dsA-slot many ${isExpanded ? 'expanded' : ''}`} key={t}>
        {visible.map((a, i) => (
          <div className="dsA-line" key={i}>
            <span className="dsA-dot" style={{ background: window.PROC_HUE[a.p] }} />
            <span className="dsA-name xs">{a.n}</span>
            <span className="dsA-proc xs">{a.p}</span>
          </div>
        ))}
        {!isExpanded && (
          <button
            className="dsA-more"
            onClick={() => setExpanded(t)}
            type="button"
          >
            + {overflow} more
          </button>
        )}
        {isExpanded && (
          <button
            className="dsA-more collapse"
            onClick={() => setExpanded(null)}
            type="button"
          >
            ▴ collapse
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="ds-col dsA">
      <window.DSHead
        title="A · Adaptive"
        subtitle="Uniform height. Layout adapts to count. 4+ collapses to top-2 + expander."
        accent="oklch(58% 0.13 175)"
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
window.StrategyA = StrategyA;
