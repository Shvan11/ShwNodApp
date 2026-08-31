/**
 * PDF Arabic-font registry — the SSoT for which Arabic typefaces the server can
 * embed in a generated PDF, shared by the contract (`aligner.contract.ts`), the
 * picker UI (`LabelPreviewModal`), and the generators (`services/pdf/*`).
 *
 * NOT the same list as `public/js/core/font.ts#ARABIC_FONTS`, and deliberately so:
 * that registry picks a WEBFONT for the browser to paint the screen with, and its
 * families ship as unicode-range-scoped woff2. PDFKit embeds a font by reading a
 * TTF off disk at generation time, so a face can only appear here once its TTF is
 * bundled under `fonts/`. Adding one = drop the TTF in `fonts/`, add an entry
 * here, and point `ARABIC_PDF_FONT_FILES` (services/pdf/pdf-assets.ts) at it.
 *
 * Before this registry existed the label modal carried its own hardcoded
 * `[cairo, noto]` array, the contract repeated the same pair as a bare
 * `z.enum([...])`, and each generator hardcoded a single font path — four lists
 * that could drift independently.
 */

export const PDF_ARABIC_FONTS = [
  {
    id: 'cairo',
    label: 'Cairo',
    description: 'Modern, clean — matches the app UI',
  },
  {
    id: 'noto',
    label: 'Noto Sans Arabic',
    description: 'Standard, high coverage',
  },
] as const;

export type PdfArabicFont = (typeof PDF_ARABIC_FONTS)[number]['id'];

/** Ids only — for `z.enum()` in a contract. */
export const PDF_ARABIC_FONT_IDS = PDF_ARABIC_FONTS.map((f) => f.id) as unknown as readonly [
  PdfArabicFont,
  ...PdfArabicFont[],
];

/** The face used when a caller omits one (or asks for one with no bundled TTF). */
export const DEFAULT_PDF_ARABIC_FONT: PdfArabicFont = 'cairo';
