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
    /** Parent for a work's aligner data (sets/batches). */
    work: (workId: Id) => ['aligner', 'work', workId] as const,
    /** GET /api/aligner/all-sets — all sets across doctors. */
    allSets: () => ['aligner', 'all-sets'] as const,
    /** GET /api/aligner/patients/all — all aligner patients. */
    allPatients: () => ['aligner', 'patients', 'all'] as const,
    /** GET /api/aligner/patients/by-doctor/:doctorId. */
    patientsByDoctor: (doctorId: Id) => ['aligner', 'patients', 'by-doctor', doctorId] as const,
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
    alertTypes: () => ['lookups', 'alert-types'] as const,
    wires: () => ['lookups', 'wires'] as const,
    operators: () => ['lookups', 'operators'] as const,
    patientPhones: () => ['lookups', 'patient-phones'] as const,
    /** GET /api/employees<query> — keyed by query so param variants don't collide. */
    employees: (query = '') => ['lookups', 'employees', query] as const,
    /** GET /api/positions — employee-position options. */
    positions: () => ['lookups', 'positions'] as const,
    /** GET /api/appointment-details — appointment-type options. */
    appointmentDetails: () => ['lookups', 'appointment-details'] as const,
  },
  /** Admin lookup tables — the generic table editor (LookupEditor/HolidayEditor). */
  adminLookups: {
    /** GET /api/admin/lookups/:tableKey — one lookup table's rows. */
    table: (tableKey: string) => ['admin-lookups', tableKey] as const,
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
  },
} as const;
