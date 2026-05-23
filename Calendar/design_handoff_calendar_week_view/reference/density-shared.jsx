/* Shared helpers for all density strategies. */
const { useState } = React;

// Per-procedure hue — same chroma & lightness, varying hue.
window.PROC_HUE = {
  'Check-up':     'oklch(62% 0.14 250)',
  'Bonding':      'oklch(60% 0.16 305)',
  'Wire change':  'oklch(58% 0.13 175)',
  'Adjustment':   'oklch(58% 0.13 145)',
  'Consultation': 'oklch(64% 0.13 60)',
  'Records':      'oklch(60% 0.15 25)',
  'Extraction':   'oklch(56% 0.18 25)',
  'Retainer fit': 'oklch(60% 0.14 305)',
  'Cleaning':     'oklch(58% 0.13 195)',
  'Debonding':    'oklch(60% 0.14 305)',
  'Emergency':    'oklch(52% 0.20 25)',
  'Separator':    'oklch(58% 0.13 145)',
  'X-ray review': 'oklch(62% 0.14 250)',
};

// Per-procedure soft tint for chip backgrounds.
window.PROC_TINT = {
  'Check-up':     'oklch(96% 0.025 250)',
  'Bonding':      'oklch(96% 0.03 305)',
  'Wire change':  'oklch(95% 0.04 175)',
  'Adjustment':   'oklch(96% 0.03 145)',
  'Consultation': 'oklch(96% 0.04 60)',
  'Records':      'oklch(96% 0.035 25)',
  'Extraction':   'oklch(95% 0.04 25)',
  'Retainer fit': 'oklch(96% 0.03 305)',
  'Cleaning':     'oklch(95% 0.035 195)',
  'Debonding':    'oklch(96% 0.03 305)',
  'Emergency':    'oklch(93% 0.06 25)',
  'Separator':    'oklch(96% 0.03 145)',
  'X-ray review': 'oklch(96% 0.025 250)',
};

// Pull a 1-letter initial from an Arabic name (first letter of the first word).
window.initialOf = function (name) {
  if (!name) return '';
  const first = name.trim().split(/\s+/)[0];
  return first[0] || '';
};

// Time-column rail used by every strategy so they line up identically.
window.TimeRail = function TimeRail() {
  const { TIME_SLOTS } = window.DENSITY_DATA;
  return (
    <div className="ds-time-rail">
      {TIME_SLOTS.map(t => (
        <div className="ds-time" key={t}>{t}</div>
      ))}
    </div>
  );
};

// Header for each strategy column.
window.DSHead = function DSHead({ title, subtitle, accent }) {
  return (
    <div className="ds-head" style={{ borderTopColor: accent }}>
      <div className="ds-head-title">{title}</div>
      <div className="ds-head-sub">{subtitle}</div>
    </div>
  );
};
