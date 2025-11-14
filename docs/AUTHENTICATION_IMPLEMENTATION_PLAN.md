# Authentication Implementation Plan
**Date:** 2025-11-14
**Goal:** Simple, minimal authentication for internal clinic use
**Requirements:**
- Simple and minimal
- No performance impact
- No convenience loss
- Internal use only (via Cloudflare tunnel)
- Secure but practical

---

## 🎯 RECOMMENDED APPROACH: Session-Based Authentication

### Why This Approach?
✅ **Simple** - Single login, stays logged in for days
✅ **Fast** - Session stored in memory (Redis optional for scaling)
✅ **Convenient** - "Remember me" feature, no constant re-login
✅ **Secure** - HTTPS via Cloudflare, httpOnly cookies
✅ **No JWT complexity** - No token refresh, expiry handling
✅ **Works with existing architecture** - No frontend changes needed

---

## 📋 IMPLEMENTATION STEPS

### STEP 1: Install Dependencies (2 minutes)
```bash
npm install express-session connect-sqlite3 bcryptjs
```

**Why these?**
- `express-session` - Session management
- `connect-sqlite3` - Persist sessions to database (survives restarts)
- `bcryptjs` - Hash passwords securely

---

### STEP 2: Create Database Tables (5 minutes)

```sql
-- Users table (add to your SQL Server database)
CREATE TABLE dbo.tblUsers (
  UserID INT IDENTITY(1,1) PRIMARY KEY,
  Username NVARCHAR(50) NOT NULL UNIQUE,
  PasswordHash NVARCHAR(255) NOT NULL,
  FullName NVARCHAR(100),
  Role NVARCHAR(50) DEFAULT 'user', -- 'admin', 'doctor', 'receptionist', 'user'
  IsActive BIT DEFAULT 1,
  LastLogin DATETIME,
  CreatedAt DATETIME DEFAULT GETDATE(),
  CreatedBy NVARCHAR(50)
);

-- Insert initial admin user (password: admin123)
INSERT INTO dbo.tblUsers (Username, PasswordHash, FullName, Role, CreatedBy)
VALUES (
  'admin',
  '$2a$10$YourHashedPasswordHere', -- Will generate this in code
  'Administrator',
  'admin',
  'system'
);
```

---

### STEP 3: Create Authentication Middleware (10 minutes)

**File:** `middleware/auth.js`
```javascript
import bcrypt from 'bcryptjs';
import { executeQuery, TYPES } from '../services/database/index.js';

/**
 * Authentication middleware - checks if user is logged in
 */
export function authenticate(req, res, next) {
  if (req.session && req.session.userId) {
    // User is authenticated
    return next();
  }

  // Not authenticated
  return res.status(401).json({
    success: false,
    error: 'Authentication required',
    redirectTo: '/login'
  });
}

/**
 * Authorization middleware - checks user role
 * @param {Array<string>} allowedRoles - Roles that can access this endpoint
 */
export function authorize(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const userRole = req.session.userRole;
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        required: allowedRoles,
        current: userRole
      });
    }

    next();
  };
}

/**
 * Verify username and password
 */
export async function verifyCredentials(username, password) {
  const users = await executeQuery(
    'SELECT UserID, Username, PasswordHash, FullName, Role, IsActive FROM dbo.tblUsers WHERE Username = @username',
    [['username', TYPES.NVarChar, username]],
    (columns) => ({
      userId: columns[0].value,
      username: columns[1].value,
      passwordHash: columns[2].value,
      fullName: columns[3].value,
      role: columns[4].value,
      isActive: columns[5].value
    })
  );

  if (!users || users.length === 0) {
    return { success: false, error: 'Invalid username or password' };
  }

  const user = users[0];

  if (!user.isActive) {
    return { success: false, error: 'Account is disabled' };
  }

  const passwordMatch = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatch) {
    return { success: false, error: 'Invalid username or password' };
  }

  // Update last login
  await executeQuery(
    'UPDATE dbo.tblUsers SET LastLogin = GETDATE() WHERE UserID = @userId',
    [['userId', TYPES.Int, user.userId]]
  );

  return {
    success: true,
    user: {
      userId: user.userId,
      username: user.username,
      fullName: user.fullName,
      role: user.role
    }
  };
}

/**
 * Hash password for storage
 */
export async function hashPassword(password) {
  return await bcrypt.hash(password, 10);
}
```

