/**
 * Query-options factories — the single definition of each read, reused by BOTH
 * route loaders (prefetch via `loaderQuery`/`ensureQueryData`) and components
 * (`useQuery`). Each pairs a `qk` key with a `core/http` fetch carrying the
 * shared Zod `.response` contract (so the `require-schema-on-reads` rule and the
 * fail-loud H11 guard are satisfied in one place).
 *
 * Typed with `z.infer<typeof X.response>` so a factory depends only on the
 * contract's schema export — no parallel hand-written response type.
 *
 * This file grows as screens migrate; only the factories currently wired live
 * here.
 */
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { fetchJSON } from '@/core/http';
import * as patientContract from '@shared/contracts/patient.contract';
import * as workContract from '@shared/contracts/work.contract';
import * as templateContract from '@shared/contracts/template.contract';
import * as alignerContract from '@shared/contracts/aligner.contract';
import * as visitContract from '@shared/contracts/visit.contract';
import * as lookupContract from '@shared/contracts/lookup.contract';
import * as staffContract from '@shared/contracts/staff.contract';
import * as employeeContract from '@shared/contracts/employee.contract';
import * as standContract from '@shared/contracts/stand.contract';
import * as expenseContract from '@shared/contracts/expense.contract';
import * as appointmentContract from '@shared/contracts/appointment.contract';
import * as paymentContract from '@shared/contracts/payment.contract';
import * as reportsContract from '@shared/contracts/reports.contract';
import * as lookupAdminContract from '@shared/contracts/lookup-admin.contract';
import { qk } from './keys';
// Type-only (erased at runtime → no import cycle with the hooks below). Stand row
// types come straight from its contract; the expense hooks predate full response
// modelling, so their factories keep the hooks' hand-written generics verbatim.
import type { StandItemFilters, StandSaleFilters } from '@/hooks/useStand';
import type {
  Expense,
  Category,
  Subcategory,
  ExpenseSummary,
  ExpenseFilters,
} from '@/hooks/useExpenses';

type Id = number | string;

// ---------------------------------------------------------------------------
// Patient
// ---------------------------------------------------------------------------

/** GET /api/patients/:id/info — demographics (deduped across Work/View/Xrays/Diagnosis). */
export const patientInfoQuery = (id: Id) =>
  queryOptions({
    queryKey: qk.patient.info(id),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof patientContract.patientInfo.response>>(`/api/patients/${id}/info`, {
        signal,
        schema: patientContract.patientInfo.response,
      }),
  });

/** GET /api/patients/:id — patientById (the edit form; a different endpoint from info). */
export const patientByIdQuery = (id: Id) =>
  queryOptions({
    queryKey: qk.patient.full(id),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof patientContract.patientById.response>>(`/api/patients/${id}`, {
        signal,
        schema: patientContract.patientById.response,
      }),
  });

/** GET /api/patients/:id/timepoints — photos/compare/xrays timepoint list. */
export const timepointsQuery = (id: Id) =>
  queryOptions({
    queryKey: qk.patient.timepoints(id),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof patientContract.timepoints.response>>(
        `/api/patients/${id}/timepoints`,
        { signal, schema: patientContract.timepoints.response }
      ),
  });

/** GET /api/patients/:id/has-appointment — whether the patient has a future appointment. */
export const hasAppointmentQuery = (id: Id) =>
  queryOptions({
    queryKey: qk.patient.hasAppointment(id),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof patientContract.hasAppointment.response>>(
        `/api/patients/${id}/has-appointment`,
        { signal, schema: patientContract.hasAppointment.response }
      ),
  });

// ---------------------------------------------------------------------------
// Work
// ---------------------------------------------------------------------------

/** GET /api/getworkdetails?workId= — single work row. */
export const workDetailsQuery = (workId: Id) =>
  queryOptions({
    queryKey: qk.work.details(workId),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof workContract.getWorkDetails.response>>(
        `/api/getworkdetails?workId=${workId}`,
        { signal, schema: workContract.getWorkDetails.response }
      ),
  });

