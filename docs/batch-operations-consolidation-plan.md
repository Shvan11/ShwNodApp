# Aligner Batch Operations Consolidation Plan

## Executive Summary

Consolidate fragmented batch state transition operations into a single stored procedure `usp_UpdateBatchStatus`, replacing direct UPDATE queries with validated, consistent database operations.

---

## Problem Statement

### Current State Analysis

Batch state transitions are handled inconsistently:

| Operation | Current Implementation | Issues |
|-----------|----------------------|--------|
| Mark Manufactured | Direct UPDATE query | No validation, no error handling |
| Mark Delivered | `usp_MarkBatchDelivered` SP | ✅ Proper SP, but separate from others |
| Undo Manufacture | Direct UPDATE query | No validation (could break if already delivered) |
| Undo Delivery | Direct UPDATE query | No cleanup of related fields |

### Current Code Locations

```
Frontend (React)
└── public/js/pages/aligner/PatientSets.tsx
    ├── handleMarkManufactured()    → POST /api/aligner/batches/:id/manufacture
    ├── handleMarkDelivered()       → POST /api/aligner/batches/:id/deliver
    ├── handleUndoManufactured()    → POST /api/aligner/batches/:id/undo-manufacture
    └── handleUndoDelivered()       → POST /api/aligner/batches/:id/undo-deliver

API Routes
└── routes/api/aligner.routes.ts
    ├── POST /aligner/batches/:batchId/manufacture     (line 935)
    ├── POST /aligner/batches/:batchId/deliver         (line 965)
    ├── POST /aligner/batches/:batchId/undo-manufacture (line 1003)
    └── POST /aligner/batches/:batchId/undo-deliver    (line 1033)

Service Layer
└── services/business/AlignerService.ts
    ├── markBatchManufactured()    (line 573)
    ├── markBatchDelivered()       (line 530)
    ├── undoManufactureBatch()     (line 604)
    └── undoDeliverBatch()         (line 635)

Database Queries
└── services/database/queries/aligner-queries.ts
    ├── markBatchAsManufactured()  (line 1195) → Direct UPDATE
    ├── markBatchAsDelivered()     (line 1152) → usp_MarkBatchDelivered SP
    ├── undoManufactureBatch()     (line 1205) → Direct UPDATE
    └── undoDeliverBatch()         (line 1215) → Direct UPDATE
```

---

## Existing Infrastructure

### Stored Procedures Already Handling RemainingAligners

| Stored Procedure | Purpose | RemainingAligners |
|-----------------|---------|-------------------|
| `usp_CreateAlignerBatch` | Create new batch | ✅ Validates & decrements |
| `usp_UpdateAlignerBatch` | Edit batch data | ✅ Validates & adjusts delta |
| `usp_DeleteAlignerBatch` | Delete batch | ✅ Restores counts |
| `usp_MarkBatchDelivered` | Mark delivered | N/A (no count change) |

**Key Finding:** No additional trigger is needed for RemainingAligners maintenance.

### Existing Triggers on tblAlignerBatches

| Trigger | Events | Purpose |
|---------|--------|---------|
| `trg_sync_tblAlignerBatches` | INSERT, UPDATE | Queues changes to SyncQueue for Supabase sync |

**Note:** Sync trigger will automatically fire when our SP updates the batch.

---

## Solution Design

### New Stored Procedure: `usp_UpdateBatchStatus`

**Purpose:** Consolidate ALL batch state transitions with validation and business logic.

#### Parameters

```sql
@AlignerBatchID INT,              -- Required: Batch to update
@Action VARCHAR(20),              -- Required: 'MANUFACTURE', 'DELIVER', 'UNDO_MANUFACTURE', 'UNDO_DELIVERY'
@BatchExpiryDate DATETIME = NULL  -- Optional: For DELIVER action only
```

#### Action Matrix

| Action | Pre-Validation | Updates | Post-Action |
|--------|---------------|---------|-------------|
| `MANUFACTURE` | ManufactureDate must be NULL | `ManufactureDate = GETDATE()` | None |
| `DELIVER` | ManufactureDate must exist, DeliveredToPatientDate must be NULL | `DeliveredToPatientDate = GETDATE()`, `BatchExpiryDate = @param` | If latest batch: activate this, deactivate others |
| `UNDO_MANUFACTURE` | DeliveredToPatientDate must be NULL | `ManufactureDate = NULL` | None |
| `UNDO_DELIVERY` | None | `DeliveredToPatientDate = NULL`, `BatchExpiryDate = NULL` | Consider re-activation logic |

