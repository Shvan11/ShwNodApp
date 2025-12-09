# CSS Styling Guidelines

## Core Rules

1. **Use CSS variables** - Never hardcode colors, spacing, or sizing
2. **No inline styles** - Exception: dynamic values calculated in JS
3. **No `!important`** - Exception: print styles, accessibility overrides
4. **No `console.log` equivalent** - Don't leave debug styles (red borders, etc.)

---

## Variable Reference

### Spacing
```css
--spacing-xs: 0.25rem   /* 4px */
--spacing-sm: 0.5rem    /* 8px */
--spacing-md: 1rem      /* 16px */
--spacing-lg: 1.5rem    /* 24px */
--spacing-xl: 2rem      /* 32px */
--spacing-xxl: 3rem     /* 48px */
```

### Colors
```css
/* Primary */
--primary-color: #007bff
--primary-hover: #0056b3

/* Status */
--success-color: #28a745
--error-color: #dc3545
--warning-color: #ffc107
--info-color: #17a2b8

/* Surfaces */
--surface: #ffffff
--surface-elevated: #f8f9fa
--surface-hover: #f5f5f5
--background-color: #f4f4f9

/* Text */
--text-color: #333333
--text-light: #666666
--text-secondary: #6c757d

/* Borders */
--border-color: #cccccc
--border: #dee2e6
```

### Border Radius
```css
--radius-sm: 0.125rem   /* 2px */
--radius-md: 0.25rem    /* 4px */
--radius-lg: 0.5rem     /* 8px */
--radius-xl: 1rem       /* 16px */
--radius-full: 9999px
```

### Shadows
```css
--shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05)
--shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)
--shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)
```

### Transitions
```css
--transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1)
--transition-base: 250ms cubic-bezier(0.4, 0, 0.2, 1)
--transition-slow: 350ms cubic-bezier(0.4, 0, 0.2, 1)
```

### Z-Index
```css
--z-index-dropdown: 1000
--z-index-sticky: 1020
--z-index-fixed: 1030
--z-index-modal: 1040
--z-index-popover: 1050
--z-index-tooltip: 1060
```

---

## Examples

### Wrong
```css
.card {
  padding: 16px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}
```

### Correct
```css
.card {
  padding: var(--spacing-md);
  background-color: var(--surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
}
```

### Wrong (inline styles in JSX)
```jsx
<div style={{ padding: '16px', color: 'red' }}>
```

### Correct
```jsx
<div className="error-message">
```

---

## File Organization

```
/public/css/
  /base/        # variables.css, reset.css, typography.css
  /components/  # Reusable: buttons.css, modal.css, cards.css
  /pages/       # Page-specific: dashboard.css, patient.css
  /layout/      # universal-header.css, sidebar-navigation.css
```

**Rules:**
- One CSS file per component/page
- Component styles in `/components/`, page-specific in `/pages/`
- Use existing button classes from `buttons.css` - don't redefine

---

## Quick Checklist

Before committing CSS changes:

- [ ] All colors use variables
- [ ] All spacing uses `--spacing-*` variables
- [ ] All border-radius uses `--radius-*` variables
- [ ] No inline styles (except dynamic JS values)
- [ ] No `!important`
- [ ] Using existing component classes where available
