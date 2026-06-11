# CSS Audit & Unification Tracker

Full, file-by-file CSS cleanup + unification of the staff app's stylesheets,
done in **trackable phases** so no single session runs too long. Started
2026-06-11.

This is a **full CSS audit** — not only the dark-theme migration. Each file is
swept against the checklist below, dead rules deleted, and values unified onto
the two-tier token system (`public/css/base/tokens-primitive.css` →
`tokens-semantic.css` → `theme-dark.css`).

---

## Per-file audit checklist

Apply every item to each file before marking it ✅:

1. **Dead code** — delete selectors/rules whose class is referenced nowhere.
   - Module CSS `X.module.css`: a class is *used* if it appears as `styles.<name>`
     (or `styles['<name>']`) anywhere in `public/js/**`. **Dynamic access** —
     `SupabaseStatusSettings.tsx` / `IntegrationsSettings.tsx` build class names
     via `styles[health]`; never delete the `healthy/…` variants in those two.
   - Global CSS: a class is *used* if its literal string appears anywhere in
     `public/**` (`.tsx`/`.ts`/`.html`). Keep `:global`/state classes toggled by
     JS string (e.g. `is-active`, `open`).
   - Also remove empty rules and commented-out blocks.
2. **Dark-theme correctness** — replace hardcoded `#hex` / `rgba()` that won't
   adapt with the semantic token whose light value matches. **Respect the pins**
   (see Exclusions): portal + chair-display stay light — clean their *structure*
   but do not push dark tokens onto them.
3. **Token-tier unification** — map raw values & wrong-tier tokens to the right token:
   - text → `--text-*` (not raw `--gray-*`); surfaces → `--surface*` / `--background-*` / `--card-bg`; borders → `--border*`
   - spacing → `--spacing-*`; radius → `--radius-*`; font-size → `--font-size-*`; weight → `--font-weight-*`; z-index → `--z-index-*`; shadow → `--shadow-*`; transition → `--transition-*`
4. **`var()` fallbacks — strip ALL of them, no exceptions.** `var(--token, anything)`
   → `var(--token)`. Every token is defined in `tokens-*.css` (in `:root`), so the
   fallback is dead code, a second source of truth that drifts (we found *wrong*
   ones: `--radius-md, 0.375rem`/`6px` for a 4px token, `--radius-lg, 12px` for 8px),
   and usually a stale *light* value that would break dark mode if it ever fired.
   **There is no "render if the stylesheet failed" exception** (incl. error
   boundaries): CSS custom properties can't selectively fail — if the token sheet
   didn't load, the component's own classes (same bundle) wouldn't either, and a JS
   error never unloads parsed CSS. This also covers `:root`-defaulted vars set inline
   by JS (e.g. `--cal-font-scale`, `--header-height`): the `:root` default already is
   the fallback, so `var(--x, default)` is redundant — strip it.
5. **`!important`** — remove, except inside `@media print` or a11y queries
   (`prefers-reduced-motion`, `forced-colors`).
6. **De-duplication** — merge duplicate selectors, drop redundant declarations,
   remove hand-written prefixes already handled by the build.
7. **Consistency** — same visual purpose → same token across files; tidy formatting.

**Hard rules:** never rename a class (breaks `styles.X` + needs css:types regen);
never edit the three token-definition files as part of consumer cleanup (they are
the SSoT — only extend them if a genuinely missing token is needed, noted in the
phase log). No inline styles, no new `!important`.

## Per-phase exit gate

After finishing a phase's files:
```bash
npm run css:types       # regenerate *.module.css.d.ts (catches deleted classes)
npm run typecheck:all   # fails if a deleted class was still referenced
npm run lint            # style/format
```
Then update this tracker (status + notes) and report.

## Exclusions / pins (decided 2026-06-11)

- **Audit all, respect pins.** Patient portal (`portal/portal.module.css`) and the
  chair-display kiosk (`routes/ChairDisplay.module.css`) are **pinned light** —
  get structural cleanup + dead-code removal but **no dark-theme tokens**.
- `login.html` is its own untouched surface.
- Token-definition files (`tokens-primitive.css`, `tokens-semantic.css`,
  `theme-dark.css`) are the SSoT — referenced, not audited as consumers.

---

## Phases

Status: ⬜ not started · 🔶 in progress · ✅ done

### Phase 1 — Global foundation (`public/css/`)  ✅ (2026-06-11)
base/: `reset.css` · `rtl-support.css` · `utilities.css`
components/: `buttons.css` · `inputs.css` · `modal.css` · `toast.css` · `lookup-editor.css` · `work-card.css` · `aligner-common.css` · `appointment-calendar.css` · `calendar-holidays.css` · `route-error.css`
layout/: `sidebar-navigation.css` · `universal-header.css`

### Phase 2 — Shared primitives (modals, errors, layout shells)  ✅ (2026-06-11)
`react/Modal.module.css` · `react/ConfirmDialog.module.css` · `react/GridComponent.module.css` · `react/PrintQueueIndicator.module.css` · `react/AnalogClock.module.css` · `error-boundaries/ErrorBoundary.module.css` · `error-boundaries/RouteErrorBoundary.module.css` · `layouts/AlignerLayout.module.css`

