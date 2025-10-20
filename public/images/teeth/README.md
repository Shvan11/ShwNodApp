# Tooth Images for Dental Chart - Palmer Notation

Place your tooth images in this folder with the following names:

## Required Images (PNG format recommended):

### Incisors (4 types)
1. **upper-central.png** - Upper central incisors (UR1, UL1)
   - Largest front teeth
   - Broad, flat cutting surface
   - Single root

2. **lower-central.png** - Lower central incisors (LR1, LL1)
   - Smallest teeth in mouth
   - Narrow, chisel-shaped
   - Single root

3. **upper-lateral.png** - Upper lateral incisors (UR2, UL2)
   - Next to central incisors
   - Smaller than centrals
   - Single root

4. **lower-lateral.png** - Lower lateral incisors (LR2, LL2)
   - Similar to lower centrals but slightly larger
   - Single root

### Canines (1 type)
5. **canine.png** - All canines (UR3, UL3, LR3, LL3)
   - Pointed, sharp cusps
   - Longest root in mouth
   - Used for tearing food

### Premolars (1 type)
6. **premolar.png** - All premolars (UR4-5, UL4-5, LR4-5, LL4-5)
   - Two-cusped teeth (bicuspids)
   - Between canines and molars
   - Used for crushing food

### Molars (2 types)
7. **upper-molar.png** - Upper molars (UR6-8, UL6-8)
   - Large, multi-cusped back teeth
   - Three roots
   - Used for grinding food

8. **lower-molar.png** - Lower molars (LR6-8, LL6-8)
   - Large, multi-cusped back teeth
   - Two roots
   - Used for grinding food

## Image Requirements:

- **Format**: PNG with transparent background (recommended)
- **Size**: 150x180 pixels or similar aspect ratio
- **Orientation**: Crown at top, roots at bottom
- **View**: Front/facial view of the tooth
- **Background**: Transparent or white

## Fallback:

If images are not found, the system will display a tooth emoji (🦷) as fallback.

## File Structure:

```
/public/images/teeth/
  ├── README.md (this file)
  ├── upper-central.png    (UR1, UL1)
  ├── lower-central.png    (LR1, LL1)
  ├── upper-lateral.png    (UR2, UL2)
  ├── lower-lateral.png    (LR2, LL2)
  ├── canine.png          (UR3, UL3, LR3, LL3)
  ├── premolar.png        (UR4-5, UL4-5, LR4-5, LL4-5)
  ├── upper-molar.png     (UR6-8, UL6-8)
  └── lower-molar.png     (LR6-8, LL6-8)
```

## Visual Effects:

- **Normal state**: Full color tooth image
- **Selected state**: Image turns white (inverted) with purple gradient background
- **Hover**: Slight elevation and shadow effect
- **Interactive**: Click to append tooth notation to the "Other Notes" field

## Palmer Notation Reference:

- **UR** = Upper Right (teeth 1-8)
- **UL** = Upper Left (teeth 1-8)
- **LR** = Lower Right (teeth 1-8)
- **LL** = Lower Left (teeth 1-8)

Example: Clicking upper right first molar appends "UR6" to your notes.
