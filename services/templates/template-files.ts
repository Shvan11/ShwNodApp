/**
 * Where document-template HTML lives on disk, and the ONE containment rule for it.
 *
 * Every template file sits in `<app>/data/templates/`. The DB row stores a path
 * (`document_templates.template_file_path`, e.g. `data/templates/foo.html`); this
 * module turns it into an absolute file and refuses anything that resolves outside
 * that directory.
 *
 * The designer's raw-HTML read and its save used `path.join(process.cwd(), stored)`
 * with no check, and `PUT /api/templates/:id` accepted `template_file_path` from any
 * staff role: a clinical user could point a template at `.env` and read it, or at a
 * file under `dist-server/` and overwrite it — on a service that runs as
 * Administrator (audit FE-F20-1). The path is now server-assigned only, and every
 * read and write goes through `resolveTemplateFile`.
 */
import path from 'path';

/**
 * The receipt's document type. `generateReceiptHTML` prints the default template of
 * this type, the seed migration `1789460500000` creates it, and Settings → Lookups
 * refuses to delete it (audit FE-F21-12).
 */
export const RECEIPT_DOCUMENT_TYPE_ID = 1;

/** Absolute path of the templates directory. */
export function templatesDir(): string {
  return path.resolve(process.cwd(), 'data', 'templates');
}

/**
 * Resolve a DB-stored template path to an absolute file inside the templates
 * directory. Accepts the stored `data/templates/x.html` form or a bare `x.html`.
 * Throws `TemplatePathError` for anything that escapes the directory (`..`
 * segments, absolute paths) — containment is checked AFTER resolution.
 */
export function resolveTemplateFile(storedPath: string): string {
  const root = templatesDir();
  const full = path.resolve(root, storedPath.replace(/^[/\\]+/, '').replace(/^data[/\\]+templates[/\\]+/, ''));
  const rel = path.relative(root, full);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new TemplatePathError(storedPath);
  }
  return full;
}

export class TemplatePathError extends Error {
  constructor(storedPath: string) {
    super(`Template path escapes the templates directory: ${storedPath}`);
    this.name = 'TemplatePathError';
  }
}

/**
 * The file a template's design is saved to: its name's Latin slug plus its id, so
 * two templates never share a file. It was the slug alone: "Receipt A" and
 * "receipt a" wrote the same file, and every Arabic-named template slugged to ''
 * and shared `data/templates/.html`, so saving one overwrote the other's design
 * (audit FE-F20-2).
 */
export function templateFilePathFor(templateId: number, templateName: string): string {
  const slug = templateName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `data/templates/${slug ? `${slug}-` : 'template-'}${templateId}.html`;
}