### Phase 3 — Settings cluster  ✅ (2026-06-11)
`SettingsContainer` · `SettingsSection` · `SettingsTabNavigation` · `IntegrationsSettings` · `ProtocolHandlersSettings` · `DatabaseSettings` · `ExchangeRatesSettings` · `CostPresetsSettings` · `CalendarTimesSettings` · `AlignerDoctorsSettings` · `EmployeeSettings` · `SupabaseStatusSettings` · `AdminUserManagement` · `UserManagement`

### Phase 4 — Patient core  ✅ (2026-06-11)
`PatientManagement` · `PatientShell` · `PatientQuickSearch` · `PatientSearchCombobox` · `PatientFolderPicker` · `PatientAppointments` · `AddPatientForm` · `EditPatientComponent` · `ViewPatientInfo` · `PortalAccessCard`

### Phase 5 — Works / Visits / Dental  ✅ (2026-06-11)
`WorkComponent` · `WorkCard` · `NewWorkComponent` · `NewVisitComponent` · `VisitsComponent` · `TransferWorkModal` · `TeethSelector` · `DentalChart` · `XraysComponent` · `TimePointsSelector` · `TimepointActionsMenu` · `TimepointModals`

### Phase 6 — Appointments / Calendar  ✅ (2026-06-11)
`AppointmentForm` · `MonthlyCalendarGrid` · `SimplifiedCalendarPicker` · `PhotoSessionDialog` · appointments/: `AppointmentCard` · `AppointmentsHeader` · `AppointmentsList` · `ConnectionStatus` · `DailyAppointments` · `MobileViewToggle` · `Notification` (deleted — orphaned) · `StatsCards`

### Phase 7 — Aligner pages + Diagnosis + Compare  ✅ (2026-06-11)
aligner/: `AllSetsList` · `ArchformMatcher` · `DoctorsList` · `PatientSets` · `PatientsList` · `SearchPatient` · `pages/Diagnosis` · `CompareComponent` · `WebCephModal`

### Phase 8 — Stand (POS / inventory)  ✅ (2026-06-11)
stand/ (18): `BarcodeInput` · `CategoryManagerModal` · `DeleteItemModal` · `ExpiringItemsPanel` · `ItemFilters` · `ItemFormModal` · `ItemTable` · `LowStockPanel` · `POSCart` · `POSCheckout` · `POSItemSearch` · `RestockModal` · `SaleDetailModal` · `SalesHistoryTable` · `SalesTrendChart` · `StandKPICards` · `StockAdjustModal` · `StockMovementsModal`
routes/: `Stand` · `StandInventory` · `StandPOS` · `StandReports` · `StandSalesHistory`

### Phase 9 — Messaging / Media / Files  ✅ (2026-06-11)
`WhatsAppAuth` · `WhatsAppSend` · `LabelPreviewModal` · `Videos` · photo-editor/ (8) · slideshow/ (3) · files/ (2) · share/ (2) · localsend/ (1)

### Phase 10 — Dashboards / Stats / Expenses / Payment / Templates  ✅ (2026-06-11)
`Dashboard` · `Expenses` · `StatisticsComponent` · `PaymentModal` · templates/: `TemplateDesigner` · `TemplateManagement`

### Phase 11 — Pinned-light (structure-only, NO dark tokens)  ✅ (2026-06-11)
`portal/portal.module.css` · `routes/ChairDisplay.module.css`

---

## Phase log

### Phase 1 — Global foundation (2026-06-11) ✅ — `npm run build` green (client + server)