#### Return Values

```sql
-- Returns a result set with:
SELECT
    @AlignerBatchID AS AlignerBatchID,
    @BatchSequence AS BatchSequence,
    @AlignerSetID AS AlignerSetID,
    @Action AS ActionPerformed,
    @Success AS Success,
    @Message AS Message,
    -- For DELIVER action only:
    @WasActivated AS WasActivated,
    @PreviouslyActiveBatchSequence AS PreviouslyActiveBatchSequence
```

#### Business Logic Details

**DELIVER Action (from usp_MarkBatchDelivered):**
1. Verify batch exists and get current state
2. Check if already delivered → return early with status
3. Set `DeliveredToPatientDate = GETDATE()`
4. Set `BatchExpiryDate = @BatchExpiryDate` if provided
5. If this is the latest batch (max BatchSequence):
   - Deactivate all other batches in the set (`IsActive = 0`)
   - Activate this batch (`IsActive = 1`)
6. Return activation status for frontend feedback

**UNDO_MANUFACTURE Action:**
1. Verify batch is not already delivered (validation)
2. Clear `ManufactureDate = NULL`
3. Note: Current code also clears DeliveredToPatientDate, but validation should prevent this case

**UNDO_DELIVERY Action:**
1. Clear `DeliveredToPatientDate = NULL`
2. Clear `BatchExpiryDate = NULL`
3. Consider: Should we reactivate the previous batch? (Decision needed)

---

## Implementation Plan

### Phase 1: Database Migration

**File:** `migrations/sqlserver/usp_UpdateBatchStatus.sql`

