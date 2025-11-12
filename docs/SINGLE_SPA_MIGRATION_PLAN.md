# Single-SPA Migration Plan for Shwan Orthodontics Practice Management System

## Executive Summary

**Recommendation: YES** ✅ - Migrating to single-spa is a **good strategic investment** for your practice management software, with significant long-term benefits that outweigh the migration effort.

**Why This Makes Sense:**
- ✅ You've already completed the hardest part (100% React migration)
- ✅ Your 9 independent apps are perfect single-spa candidates
- ✅ Will eliminate current pain points (page reloads, duplicate header mounts, complex tab management)
- ✅ Future-proofs your architecture for scaling and feature additions
- ✅ Provides a native app-like experience with instant navigation
- ✅ Reduces bundle size and improves performance with shared dependencies

**Effort Estimate: 3-4 weeks** for a phased migration with minimal production disruption

---

## Current Architecture Summary

### What You Have Today (Multi-SPA Architecture)

```
┌─────────────────────────────────────────────────────────────┐
│                    14 HTML Entry Points                      │
│  (dashboard.html, expenses.html, patient.html, etc.)        │
└─────────────────────────────────────────────────────────────┘
                              ↓
        ┌─────────────────────────────────────────┐
        │  Each HTML page independently loads:    │
        │  • React from esm.sh CDN                │
        │  • UniversalHeader.jsx (duplicated)     │
        │  • App-specific component               │
        │  • tab-manager.js for singleton tabs    │
        └─────────────────────────────────────────┘
                              ↓
┌──────────────┬──────────────┬──────────────┬──────────────┐
│ DashboardApp │  PatientApp  │ ExpensesApp  │ AlignerApp   │
│  (no router) │ (RR nested)  │ (hooks only) │ (RR nested)  │
└──────────────┴──────────────┴──────────────┴──────────────┘
│ SettingsApp  │TemplateApp   │WhatsAppSend  │ Appointments │
│ (RR tabs)    │ (RR designer)│ (hooks+WS)   │ (realtime)   │
└──────────────┴──────────────┴──────────────┴──────────────┘
```

### Current Pain Points

| Issue | Impact | Severity |
|-------|--------|----------|
| **Full page reloads** | Slow navigation, flash of white, lost state | 🔴 High |
| **Duplicate React loads** | Each page loads React from CDN (~180KB × 14 pages) | 🟡 Medium |
| **Duplicate UniversalHeader** | Mounted independently on every page (44KB × 14) | 🟡 Medium |
| **Complex tab manager** | 256 lines of localStorage heartbeat code to prevent duplicate tabs | 🔴 High |
| **No shared state** | Patient data refetched when navigating between patient pages | 🟡 Medium |
| **Scattered routing** | 4 different React Router instances + tab-based navigation | 🟡 Medium |
| **Build complexity** | 14 HTML entry points in vite.config.js | 🟢 Low |

---

## What Single-SPA Will Give You

### The Future Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Single HTML Entry Point                   │
│                        (index.html)                          │
└─────────────────────────────────────────────────────────────┘
                              ↓
        ┌─────────────────────────────────────────┐
        │     Root Config (single-spa-root)       │
        │  • React loaded ONCE                    │
        │  • UniversalHeader mounted ONCE         │
        │  • Global state (Context API)           │
        │  • Unified React Router                 │
        │  • WebSocket lifecycle management       │
        └─────────────────────────────────────────┘
                              ↓
        ┌─────────────────────────────────────────┐
        │         Application Registry             │
        │  Single-spa will mount/unmount apps     │
        │  based on route matching                │
        └─────────────────────────────────────────┘
                              ↓
