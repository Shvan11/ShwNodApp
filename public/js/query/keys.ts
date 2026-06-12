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

export const qk = {
  patient: {
    /** Parent — invalidates info/full/works/timepoints for this patient. */
    all: (id: Id) => ['patient', id] as const,
    /** GET /api/patients/:id/info — demographics (incl. estimated_cost, xrays). */
    info: (id: Id) => ['patient', id, 'info'] as const,
    /** GET /api/patients/:id — patientById (edit form; a DIFFERENT endpoint). */
    full: (id: Id) => ['patient', id, 'full'] as const,
    /** GET /api/getworks?code= — the patient's works list. */
    works: (id: Id) => ['patient', id, 'works'] as const,
    /** GET /api/patients/:id/timepoints — photos/compare/xrays timepoints. */
    timepoints: (id: Id) => ['patient', id, 'timepoints'] as const,
  },
  work: {
    /** Parent — invalidates details/visits/payments for this work. */
    all: (workId: Id) => ['work', workId] as const,
    /** GET /api/getworkdetails?workId= — single work row. */
    details: (workId: Id) => ['work', workId, 'details'] as const,
    /** GET /api/getvisitsbywork?workId= — visit list for a work. */
    visits: (workId: Id) => ['work', workId, 'visits'] as const,
    /** GET /api/getworkpayments?workId= — payment history for a work. */
    payments: (workId: Id) => ['work', workId, 'payments'] as const,
    /** GET /api/getlatestwires?workId= — most-recent wires for a work. */
    latestWires: (workId: Id) => ['work', workId, 'latest-wires'] as const,
  },
  visit: {
    /** GET /api/getvisitbyid?visitId= — single visit row (edit form). */
    byId: (visitId: Id) => ['visit', visitId] as const,
  },
  appointments: {
    /** GET /api/getDailyAppointments?AppsDate= — keeps the legacy key shape. */
    daily: (date: string) => ['daily-appointments', date] as const,
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
  },
} as const;