```sql
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.usp_UpdateBatchStatus
    @AlignerBatchID INT,
    @Action VARCHAR(20),
    @BatchExpiryDate DATETIME = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        BEGIN TRANSACTION;

        -- Variables for batch state
        DECLARE @AlignerSetID INT;
        DECLARE @BatchSequence INT;
        DECLARE @ManufactureDate DATE;
        DECLARE @DeliveredToPatientDate DATE;
        DECLARE @IsCurrentlyActive BIT;
        DECLARE @Message NVARCHAR(200);
        DECLARE @WasActivated BIT = 0;
        DECLARE @PreviouslyActiveBatchSequence INT = NULL;

        -- Fetch current batch state with lock
        SELECT
            @AlignerSetID = AlignerSetID,
            @BatchSequence = BatchSequence,
            @ManufactureDate = ManufactureDate,
            @DeliveredToPatientDate = DeliveredToPatientDate,
            @IsCurrentlyActive = IsActive
        FROM dbo.tblAlignerBatches WITH (UPDLOCK)
        WHERE AlignerBatchID = @AlignerBatchID;

        IF @AlignerSetID IS NULL
        BEGIN
            THROW 50001, 'Aligner batch not found', 1;
        END

        -- ==========================================
        -- ACTION: MANUFACTURE
        -- ==========================================
        IF @Action = 'MANUFACTURE'
        BEGIN
            IF @ManufactureDate IS NOT NULL
            BEGIN
                SET @Message = 'Batch already manufactured';
                -- Return early, not an error
                SELECT @AlignerBatchID AS AlignerBatchID, @BatchSequence AS BatchSequence,
                       @AlignerSetID AS AlignerSetID, @Action AS ActionPerformed,
                       CAST(1 AS BIT) AS Success, @Message AS Message,
                       CAST(0 AS BIT) AS WasActivated, NULL AS PreviouslyActiveBatchSequence;
                COMMIT TRANSACTION;
                RETURN;
            END

            UPDATE dbo.tblAlignerBatches
            SET ManufactureDate = GETDATE()
            WHERE AlignerBatchID = @AlignerBatchID;

            SET @Message = 'Batch marked as manufactured';
        END

        -- ==========================================
        -- ACTION: DELIVER
        -- ==========================================
        ELSE IF @Action = 'DELIVER'
        BEGIN
            IF @ManufactureDate IS NULL
            BEGIN
                THROW 50002, 'Cannot deliver: batch not yet manufactured', 1;
            END

            IF @DeliveredToPatientDate IS NOT NULL
            BEGIN
                SET @Message = 'Batch already delivered';
                SELECT @AlignerBatchID AS AlignerBatchID, @BatchSequence AS BatchSequence,
                       @AlignerSetID AS AlignerSetID, @Action AS ActionPerformed,
                       CAST(1 AS BIT) AS Success, @Message AS Message,
                       CAST(0 AS BIT) AS WasActivated, NULL AS PreviouslyActiveBatchSequence;
                COMMIT TRANSACTION;
                RETURN;
            END

            -- Update delivery date
            UPDATE dbo.tblAlignerBatches
            SET DeliveredToPatientDate = GETDATE(),
                BatchExpiryDate = @BatchExpiryDate
            WHERE AlignerBatchID = @AlignerBatchID;

            -- Check if this is the latest batch
            DECLARE @MaxBatchSequence INT;
            SELECT @MaxBatchSequence = MAX(BatchSequence)
            FROM dbo.tblAlignerBatches
            WHERE AlignerSetID = @AlignerSetID;

            IF @BatchSequence = @MaxBatchSequence AND @IsCurrentlyActive = 0
            BEGIN
                -- Get previously active batch for logging
                SELECT TOP 1 @PreviouslyActiveBatchSequence = BatchSequence
                FROM dbo.tblAlignerBatches
                WHERE AlignerSetID = @AlignerSetID
                  AND IsActive = 1
                  AND AlignerBatchID != @AlignerBatchID;

                -- Deactivate all other batches
                UPDATE dbo.tblAlignerBatches
                SET IsActive = 0
                WHERE AlignerSetID = @AlignerSetID
                  AND AlignerBatchID != @AlignerBatchID
                  AND IsActive = 1;

                -- Activate this batch
                UPDATE dbo.tblAlignerBatches
                SET IsActive = 1
                WHERE AlignerBatchID = @AlignerBatchID;

                SET @WasActivated = 1;
            END

            SET @Message = 'Batch marked as delivered';
        END

        -- ==========================================
        -- ACTION: UNDO_MANUFACTURE
        -- ==========================================
        ELSE IF @Action = 'UNDO_MANUFACTURE'
        BEGIN
            IF @DeliveredToPatientDate IS NOT NULL
            BEGIN
                THROW 50003, 'Cannot undo manufacture: batch already delivered. Undo delivery first.', 1;
            END

            UPDATE dbo.tblAlignerBatches
            SET ManufactureDate = NULL
            WHERE AlignerBatchID = @AlignerBatchID;

            SET @Message = 'Manufacture undone';
        END

        -- ==========================================
        -- ACTION: UNDO_DELIVERY
        -- ==========================================
        ELSE IF @Action = 'UNDO_DELIVERY'
        BEGIN
            UPDATE dbo.tblAlignerBatches
            SET DeliveredToPatientDate = NULL,
                BatchExpiryDate = NULL
            WHERE AlignerBatchID = @AlignerBatchID;

            SET @Message = 'Delivery undone';
        END

        -- ==========================================
        -- INVALID ACTION
        -- ==========================================
        ELSE
        BEGIN
            THROW 50004, 'Invalid action. Must be MANUFACTURE, DELIVER, UNDO_MANUFACTURE, or UNDO_DELIVERY', 1;
        END

        -- Return success result
        SELECT @AlignerBatchID AS AlignerBatchID, @BatchSequence AS BatchSequence,
               @AlignerSetID AS AlignerSetID, @Action AS ActionPerformed,
               CAST(1 AS BIT) AS Success, @Message AS Message,
               @WasActivated AS WasActivated, @PreviouslyActiveBatchSequence AS PreviouslyActiveBatchSequence;

        COMMIT TRANSACTION;

    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0
            ROLLBACK TRANSACTION;

        DECLARE @ErrorMessage NVARCHAR(4000) = ERROR_MESSAGE();
        DECLARE @ErrorSeverity INT = ERROR_SEVERITY();
        DECLARE @ErrorState INT = ERROR_STATE();

        RAISERROR(@ErrorMessage, @ErrorSeverity, @ErrorState);
    END CATCH
END
GO
```

### Phase 2: Backend Changes

#### File: `services/database/queries/aligner-queries.ts`

**Add new interface and function:**

