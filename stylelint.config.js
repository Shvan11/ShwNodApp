/**
 * Stylelint — keeps staff-app CSS Modules theme-aware.
 *
 * The design-token cascade (public/css/base/tokens-primitive.css →
 * tokens-semantic.css → theme-dark.css) is the SSoT for color. This guard
 * targets the one literal that reliably breaks dark mode: an opaque (or
 * near-opaque) WHITE BACKGROUND. It stays white when the theme flips, so themed
 * text rendered over it goes white-on-white — exactly the StatisticsComponent
 * `.highlight` (`rgba(255,255,255,0.8)`) bug. Catching it here turns a
 * dark-mode regression into a CI failure.
 *
 * Deliberately NOT flagged (theme-agnostic by design, would be false positives):
 *   • `var(--token)` — incl. `var(--color-white)`, the correct way to put white
 *     text/icons on a saturated colored button or chip.
 *   • Translucent white glints (alpha < 0.6) on fixed brand gradients, and
 *     `rgba(0,0,0,…)` shadows/scrims — these layer over a fixed/themed surface.
 *   • Fixed colored backgrounds and self-consistent status-badge color pairs
 *     (hardcoded light bg + hardcoded dark text stay readable in both themes).
 *   • `background: black` for media surfaces (video/slideshow).
 *
 * For an intentional opaque-white background on a themed screen (print blocks,
 * prefers-contrast overrides, fixed-gradient form cards), add a scoped
 * `/* stylelint-disable-next-line <rule> -- reason *\/` at that line.
 */
export default {
  rules: {},
  overrides: [
    {
      files: ['public/js/**/*.module.css'],
      rules: {
        'declaration-property-value-disallowed-list': {
          '/^(background|background-color)$/': [
            // named white
            '/(?<![-\\w])white(?![-\\w])/',
            // hex white (#fff / #ffffff)
            '/#fff(?:fff)?\\b/i',
            // opaque or >=0.6-alpha white — light enough to read white-on-white in dark mode
            '/rgba?\\(\\s*255\\s*,\\s*255\\s*,\\s*255\\s*(?:,\\s*(?:0?\\.[6-9]\\d*|1(?:\\.0+)?))?\\s*\\)/',
          ],
        },
      },
    },
    {
      // Separate / pinned bundles — intentionally not theme-aware:
      //  • Patient Portal — its own raw-Zod bundle, untouched by the staff theme.
      //  • ChairDisplay kiosk — pinned light by design.
      files: ['public/js/portal/**/*.css', 'public/js/routes/ChairDisplay.module.css'],
      rules: {
        'declaration-property-value-disallowed-list': null,
      },
    },
  ],
};
