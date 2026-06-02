/**
 * Database Entity Types
 * type definitions for all database entities used in the application
 */

// ===========================================
// PATIENT TYPES
// ===========================================

/**
 * Patient entity from tblpatients
 */
export interface Patient {
  person_id: number;
  patient_name: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  phone2?: string | null;
  email?: string | null;
  date_of_birth?: Date | null;
  gender?: number | null;
  address_id?: number | null;
  referral_source_id?: number | null;
  patient_type_id?: number | null;
  tag_id?: number | null;
  notes?: string | null;
  language?: string | null;
  country_code?: string | null;
  estimated_cost?: number | null;
  currency?: string | null;
  date_added?: Date | null;
}

/**
 * Patient info returned by getInfos query
 */
export interface PatientInfo {
  name: string;
  phone: string | null;
  start_date: Date | null;
  estimatedCost: number | null;
  currency: string | null;
  activeAlert: PatientAlert | null;
  xrays: XrayFile[];
  assets: string[];
}

/**
 * Patient alert from tblAlerts
 */
export interface PatientAlert {
  alertId: number;
  alertType: string;
  alertDetails: string;
  alertSeverity: number;
}

/**
 * X-ray file information
 */
export interface XrayFile {
  name: string;
  detailsDirName?: string;
  previewImagePartialPath?: string;
  date?: string;
}

/**
 * Time point for imaging
 */
export interface TimePoint {
  tp: number;
  date: Date;
  description: string | null;
}

// ===========================================
// APPOINTMENT TYPES
// ===========================================

/**
 * Appointment entity from tblappointments
 */
export interface Appointment {
  appointment_id?: number;
  appointmentID?: number; // Alias for consistency
  Num?: number;
  person_id?: number;
  patient_name: string;
  patient_type?: string | null;
  phone?: string | null;
  AppsDate?: Date;
  apptime?: string | null;
  Time?: string | null;
  app_detail?: string | null;
  notes?: string | null;
  AppsType?: string | null;
  present?: string | null;
  seated?: string | null;
  dismissed?: string | null;
  HasVisit?: boolean | number | null;
  status?: AppointmentStatus;
  DoctorID?: number | null;
  work_id?: number | null;
}

/**
 * Appointment status values
 */
export type AppointmentStatus = 'Scheduled' | 'present' | 'seated' | 'dismissed' | 'Absent';

/**
 * Appointment state fields that can be updated
 */
export type AppointmentStateField = 'present' | 'seated' | 'dismissed';

/**
 * Daily appointments response from stored procedure
 */
export interface DailyAppointmentsResponse {
  appointments: Appointment[];
  all?: number;
  present?: number;
  waiting?: number;
  completed?: number;
}

/**
 * Appointment statistics
 */
export interface AppointmentStats {
  total: number;
  checkedIn: number;
  absent: number;
  waiting: number;
  seated?: number;
  dismissed?: number;
  present?: number;
  completed?: number;
}

/**
 * Daily appointments data structure
 */
export interface DailyAppointmentsData {
  allAppointments: Appointment[];
  checkedInAppointments: Appointment[];
  stats: AppointmentStats;
}

// ===========================================
// WORK/TREATMENT TYPES
// ===========================================

/**
 * Work status constants
 */
export const WORK_STATUS = {
  ACTIVE: 1,
  FINISHED: 2,
  DISCONTINUED: 3,
} as const;

export type WorkStatusValue = typeof WORK_STATUS[keyof typeof WORK_STATUS];

/**
 * Work entity from tblwork
 */
export interface Work {
  work_id: number;
  person_id: number;
  total_required?: number | null;
  currency?: string | null;
  type_of_work?: number | null;
  notes?: string | null;
  status: WorkStatusValue;
  addition_date?: Date | null;
  start_date?: Date | null;
  debond_date?: Date | null;
  f_photo_date?: Date | null;
  i_photo_date?: Date | null;
  estimated_duration?: number | null;
  dr_id?: number | null;
  notes_date?: Date | null;
  keyword_id_1?: number | null;
  keyword_id_2?: number | null;
  keyword_id_3?: number | null;
  keyword_id_4?: number | null;
  keyword_id_5?: number | null;
  discount?: number | null;
  discount_date?: Date | null;
  discount_reason?: string | null;
}

/**
 * Work with joined data
 */
export interface WorkWithDetails extends Work {
  doctor_name?: string | null;
  type_name?: string | null;
  status_name?: string | null;
  Keyword1?: string | null;
  Keyword2?: string | null;
  Keyword3?: string | null;
  Keyword4?: string | null;
  Keyword5?: string | null;
  WorkStatus?: string;
  TotalPaid?: number;
  patient_name?: string;
}

