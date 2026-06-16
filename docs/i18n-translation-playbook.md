# i18n Translation Playbook — translate a module to Arabic FAST

**Purpose:** start *coding* immediately when asked to "make `<module>` Arabic". The infra is
already built (react-i18next + postcss-rtlcss + Cairo font + FOUC). Do NOT re-investigate
architecture — it's all captured here. Canonical worked example: **Expense Management**
(`expenses` namespace, the `/expenses` route + 5 components) — copy its shape.

> Full background lives in CLAUDE.md → "i18n / RTL". This file is the **do-it-now** checklist.

---

## The 9-step recipe (happy path)

For a module with route `/<mod>` and components `<Comp>.tsx`:

1. **Create EN catalog** `public/js/locales/en/<ns>.json` — every user-facing string, nested by area (`filters.*`, `table.*`, `modal.*`, `toast.*`, …). English is the SSoT.
2. **Create AR catalog** `public/js/locales/ar/<ns>.json` — **identical key structure** (MUST cover EN exactly, or typecheck fails).
3. **Register the namespace** in `public/js/i18n/index.ts` — 4 edits (see snippet below).
4. **Translate each component**: add `const { t } = useTranslation('<ns>');`, replace every literal with `t('key')`. (Hook goes **before** any early `return`.)
5. **Sync point 1 — eslint ratchet**: add every translated `.tsx` to the `files:` list in the i18n block of `eslint.config.js`.
6. **Sync point 2 — RTL route**: add `'/<mod>'` to `RTL_ROUTES` in `public/js/core/language.ts`.
7. **Sync point 3 — FOUC**: add the route to the `rtlRoute` check in `public/index.html`.
8. **Verify**: `npm run typecheck:all` (AR-covers-EN parity + key validity) then `npx eslint <files>` (no missed literals). Both must be exit 0.
9. **Update docs**: bump the catalog list + rollout sentence in CLAUDE.md's i18n section; update memory `i18n-rtl-infra`.

Forgetting a sync point fails *silently at runtime*, not at the gate:
- miss #5 → ratchet won't protect the file (raw strings can sneak back later)
- miss #6 → page stays LTR in Arabic (visible bug)
- miss #7 → flash of LTR on hard-reload before JS boots

---

## Snippets (copy-paste)

### Step 3 — register namespace in `public/js/i18n/index.ts`
```ts
import enExpenses from '../locales/en/expenses.json';   // (1) import EN
import arExpenses from '../locales/ar/expenses.json';   //     import AR

export const resources = {
  en: { common: enCommon, dashboard: enDashboard, expenses: enExpenses },  // (2) add to en
  ar: { common: arCommon, dashboard: arDashboard, expenses: arExpenses },  //     add to ar
} as const;

// in init(): ns: ['common', 'dashboard', 'expenses'],                     // (3) add to ns[]

const _arCoversEn: {                                                       // (4) parity ratchet
  common: typeof enCommon;
  dashboard: typeof enDashboard;
  expenses: typeof enExpenses;   // <-- add the new ns here too
} = resources.ar;
```
`i18next.d.ts` needs **no** change — it types `t()` against `typeof resources['en']` automatically.

### Step 5 — `eslint.config.js` (the block commented `// i18n ratchet (lock-in)`)
Append your files to the existing `files:` array. The rule options (incl. the
`jsx-attributes.exclude` for modal structural attrs) are already set — don't touch them
unless a NEW non-user-facing attribute on a shared component trips it.

### Step 6 — `public/js/core/language.ts`
```ts
export const RTL_ROUTES: readonly string[] = ['/dashboard', '/expenses', '/<mod>'];
```

### Step 7 — `public/index.html` (FOUC script, ~line 40)
```js
var rtlRoute = (p === '/' || p === '/dashboard' || p === '/expenses' || p === '/<mod>');
// for nested routes also: || p.indexOf('/<mod>/') === 0
```

---

## What to translate vs leave alone