/** GET /api/getworkforreceipt/:workId — receipt-enriched work row (disabled until a workId is set). */
export const workForReceiptQuery = (workId: number | null | undefined) =>
  queryOptions({
    queryKey: qk.work.forReceipt(workId ?? 0),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof paymentContract.workForReceipt.response>>(
        `/api/getworkforreceipt/${workId}`,
        { signal, schema: paymentContract.workForReceipt.response }
      ),
    enabled: workId != null,
  });

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/** GET /api/templates — template list. */
export const templatesQuery = () =>
  queryOptions({
    queryKey: qk.templates.list(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof templateContract.getTemplates.response>>('/api/templates', {
        signal,
        schema: templateContract.getTemplates.response,
      }),
  });

/** GET /api/templates/:id — single template (designer edit mode). */
export const templateQuery = (id: Id) =>
  queryOptions({
    queryKey: qk.templates.one(id),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof templateContract.getTemplate.response>>(`/api/templates/${id}`, {
        signal,
        schema: templateContract.getTemplate.response,
      }),
  });

/** GET /api/templates/document-types — document-type options (template management). */
export const documentTypesQuery = () =>
  queryOptions({
    queryKey: qk.templates.documentTypes(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof templateContract.documentTypes.response>>(
        '/api/templates/document-types',
        { signal, schema: templateContract.documentTypes.response }
      ),
  });

// ---------------------------------------------------------------------------
// Aligner
// ---------------------------------------------------------------------------

/** GET /api/aligner/doctors — aligner doctors list. */
export const alignerDoctorsQuery = () =>
  queryOptions({
    queryKey: qk.aligner.doctors(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof alignerContract.alignerDoctors.response>>('/api/aligner/doctors', {
        signal,
        schema: alignerContract.alignerDoctors.response,
      }),
  });

/** GET /api/aligner/all-sets — every aligner set across doctors. */
export const alignerAllSetsQuery = () =>
  queryOptions({
    queryKey: qk.aligner.allSets(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof alignerContract.allSets.response>>('/api/aligner/all-sets', {
        signal,
        schema: alignerContract.allSets.response,
      }),
  });

/** GET /api/aligner/patients/all — all aligner patients (all doctors). */
export const alignerAllPatientsQuery = () =>
  queryOptions({
    queryKey: qk.aligner.allPatients(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof alignerContract.allPatients.response>>('/api/aligner/patients/all', {
        signal,
        schema: alignerContract.allPatients.response,
      }),
  });

/** GET /api/aligner/patients/by-doctor/:doctorId — patients for one doctor. */
export const alignerPatientsByDoctorQuery = (doctorId: Id) =>
  queryOptions({
    queryKey: qk.aligner.patientsByDoctor(doctorId),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof alignerContract.patientsByDoctor.response>>(
        `/api/aligner/patients/by-doctor/${doctorId}`,
        { signal, schema: alignerContract.patientsByDoctor.response }
      ),
  });

// ---------------------------------------------------------------------------
// Lookups — patient-management filter data
// ---------------------------------------------------------------------------

/** GET /api/patients/phones — patient phone/name list (patient-management). */
export const patientPhonesQuery = () =>
  queryOptions({
    queryKey: qk.lookups.patientPhones(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof patientContract.patientPhones.response>>('/api/patients/phones', {
        signal,
        schema: patientContract.patientPhones.response,
      }),
  });

/** GET /api/getworktypes — work-type options. */
export const workTypesQuery = () =>
  queryOptions({
    queryKey: qk.lookups.workTypes(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof workContract.getWorkTypes.response>>('/api/getworktypes', {
        signal,
        schema: workContract.getWorkTypes.response,
      }),
  });

/** GET /api/getworkkeywords — work-keyword options. */
export const workKeywordsQuery = () =>
  queryOptions({
    queryKey: qk.lookups.workKeywords(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof workContract.getWorkKeywords.response>>('/api/getworkkeywords', {
        signal,
        schema: workContract.getWorkKeywords.response,
      }),
  });

/** GET /api/patients/tag-options — patient tag options. */
export const tagOptionsQuery = () =>
  queryOptions({
    queryKey: qk.lookups.tagOptions(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof patientContract.tagOptions.response>>('/api/patients/tag-options', {
        signal,
        schema: patientContract.tagOptions.response,
      }),
  });

/** GET /api/patients/type-options — patient type options. */
export const typeOptionsQuery = () =>
  queryOptions({
    queryKey: qk.lookups.typeOptions(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof patientContract.typeOptions.response>>('/api/patients/type-options', {
        signal,
        schema: patientContract.typeOptions.response,
      }),
  });

// ---------------------------------------------------------------------------
// Work / visits — patient-scoped lists (the headline dedup + gap-fix targets)
// ---------------------------------------------------------------------------

/** GET /api/getworks?code= — the patient's works list (WorkComponent + Diagnosis). */
export const worksQuery = (personId: Id) =>
  queryOptions({
    queryKey: qk.patient.works(personId),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof workContract.getWorks.response>>(`/api/getworks?code=${personId}`, {
        signal,
        schema: workContract.getWorks.response,
      }),
  });

/** GET /api/getvisitsbywork?workId= — visit list for a work. */
export const visitsByWorkQuery = (workId: Id) =>
  queryOptions({
    queryKey: qk.work.visits(workId),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof visitContract.visitsByWork.response>>(
        `/api/getvisitsbywork?workId=${workId}`,
        { signal, schema: visitContract.visitsByWork.response }
      ),
  });

/** GET /api/getlatestwires?workId= — most-recent wires for a work (new-visit prefill). */
export const latestWiresQuery = (workId: Id) =>
  queryOptions({
    queryKey: qk.work.latestWires(workId),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof visitContract.latestWires.response>>(
        `/api/getlatestwires?workId=${workId}`,
        { signal, schema: visitContract.latestWires.response }
      ),
  });

/** GET /api/getvisitbyid?visitId= — single visit row (edit form). */
export const visitByIdQuery = (visitId: Id) =>
  queryOptions({
    queryKey: qk.visit.byId(visitId),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof visitContract.visitById.response>>(
        `/api/getvisitbyid?visitId=${visitId}`,
        { signal, schema: visitContract.visitById.response }
      ),
  });

// ---------------------------------------------------------------------------
// Lookups — form dropdown / reference data
// ---------------------------------------------------------------------------

/** GET /api/getWires — wire options (new-visit form). */
export const wiresQuery = () =>
  queryOptions({
    queryKey: qk.lookups.wires(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof visitContract.getWires.response>>('/api/getWires', {
        signal,
        schema: visitContract.getWires.response,
      }),
  });

/** GET /api/operators — operator options. */
export const operatorsQuery = () =>
  queryOptions({
    queryKey: qk.lookups.operators(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof staffContract.operators.response>>('/api/operators', {
        signal,
        schema: staffContract.operators.response,
      }),
  });

/** GET /api/genders — gender options. */
export const gendersQuery = () =>
  queryOptions({
    queryKey: qk.lookups.genders(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof lookupContract.genders.response>>('/api/genders', {
        signal,
        schema: lookupContract.genders.response,
      }),
  });

/** GET /api/addresses — address/zone options. */
export const addressesQuery = () =>
  queryOptions({
    queryKey: qk.lookups.addresses(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof lookupContract.addresses.response>>('/api/addresses', {
        signal,
        schema: lookupContract.addresses.response,
      }),
  });

/** GET /api/referral-sources — referral-source options. */
export const referralSourcesQuery = () =>
  queryOptions({
    queryKey: qk.lookups.referralSources(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof lookupContract.referralSources.response>>('/api/referral-sources', {
        signal,
        schema: lookupContract.referralSources.response,
      }),
  });

/** GET /api/patient-types — patient-type options (lookup table). */
export const patientTypesQuery = () =>
  queryOptions({
    queryKey: qk.lookups.patientTypes(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof lookupContract.patientTypes.response>>('/api/patient-types', {
        signal,
        schema: lookupContract.patientTypes.response,
      }),
  });

/** GET /api/teeth — teeth options (work-detail teeth selector). */
export const teethQuery = () =>
  queryOptions({
    queryKey: qk.lookups.teeth(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof workContract.teeth.response>>('/api/teeth', {
        signal,
        schema: workContract.teeth.response,
      }),
  });

/** GET /api/implant-manufacturers — implant-manufacturer options. */
export const implantManufacturersQuery = () =>
  queryOptions({
    queryKey: qk.lookups.implantManufacturers(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof lookupContract.implantManufacturers.response>>(
        '/api/implant-manufacturers',
        { signal, schema: lookupContract.implantManufacturers.response }
      ),
  });

/** GET /api/positions — employee-position options. */
export const positionsQuery = () =>
  queryOptions({
    queryKey: qk.lookups.positions(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof employeeContract.positions.response>>('/api/positions', {
        signal,
        schema: employeeContract.positions.response,
      }),
  });

/** GET /api/appointment-details — appointment-type options (appointment forms). */
export const appointmentDetailsQuery = () =>
  queryOptions({
    queryKey: qk.lookups.appointmentDetails(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof appointmentContract.appointmentDetails.response>>(
        '/api/appointment-details',
        { signal, schema: appointmentContract.appointmentDetails.response }
      ),
  });

/**
 * GET /api/employees<query> — staff list. Keyed by the query string so the
 * ?percentage / ?getAppointments / ?includeInactive variants don't collide.
 */
export const employeesQuery = (query = '') =>
  queryOptions({
    queryKey: qk.lookups.employees(query),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof employeeContract.employees.response>>(`/api/employees${query}`, {
        signal,
        schema: employeeContract.employees.response,
      }),
  });

// ---------------------------------------------------------------------------
// Stand / mini-pharmacy — row types come from the contract (re-exported by the
// hook), so z.infer is the SSoT. Gated reads (id/date) bake `enabled` here.
// ---------------------------------------------------------------------------

/** GET /api/stand/items?… — inventory list (filtered). */
export const standItemsQuery = (filters: StandItemFilters = {}) =>
  queryOptions({
    queryKey: qk.stand.items.list(filters),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (filters.search) params.append('search', filters.search);
      if (filters.categoryId) params.append('categoryId', String(filters.categoryId));
      if (filters.stockStatus) params.append('stockStatus', filters.stockStatus);
      if (filters.includeInactive) params.append('includeInactive', 'true');
      return fetchJSON<z.infer<typeof standContract.items.response>>(
        `/api/stand/items?${params}`,
        { signal, schema: standContract.items.response }
      );
    },
  });

/** GET /api/stand/categories — category list. */
export const standCategoriesQuery = () =>
  queryOptions({
    queryKey: qk.stand.categories(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof standContract.categories.response>>('/api/stand/categories', {
        signal,
        schema: standContract.categories.response,
      }),
  });

/** GET /api/stand/dashboard — KPI rollup. */
export const standDashboardQuery = () =>
  queryOptions({
    queryKey: qk.stand.dashboard(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof standContract.dashboard.response>>('/api/stand/dashboard', {
        signal,
        schema: standContract.dashboard.response,
      }),
  });

/** GET /api/stand/sales?… — sales list (filtered). */
export const standSalesQuery = (filters: StandSaleFilters = {}) =>
  queryOptions({
    queryKey: qk.stand.sales.list(filters),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.cashierId) params.append('cashierId', String(filters.cashierId));
      if (filters.personId) params.append('personId', String(filters.personId));
      return fetchJSON<z.infer<typeof standContract.sales.response>>(
        `/api/stand/sales?${params}`,
        { signal, schema: standContract.sales.response }
      );
    },
  });

/** GET /api/stand/sales/:id — single sale with items (disabled until an id is picked). */
export const standSaleQuery = (id: number | null) =>
  queryOptions({
    queryKey: qk.stand.sales.one(id ?? 0),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof standContract.saleById.response>>(`/api/stand/sales/${id}`, {
        signal,
        schema: standContract.saleById.response,
      }),
    enabled: id != null,
  });

/** GET /api/stand/items/low-stock — items at or below reorder level. */
export const lowStockItemsQuery = () =>
  queryOptions({
    queryKey: qk.stand.items.lowStock(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof standContract.itemsLowStock.response>>(
        '/api/stand/items/low-stock',
        { signal, schema: standContract.itemsLowStock.response }
      ),
  });

/** GET /api/stand/items/expiring?days= — items expiring within `daysAhead`. */
export const expiringItemsQuery = (daysAhead: number) =>
  queryOptions({
    queryKey: qk.stand.items.expiring(daysAhead),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof standContract.itemsExpiring.response>>(
        `/api/stand/items/expiring?days=${daysAhead}`,
        { signal, schema: standContract.itemsExpiring.response }
      ),
  });

/** GET /api/stand/items/:id/movements — stock-movement ledger (disabled until an item is picked). */
export const stockMovementsQuery = (itemId: number | null) =>
  queryOptions({
    queryKey: qk.stand.items.movements(itemId ?? 0),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof standContract.itemMovements.response>>(
        `/api/stand/items/${itemId}/movements`,
        { signal, schema: standContract.itemMovements.response }
      ),
    enabled: itemId != null,
  });

/** GET /api/stand/reports/summary?… — revenue/profit rollup (disabled until both dates set). */
export const standReportSummaryQuery = (startDate: string | null, endDate: string | null) =>
  queryOptions({
    queryKey: qk.stand.reports.summary(startDate ?? '', endDate ?? ''),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ startDate: startDate!, endDate: endDate! });
      return fetchJSON<z.infer<typeof standContract.reportSummary.response>>(
        `/api/stand/reports/summary?${params}`,
        { signal, schema: standContract.reportSummary.response }
      );
    },
    enabled: !!startDate && !!endDate,
  });

/** GET /api/stand/reports/top-items?… — best sellers (disabled until both dates set). */
export const topSellingItemsQuery = (
  startDate: string | null,
  endDate: string | null,
  limit: number
) =>
  queryOptions({
    queryKey: qk.stand.reports.topItems(startDate ?? '', endDate ?? '', limit),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ startDate: startDate!, endDate: endDate!, limit: String(limit) });
      return fetchJSON<z.infer<typeof standContract.reportTopItems.response>>(
        `/api/stand/reports/top-items?${params}`,
        { signal, schema: standContract.reportTopItems.response }
      );
    },
    enabled: !!startDate && !!endDate,
  });

// ---------------------------------------------------------------------------
// Expenses — the hooks predate full response modelling, so each factory keeps
// the hook's hand-written return generic (the runtime schema still validates).
// ---------------------------------------------------------------------------

/** GET /api/expenses?… — filtered expense list. */
export const expensesQuery = (filters: ExpenseFilters = {}) =>
  queryOptions({
    queryKey: qk.expenses.list(filters),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.categoryId) params.append('categoryId', String(filters.categoryId));
      if (filters.subcategoryId) params.append('subcategoryId', String(filters.subcategoryId));
      if (filters.currency) params.append('currency', filters.currency);
      return fetchJSON<Expense[]>(`/api/expenses?${params}`, {
        signal,
        schema: expenseContract.expenseList.response,
      });
    },
  });

/** GET /api/expenses/categories — expense categories. */
export const expenseCategoriesQuery = () =>
  queryOptions({
    queryKey: qk.expenses.categories(),
    queryFn: ({ signal }) =>
      fetchJSON<Category[]>('/api/expenses/categories', {
        signal,
        schema: expenseContract.expenseCategories.response,
      }),
  });

/** GET /api/expenses/subcategories/:categoryId — subcategories (disabled until a category is picked). */
export const expenseSubcategoriesQuery = (categoryId: number | string | null | undefined) =>
  queryOptions({
    queryKey: qk.expenses.subcategories(categoryId ?? 0),
    queryFn: ({ signal }) =>
      fetchJSON<Subcategory[]>(`/api/expenses/subcategories/${categoryId}`, {
        signal,
        schema: expenseContract.expenseSubcategories.response,
      }),
    enabled: !!categoryId,
  });

/** GET /api/expenses/summary?… — totals rollup (disabled until both dates set). */
export const expenseSummaryQuery = (
  startDate: string | null | undefined,
  endDate: string | null | undefined
) =>
  queryOptions({
    queryKey: qk.expenses.summary(startDate ?? '', endDate ?? ''),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ startDate: startDate!, endDate: endDate! });
      return fetchJSON<ExpenseSummary>(`/api/expenses/summary?${params}`, {
        signal,
        schema: expenseContract.expenseSummary.response,
      });
    },
    enabled: !!startDate && !!endDate,
  });

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

/** GET /api/appointments/:id — single appointment (edit form; disabled until an id is set). */
export const appointmentByIdQuery = (id: number | string | null | undefined) =>
  queryOptions({
    queryKey: qk.appointments.byId(id ?? 0),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof appointmentContract.appointmentById.response>>(
        `/api/appointments/${id}`,
        { signal, schema: appointmentContract.appointmentById.response }
      ),
    enabled: id != null && id !== '',
  });

// ---------------------------------------------------------------------------
// Exchange rates — 404 = "no rate for this date", a normal empty state, so
// these don't retry (the consumer treats the error as "not set").
// ---------------------------------------------------------------------------

/** GET /api/getCurrentExchangeRate — today's USD→IQD rate. */
export const currentExchangeRateQuery = () =>
  queryOptions({
    queryKey: qk.exchangeRates.current(),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof paymentContract.currentExchangeRate.response>>(
        '/api/getCurrentExchangeRate',
        { signal, schema: paymentContract.currentExchangeRate.response }
      ),
    retry: false,
  });

/** GET /api/getExchangeRateForDate?date= — rate for one date. */
export const exchangeRateForDateQuery = (date: string) =>
  queryOptions({
    queryKey: qk.exchangeRates.forDate(date),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof paymentContract.exchangeRateForDate.response>>(
        `/api/getExchangeRateForDate?date=${date}`,
        { signal, schema: paymentContract.exchangeRateForDate.response }
      ),
    enabled: !!date,
    retry: false,
  });

/** GET /api/exchange-rates?from=&to= — rate history in a range. */
export const exchangeRatesHistoryQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: qk.exchangeRates.history(from, to),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof paymentContract.exchangeRates.response>>(
        `/api/exchange-rates?from=${from}&to=${to}`,
        { signal, schema: paymentContract.exchangeRates.response }
      ),
    enabled: !!from && !!to,
  });

// ---------------------------------------------------------------------------
// Reports / statistics
// ---------------------------------------------------------------------------

/** GET /api/statistics?month=&year=&exchangeRate= — daily breakdown + monthly summary. */
export const statisticsQuery = (month: number, year: number, exchangeRate: number) =>
  queryOptions({
    queryKey: qk.reports.statistics(month, year, exchangeRate),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof reportsContract.statistics.response>>(
        `/api/statistics?month=${month}&year=${year}&exchangeRate=${exchangeRate}`,
        { signal, schema: reportsContract.statistics.response }
      ),
  });

/** GET /api/statistics/yearly?startMonth=&startYear=&exchangeRate= — 12-month rollup. */
export const yearlyStatisticsQuery = (startMonth: number, startYear: number, exchangeRate: number) =>
  queryOptions({
    queryKey: qk.reports.yearly(startMonth, startYear, exchangeRate),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof reportsContract.yearlyStatistics.response>>(
        `/api/statistics/yearly?startMonth=${startMonth}&startYear=${startYear}&exchangeRate=${exchangeRate}`,
        { signal, schema: reportsContract.yearlyStatistics.response }
      ),
  });

/** GET /api/statistics/multi-year?startYear=&endYear=&exchangeRate= — multi-year rollup. */
export const multiYearStatisticsQuery = (startYear: number, endYear: number, exchangeRate: number) =>
  queryOptions({
    queryKey: qk.reports.multiYear(startYear, endYear, exchangeRate),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof reportsContract.multiYearStatistics.response>>(
        `/api/statistics/multi-year?startYear=${startYear}&endYear=${endYear}&exchangeRate=${exchangeRate}`,
        { signal, schema: reportsContract.multiYearStatistics.response }
      ),
  });

// ---------------------------------------------------------------------------
// Admin lookup tables — the generic table editor (LookupEditor/HolidayEditor).
// ---------------------------------------------------------------------------

/** GET /api/admin/lookups/:tableKey — one lookup table's rows. */
export const adminLookupItemsQuery = (tableKey: string) =>
  queryOptions({
    queryKey: qk.adminLookups.table(tableKey),
    queryFn: ({ signal }) =>
      fetchJSON<z.infer<typeof lookupAdminContract.items.response>>(
        `/api/admin/lookups/${tableKey}`,
        { signal, schema: lookupAdminContract.items.response }
      ),
  });