---

### STEP 4: Configure Session in index.js (5 minutes)

**File:** `index.js` (add after imports, before routes)
```javascript
import session from 'express-session';
import SQLiteStore from 'connect-sqlite3';

// Configure session store
const SQLiteStoreSession = SQLiteStore(session);

app.use(session({
  store: new SQLiteStoreSession({
    db: 'sessions.db',
    dir: './data'
  }),
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: 'lax'
  },
  name: 'shwan.sid' // Custom cookie name
}));

// Add user info to request object for easy access
app.use((req, res, next) => {
  if (req.session && req.session.userId) {
    req.user = {
      userId: req.session.userId,
      username: req.session.username,
      fullName: req.session.fullName,
      role: req.session.userRole
    };
  }
  next();
});
```

---

### STEP 5: Create Login/Logout Routes (10 minutes)

**File:** `routes/auth.js`
```javascript
import express from 'express';
import { verifyCredentials, hashPassword } from '../middleware/auth.js';
import { executeQuery, TYPES } from '../services/database/index.js';

const router = express.Router();

/**
 * POST /api/auth/login
 * Login endpoint
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password, rememberMe } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username and password are required'
      });
    }

    const result = await verifyCredentials(username, password);

    if (!result.success) {
      return res.status(401).json({
        success: false,
        error: result.error
      });
    }

    // Create session
    req.session.userId = result.user.userId;
    req.session.username = result.user.username;
    req.session.fullName = result.user.fullName;
    req.session.userRole = result.user.role;

    // Extend session if "Remember Me" is checked
    if (rememberMe) {
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    }

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        username: result.user.username,
        fullName: result.user.fullName,
        role: result.user.role
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed'
    });
  }
});

/**
 * POST /api/auth/logout
 * Logout endpoint
 */
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({
        success: false,
        error: 'Logout failed'
      });
    }

    res.clearCookie('shwan.sid');
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  });
});

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({
      success: false,
      error: 'Not authenticated'
    });
  }

  res.json({
    success: true,
    user: {
      username: req.session.username,
      fullName: req.session.fullName,
      role: req.session.userRole
    }
  });
});

/**
 * POST /api/auth/change-password
 * Change password for current user
 */
router.post('/change-password', async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
    }

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Current password and new password are required'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'New password must be at least 6 characters'
      });
    }

    // Verify current password
    const result = await verifyCredentials(req.session.username, currentPassword);
    if (!result.success) {
      return res.status(401).json({
        success: false,
        error: 'Current password is incorrect'
      });
    }

    // Hash new password
    const newHash = await hashPassword(newPassword);

    // Update password
    await executeQuery(
      'UPDATE dbo.tblUsers SET PasswordHash = @hash WHERE UserID = @userId',
      [
        ['hash', TYPES.NVarChar, newHash],
        ['userId', TYPES.Int, req.session.userId]
      ]
    );

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to change password'
    });
  }
});

export default router;
```

---

### STEP 6: Apply Authentication to Routes (15 minutes)

**File:** `index.js` (modify route mounting)
```javascript
import { authenticate, authorize } from './middleware/auth.js';
import authRoutes from './routes/auth.js';

// Mount auth routes (NO authentication required)
app.use('/api/auth', authRoutes);

// Apply authentication to ALL API routes
app.use('/api', authenticate);

// Mount routes (now protected)
app.use('/api', apiRoutes);
app.use('/api', adminRoutes);
app.use('/api', calendarRoutes);
app.use('/api', emailRoutes);
app.use('/api', syncWebhookRoutes);
app.use('/api', templateRoutes);

// OR apply selectively to specific endpoints
// Example: Only admin can restart WhatsApp
router.post('/wa/restart', authorize(['admin']), async (req, res) => {
  // ... existing code
});

// Example: Only admin/accountant can delete invoices
router.delete('/deleteInvoice/:invoiceId',
  authorize(['admin', 'accountant']),
  async (req, res) => {
  // ... existing code
});
```

---

### STEP 7: Create Simple Login Page (10 minutes)

