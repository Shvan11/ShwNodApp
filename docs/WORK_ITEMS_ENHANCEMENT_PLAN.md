# tblWorkItems Enhancement Plan

## Overview
Refactor tblWorkItems to remove redundant WorkTypeID, implement normalized tooth tracking via junction table, and remove "Multiple" work type.

## Current State Analysis

### tblWorkItems Schema (Before)
| Column | Type | Notes |
|--------|------|-------|
| ID | int (PK) | Identity |
| WorkID | int (FK) | References tblwork |
| **WorkTypeID** | int | **TO BE REMOVED** - redundant with tblwork.Typeofwork |
| **Tooth** | nvarchar(50) | **TO BE REMOVED** - replaced by junction table |
| FillingType | nvarchar(50) | Keep |
| FillingDepth | nvarchar(50) | Keep |
| CanalsNo | int | Keep |
| ItemCost | int | Keep |
| StartDate | date | Keep |
| CompletedDate | date | Keep |
| Note | nvarchar(max) | Keep |

### Existing Data Stats
- **888 work items** with tooth data in various formats
- **1 work** uses "Multiple" type (ID=16)
- Tooth formats found: `"UR4"`, `"LR4 & LR5"`, `"UR2,UR1,UL1"`, `"LR6& LR7"`

---

## Phase 1: Create New Tables

### 1.1 Create tblToothNumber Lookup Table

```sql
CREATE TABLE tblToothNumber (
    ID INT IDENTITY(1,1) PRIMARY KEY,
    ToothCode NVARCHAR(10) NOT NULL UNIQUE,
    ToothName NVARCHAR(100) NOT NULL,
    Quadrant NVARCHAR(2) NOT NULL,  -- UR, UL, LR, LL
    ToothNumber TINYINT NOT NULL,    -- 1-8 for permanent, 1-5 (A-E) for deciduous
    IsPermanent BIT NOT NULL DEFAULT 1,
    SortOrder INT NOT NULL
);
```

**Data: 52 teeth total**

**Permanent Teeth (32):**
| Quadrant | Teeth |
|----------|-------|
| UR (Upper Right) | UR8, UR7, UR6, UR5, UR4, UR3, UR2, UR1 |
| UL (Upper Left) | UL1, UL2, UL3, UL4, UL5, UL6, UL7, UL8 |
| LR (Lower Right) | LR8, LR7, LR6, LR5, LR4, LR3, LR2, LR1 |
| LL (Lower Left) | LL1, LL2, LL3, LL4, LL5, LL6, LL7, LL8 |

**Deciduous Teeth (20):**
| Quadrant | Teeth |
|----------|-------|
| UR (Upper Right) | URE, URD, URC, URB, URA |
| UL (Upper Left) | ULA, ULB, ULC, ULD, ULE |
| LR (Lower Right) | LRE, LRD, LRC, LRB, LRA |
| LL (Lower Left) | LLA, LLB, LLC, LLD, LLE |

### 1.2 Create tblWorkItemTeeth Junction Table

```sql
CREATE TABLE tblWorkItemTeeth (
    ID INT IDENTITY(1,1) PRIMARY KEY,
    WorkItemID INT NOT NULL,
    ToothID INT NOT NULL,
    CONSTRAINT FK_WorkItemTeeth_WorkItem FOREIGN KEY (WorkItemID)
        REFERENCES tblWorkItems(ID) ON DELETE CASCADE,
    CONSTRAINT FK_WorkItemTeeth_Tooth FOREIGN KEY (ToothID)
        REFERENCES tblToothNumber(ID),
    CONSTRAINT UQ_WorkItemTeeth UNIQUE (WorkItemID, ToothID)
);

CREATE INDEX IX_WorkItemTeeth_WorkItemID ON tblWorkItemTeeth(WorkItemID);
CREATE INDEX IX_WorkItemTeeth_ToothID ON tblWorkItemTeeth(ToothID);
```

---

## Phase 2: Data Migration

### 2.1 Parse and Migrate Existing Tooth Data

The existing Tooth column contains data in various formats:
- Single: `"UR4"`, `"ur2"` (case insensitive)
- Ampersand separated: `"LR4 & LR5"`, `"LR6& LR7"`
- Comma separated: `"UR2,UR1,UL1"`
- Mixed spacing variations

**Migration Script Logic:**
1. For each work item with Tooth data
2. Parse the string (split by `,`, `&`, normalize whitespace)
3. Match each tooth code to tblToothNumber (case insensitive)
4. Insert into tblWorkItemTeeth

### 2.2 Handle "Multiple" Work Type

Only 1 work uses this type. Options:
- **Option A**: Change to most appropriate specific type
- **Option B**: Change to "Other" (ID=13)
- Then DELETE "Multiple" from tblWorkType

---

## Phase 3: Schema Changes

### 3.1 Remove Deprecated Columns

```sql
-- After migration is verified
ALTER TABLE tblWorkItems DROP COLUMN WorkTypeID;
ALTER TABLE tblWorkItems DROP COLUMN Tooth;
```

### 3.2 Remove "Multiple" Work Type

```sql
DELETE FROM tblWorkType WHERE ID = 16;
```

---

## Phase 4: Update Backend