┌──────────────┬──────────────┬──────────────┬──────────────┐
│@clinic/dash  │@clinic/patient│@clinic/expense│@clinic/aligner│
│ /dashboard   │ /patient/*   │ /expenses    │ /aligner/*   │
└──────────────┴──────────────┴──────────────┴──────────────┘
│@clinic/settings│@clinic/templates│@clinic/whatsapp│@clinic/appts│
│ /settings/*  │ /templates/* │ /send + /auth│ /appointments│
└──────────────┴──────────────┴──────────────┴──────────────┘
        ↓ Lazy loaded on demand (code splitting)
```

### Benefits for Practice Management Software

#### 1. **Superior User Experience** 🎯
- **Instant navigation** - No page reloads between patient records, expenses, appointments
- **Persistent state** - Patient search results, filters, form data preserved during navigation
- **Smooth transitions** - Feels like a native desktop application
- **Progressive loading** - Show header/navigation immediately, load page content in background

#### 2. **Performance Improvements** ⚡
```
Before (Multi-SPA):
- Initial dashboard load: 180KB (React) + 44KB (Header) + 50KB (Dashboard) = 274KB
- Navigate to patient: RELOAD → 180KB + 44KB + 200KB = 424KB
- Navigate to expenses: RELOAD → 180KB + 44KB + 80KB = 304KB
Total transferred: 1,002KB for 3 pages

After (Single-SPA):
- Initial load: 180KB (React) + 44KB (Header) + 50KB (Dashboard) = 274KB
- Navigate to patient: 200KB (patient app only, no reload)
- Navigate to expenses: 80KB (expenses app only, no reload)
Total transferred: 554KB for 3 pages
Savings: 45% reduction in network transfer
```

#### 3. **Simplified Architecture** 🏗️
- **One router** - Single React Router v7 instance instead of 4 separate ones
- **Shared dependencies** - React, React Router, date-fns, axios loaded once
- **No tab manager** - Single-page means no duplicate tab detection needed (saves 256 lines)
- **Unified state** - Context API for patient data, user settings, WebSocket connection

#### 4. **Better Developer Experience** 👨‍�💻
- **Faster builds** - One entry point vs 14 HTML files
- **Hot module reload** - Changes reflect instantly without full refresh
- **Shared components** - Import UniversalHeader as a component, not duplicate mount code
- **Type safety** - Easier to implement TypeScript across unified architecture
- **Testing** - E2E tests can navigate between apps without page reloads

#### 5. **Future Scalability** 📈
- **Micro-frontend ready** - Can extract apps to separate repos if team grows
- **Independent deployments** - Deploy patient app without touching expenses app
- **Team scaling** - Different developers can own different apps with clear boundaries
- **Feature flags** - Easy to toggle features at route level
- **A/B testing** - Can load different versions of apps based on user segments

---

## Migration Strategy: Phased Approach (Zero Downtime)

### Phase 1: Foundation (Week 1) - Set up single-spa infrastructure

**Goal:** Create root config and proof of concept without touching production

**Tasks:**
1. Install single-spa dependencies
   ```bash
   npm install single-spa
   npm install --save-dev @single-spa/layout
   ```

2. Create root config structure
   ```
   /public/single-spa/
   ├── root-config.js          # Main single-spa orchestrator
   ├── root-layout.html        # Layout definition
   ├── app-registry.js         # App registration and routes
   └── shared-dependencies.js  # Import map for shared libs
   ```

3. Create new entry point: `public/index-spa.html`
   - Load React once
   - Mount UniversalHeader once (persistent across routes)
   - Initialize single-spa root config
   - Set up React Router v7 at root level

4. Convert first simple app as POC: **DashboardApp**
   - Wrap in single-spa lifecycle functions
   - Register with route `/dashboard`
   - Test mounting/unmounting
   - Verify WebSocket connection persists

5. Run both architectures in parallel:
   - Old: `http://localhost:5173/dashboard` → Multi-SPA (current production)
   - New: `http://localhost:5173/spa` → Single-SPA (testing)

**Success Criteria:**
- Dashboard loads correctly in single-spa mode
- Navigation between old and new architecture works
- No production disruption

---

### Phase 2: Core Apps Migration (Week 2) - Migrate high-traffic apps

**Goal:** Convert apps with most user traffic

**Priority Order:**
1. **ExpensesApp** (simple, no nested routing)
2. **DailyAppointmentsApp** (WebSocket integration test)
3. **WhatsAppSendApp** (hooks + WebSocket)
4. **WhatsAppAuthApp** (state machine hook)

**For each app:**
1. Create single-spa wrapper: `src/apps/[app-name]/spa-wrapper.js`
   ```javascript
   import { registerApplication, start } from 'single-spa';

   registerApplication({
     name: '@clinic/expenses',
     app: () => import('/js/apps/ExpensesApp.jsx'),
     activeWhen: '/expenses',
     customProps: { /* shared state */ }
   });
   ```

2. Update app to accept single-spa lifecycle:
   ```javascript
   // ExpensesApp.jsx
   export function bootstrap() { /* init */ }
   export function mount(props) {
     ReactDOM.createRoot(props.domElement).render(<ExpensesApp />);
   }
   export function unmount(props) {
     props.domElement.unmount();
   }
   ```

3. Add route to root config
4. Test in `/spa` environment
5. Verify cleanup (no memory leaks when unmounting)

**Success Criteria:**
- All 5 apps working in single-spa
- WebSocket connection shared across apps
- Smooth navigation with no reloads

---

### Phase 3: Complex Apps (Week 3) - Migrate apps with React Router

**Goal:** Integrate nested routing apps

**Apps:**
1. **PatientApp** (`/patient/:patientId/:page/*`) - Most complex
2. **AlignerApp** (`/aligner/*`)
3. **SettingsApp** (`/settings/:tab`)
4. **TemplateApp** (`/templates/*`)

**Challenge:** These apps have their own React Router instances

**Solution:** Nested routing with `createMemoryRouter` or route inheritance

**Implementation:**
```javascript
// Root config uses BrowserRouter
<BrowserRouter>
  <Routes>
    <Route path="/dashboard" element={<DashboardMicroApp />} />
    <Route path="/patient/*" element={<PatientMicroApp />} />
    <Route path="/aligner/*" element={<AlignerMicroApp />} />
  </Routes>
</BrowserRouter>

// PatientApp receives route props from parent
function PatientMicroApp() {
  return (
    <Routes>
      <Route path=":patientId/:page/*" element={<PatientShell />} />
    </Routes>
  );
}
```

**Testing Focus:**
- URL updates correctly when navigating within patient pages
- Back/forward browser buttons work
- Deep linking works: `/patient/123/payments` loads directly
- Parent route props passed correctly to child apps

**Success Criteria:**
- All 9 apps working in single-spa
- Nested routing works correctly
- Browser history navigation works
- Deep linking functional

---

### Phase 4: Shared State & Optimization (Week 4)

**Goal:** Add shared state and optimize bundle

**Tasks:**

1. **Implement Global State** (Context API)
   ```javascript
   // /public/single-spa/contexts/GlobalStateContext.jsx
   export const GlobalStateProvider = ({ children }) => {
     const [user, setUser] = useState(null);
     const [currentPatient, setCurrentPatient] = useState(null);
     const [websocket, setWebsocket] = useState(null);

     return (
       <GlobalStateContext.Provider value={{
         user, setUser,
         currentPatient, setCurrentPatient,
         websocket
       }}>
         {children}
       </GlobalStateContext.Provider>
     );
   };
   ```

2. **Replace tab-manager.js** with context-based navigation
   - Remove 256 lines of localStorage heartbeat code
   - Use React Context for "open tabs" state
   - Single SPA = single tab, no need for duplicate detection

3. **Optimize shared dependencies**
   - Create import map for shared libraries:
     ```html
     <script type="importmap">
     {
       "imports": {
         "react": "https://esm.sh/react@18",
         "react-dom": "https://esm.sh/react-dom@18",
         "react-router-dom": "https://esm.sh/react-router-dom@7.9",
         "date-fns": "https://esm.sh/date-fns@2.30",
         "@clinic/shared": "/js/core/index.js"
       }
     }
     </script>
     ```

4. **WebSocket lifecycle management**
   - Initialize WebSocket in root config
   - Pass connection via Context API to all apps
   - Maintain single persistent connection
   - Handle reconnection at root level

5. **Code splitting optimization**
   - Lazy load apps with `React.lazy()`
   - Preload next likely app (e.g., when hovering over nav link)
   - Implement loading states/skeletons

**Success Criteria:**
- Shared state working across apps
- Patient data cached during navigation
- Single WebSocket connection for all apps
- Bundle size reduced by 40%+

---

### Phase 5: Production Cutover & Cleanup

**Goal:** Switch production to single-spa, remove old code

**Cutover Steps:**

1. **Deploy single-spa as default**
   ```javascript
   // index.js (Express)
   app.get('/', (req, res) => {
     res.sendFile('./dist/index-spa.html'); // New default
   });

   // Keep old URLs working temporarily
   app.get('/dashboard', (req, res) => res.redirect('/spa#/dashboard'));
   app.get('/patient/:id/*', (req, res) => res.redirect('/spa#/patient/' + req.params.id));
   ```

2. **Update all internal links**
   - Change UniversalHeader navigation to use React Router `<Link>`
   - Update dashboard cards to use `navigate()` instead of `window.open()`
   - Update email links to new SPA URLs

3. **Monitor production**
   - Check error logs for failed route matches
   - Monitor WebSocket connection stability
   - Watch for memory leaks (unmount issues)

4. **Remove legacy code** (after 1 week of successful production)
   ```bash
   # Archive old HTML files
   mkdir -p archive/pre-spa-views
   mv public/views/*.html archive/pre-spa-views/

   # Remove tab-manager.js
   rm public/js/utils/tab-manager.js

   # Update vite.config.js - remove 14 entry points, use single entry
   ```

5. **Update documentation**
   - Update CLAUDE.md with new architecture
   - Document single-spa app registration process
   - Add developer guide for creating new apps

**Success Criteria:**
- Production running on single-spa exclusively
- No errors in monitoring for 1 week
- Legacy code removed
- Documentation updated

---

## Technical Implementation Details

### 1. Root Config Structure

**File: `/public/single-spa/root-config.js`**
```javascript
import { registerApplication, start } from 'single-spa';
import { constructApplications, constructRoutes, constructLayoutEngine } from '@single-spa/layout';

// Define routes and their corresponding apps
const routes = constructRoutes({
  routes: [
    { path: '/dashboard', application: '@clinic/dashboard' },
    { path: '/patient', application: '@clinic/patient' },
    { path: '/expenses', application: '@clinic/expenses' },
    { path: '/send', application: '@clinic/whatsapp-send' },
    { path: '/auth', application: '@clinic/whatsapp-auth' },
    { path: '/aligner', application: '@clinic/aligner' },
    { path: '/settings', application: '@clinic/settings' },
    { path: '/templates', application: '@clinic/templates' },
    { path: '/appointments', application: '@clinic/appointments' }
  ]
});

// Register all applications
const applications = constructApplications({
  routes,
  loadApp: ({ name }) => {
    // Map app name to import path
    const appMap = {
      '@clinic/dashboard': () => import('/js/apps/DashboardApp.jsx'),
      '@clinic/patient': () => import('/js/apps/PatientApp.jsx'),
      '@clinic/expenses': () => import('/js/apps/ExpensesApp.jsx'),
      '@clinic/whatsapp-send': () => import('/js/apps/WhatsAppSendApp.jsx'),
      '@clinic/whatsapp-auth': () => import('/js/apps/WhatsAppAuthApp.jsx'),
      '@clinic/aligner': () => import('/js/apps/AlignerApp.jsx'),
      '@clinic/settings': () => import('/js/apps/SettingsApp.jsx'),
      '@clinic/templates': () => import('/js/apps/TemplateApp.jsx'),
      '@clinic/appointments': () => import('/js/apps/DailyAppointmentsApp.jsx')
    };
    return appMap[name]();
  }
});

// Register each application with single-spa
applications.forEach(registerApplication);

// Start single-spa
start();
```

### 2. App Wrapper Pattern

**Each app needs these exports:**

```javascript
// Example: ExpensesApp.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import singleSpaReact from 'single-spa-react';

function ExpensesApp() {
  // Your existing app component
  return <div>Expenses content</div>;
}

// Wrap with single-spa-react lifecycle
const lifecycles = singleSpaReact({
  React,
  ReactDOM,
  rootComponent: ExpensesApp,
  errorBoundary(err, info, props) {
    // Error handling
    return <div>Error loading Expenses app</div>;
  }
});

export const bootstrap = lifecycles.bootstrap;
export const mount = lifecycles.mount;
export const unmount = lifecycles.unmount;
```

**For apps with React Router:**
```javascript
// PatientApp.jsx
import { BrowserRouter } from 'react-router-dom';

function PatientAppWrapper({ basename }) {
  return (
    <BrowserRouter basename={basename || '/patient'}>
      <Routes>
        <Route path=":patientId/:page" element={<PatientShell />} />
      </Routes>
    </BrowserRouter>
  );
}

const lifecycles = singleSpaReact({
  React,
  ReactDOM,
  rootComponent: PatientAppWrapper,
  // Pass custom props to control routing
  customProps: (name, location) => ({
    basename: '/patient'
  })
});
```

### 3. Shared State Implementation

**File: `/public/single-spa/contexts/GlobalStateContext.jsx`**
```javascript
import React, { createContext, useContext, useState, useEffect } from 'react';
import { createWebSocketConnection } from '/js/services/websocket.js';

const GlobalStateContext = createContext();

export function GlobalStateProvider({ children }) {
  const [user, setUser] = useState(null);
  const [currentPatient, setCurrentPatient] = useState(null);
  const [websocket, setWebsocket] = useState(null);
  const [appointmentsCache, setAppointmentsCache] = useState({});

  // Initialize WebSocket once
  useEffect(() => {
    const ws = createWebSocketConnection();
    setWebsocket(ws);

    return () => ws.disconnect();
  }, []);

  return (
    <GlobalStateContext.Provider value={{
      user, setUser,
      currentPatient, setCurrentPatient,
      websocket,
      appointmentsCache, setAppointmentsCache
    }}>
      {children}
    </GlobalStateContext.Provider>
  );
}

export const useGlobalState = () => useContext(GlobalStateContext);
```

**Usage in apps:**
```javascript
// In any app component
import { useGlobalState } from '/single-spa/contexts/GlobalStateContext.jsx';

function PatientHeader() {
  const { currentPatient, websocket } = useGlobalState();

  return <div>Patient: {currentPatient?.name}</div>;
}
```

### 4. New Vite Configuration

**File: `vite.config.js`**
```javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'public',

  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },

  build: {
    outDir: '../dist',
    rollupOptions: {
      // SINGLE ENTRY POINT!
      input: {
        main: 'public/index-spa.html'
      },
      output: {
        // Code splitting by app
        manualChunks: {
          'vendor': ['react', 'react-dom', 'react-router-dom'],
          'patient': ['./public/js/apps/PatientApp.jsx'],
          'expenses': ['./public/js/apps/ExpensesApp.jsx'],
          'dashboard': ['./public/js/apps/DashboardApp.jsx']
          // ... etc
        }
      }
    }
  }
});
```

### 5. Updated Express Routing

**File: `index.js`**
```javascript
// Serve single-spa as default
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index-spa.html'));
});

// All routes now handled by single-spa (send same HTML)
const spaRoutes = [
  '/dashboard',
  '/patient/*',
  '/expenses',
  '/send',
  '/auth',
  '/aligner/*',
  '/settings/*',
  '/templates/*',
  '/appointments'
];

spaRoutes.forEach(route => {
  app.get(route, (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index-spa.html'));
  });
});

// API routes stay the same
app.use('/api', apiRoutes);
```

---

## Risk Assessment & Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Breaking production during migration** | Low | Critical | Phased approach - run both architectures in parallel |
| **Memory leaks from improper unmounting** | Medium | High | Thorough testing with React DevTools Profiler, implement cleanup in unmount lifecycle |
| **WebSocket connection issues** | Low | High | Initialize at root level, test reconnection logic extensively |
| **React Router conflicts** | Medium | Medium | Use memory router for child apps or pass basename props |
| **Bundle size increase** | Low | Medium | Implement code splitting, lazy loading, analyze with webpack-bundle-analyzer |
| **Learning curve for team** | Medium | Low | Single-spa is well-documented, similar to React concepts |
| **Deep linking broken** | Medium | Medium | Test all routes, ensure server sends index-spa.html for all routes |
| **Third-party library conflicts** | Low | Medium | Use import maps to control versions, test in isolation |

---

## Success Metrics

### Performance Targets
- [ ] Initial load time: < 2s (vs ~3s current)
- [ ] Navigation between apps: < 200ms (vs ~1-2s page reload)
- [ ] Bundle size: 40% reduction (shared dependencies)
- [ ] Memory usage: Stable over 8-hour workday (no leaks)

### User Experience Targets
- [ ] Zero visible page reloads during navigation
- [ ] Patient search results persist when navigating to patient detail
- [ ] Form data preserved when accidentally navigating away
- [ ] Back button works intuitively across all apps

### Developer Experience Targets
- [ ] Vite build time: < 10s (vs ~30s with 14 entries)
- [ ] Hot reload time: < 1s
- [ ] Can run individual app in isolation for development
- [ ] Clear documentation for adding new apps

---

## Effort Estimation

| Phase | Tasks | Developer Days | Calendar Time |
|-------|-------|----------------|---------------|
| **Phase 1: Foundation** | Setup + POC | 3-4 days | Week 1 |
| **Phase 2: Core Apps** | 5 simple apps | 4-5 days | Week 2 |
| **Phase 3: Complex Apps** | 4 router apps | 5-6 days | Week 3 |
| **Phase 4: Optimization** | State + cleanup | 3-4 days | Week 4 |
| **Phase 5: Cutover** | Deploy + monitor | 2-3 days | Week 5 |
| **Total** | | **17-22 days** | **5 weeks** |

**Assumptions:**
- 1 full-time developer
- Working on production codebase (testing required)
- No major blockers or architectural surprises

**Reality Check:** Add 20% buffer → **21-27 days** → **6 weeks total**

---

## Alternative: Keep Current Architecture?

### When NOT to migrate to single-spa

**Consider staying with multi-SPA if:**
- ❌ Your team is < 2 developers (migration effort not worth it)
- ❌ App is rarely used (< 10 users/day)
- ❌ No budget for 1 month of refactoring
- ❌ Current performance is acceptable to users
- ❌ No plans to add new features (maintenance mode)

### Incremental improvements to current architecture (if not migrating)

If you decide NOT to do single-spa, you can still improve current architecture:

1. **Reduce duplicate header mounts** - Load UniversalHeader once via import map
2. **Shared state via localStorage** - Cache patient data between page loads
3. **Preload next page** - Add `<link rel="prefetch">` for common navigation paths
4. **Optimize tab-manager** - Reduce heartbeat frequency
5. **Service Worker caching** - Cache React/ReactDOM for offline use

**Effort:** 2-3 days | **Benefit:** 10-20% performance improvement

---

## Recommendation: Proceed with Single-SPA Migration

### Why now is the perfect time:

1. **✅ You've already done the hard part** - 100% React migration complete
2. **✅ Your architecture is already prepared** - 9 independent apps with clear boundaries
3. **✅ Low risk** - Phased approach means no production downtime
4. **✅ High ROI** - User experience + performance + developer productivity gains
5. **✅ Future-proof** - Sets you up for scaling, team growth, micro-frontends

### What success looks like (3 months after migration):

**For Users:**
- "The app feels so much faster now!"
- "I love that my search results don't disappear when I open a patient"
- "It feels like a real desktop app, not a website"

**For Developers:**
- "Adding a new feature is so much easier with shared state"
- "Build times are 3x faster"
- "No more debugging weird tab-manager issues"

**For Business:**
- Faster feature delivery (better developer experience)
- Fewer user complaints about performance
- Easier to onboard new developers (clearer architecture)
- Ready to scale to new practice locations with minimal code changes

---

## Next Steps

### 1. **Get buy-in** (1-2 days)
   - Review this plan with stakeholders
   - Demonstrate POC (Phase 1) to show feasibility
   - Get approval for 5-week timeline

### 2. **Start Phase 1** (Week 1)
   - Set up single-spa infrastructure
   - Convert DashboardApp as proof of concept
   - Run in parallel with production

### 3. **Execute phases 2-4** (Weeks 2-4)
   - Migrate all apps systematically
   - Test thoroughly at each step
   - Keep production stable

### 4. **Production cutover** (Week 5)
   - Deploy single-spa as default
   - Monitor for issues
   - Celebrate! 🎉

---

## Questions & Answers

**Q: Will this break my production app?**
A: No - we run both architectures in parallel. Old URLs keep working until cutover.

**Q: Can I migrate one app at a time?**
A: Yes - that's exactly the phased approach. Each app migrates independently.

**Q: What if I need to roll back?**
A: Easy - just point Express back to old HTML files. We keep them until confirmed stable.

**Q: Will my users notice the migration?**
A: Not during migration (parallel). After cutover, they'll notice faster navigation!

**Q: Do I need to rewrite any apps?**
A: No - apps stay the same. We just add single-spa lifecycle wrappers.

**Q: How do I handle WebSocket connection?**
A: Initialize once in root config, pass via Context API to all apps.

**Q: What about nested React Router apps?**
A: They work fine - just pass basename prop from root config.

**Q: Can I still use ESM imports from CDN?**
A: Yes - import map stays the same, just loaded once instead of per page.

---

## Conclusion

**Single-spa is the right choice for your practice management system.**

You've already invested in the React migration - now capitalize on that investment by unifying your architecture. The effort is reasonable (5-6 weeks), the risk is manageable (phased approach), and the benefits are substantial (performance + UX + developer experience).

**Recommendation: Proceed with migration starting with Phase 1 POC.**

Let's build a world-class practice management experience! 🚀