// ===========================================
// PAYMENT/INVOICE TYPES
// ===========================================

/**
 * Payment/Invoice entity from tblInvoice
 */
export interface Invoice {
  InvoiceID?: number;
  workid: number;
  amount_paid: number;
  date_of_payment: Date;
  usd_received?: number | null;
  iqd_received?: number | null;
  change?: number | null;
}

/**
 * Invoice creation data
 */
export interface InvoiceCreateData {
  workid: number;
  amountPaid: number;
  paymentDate: string;
  usdReceived?: number;
  iqdReceived?: number;
  change?: number;
}

/**
 * Simple payment record
 */
export interface Payment {
  Payment: number;
  Date: Date;
}

/**
 * Work details for invoice generation
 */
export interface WorkForInvoice {
  workid: number;
  person_id: number;
  total_required: number | null;
  currency: string | null;
  type_of_work: number | null;
  start_date: Date | null;
  patient_name: string;
  phone: string | null;
  TotalPaid: number;
  discount?: number | null;
  discount_date?: Date | null;
  discount_reason?: string | null;
}

// ===========================================
// USER TYPES
// ===========================================

/**
 * User roles
 */
export type UserRole = 'admin' | 'secretary' | 'doctor' | 'user';

/**
 * User entity from tblUsers
 */
export interface User {
  user_id: number;
  username: string;
  password_hash?: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  last_login?: Date | null;
}

/**
 * User without sensitive data
 */
export interface SafeUser {
  userId: number;
  username: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
}

// ===========================================
// VISIT TYPES
// ===========================================

/**
 * Visit entity from tblVisits
 */
export interface Visit {
  VisitID: number;
  work_id: number;
  visit_date: Date;
  notes?: string | null;
  UpperArch?: string | null;
  LowerArch?: string | null;
  next_visit?: Date | null;
  DoctorID?: number | null;
}

// ===========================================
// WIRE TYPES
// ===========================================

/**
 * wire entity from tblWires
 */
export interface wire {
  WireID: number;
  work_id: number;
  WireDate: Date;
  WireType?: string | null;
  UpperWire?: string | null;
  LowerWire?: string | null;
  notes?: string | null;
}

// ===========================================
// EXPENSE TYPES
// ===========================================

/**
 * Expense entity from tblExpenses
 */
export interface Expense {
  ExpenseID: number;
  description: string;
  amount: number;
  currency: string;
  ExpenseDate: Date;
  category_id?: number | null;
  notes?: string | null;
  created_by?: number | null;
  created_at?: Date | null;
}

// ===========================================
// EMPLOYEE TYPES
// ===========================================

/**
 * Employee entity from tblEmployees
 */
export interface Employee {
  id: number;
  employee_name: string;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
  is_active?: boolean;
}

// ===========================================
// LOOKUP TYPES
// ===========================================

/**
 * Work type from tblWorkType
 */
export interface work_type {
  id: number;
  work_type: string;
}

/**
 * Keyword from tblKeyWord
 */
export interface Keyword {
  id: number;
  key_word: string;
}

/**
 * Patient type from tblPatientType
 */
export interface patient_type {
  id: number;
  patient_type: string;
}

/**
 * Alert type from tblAlertTypes
 */
export interface AlertType {
  alert_type_id: number;
  type_name: string;
}

// ===========================================
// ALIGNER TYPES
// ===========================================

/**
 * Aligner set entity
 */
export interface AlignerSet {
  SetID: number;
  work_id: number;
  DoctorID?: number | null;
  PartnerID?: number | null;
  TotalSets?: number | null;
  CurrentSet?: number | null;
  status?: string | null;
  notes?: string | null;
  created_at?: Date | null;
  updated_at?: Date | null;
}

/**
 * Aligner batch entity
 */
export interface AlignerBatch {
  BatchID: number;
  SetID: number;
  BatchNumber: number;
  SetsInBatch?: number | null;
  OrderDate?: Date | null;
  ReceivedDate?: Date | null;
  status?: string | null;
  notes?: string | null;
  PdfPath?: string | null;
}

/**
 * Aligner partner/doctor
 */
export interface AlignerPartner {
  PartnerID: number;
  PartnerName: string;
  email?: string | null;
  phone?: string | null;
  is_active?: boolean;
}

// ===========================================
// TEMPLATE TYPES
// ===========================================

/**
 * Template entity
 */
export interface Template {
  TemplateID: number;
  TemplateName: string;
  TemplateType: 'receipt' | 'invoice' | 'prescription' | 'report';
  Content: string;
  IsDefault?: boolean;
  created_at?: Date | null;
  updated_at?: Date | null;
}

// ===========================================
// MESSAGING TYPES
// ===========================================

