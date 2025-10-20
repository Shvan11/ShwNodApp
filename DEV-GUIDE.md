# Development Guide

## The Correct Way to Run This Application

### For Development (with hot reload):

**ONE COMMAND - This runs BOTH servers:**
```bash
npm run dev
```

This starts:
- **Node.js server** on port 3000 (handles API calls and database)
- **Vite dev server** on port 5173 (handles React components and hot reload)

### Access the Application:

**ALWAYS use port 5173 during development:**
- Dashboard: http://localhost:5173/views/dashboard.html
- Aligner: http://localhost:5173/views/aligner.html
- Search: http://localhost:5173/views/patient/search.html

**Why port 5173?**
- Vite processes React imports (`import React from 'react'`)
- Vite proxies API calls to Node.js server (port 3000)
- You get hot module reloading for instant updates

### How It Works:

```
Browser (5173)
    ↓
Vite Dev Server (5173)
    ├→ Serves HTML/CSS/React components
    └→ Proxies /api/* calls → Node.js Server (3000)
                                    ↓
                              Database (SQL Server)
```

### For Production:

```bash
npm run build    # Build optimized files
npm start        # Run production server on port 3000
```

Access at: http://localhost:3000

## Common Issues:

### "Failed to resolve module specifier 'react'"
- ❌ You're accessing port 3000 directly
- ✅ Use port 5173 instead

### "API call failed"
- ❌ Node.js server (port 3000) is not running
- ✅ Run `npm run dev` to start both servers

### "Page not found"
- ❌ Wrong URL path
- ✅ Use full path: `/views/dashboard.html` not `/dashboard`
