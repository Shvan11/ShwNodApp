/**
 * Database Entity Types
 * Type definitions for all database entities used in the application
 */

// ===========================================
// TEDIOUS HELPER TYPES
// ===========================================

/**
 * Column metadata from tedious row event
 */
export interface ColumnMetadata {
  colName: string;
  type: {
    name: string;
  };
  nullable: boolean;
  caseSensitive: boolean;
}

/**
 * Column value from tedious row event
 * Each column has metadata and value properties
 */
export interface ColumnValue {
  metadata: ColumnMetadata;
  value: unknown;
}

// ===========================================
// PATIENT TYPES
// ===========================================

/**
 * Patient entity from tblpatients
 */
export interface Patient {
  PersonID: number;
  PatientName: string;
  FirstName?: string | null;
  LastName?: string | null;
  Phone?: string | null;
  Phone2?: string | null;
  Email?: string | null;
  DateofBirth?: Date | null;
  Gender?: number | null;
  AddressID?: number | null;
  ReferralSourceID?: number | null;
  PatientTypeID?: number | null;
  TagID?: number | null;
  Notes?: string | null;
  Language?: string | null;
  CountryCode?: string | null;
  EstimatedCost?: number | null;
  Currency?: string | null;
  DateAdded?: Date | null;
}

/**
 * Patient info returned by getInfos query
 */
export interface PatientInfo {
  name: string;
  phone: string | null;
  StartDate: Date | null;
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
  AppointmentID?: number;
  appointmentID?: number; // Alias for consistency
  Num?: number;
  PersonID?: number;
  PatientName: string;
  PatientType?: string | null;
  Phone?: string | null;
  AppsDate?: Date;
  apptime?: string | null;
  Time?: string | null;
  AppDetail?: string | null;
  Notes?: string | null;
  AppsType?: string | null;
  Present?: string | null;
  Seated?: string | null;
  Dismissed?: string | null;
  HasVisit?: boolean | number | null;
  Status?: AppointmentStatus;
  DoctorID?: number | null;
  WorkID?: number | null;
}

/**
 * Appointment status values
 */
export type AppointmentStatus = 'Scheduled' | 'Present' | 'Seated' | 'Dismissed' | 'Absent';

/**
 * Appointment state fields that can be updated
 */
export type AppointmentStateField = 'Present' | 'Seated' | 'Dismissed';

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
  workid: number;
  PersonID: number;
  TotalRequired?: number | null;
  Currency?: string | null;
  Typeofwork?: number | null;
  Notes?: string | null;
  Status: WorkStatusValue;
  AdditionDate?: Date | null;
  StartDate?: Date | null;
  DebondDate?: Date | null;
  FPhotoDate?: Date | null;
  IPhotoDate?: Date | null;
  EstimatedDuration?: number | null;
  DrID?: number | null;
  NotesDate?: Date | null;
  KeyWordID1?: number | null;
  KeyWordID2?: number | null;
  KeywordID3?: number | null;
  KeywordID4?: number | null;
  KeywordID5?: number | null;
}

/**
 * Work with joined data
 */
export interface WorkWithDetails extends Work {
  DoctorName?: string | null;
  TypeName?: string | null;
  StatusName?: string | null;
  Keyword1?: string | null;
  Keyword2?: string | null;
  Keyword3?: string | null;
  Keyword4?: string | null;
  Keyword5?: string | null;
  WorkStatus?: string;
  TotalPaid?: number;
  PatientName?: string;
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
  Amountpaid: number;
  Dateofpayment: Date;
  USDReceived?: number | null;
  IQDReceived?: number | null;
  Change?: number | null;
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
  PersonID: number;
  TotalRequired: number | null;
  Currency: string | null;
  Typeofwork: number | null;
  StartDate: Date | null;
  PatientName: string;
  Phone: string | null;
  TotalPaid: number;
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
  UserID: number;
  Username: string;
  PasswordHash?: string;
  FullName: string;
  Role: UserRole;
  IsActive: boolean;
  LastLogin?: Date | null;
}

/**
 * User without sensitive data
 */
export interface SafeUser {
  UserID: number;
  Username: string;
  FullName: string;
  Role: UserRole;
  IsActive: boolean;
}

// ===========================================
// VISIT TYPES
// ===========================================

/**
 * Visit entity from tblVisits
 */
export interface Visit {
  VisitID: number;
  WorkID: number;
  VisitDate: Date;
  Notes?: string | null;
  UpperArch?: string | null;
  LowerArch?: string | null;
  NextVisit?: Date | null;
  DoctorID?: number | null;
}

// ===========================================
// WIRE TYPES
// ===========================================

/**
 * Wire entity from tblWires
 */
export interface Wire {
  WireID: number;
  WorkID: number;
  WireDate: Date;
  WireType?: string | null;
  UpperWire?: string | null;
  LowerWire?: string | null;
  Notes?: string | null;
}

// ===========================================
// EXPENSE TYPES
// ===========================================

/**
 * Expense entity from tblExpenses
 */
export interface Expense {
  ExpenseID: number;
  Description: string;
  Amount: number;
  Currency: string;
  ExpenseDate: Date;
  CategoryID?: number | null;
  Notes?: string | null;
  CreatedBy?: number | null;
  CreatedAt?: Date | null;
}

// ===========================================
// EMPLOYEE TYPES
// ===========================================

/**
 * Employee entity from tblEmployees
 */
export interface Employee {
  ID: number;
  employeeName: string;
  Role?: string | null;
  Phone?: string | null;
  Email?: string | null;
  IsActive?: boolean;
}

// ===========================================
// LOOKUP TYPES
// ===========================================

/**
 * Work type from tblWorkType
 */
export interface WorkType {
  ID: number;
  WorkType: string;
}

/**
 * Keyword from tblKeyWord
 */
export interface Keyword {
  ID: number;
  KeyWord: string;
}

/**
 * Patient type from tblPatientType
 */
export interface PatientType {
  ID: number;
  PatientType: string;
}

/**
 * Alert type from tblAlertTypes
 */
export interface AlertType {
  AlertTypeID: number;
  TypeName: string;
}

// ===========================================
// ALIGNER TYPES
// ===========================================

/**
 * Aligner set entity
 */
export interface AlignerSet {
  SetID: number;
  WorkID: number;
  DoctorID?: number | null;
  PartnerID?: number | null;
  TotalSets?: number | null;
  CurrentSet?: number | null;
  Status?: string | null;
  Notes?: string | null;
  CreatedAt?: Date | null;
  UpdatedAt?: Date | null;
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
  Status?: string | null;
  Notes?: string | null;
  PdfPath?: string | null;
}

/**
 * Aligner partner/doctor
 */
export interface AlignerPartner {
  PartnerID: number;
  PartnerName: string;
  Email?: string | null;
  Phone?: string | null;
  IsActive?: boolean;
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
  CreatedAt?: Date | null;
  UpdatedAt?: Date | null;
}

// ===========================================
// MESSAGING TYPES
// ===========================================

/**
 * Message record for tracking
 */
export interface MessageRecord {
  MessageID: number;
  AppointmentID?: number | null;
  PatientID?: number | null;
  Phone: string;
  Message: string;
  Status: MessageStatus;
  SentAt?: Date | null;
  DeliveredAt?: Date | null;
  ReadAt?: Date | null;
  ErrorMessage?: string | null;
}

/**
 * Message status values
 */
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

// ===========================================
// HOLIDAY TYPES
// ===========================================

/**
 * Holiday entity
 */
export interface Holiday {
  ID: number;
  Holidaydate: Date;
  HolidayName: string;
  Description?: string | null;
  CreatedAt?: Date | null;
}
