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
import { promises as fs } from 'fs';

/**
 * The receipt's document type. `generateReceiptHTML` prints the default template of
 * this type, the seed migration `1789460500000` creates it, and Settings → Lookups
 * refuses to delete it (audit FE-F21-12).
 */
export const RECEIPT_DOCUMENT_TYPE_ID = 1;

/**
 * The two receipt layouts `receipt-service` finds BY NAME: the discount variant and the
 * no-work receipt. A row with one of these names is one the product prints from, so it
 * is a system template (migration `1791316000000` marks it; `templateDeleteBlock` holds
 * the line even where the flag is not set).
 */
export const DISCOUNT_RECEIPT_TEMPLATE_NAME = 'Shwan Orthodontics Default Receipt (With Discount)';
export const NO_WORK_RECEIPT_TEMPLATE_NAME = 'No-Work Appointment Receipt';
export const CODE_NAMED_TEMPLATE_NAMES: readonly string[] = [
  DISCOUNT_RECEIPT_TEMPLATE_NAME,
  NO_WORK_RECEIPT_TEMPLATE_NAME,
];

/**
 * Why this template may not be deleted, or `null` when it may.
 *
 * `is_system` alone was the rule, and it is only a flag on the row: the original
 * clinic's discount receipt was loaded without it, so it carried a Delete button and
 * deleting it sent discounted receipts back to the shipped layout. Worse, *Set Default*
 * can make any template the default receipt, and that row is the one receipt-service
 * has no fallback for: deleting it failed every "print receipt". So the templates the
 * code resolves are refused by what they ARE, whatever the flag says.
 */
export function templateDeleteBlock(template: {
  template_name: string;
  document_type_id: number | null;
  is_default: boolean | null;
  is_system: boolean | null;
}): string | null {
  if (template.is_system) return 'Cannot delete system templates';
  // `template_name` is citext: the lookup that finds it ignores case, so this does too.
  const name = template.template_name.trim().toLowerCase();
  if (CODE_NAMED_TEMPLATE_NAMES.some((n) => n.toLowerCase() === name)) {
    return 'Cannot delete this template: receipts are printed from it';
  }
  if (template.document_type_id === RECEIPT_DOCUMENT_TYPE_ID && template.is_default) {
    return 'Cannot delete the default receipt template. Set another template as the default first';
  }
  return null;
}

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

/**
 * The file to remove with template `templateId`, or `null` when it must stay.
 *
 * Deleting a template removed its row and left its design on disk for good. Only the
 * file the server itself assigned to THIS template is removed (`…-<id>.html`, see
 * `templateFilePathFor`): the files the product ships and falls back to
 * (`receipt-service#FALLBACK_TEMPLATE_PATHS`) and designs saved under the older
 * name-only scheme carry no id, and a wrong guess there deletes a receipt layout.
 */
export function ownedTemplateFile(templateId: number, storedPath: string | null | undefined): string | null {
  if (!storedPath) return null;
  let full: string;
  try {
    full = resolveTemplateFile(storedPath);
  } catch {
    return null; // outside the templates directory: never touched
  }
  return path.basename(full).endsWith(`-${templateId}.html`) ? full : null;
}

/** Remove a deleted template's own file (see `ownedTemplateFile`). Returns whether one was removed. */
export async function removeTemplateFile(templateId: number, storedPath: string | null | undefined): Promise<boolean> {
  const file = ownedTemplateFile(templateId, storedPath);
  if (!file) return false;
  await fs.rm(file, { force: true });
  return true;
}