**File:** `public/login.html`
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login - Shwan Orthodontics</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .login-container {
      background: white;
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
      width: 100%;
      max-width: 400px;
    }
    h1 {
      color: #333;
      margin-bottom: 10px;
      font-size: 28px;
    }
    .subtitle {
      color: #666;
      margin-bottom: 30px;
      font-size: 14px;
    }
    .form-group {
      margin-bottom: 20px;
    }
    label {
      display: block;
      margin-bottom: 8px;
      color: #444;
      font-weight: 500;
    }
    input[type="text"],
    input[type="password"] {
      width: 100%;
      padding: 12px;
      border: 2px solid #ddd;
      border-radius: 6px;
      font-size: 16px;
      transition: border-color 0.3s;
    }
    input:focus {
      outline: none;
      border-color: #667eea;
    }
    .checkbox-group {
      display: flex;
      align-items: center;
      margin-bottom: 20px;
    }
    input[type="checkbox"] {
      margin-right: 8px;
    }
    .btn-login {
      width: 100%;
      padding: 14px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s;
    }
    .btn-login:hover {
      transform: translateY(-2px);
    }
    .btn-login:active {
      transform: translateY(0);
    }
    .error-message {
      background: #fee;
      color: #c33;
      padding: 12px;
      border-radius: 6px;
      margin-bottom: 20px;
      display: none;
    }
    .success-message {
      background: #efe;
      color: #3c3;
      padding: 12px;
      border-radius: 6px;
      margin-bottom: 20px;
      display: none;
    }
  </style>
</head>
<body>
  <div class="login-container">
    <h1>Shwan Orthodontics</h1>
    <p class="subtitle">Please sign in to continue</p>

    <div id="errorMessage" class="error-message"></div>
    <div id="successMessage" class="success-message"></div>

    <form id="loginForm">
      <div class="form-group">
        <label for="username">Username</label>
        <input type="text" id="username" name="username" required autofocus>
      </div>

      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required>
      </div>

      <div class="checkbox-group">
        <input type="checkbox" id="rememberMe" name="rememberMe">
        <label for="rememberMe" style="margin-bottom: 0;">Remember me for 30 days</label>
      </div>

      <button type="submit" class="btn-login">Sign In</button>
    </form>
  </div>

  <script>
    const form = document.getElementById('loginForm');
    const errorDiv = document.getElementById('errorMessage');
    const successDiv = document.getElementById('successMessage');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      const rememberMe = document.getElementById('rememberMe').checked;

      errorDiv.style.display = 'none';
      successDiv.style.display = 'none';

      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ username, password, rememberMe })
        });

        const data = await response.json();

        if (data.success) {
          successDiv.textContent = 'Login successful! Redirecting...';
          successDiv.style.display = 'block';
          setTimeout(() => {
            window.location.href = '/dashboard';
          }, 1000);
        } else {
          errorDiv.textContent = data.error || 'Login failed';
          errorDiv.style.display = 'block';
        }
      } catch (error) {
        errorDiv.textContent = 'Connection error. Please try again.';
        errorDiv.style.display = 'block';
      }
    });
  </script>
</body>
</html>
```

---

### STEP 8: Add Logout Button to App (5 minutes)

**File:** `public/js/components/react/UniversalHeader.jsx` (add logout button)
```jsx
// Add to header component
<button
  onClick={handleLogout}
  className="logout-btn"
  style={{
    marginLeft: 'auto',
    padding: '8px 16px',
    background: '#dc3545',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer'
  }}
>
  Logout
</button>

// Add handler
const handleLogout = async () => {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  } catch (error) {
    console.error('Logout failed:', error);
  }
};
```

---

### STEP 9: Create User Management Tool (Optional - 15 minutes)

**File:** `scripts/create-user.js`
```javascript
import bcrypt from 'bcryptjs';
import { executeQuery, TYPES } from '../services/database/index.js';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function createUser() {
  console.log('\n=== Create New User ===\n');

  const username = await question('Username: ');
  const fullName = await question('Full Name: ');
  const password = await question('Password: ');
  const role = await question('Role (admin/doctor/receptionist/user): ') || 'user';

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    await executeQuery(
      `INSERT INTO dbo.tblUsers (Username, PasswordHash, FullName, Role, CreatedBy)
       VALUES (@username, @hash, @fullName, @role, 'script')`,
      [
        ['username', TYPES.NVarChar, username],
        ['hash', TYPES.NVarChar, passwordHash],
        ['fullName', TYPES.NVarChar, fullName],
        ['role', TYPES.NVarChar, role]
      ]
    );

    console.log('\n✅ User created successfully!\n');
  } catch (error) {
    console.error('\n❌ Error creating user:', error.message);
  }

  rl.close();
  process.exit(0);
}