**Translate (all user-facing):**
- JSX text: `<h1>Expense Management</h1>` → `<h1>{t('title')}</h1>`
- DOM attrs `placeholder` / `alt` / `aria-label` / `title` (these ARE lint-checked)
- **Toasts** `toast.success('…')` and **validation messages** (`newErrors.x = '…'`) — these are JS strings, NOT JSX, so the lint rule does **NOT** catch them, but they're user-facing → translate anyway. Easy to miss.
- Computed titles: `const modalTitle = isEditMode ? t('modal.editTitle') : t('modal.addTitle')`
- Interpolation: `t('errorLoading', { error })` against `"errorLoading": "… {{error}}"`

**Leave as literals (don't translate):**
- Currency codes `IQD` / `USD`, ALL-CAPS tokens — auto-excluded by `[A-Z_-]+`.
- Punctuation-only text (`*`, `:`, `-`) — auto-excluded.
- `className` / `id` / `htmlFor` / icon `fa-*` classes.
- **Shared-component structural attrs**: `titleId`, `ariaLabelledBy` (id refs), `variant`
  (design-system enum) on `<Modal>`/`<ModalHeader>` — non-user-facing, already allowlisted
  in the ratchet's `jsx-attributes.exclude`.
- Number/date formatting — keep `Intl.NumberFormat('en-US')` / `toLocaleDateString()`.
  **Western digits in both languages** is a deliberate product decision (money round-trip);
  do NOT switch to Arabic-Indic digits.

---

## How the lint rule actually works (so you don't re-dig node_modules)

`eslint-plugin-i18next/no-literal-string`, `mode: 'jsx-only'`. Per JSX attribute:
1. if attr name ∈ `jsx-attributes.exclude` → **skip** (allowed). Our list:
   `className, styleName, style, type, key, id, width, height, titleId, ariaLabelledBy, variant`.
2. else if it's a **native DOM tag** (`div`, `input`, `button`…) → allowed UNLESS attr ∈
   `[placeholder, alt, aria-label, value, title]` (those stay checked).
3. else (a **custom component** like `<ModalHeader>`) → **every** literal attr is flagged
   unless it's in the exclude list from (1). ← this is why modal props need the allowlist.

JSX **text** is always checked (minus the `words.exclude` patterns: punctuation, ALL-CAPS,
`Shwan Orthodontics`). The options merge is shallow `_.defaults` — providing `words` or
`jsx-attributes` **replaces** that key's default wholesale (that's why our `jsx-attributes`
exclude re-lists the 8 plugin defaults + our 3 additions).

---

## RTL / CSS — usually nothing to do

postcss-rtlcss runs in **override mode** automatically: physical props (`margin-left`,
`padding-left`, `left/right`, `text-align`…) get auto-generated `[dir="rtl"]` overrides on
any `dir="rtl"` ancestor. You do **not** hand-write RTL CSS.
- Prefer logical props in new CSS (`margin-inline-start`), but auto-flip handles physical too.
- Hand-written `[dir="rtl"]` rules are **skipped** by the transformer (left verbatim) — e.g.
  `.noteCell` in `Expenses.module.css` forces notes RTL on purpose; that's fine.
- Escape hatch: `/*rtl:ignore*/`. Never set Vite `css.transformer:'lightningcss'` (skips PostCSS).

---

## Verify

```bash
npm run typecheck:all        # AR-covers-EN parity (_arCoversEn) + every t() key valid. Exit 0.
npx eslint <the .tsx files>  # ratchet: no missed JSX literal. Exit 0.
```
Optional visual check (dev server, Vite :5273 on WSL): toggle language to Arabic in Settings →
General, navigate to `/<mod>`, confirm strings + RTL layout. Dev is live (no build); the phone/
prod `:3000` needs `npm run build` first. Delete any Playwright screenshots afterward.

---

## Gotchas checklist (the ones that bite)

- [ ] AR catalog structurally **identical** to EN (missing key = `_arCoversEn` typecheck error).
- [ ] `useTranslation('<ns>')` with the right **namespace**; use **bare** keys (`t('table.date')`), never `t('ns:table.date')` — the typed `t` rejects the prefixed form.
- [ ] Hook called **before** any early `return null` (Rules of Hooks).
- [ ] Toasts + validation strings translated (lint won't remind you — they're not JSX).
- [ ] All 3 sync points done (eslint files / RTL_ROUTES / index.html FOUC).
- [ ] Currency codes & ALL-CAPS left as literals; digits stay Western.
- [ ] DB-stored lookup values handled per the section below (NOT via `t()`).
- [ ] Docs + memory updated.

