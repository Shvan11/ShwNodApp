# Work Status Select Box Implementation Plan

## Executive Summary
Add a **Status** field as a select box to the "Basic Info" tab of the work edit form (`NewWorkComponent`). This is a **CRITICAL** change that affects database constraints, authentication, business logic, and multiple API endpoints.

---

## Current Status Implementation Analysis

### Database Schema
- **Table**: `tblwork`
- **Column**: `Status` (tinyint, NOT NULL, DEFAULT = 1)
- **Foreign Key**: `FK_Work_Status` → `tblWorkStatus.StatusID`
- **CRITICAL Constraint**: `UNQ_tblWork_Active` - **UNIQUE INDEX on (PersonID) WHERE Status = 1**
  - **Business Rule**: Only ONE active work per patient at a time
  - **Impact**: Changing status to Active (1) can trigger constraint violation

### Status Values (from `tblWorkStatus`)
```sql
1 = Active      -- Ongoing treatment
2 = Finished    -- Completed successfully
3 = Discontinued -- Abandoned by patient
```

### Current Status Change Methods
**Separate API Endpoints** (NO direct status updates via `/updatework`):
1. **POST /api/finishwork** - Changes Status to 2 (Finished)
2. **POST /api/discontinuework** - Changes Status to 3 (Discontinued)
3. **POST /api/reactivatework** - Changes Status to 1 (Active)
   - **Validates**: No other active work exists for the patient
   - **Error Handling**: Returns 409 Conflict if constraint violation

### Authentication & Authorization
**Current `/updatework` endpoint**:
- **Authentication**: Required (`authenticate` middleware)
- **Authorization**: `admin` OR `secretary` roles
- **Financial Field Protection**:
  - **Secretary Restriction**: Cannot edit `TotalRequired`, `Currency`, `Paid`, `Discount` for works NOT created today
  - **Admin**: Full access to all fields

---

## Critical Business Rules & Constraints

### Rule 1: One Active Work Per Patient
- **Database Constraint**: `UNQ_tblWork_Active` enforces uniqueness
- **Validation Required**: Before setting Status = 1, check for existing active work
- **User Experience**: Must provide clear error message with existing work details

### Rule 2: Status Transition Logic
**Valid Transitions**:
```
Active (1) → Finished (2)     ✅ Complete treatment
Active (1) → Discontinued (3) ✅ Patient abandoned
Finished (2) → Active (1)     ✅ Reactivate (requires validation)
Discontinued (3) → Active (1) ✅ Reactivate (requires validation)
Finished (2) → Discontinued (3) ❓ Edge case - should allow?
Discontinued (3) → Finished (2) ❓ Edge case - should allow?
```

**Recommendation**: Allow all transitions but validate Active status change.

### Rule 3: Payment Validation
- **Current Check Constraint**: `CK_MoreThanTotalW` - Ensures total paid ≤ total required
- **Impact**: Finishing work should verify payment status
- **UI Consideration**: Warn user if finishing work with outstanding balance

### Rule 4: Date Constraints
**Existing Constraints**:
- `CK_tblwork_Deb`: FPhotoDate ≥ DebondDate
- `CK_tblwork`: FPhotoDate > IPhotoDate
- `CK_tblwork_DebIPh`: DebondDate > IPhotoDate
- **Impact**: No direct impact on Status, but business logic may require dates when finishing

---

## Affected Components

### Backend Files
1. **`routes/api/work.routes.js`**
   - `/updatework` endpoint - **MAJOR CHANGES**
   - `/finishwork`, `/discontinuework`, `/reactivatework` - Keep for backward compatibility
   - Add status validation logic

2. **`services/database/queries/work-queries.js`**
   - `updateWork()` - Handle status changes with validation
   - `getActiveWork()` - Used for validation
   - Export `WORK_STATUS` constants

3. **`services/business/WorkService.js`** (if exists)
   - Add status transition validation logic
   - Centralize business rules

### Frontend Files
1. **`public/js/components/react/NewWorkComponent.jsx`** - **PRIMARY CHANGES**
   - Add Status select box in Basic Info tab
   - Add validation before submission
   - Handle status-specific UI/UX (warnings, confirmations)