/**
 * Message record for tracking
 */
export interface MessageRecord {
  MessageID: number;
  appointment_id?: number | null;
  PatientID?: number | null;
  phone: string;
  Message: string;
  status: MessageStatus;
  SentAt?: Date | null;
  DeliveredAt?: Date | null;
  read_at?: Date | null;
  ErrorMessage?: string | null;
}

/**
 * Message status values
 */
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

// ===========================================
// STAND / MINI-PHARMACY TYPES
// ===========================================

/**
 * Stock movement type constants
 */
export const STAND_MOVEMENT_TYPE = {
  INITIAL: 'initial',
  RESTOCK: 'restock',
  SALE: 'sale',
  ADJUSTMENT: 'adjustment',
  WASTE: 'waste',
  RETURN: 'return',
  VOID: 'void',
} as const;

export type StandMovementType = typeof STAND_MOVEMENT_TYPE[keyof typeof STAND_MOVEMENT_TYPE];

/**
 * Stand category from tblStandCategories
 */
export interface StandCategory {
  category_id: number;
  category_name: string;
  is_active: boolean;
}

/**
 * Stand item from tblStandItems
 */
export interface StandItem {
  item_id: number;
  item_name: string;
  sku: string | null;
  barcode: string | null;
  category_id: number | null;
  cost_price: number;
  sell_price: number;
  current_stock: number;
  reorder_level: number;
  expiry_date: Date | null;
  unit: string | null;
  notes: string | null;
  is_active: boolean;
  date_added: Date;
  modified_date: Date | null;
  created_by: number | null;
}

/**
 * Stand item with joined category name
 */
export interface StandItemWithCategory extends StandItem {
  category_name: string | null;
}

/**
 * Stand sale from tblStandSales
 */
export interface StandSale {
  sale_id: number;
  sale_date: Date;
  total_amount: number;
  total_cost: number;
  total_profit: number;
  amount_paid: number;
  change: number;
  payment_method: string;
  customer_note: string | null;
  person_id: number | null;
  cashier_id: number | null;
  voided_date: Date | null;
  voided_by: number | null;
  void_reason: string | null;
}

/**
 * Stand sale line item from tblStandSaleItems
 */
export interface StandSaleItem {
  sale_item_id: number;
  sale_id: number;
  item_id: number;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  line_total: number;
}

/**
 * Stand sale line item with item name (joined)
 */
export interface StandSaleItemWithName extends StandSaleItem {
  item_name: string;
}

/**
 * Stand sale with its line items (joined)
 */
export interface StandSaleWithItems extends StandSale {
  Items: StandSaleItemWithName[];
  patient_name: string | null;
  CashierName: string | null;
}

/**
 * Stand stock movement from tblStandStockMovements
 */
export interface StandStockMovement {
  movement_id: number;
  item_id: number;
  movement_type: StandMovementType;
  quantity: number;
  unit_cost: number | null;
  total_cost: number | null;
  related_sale_id: number | null;
  reason: string | null;
  movement_date: Date;
  performed_by: number | null;
}

/**
 * Stock movement with performer name (joined)
 */
export interface StandStockMovementWithUser extends StandStockMovement {
  PerformedByName: string | null;
}

/**
 * Data for creating a new stand item
 */
export interface StandItemCreateData {
  itemName: string;
  sku?: string | null;
  barcode?: string | null;
  categoryId?: number | null;
  costPrice: number;
  sellPrice: number;
  currentStock?: number;
  reorderLevel?: number;
  expiryDate?: string | null;
  unit?: string | null;
  notes?: string | null;
  createdBy?: number | null;
}

/**
 * Data for creating a sale (from POS)
 */
export interface StandSaleCreateData {
  items: Array<{
    itemId: number;
    quantity: number;
  }>;
  amountPaid: number;
  paymentMethod?: string;
  customerNote?: string | null;
  personId?: number | null;
  cashierId?: number | null;
}

/**
 * Data for restocking an item
 */
export interface StandRestockData {
  quantity: number;
  unitCost: number;
  userId?: number | null;
}

/**
 * Data for adjusting stock
 */
export interface StandAdjustData {
  delta: number;
  reason: string;
  userId?: number | null;
}

/**
 * Stand dashboard KPI data
 */
export interface StandDashboardKPIs {
  todaySalesCount: number;
  todayRevenue: number;
  todayProfit: number;
  lowStockCount: number;
  expiringSoonCount: number;
  totalInventoryValue: number;
}

// ===========================================
// HOLIDAY TYPES
// ===========================================

/**
 * Holiday entity
 */
export interface Holiday {
  id: number;
  holiday_date: Date;
  holiday_name: string;
  description?: string | null;
  created_at?: Date | null;
}
