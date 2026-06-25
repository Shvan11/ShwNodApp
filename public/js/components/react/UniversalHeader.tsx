import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation, useNavigation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useGlobalState } from '../../contexts/GlobalStateContext';
import { patientInfoQuery, brandingQuery } from '@/query/queries';
import { ROLES } from '@shared/auth/roles';
import TasksBell from './TasksBell';
import ApprovalsBell from './ApprovalsBell';
import MyApprovalsBadge from './MyApprovalsBadge';
import ThemeToggle from './ThemeToggle';
import UserMenu from './UserMenu';

// sessionStorage key for the sticky patient tab — per-tab-session only (survives
// in-app navigation + a refresh, cleared on tab/browser close, never shared to
// other tabs). Deliberately NOT localStorage, so it stays temporary.
const STICKY_PATIENT_KEY = 'stickyPatientTab';

// Fallback shown in the logo slot when no clinic name has been configured yet
// (a JS constant, not JSX — so it's the seed default, never a hardcoded brand in
// the rendered tree). Each deployment sets its own name/logo in Settings → General.
const DEFAULT_CLINIC_NAME = 'Shwan Orthodontics';

interface Patient {
    code: string | number;
    name: string;
    [key: string]: unknown;
}

interface User {
    username: string;
    fullName?: string;
    role: string;
}

interface NavigationItem {
    key: string;
    label: string;
    icon: string;
    onClick: () => void;
    isActive: boolean;
    // True while React Router is navigating to this item's destination (loader in
    // flight). Drives the per-button spinner so a click gives instant feedback.
    isPending: boolean;
    disabled?: boolean;
}