2. **`public/js/components/react/WorkComponent.jsx`**
   - Update to use new status update method (optional - can keep existing buttons)
   - Ensure compatibility

3. **`public/js/components/react/WorkCard.jsx`**
   - Already uses WORK_STATUS constants
   - No changes needed

### Database
- **No schema changes needed** - All constraints already exist
- **Data migration**: None required

---

## Implementation Plan

### Phase 1: Backend Validation & API Updates

#### Step 1.1: Add Status Validation Helper (NEW)
**File**: `services/database/queries/work-queries.js`

```javascript
/**
 * Validate status transition for a work
 * @param {number} workId - Work ID being updated
 * @param {number} newStatus - New status value (1, 2, or 3)
 * @param {number} personId - Patient ID (required for Active status)
 * @returns {Promise<{valid: boolean, error?: string, existingWork?: Object}>}
 */
export const validateStatusChange = async (workId, newStatus, personId) => {
    // If changing to Active (1), check for existing active work
    if (newStatus === WORK_STATUS.ACTIVE && personId) {
        const activeWork = await getActiveWork(personId);

        // If there's an active work and it's NOT the one being updated
        if (activeWork && activeWork.workid !== workId) {
            return {
                valid: false,
                error: 'Patient already has an active work',
                existingWork: {
                    workid: activeWork.workid,
                    type: activeWork.TypeName,
                    doctor: activeWork.DoctorName
                }
            };
        }
    }

    return { valid: true };
};
```

#### Step 1.2: Update `/updatework` Endpoint
**File**: `routes/api/work.routes.js`

**Changes**:
1. Add validation for Status field changes
2. Call `validateStatusChange()` if Status is being updated
3. Return descriptive error for constraint violations
4. Keep authentication/authorization logic unchanged

**Pseudocode**:
```javascript
router.put('/updatework', authenticate, authorize(['admin', 'secretary']), async (req, res) => {
    // ... existing validation ...

    // NEW: If Status is being changed, validate the transition
    if (workData.Status !== undefined) {
        // Get current work to compare status
        const currentWork = await getWorkById(workId);

        if (currentWork.Status !== workData.Status) {
            // Status is changing - validate
            const validation = await validateStatusChange(
                workId,
                workData.Status,
                workData.PersonID || currentWork.PersonID
            );

            if (!validation.valid) {
                return res.status(409).json({
                    error: 'Status Change Conflict',
                    message: validation.error,
                    existingWork: validation.existingWork
                });
            }
        }
    }

    // ... existing financial field validation ...

    // Proceed with update
    const result = await updateWork(parseInt(workId), workData);
    // ...
});
```

#### Step 1.3: Add `getWorkById()` Helper
**File**: `services/database/queries/work-queries.js`

```javascript
export const getWorkById = async (workId) => {
    return executeQuery(
        `SELECT * FROM tblwork WHERE workid = @WorkID`,
        [['WorkID', TYPES.Int, workId]],
        (columns) => ({ /* map columns */ }),
        (results) => results[0]
    );
};
```

### Phase 2: Frontend UI Changes

#### Step 2.1: Add Status Select Box to NewWorkComponent
**File**: `public/js/components/react/NewWorkComponent.jsx`

**Changes**:
1. Add status dropdown after Work Type in Basic Info tab
2. Fetch work statuses on mount
3. Show warning when changing to Finished/Discontinued
4. Show confirmation dialog for status changes

**UI Location** (in Basic Info tab, after Work Type):
```jsx
{/* Work Type - Existing */}
<div className="form-group">
    <label htmlFor="workType">Work Type *</label>
    <select id="workType" ...>
        {/* existing options */}
    </select>
</div>

{/* NEW: Work Status */}
<div className="form-group">
    <label htmlFor="status">Status *</label>
    <select
        id="status"
        value={formData.Status}
        onChange={handleStatusChange}
        className="form-control"
        disabled={!workId} // Only allow changing status for existing works
    >
        <option value={1}>Active</option>
        <option value={2}>Finished</option>
        <option value={3}>Discontinued</option>
    </select>
    {formData.Status === 2 && (
        <small className="form-text text-warning">
            ⚠️ Finishing a work marks the treatment as completed
        </small>
    )}
    {formData.Status === 3 && (
        <small className="form-text text-warning">
            ⚠️ Discontinuing a work indicates the patient abandoned treatment
        </small>
    )}
</div>
```

