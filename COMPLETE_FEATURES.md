# Shwan Orthodontics - Complete Feature Set Documentation

## APPLICATION OVERVIEW
This is a comprehensive Node.js/Express web application for an orthodontic practice that manages patients, appointments, treatments, finances, and multi-channel messaging (WhatsApp, SMS, Telegram).

---

## 1. PATIENT MANAGEMENT FEATURES

### Patient Records & Information
- **Patient Creation & Registration**: Add new patients with full demographic data
- **Patient Search**: Quick search functionality across patient database
- **Patient Information Display**: View complete patient profiles
- **Edit Patient Information**: Update patient details
- **Patient Phone Numbers**: Retrieve and manage patient contact information
- **Patient Folder Management**: Configure patient-specific file storage paths
- **Patient Types**: Categorize patients (e.g., pediatric, adult, etc.)
- **Patient Referral Sources**: Track how patients found the practice
- **Gender Management**: Store and filter by patient gender
- **Address Management**: Store and retrieve patient addresses
- **Patient Load/Unload Events**: Integration with desktop application for patient selection tracking

### Patient Data APIs
- `GET /getinfos` - Patient information retrieval
- `GET /gettimepoints` - Time points and imaging data
- `POST /patients` - Create new patient
- `PUT /patients/:personId` - Update patient
- `DELETE /patients/:personId` - Delete patient
- `GET /patients/search` - Search patients
- `GET /getpatient/:personId` - Get specific patient

---

## 2. APPOINTMENT MANAGEMENT

### Appointment Features
- **Calendar View**: Monthly/weekly appointment calendar display
- **Daily Appointments**: View all appointments for a specific date
- **Appointment Details**: Manage appointment types and specifications
- **Appointment Types**: Fetch available appointment detail categories
- **Appointment Check-in**: Manage appointment workflow (Scheduled → Present → Seated → Dismissed)
- **Appointment Booking**: Create new appointments for patients
- **Edit Appointments**: Modify existing appointment details
- **Undo Appointment Changes**: Revert appointment status changes
- **Real-time Appointment Updates**: WebSocket-based live updates
- **Appointment History**: View past appointments for patients
- **Appointment Statistics**: Track appointment metrics and analytics

### Appointment APIs
- `GET /getWebApps` - Get checked-in appointments
- `GET /getAllTodayApps` - Get all scheduled appointments
- `POST /appointments` - Create appointment
- `PUT /appointments/:appointmentId` - Update appointment
- `DELETE /appointments/:appointmentId` - Delete appointment
- `POST /appointments/check-in` - Quick check-in workflow
- `GET /appointment-details` - Fetch appointment types

---

## 3. TREATMENT & VISIT TRACKING

### Visit Management
- **Visit Recording**: Document orthodontic visits and treatment sessions
- **Visit Summary**: View all visits for a patient
- **Visit Details**: Access detailed information about specific visits
- **Visit CRUD Operations**: Create, read, update, delete visits
- **Work-Specific Visits**: Manage visits for specific treatment cases

### Wire Tracking (Dental-Specific)
- **Wire Types Management**: Maintain list of available wires
- **Upper Wire Tracking**: Record and track upper arch wire types
- **Lower Wire Tracking**: Record and track lower arch wire types
- **Latest Wire Retrieval**: Get most recent wire status for patient
- **Wire History**: View wire changes over time
- **Work-Specific Wire Tracking**: Manage wires for each treatment case

### Treatment Work Management
- **Work/Treatment Creation**: Start new treatment cases
- **Work Types**: Categorize treatments (e.g., full case, partial, retention)
- **Work Keywords**: Tag treatments with keywords for organization
- **Work Details**: Add detailed treatment specifications
- **Work Completion**: Mark work as finished
- **Work with Invoice**: Create finished work and generate invoice simultaneously
- **Edit Work Details**: Update treatment specifications
- **Active Work**: Track the current active treatment for a patient
- **Work History**: View all past treatments for a patient

