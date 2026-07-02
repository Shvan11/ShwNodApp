/**
 * Query-key factory — the single source of truth for every TanStack Query key in
 * the staff app (replaces the string keys in the old router/loader-cache.ts).
 *
 * Keys are hierarchical arrays so a parent key invalidates its children by
 * prefix match. The headline example: after any work mutation,
 *   queryClient.invalidateQueries({ queryKey: qk.patient.all(personId) })
 * refetches info + works + timepoints for that patient in one call — which is how
 * the old "forgot to invalidate the works list" cross-domain gap closes for free.
 *
 * Loaders and components both build keys here; a key can never silently drift
 * between the prefetch site and the read site.
 */

type Id = number | string;

/**
 * Canonicalize an entity id to a string before it becomes a key segment.
 *
 * The same patient flows in as a `number` from some call sites (`work.person_id`,
 * `selectedPatient.person_id`) and as a `string` from others (the `/patient/:id`
 * URL param that PatientShell/UniversalHeader/ViewPatientInfo/Xrays read). React
 * Query matches keys by deep equality, so `7 !== '7'` would (a) fork the same
 * patient into two cache entries and (b) make a number-keyed invalidation miss a
 * string-keyed read. Coercing here — at the SSoT — means every consumer collapses
 * onto one entry and `qk.patient.all(id)` prefix-matches regardless of which type
 * the caller happened to hold.
 */
const normId = (id: Id): string => String(id);