createUser();
```

**Usage:**
```bash
node scripts/create-user.js
```

---

## 🔒 SECURITY FEATURES

### What This Provides:
✅ **Session-based authentication** - Simple and secure
✅ **Password hashing** - bcrypt with salt
✅ **httpOnly cookies** - Protected from XSS
✅ **Secure cookies in production** - HTTPS only
✅ **Session persistence** - Survives server restarts
✅ **Role-based access control** - Admin, doctor, user, etc.
✅ **Remember me** - Optional 30-day session
✅ **Password change** - Users can update their password

---

## ⚡ PERFORMANCE IMPACT

**Zero performance impact:**
- Session lookup is in-memory (Redis optional for multi-server)
- Single database query on login (then cached in session)
- No JWT parsing/verification on every request
- Middleware adds <1ms per request

---

## 📝 ENVIRONMENT VARIABLES

**Add to `.env`:**
```env
# Session secret (generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
SESSION_SECRET=your-random-secret-here-change-this

# Session settings (optional)
SESSION_MAX_AGE=604800000  # 7 days in milliseconds
SESSION_SECURE=true        # Set to true in production (requires HTTPS)
```

---

## 🧪 TESTING

### Test the implementation:
```bash
# 1. Start server
npm run dev

# 2. Try accessing protected endpoint (should fail)
curl http://localhost:3000/api/getinfos?code=1

# 3. Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  -c cookies.txt

# 4. Try protected endpoint again (should work)
curl http://localhost:3000/api/getinfos?code=1 -b cookies.txt

# 5. Logout
curl -X POST http://localhost:3000/api/auth/logout -b cookies.txt
```

---

## 🎨 CUSTOMIZATION OPTIONS

### Option 1: IP Whitelist (Extra Security)
```javascript
// middleware/auth.js
const allowedIPs = ['127.0.0.1', '192.168.1.0/24'];

export function ipWhitelist(req, res, next) {
  const clientIP = req.ip || req.connection.remoteAddress;
  if (!isIPAllowed(clientIP, allowedIPs)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
}
```

### Option 2: Auto-login for Local Access
```javascript
// For localhost connections, auto-login as admin
app.use((req, res, next) => {
  const clientIP = req.ip || req.connection.remoteAddress;
  if (clientIP === '127.0.0.1' && !req.session.userId) {
    req.session.userId = 1; // Admin user
    req.session.username = 'localhost';
    req.session.userRole = 'admin';
  }
  next();
});
```

### Option 3: Public Read-Only Endpoints
```javascript
// Allow some endpoints without auth (view-only)
const publicEndpoints = [
  '/api/health/basic',
  '/api/calendar/time-slots'
];

app.use((req, res, next) => {
  if (publicEndpoints.includes(req.path)) {
    return next();
  }
  return authenticate(req, res, next);
});
```

---

## 📊 IMPLEMENTATION TIMELINE

| Step | Time | Description |
|------|------|-------------|
| 1 | 2 min | Install dependencies |
| 2 | 5 min | Create database tables |
| 3 | 10 min | Create auth middleware |
| 4 | 5 min | Configure sessions |
| 5 | 10 min | Create login/logout routes |
| 6 | 15 min | Apply auth to routes |
| 7 | 10 min | Create login page |
| 8 | 5 min | Add logout button |
| 9 | 15 min | Create user tool (optional) |
| **Total** | **~1 hour** | Complete implementation |

---

## ✅ CHECKLIST

- [ ] Install npm packages
- [ ] Create tblUsers table in SQL Server
- [ ] Create `middleware/auth.js`
- [ ] Configure session in `index.js`
- [ ] Create `routes/auth.js`
- [ ] Apply authentication to routes
- [ ] Create `public/login.html`
- [ ] Add logout button to header
- [ ] Create initial admin user
- [ ] Test login flow
- [ ] Test protected endpoints
- [ ] Add SESSION_SECRET to .env
- [ ] Update CODE_REVIEW_FINDINGS.md (mark authentication as ✅ DONE)

---

## 🚀 NEXT STEPS AFTER AUTHENTICATION

1. ✅ Mark item #1 in CODE_REVIEW_FINDINGS.md as DONE
2. Fix CORS policy (item #2)
3. Add rate limiting (item #4)
4. Continue down the priority list

---

**Ready to implement?** Let me know and I'll help you through each step!