---

## 4. PATIENT PHOTOS & IMAGING

### Photo Management
- **Patient Photos**: Store and retrieve treatment photos (intraoral, extraoral)
- **Time Point Photos**: Organize photos by treatment milestones (T0, T1, etc.)
- **Photo Grid View**: Browse photos in grid layout
- **Photo Comparison**: Side-by-side comparison of photos from different time points
- **Photo Upload**: Add new photos to patient record
- **Photo Deletion**: Remove unwanted photos
- **Photo Organization**: Sort photos by time point and type

### X-Ray Management
- **X-Ray Storage**: Store radiographic images
- **X-Ray Display**: View X-rays in dedicated viewer
- **X-Ray History**: Track X-rays over treatment timeline
- **X-Ray Upload**: Add new radiographs
- **OPG (Orthopantomograph)**: Panoramic radiograph management

### WebCeph Integration (Imaging Service)
- **WebCeph Patient Creation**: Create patient profiles in WebCeph system
- **Photo Type Management**: Manage available photo types in WebCeph
- **WebCeph Patient Link**: Retrieve patient links for WebCeph access
- **Image Upload to WebCeph**: Upload photos to external imaging platform

---

## 5. FINANCIAL MANAGEMENT

### Payment Management
- **Payment Recording**: Log patient payments
- **Payment History**: View all payments for a patient or treatment
- **Payment Details**: Record payment methods, amounts, currency
- **Payment CRUD**: Create, read, update payment records
- **Exchange Rate Management**: Handle multi-currency transactions
- **Currency Support**: Track payments in different currencies
- **Change Tracking**: Record change for payments in different currency
- **Receipt Generation**: Create payment receipts

### Invoice Management
- **Invoice Creation**: Generate invoices for treatments
- **Invoice Deletion**: Remove invoices if needed
- **Invoice History**: View past invoices
- **Daily Invoices**: Fetch invoices for specific date
- **Invoice Details**: Full invoice specifications

### Work-Specific Financials
- **Treatment Cost**: Define total cost for treatment
- **Amount Paid**: Track partial and full payments
- **Outstanding Balance**: Calculate remaining balance
- **Payment Terms**: Manage payment schedules

---

## 6. ALIGNER MANAGEMENT

### Aligner Doctors Management
- **Doctor Registration**: Register aligner doctors/partners
- **Doctor Information**: Store doctor contact and details
- **Doctor Logos**: Upload and manage doctor logos
- **Doctor Email**: Track doctor email for communications
- **Doctor List**: Browse all aligner doctors

### Aligner Sets (Cases)
- **Aligner Set Creation**: Start new aligner treatment case
- **Set CRUD Operations**: Full lifecycle management of sets
- **Set Status**: Track set progression (pending, active, completed)
- **Patient-Doctor Association**: Link patients to specific doctors
- **Set Details**: Full specifications for aligner cases
- **Set Notes**: Add internal notes and observations
- **Unread Notes Tracking**: Track unread doctor notes

### Aligner Batches
- **Batch Creation**: Create delivery batches for aligner sets
- **Batch Management**: Manage batch details and scheduling
- **Next Batch Tracking**: Track if next batch is available
- **Batch Status**: Monitor batch progress
- **Batch CRUD**: Full batch lifecycle management

### Aligner Payments & Tracking
- **Aligner Payment Recording**: Log payments for aligner treatments
- **Payment Tracking**: Monitor payment status for aligner cases
- **Batch Invoicing**: Invoice batch deliveries

### Aligner Activity & Monitoring
- **Activity Tracking**: Log activities on aligner cases
- **Activity History**: View all activities for a set
- **Doctor Communication**: Track doctor notes and feedback
- **Note Types**: Different note categories (doctor notes, clinic notes)
- **Mark as Read**: Track read/unread status

