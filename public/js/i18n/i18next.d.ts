/**
 * i18next module augmentation — makes t() keys compile-checked.
 *
 * The English catalog is the single source of truth: typing `resources` to the
 * `en` slice means a bogus key like t('dashboard:cards.nope.title') is a type
 * error, and `returnNull: false` makes t() always return string. The Arabic
 * parity is enforced separately in i18n/index.ts (_arCoversEn).
 *
 * Backend tsconfig.json excludes `public/`, so this global augmentation cannot
 * leak into the server build.
 */
import 'i18next';
import type { resources, defaultNS } from './index';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    resources: (typeof resources)['en'];
    returnNull: false;
  }
}
