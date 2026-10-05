/**
 * Which cached reads show each admin lookup table — what a write in the generic lookup
 * editor (Settings → Lookups, or the right-click manager) refreshes besides the editor's
 * own `qk.adminLookups.table(key)`. Keyed by the `LOOKUP_TABLE_CONFIG` key.
 *
 * Without it an edit in Settings → Lookups reached the forms only when their 30 s
 * staleTime ran out (audit FE-F21-11); only the right-click manager, whose call sites
 * pass `invalidateKeys`, refreshed its dropdown at once.
 */
import type { QueryKey } from '@tanstack/react-query';
import { qk } from './keys';

const FEEDS: Readonly<Record<string, readonly QueryKey[]>> = {
  tblWorkType: [qk.lookups.workTypes()],
  tblKeyWord: [qk.lookups.workKeywords()],
  tblShadeVitaClassic: [qk.lookups.shades()],
  tblShade3dMaster: [qk.lookups.shades()],
  tblLabs: [qk.lookups.labs()],
  tblDetail: [qk.lookups.appointmentDetails()],
  tblTagOptions: [qk.lookups.tagOptions()],
  tblReferrals: [qk.lookups.referralSources()],
  tblAddress: [qk.lookups.addresses()],
  tblAlertTypes: [qk.lookups.alertTypes()],
  tblImplantManufacturer: [qk.lookups.implantManufacturers()],
  DocumentTypes: [qk.templates.documentTypes()],
  // The calendar and the booking picker mark holidays and lay out the time slots.
  tblHolidays: [qk.calendar.all()],
  tbltimes: [qk.calendar.all()],
  tblExpenseCategories: [qk.expenses.categories(), qk.expenses.subcategoriesAll()],
  tblExpenseSubcategories: [qk.expenses.subcategoriesAll()],
};

export function lookupFeedKeys(tableKey: string): readonly QueryKey[] {
  return FEEDS[tableKey] ?? [];
}
