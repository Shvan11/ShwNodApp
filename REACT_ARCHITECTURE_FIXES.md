# React Architecture - Specific Fixes and Solutions

## Quick Reference Guide for Addressing Design Pattern Issues

---

## FIX #1: Add Error Boundaries

### Problem
Zero error boundaries in the codebase. A single component crash brings down the entire micro-app.

### Solution
Create a reusable error boundary component:

**File: `/public/js/components/react/ErrorBoundary.jsx`**
```jsx
import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null,
      errorInfo: null 
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
    this.setState({
      error,
      errorInfo
    });
    
    // Send to error tracking service (Sentry, etc.)
    // captureException(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '2rem',
          backgroundColor: '#fee2e2',
          borderRadius: '8px',
          border: '1px solid #fca5a5',
          color: '#991b1b'
        }}>
          <h2>Something went wrong</h2>
          <p>Please try refreshing the page or contact support.</p>
          {process.env.NODE_ENV === 'development' && (
            <details style={{ marginTop: '1rem', whiteSpace: 'pre-wrap' }}>
              <summary>Error Details</summary>
              <p>{this.state.error?.toString()}</p>
              <p>{this.state.errorInfo?.componentStack}</p>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
```

### Apply to Each Micro-App:

**File: `/public/js/apps/PatientApp.jsx` (replace existing)**
```jsx
import ErrorBoundary from '../components/react/ErrorBoundary.jsx';

export const mount = async (props) => {
  let el = document.getElementById('patient-app-container');
  if (!el) {
    el = document.createElement('div');
    document.body.appendChild(el);
  }

  const root = ReactDOM.createRoot(el);
  root.render(
    <ErrorBoundary>
      <BrowserRouter>
        <PatientApp />
      </BrowserRouter>
    </ErrorBoundary>
  );
};
```

---

## FIX #2: Break Down PatientManagement Component

### Problem
993-line component managing search, filtering, CRUD, TomSelect, modals, debouncing.

### Solution: Component Refactoring Plan

**New structure:**
```
PatientManagement/
├── index.jsx (main component - 200 lines)
├── PatientSearchForm.jsx (search UI - 80 lines)
├── PatientSearchResults.jsx (results table - 100 lines)
├── PatientQuickSearch.jsx (TomSelect dropdowns - 120 lines)
├── EditPatientModal.jsx (edit form - 150 lines)
├── DeleteConfirmModal.jsx (confirmation - 50 lines)
└── hooks/
    └── usePatientSearch.js (search logic - 80 lines)
```

**Step 1: Extract search logic into custom hook**

**File: `/public/js/components/react/hooks/usePatientSearch.js`**
```javascript
import { useState, useEffect, useRef, useCallback } from 'react';

export function usePatientSearch() {
  const [searchPatientName, setSearchPatientName] = useState('');
  const [searchFirstName, setSearchFirstName] = useState('');
  const [searchLastName, setSearchLastName] = useState('');
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);
  
  const searchTimeoutRef = useRef(null);

  const performSearch = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (searchPatientName.trim()) params.append('patientName', searchPatientName.trim());
      if (searchFirstName.trim()) params.append('firstName', searchFirstName.trim());
      if (searchLastName.trim()) params.append('lastName', searchLastName.trim());

      const response = await fetch(`/api/patients/search?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to search patients');
      
      const data = await response.json();
      setPatients(data);
      setHasSearched(true);
    } catch (err) {
      setError(err.message);
      setPatients([]);
    } finally {
      setLoading(false);
    }
  }, [searchPatientName, searchFirstName, searchLastName]);

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    const hasMinimumInput =
      searchPatientName.trim().length >= 2 ||
      searchFirstName.trim().length >= 2 ||
      searchLastName.trim().length >= 2;

    if (hasMinimumInput) {
      searchTimeoutRef.current = setTimeout(() => {
        performSearch();
      }, 500);
    } else if (!searchPatientName && !searchFirstName && !searchLastName) {
      setPatients([]);
      setHasSearched(false);
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchPatientName, searchFirstName, searchLastName, performSearch]);

  return {
    // State
    searchPatientName,
    searchFirstName,
    searchLastName,
    patients,
    loading,
    error,
    hasSearched,
    
    // Setters
    setSearchPatientName,
    setSearchFirstName,
    setSearchLastName,
    setError,
    
    // Methods
    performSearch
  };
}
```

**Step 2: Extract edit modal into separate component**

**File: `/public/js/components/react/modals/EditPatientModal.jsx`**
```jsx
import React, { useState, useEffect } from 'react';