### Aligner PDF Management
- **PDF Upload**: Upload documents/case plans for sets
- **PDF Storage**: Google Drive integration for document storage
- **PDF Deletion**: Remove associated documents
- **PDF Retrieval**: Fetch stored documents

### All Sets Overview
- **Unified View**: See all aligner sets across all doctors
- **Missing Next Batch Indicator**: Visual indicator for sets without next batch scheduled
- **Doctor-based Filtering**: Filter by doctor/provider

---

## 7. MESSAGING & COMMUNICATION

### WhatsApp Messaging
- **WhatsApp Authentication**: QR code-based authentication
- **Message Sending**: Send appointment reminders and messages to patients
- **Bulk Message Sending**: Send messages to multiple patients by date
- **Message Status Tracking**: Monitor message delivery and read status
- **Message Reset**: Reset message status for specific date
- **Client Status**: Check WhatsApp client readiness
- **Client Initialization**: Initialize and manage WhatsApp client
- **Client Restart**: Restart stuck or unresponsive client
- **Client Destruction**: Properly shut down client
- **QR Code Management**: Display and manage QR codes for authentication

### SMS (Twilio Integration)
- **SMS Sending**: Send SMS reminders via Twilio
- **SMS Status Checking**: Verify SMS delivery
- **SMS Configuration**: Manage Twilio credentials

### Telegram Integration
- **Telegram Bot**: Send messages via Telegram
- **File Sharing**: Send documents via Telegram
- **Telegram Configuration**: Setup bot tokens and chat IDs

### Media Sending
- **Image Sending**: Send patient photos via WhatsApp
- **X-Ray Sending**: Send radiographs to patients
- **File Sending**: Send documents and PDFs
- **Receipt Sending**: Send payment receipts

### Message Tracking & Analytics
- **Message Count**: Count messages for specific date
- **Message Status Details**: View detailed message statuses
- **Message History**: Track all sent messages
- **Circuit Breaker**: Prevent cascading failures in messaging
- **Batch Status Updates**: Update multiple message statuses
- **Sending Progress**: Track real-time sending progress

---

## 8. EXPENSE MANAGEMENT

### Expense Tracking
- **Expense Creation**: Record clinic expenses
- **Expense Categories**: Categorize expenses (e.g., supplies, utilities, equipment)
- **Expense Subcategories**: Further organize expenses
- **Expense Editing**: Update expense details
- **Expense Deletion**: Remove expense records
- **Expense Search & Filter**: Find expenses by date, category, currency

### Expense Analysis
- **Expense Summary**: Aggregate expense totals
- **Expense Totals by Currency**: Multi-currency expense tracking
- **Date Range Filtering**: View expenses for specific periods
- **Category-based Reports**: Analyze spending by category
- **Subcategory Breakdown**: Detailed expense breakdowns

---

## 9. FINANCIAL REPORTING & STATISTICS

### Financial Reports
- **Monthly Statistics**: View monthly financial summaries
- **Daily Invoices**: Generate daily invoice reports
- **Revenue Tracking**: Monitor clinic revenue by date
- **Payment Totals**: Aggregate payment amounts
- **Outstanding Balances**: Calculate patient receivables
- **Exchange Rate Management**: Apply exchange rates for reporting

### Statistical Analysis
- **Daily Breakdown**: View daily financial metrics
- **Monthly Totals**: Aggregate monthly data
- **Treatment Revenue**: Revenue by treatment type
- **Payment Status**: Track paid vs. outstanding
- **Currency Conversion**: Multi-currency financial reporting

---

## 10. DOCUMENT TEMPLATES & DESIGN

### Template Management
- **Template Creation**: Create custom document templates
- **Template Editing**: Edit existing templates
- **Template Deletion**: Remove templates
- **Template Listing**: Browse all templates
- **Template Designer**: Visual template design tool using GrapesJS

### Template Types
- **Receipt Templates**: Payment receipt designs
- **Invoice Templates**: Treatment invoice designs
- **Prescription Templates**: Patient prescription formats
- **Custom Templates**: User-defined document formats

