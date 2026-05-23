# Handoff — Calendar Week View Redesign

## Overview

This is the design handoff for a redesign of the **week view** of `AppointmentCalendar` in the **ShwNodApp** dental-clinic application. The new design solves four problems identified in the current production calendar:

1. Variable slot heights (rows growing 1× → 5× tall) that break time-axis alignment across days.
2. Empty slots and booked slots look almost identical.
3. The purple-gradient header is heavy and carries no information.
4. Holiday days look like normal days with red headers — the 14 empty slots underneath still draw the eye.

It also adds **drag-and-drop rescheduling** and a **"+N more" popover** for slots with 5+ appointments.

## About the design files

The files in this bundle are **design references** created as a static HTML/React prototype. They demonstrate the intended look, layout, and interaction model — they are **not** production code to drop into the app.

Your job: **recreate this design in the existing ShwNodApp codebase**, modifying these files in-place:

- `public/js/components/react/AppointmentCalendar.tsx`
- `public/js/components/react/CalendarGrid.tsx`
- `public/js/components/react/CalendarHeader.tsx`
- `public/css/components/appointment-calendar.css`
- `public/css/base/variables.css` (only to add new tokens, do not remove existing)

Keep all existing data wiring (API endpoints, state management, holiday modals, doctor filter, etc.). Replace only the visual layer and the slot-rendering logic. The drag-and-drop and "+N more" popover are net-new features that need handlers wired to the existing appointment API.

## Fidelity

**High-fidelity.** Colors, spacing, typography, border-radii, and interaction states are all final. Recreate pixel-perfectly using the existing CSS variable system (`public/css/base/variables.css`), augmented with the new tokens listed below.

## What's in this bundle

```
design_handoff_calendar_week_view/
├── README.md                       ← this file
├── Calendar Redesign.html          ← open in a browser to see the live prototype
└── reference/
    ├── v4-stacked.jsx              ← THE design — full week-view component
    ├── v4.css                      ← THE design's styles
    ├── calendar-data.js            ← sample data shape (used by the prototype only)
    ├── v0-current.jsx              ← faithful rebuild of the CURRENT production
    ├── v0.css                      ← current production styles (rebuilt)
    ├── density-*.{jsx,css}         ← earlier explorations (archived; ignore)
    └── design-canvas.jsx           ← prototype host (ignore)
```

Open **`Calendar Redesign.html`** in a browser to see the design running. The first artboard ("V4 · Week view") is the approved design. The second artboard ("V0 · Live design") is the current production for comparison.

---

## The design — at a glance