```typescript
// Add near line 1145 (after existing interfaces)
export interface UpdateBatchStatusResult {
  batchId: number;
  batchSequence: number;
  setId: number;
  action: string;
  success: boolean;
  message: string;
  wasActivated: boolean;
  previouslyActiveBatchSequence: number | null;
}

// Replace existing functions (lines 1195-1220) with:
export async function updateBatchStatus(
  batchId: number,
  action: 'MANUFACTURE' | 'DELIVER' | 'UNDO_MANUFACTURE' | 'UNDO_DELIVERY',
  batchExpiryDate?: Date | null
): Promise<UpdateBatchStatusResult> {
  const params: SqlParam[] = [
    ['AlignerBatchID', TYPES.Int, batchId],
    ['Action', TYPES.VarChar, action],
    ['BatchExpiryDate', TYPES.DateTime, batchExpiryDate || null],
  ];

  const rowMapper = (columns: ColumnValue[]): UpdateBatchStatusResult => ({
    batchId: columns.find((c) => c.metadata.colName === 'AlignerBatchID')?.value as number,
    batchSequence: columns.find((c) => c.metadata.colName === 'BatchSequence')?.value as number,
    setId: columns.find((c) => c.metadata.colName === 'AlignerSetID')?.value as number,
    action: columns.find((c) => c.metadata.colName === 'ActionPerformed')?.value as string,
    success: columns.find((c) => c.metadata.colName === 'Success')?.value as boolean,
    message: columns.find((c) => c.metadata.colName === 'Message')?.value as string,
    wasActivated: columns.find((c) => c.metadata.colName === 'WasActivated')?.value as boolean,
    previouslyActiveBatchSequence: columns.find((c) => c.metadata.colName === 'PreviouslyActiveBatchSequence')?.value as number | null,
  });

  const rows = await executeStoredProcedure<UpdateBatchStatusResult>(
    'usp_UpdateBatchStatus',
    params,
    undefined,
    rowMapper
  );

  if (!rows || rows.length === 0) {
    throw new Error('No result returned from stored procedure');
  }

  return rows[0];
}

// Keep old functions as deprecated wrappers for backwards compatibility during transition:
/** @deprecated Use updateBatchStatus('MANUFACTURE') instead */
export async function markBatchAsManufactured(batchId: number): Promise<void> {
  await updateBatchStatus(batchId, 'MANUFACTURE');
}

/** @deprecated Use updateBatchStatus('UNDO_MANUFACTURE') instead */
export async function undoManufactureBatch(batchId: number): Promise<void> {
  await updateBatchStatus(batchId, 'UNDO_MANUFACTURE');
}

/** @deprecated Use updateBatchStatus('UNDO_DELIVERY') instead */
export async function undoDeliverBatch(batchId: number): Promise<void> {
  await updateBatchStatus(batchId, 'UNDO_DELIVERY');
}
```

#### File: `services/business/AlignerService.ts`

**Update service functions to use new SP:**

