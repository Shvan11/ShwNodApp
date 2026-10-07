/**
 * Which screen a pathname is, as a key into the `common:titles.*` catalog.
 *
 * The browser tab, the history menu and a screen reader all name a page by its
 * title, and every screen used to share one: the clinic's name. Three patient
 * tabs read the same, and a route change announced nothing (audit FE-F25-7).
 *
 * Pure and import-free so it runs in the gate without a DOM. The patient's name
 * and the clinic's name are added by the caller (`UniversalHeader`).
 */

export const ROUTE_TITLE_KEYS = [
    'dashboard',
    'appointments',
    'calendar',
    'patientSearch',
    'expenses',
    'statistics',
    'videos',
    'labTracking',
    'tasksHistory',
    'approvalsHistory',
    'templates',
    'templateDesigner',
    'whatsappSend',
    'sendMessage',
    'whatsappAuth',
    'settings',
    'aligners',
    'alignerSets',
    'alignerSearch',
    'alignerArchform',
    'alignerAnnouncements',
    'stand',
    'standInventory',
    'standPos',
    'standSales',
    'standReports',
    'works',
    'newWork',
    'editWork',
    'diagnosis',
    'patientInfo',
    'editPatient',
    'addPatient',
    'patientAppointments',
    'newAppointment',
    'editAppointment',
    'visits',
    'newVisit',
    'editVisit',
    'photos',
    'photoEditor',
    'compare',
    'slideshow',
    'xrays',
    'scans',
    'files',
] as const;

export type RouteTitleKey = (typeof ROUTE_TITLE_KEYS)[number];

/** `/patient/:id/<page>/…` — the second segment names the screen. */
const PATIENT_PAGES: Record<string, RouteTitleKey> = {
    works: 'works',
    'new-work': 'newWork',
    'patient-info': 'patientInfo',
    'edit-patient': 'editPatient',
    appointments: 'patientAppointments',
    'new-appointment': 'newAppointment',
    'edit-appointment': 'editAppointment',
    visits: 'visits',
    'new-visit': 'newVisit',
    photos: 'photos',
    'photo-editor': 'photoEditor',
    compare: 'compare',
    slideshow: 'slideshow',
    xrays: 'xrays',
    scans: 'scans',
    files: 'files',
    'working-files': 'files',
};

/** Exact paths, then the sections whose sub-paths share one title. */
const EXACT: Record<string, RouteTitleKey> = {
    '/': 'dashboard',
    '/dashboard': 'dashboard',
    '/appointments': 'appointments',
    '/calendar': 'calendar',
    '/patient-management': 'patientSearch',
    '/expenses': 'expenses',
    '/statistics': 'statistics',
    '/videos': 'videos',
    '/lab-tracking': 'labTracking',
    '/tasks/history': 'tasksHistory',
    '/approvals/history': 'approvalsHistory',
    '/send': 'whatsappSend',
    '/send-message': 'sendMessage',
    '/auth': 'whatsappAuth',
    '/aligner': 'aligners',
    '/aligner/all-sets': 'alignerSets',
    '/aligner/search': 'alignerSearch',
    '/aligner/archform-match': 'alignerArchform',
    '/aligner/announcements': 'alignerAnnouncements',
    '/stand': 'stand',
    '/stand/inventory': 'standInventory',
    '/stand/pos': 'standPos',
    '/stand/sales': 'standSales',
    '/stand/reports': 'standReports',
};

const PREFIXES: Array<[string, RouteTitleKey]> = [
    ['/settings', 'settings'],
    ['/templates/designer', 'templateDesigner'],
    ['/templates', 'templates'],
    // /aligner/patient/:workId and /aligner/doctor/:doctorId[/patient/:workId]
    ['/aligner/patient', 'alignerSets'],
    ['/aligner/doctor', 'aligners'],
];

/**
 * @param search The location's query string. Two forms serve both "new" and "edit":
 *   `new-work?workId=` edits that work, `new-visit?visitId=` edits that visit.
 */
export function routeTitleKey(pathname: string, search = ''): RouteTitleKey | null {
    const path = pathname.replace(/\/+$/, '') || '/';

    const exact = EXACT[path];
    if (exact) return exact;

    const patient = path.match(/^\/patient\/([^/]+)(?:\/([^/]+))?(?:\/[^/]+)?(?:\/([^/]+))?/);
    if (patient) {
        const [, id, page, tail] = patient;
        // /patient/new/add is the only screen a not-yet-saved patient has.
        if (id === 'new') return 'addPatient';
        // /patient/:id/work/:workId/diagnosis. A bare /patient/:id/work redirects to works.
        if (page === 'work') return tail === 'diagnosis' ? 'diagnosis' : 'works';
        const query = new URLSearchParams(search);
        if (page === 'new-work' && query.has('workId')) return 'editWork';
        if (page === 'new-visit' && query.has('visitId')) return 'editVisit';
        // A bare /patient/:id redirects to the works page.
        return PATIENT_PAGES[page ?? 'works'] ?? null;
    }

    for (const [prefix, key] of PREFIXES) {
        if (path === prefix || path.startsWith(`${prefix}/`)) return key;
    }
    return null;
}

/**
 * Screens that render their own visible `<h1>`. Every other screen gets a
 * visually-hidden one from `RootLayout`, so each page has exactly one heading that
 * names it. The clinic's name in the header used to be that `<h1>` on all of them,
 * which told a screen-reader user where they were on none (audit FE-F25-9).
 *
 * Keep it in step with the screens: a page that gains an `<h1>` joins this set, one
 * that loses it leaves. Only an `<h1>` that is ALWAYS painted counts: the booking
 * form has one that its stylesheet hides on a wide screen, so it is not listed. Getting it wrong costs a duplicate or a missing heading,
 * which `scripts/e2e/a11y-sweep.mjs axe` reports as `page-has-heading-one`.
 */
const SCREENS_WITH_OWN_HEADING: ReadonlySet<RouteTitleKey> = new Set<RouteTitleKey>([
    'expenses',
    'statistics',
    'videos',
    'labTracking',
    'tasksHistory',
    'approvalsHistory',
    'diagnosis',
    'templateDesigner',
    'whatsappAuth',
    'stand',
    'standInventory',
    'standPos',
    'standSales',
    'standReports',
]);

/** The title key `RootLayout` should render as the screen's hidden `<h1>`, or null. */
export function screenHeadingKey(pathname: string, search = ''): RouteTitleKey | null {
    const key = routeTitleKey(pathname, search);
    return key && !SCREENS_WITH_OWN_HEADING.has(key) ? key : null;
}

/**
 * The full document title: most specific part first, so it survives a narrow tab.
 * Empty parts are dropped; with none at all the caller leaves the title alone.
 */
export function composeDocumentTitle(parts: Array<string | null | undefined>): string {
    return parts
        .map((p) => p?.trim())
        .filter((p): p is string => Boolean(p))
        .join(' · ');
}