### GrapesJS Integration
- **Drag-and-Drop Editor**: Visual template design
- **Component Library**: Pre-built document components
- **HTML/CSS Editing**: Direct code editing
- **Template Preview**: Preview templates before saving
- **Template Styling**: Full styling capabilities

---

## 11. SYSTEM SETTINGS & CONFIGURATION

### General Settings
- **Options Management**: Get/set system-wide options
- **Option Update**: Change configuration settings
- **Bulk Option Updates**: Update multiple options at once

### Database Configuration
- **Database Connection Testing**: Test database connectivity
- **Database Status**: Monitor database status
- **Database Backup**: Export database backup
- **Database Restore**: Restore from backup
- **Database Configuration**: View/edit connection settings
- **Configuration Presets**: Save/load preset configurations
- **Connection Pooling Status**: Monitor connection pool

### System Controls
- **System Restart**: Restart application
- **Health Monitoring**: Check application health
- **Detailed Status**: Get detailed system status
- **Startup/Shutdown**: Control application lifecycle

### Employee Settings
- **Employee Management**: Add/edit/delete employees
- **Employee Positions**: Define job roles
- **Email Recipients**: Configure email notification recipients
- **Employee Roles**: Manage user permissions
- **Doctor List**: Manage doctor staff
- **Operator List**: Manage operator staff

### Aligner Doctor Settings
- **Aligner Doctor Management**: Configure aligner partners
- **Doctor Credentials**: Store doctor credentials

### Email Settings
- **Email Configuration**: Setup email service
- **Email Recipients**: Configure who receives reports
- **Email Templates**: Customize email formats
- **Automatic Sending**: Schedule automated emails

### Security Settings
- **User Authentication**: Login/authentication
- **Session Management**: Manage user sessions
- **Role-based Access**: Control user permissions
- **Authorization Levels**: Admin, secretary roles

---

## 12. EMPLOYEE & STAFF MANAGEMENT

### Employee Records
- **Employee Creation**: Add new employees
- **Employee Information**: Store employee details
- **Employee Positions**: Define job roles (Doctor, Hygienist, Receptionist, etc.)
- **Employee Phones**: Store contact information
- **Employee Email**: Email addresses for notifications

### Employee Configuration
- **Appointment Assignment**: Configure who can receive appointments
- **Email Notifications**: Enable/disable email recipients
- **Percentage Compensation**: Setup commission structures
- **Employee Filtering**: Filter by position, role, or capabilities

---

## 13. DENTAL-SPECIFIC FEATURES

### Dental Chart
- **Interactive Dental Chart**: Palmer notation (UR, UL, LR, LL)
- **Tooth Selection**: Click to select/mark teeth
- **Tooth Types**: Different visual representations for each tooth type
- **Quadrant View**: Organized by dental quadrants
- **Tooth Numbering**: Standard FDI/Palmer notation

### Orthodontic Treatment Tracking
- **Appliance Type**: Track bracket/wire combinations
- **Bracket Placement**: Record bracket positioning
- **Arch Form**: Monitor arch progression
- **Elastic Chains**: Track elastic placement
- **Treatment Notes**: Document clinical observations
- **Next Appointment**: Plan future appointments

### Treatment Planning
- **Work Types**: Different treatment protocols
- **Treatment Details**: Detailed treatment specifications
- **Visit Milestones**: Track treatment progress by visits
- **Photos at Milestones**: Capture progress photos at key points

---

## 14. DASHBOARD & NAVIGATION

### Dashboard Features
- **Quick Navigation Cards**: Fast access to all modules
- **Quick Actions**: Frequently used operations
- **Module Overview**: Summary of available features
- **Recent Activity**: Display recent items/actions