const UniversalHeader = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const navigation = useNavigation();
    const { t } = useTranslation('common');

    // The path React Router is navigating TO while a route loader runs (null when
    // idle). With v7_startTransition the current screen stays mounted until the
    // loader resolves, so on a slow load a nav click otherwise looks dead — this
    // drives a spinner on the specific button whose destination is loading.
    const pendingPath = navigation.location?.pathname ?? null;
    const pendingPatientCode = pendingPath?.match(/\/patient\/(\d+)/)?.[1] ?? null;
    // GlobalState already fetches /api/auth/me and exposes the user, so the
    // header reads it from there instead of making its own duplicate request.
    const { user } = useGlobalState();

    // Clinic branding (logo + display name) — configured in Settings → General,
    // shared by all users. Cached with a long staleTime, so after first paint it
    // never refetches on navigation. Until it resolves, the name fallback shows.
    const { data: branding } = useQuery(brandingQuery());
    const clinicName = branding?.clinicName || DEFAULT_CLINIC_NAME;

    // Patient code from the URL (/patient/:code/...). Tells us whether we're
    // *currently* on a patient page and drives the last-sub-view persistence.
    const patientCode = location.pathname.match(/\/patient\/(\d+)/)?.[1] ?? null;

    // Sticky patient tab: keep the last-opened patient as a clickable tab even after
    // navigating away (Dashboard/Appointments/Search), until a different patient is
    // opened or the user closes it. Seeded from sessionStorage so it survives a
    // refresh within this tab (but not a browser close / new tab — see STICKY_PATIENT_KEY).
    const [stickyCode, setStickyCode] = useState<string | null>(
        () => sessionStorage.getItem(STICKY_PATIENT_KEY)
    );

    // Opening a patient promotes it to the sticky tab (replacing any previous one).
    // Render-phase keyed guard — the repo's idiom for "adjust state from a changing
    // value" (NOT a setState-in-effect); the `!== stickyCode` guard makes it idempotent.
    if (patientCode && patientCode !== stickyCode) {
        setStickyCode(patientCode);
    }

    // True while we're on the represented patient's own page (tab is the active
    // location indicator). When false the tab is a backgrounded shortcut and shows
    // a close button.
    const onPatientRoute = patientCode != null;

    // The patient the tab represents: the one we're viewing, else the sticky one.
    const activeCode = patientCode ?? stickyCode;

    // Patient demographics from the shared React Query cache — the SAME key
    // PatientShell uses on every patient sub-route, so this resolves from cache
    // (no duplicate request, flash-free name) and refreshes live whenever a patient
    // mutation invalidates qk.patient.info. The observer stays subscribed to the
    // sticky patient after navigating away, so the name persists in the tab.
    const { data: patient } = useQuery({
        ...patientInfoQuery(activeCode ?? ''),
        enabled: activeCode != null,
    });

    // Header view-shapes, derived in render (compiler-memoized).
    const currentPatient: Patient | null = patient
        ? { ...patient, code: patient.person_id, name: patient.patient_name ?? '' }
        : null;
    const currentUser: User | null = user
        ? {
            username: user.username ?? '',
            role: user.role ?? '',
            fullName: typeof user.fullName === 'string' ? user.fullName : undefined,
        }
        : null;

    // True only while navigating to the patient's page from elsewhere (not when
    // switching sub-tabs already on that patient) — drives the patient tab's
    // pending spinner, mirroring the main nav buttons' blocking-loader feedback.
    const patientTabPending =
        !onPatientRoute && currentPatient != null && String(currentPatient.code) === pendingPatientCode;

    // Remember the last patient sub-view (works/photos/diagnosis/visits/payments…)
    // so the header's patient button returns there instead of always jumping to
    // photos. Keyed per patient code; stores pathname + search to preserve deep
    // state (e.g. the active timepoint slot).
    const patientViewKey = (code: string | number) => `lastPatientView:${code}`;

    const rememberPatientView = () => {
        // Only persist real sub-pages, not the bare /patient/:code redirect shell.
        if (patientCode && /\/patient\/\d+\/.+/.test(location.pathname)) {
            sessionStorage.setItem(patientViewKey(patientCode), location.pathname + location.search);
        }
    };

    const navigateToPatient = (patientCode: string | number) => {
        // Return to the patient's last-viewed section (works, diagnosis, visits,
        // payments, photos…) if we've recorded one; otherwise default to photos.
        const lastView = sessionStorage.getItem(patientViewKey(patientCode));
        navigate(lastView ?? `/patient/${patientCode}/photos/tp0`);
    };

    const closePatientTab = () => {
        // Forget the sticky patient. Only reachable while backgrounded (no patient
        // route active), so there's nothing to navigate away from — the tab just
        // disappears until the next patient is opened.
        setStickyCode(null);
    };

    const navigateToDashboard = () => {
        navigate('/dashboard');
    };

    const navigateToAppointments = () => {
        // Restore last viewed date or default to today
        const lastDate = sessionStorage.getItem('lastAppointmentDate');

        if (lastDate) {
            navigate(`/appointments?date=${lastDate}`);
        } else {
            // Default to today for first visit
            const today = new Date();
            const year = today.getFullYear();
            const month = String(today.getMonth() + 1).padStart(2, '0');
            const day = String(today.getDate()).padStart(2, '0');
            const dateParam = `${year}-${month}-${day}`;
            navigate(`/appointments?date=${dateParam}`);
        }
    };

    const navigateToPatientManagement = () => {
        // Restore last search params if available
        const lastSearch = sessionStorage.getItem('lastPatientSearch');
        if (lastSearch) {
            navigate(`/patient-management?${lastSearch}`);
        } else {
            navigate('/patient-management');
        }
    };

    // Header navigation items configuration. Each item owns one `match(pathname)`
    // predicate so the SAME rule drives both the active highlight (current path)
    // and the pending spinner (the path being navigated to).
    const getNavigationItems = (): NavigationItem[] => {
        const items = [
            {
                key: 'dashboard',
                label: t('nav.dashboard'),
                icon: 'fas fa-home',
                onClick: navigateToDashboard,
                match: (p: string) => p === '/' || p === '/dashboard',
            },
            {
                key: 'appointments',
                label: t('nav.appointments'),
                icon: 'fas fa-calendar-alt',
                onClick: navigateToAppointments,
                match: (p: string) => p.includes('/appointment'),
            },
            {
                key: 'search',
                label: t('nav.search'),
                icon: 'fas fa-search',
                onClick: navigateToPatientManagement,
                match: (p: string) => p.includes('/patient-management'),
            },
        ];

        return items.map(({ match, ...item }) => ({
            ...item,
            isActive: match(location.pathname),
            isPending: pendingPath != null && match(pendingPath),
        }));
    };

    // Persist the last-viewed patient sub-page on navigation (a sessionStorage
    // side effect). Declared below its helper for the React Compiler's
    // declare-before-use immutability rule.
    useEffect(() => {
        rememberPatientView();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.pathname, location.search]);

    // Mirror the sticky patient into sessionStorage so it survives a refresh within
    // this tab. I/O only (no setState) → doesn't trip react-hooks/set-state-in-effect.
    useEffect(() => {
        if (stickyCode) {
            sessionStorage.setItem(STICKY_PATIENT_KEY, stickyCode);
        } else {
            sessionStorage.removeItem(STICKY_PATIENT_KEY);
        }
    }, [stickyCode]);

    return (
        <header className="universal-header">
            <div className="header-container">
                {/* Left region — clinic logo (or name fallback), home shortcut */}
                <div className="header-left">
                    <div
                        className="logo-section"
                        role="button"
                        tabIndex={0}
                        aria-label={t('nav.home')}
                        onClick={() => navigate('/')}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/'); } }}
                    >
                        {branding?.logo ? (
                            <img className="clinic-logo" src={branding.logo} alt={clinicName} />
                        ) : (
                            <h1 className="clinic-name">{clinicName}</h1>
                        )}
                    </div>
                </div>

                {/* Center region — main navigation tabs (+ the sticky patient tab) */}
                <div className="header-center">
                    <nav className="main-navigation">
                        {getNavigationItems().map(item => (
                            <button
                                key={item.key}
                                className={`nav-btn ${item.isActive ? 'active' : ''} ${item.isPending ? 'pending' : ''} ${item.disabled ? 'disabled' : ''}`}
                                // While this button's destination is mid-load, swallow
                                // re-clicks: re-navigating would abort and restart the
                                // in-flight loader (slower, not faster). Other tabs still work.
                                onClick={item.isPending ? undefined : item.onClick}
                                disabled={item.disabled}
                                aria-busy={item.isPending || undefined}
                            >
                                <i className={item.isPending ? 'fas fa-spinner fa-spin' : item.icon} aria-hidden="true" />
                                <span>{item.label}</span>
                            </button>
                        ))}

                        {/* Current / sticky patient tab — stays put across screens
                            until another patient is opened or it's closed. Highlighted
                            (active) while on that patient's page; a backgrounded
                            shortcut with a close button anywhere else. */}
                        {currentPatient && (
                            <div className="patient-nav-wrap">
                                <button
                                    className={`nav-btn patient-nav ${onPatientRoute ? 'active' : ''} ${patientTabPending ? 'pending' : ''}`}
                                    onClick={patientTabPending ? undefined : () => navigateToPatient(currentPatient.code)}
                                    aria-busy={patientTabPending || undefined}
                                >
                                    <i className={patientTabPending ? 'fas fa-spinner fa-spin' : 'fas fa-user'} aria-hidden="true" />
                                    <span>{currentPatient.name}</span>
                                    {/* Close chip lives inside the tab (browser-tab style); can't be a
                                        nested <button>, so it's a role=button span that stops the click
                                        from bubbling to the tab's navigate handler. */}
                                    {!onPatientRoute && !patientTabPending && (
                                        <span
                                            role="button"
                                            tabIndex={0}
                                            className="patient-nav-close"
                                            aria-label={t('nav.closePatient')}
                                            title={t('nav.closePatient')}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                closePatientTab();
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    closePatientTab();
                                                }
                                            }}
                                        >
                                            <i className="fas fa-times" />
                                        </span>
                                    )}
                                </button>
                            </div>
                        )}
                    </nav>
                </div>

                {/* Right region — notifications, theme, and the account menu (corner) */}
                <div className="header-right">
                    {/* App-wide tasks bell */}
                    <TasksBell />

                    {/* Maker-checker approval queue: admin sees all pending holds + notices;
                        front-desk sees their own submissions and their outcome. */}
                    {user?.role === ROLES.ADMIN && <ApprovalsBell />}
                    {user?.role === ROLES.FRONT_DESK && <MyApprovalsBadge />}

                    {/* Theme toggle — sliding Light ⇄ Dark pill (system default lives in Settings) */}
                    <ThemeToggle />

                    {/* Current User — click to open account menu (Change password / Log out) */}
                    {currentUser && <UserMenu user={currentUser} />}
                </div>
            </div>
        </header>
    );
};

export default UniversalHeader;
