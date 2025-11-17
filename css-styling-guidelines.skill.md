# CSS Styling Guidelines Skill

**Project:** Shwan Orthodontics Application
**Purpose:** Enforce CSS best practices and maintain consistent styling architecture

## CRITICAL RULES - NEVER VIOLATE THESE

### ❌ PROHIBITED: Inline Styles

**NEVER use inline styles in JSX/HTML** except for the following rare exceptions:

**Allowed Exceptions (use sparingly):**
1. **Dynamic values from props/state** - Only when the value cannot be predetermined
   ```javascript
   // ✅ ALLOWED: Dynamic calculation based on runtime data
   style={{ height: `${calculatedHeight}px`, top: `${position.y}px` }}
   ```

2. **One-time positioning** - For dynamically positioned elements (tooltips, popovers, drag-drop)
   ```javascript
   // ✅ ALLOWED: Dynamic positioning
   style={{ position: 'absolute', left: mouseX, top: mouseY }}
   ```

**❌ FORBIDDEN: Static styles that should be CSS classes**
```javascript
// ❌ WRONG: Static styles
style={{ padding: '20px', background: '#f8f9fa', borderRadius: '8px' }}

// ✅ CORRECT: Use CSS class
className="card-container"
```

```css
/* In appropriate CSS file */
.card-container {
  padding: var(--spacing-lg);
  background: var(--background-secondary);
  border-radius: var(--radius-lg);
}
```

### ❌ PROHIBITED: !important Declarations

**NEVER use `!important` in CSS** except for these specific cases:

**Allowed Exceptions:**
1. **Print styles** - Forcing specific layouts for printing
   ```css
   @media print {
     .no-print { display: none !important; }
   }
   ```

2. **Accessibility overrides** - Respecting user preferences
   ```css
   @media (prefers-reduced-motion: reduce) {
     * { animation: none !important; }
   }
   ```

3. **Third-party library overrides** - Only when no other option exists
   ```css
   /* Document why !important is needed */
   .photoswipe-override {
     z-index: var(--z-index-modal) !important; /* Override PhotoSwipe default */
   }
   ```

**❌ FORBIDDEN: Using !important for convenience**
```css
/* ❌ WRONG: Lazy override */
.text-red { color: red !important; }

/* ✅ CORRECT: Increase specificity properly */
.error-message .text-red { color: var(--error-color); }
```

---

## CSS Architecture

### File Structure

```
/public/css/
├── main.css                    # Entry point - imports all modules
├── base/
│   ├── variables.css           # Design tokens (colors, spacing, typography)
│   ├── reset.css               # CSS reset/normalize
│   ├── typography.css          # Font styles and text utilities
│   └── rtl-support.css         # RTL language support (Kurdish/Arabic)
├── components/                 # Reusable component styles (18 files)
│   ├── buttons.css
│   ├── universal-header.css
│   ├── sidebar-navigation.css
│   ├── appointment-calendar.css
│   ├── dental-chart.css
│   └── [13 more files...]
└── pages/                      # Page-specific styles (22 files)
    ├── dashboard.css
    ├── patient-shell.css
    ├── appointments.css
    └── [19 more files...]
```

### Where to Add New Styles

**Decision Tree:**

1. **Is it a reusable component?** → `/css/components/{component-name}.css`
2. **Is it page-specific?** → `/css/pages/{page-name}.css`
3. **Is it a base style (typography, button variant)?** → `/css/base/{category}.css`
4. **Is it a utility class?** → `/css/main.css` (utilities section)

**Examples:**

- New button variant → `/css/components/buttons.css`
- Dashboard card styling → `/css/pages/dashboard.css`
- Reusable modal styles → `/css/components/modal.css` (create if needed)
- Text color utility → `/css/main.css` or `/css/base/typography.css`

---

## Design System - Use These Variables

### Colors (from `/css/base/variables.css`)

```css
/* Primary Palette */
--primary-color: #007bff
--secondary-color: #4CAF50
--accent-color: #55608f

/* Semantic Colors */
--success-color: #28a745
--error-color: #dc3545
--warning-color: #ffc107
--info-color: #17a2b8

/* Neutrals */
--background-primary: #ffffff
--background-secondary: #f8f9fa
--text-primary: #212529
--text-secondary: #6c757d
--border-color: #dee2e6
```

**✅ ALWAYS use CSS variables instead of hardcoded colors:**

```css
/* ❌ WRONG */
.card { background: #f8f9fa; color: #212529; }

/* ✅ CORRECT */
.card {
  background: var(--background-secondary);
  color: var(--text-primary);
}
```

### Spacing System

```css
--spacing-xs: 0.25rem   /* 4px */
--spacing-sm: 0.5rem    /* 8px */
--spacing-md: 1rem      /* 16px */
--spacing-lg: 1.5rem    /* 24px */
--spacing-xl: 2rem      /* 32px */
--spacing-xxl: 3rem     /* 48px */
```

