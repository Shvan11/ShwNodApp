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
│  PatientSets.jsx                                                │
│  • "Print" button → opens LabelPreviewModal (single batch)      │
│  • "Queue" button → adds to PrintQueueContext                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  PrintQueueContext.jsx                                          │
│  • Stores batches with patient/doctor metadata                  │
│  • sessionStorage persistence across navigation                 │
│  • buildLabelsForPrint() → flattens to rich labels array        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  LabelPreviewModal.jsx                                          │
│  • Single mode: labels from props, shared patient/doctor        │
│  • Queue mode: labels from context, per-batch metadata          │
│  • buildRichLabels() → unified rich labels array                │
│  • POST /api/aligner/labels/generate                            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  aligner.routes.js                                              │
│  • Validates { labels[], startingPosition, arabicFont }         │
│  • Calls AlignerLabelGenerator.generate()                       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  aligner-label-generator.js                                     │
│  • OL291 format: 3x4 grid, 12 labels per US Letter sheet        │
│  • Each label renders its own patient/doctor/logo               │
│  • Returns PDF buffer + stats (totalLabels, totalPages, next)   │
└─────────────────────────────────────────────────────────────────┘
```

## Key Files
| File | Purpose |
|------|---------|
| `public/js/pages/aligner/PatientSets.jsx` | Print/Queue buttons |
| `public/js/contexts/PrintQueueContext.jsx` | Global queue state |
| `public/js/components/react/PrintQueueIndicator.jsx` | Floating queue UI |
| `public/js/components/react/LabelPreviewModal.jsx` | Preview & generate |
| `routes/api/aligner.routes.js` | API endpoint |
| `services/pdf/aligner-label-generator.js` | PDF generation |

## API

**POST** `/api/aligner/labels/generate`

```javascript
// Request
{
    labels: [{ text, patientName, doctorName?, includeLogo? }, ...],
    startingPosition: 1,  // 1-12
    arabicFont: "cairo"   // optional
}

// Response
{
    success: true,
    pdf: "base64...",
    totalLabels: 6,
    totalPages: 1,
    nextPosition: 7
}
```
