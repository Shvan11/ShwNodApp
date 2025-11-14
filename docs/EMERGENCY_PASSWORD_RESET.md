# Emergency Password Reset Procedure

## Overview

If an admin user forgets their password and cannot access the system, use the emergency password reset script to regain access. This script can only be run directly on the server (requires filesystem and database access).

## Security Features

- **Server-only access** - Script requires direct server access, cannot be accessed via web
- **Interactive confirmation** - Requires multiple confirmations before resetting password
- **User verification** - Shows user details before proceeding with reset
- **Automatic reactivation** - Reactivates user if they were disabled
- **Audit trail** - Updates are logged in database with timestamps

## Usage Methods

### Method 1: Interactive Mode (Recommended)

Run the script and follow the prompts:

```bash
npm run auth:emergency-reset
```

Or directly:

```bash
node scripts/reset-admin-password.js
```

**Steps:**
1. Enter username to reset (default: `admin`)
2. Review user information displayed
3. Enter new password (minimum 6 characters)
4. Confirm new password
5. Confirm final reset action

### Method 2: Command-Line Arguments (Quick)

For faster reset with command-line arguments:

```bash
node scripts/reset-admin-password.js --username=admin --password=newpass123
```

**Note:** This skips interactive prompts and immediately resets the password.

## Example Sessions

### Interactive Session

```
╔════════════════════════════════════════╗
║   🚨 EMERGENCY PASSWORD RESET 🚨      ║
║   Admin Access Recovery Tool          ║
╚════════════════════════════════════════╝

Enter username to reset (default: admin): admin

🔍 Searching for user: admin...

✅ User found:
   UserID: 1
   Username: admin
   Full Name: Administrator
   Role: admin
   Active: Yes

🔐 Enter new password for this user:
New Password (min 6 characters): MySecurePass123
Confirm Password: MySecurePass123

⚠️  You are about to reset the password for:
   User: admin (Administrator)

Proceed with password reset? (yes/no): yes

🔒 Hashing new password...
💾 Updating database...

╔════════════════════════════════════════╗
║   ✅ PASSWORD RESET SUCCESSFUL!       ║
╚════════════════════════════════════════╝

New login credentials:
┌────────────────────────────────────────┐
│ Username: admin                        │
│ Password: MySecurePass123              │
└────────────────────────────────────────┘

✅ User has been reactivated (if was inactive)
⚠️  IMPORTANT: Change this password after login!

🔒 SECURITY REMINDER:
   • Delete this terminal history
   • Use a strong password after login
   • Keep this script secure (server access only)
```

### Quick Command-Line Reset

```bash
node scripts/reset-admin-password.js --username=admin --password=TempPass456
```

```
╔════════════════════════════════════════╗
║   🚨 EMERGENCY PASSWORD RESET 🚨      ║
║   Admin Access Recovery Tool          ║
╚════════════════════════════════════════╝

🔍 Searching for user: admin...

✅ User found:
   UserID: 1
   Username: admin
   Full Name: Administrator
   Role: admin
   Active: Yes

🔒 Hashing new password...
💾 Updating database...

╔════════════════════════════════════════╗
║   ✅ PASSWORD RESET SUCCESSFUL!       ║
╚════════════════════════════════════════╝

New login credentials:
┌────────────────────────────────────────┐
│ Username: admin                        │
│ Password: TempPass456                  │
└────────────────────────────────────────┘
```

## Error Scenarios

### User Not Found

```
❌ ERROR: User 'admin' not found in database

💡 Available options:
   1. Run: node scripts/create-admin.js (to create new admin)
   2. Check username spelling and try again
```

**Solution:** Run `npm run auth:create-admin` to create a new admin user.

### Password Too Short

```
❌ ERROR: Password must be at least 6 characters
```

**Solution:** Use a password with at least 6 characters.

### Password Mismatch

```
❌ ERROR: Passwords do not match
```

**Solution:** Ensure both password entries are identical.

## Security Best Practices

### After Reset

1. **Login immediately** with the new password
2. **Change the password** via the Settings → Users interface
3. **Clear terminal history** to remove password from logs
4. **Document the incident** if required by security policy

### Terminal History Cleanup

**Linux/WSL:**
```bash
history -c      # Clear current session
history -w      # Write empty history
```

**Windows PowerShell:**
```powershell
Clear-History
```

### Access Control

- Keep this script secured with appropriate file permissions
- Only system administrators should have access to run this script
- Consider logging script executions for audit purposes

## Related Scripts

- **`npm run auth:setup`** - Initial authentication setup (creates table + admin user)
- **`npm run auth:create-admin`** - Create/recreate admin user with default password
- **`npm run auth:emergency-reset`** - Emergency password reset (this script)

## Troubleshooting

### Database Connection Errors

If the script fails to connect to the database:

1. Check `.env` file has correct database credentials
2. Verify SQL Server is running
3. Ensure network connectivity to database server
4. Check firewall rules allow database connections

### Permission Errors

If you get permission errors:

1. Run the script with appropriate user privileges
2. Verify Node.js has access to the database configuration files
3. Check file permissions on the scripts directory

## Support

For additional help:
- Review `docs/AUTHENTICATION_IMPLEMENTATION_SUMMARY.md`
- Check database connection in `.env` file
- Verify user table exists: `SELECT * FROM dbo.tblUsers`

---

**Last Updated:** 2025-11-14