### Layout (top to bottom)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Toolbar:  May 2026                          80%▰▰▰▰▱  57/84 slots │  ← 50px
│            Week 21 · Sat 16 – Thu 21  ‹ Today ›   [Day Week Month]  │
├─────────────────────────────────────────────────────────────────────┤
│ TIME │ SAT 16 │ SUN 17 │ MON 18 │ TUE 19 │ WED 20 │ THU 21          │  ← 50px
│      │ 9 appts│12 appts│13 appts│ Holiday│10 appts│10 appts         │
├──────┼────────┼────────┼────────┼────────┼────────┼─────────────────┤
│ 14   │ ┌────┐ │        │ ┌────┐ │        │ ┌────┐ │ ┌────┐          │  ← 112px
│ :00  │ │card│ │ (empty)│ │card│ │ HOLIDAY│ │card│ │ │card│  ...     │     each slot
│      │ └────┘ │        │ └────┘ │  SASH  │ └────┘ │ └────┘          │
├──────┼────────┼────────┼────────┼────────┼────────┼─────────────────┤
│ 14   │   …    │   …    │   …    │   …    │   …    │   …             │  ← 112px
│ :30  │                                                                │
│ …    │                                                                │
```

### Slot — the core idea

**Every slot is 112px tall, no exceptions.** Inside, content auto-arranges by appointment count:

| Count | Layout                                                | Card size                |
|-------|-------------------------------------------------------|--------------------------|
| 0     | empty (just the tint band, with a ＋ that appears on hover) | —                        |
| 1     | one card spanning the full slot                       | ~104 × full-column-width |
| 2     | two cards stacked vertically, each full-width         | ~50 × full-column-width  |
| 3     | row 1: 2 cards side-by-side · row 2: 1 card full-width | ~50 × half + ~50 × full  |
| 4     | 2 × 2 grid                                            | ~50 × half each          |
| 5+    | row 1: 2 cards · row 2: 1 card + "+N more" cell       | ~50 × half each          |

The "+N more" cell, when clicked, opens a popover anchored below the slot listing the hidden appointments (each row in the popover is itself draggable for rescheduling).

### Time-row color bands

Each 30-minute time slot has a **unique color band** carried across all six days. Hues are stepped at the golden angle (~137.5°) so every consecutive pair of rows has maximum contrast.

| Time  | Hue (oklch) | Approx colour |
|-------|-------------|---------------|
| 14:00 | 220°        | blue          |
| 14:30 | 358°        | red           |
| 15:00 | 135°        | green         |
| 15:30 | 273°        | purple        |
| 16:00 | 50°         | gold          |
| 16:30 | 188°        | cyan          |
| 17:00 | 325°        | pink          |
| 17:30 | 103°        | lime          |
| 18:00 | 240°        | indigo        |
| 18:30 | 18°         | red-orange    |
| 19:00 | 155°        | mint          |
| 19:30 | 293°        | violet        |
| 20:00 | 70°         | yellow        |
| 20:30 | 208°        | sky           |

All bands share the same lightness and chroma — only hue rotates:

- **Slot background** (row body): `oklch(96% 0.04 <hue>)`
- **Time-label column** (the leftmost column of the row): `oklch(86% 0.08 <hue>)` — more saturated so the row is anchored

> The exact map is in `reference/v4-stacked.jsx` as `V4_TIME_TINT`. Copy it verbatim.

### Procedure colors (card left-border)

Each appointment card has a **3 px colored left border** keyed to the procedure type:

| Procedure       | oklch                  |
|-----------------|------------------------|
| Check-up        | `oklch(60% 0.14 250)`  |
| Bonding         | `oklch(58% 0.16 305)`  |
| Wire change     | `oklch(55% 0.13 175)`  |
| Adjustment      | `oklch(56% 0.13 145)`  |
| Consultation    | `oklch(64% 0.13 60)`   |
| Records         | `oklch(60% 0.15 25)`   |
| Extraction      | `oklch(54% 0.18 25)`   |
| Retainer fit    | `oklch(60% 0.14 305)`  |
| Cleaning        | `oklch(58% 0.13 195)`  |
| Debonding       | `oklch(58% 0.14 305)`  |
| Emergency       | `oklch(52% 0.20 25)`   |
| Separator       | `oklch(56% 0.13 145)`  |
| (fallback)      | `oklch(58% 0.13 250)`  |

Map exists as `V4_PROC` in `reference/v4-stacked.jsx`. Card body itself is plain white.

---

## Components — detailed spec

### 1. Toolbar (`CalendarHeader`)

```
┌──────────────────────────────────────────────────────────────────┐
│  May 2026                  80% ▰▰▰▰▱  57/84 slots               │
│  Week 21 · Sat 16 – Thu 21                                       │
│  ‹  [Today]  ›    [ Day │ Week │ Month ]   [All doctors ▾]       │
└──────────────────────────────────────────────────────────────────┘
```

- **Background**: white (`#ffffff`). Bottom border: `1px solid oklch(90% 0.005 260)`. Drop the existing purple gradient entirely.
- **Padding**: `12px 22px`.
- **Title block** (left): two lines.
  - Line 1: "May 2026" — `1.25rem, weight 700, oklch(22% 0.014 260)`.
  - Line 2: "Week 21 · Sat 16 – Thu 21" — `0.8125rem, oklch(58% 0.008 260)`, tabular-nums.
- **Navigation**: prev arrow (`‹`, 30×30 ghost button) → **Today** primary button (purple `#6d67c6`, white text, 8px radius, 30px height, 0 14px padding) → next arrow.
- **Utilisation strip** (right, inline): big percentage in teal (`oklch(58% 0.13 175)` aka existing `--color-teal`), 92×5px progress bar with teal→purple gradient fill, then `<b>booked</b>/total slots` in small grey text.
- **View segmented control**: 3-button group, ~3px padding, light grey background, active button = white pill with subtle shadow.
- **Doctor select**: white background, 1px border, 8px radius, 30px height. Custom dropdown caret made from two CSS-painted triangles (see `v4.css` `.v4-select`).

Remove `early-slots-toggle` from the header for V1 of this redesign — it can come back as a Tweak.

### 2. Day header row (sticky below toolbar)