**✅ Use spacing variables for consistency:**

```css
/* ❌ WRONG */
.card { padding: 20px; margin-bottom: 16px; }

/* ✅ CORRECT */
.card {
  padding: var(--spacing-lg);
  margin-bottom: var(--spacing-md);
}
```

### Border Radius

```css
--radius-sm: 0.125rem   /* 2px */
--radius-md: 0.25rem    /* 4px */
--radius-lg: 0.5rem     /* 8px */
--radius-xl: 1rem       /* 16px */
--radius-full: 9999px   /* Fully rounded */
```

### Shadows

```css
--shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05)
--shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1)
--shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1)
--shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1)
```

### Typography

```css
--font-primary: system-ui, -apple-system, BlinkMacSystemFont...
--font-size-xs: 0.75rem    /* 12px */
--font-size-sm: 0.875rem   /* 14px */
--font-size-base: 1rem     /* 16px */
--font-size-lg: 1.125rem   /* 18px */
--font-size-xl: 1.25rem    /* 20px */
--font-size-2xl: 1.5rem    /* 24px */
--font-size-3xl: 1.875rem  /* 30px */
```

### Z-Index Layers

```css
--z-index-dropdown: 1000
--z-index-sticky: 1020
--z-index-fixed: 1030
--z-index-modal: 1040
--z-index-popover: 1050
--z-index-tooltip: 1060
```

**✅ Use z-index variables to prevent conflicts:**

```css
/* ❌ WRONG */
.modal { z-index: 9999; }

/* ✅ CORRECT */
.modal { z-index: var(--z-index-modal); }
```

---

## Naming Conventions

### BEM-like Methodology

**Pattern:** `.block-name__element--modifier`

**Examples:**
```css
/* Component block */
.patient-card { }

/* Element within block */
.patient-card__header { }
.patient-card__body { }
.patient-card__footer { }

/* Modifier for state/variant */
.patient-card--highlighted { }
.patient-card--disabled { }
```

### State Classes

Use consistent state class names:
- `.active` - Currently active item
- `.disabled` - Disabled state
- `.loading` - Loading state
- `.error` - Error state
- `.success` - Success state
- `.hidden` - Hidden state

---

## Responsive Design

### Mobile-First Approach

Write base styles for mobile, then progressively enhance:

```css
/* ✅ CORRECT: Mobile-first */
.container {
  padding: var(--spacing-sm);  /* Mobile: small padding */
}

@media (min-width: 768px) {
  .container {
    padding: var(--spacing-lg);  /* Tablet+: larger padding */
  }
}

@media (min-width: 1024px) {
  .container {
    padding: var(--spacing-xl);  /* Desktop: extra padding */
  }
}
```

### Breakpoints (from variables.css)

```css
--breakpoint-xs: 375px   /* Small phones */
--breakpoint-sm: 480px   /* Phones */
--breakpoint-md: 768px   /* Tablets */
--breakpoint-lg: 1024px  /* Desktops */
--breakpoint-xl: 1400px  /* Large screens */
```

**Common media queries:**
```css
@media (max-width: 1024px) { /* Tablet and below */ }
@media (max-width: 768px) { /* Phone and below */ }
@media (max-width: 480px) { /* Small phones */ }
@media (orientation: landscape) { /* Landscape mode */ }
@media (hover: none) and (pointer: coarse) { /* Touch devices */ }
```

---

## RTL (Right-to-Left) Support

**The project has full RTL support** for Kurdish/Arabic languages.

### RTL-Aware Properties

**Use logical properties instead of directional:**

```css
/* ❌ AVOID: Directional properties */
.card {
  margin-left: var(--spacing-md);
  text-align: left;
}

/* ✅ PREFER: Logical properties */
.card {
  margin-inline-start: var(--spacing-md);
  text-align: start;
}
```

**Or use RTL selector:**
```css
.card {
  margin-left: var(--spacing-md);
}

[dir="rtl"] .card {
  margin-left: 0;
  margin-right: var(--spacing-md);
}
```

---

## Best Practices Checklist

### When Adding New Styles

- [ ] **Check if a class already exists** (search existing CSS files)
- [ ] **Use CSS variables** for colors, spacing, typography
- [ ] **Add styles to the appropriate file** (component vs page vs base)
- [ ] **Follow BEM-like naming** for consistency
- [ ] **NO inline styles** (except dynamic values)
- [ ] **NO !important** (except print/accessibility)
- [ ] **Mobile-first responsive design**
- [ ] **Consider RTL support** for text-heavy components
- [ ] **Test on multiple screen sizes** (375px, 768px, 1024px+)

### When Refactoring Styles