#### Step 2.2: Add Status Change Handler
```javascript
const [originalStatus, setOriginalStatus] = useState(null);
const [showStatusConfirm, setShowStatusConfirm] = useState(false);

const handleStatusChange = (e) => {
    const newStatus = parseInt(e.target.value);

    // If status is changing from original, show confirmation
    if (originalStatus && newStatus !== originalStatus) {
        setFormData({ ...formData, Status: newStatus });
        setShowStatusConfirm(true);
    } else {
        setFormData({ ...formData, Status: newStatus });
    }
};
```

#### Step 2.3: Add Status Confirmation Dialog
```jsx
{showStatusConfirm && (
    <div className="modal-overlay">
        <div className="modal-content">
            <h3>Confirm Status Change</h3>
            <p>
                Are you sure you want to change this work from{' '}
                <strong>{getStatusLabel(originalStatus)}</strong> to{' '}
                <strong>{getStatusLabel(formData.Status)}</strong>?
            </p>
            {formData.Status === 1 && (
                <p className="warning">
                    ⚠️ This will make this work the active work for this patient.
                    Any other active work will need to be finished or discontinued first.
                </p>
            )}
            <div className="modal-actions">
                <button onClick={() => {
                    setFormData({ ...formData, Status: originalStatus });
                    setShowStatusConfirm(false);
                }}>Cancel</button>
                <button onClick={() => setShowStatusConfirm(false)} className="btn-primary">
                    Confirm
                </button>
            </div>
        </div>
    </div>
)}
```

#### Step 2.4: Handle API Error Responses
```javascript
const handleFormSubmit = async (e) => {
    // ... existing code ...

    try {
        const response = await fetch(url, options);
        const data = await response.json();

        if (!response.ok) {
            // Handle 409 Conflict (Active work already exists)
            if (response.status === 409 && data.existingWork) {
                setError(
                    `Cannot activate this work: Patient already has an active work:\n\n` +
                    `Work Type: ${data.existingWork.type}\n` +
                    `Doctor: ${data.existingWork.doctor}\n\n` +
                    `Please finish or discontinue the existing work first.`
                );
                return;
            }

            throw new Error(data.error || data.message);
        }

        // Success
        onSave?.(data);
    } catch (err) {
        setError(err.message);
    }
};
```

### Phase 3: Testing & Validation

#### Test Cases
1. **Create New Work**
   - Status defaults to Active (1) ✅
   - Cannot select status (disabled field) ✅

2. **Edit Existing Work - No Status Change**
   - Update other fields without touching Status ✅
   - No validation triggered ✅

3. **Change Active → Finished**
   - Confirmation dialog shown ✅
   - Update succeeds ✅

4. **Change Active → Discontinued**
   - Confirmation dialog shown ✅
   - Update succeeds ✅

5. **Change Finished/Discontinued → Active**
   - **No other active work**: Update succeeds ✅
   - **Other active work exists**: Error 409, descriptive message ✅

6. **Multiple Active Work Attempt**
   - Database constraint prevents duplicate active works ✅
   - User sees friendly error message ✅

7. **Secretary Permission Test**
   - Secretary can change status for today's works ✅
   - Secretary can change status for old works ✅ (Status is NOT a financial field)

8. **Admin Permission Test**
   - Admin has full access ✅

---

## Authorization Matrix

| Field            | Secretary (Same Day) | Secretary (Old Work) | Admin |
|------------------|---------------------|---------------------|-------|
| Status           | ✅ Allow            | ✅ Allow            | ✅ Allow |
| TotalRequired    | ✅ Allow            | ❌ Block            | ✅ Allow |
| Currency         | ✅ Allow            | ❌ Block            | ✅ Allow |
| Paid             | ✅ Allow            | ❌ Block            | ✅ Allow |
| Discount         | ✅ Allow            | ❌ Block            | ✅ Allow |
| Other Fields     | ✅ Allow            | ✅ Allow            | ✅ Allow |