- **Grid**: `70px repeat(6, 1fr)` (matches the grid below).
- **Day cell**: padding `10px 14px`, right-border `1px solid var(--v4-line)`, two stacked rows:
  - Row 1: day-name abbrev (`SAT`, `SUN`, …) at 0.6875rem, weight 700, letter-spacing 0.1em, grey · and date number (`16`) at 1.5rem, weight 700, ink color.
  - Row 2: small tag — `"5 appts"` or `"Holiday"`.
- **Today**: 3px purple bar across the top of the cell; day-name and day-number both turn purple.
- **Holiday**: soft red wash (`oklch(96% 0.025 25)`); both name and number turn red (`oklch(58% 0.13 25)`); tag reads "Holiday" in uppercase.
- **Time-head cell** (leftmost): right-aligned `TIME` label in tiny grey caps.

### 3. Time column

- **Width**: 70 px, fixed.
- **Each cell**: 112 px tall (matches slot height), centered content, no border between (rows distinguished by tint).
- **Background**: `V4_TIME_TINT[time].label` — the *darker* of the two tints.
- **Content**: two-line stacked time, e.g.
  ```
   14
  :00
  ```
  Hours at `1.0625rem, weight 700`, minutes at `0.75rem, weight 600`, both tabular-nums.

### 4. Day column (per day)

- **Width**: flexes to share the remaining 6 columns equally.
- **Display**: column of 14 slot-wraps.
- **Today column**: subtle top-down purple wash gradient (4% mix, fades to transparent over 12% of height).
- **Holiday column**: full cream column with diagonal hatched stripes; all 14 slot-wraps' content is hidden; a single absolute-positioned card sits centered in the column with eyebrow (`HOLIDAY`), holiday name, and `Clinic closed` note. See `.v4-day-col.holiday`, `.v4-holiday-sash`, `.v4-holiday-card` in `v4.css`.

### 5. Slot wrap

- **Height**: `112px`, fixed. The whole system rides on this.
- **Background**: `V4_TIME_TINT[time].row` — the *lighter* of the two tints.
- **Border-bottom**: `1px solid rgba(255,255,255,0.6)` — soft white separator so the tint bands look like distinct stripes.
- **Position**: relative (needed for the "+N more" popover and drop-target outline).
- **Drag-over (valid)**: 2px dashed teal outline (offset −3px) + 8% teal overlay (`::after` pseudo-element).
- **Drag-over (holiday — forbidden)**: same but in red.

### 6. Slot content grid

Internal grid:

```css
.v4-slot {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3px;
  padding: 4px;
}
.v4-slot.count-1 { grid-template-rows: 1fr; }     /* 1 appt: single row */
.v4-slot.count-2 { grid-template-rows: 1fr 1fr; } /* lanes both span 2 cols → stacked */
.v4-slot.count-3 { grid-template-rows: 1fr 1fr; } /* lane[2] spans 2 cols → 2+1 */
.v4-slot.count-4 { grid-template-rows: 1fr 1fr; } /* perfect 2×2 */
.v4-slot.count-many { grid-template-rows: 1fr 1fr; }
```

Logic for which lanes span 2 cols vs 1 col is in `V4Stacked.renderSlot` in `reference/v4-stacked.jsx`.

### 7. Appointment card (`v4-lane`)

- **Size**: fills its grid cell.
- **Padding**: `4px 8px 4px 9px`.
- **Background**: white.
- **Border-left**: `3px solid <procedure hue>` (the visual marker for procedure type).
- **Border-radius**: 4px.
- **Box-shadow**: `0 1px 1px rgba(0,0,0,0.03)` — very subtle.
- **Cursor**: `grab` (becomes `grabbing` on active drag).
- **Hover**: `transform: translateX(1px)`, shadow strengthens to `0 2px 4px rgba(0,0,0,0.08)`.
- **Dragging**: `opacity: 0.35`.
- **Content**:
  - Patient name — `0.8125rem, weight 700, ink, RTL direction`. White-space nowrap + ellipsis.
  - Procedure name — `0.6875rem, weight 500, ink-2, RTL direction`. White-space nowrap + ellipsis.
  - In dense layouts (4-up, many): drop font sizes to `0.75rem` and `0.625rem` respectively.
- **Drag attribute**: `draggable="true"`. Each card carries a `dragId` of `${date}|${time}|${absoluteIndex}`.

### 8. "+N more" cell

When slot has 5+ appointments, the 4th grid cell is this button instead of a card.