export const qk = {
  patient: {
    /** Parent — invalidates info/full/works/timepoints for this patient. */
    all: (id: Id) => ['patient', normId(id)] as const,
    /** GET /api/patients/:id/info — demographics (incl. estimated_cost, xrays). */
    info: (id: Id) => ['patient', normId(id), 'info'] as const,
    /** GET /api/patients/:id — patientById (edit form; a DIFFERENT endpoint). */
    full: (id: Id) => ['patient', normId(id), 'full'] as const,
    /** GET /api/getworks?code= — the patient's works list. */
    works: (id: Id) => ['patient', normId(id), 'works'] as const,
    /** GET /api/patients/:id/timepoints — photos/compare/xrays timepoints. */
    timepoints: (id: Id) => ['patient', normId(id), 'timepoints'] as const,
    /** GET /api/patients/:id/has-appointment — future-appointment flag. */
    hasAppointment: (id: Id) => ['patient', normId(id), 'has-appointment'] as const,
    /** GET /api/patients/:id/alerts — patient alerts list. */
    alerts: (id: Id) => ['patient', normId(id), 'alerts'] as const,
    /** GET /api/patients/:id/portal — portal-access status. */
    portal: (id: Id) => ['patient', normId(id), 'portal'] as const,
    /** GET /api/patient-appointments/:id — the patient's appointment list. */
    appointments: (id: Id) => ['patient', normId(id), 'appointments'] as const,
    /** GET /api/patients/:id/gallery/:tpCode — one timepoint's gallery images. */
    gallery: (id: Id, tpCode: Id) => ['patient', normId(id), 'gallery', normId(tpCode)] as const,
    /** GET /api/patients/:id/timepoints/:tpCode/images — one timepoint's compare images. */
    timepointImages: (id: Id, tpCode: Id) =>
      ['patient', normId(id), 'timepoint-images', normId(tpCode)] as const,
    /** Prefix over every file listing for a patient (any path/flat) — broad reload. */
    filesAll: (id: Id) => ['patient', normId(id), 'files'] as const,
    /** GET /api/patients/:id/files?path=&flat= — file-explorer listing for a folder. */
    files: (id: Id, path = '', flat = false) =>
      ['patient', normId(id), 'files', path, flat ? 'flat' : 'nested'] as const,
    /** GET /api/patients/:id/working-files — working-files listing. */
    workingFiles: (id: Id) => ['patient', normId(id), 'working-files'] as const,
    /** GET /api/patients/:id/photos/visibility — per-photo private-flag list. */
    photoVisibility: (id: Id) => ['patient', normId(id), 'photo-visibility'] as const,
    /** GET /api/photo-editor/:id/photo-dates — appointment/visit dates for the photo-session picker. */
    photoDates: (id: Id) => ['patient', normId(id), 'photo-dates'] as const,
    /** GET /api/patients/search?q= — basic name/phone/id search (keyed by query). */
    search: (query: string) => ['patient', 'search', query] as const,
  },
  work: {
    /** Parent — invalidates details/visits/payments for this work. */
    all: (workId: Id) => ['work', normId(workId)] as const,
    /** GET /api/getworkdetails?workId= — single work row. */
    details: (workId: Id) => ['work', normId(workId), 'details'] as const,
    /** GET /api/getworkforreceipt/:workId — receipt-enriched work row. */
    forReceipt: (workId: Id) => ['work', normId(workId), 'for-receipt'] as const,
    /** GET /api/getvisitsbywork?workId= — visit list for a work. */
    visits: (workId: Id) => ['work', normId(workId), 'visits'] as const,
    /** GET /api/getworkpayments?workId= — payment history for a work. */
    payments: (workId: Id) => ['work', normId(workId), 'payments'] as const,
    /** GET /api/getlatestwires?workId= — most-recent wires for a work. */
    latestWires: (workId: Id) => ['work', normId(workId), 'latest-wires'] as const,
    /** GET /api/getworkdetailslist?workId= — the work's detail (procedure) rows. */
    detailsList: (workId: Id) => ['work', normId(workId), 'details-list'] as const,
    /** GET /api/work/:workId/transfer-preview — transfer impact preview. */
    transferPreview: (workId: Id) => ['work', normId(workId), 'transfer-preview'] as const,
    /** GET /api/diagnosis/:workId — the work's diagnosis row (null when none). */
    diagnosis: (workId: Id) => ['work', normId(workId), 'diagnosis'] as const,
  },
  visit: {
    /** GET /api/getvisitbyid?visitId= — single visit row (edit form). */
    byId: (visitId: Id) => ['visit', normId(visitId)] as const,
  },
  appointments: {
    /** GET /api/getDailyAppointments?AppsDate= — keeps the legacy key shape. */
    daily: (date: string) => ['daily-appointments', date] as const,
    /** GET /api/appointments/:id — single appointment (edit form). */
    byId: (id: Id) => ['appointments', 'by-id', normId(id)] as const,
  },
  whatsapp: {
    /** WhatsApp message-status table — keeps the legacy key shape. */
    messages: (date: string) => ['whatsapp-messages', date] as const,
    /** GET message-count for a date (WhatsApp send screen). */
    messageCount: (date: string) => ['whatsapp-message-count', date] as const,
  },
  templates: {
    /** Parent — invalidates the list and every single-template entry. */
    all: () => ['templates'] as const,
    list: () => ['templates', 'list'] as const,
    one: (id: Id) => ['templates', 'one', id] as const,
    /** GET /api/templates/document-types — document-type options. */
    documentTypes: () => ['templates', 'document-types'] as const,
  },
  aligner: {
    doctors: () => ['aligner', 'doctors'] as const,
    /** GET /api/aligner-doctors — the admin doctors list (a different endpoint/shape from doctors()). */
    doctorsAdmin: () => ['aligner', 'doctors-admin'] as const,
    /** Parent for a work's aligner data (sets/batches). */
    work: (workId: Id) => ['aligner', 'work', workId] as const,
    /** GET /api/aligner/all-sets — all sets across doctors. */
    allSets: () => ['aligner', 'all-sets'] as const,
    /** GET /api/aligner/patients/all — all aligner patients. */
    allPatients: () => ['aligner', 'patients', 'all'] as const,
    /** GET /api/aligner/patients/by-doctor/:doctorId. */
    patientsByDoctor: (doctorId: Id) => ['aligner', 'patients', 'by-doctor', doctorId] as const,
    /** GET /api/aligner/patients/search?q= — aligner patient search (keyed by query). */
    search: (query: string) => ['aligner', 'patients', 'search', query] as const,
    /** GET /api/aligner/archform/patients — unmatched Archform patients. */
    archformPatients: () => ['aligner', 'archform', 'patients'] as const,
    /** GET /api/aligner/archform/matches — aligner sets available to match. */
    archformMatches: () => ['aligner', 'archform', 'matches'] as const,
  },
  /** Lookup/reference data — long-lived, rarely changes. */
  lookups: {
    genders: () => ['lookups', 'genders'] as const,
    addresses: () => ['lookups', 'addresses'] as const,
    referralSources: () => ['lookups', 'referral-sources'] as const,
    patientTypes: () => ['lookups', 'patient-types'] as const,
    tagOptions: () => ['lookups', 'tag-options'] as const,
    typeOptions: () => ['lookups', 'type-options'] as const,
    workTypes: () => ['lookups', 'work-types'] as const,
    workKeywords: () => ['lookups', 'work-keywords'] as const,
    teeth: () => ['lookups', 'teeth'] as const,
    implantManufacturers: () => ['lookups', 'implant-manufacturers'] as const,
    /** GET /api/shades — dental shade systems + values (Bridge/Veneers work items). */
    shades: () => ['lookups', 'shades'] as const,
    /** GET /api/labs — labs from the "Lab" expense subcategories (Bridge/Veneers work items). */
    labs: () => ['lookups', 'labs'] as const,
    alertTypes: () => ['lookups', 'alert-types'] as const,
    wires: () => ['lookups', 'wires'] as const,
    operators: () => ['lookups', 'operators'] as const,
    patientPhones: () => ['lookups', 'patient-phones'] as const,
    /** GET /api/doctors — doctor options (appointment/calendar filters). */
    doctors: () => ['lookups', 'doctors'] as const,
    /** GET /api/settings/cost-presets — estimated-cost preset chips. */
    costPresets: () => ['lookups', 'cost-presets'] as const,
    /** GET /api/google?source= — Google contact list (a messaging recipient source). */
    googleContacts: (source: string) => ['lookups', 'google-contacts', source] as const,
    /** GET /api/settings/patients-folder — client-facing patients folder UNC path. */
    patientsFolder: () => ['lookups', 'patients-folder'] as const,
    /** GET /api/employees<query> — keyed by query so param variants don't collide. */
    employees: (query = '') => ['lookups', 'employees', query] as const,
    /** GET /api/positions — employee-position options. */
    positions: () => ['lookups', 'positions'] as const,
    /** GET /api/appointment-details — appointment-type options. */
    appointmentDetails: () => ['lookups', 'appointment-details'] as const,
  },
  /** Admin lookup tables — the generic table editor (LookupEditor/HolidayEditor). */
  adminLookups: {
    /** Parent — invalidates the table-config list and every per-table rowset. */
    all: () => ['admin-lookups'] as const,
    /** GET /api/admin/lookups/tables — the editable-table config list. */
    tables: () => ['admin-lookups', 'tables'] as const,
    /** GET /api/admin/lookups/:tableKey — one lookup table's rows. */
    table: (tableKey: string) => ['admin-lookups', 'table', tableKey] as const,
  },
  /** USD→IQD exchange rates (PaymentModal + ExchangeRatesSettings). */
  exchangeRates: {
    all: () => ['exchange-rates'] as const,
    /** GET /api/getCurrentExchangeRate — today's rate. */
    current: () => ['exchange-rates', 'current'] as const,
    /** GET /api/getExchangeRateForDate?date= — rate for one date. */
    forDate: (date: string) => ['exchange-rates', 'for-date', date] as const,
    /** GET /api/exchange-rates?from=&to= — rate history in a range. */
    history: (from: string, to: string) => ['exchange-rates', 'history', from, to] as const,
  },
  /** Financial statistics / reports (StatisticsComponent). */
  reports: {
    statistics: (month: number, year: number, rate: number) =>
      ['reports', 'statistics', month, year, rate] as const,
    yearly: (startMonth: number, startYear: number, rate: number) =>
      ['reports', 'yearly', startMonth, startYear, rate] as const,
    multiYear: (startYear: number, endYear: number, rate: number) =>
      ['reports', 'multi-year', startYear, endYear, rate] as const,
    /** GET /api/statistics/commissions?startDate=&endDate= — per-doctor commission. */
    commissions: (startDate: string, endDate: string) =>
      ['reports', 'commissions', startDate, endDate] as const,
    /** GET /api/statistics/revenue-breakdown?startDate=&endDate= — revenue by work type & doctor. */
    revenueBreakdown: (startDate: string, endDate: string) =>
      ['reports', 'revenue-breakdown', startDate, endDate] as const,
  },
  /**
   * Stand / mini-pharmacy. `all()` is the prefix every stand read shares, so a
   * write that ripples widely (a sale touches stock + KPIs + movements) refreshes
   * the whole module with one `invalidateQueries({ queryKey: qk.stand.all() })`.
   * Filter objects ride as a key segment — RQ hashes them stably, so a freshly
   * built filters object with the same values doesn't refetch.
   */
  stand: {
    all: () => ['stand'] as const,
    items: {
      /** Parent — invalidates list / low-stock / expiring / movements. */
      all: () => ['stand', 'items'] as const,
      list: (filters: object = {}) => ['stand', 'items', 'list', filters] as const,
      lowStock: () => ['stand', 'items', 'low-stock'] as const,
      expiring: (days: number) => ['stand', 'items', 'expiring', days] as const,
      movements: (itemId: Id) => ['stand', 'items', 'movements', itemId] as const,
    },
    categories: () => ['stand', 'categories'] as const,
    dashboard: () => ['stand', 'dashboard'] as const,
    sales: {
      all: () => ['stand', 'sales'] as const,
      list: (filters: object = {}) => ['stand', 'sales', 'list', filters] as const,
      one: (id: Id) => ['stand', 'sales', 'one', id] as const,
    },
    reports: {
      summary: (startDate: string, endDate: string) =>
        ['stand', 'reports', 'summary', startDate, endDate] as const,
      topItems: (startDate: string, endDate: string, limit: number) =>
        ['stand', 'reports', 'top-items', startDate, endDate, limit] as const,
    },
  },
  /** Expenses. `all()` is the shared prefix — any expense write invalidates it. */
  expenses: {
    all: () => ['expenses'] as const,
    list: (filters: object = {}) => ['expenses', 'list', filters] as const,
    categories: () => ['expenses', 'categories'] as const,
    subcategories: (categoryId: Id) => ['expenses', 'subcategories', categoryId] as const,
    summary: (startDate: string, endDate: string) =>
      ['expenses', 'summary', startDate, endDate] as const,
    /** GET /api/expenses/:id — single expense (edit form; disabled until an id is set). */
    byId: (id: Id) => ['expenses', 'by-id', normId(id)] as const,
  },
  /** Educational videos library (Videos route). */
  videos: {
    all: () => ['videos'] as const,
    list: () => ['videos', 'list'] as const,
    categories: () => ['videos', 'categories'] as const,
  },
  /** Authenticated-user identity (GET /api/auth/me). */
  auth: {
    me: () => ['auth', 'me'] as const,
  },
  /** Application users (admin user-management screen). */
  users: {
    all: () => ['users'] as const,
    list: () => ['users', 'list'] as const,
  },
  /** App-wide tasks/alerts (header Tasks surface). */
  tasks: {
    all: () => ['tasks'] as const,
    list: () => ['tasks', 'list'] as const,
    history: () => ['tasks', 'history'] as const,
  },
  /** Maker-checker approval / notice queue. */
  approvals: {
    all: () => ['approvals'] as const,
    list: () => ['approvals', 'list'] as const,
    history: () => ['approvals', 'history'] as const,
    mine: () => ['approvals', 'mine'] as const,
  },
  /**
   * Lab case tracker. `all()` is the shared prefix — any case write invalidates
   * both the board and (via the work-card badge) `qk.work.detailsList(workId)`.
   */
  labCases: {
    all: () => ['lab-cases'] as const,
    board: (filters: object = {}) => ['lab-cases', 'board', filters] as const,
    byId: (id: Id) => ['lab-cases', 'by-id', normId(id)] as const,
  },
  /**
   * Saved slideshow configurations. `list(personId)` returns that patient's
   * saved sequences PLUS the clinic-wide generic templates (person_id NULL), so
   * any config write invalidates this one key.
   */
  slideshow: {
    all: () => ['slideshow'] as const,
    list: (personId: Id) => ['slideshow', normId(personId)] as const,
  },
  /** Settings — options, email + database config, status polls. */
  settings: {
    all: () => ['settings'] as const,
    /** GET /api/options — every option row (General settings). */
    options: () => ['settings', 'options'] as const,
    /** GET /api/options/:name — a single named option row. */
    option: (name: string) => ['settings', 'option', name] as const,
    /** GET /api/email/config — SMTP configuration. */
    emailConfig: () => ['settings', 'email-config'] as const,
    /** GET /api/settings/database — the active database connection config. */
    databaseConfig: () => ['settings', 'database-config'] as const,
    /** GET /api/sync/supabase-status — failover/reverse sink health (polled). */
    supabaseStatus: () => ['settings', 'supabase-status'] as const,
    /** GET /api/sync/dolphin-status — Dolphin sink health (polled). */
    dolphinStatus: () => ['settings', 'dolphin-status'] as const,
    /** GET /api/telegram/status — Telegram bot status. */
    telegramStatus: () => ['settings', 'telegram-status'] as const,
    /** GET /api/integrations/telegram/status — Telegram MTProto integration status. */
    integrationsTelegramStatus: () => ['settings', 'integrations-telegram-status'] as const,
    /** GET /api/integrations/3shape/status — 3Shape Unite Web Service integration status. */
    integrationsThreeShapeStatus: () => ['settings', 'integrations-3shape-status'] as const,
    /** GET /api/integrations/gemini/status — Gemini (Google GenAI) integration status. */
    integrationsGeminiStatus: () => ['settings', 'integrations-gemini-status'] as const,
    /** GET /api/wa/group-settings — WhatsApp daily-list group posting config. */
    whatsappGroupSettings: () => ['settings', 'whatsapp-group-settings'] as const,
  },
  /** Telegram — transient share-job progress poll (keyed by job id). */
  telegram: {
    /** GET /api/telegram/send/:jobId — per-file upload progress of a send job. */
    sendProgress: (jobId: string) => ['telegram', 'send-progress', jobId] as const,
  },
  /** 3Shape Unite — per-patient cases/media pulled live from the Web Service. */
  threeshape: {
    all: (id: Id) => ['threeshape', normId(id)] as const,
    /** GET /api/threeshape/patients/:id/cases */
    cases: (id: Id) => ['threeshape', normId(id), 'cases'] as const,
    /** GET /api/threeshape/patients/:id/media */
    media: (id: Id) => ['threeshape', normId(id), 'media'] as const,
  },
  /** Reports — daily-invoices modal (keyed by date). */
  dailyInvoices: (date: string) => ['daily-invoices', date] as const,
  /** Clinic branding (header logo + display name) — header + General settings. */
  branding: () => ['branding'] as const,
  /** Media — photo-type taxonomy + WebCeph patient link (WebCeph modal). */
  media: {
    photoTypes: () => ['media', 'photo-types'] as const,
    /** GET /api/webceph/patient-link/:personId — WebCeph link row (null when none). */
    webcephLink: (personId: Id) => ['media', 'webceph-link', normId(personId)] as const,
  },
  /** Calendar — month grid / stats / availability / slots (AppointmentCalendar + pickers). */
  calendar: {
    all: () => ['calendar'] as const,
    month: (params: string) => ['calendar', 'month', params] as const,
    stats: (params: string) => ['calendar', 'stats', params] as const,
    /** GET /api/calendar/range?start=&end=&doctorId= — the grid (day/week/zoom) window. */
    range: (start: string, end: string, doctorId: Id) =>
      ['calendar', 'range', start, end, normId(doctorId)] as const,
    availability: (year: number, month: number, doctorId: Id) =>
      ['calendar', 'availability', year, month, normId(doctorId)] as const,
    slots: (date: string, doctorId: Id) => ['calendar', 'slots', date, normId(doctorId)] as const,
  },
} as const;