### Main Modules (from Dashboard)
1. Calendar - Appointment scheduling
2. Daily Appointments - Today's schedule
3. Patient Management - Patient search
4. WhatsApp Messaging - Appointment reminders
5. Aligner Management - Aligner case tracking
6. Settings - System configuration
7. Expense Management - Cost tracking
8. Document Templates - Custom templates
9. Financial Statistics - Reports
10. Add New Patient - Quick patient registration

---

## 15. REAL-TIME FEATURES

### WebSocket Events
- **Connection Management**: Connection established/lost/error
- **Heartbeat Monitoring**: Connection health checks
- **Appointment Updates**: Real-time appointment changes
- **Patient Data Sync**: Live patient information updates
- **WhatsApp Status**: Real-time message status updates
- **Message Batch Status**: Bulk message status tracking
- **System Events**: Error and broadcast messages

### Live Updates
- **Appointment Notifications**: Real-time appointment changes
- **Message Status**: Live message delivery tracking
- **Client Status**: Real-time WhatsApp client status
- **Progress Indicators**: Real-time progress bars for batch operations

---

## 16. UTILITY & INTEGRATION FEATURES

### Path Management
- **Path Conversion**: Convert web paths to file system paths
- **WSL Integration**: Windows Subsystem for Linux support
- **Cross-Platform**: Windows and WSL compatibility

### Data Integration
- **Google Contacts**: Import contacts from Google
- **Google Drive**: Store documents in Google Drive
- **External Systems**: Data sync with external platforms

---

## 17. ADVANCED FEATURES

### Circuit Breaker Pattern
- **Failure Prevention**: Automatically prevent cascading failures
- **Service Recovery**: Automatic service recovery
- **Manual Reset**: Manually reset circuit breaker
- **Status Monitoring**: Monitor breaker status

### Multi-Language Support
- Prepared infrastructure for internationalization

### Mobile Responsiveness
- **Responsive Design**: Works on desktop and mobile
- **Touch-Friendly**: Optimized for touch interactions
- **Mobile Appointment Check-in**: Easy check-in on mobile devices

### Accessibility
- **ARIA Labels**: Screen reader support
- **Keyboard Navigation**: Full keyboard support
- **Color Contrast**: Accessibility-compliant color schemes

---

## 18. AUTHENTICATION & AUTHORIZATION

### User Roles
- **Admin**: Full system access
- **Secretary**: Limited financial access, time-based restrictions
- **Doctor**: Patient record access
- **Staff**: Limited operational access

### Access Control
- **Role-based Access**: Different permissions per role
- **Time-based Authorization**: Restrict edits/deletes by time of creation
- **Resource Protection**: Secured API endpoints
- **Session Management**: Timeout and session control

---

## TECHNOLOGY STACK

### Backend
- Node.js/Express
- SQL Server (Tedious driver)
- WebSocket (real-time communication)
- Multer (file uploads)
- MCP (Model Context Protocol)

### Frontend
- React 19
- React Router v7
- Vite (build tool)
- Chart libraries
- GrapesJS (template designer)

### External Services
- WhatsApp Web.js
- Twilio (SMS)
- Telegram Bot API
- Google OAuth
- Google Drive
- WebCeph (imaging)

---

## SUMMARY STATISTICS

- **Frontend Routes**: 12 main route modules
- **Backend API Routes**: 18+ route files
- **Database Queries**: 11 query modules
- **API Endpoints**: 100+ endpoints
- **React Components**: 40+ reusable components
- **Features**: 150+ distinct features across 18 categories
- **Database Tables**: 20+ tables (patients, appointments, visits, payments, expenses, aligners, etc.)
- **Real-time Event Types**: 10+ WebSocket event categories

---

## KEY FILE LOCATIONS

### Frontend Routes
- `/public/js/routes/` - All route components

### Backend API Routes
- `/routes/api/` - All API endpoints

### Database Queries
- `/services/database/queries/` - All database operations

### React Components
- `/public/js/components/` - All reusable components

### Services
- `/services/` - Business logic and integrations

---

