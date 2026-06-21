# Label Printing Flow

## Rich Label Format
```javascript
{
    text: "U1/L1",        // Label sequence (required)
    patientName: "Ahmad", // Patient name (required)
    doctorName: "",       // Doctor name (optional)
    includeLogo: true     // Show logo (optional, default: false)
}
```

## Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  PatientSets.tsx                                                │
│  • "Print" button → opens LabelPreviewModal (single batch)      │
│  • "Queue" button → adds to PrintQueueContext                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  PrintQueueContext.tsx                                          │
│  • Stores batches with patient/doctor metadata                  │
│  • sessionStorage persistence across navigation                 │
│  • buildLabelsForPrint() → flattens to rich labels array        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  LabelPreviewModal.tsx                                          │
│  • Single mode: labels from props, shared patient/doctor        │
│  • Queue mode: labels from context, per-batch metadata          │
│  • buildRichLabels() → unified rich labels array                │
│  • POST /api/aligner/labels/generate                            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  aligner.routes.ts                                              │
│  • Validates { labels[], startingPosition, arabicFont }         │
│  • Calls AlignerLabelGenerator.generate()                       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  aligner-label-generator.ts                                     │
│  • OL291 format: 3x4 grid, 12 labels per US Letter sheet        │
│  • Each label renders its own patient/doctor/logo               │
│  • Returns PDF buffer + stats (totalLabels, totalPages, next)   │
└─────────────────────────────────────────────────────────────────┘
```

## Key Files
| File | Purpose |
|------|---------|
| `public/js/pages/aligner/PatientSets.tsx` | Print/Queue buttons |
| `public/js/contexts/PrintQueueContext.tsx` | Global queue state |
| `public/js/components/react/PrintQueueIndicator.tsx` | Floating queue UI |
| `public/js/components/react/LabelPreviewModal.tsx` | Preview & generate |
| `routes/api/aligner.routes.ts` | API endpoint |
| `services/pdf/aligner-label-generator.ts` | PDF generation |

## API

**POST** `/api/aligner/labels/generate`

```javascript
// Request
{
    labels: [{ text, patientName, doctorName?, includeLogo? }, ...],
    startingPosition: 1,  // 1-12
    arabicFont: "cairo"   // optional
}

// Response — a RAW PDF blob (not a JSON envelope), so the client reads it via
// `.blob()` (a sanctioned raw-fetch in LabelPreviewModal; see CLAUDE.md "HTTP funnel").
//   Content-type:        application/pdf
//   Content-Disposition: inline; filename="Labels_{firstPatient}.pdf"
//   X-Total-Labels:      6     ← stats ride response headers, not the body
//   X-Total-Pages:       1
//   X-Next-position:     7     (carried to the next batch's startingPosition)
```