15 files swept. Highlights:
- **Dead code removed:** `.whitespace-nowrap` (utilities, 0 refs); the duplicate toast-RTL block + its `slideInFromLeft` keyframe in `rtl-support.css` (toast.css fully owns toast RTL); 4 orphaned empty section-comments in `rtl-support.css`; **26 dead `:root` calendar vars** in `appointment-calendar.css` (only `--calendar-border` + `--calendar-background` survived the v4 redesign onto `--cal-*`), plus the 2 dead `--slot-*` overrides in its high-contrast block.
- **Dark-theme bugs fixed:** `.form-control` / `.pm-select__control` backgrounds used `--color-white` (fixed white, never flips) with `--text-primary` text (flips light) → invisible in dark → now `--surface`; same for the calendar doctor-filter `<select>`; modal panels (`background: white`) → `--surface`; 10 literal `background: white` calendar card/popover surfaces → `--cal-surface`; the embedded select-chevron SVG was hardcoded dark → mid-gray that reads on both surfaces; placeholders `--gray-400` → `--text-lighter`.
- **Tokens unified:** `color: white`/`#fff` on colored fills → `--color-white` (brand token); `font-weight:` ints → `--font-weight-*`; exact spacing/radius/line-height/font-size → tokens; `box-shadow` focus rings → `--shadow-focus` / `--primary-alpha`.
- **Stale `var(--token, fallback)` fallbacks stripped** wholesale in `modal.css`, `lookup-editor.css`, `calendar-holidays.css` (several fallbacks were *wrong*, e.g. `--radius-md, 0.375rem`/`6px` when the token is `0.25rem`). Safe `sed`: `s/var\((--[A-Za-z0-9-]+),[[:space:]]*[^(),]+\)/var(\1)/g` (won't touch `rgba()`/`calc()`).
- **`!important`:** `lookup-editor` `.empty-row` padding re-scoped to `.lookup-table .empty-row` (specificity instead of `!important`). The two `left: …!important` (popover mobile, overriding JS inline position) and all `@media print` / `prefers-*` ones are legitimate and kept.
- Stale `variables.css` references (file was deleted) updated to `tokens-semantic.css`.

**Deferred to feature phases** (noted, not done — need on-screen verification): `aligner-common.css` has merged-file duplicate selectors (`.form-two-column-container`, `.form-row.form-row-three-col`) and bespoke vivid action-gradients (indigo/emerald/cyan — no exact tokens) — revisit in Phase 7. `.btn-warning` text uses `--text-primary` (flips light on yellow in dark) — low-contrast risk, left for a deliberate decision.

### Phase 2 — Shared primitives (2026-06-11) ✅ — `css:types` + `typecheck:all` (exit 0) + `build` (exit 0) all green

8 files. Highlights:
- **Dead code removed (verified zero references across `public/js`):** `GridComponent.dolphGallery` (legacy Dolphin gallery — class + `a`/`img` rules + its 5 media-query references); `PrintQueueIndicator` `.pulse .badge` + `@keyframes addPulse` (animation never triggered — `pulse` appears nowhere in the tsx, only in its own auto-d.ts). `css:types` regenerated; `typecheck:all` confirms no consumer broke.
- **False positives caught & KEPT** (naive `styles.X` grep over-flags): `AlignerLayout` `.modeToggle`/`.modeBtn` are consumed by a child via `styles={styles}` prop; `PrintQueueIndicator.expanded` is an intentionally-empty JS state-hook class (removing it would drop it from the typed d.ts and break the `tsx`). Dead-class removal MUST verify the real consumer, not just the sibling file.
- **`ErrorBoundary` / `RouteErrorBoundary` fallbacks STRIPPED (corrected 2026-06-11):** I initially deferred to their header comment ("keep a literal fallback in case the variable sheet failed to load") and left them — that rationale is **unsound** and was overruled. CSS custom properties can't selectively fail: if the token sheet didn't load, the boundary's *own* module classes (same bundle) wouldn't either, and a JS error (what trips the boundary) never unloads parsed CSS. The defensive fallbacks just duplicated tokens and drifted. All stripped, misleading header comments rewritten, weights tokenized. **Rule is now: no `var()` fallbacks anywhere, no exceptions** (checklist item 4).
- **Tokens unified / dark fixes:** `Modal`, `ConfirmDialog`, `AnalogClock` had non-resilience stale fallbacks stripped (Modal's `--radius-lg, 12px` fallback was *wrong* — token is 8px); `color: white`/`#fff` on colored fills → `--color-white`; `PrintQueueIndicator` fully-mappable indigo→purple gradients → `var(--indigo-500)`/`var(--purple-500)` (×3) and `z-index: 1030` → `var(--z-index-fixed)`; `font-weight` ints + exact `border-radius`/`line-height` → tokens. `GridComponent` `#ff6b6b` → `--error-red-light`.
- AnalogClock's skeuomorphic graphic colors (off-white face, rgba black hands) left as-is by design.

**Next:** Phase 3 — Settings cluster (14 files).

### Phase 3 — Settings cluster (2026-06-11) ✅ — `css:types` + `typecheck:all` (exit 0) + `lint` (exit 0) all green

14 files. Highlights:
- **`var()` fallbacks stripped wholesale** (checklist item 4) — every `var(--token, fallback)` → `var(--token)` across SettingsContainer/Section/TabNavigation, IntegrationsSettings, DatabaseSettings, CalendarTimesSettings, SupabaseStatusSettings. Several fallbacks were *wrong* drift (`--radius-xl, 12px` for a **16px** token; `--shadow-xl, …` duplicating the token verbatim) or **load-bearing for an undefined token** (see next).
- **Undefined-token bug fixed:** IntegrationsSettings referenced `var(--amber-500, #f0ad4e)` ×2 — **`--amber-500` is not defined anywhere** (only amber-50/300/600/800 exist), so the component was silently rendering the hard-coded fallback and a naive fallback-strip would have broken it to an invalid value. Remapped both to the defined, theme-aware **`--warning-400`** (the card's "warn" health state). Verified `--amber-500` has no other consumers, so no new token was added.
- **Dark-theme `color: white` → `var(--color-white)`** on every filled button/badge (brand white that stays white in dark): SettingsTabNavigation `.comingSoonBadge`; DatabaseSettings btnPrimary/Secondary/Info; AlignerDoctors + Employee btnAdd/Cancel/Save/Retry; AdminUserManagement btnPrimary/btnDanger:hover; UserManagement userRoleBadge/primary/danger.
- **Focus rings → `var(--shadow-focus)`** (theme-aware; deepens alpha in dark) — replaced the hand-rolled `box-shadow: 0 0 0 3px rgba(59,130,246,0.1)` / `rgba(0,123,255,0.1)` in DatabaseSettings, ExchangeRates, CostPresets, AdminUserManagement, UserManagement.
- **Dead code removed (verified zero `styles.X` consumers):** SettingsContainer's entire "Coming Soon Content" block (`.comingSoonContent` + `.comingSoonIcon` + `.comingSoonMessage` + their `h3`/`p` + the two `@media 768` refs — the live tab uses `.placeholder*`, never `.comingSoon*`); SettingsSection `.settingError` (orphan); UserManagement's `.userRoleBadge.user/.secretary/.doctor/.staff` compound rule — the JSX (`UserManagement.tsx:121`) only ever toggles `styles.admin`, so the role-variant selector was **unreachable** (non-admin badges already had no background; removal is visually inert). `css:types` regenerated; `typecheck:all` confirms no consumer broke.
- **False positives KEPT** (dynamic `styles[health]`/`styles[status]`): IntegrationsSettings + SupabaseStatusSettings `.ok/.warn/.off/.down` are built at runtime from the health string — never delete (matches the checklist's dynamic-access carve-out).

**Deferred (noted, not done):**
- **Warning-button text contrast in dark** — DatabaseSettings `.btnWarning` text is `var(--gray-900)`, which flips *light* in dark (gray-900 → night-50) over the yellow `--warning-color` fill → low contrast. This is the **same open question Phase 1 deferred for the global `.btn-warning`** (`--text-primary` there); both want a single, fixed "always-dark ink on yellow" decision (e.g. `--color-black` / a new `--on-warning` token) applied app-wide. Left for that deliberate call rather than a one-off divergence.
- **Literal spacing/radius/weight/size tokenization** was intentionally *not* forced in the raw-`rem` files (SettingsContainer/Section/TabNav, CalendarTimes, AlignerDoctors, Employee). Their structural values are heavily **off-system** (`0.75rem`, `1.1rem`, `0.85rem`, `6px`, `10px`, `20px`) with no exact token, so converting only the few that *do* map (`1rem`, `8px`) would leave each file half-tokenized and *less* consistent than uniform raw values. Bespoke card-elevation shadows (`0 2px 8px rgba(0,0,0,.08)`) and translucent indigo brand glows (`rgba(102,126,234,…)`) were left as-is — they degrade gracefully in dark (cards keep their theme-aware borders) and read on both surfaces (consistent with Phase 2 leaving bespoke shadows).

**Next:** Phase 4 — Patient core (10 files).

### Phase 4 — Patient core (2026-06-11) ✅ — `css:types` + `typecheck:all` (exit 0) + `lint` (exit 0), run once with Phase 5

10 files. Highlights:
- **Dead code removed (per-consumer verified — the only importer):**
  - **PatientManagement** — the unwired *active-filters chips* block (`activeFilters`/`activeFiltersHeader`/`clearFiltersBtn`/`filterChips`/`filterChip` + `…Work`/`…Keyword`/`…Tag`/`filterChipRemove`), the *work badges* (`workBadges`/`workBadge`), the *elaborate delete-warning box* (`deleteWarningBox`/`…Header`/`…ListContainer`/`deleteFinalWarning` — the component renders the simpler `deleteModal*` instead), plus orphans `emptyValue`, `patientNameSecondary`, `modalWide`/`modalNarrow`, `requiredAsterisk`, and all their `@media` variants.
  - **PatientShell** — `navToggleBtn` + `navOverlay` (both `display:none`, comments said "not needed anymore"). Kept the empty-but-referenced `.navigationSidebar`.
  - **AddPatientForm** — the entire **legacy non-tabbed layout**: outer `addPatientContainer` gradient wrapper, the top `addPatientHeader`/`addPatientLogo`/`addPatientNav` bar, and `formContent`/`formSection`/`formSectionFullWidth`/`formSectionTitle`/`formRowSingleColumn`/`formRowThreeColumns`/`formControl` (component now uses the tabs+accordion layout), incl. their media-query refs. Kept empty-but-referenced `.tabLabel`.
- **False consumer caught:** `AddPatientForm.module.css` is imported **only** by `AddPatientForm.tsx` — the `// add-patient.css -> AddPatientForm.module.css` line in `PatientShell.tsx` is a *comment*, not an import; a naive `grep importer` flagged it.
- **`var()` fallbacks stripped (item 4):** PortalAccessCard (8 tokens: `--text-secondary`/`--text-primary`/`--bg-muted`/`--warning-color`/`--border-color`/`--primary-color`), ViewPatientInfo (`--indigo-100`/`--indigo-700`), PatientShell + AddPatientForm (`--header-height, 50px` → the `:root` default already *is* the fallback).
- **Dark-theme fixes:** `color: white` → `var(--color-white)` on filled buttons/headers (PatientAppointments `btnNewAppointment`/`btnRetry`; AddPatientForm `accordionHeaderExpanded` + spinner); `var(--white)` surfaces → `var(--surface)` (PatientFolderPicker toolbar/tile/check); card shadows `rgba(0,0,0,.1)` → `var(--shadow-card)` (PatientShell breadcrumb/pageContent, EditPatientComponent form); stale indigo focus rings `rgba(99,102,241,.1)` → `var(--shadow-focus)` (EditPatientComponent, ViewPatientInfo); PatientQuickSearch `0 0 0 1px var(--primary-color)` → `var(--shadow-focus-strong)`.
- **Token unify:** `9999px` → `--radius-full`; `1.25rem` → `--font-size-xl`; `0.05em` → `--letter-spacing-wide`; `padding: 4px` → `--spacing-xs`; `16px` → `--radius-xl` (AddPatientForm); border-width tokens in PatientFolderPicker/PatientAppointments. Heavily-raw rem spacing/font-size in the bespoke files (PatientAppointments, AddPatientForm, EditPatientComponent, PatientShell, PortalAccessCard) left as-is per the Phase 3 don't-half-tokenize rule.

### Phase 5 — Works / Visits / Dental (2026-06-11) ✅ — `css:types` + `typecheck:all` (exit 0) + `lint` (exit 0)

12 files. Highlights:
- **Dead code removed (per-consumer verified):** NewWorkComponent — `.newWorkHeader .btnCancel` family + the raw `.confirmationDialogOverlay` wrapper **and** its now-unused `@keyframes fadeIn` (the dialog renders inside the shared `<Modal>`, never a raw overlay); TransferWorkModal — the entire **dead inline patient-search UI** (`searchInput`/`searchInputWrapper`, `searchResults`, `noResults`, `patientRow`, `patientName`/`Phone`/`Id` — replaced by the combobox; kept the still-used `searchSection`/`searchLabel` wrapper); NewVisitComponent `.headerCancelBtn`; VisitsComponent `.formContainer`.
- **⚠️ False-positive caught — import alias:** `TimePointsSelector.module.css` is imported by `GridComponent.tsx` as **`tpStyles`** (not `styles`), so a `styles.X` dead-scan flags *every* class (kebab/selector/tab*) as dead — they're all **live**, nothing removed. **The dead-class scan MUST resolve the consumer's actual import identifier**, not assume `styles`.
- **`var()` fallbacks stripped wholesale** via the Phase-1 safe sed (`s/var\((--[A-Za-z0-9-]+),[[:space:]]*[^(),]+\)/var(\1)/g`, leaves `rgba()`/`calc()` alone): TransferWorkModal (dozens — nearly every line) + TeethSelector (many); plus VisitsComponent `--warning-200`.
- **Dark-theme fixes:** `color: white` → `var(--color-white)` across filled/gradient elements (WorkComponent hovers + severity badges, NewWorkComponent `confirmationHeader`, NewVisitComponent active wire btns, TransferWorkModal arrow/primary btn, TeethSelector selected deciduous, TimePointsSelector active tab); hardcoded `rgba(0,0,0,…)`/inline shadows → tokens (`--shadow-card`/`-sm`/`-md`/`-lg`/`-xl`/`-focus`) in WorkComponent, NewWorkComponent, NewVisitComponent, VisitsComponent, TransferWorkModal, TimePointsSelector.
- **Token unify:** font-weight ints (`300`/`400`/`500`/`600`/`700`/`bold`) → `--font-weight-*` across every mixed file; `border-radius` `8px`/`12px`/`16px` → `--radius-lg`/`-2xl`/`-xl`; border-width `1px`/`2px`/`3px` → `--border-width-*` **only in files already using those tokens** (WorkComponent, WorkCard, NewWorkComponent) — left raw in the fully-raw files (NewVisitComponent, VisitsComponent, TransferWorkModal, TeethSelector, DentalChart) to avoid half-tokenizing. XraysComponent already clean (no change); DentalChart only needed font-weight.

**Gotcha (cost a repair):** a `replace_all` of `" 1px solid "` that *drops the trailing space* yields `solidvar(...)`/`solidtransparent` — fixed with `sed 's/solidvar(/solid var(/g'`. Use `" 1px solid"` (leading space, **no** trailing) so the following ` var(...)` keeps its space.

**Next:** Phase 6 — Appointments / Calendar.

### Phase 6 — Appointments / Calendar (2026-06-11) ✅

12 files (the appointments/ cluster was already heavily token-based — newer code). Highlights:
- **Dead code removed (per-consumer verified):**
  - **`Notification.module.css` was an entirely ORPHANED file** — there is no `Notification.tsx` and nothing imports the module (only its own auto-`.d.ts` referenced it; superseded by the global `useToast`). Deleted the `.module.css` **and** its stale `.d.ts`.
  - **MonthlyCalendarGrid** — the whole **hover-tooltip cluster is dead** (replaced by the click-to-expand `.dayExpandedPanel`): removed `.dayTooltip` + `@keyframes tooltipSlideIn` + `.dayTooltip::before` + `.tooltipHeader/Stats/Stat/.statLabel/.statValue/SectionTitle/Appointments/Appointment(:last-child)/More/Action`, and dropped `.dayTooltip` from the print + reduced-motion media lists. **Kept `.aptTime`/`.aptName`** — they're still rendered inside the expanded panel (tsx). Also removed the orphan `.utilizationFill` (referenced only in the reduced-motion list, defined nowhere).
  - **AppointmentCard** — `.statusChairActive` (`composes: statusActive`, zero consumers). **SimplifiedCalendarPicker** — `.addMore` (zero consumers).
- **Dark-theme fixes:** MonthlyCalendarGrid tooltip/panel **arrow `border-bottom: 8px/6px solid white` → `var(--surface)`** (the arrow must match its panel bg, which flips dark); the `.expandedCount` badge `var(--primary-light, #e3f2fd)` → **`var(--primary-100)`** (the proper light-tint that flips to dark-blue, vs `--primary-light` which is a *light* blue that'd swallow the blue text in dark). SimplifiedCalendarPicker **`.aptItem` bg `rgba(255,255,255,0.8)` → `var(--surface)`** — it was a frosted-white card with `--gray-700` text (text flips light in dark → invisible on the white card); opaque theme-aware surface reads in both.
- **`color: white` → `var(--color-white)`** on every filled element (AppointmentForm close btn; SimplifiedCalendarPicker jump/nav/today/availableCount/slot-check btns + the `solid white` check ring; AppointmentsHeader title/refresh; MobileViewToggle active; PhotoSessionDialog dateItem:hover).
- **`var()` fallbacks stripped** (item 4) — PhotoSessionDialog wholesale (every `--text-color/#333`, `--border-color/#e0e0e0`, etc.); MonthlyCalendarGrid `--calendar-background/border`, `--surface-hover`, `--primary-light`; the three `--header-height, 50px` (AppointmentForm + DailyAppointments — the `:root` default *is* the fallback).
- **Token unify:** font-weight ints → `--font-weight-*` (AppointmentForm, MonthlyCalendarGrid, SimplifiedCalendarPicker, PhotoSessionDialog); ConnectionStatus `9999px` → `--radius-full`; DailyAppointments `font-weight:400`/`line-height:1.5` → tokens; StatsCards `0.95rem` → `--font-size-md`. The purple brand focus-glow `rgba(102,126,234,0.1)` and bespoke colored status-button shadow glows left as-is (consistent with Phases 1–3). Heavily-raw px/rem files (PhotoSessionDialog, AppointmentForm, SimplifiedCalendarPicker) not force-tokenized beyond the clean wins.

### Phase 7 — Aligner pages + Diagnosis + Compare (2026-06-11) ✅

9 files. Highlights:
- **Dead code removed (per-consumer verified — checked the real import identifier):**
  - **ArchformMatcher** — `.matchSelect` (+ `:focus`/`:hover` + its 3 `@media` refs): the dropdown was migrated to **`react-select`** (JS `setSelectStyles` `StylesConfig`), so the CSS class is dead. (The react-select inline-JS `'white'`/`'#333'` colors are out of scope — JS object, not a `.module.css`.)
  - **PatientSets** — the whole **"Success Notification Popup" cluster** (`.successNotification` + `.slideOut` + `@keyframes slideInNotification`/`slideOutNotification` + `.notificationContent/Icon/Text/Title/Subtext`) — zero consumers (superseded by the global toast).
  - **Diagnosis** — `.cephGrid` (zero consumers).
- **Dark-theme fixes:** ArchformMatcher `.matchedRow` hardcoded green **`#e8f5e9`/`#c8e6c9` → `var(--success-50)`/`var(--success-100)`** (the only non-adapting hex in the aligner set — a flat light-green that stayed bright in dark).
- **`color: white` → `var(--color-white)`** on filled/gradient elements (ArchformMatcher btnSave/btnRetry; DoctorsList btnManageDoctors + allDoctors trio + activityBanner; PatientSets patientInfo/h2/meta; PatientsList photoPlaceholder/activityBanner; Diagnosis `.deleteButton`).
- **Blue focus rings `box-shadow: 0 0 0 3px/2px rgba(0, 115, 230, 0.1)` → `var(--shadow-focus)`** (theme-aware) across AllSetsList, ArchformMatcher, PatientsList, SearchPatient. (DoctorsList's `0 8px 20px rgba(0,115,230,0.15)` is a bespoke *hover-elevation* shadow, not a ring — left.)
- **Token unify:** font-weight ints → `--font-weight-*` (all six aligner files + Diagnosis); `border-radius: 8px/12px` → `--radius-lg`/`--radius-2xl`; SearchPatient `z-index: 1000` → `--z-index-dropdown`; the `--header-height, 50px` fallback strip (Diagnosis). 6px radii + heavily-raw rem spacing left (don't half-tokenize).
- **`var(--white)` surface alias → `var(--surface)`** in WebCephModal (createCard/uploadCard/input/fileInput) — *not* a dark bug (`--white` now flips to `night-800` in dark, identical to `--surface`), converted for consistency to migrate off the legacy alias.
- **Verified-and-LEFT (would've been a regression):** Diagnosis's `.btnBack/.btnCancel/.btnSave` use **`color: var(--background-primary)`** as the on-fill text — this is an intentional *knockout* (page-bg color as ink). It flips to dark text in dark mode, which is correct on the dark-mode light-blue `--primary-color (#4dabf7)`; forcing `--color-white` there would *lower* contrast. **CompareComponent needed zero changes** — already fully tokenized (border-width tokens, `--color-white`, rgba overlay controls are legit).

### Phase 8 — Stand (POS / inventory) (2026-06-11) ✅

23 files. The **18 stand/ component files were already heavily token-based** (newer, well-built code) — the issues clustered in the 5 `routes/Stand*` files plus `ItemFilters`/`ItemTable`/`CategoryManagerModal`/`StandKPICards`. Highlights:
- **Dark-theme fixes (the real bugs):**
  - **ItemFilters** — the purple-gradient filter card's `.filterInput`/`.filterSelect` had a hardcoded **`background: rgba(255,255,255,0.95)`** (frosted white) with `color: var(--text-color)`. `--text-color` flips to `night-50` (light) in dark → **light text on a white field = invisible**. Switched both to **`var(--surface)`** (theme-aware; already what the `:focus` state used) so it's dark-field/light-text in dark. The translucent-white *decorative* overlays (`.filterCard::before` shimmer, `.btnResetInline` 0.2/0.3, the input borders) stay — they read on the brand-purple card in both themes.
  - **ItemTable** — the right-edge scroll-fade `::after` faded to **`rgba(255,255,255,0.9)`** → a white smudge over the dark table in dark mode. Re-pointed to **`var(--background-light)`** (the table container's own bg, which flips to `night-800`) so the fade matches the table in both themes.
- **`var()` fallbacks stripped** across the 5 route files (`var(--background-primary, white)`, nested `var(--text-primary, var(--text-color))`, `var(--border-color, var(--gray-200/300))`, `var(--z-index-modal, 1040)`, `var(--text-muted, var(--gray-400))`, `var(--warning-600, #e68a00)`).
- **`color: white` → `var(--color-white)`** (StandReports `.statCardIcon`; ItemFilters ×5 — all on the purple card / green button, correct white-on-fill).
- **`var(--white)` legacy alias → `var(--surface)`** (CategoryManagerModal ×3) — consistency (flips identically), same call as WebCephModal in Phase 7.
- **Token unify:** `font-weight: 500` → `--font-weight-medium` (StandReports/SalesHistory/Inventory route files).
- **Verified-and-LEFT:** **StandKPICards** `.purple/.blue/.green/.orange/.teal` are full-card **bespoke vivid 2-stop gradients** (violet/blue/emerald/orange/teal) with `--color-white` text — decorative dashboard tiles, theme-neutral (vivid + white in both modes), no exact token equivalents. Left as-is (same precedent as Phase 1/3 leaving bespoke vivid gradients). The `border-color: var(--gray-400)` matches are **borders** (gray-400 → a border tone in dark — correct), not the text trap. **No dead classes** in any of the 23 files (every class has a live consumer).

### Side-fix — Calendar doctor-tint text contrast in dark (2026-06-11)

User flagged that on `/calendar` the per-doctor coloured appointment backgrounds **lose text contrast in dark mode**. Root cause: doctor tints are computed **theme-blind** in `doctorColors.ts` (`fill` = a light pastel, oklch ~94% / 84%-white blend) and applied as an **inline `style={{ background: fill }}`** on `.cal-lane` (week grid) and `.cal-popover-row` (+more popover) in *both* themes — but their text (`.cal-name`/`.cal-proc`/`.cal-popover-name`/`-proc`) uses `--cal-ink`/`--cal-ink-2`, which **flip light** in dark (`theme-dark.css`) → light text on the light tint. Fix (global `appointment-calendar.css`, no token-file edit): a scoped dark-only rule re-pins the ink dark **for tinted elements only** — the inline `style` attr is present iff a doctor tint was applied (`style={dt ? … : undefined}`), so `:root[data-theme="dark"] .cal-lane[style], … .cal-popover-row[style] { --cal-ink: oklch(22% …); --cal-ink-2: oklch(40% …); }` (the light-theme ink values). Neutral lanes keep the themed ink on the themed surface; wrapped in `@media screen` so print is untouched. Custom-prop inheritance does the rest (the name/proc rules consume `var(--cal-ink)` from the nearest defining ancestor).

### Side-fix — Visits notes/next-visit callouts in dark (2026-06-11)

User flagged the visit **Notes** field background as "ugly in dark mode" (`/patient/:id/visits`). Root cause: `.notesSection`/`.nextVisitSection` (VisitsComponent, a Phase-5 file) used a **flat `--warning-100`/`--info-100` fill** → a muddy `#3a2a12` brown block in dark. Reworked both to a **subtle `-50` tint + a colored left-accent border** (`border-left: 3px solid var(--warning-400)`/`var(--info-500)`) — a clean callout that reads well in both themes (text stays `--warning-900`/`--info-700/800`, which contrast on both the pale-light and dark-warm tints).

### Post-audit fix — `--text-muted` dark contrast (2026-06-11)

User reported the Integrations settings card's **Status / Account** `dt` labels were
near-invisible in dark mode. Root cause was a **token-definition** defect, not a consumer
bug: `--text-muted: var(--gray-400)` in `tokens-semantic.css`, and the gray ramp inverts
in dark so `--gray-400` → `--palette-night-500` (#3a4356, the *border* tone) — unreadable
as text. It hit **8 files** (IntegrationsSettings `.row dt`, calendar-holidays, the share/
file-explorer modals, both template editors). Fixed once at the token level:
`--text-muted: var(--text-lighter)` (light value ≈ identical #999; dark auto-follows
`--text-lighter`'s `night-300` override → legible). Lesson folded into the checklist
intuition: a `--text-*` alias that rides a raw **low** `--gray-400/500` is a hidden
dark-mode trap (those invert to border tones); the mid/high grays used as text are fine.

### Phase 9 — Messaging / Media / Files (2026-06-11) ✅ — `css:types` + `typecheck:all` (exit 0) + `lint` (exit 0)

20 files. Highlights:
- **Dead code removed (per-consumer verified — resolved the real `styles` accessor incl. prop-drilled children):** WhatsAppAuth — the entire **session-restoration progress** cluster (`sessionRestorationProgress`/`progressBar`/`progressBarFill`/`progressNote`) and the **status-message** block (`statusMessage` + `.success/.error/.warning` variants + `retryBtn`) — zero references in any of the 7 whatsapp-auth consumers. (WhatsAppSend had none — every class live, incl. the dynamic `:global(.status-*)` rows.)
- **`var()` fallbacks stripped wholesale** (item 4) across the cluster. Several were *load-bearing for UNDEFINED tokens* (the Phase-3 trap) — caught by checking each token before the strip: **WorkingFilesView** `--space-3` (×2) and `--color-text-secondary` are **not defined** → replaced with the literal `12px` and the real `--text-secondary`; **FileExplorer** `--font-mono` is **not defined** → kept literal `monospace` (stripping would've broken the preview text font). LabelPreviewModal's `var(--bg-color, #ffffff)` fallback was even *wrong* (token light value is `#f4f4f9`).
- **Dark-theme fixes:** **SlideshowPlayer** `.dotActive` was `var(--surface)` — the slideshow stage is an **always-dark** radial gradient (theme-independent), so `--surface` made the active progress-dot **vanish in dark** → pinned to `var(--color-white)`. LabelPreviewModal's theme-aware shell tokens (`--bg-color`/`--bg-secondary`/`--surface`) now flip dark while its self-contained `--lpm-*` colour-coded label chips stay light by design (readable dark-text-on-light in both themes).
- **`!important` rescoped:** LabelPreviewModal `.inputError` (`border-color !important`, only there to beat `.formGroup input`'s specificity) → `input.inputError` (wins by source-order at equal specificity, no `!important`).
- **`color: white`/`#fff` → `var(--color-white)`** on filled/gradient elements throughout; **font-weight ints → tokens** everywhere. **`background: #111`** (SlotCanvas crop canvas), **`background: black`** (Videos player), the slideshow stage gradient, and the cyan crop-guide hairlines left as intentional dark-media surfaces.
- **Already-clean (no change needed):** PatientSlideshow, ShareSheet, TelegramShareModal, LocalSendShareModal — fully tokenized; the share modals' `z-index: 100010` is a documented out-stack of PhotoSwipe's `100000`, left as-is.

**⚠️ Gotcha — the `styles.X` dead-scan misses two reference mechanisms** (both cost a near-mistake): (1) **prop-drilling** — TemplateManagement/PaymentModal pass `styles={styles}` to child components, so a class "unused" in the importer is live in a child; the global `styles.X` search across *all* `public/js` is the safe scan. (2) **`composes:`** — a CSS-Modules-internal reference invisible to any `styles.X` grep (PaymentModal `.btnSm` is composed by `.btnSmPrimary`/`.btnSmDanger`). **Always grep `composes:` before deleting a "dead" class.**

### Phase 10 — Dashboards / Stats / Expenses / Payment / Templates (2026-06-11) ✅ — `css:types` + `typecheck:all` (exit 0) + `lint` (exit 0)

6 files (large — 5.1k lines total). Highlights:
- **Dead code removed (definitively verified — scoped to each module's real consumer set + `composes:` + ternary checks):**
  - **Dashboard** — the whole **Quick-Actions card** (`quickActions`/`quickActionsList`/`quickAction` + hover/`i` + all 3 media-query variants) and **Coming-Soon cards** (`comingSoon`/`comingSoon .cardIcon`/`cardFooterDisabled`) — zero refs in Dashboard.tsx (a generic name like `quickActions` collided with another module globally, but is dead in *this* module's scope).
  - **PaymentModal** — a **legacy print-receipt block (~470 lines)**: `.printOnly` + two `@media print` blocks with 25 `.receipt*`/thermal classes (self-labelled "OLD STYLES"). Confirmed dead by reading `handlePrint` — the receipt is now fetched as **template HTML** (`/api/templates/receipt/work/:id`) and printed in a **separate `window.open`**, so this module's print CSS never applies. Plus the dead `suggestion*`/`conversion*`/`suggestedPaymentBox` feature, `modalTitle`/`modalDescription`/`summaryItemDetail`/`formSection*`/`largeInput`/`currencySelect`/`autoCalculatedBadge`/`amountReadonly`. **Kept `.btnSm`** (composed) and `.positive`/`.discountNote`/`.loadingState` (live).
  - **StatisticsComponent** — `.faSpin` (component uses FA's global `fa-spin`; kept `@keyframes spin`, still used elsewhere).
  - **TemplateManagement/TemplateDesigner** — flagged classes were all **false positives** (prop-drilled `styles={styles}` to `TemplateStats`/`TemplateCard` children) → nothing removed.
- **`var()` fallbacks stripped wholesale** (all tokens verified defined first) — incl. the old `var(--primary-color, var(--success-color))`-style **nested** fallbacks (the pre-token convention where primary fell back to success/info) and `var(--shadow-sm, 0 1px 3px rgba(…))`.
- **`color: white` → `var(--color-white)`** everywhere; **`background: white` LEFT** — every one is inside `@media print` (print stays light, like the dark theme's `@media screen` guard). All 16 `!important` are inside `@media print` → legitimate, kept. **Dashboard** hard-coded `calc(50px + …)` header offsets → `calc(var(--header-height) + …)`. **font-weight ints → tokens**; TemplateManagement `9999px` → `--radius-full`.

### Phase 11 — Pinned-light (2026-06-11) ✅ — structure-only, NO dark tokens

2 files. Both are intentionally **outside** the theme system; respected the pin.
- **ChairDisplay** (kiosk) — forces light on mount (`applyResolvedTheme('light')` in ChairDisplay.tsx), so its self-contained **hardcoded light palette** (`#1f2933`/`#6c757d`/etc., 13 hex) is correct and was **left untouched**. Structural cleanup only: stripped the 5 `var(--primary-color, #007bff)` fallbacks (safe — `--primary-color` resolves to `#007bff` under the forced-light root) and tokenized font-weights.
- **portal** — header comment declares it *"standalone… no shared tokens"*; it has **no `var()`, no `!important`, no dead classes** (every class live across the portal tree, all imported as `styles`). Nothing to change — already clean by its own design constraints. **No tokens introduced** (would violate the standalone-by-design intent + the pin).

**🎉 CSS audit COMPLETE — all 11 phases done (2026-06-11).**