```typescript
// Line ~530: Update markBatchDelivered to use new SP
export async function markBatchDelivered(
  batchId: number | string,
  batchExpiryDate?: Date | null
): Promise<alignerQueries.UpdateBatchStatusResult> {
  const parsedBatchId = typeof batchId === 'string' ? parseInt(batchId) : batchId;

  if (isNaN(parsedBatchId)) {
    throw new Error('Invalid batch ID');
  }

  log.info(`Marking batch ${parsedBatchId} as delivered`);

  try {
    const result = await alignerQueries.updateBatchStatus(parsedBatchId, 'DELIVER', batchExpiryDate);

    if (result.wasActivated) {
      log.info(`Batch #${result.batchSequence} delivered and auto-activated (latest batch)`);
    } else {
      log.info(`Batch #${result.batchSequence} delivered`);
    }

    return result;
  } catch (error) {
    log.error('Error marking batch as delivered:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

// Line ~573: Update markBatchManufactured
export async function markBatchManufactured(
  batchId: number | string
): Promise<alignerQueries.UpdateBatchStatusResult> {
  const parsedBatchId = typeof batchId === 'string' ? parseInt(batchId) : batchId;

  if (isNaN(parsedBatchId)) {
    throw new Error('Invalid batch ID');
  }

  log.info(`Marking batch ${parsedBatchId} as manufactured`);

  try {
    const result = await alignerQueries.updateBatchStatus(parsedBatchId, 'MANUFACTURE');
    log.info(`Batch ${parsedBatchId} marked as manufactured`);
    return result;
  } catch (error) {
    log.error('Error marking batch as manufactured:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

// Line ~604: Update undoManufactureBatch
export async function undoManufactureBatch(
  batchId: number | string
): Promise<alignerQueries.UpdateBatchStatusResult> {
  const parsedBatchId = typeof batchId === 'string' ? parseInt(batchId) : batchId;

  if (isNaN(parsedBatchId)) {
    throw new Error('Invalid batch ID');
  }

  log.info(`Undoing manufacture for batch ${parsedBatchId}`);

  try {
    const result = await alignerQueries.updateBatchStatus(parsedBatchId, 'UNDO_MANUFACTURE');
    log.info(`Batch ${parsedBatchId} manufacture undone`);
    return result;
  } catch (error) {
    log.error('Error undoing manufacture:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

// Line ~635: Update undoDeliverBatch
export async function undoDeliverBatch(
  batchId: number | string
): Promise<alignerQueries.UpdateBatchStatusResult> {
  const parsedBatchId = typeof batchId === 'string' ? parseInt(batchId) : batchId;

  if (isNaN(parsedBatchId)) {
    throw new Error('Invalid batch ID');
  }

  log.info(`Undoing delivery for batch ${parsedBatchId}`);

  try {
    const result = await alignerQueries.updateBatchStatus(parsedBatchId, 'UNDO_DELIVERY');
    log.info(`Batch ${parsedBatchId} delivery undone`);
    return result;
  } catch (error) {
    log.error('Error undoing delivery:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
```

#### File: `routes/api/aligner.routes.ts`

**Update API routes to handle new response format:**

```typescript
// Line ~935: Update manufacture endpoint
router.post(
  '/aligner/batches/:batchId/manufacture',
  asyncHandler(async (req, res) => {
    const { batchId } = req.params;
    try {
      const result = await AlignerService.markBatchManufactured(batchId);
      res.json({
        success: true,
        message: result.message,
        data: {
          batchId: result.batchId,
          batchSequence: result.batchSequence,
          action: result.action,
        },
      });
    } catch (error) {
      log.error('Error marking batch as manufactured:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to mark batch as manufactured',
      });
    }
  })
);

// Line ~965: Update deliver endpoint (mostly unchanged, but use new result)
router.post(
  '/aligner/batches/:batchId/deliver',
  asyncHandler(async (req, res) => {
    const { batchId } = req.params;
    const { batchExpiryDate } = req.body; // Optional parameter
    try {
      const result = await AlignerService.markBatchDelivered(
        batchId,
        batchExpiryDate ? new Date(batchExpiryDate) : null
      );
      res.json({
        success: true,
        message: result.message,
        data: {
          batchId: result.batchId,
          batchSequence: result.batchSequence,
          setId: result.setId,
          wasActivated: result.wasActivated,
          wasAlreadyActive: !result.wasActivated && result.success,
          wasAlreadyDelivered: result.message === 'Batch already delivered',
          previouslyActiveBatchSequence: result.previouslyActiveBatchSequence,
        },
      });
    } catch (error) {
      log.error('Error marking batch as delivered:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to mark batch as delivered',
      });
    }
  })
);

// Line ~1003: Update undo-manufacture endpoint
router.post(
  '/aligner/batches/:batchId/undo-manufacture',
  asyncHandler(async (req, res) => {
    const { batchId } = req.params;
    try {
      const result = await AlignerService.undoManufactureBatch(batchId);
      res.json({
        success: true,
        message: result.message,
        data: {
          batchId: result.batchId,
          batchSequence: result.batchSequence,
        },
      });
    } catch (error) {
      log.error('Error undoing manufacture:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to undo manufacture',
      });
    }
  })
);

// Line ~1033: Update undo-deliver endpoint
router.post(
  '/aligner/batches/:batchId/undo-deliver',
  asyncHandler(async (req, res) => {
    const { batchId } = req.params;
    try {
      const result = await AlignerService.undoDeliverBatch(batchId);
      res.json({
        success: true,
        message: result.message,
        data: {
          batchId: result.batchId,
          batchSequence: result.batchSequence,
        },
      });
    } catch (error) {
      log.error('Error undoing delivery:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to undo delivery',
      });
    }
  })
);
```

### Phase 3: Frontend Changes

#### File: `public/js/pages/aligner/PatientSets.tsx`

**No changes required!** The frontend already handles the API responses correctly. The response format remains compatible.

However, we should add error handling for the new validation errors:

```typescript
// Line ~631: handleMarkManufactured - add better error handling
const handleMarkManufactured = async (batch: AlignerBatch, e: MouseEvent<HTMLButtonElement>): Promise<void> => {
    // ... existing code ...

    // In the catch block, handle specific validation errors:
    if ((error as Error).message.includes('already manufactured')) {
        toast.info('Batch was already manufactured');
        await refreshData();
    } else {
        toast.error('Failed to mark as manufactured: ' + (error as Error).message);
    }
};

// Line ~662: handleUndoManufactured - handle new validation
const handleUndoManufactured = async (batch: AlignerBatch, e: MouseEvent<HTMLButtonElement>): Promise<void> => {
    // ... existing code ...

    // In the catch block:
    if ((error as Error).message.includes('already delivered')) {
        toast.error('Cannot undo manufacture: batch already delivered. Undo delivery first.');
    } else {
        toast.error('Failed to undo manufacture: ' + (error as Error).message);
    }
};
```

### Phase 4: Cleanup

After successful deployment and verification:

1. **Drop deprecated SP:**
   ```sql
   DROP PROCEDURE IF EXISTS dbo.usp_MarkBatchDelivered;
   ```

2. **Delete migration file:**
   - `migrations/sqlserver/usp_MarkBatchDelivered.sql`

3. **Remove deprecated function wrappers** from `aligner-queries.ts` after confirming no other code uses them.

---

## Files Modified Summary

| Layer | File | Changes |
|-------|------|---------|
| Database | `migrations/sqlserver/usp_UpdateBatchStatus.sql` | NEW - Create consolidated SP |
| Backend | `services/database/queries/aligner-queries.ts` | Add `updateBatchStatus()`, deprecate old functions |
| Backend | `services/business/AlignerService.ts` | Update all 4 functions to use new SP |
| Backend | `routes/api/aligner.routes.ts` | Update response handling for new format |
| Frontend | `public/js/pages/aligner/PatientSets.tsx` | Optional: Enhanced error handling |
| Cleanup | `migrations/sqlserver/usp_MarkBatchDelivered.sql` | DELETE after migration |

---

## Testing Checklist

### Database Level
- [ ] SP creates successfully
- [ ] MANUFACTURE action works for unmanufactured batch
- [ ] MANUFACTURE returns "already manufactured" for manufactured batch
- [ ] DELIVER action works for manufactured batch
- [ ] DELIVER returns error for unmanufactured batch
- [ ] DELIVER activates latest batch correctly
- [ ] UNDO_MANUFACTURE works for manufactured-only batch
- [ ] UNDO_MANUFACTURE returns error for delivered batch
- [ ] UNDO_DELIVERY clears delivery date and expiry date
- [ ] Sync trigger fires after each operation

### API Level
- [ ] POST /manufacture returns success response
- [ ] POST /deliver returns activation info
- [ ] POST /undo-manufacture validates delivery state
- [ ] POST /undo-deliver clears related fields

### Frontend Level
- [ ] Mark Manufactured button works
- [ ] Mark Delivered button works and shows activation toast
- [ ] Undo Manufacture shows error if batch delivered
- [ ] Undo Delivery works correctly
- [ ] Batch cards update state correctly after operations

---

## Rollback Plan

If issues occur:

1. **Keep `usp_MarkBatchDelivered`** - Don't delete until fully verified
2. **Deprecation wrappers** - Old function names still work
3. **Revert service layer** - Point back to old query functions
4. **Drop new SP:**
   ```sql
   DROP PROCEDURE IF EXISTS dbo.usp_UpdateBatchStatus;
   ```

---

## Benefits After Implementation

1. **Single source of truth** for all batch state transitions
2. **Built-in validation** prevents invalid state changes
3. **Consistent error handling** with proper SQL Server error patterns
4. **Automatic activation** of latest delivered batch (preserved)
5. **Transaction safety** with proper rollback on errors
6. **Sync compatibility** - existing triggers continue to work
7. **No RemainingAligners changes needed** - existing SPs handle this
