# Authentication Quick Reference Guide

## Emergency: Admin Forgot Password

**FASTEST WAY:**
```bash
npm run auth:emergency-reset
```
Then follow prompts or use:
```bash
node scripts/reset-admin-password.js --username=admin --password=YourNewPass123
```

---

## All Authentication Commands

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `npm run auth:setup` | Initial setup - creates table + admin user | First time setup |
| `npm run auth:create-admin` | Create admin with default password (admin123) | Admin doesn't exist or corrupted |
| `npm run auth:emergency-reset` | Reset any user's password | **Forgot password emergency** |

---

## Common Scenarios

### 1. First Time Setup
```bash
npm run auth:setup
# Creates table + admin user with custom or default password
```

### 2. Admin Forgot Password
```bash
npm run auth:emergency-reset
# Interactive - prompts for username and new password
```

### 3. Quick Password Reset (Non-Interactive)
```bash
node scripts/reset-admin-password.js --username=admin --password=NewPass123
# Immediate reset without prompts
```

### 4. Recreate Admin User
```bash
npm run auth:create-admin
# Deletes and recreates admin with password: admin123
```

---

## Security Checklist After Emergency Reset

- [ ] Login with new password immediately
- [ ] Go to Settings → Users → Reset password again (choose secure password)
- [ ] Clear terminal history: `history -c && history -w`
- [ ] Document incident if required by policy
- [ ] Verify user is active and has admin role

---

## File Locations

- **Scripts:** `/scripts/reset-admin-password.js`, `/scripts/setup-auth.js`, `/scripts/create-admin.js`
- **Routes:** `/routes/auth.js` (login), `/routes/user-management.js` (user CRUD)
- **Middleware:** `/middleware/auth.js` (authentication/authorization)
- **Database:** `tblUsers` table in SQL Server

---

## Database Schema

```sql
CREATE TABLE dbo.tblUsers (
  UserID INT IDENTITY(1,1) PRIMARY KEY,
  Username NVARCHAR(50) NOT NULL UNIQUE,
  PasswordHash NVARCHAR(255) NOT NULL,
  FullName NVARCHAR(100),
  Role NVARCHAR(50) DEFAULT 'user',      -- admin, doctor, receptionist, user
  IsActive BIT DEFAULT 1,
  LastLogin DATETIME,
  CreatedAt DATETIME DEFAULT GETDATE(),
  CreatedBy NVARCHAR(50)
);
```

---

## Roles & Permissions

| Role | Access |
|------|--------|
| **admin** | Full access - user management, all features |
| **doctor** | Patient records, treatments, appointments |
| **receptionist** | Appointments, payments, basic patient info |
| **user** | Read-only access |

---

## Troubleshooting

**Problem:** Script fails with database error
**Solution:** Check `.env` file for DB_SERVER, DB_USER, DB_PASSWORD

**Problem:** User not found
**Solution:** Run `npm run auth:create-admin` to create new admin

**Problem:** Permission denied
**Solution:** Run script with appropriate user privileges or check file permissions

**Problem:** Password too weak
**Solution:** Use minimum 6 characters (enforced by script)

---

**Last Updated:** 2025-11-14