- [ ] **Extract inline styles to CSS classes**
- [ ] **Replace hardcoded values with CSS variables**
- [ ] **Remove duplicate class definitions**
- [ ] **Consolidate similar styles into shared classes**
- [ ] **Increase specificity instead of using !important**

---

## Examples: Common Styling Patterns

### Button Variants

```css
/* Base button (in /css/components/buttons.css) */
.btn {
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-md);
  font-size: var(--font-size-base);
  transition: all 0.2s ease;
}

.btn-primary {
  background: var(--primary-color);
  color: white;
}

.btn-sm {
  padding: var(--spacing-xs) var(--spacing-sm);
  font-size: var(--font-size-sm);
}
```

### Card Component

```css
/* In /css/components/card.css or page-specific file */
.card {
  background: var(--background-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: var(--spacing-lg);
  box-shadow: var(--shadow-sm);
}

.card__header {
  margin-bottom: var(--spacing-md);
  border-bottom: 1px solid var(--border-color);
  padding-bottom: var(--spacing-md);
}

.card__title {
  font-size: var(--font-size-xl);
  color: var(--text-primary);
  font-weight: 600;
}
```

### Modal/Dialog

```css
/* In /css/components/modal.css */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: var(--z-index-modal);
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-content {
  background: var(--background-primary);
  border-radius: var(--radius-lg);
  padding: var(--spacing-xl);
  max-width: 600px;
  width: 90%;
  box-shadow: var(--shadow-xl);
}
```

---

## Common Anti-Patterns to Avoid

### ❌ Anti-Pattern 1: Inline Styles for Static Values

```javascript
// ❌ WRONG
<div style={{
  padding: '20px',
  background: '#f8f9fa',
  borderRadius: '8px'
}}>
```

```javascript
// ✅ CORRECT
<div className="card-container">
```

### ❌ Anti-Pattern 2: !important for Overrides

```css
/* ❌ WRONG */
.text-red { color: red !important; }
.hidden { display: none !important; }
```

```css
/* ✅ CORRECT: Use specificity */
.form-field .text-red { color: var(--error-color); }
.nav-menu .hidden { display: none; }
```

### ❌ Anti-Pattern 3: Hardcoded Colors/Values

```css
/* ❌ WRONG */
.alert {
  background: #dc3545;
  padding: 16px;
  border-radius: 8px;
}
```

```css
/* ✅ CORRECT */
.alert {
  background: var(--error-color);
  padding: var(--spacing-md);
  border-radius: var(--radius-lg);
}
```

### ❌ Anti-Pattern 4: Desktop-First Responsive

```css
/* ❌ WRONG: Desktop-first */
.container { padding: 32px; }

@media (max-width: 768px) {
  .container { padding: 8px; }
}
```

```css
/* ✅ CORRECT: Mobile-first */
.container { padding: var(--spacing-sm); }

@media (min-width: 768px) {
  .container { padding: var(--spacing-xl); }
}
```

---

## Quick Reference: When to Create New Files

**Create new component CSS file when:**
- Building a new reusable component (modal, dropdown, card variant)
- Component has 20+ lines of CSS
- Component will be used in multiple pages

**Add to existing page CSS when:**
- Styling specific to one page only
- Quick one-off adjustments
- Page-specific layout/structure

**Add to base CSS when:**
- New design tokens (colors, spacing values)
- Typography variants
- Global utility classes

**Never create CSS file when:**
- Component has fewer than 10 lines of CSS (add to relevant file)
- Temporary/experimental styling (still use CSS, not inline)

---

## Summary

**Golden Rules:**
1. ✅ **CSS classes only** - No inline styles except dynamic values
2. ✅ **No !important** - Except print/accessibility
3. ✅ **CSS variables always** - Colors, spacing, typography from variables.css
4. ✅ **Mobile-first responsive** - Start small, scale up
5. ✅ **BEM-like naming** - Consistent, semantic class names
6. ✅ **Appropriate file location** - Components, pages, or base
7. ✅ **RTL support** - Use logical properties or RTL selectors

**Before you write any styling code:**
- [ ] Can I use an existing class?
- [ ] Am I using CSS variables?
- [ ] Is this in the right file?
- [ ] Am I avoiding inline styles and !important?
- [ ] Is this mobile-first responsive?

---

## Additional Resources

**Key Files to Reference:**
- `/public/css/base/variables.css` - All design tokens
- `/public/css/main.css` - Utility classes and imports
- `/public/css/components/buttons.css` - Button styling examples
- `/public/css/components/universal-header.css` - Complex component example

**Documentation:**
- Project CSS architecture: 45 files, ~25,576 lines
- No CSS frameworks used (custom CSS only)
- Font Awesome 6.4.0 for icons
- Full RTL support for Kurdish/Arabic
