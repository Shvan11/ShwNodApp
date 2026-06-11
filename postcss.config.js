/**
 * PostCSS config — automatic RTL CSS generation (postcss-rtlcss).
 *
 * Vite (root: public/) picks this up via postcss-load-config, which searches
 * upward from the Vite root to the workspace root. It runs as part of Vite's
 * default `postcss` CSS transformer — do NOT switch Vite to `css.transformer:
 * 'lightningcss'`, which would silently skip PostCSS entirely. (`build.cssMinify:
 * 'lightningcss'` is fine — minify-only, runs after this.)
 *
 * Mode.override is load-bearing: the default `combined` mode wraps the LTR
 * declarations in `[dir="ltr"]`, which a page that never sets a `dir` attribute
 * (login.html, the patient portal, the chair-display kiosk) would not match —
 * breaking their layout. Override mode leaves the LTR output byte-identical and
 * only APPENDS `[dir="rtl"]` overrides, so dir-less pages stay completely inert
 * until something sets `dir="rtl"` on an ancestor.
 *
 * Going-forward convention: new CSS prefers logical properties
 * (margin-inline-start etc. — direction-agnostic, the plugin leaves them alone);
 * `/*rtl:ignore*\/` is the escape hatch for deliberately-physical declarations.
 */
import postcssRTLCSS from 'postcss-rtlcss';
import { Mode } from 'postcss-rtlcss/options';

export default {
  plugins: [
    postcssRTLCSS({
      mode: Mode.override, // LTR output unchanged; [dir="rtl"] overrides appended
      ignorePrefixedRules: true, // leave hand-written [dir="rtl"] rules alone (rtl-support.css, toast.css)
      safeBothPrefix: false, // never emit [dir]-scoped rules — dir-less pages (login/portal/kiosk) stay inert
      processKeyFrames: false,
    }),
  ],
};