**Decision**: Status is NOT a financial field, so Secretary can change it for any work.

---

## Backward Compatibility

### Keep Existing Endpoints
- **POST /api/finishwork** - Keep for existing UI buttons
- **POST /api/discontinuework** - Keep for existing UI buttons
- **POST /api/reactivatework** - Keep for existing UI buttons

**Rationale**:
- WorkComponent has action buttons that use these endpoints
- No need to refactor existing working code
- Provides two ways to change status (form + buttons)

---

## Risk Assessment

### High Risk
1. **Database Constraint Violation**: Unique index on Active status
   - **Mitigation**: Comprehensive validation before update
   - **Fallback**: Descriptive error messages

2. **Concurrent Updates**: Two users changing status simultaneously
   - **Mitigation**: Database constraint will catch it
   - **User Impact**: Second user sees error, must retry

### Medium Risk
1. **Permission Confusion**: Status as financial field?
   - **Mitigation**: Clearly document that Status is NOT financial
   - **Decision**: Secretary CAN change status

2. **UI Complexity**: Multiple ways to change status
   - **Mitigation**: Clear UI, good error messages
   - **Testing**: Comprehensive test cases

### Low Risk
1. **Performance**: Additional validation query
   - **Impact**: One extra SELECT per status change (minimal)

---

## Implementation Steps (Ordered)

### Step 1: Backend Validation (30 mins)
- [ ] Add `validateStatusChange()` to work-queries.js
- [ ] Add `getWorkById()` to work-queries.js
- [ ] Export functions in work-queries.js

### Step 2: API Endpoint Update (20 mins)
- [ ] Update `/updatework` in work.routes.js
- [ ] Add status validation logic
- [ ] Add error handling for 409 conflicts
- [ ] Test with Postman/curl

### Step 3: Frontend UI (45 mins)
- [ ] Add Status select box to NewWorkComponent
- [ ] Add status change handler
- [ ] Add confirmation dialog
- [ ] Add error handling for 409 responses
- [ ] Add UI warnings for Finished/Discontinued

### Step 4: Testing (30 mins)
- [ ] Test all 8 test cases above
- [ ] Test with different user roles (admin, secretary)
- [ ] Test concurrent updates
- [ ] Test UI flow (create → edit → status change)

### Step 5: Documentation (15 mins)
- [ ] Update API documentation
- [ ] Add comments to code
- [ ] Update CLAUDE.md if needed

**Total Estimated Time**: ~2.5 hours

---

## Rollback Plan

If issues arise:
1. **Frontend**: Remove Status select box from NewWorkComponent
2. **Backend**: Remove validation logic from `/updatework`
3. **Fallback**: Continue using separate endpoints (finishwork, discontinuework, reactivatework)

**No database changes needed**, so rollback is simple.

---

## Questions for User

Before implementing, confirm:

1. **Status Change Permission**: Should Secretary be able to change status for OLD works?
   - **Recommendation**: YES (Status is not financial data)

2. **Status Transitions**: Should we allow Finished ↔ Discontinued transitions?
   - **Recommendation**: YES (allow all transitions, validate only Active)

3. **UI Location**: Status field in "Basic Info" tab - correct?
   - **Recommendation**: YES (alongside Work Type)

4. **Disable for New Works**: Status select disabled for new works (always Active)?
   - **Recommendation**: YES (only allow changing status when editing)

5. **Keep Old Endpoints**: Keep finishwork/discontinuework/reactivatework endpoints?
   - **Recommendation**: YES (for backward compatibility with existing UI)

---

## Success Criteria

✅ Status can be changed via edit form
✅ Validation prevents multiple active works per patient
✅ Clear error messages for constraint violations
✅ Secretary can change status (not blocked by financial restrictions)
✅ Admin has full access
✅ Existing status change buttons still work
✅ No database schema changes needed
✅ Comprehensive test coverage

---

## Next Steps

**Awaiting user confirmation on questions above before proceeding with implementation.**