---

# Translating DB-stored lookup values (categories, types, statuses…)

**STANDARD PATTERN — every module that displays lookup-table values follows this.** UI
chrome goes in `t()` catalogs (above); lookup **values** (expense categories, patient
types, referral sources, …) are **clinic-owned data** edited per-deployment via the
Lookups admin, so they CANNOT live in build-time catalogs. First implementation:
**Expense Management** (`expense_categories.category_name_ar`) — copy its shape.

## The rule: sort each lookup value into one of two kinds
- **Controlled vocabulary** (Food, Office, Lab, "New patient", …) → **translate** via the
  `*_name_ar` column below.
- **Proper-noun / free data** (employee names, supplier names, brand/lab names like
  "e.max", "Atalay") → **never translate**; leave `*_name_ar` NULL → it falls back to the
  base value. Extra trap: rows **auto-synced from another table** (e.g. expense
  subcategories under the "Employees" category are mirrored from `employees`, which writes
  only the base name) — a hand-set `*_name_ar` there goes **stale on rename**, so leave blank.

## The mechanism (zero query/perf cost — this is the key design choice)
Add a nullable `*_name_ar` **beside** the base `*_name`. The read layer returns **both
columns in the same query** (one extra column, same JOINs — no new query, no per-language
SQL, no index/`WHERE` change). The **client** picks which to show via `useLocalizedName()`.
Resolving client-side keeps the server language-agnostic: **no `?lang=` plumbing, no
React-Query cache split, instant re-label on language toggle with no refetch.** (A
server-side `COALESCE(name_ar,name)+?lang` would double the cache & refetch on toggle; a
normalized `translations` table adds a JOIN per read — both rejected for this reason.)

## The recipe (per lookup table) — all type-checked end to end
1. **DDL on BOTH DBs** (additive, `ADD COLUMN … citext` nullable — metadata-only, instant,
   no rewrite). The table is CDC-captured, so the Supabase mirror MUST get the column too
   or the failover upsert silently drops the field — **apply Supabase first**, then local.
   Use `scripts/psql.sh supa` / `scripts/psql.sh local`. Record it as a `migrations/pg/*`
   + `migrations/supabase/*` pair (the squashed-baseline state means these are applied by
   psql, not `db:migrate` — see memory `db-migration-squash-state`).
2. **`npm run db:codegen`** — regenerates `types/db.d.ts` (the new column → `string | null`).
3. **Queries** (`services/database/queries/<mod>-queries.ts`): add `*_name_ar` to every
   SELECT that returns the base name (list JOINs, by-id, the categories/subcategories
   lists) + the `type` return aliases. (Aggregates that GROUP BY the name, e.g. summary,
   can stay as-is if they don't display per-row names.)
4. **Contract** (`shared/contracts/<mod>.contract.ts`): add `*_name_ar: z.string().nullable()`
   to the row schemas (they're `looseObject`, but adding it makes the client type-aware).
5. **Lookup admin** (`services/database/queries/lookup-admin-queries.ts`): add one
   `{ name:'*_name_ar', label:'… (Arabic)', type:'nvarchar', required:false }` to that
   table's `columns`. Generic CRUD + the editor wire it up — **no contract change** (admin
   bodies are `looseObject` by design).
6. **Frontend:** `const localizedName = useLocalizedName()` (`public/js/hooks/useLocalizedName.ts`)
   then `localizedName(row.name, row.name_ar)` everywhere the value renders (table cells,
   `<option>` labels, detail modals). Add `name_ar?: string | null` to any hand-written
   row interface the component/hook declares.
7. **Seed** (optional, clinic-specific — there's NO seeding mechanism, so this is a manual
   `UPDATE … WHERE id=…` by row, applied to both DBs or local-only + let failover mirror).
   Translate controlled-vocab rows; leave proper-noun/auto-synced rows NULL.

## Verify
`npm run typecheck:all` (Kysely SELECT ↔ `db.d.ts` ↔ contract ↔ component all agree) +
`npm run lint`. Both exit 0.
