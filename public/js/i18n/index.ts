/**
 * i18next initialization — side-effect module, bundled resources.
 *
 * Imported by contexts/LanguageContext.tsx (which also re-exports nothing from
 * here but needs the configured instance for changeLanguage). Importing this
 * module runs init() synchronously at module-load — well before React mounts in
 * index.html's window-load handler — so the first render already has its strings.
 *
 * Deliberately minimal: no http-backend (catalogs are bundled JSON), no
 * Suspense (resources are synchronous), no browser-languagedetector — language
 * detection is the deterministic theme-style storage read in core/language.ts.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getStoredLanguagePreference } from '../core/language';

import enCommon from '../locales/en/common.json';
import enDashboard from '../locales/en/dashboard.json';
import enExpenses from '../locales/en/expenses.json';
import enAppointments from '../locales/en/appointments.json';
import enWorks from '../locales/en/works.json';
import arCommon from '../locales/ar/common.json';
import arDashboard from '../locales/ar/dashboard.json';
import arExpenses from '../locales/ar/expenses.json';
import arAppointments from '../locales/ar/appointments.json';
import arWorks from '../locales/ar/works.json';

export const defaultNS = 'common';

export const resources = {
  en: { common: enCommon, dashboard: enDashboard, expenses: enExpenses, appointments: enAppointments, works: enWorks },
  ar: { common: arCommon, dashboard: arDashboard, expenses: arExpenses, appointments: arAppointments, works: arWorks },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: getStoredLanguagePreference(),
  fallbackLng: 'en',
  defaultNS,
  ns: ['common', 'dashboard', 'expenses', 'appointments', 'works'],
  interpolation: { escapeValue: false }, // React escapes for us
  react: { useSuspense: false }, // synchronous resources — never suspend
});

// Compile-time parity ratchet: the Arabic catalog must structurally COVER the
// English one. A missing `ar` key becomes a type error here, not a silent
// runtime fallback to English. (English is the single source of truth; see the
// i18next.d.ts augmentation which types t() against the EN resources.)
const _arCoversEn: {
  common: typeof enCommon;
  dashboard: typeof enDashboard;
  expenses: typeof enExpenses;
  appointments: typeof enAppointments;
  works: typeof enWorks;
} = resources.ar;
void _arCoversEn;

export default i18n;