### 4.1 Update work-queries.js

**Modified Functions:**
- `getWorkItems(workId)` - JOIN with tblWorkItemTeeth and tblToothNumber
- `addWorkItem(itemData)` - Accept teeth array, insert into junction table
- `updateWorkItem(itemId, itemData)` - Update junction table entries
- `deleteWorkItem(itemId)` - CASCADE handles junction cleanup

**New Functions:**
- `getToothNumbers()` - Get all teeth for dropdown
- `getWorkItemTeeth(workItemId)` - Get teeth for specific item

### 4.2 Update work.routes.js

**Modified Endpoints:**
- `GET /api/work/:workId/items` - Include teeth array in response
- `POST /api/work/:workId/items` - Accept `teeth: [toothId, ...]` array
- `PUT /api/work/item/:itemId` - Accept `teeth: [toothId, ...]` array

**New Endpoints:**
- `GET /api/teeth` - Get tooth lookup for dropdowns

---

## Phase 5: Update Frontend

### 5.1 Components to Update
- Work item forms - Replace single tooth input with multi-select
- DentalChart.jsx - Allow multi-tooth selection mode
- Any work item display components

---

## New Data Model

```
tblwork (WorkID, Typeofwork, ...)
    │
    └── tblWorkItems (ID, WorkID, FillingType, ...)
            │
            └── tblWorkItemTeeth (WorkItemID, ToothID)
                    │
                    └── tblToothNumber (ID, ToothCode, ...)
```

**Query Example: Get work items with teeth**
```sql
SELECT
    wi.ID,
    wi.WorkID,
    wi.FillingType,
    wi.FillingDepth,
    wi.CanalsNo,
    wi.ItemCost,
    wi.StartDate,
    wi.CompletedDate,
    wi.Note,
    STRING_AGG(tn.ToothCode, ', ') AS Teeth
FROM tblWorkItems wi
LEFT JOIN tblWorkItemTeeth wit ON wi.ID = wit.WorkItemID
LEFT JOIN tblToothNumber tn ON wit.ToothID = tn.ID
WHERE wi.WorkID = @WorkID
GROUP BY wi.ID, wi.WorkID, wi.FillingType, wi.FillingDepth,
         wi.CanalsNo, wi.ItemCost, wi.StartDate, wi.CompletedDate, wi.Note
ORDER BY wi.ID;
```

---

## Implementation Order

1. ✅ Create tblToothNumber (no impact on existing system)
2. ✅ Populate tblToothNumber with 52 teeth
3. ✅ Create tblWorkItemTeeth junction table
4. ✅ Migrate existing Tooth data to junction table (861 items → 885 junction records)
5. ✅ Verify migration (count records, spot check)
6. ✅ Update backend queries (work-queries.js)
7. ✅ Update API routes (work.routes.js)
8. ✅ Update frontend components (WorkComponent.jsx)
9. ✅ Remove WorkTypeID and Tooth columns from tblWorkItems
10. ✅ Remove "Multiple" work type (ID=16)

## Completed: 2024-12-08

---

## Phase 6: Type-Specific Fields Enhancement (2024-12-08)

### New Columns Added to tblWorkItems

| Column | Type | Purpose |
|--------|------|---------|
| WorkingLength | nvarchar(200) | Endo - working length per canal |
| ImplantLength | decimal(5,2) | Implant - length in mm |
| ImplantDiameter | decimal(5,2) | Implant - diameter in mm |
| Material | nvarchar(100) | Crown/Bridge/Veneers - material type |
| LabName | nvarchar(100) | Crown/Bridge/Veneers - lab name |

### Work Type Categories

**Ortho-Related Works** (Need Visits & Diagnosis, NO Details):
- Ortho (Braces) - ID: 1
- Ortho Phase 1 - ID: 2
- Relapse - ID: 11
- Ortho (Aligners) - ID: 19
- Ortho (Mixed) - ID: 20

Note: Aligner (Lab) - ID: 21 is NOT included (lab work, not patient treatment)

**Works Needing Details** (NO Visits/Diagnosis):
- Filling - ID: 4
- Endo - ID: 5
- Exo (Extraction) - ID: 7
- Veneers - ID: 9
- Surgery - ID: 10
- Implant - ID: 15
- Bridge - ID: 17

### Type-Specific Display Fields

| Work Type | Fields Displayed |
|-----------|-----------------|
| Endo | Tooth, Canals, Working Length, Notes |
| Filling | Tooth, Type, Depth, Notes |
| Implant | Tooth Position, Length (mm), Diameter (mm), Notes |
| Bridge/Veneers | Teeth, Material, Lab, Notes |
| Surgery/Exo | Tooth, Notes |

### Frontend Configuration

New file created: `/public/js/config/workTypeConfig.js`

Contains:
- Work type ID constants
- `isOrthoWork()` - Check if work needs visits/diagnosis
- `needsDetails()` - Check if work needs treatment items
- `getWorkTypeConfig()` - Get field configuration for work type
- Material, filling type, and depth options

---

## Rollback Plan

If issues arise:
1. Junction table can be dropped without affecting tblWorkItems
2. Old columns remain until Phase 3.1 is executed
3. Keep backup of tblWorkItems before column removal