- **Background**: white.
- **Border**: `1px dashed oklch(82% 0.006 260)` (becomes solid + purple on open).
- **Border-radius**: 4px.
- **Padding**: `2px 6px`.
- **Content** (centered, stacked):
  - `+N` — `1rem, weight 800, tabular-nums, ink-2`.
  - `MORE` — `0.5625rem, weight 600, uppercase, letter-spacing 0.08em, ink-3`.
- **Open state**: border becomes solid, color flips to purple, 3px purple ring (`box-shadow: 0 0 0 3px <purple-18%>`).
- **Click**: toggles the popover.

### 9. "+N more" popover

- **Position**: absolute, `top: calc(100% - 6px); right: 4px;` (anchored to its slot-wrap).
- **Width**: 220 px.
- **Background**: white.
- **Border-radius**: 10 px.
- **Shadow**: `0 4px 8px rgba(0,0,0,0.08), 0 12px 24px rgba(0,0,0,0.12)`.
- **z-index**: 30 (slot-wrap gets `z-index: 20` while popover open).
- **Animation on open**: 140 ms ease-out fade + 4 px slide-down.
- **Header**:
  - Title: `"17:00 · 5 appointments"` — `0.75rem weight 700, tabular-nums`.
  - Subtitle: `"Showing the 2 hidden — drag to reschedule"` — `0.625rem, ink-3`.
  - Close button: `×` in a 20 × 20 ghost button.
- **Rows**: each is a draggable mini-card (left-bordered, padding `6px 10px`, gap 4px). Hovering elevates to white with a soft shadow.
- **Click outside**: closes (uses a document-level `mousedown` listener; see `useEffect` block in `v4-stacked.jsx`).

---

## Interactions & behaviour

### Drag-and-drop rescheduling

| Trigger          | What happens                                                                |
|------------------|-----------------------------------------------------------------------------|
| Mousedown on card | `cursor: grabbing`, ready to drag.                                          |
| Dragstart        | Browser captures the card as ghost; React state stores `draggingId`; source card goes to `opacity: 0.35`. |
| Dragover on slot-wrap | Slot outlines 2px dashed teal; an 8 % teal overlay fades in.            |
| Dragover on holiday-day slot | Outline turns red; `dropEffect = 'none'`.                          |
| Drop on valid slot | The appointment is removed from its source slot's array and appended to the destination slot's array. `setDays(...)` triggers a re-render. |
| Drop on same slot | No-op (early-return in `reschedule`).                                       |
| Drop on holiday  | No-op (`onDrop` is not even attached to holiday slot-wraps).                |
| Dragend          | `draggingId` and `dropTarget` cleared; visuals revert.                      |

**Wiring to the backend**: the prototype updates only local state. In production, the drop handler must:

1. Send `PATCH /api/appointments/:id` (or whatever endpoint the existing code uses to update an appointment time/date) with the new date and time.
2. On success, refresh calendar data (the existing `fetchCalendarData(currentDate, selectedDoctorId)` call does this in `AppointmentCalendar.tsx`).
3. On failure, show a toast error (`toast.error(...)`) and revert local state.
4. Optionally do an optimistic update first, then reconcile.

A typical move source data shape (from the existing API):
```ts
{ appointmentID: number, date: 'YYYY-MM-DD', time: 'HH:mm', patientName: string, appDetail: string, ... }
```

### "+N more" popover

- Click → opens (closes any other open popover first).
- Click outside / Escape → closes.
- Clicking on a popover row should also open that appointment's detail view (whatever the existing `handleSlotClick` does for a single appointment).
- Dragging a popover row → same drag-to-reschedule flow as a card in the main grid.

### Existing behaviours to preserve

- Right-click on a day header → opens `CalendarDayContextMenu` (holiday management).
- Right-click on a slot with appointments → opens `CalendarContextMenu` (edit/delete).
- Trying to interact with past appointments → toast: "You cannot edit or delete past appointments". This same gate should be applied to drag-and-drop — past appointments should not be draggable.
- Doctor filter, view toggle, "Show early & late slots" — all wired to existing state.
- Mobile (≤768 px) — forces day view. The redesigned slot system collapses naturally to a single column on mobile (slots stay 112 px tall, lanes stack normally because the day column is now full-width).

---

## State management

The existing `AppointmentCalendar` already manages `calendarData`, `loading`, `error`, `selectedDoctorId`, `viewMode`, `currentDate`, `showEarlySlots`, `contextMenu`, etc. Add:

```ts
// In AppointmentCalendar.tsx
const [draggingId, setDraggingId] = useState<string | null>(null);
const [dropTarget, setDropTarget] = useState<{ date: string; time: string } | null>(null);
const [moreMenu, setMoreMenu] = useState<{ date: string; time: string } | null>(null);
```

Pass these (plus their setters) down to `CalendarGrid`. Inside `CalendarGrid`, plumb them to the slot components. The dragId convention is `${date}|${time}|${index}` where index is the appointment's position in the day's `appointments[time]` array.

When a drop succeeds, call a new prop `onReschedule(appointmentID, newDate, newTime)` — the parent fires the API call.

---

## Design tokens

Add these to `public/css/base/variables.css` (do not remove anything that's already there). Prefix them all with `--cal-` so they don't collide.

```css
:root {
  /* Calendar v2 — slot system */
  --cal-slot-h: 112px;
  --cal-grid-time-w: 70px;
  --cal-line: oklch(90% 0.005 260);
  --cal-line-2: oklch(82% 0.006 260);
  --cal-ink: oklch(22% 0.014 260);
  --cal-ink-2: oklch(40% 0.012 260);
  --cal-ink-3: oklch(58% 0.008 260);
  --cal-ink-4: oklch(74% 0.006 260);
  --cal-surface: #ffffff;
  --cal-surface-2: oklch(97% 0.004 260);
  --cal-hol: oklch(58% 0.13 25);
  --cal-hol-soft: oklch(96% 0.025 25);
  /* Reuse existing --color-purple-medium (#6d67c6) and --color-teal (#20c997). */
}
```

Keep `--color-purple-light`, `--color-purple-dark`, `--color-teal`, `--color-dark-slate`, `--color-light-slate`, etc. — they're still referenced elsewhere in the app.

The 14 hue-step time-tint map and the procedure hue map must live in JS (they're indexed by time/procedure strings), not CSS variables — copy them verbatim from `v4-stacked.jsx`.

## Typography

- Family: `"Inter", "SF Pro Text", system-ui, sans-serif` (Inter is already used in some parts of the codebase — verify by grepping for it; if not present, add a Google Fonts preconnect + import to `public/index.html`).
- All numeric runs use `font-variant-numeric: tabular-nums`.
- RTL on patient names — keep `direction: rtl; text-align: right;` exactly as the existing code does.

---

## What's intentionally out of scope for this handoff

- **Day view redesign** — keep current behaviour for now.
- **Month view redesign** — keep current behaviour for now.
- **The doctor filter** — visual stays the same; no behavioural change.
- **Early/late slots toggle** — temporarily removed from the toolbar in this redesign; can come back as a Tweak / settings option later.
- **Mobile day view** — should work out of the box because the slot system is self-contained, but worth a manual pass.

---

## Acceptance checklist

- [ ] Every slot is exactly 112 px tall, regardless of appointment count.
- [ ] Time-row tint bands render across all 6 days, anchored to the time-label column.
- [ ] 1-appt slot shows a single full-height card.
- [ ] 2-appt slot shows two cards stacked vertically.
- [ ] 3-appt slot shows row 1 (2 side-by-side) + row 2 (1 full-width).
- [ ] 4-appt slot shows a clean 2 × 2 grid.
- [ ] 5+ appt slot shows 3 cards + "+N more" cell.
- [ ] "+N more" cell click opens the popover; popover shows the hidden appointments.
- [ ] Dragging an appointment from any slot onto any other valid slot rescheduled it via the API.
- [ ] Dragging onto a holiday day is refused (red outline, drop ignored).
- [ ] Dragging from the popover works identically to dragging from the grid.
- [ ] Past appointments are not draggable.
- [ ] Today column has the top-down purple wash + 3 px purple top bar in its header.
- [ ] Holiday column shows the diagonal hatched stripes + centered "Clinic closed" card. No fake empty slots.
- [ ] All existing right-click menus and modals still work.
- [ ] No console errors.

---

## Files in this bundle to read first

1. **`Calendar Redesign.html`** — open in a browser. Look at the V4 artboard.
2. **`reference/v4-stacked.jsx`** — the React component. Read top-to-bottom. The `V4Stacked` function is the week-view; `V4Lane` is the card; `V4Popover` is the popover; `V4_TIME_TINT` and `V4_PROC` are the colour maps.
3. **`reference/v4.css`** — the full stylesheet. Class names are 1:1 with the JSX.
4. **`reference/v0-current.jsx` + `v0.css`** — faithful reconstruction of the current production calendar. Useful as a baseline if you want to diff.