const EditPatientModal = ({ 
  patient, 
  isOpen, 
  onClose, 
  onSave,
  genders = [],
  addresses = [],
  referralSources = [],
  patientTypes = []
}) => {
  const [formData, setFormData] = useState({
    PersonID: '',
    patientID: '',
    PatientName: '',
    FirstName: '',
    LastName: '',
    Phone: '',
    Phone2: '',
    Email: '',
    DateofBirth: '',
    Gender: '',
    AddressID: '',
    ReferralSourceID: '',
    PatientTypeID: '',
    Notes: '',
    Alerts: '',
    Language: '0',
    CountryCode: ''
  });

  useEffect(() => {
    if (patient && isOpen) {
      setFormData({
        PersonID: patient.PersonID,
        patientID: patient.patientID || '',
        PatientName: patient.PatientName || '',
        FirstName: patient.FirstName || '',
        LastName: patient.LastName || '',
        Phone: patient.Phone || '',
        Phone2: patient.Phone2 || '',
        Email: patient.Email || '',
        DateofBirth: patient.DateofBirth 
          ? new Date(patient.DateofBirth).toISOString().split('T')[0] 
          : '',
        Gender: patient.Gender || '',
        AddressID: patient.AddressID || '',
        ReferralSourceID: patient.ReferralSourceID || '',
        PatientTypeID: patient.PatientTypeID || '',
        Notes: patient.Notes || '',
        Alerts: patient.Alerts || '',
        Language: (patient.Language !== null) ? patient.Language.toString() : '0',
        CountryCode: patient.CountryCode || ''
      });
    }
  }, [patient, isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.PatientName.trim()) {
      alert('Patient Name is required');
      return;
    }

    try {
      const response = await fetch(`/api/patients/${formData.PersonID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update patient');
      }

      onSave(formData);
      onClose();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleFieldChange = (fieldName, value) => {
    setFormData(prev => ({
      ...prev,
      [fieldName]: value
    }));
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="work-modal" style={{ maxWidth: '800px' }}>
        <div className="modal-header">
          <h3>Edit Patient - {patient?.PatientName}</h3>
          <button onClick={onClose} className="modal-close">×</button>
        </div>

        <form onSubmit={handleSubmit} className="work-form">
          {/* Use FormField component (see FIX #4) */}
          <div className="form-row">
            <div className="form-group">
              <label>Patient Name <span style={{ color: '#dc2626' }}>*</span></label>
              <input
                type="text"
                value={formData.PatientName}
                onChange={(e) => handleFieldChange('PatientName', e.target.value)}
                required
              />
            </div>
          </div>

          {/* ... rest of form fields ... */}

          <div className="form-actions">
            <button type="button" onClick={onClose} className="btn btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditPatientModal;
```

**Step 3: Refactor main component**

**File: `/public/js/components/react/PatientManagement.jsx` (refactored)**
```jsx
import React, { useState, useEffect } from 'react';
import { usePatientSearch } from './hooks/usePatientSearch';
import PatientSearchForm from './PatientSearchForm';
import PatientSearchResults from './PatientSearchResults';
import PatientQuickSearch from './PatientQuickSearch';
import EditPatientModal from './modals/EditPatientModal';
import DeleteConfirmModal from './modals/DeleteConfirmModal';

const PatientManagement = () => {
  const search = usePatientSearch();
  
  // Modal states
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  
  // Dropdown data
  const [genders, setGenders] = useState([]);
  const [addresses, setAddresses] = useState([]);
  const [referralSources, setReferralSources] = useState([]);
  const [patientTypes, setPatientTypes] = useState([]);
  const [showQuickSearch, setShowQuickSearch] = useState(true);

  useEffect(() => {
    loadDropdownData();
  }, []);

  const loadDropdownData = async () => {
    try {
      const [gendersRes, addressesRes, referralsRes, typesRes] = await Promise.all([
        fetch('/api/genders'),
        fetch('/api/addresses'),
        fetch('/api/referral-sources'),
        fetch('/api/patient-types')
      ]);

      if (gendersRes.ok) setGenders(await gendersRes.json());
      if (addressesRes.ok) setAddresses(await addressesRes.json());
      if (referralsRes.ok) setReferralSources(await referralsRes.json());
      if (typesRes.ok) setPatientTypes(await typesRes.json());
    } catch (err) {
      console.error('Error loading dropdown data:', err);
    }
  };

  const handleEditClick = (patient) => {
    setSelectedPatient(patient);
    setShowEditModal(true);
  };

  const handleDeleteClick = (patient) => {
    setSelectedPatient(patient);
    setShowDeleteConfirm(true);
  };

  const handleSavePatient = async () => {
    if (search.hasSearched) {
      await search.performSearch();
    }
    setShowEditModal(false);
    setSuccessMessage('Patient updated successfully!');
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleDeleteConfirm = async () => {
    try {
      const response = await fetch(
        `/api/patients/${selectedPatient.PersonID}`,
        { method: 'DELETE' }
      );

      if (!response.ok) throw new Error('Failed to delete patient');

      await search.performSearch();
      setShowDeleteConfirm(false);
      setSuccessMessage('Patient deleted successfully!');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="patient-management">
      <header style={{ marginBottom: '2rem' }}>
        <h2>Patient Management</h2>
      </header>

      {successMessage && (
        <div style={{
          backgroundColor: '#d1fae5',
          color: '#065f46',
          padding: '1rem',
          borderRadius: '8px',
          marginBottom: '1rem'
        }}>
          {successMessage}
        </div>
      )}

      {showQuickSearch && (
        <PatientQuickSearch />
      )}

      <PatientSearchForm
        {...search}
        onShowAll={() => {
          search.setSearchPatientName('');
          search.setSearchFirstName('');
          search.setSearchLastName('');
          search.performSearch();
        }}
      />

      <PatientSearchResults
        patients={search.patients}
        loading={search.loading}
        error={search.error}
        hasSearched={search.hasSearched}
        onEdit={handleEditClick}
        onDelete={handleDeleteClick}
        onError={(err) => search.setError(err)}
      />

      <EditPatientModal
        patient={selectedPatient}
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        onSave={handleSavePatient}
        genders={genders}
        addresses={addresses}
        referralSources={referralSources}
        patientTypes={patientTypes}
      />

      <DeleteConfirmModal
        patient={selectedPatient}
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
};

export default PatientManagement;
```

---

## FIX #3: Implement Memoization Strategy

### Problem
Large components without memoization cause cascading re-renders.

### Solution for PatientManagement refactored version:

**File: `/public/js/components/react/PatientSearchResults.jsx`**
```jsx
import React, { useMemo, useCallback } from 'react';

const PatientSearchResults = React.memo(({
  patients,
  loading,
  error,
  hasSearched,
  onEdit,
  onDelete,
  onError
}) => {
  const memoizedPatients = useMemo(
    () => patients.sort((a, b) => a.PatientName.localeCompare(b.PatientName)),
    [patients]
  );

  const handleEditClick = useCallback((patient) => {
    onEdit(patient);
  }, [onEdit]);

  const handleDeleteClick = useCallback((patient) => {
    onDelete(patient);
  }, [onDelete]);

  if (loading) {
    return <div className="work-loading">Searching...</div>;
  }

  if (error) {
    return (
      <div className="work-error">
        {error}
        <button onClick={() => onError(null)}>×</button>
      </div>
    );
  }

  if (!hasSearched) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem' }}>
        <p>Start typing to search for patients</p>
      </div>
    );
  }

  return (
    <div className="work-table-container">
      <table className="work-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Phone</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {memoizedPatients.map(patient => (
            <PatientRow
              key={patient.PersonID}
              patient={patient}
              onEdit={handleEditClick}
              onDelete={handleDeleteClick}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
});

// Memoized row component
const PatientRow = React.memo(({ patient, onEdit, onDelete }) => {
  const handleEdit = useCallback(() => onEdit(patient), [patient, onEdit]);
  const handleDelete = useCallback(() => onDelete(patient), [patient, onDelete]);

  return (
    <tr>
      <td>{patient.patientID || patient.PersonID}</td>
      <td>{patient.PatientName}</td>
      <td>{patient.Phone || 'N/A'}</td>
      <td>
        <button onClick={handleEdit} className="btn btn-sm">Edit</button>
        <button onClick={handleDelete} className="btn btn-sm btn-danger">Delete</button>
      </td>
    </tr>
  );
});

export default PatientSearchResults;
```

---

## FIX #4: Create Reusable Form Field Component

### Problem
Form field HTML/styling repeated 20+ times across components.

**File: `/public/js/components/react/FormField.jsx`**
```jsx
import React from 'react';

const FormField = React.memo(({
  label,
  type = 'text',
  name,
  value,
  onChange,
  required = false,
  placeholder = '',
  options = [], // For select fields
  error = null,
  className = ''
}) => {
  const handleChange = (e) => {
    onChange(e.target.value);
  };

  return (
    <div className={`form-group ${className}`}>
      {label && (
        <label htmlFor={name}>
          {label}
          {required && <span style={{ color: '#dc2626' }}>*</span>}
        </label>
      )}

      {type === 'select' ? (
        <select
          id={name}
          name={name}
          value={value}
          onChange={handleChange}
          className={error ? 'input-error' : ''}
        >
          <option value="">-- Select --</option>
          {options.map(opt => (
            <option key={opt.id || opt.value} value={opt.id || opt.value}>
              {opt.name || opt.label}
            </option>
          ))}
        </select>
      ) : type === 'textarea' ? (
        <textarea
          id={name}
          name={name}
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          rows="4"
          className={error ? 'input-error' : ''}
        />
      ) : (
        <input
          id={name}
          type={type}
          name={name}
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          required={required}
          className={error ? 'input-error' : ''}
        />
      )}

      {error && <span className="field-error">{error}</span>}
    </div>
  );
});

FormField.displayName = 'FormField';

export default FormField;
```

### Usage:
```jsx
<FormField
  label="Patient Name"
  type="text"
  name="patientName"
  value={formData.patientName}
  onChange={(value) => setFormData({...formData, patientName: value})}
  required
  error={errors.patientName}
/>

<FormField
  label="Gender"
  type="select"
  name="gender"
  value={formData.gender}
  onChange={(value) => setFormData({...formData, gender: value})}
  options={genders}
/>
```

---

## FIX #5: Fix useEffect Circular Dependencies

### Problem in Navigation.jsx:
```javascript
// Current (problematic)
const loadTimepoints = useCallback(async (patientId) => {
    // ... uses 'cache'
}, [cache, cacheTimeout]); // cache changes → loadTimepoints changes → useEffect re-runs

useEffect(() => {
    loadTimepoints(patientId);
}, [patientId, loadTimepoints]); // Circular dependency!
```

### Solution:
```javascript
// Fixed version
const loadTimepoints = useCallback(
  async (patientId) => {
    if (!patientId) return;

    // Check cache
    if (cache.has(`patient_${patientId}`)) {
      const cached = cache.get(`patient_${patientId}`);
      if (Date.now() - cached.timestamp < 5 * 60 * 1000) {
        setTimepoints(cached.data);
        return;
      }
    }

    // Fetch new data
    try {
      const response = await fetch(`/api/gettimepoints?code=${patientId}`);
      const data = await response.json();
      
      // Update cache without invalidating callback
      setCache(prev => {
        const newCache = new Map(prev);
        newCache.set(`patient_${patientId}`, {
          data,
          timestamp: Date.now()
        });
        return newCache;
      });
      
      setTimepoints(data);
    } catch (err) {
      console.error('Error loading timepoints:', err);
    }
  },
  [] // No dependencies! Uses state setter instead
);

useEffect(() => {
  loadTimepoints(patientId);
}, [patientId]); // Only depend on patientId, not callback
```

---

## FIX #6: Migrate TomSelect to React Component

### Problem
TomSelect is initialized imperatively with manual refs and cleanup.

### Solution: Use react-select instead

**Installation:**
```bash
npm install react-select
```

**File: `/public/js/components/react/PatientQuickSearch.jsx` (refactored)**
```jsx
import React, { useState, useEffect, useCallback } from 'react';
import Select from 'react-select';

const PatientQuickSearch = ({ allPatients = [] }) => {
  const [selectedPatient, setSelectedPatient] = useState(null);

  const patientOptions = useCallback(() => {
    return allPatients.map(p => ({
      value: p.id,
      label: p.name
    }));
  }, [allPatients]);

  const handleSelectChange = (option) => {
    if (option) {
      window.location.href = `/patient/${option.value}/works`;
    }
  };

  return (
    <div style={{ marginBottom: '2rem' }}>
      <label>Quick Search by Name</label>
      <Select
        options={patientOptions()}
        onChange={handleSelectChange}
        value={selectedPatient}
        placeholder="Type to search..."
        isClearable
      />
    </div>
  );
};

export default PatientQuickSearch;
```

No more imperative DOM manipulation, no more manual cleanup!

---

## FIX #7: Reduce Prop Drilling with Enhanced GlobalStateContext

### Problem
patientId, workId passed through 3+ component levels.

### Solution: Enhance GlobalStateContext

**File: `/public/js/single-spa/contexts/GlobalStateContext.jsx` (enhanced)**
```jsx
import React, { createContext, useContext, useState, useCallback } from 'react';

const GlobalStateContext = createContext();

export function GlobalStateProvider({ children }) {
  // ... existing state ...
  const [user, setUser] = useState(null);
  const [currentPatient, setCurrentPatient] = useState(null);
  const [websocket, setWebsocket] = useState(null);
  const [isWebSocketConnected, setIsWebSocketConnected] = useState(false);

  // NEW: Navigation state
  const [navigationState, setNavigationState] = useState({
    patientId: null,
    workId: null,
    visitId: null
  });

  // Helper to update navigation state
  const updateNavigationState = useCallback((newState) => {
    setNavigationState(prev => ({
      ...prev,
      ...newState
    }));
  }, []);

  const value = {
    // ... existing ...
    user,
    setUser,
    currentPatient,
    setCurrentPatient,
    websocket,
    isWebSocketConnected,
    
    // NEW: Navigation
    navigationState,
    updateNavigationState,
    
    // Convenience helpers
    setPatientId: (id) => updateNavigationState({ patientId: id }),
    setWorkId: (id) => updateNavigationState({ workId: id }),
    setVisitId: (id) => updateNavigationState({ visitId: id }),
  };

  return (
    <GlobalStateContext.Provider value={value}>
      {children}
    </GlobalStateContext.Provider>
  );
}

export function useGlobalState() {
  const context = useContext(GlobalStateContext);
  if (!context) {
    throw new Error('useGlobalState must be used within GlobalStateProvider');
  }
  return context;
}

export default GlobalStateContext;
```

### Usage in components:
```jsx
import { useGlobalState } from '/js/single-spa/contexts/GlobalStateContext';

const MyComponent = () => {
  const { navigationState, setPatientId } = useGlobalState();
  
  // No need to pass patientId as prop!
  const { patientId, workId } = navigationState;
  
  useEffect(() => {
    setPatientId(123); // Update global state
  }, []);
  
  return <div>{patientId}</div>;
};
```

---

## Summary of Changes

| Fix | Priority | Files Affected | Effort |
|-----|----------|----------------|--------|
| Add Error Boundaries | CRITICAL | +1 new, 10 updated | 2 hours |
| Break Down PatientManagement | HIGH | 1 → 6 files | 4 hours |
| Add Memoization | HIGH | 7 files | 3 hours |
| Create FormField Component | MEDIUM | +1 new, 5 updated | 2 hours |
| Fix useEffect Dependencies | MEDIUM | 3 files | 1 hour |
| Migrate TomSelect | MEDIUM | 2 files | 2 hours |
| Enhance GlobalStateContext | MEDIUM | 1 file, +5 usages | 2 hours |

**Total estimated effort: 16 hours**

