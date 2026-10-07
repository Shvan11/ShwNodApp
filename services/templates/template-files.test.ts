/**
 * @vitest-environment node
 */
import { mkdtempSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DISCOUNT_RECEIPT_TEMPLATE_NAME,
  NO_WORK_RECEIPT_TEMPLATE_NAME,
  RECEIPT_DOCUMENT_TYPE_ID,
  ownedTemplateFile,
  removeTemplateFile,
  templateDeleteBlock,
  templateFilePathFor,
} from './template-files.js';

describe('a deleted template\'s file', () => {
  let cwd: string;
  let dir: string;

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), 'tpl-files-'));
    dir = path.join(cwd, 'data', 'templates');
    mkdirSync(dir, { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(cwd, { recursive: true, force: true });
  });

  it('is the one the server assigned to that template', () => {
    expect(ownedTemplateFile(42, templateFilePathFor(42, 'Lab Slip'))).toBe(path.join(dir, 'lab-slip-42.html'));
    // An Arabic name has no Latin slug.
    expect(ownedTemplateFile(42, templateFilePathFor(42, 'وصل'))).toBe(path.join(dir, 'template-42.html'));
  });

  it('is never a shipped fallback, an older name-only file, or another template\'s', () => {
    expect(ownedTemplateFile(42, 'data/templates/shwan-orthodontics-default-receipt-discount.html')).toBeNull();
    expect(ownedTemplateFile(42, 'data/templates/lab-slip.html')).toBeNull();
    expect(ownedTemplateFile(4, 'data/templates/lab-slip-42.html')).toBeNull();
    expect(ownedTemplateFile(42, 'data/templates/lab-slip-142.html.bak')).toBeNull();
    expect(ownedTemplateFile(42, null)).toBeNull();
  });

  it('is never outside the templates directory', () => {
    expect(ownedTemplateFile(42, '../../.env-42.html')).toBeNull();
    expect(ownedTemplateFile(42, '/etc/passwd-42.html')).not.toBe('/etc/passwd-42.html');
  });

  it('is removed, and only it', async () => {
    const own = path.join(dir, 'lab-slip-42.html');
    const shipped = path.join(dir, 'shwan-orthodontics-default-receipt.html');
    writeFileSync(own, '<p>design</p>');
    writeFileSync(shipped, '<p>receipt</p>');

    expect(await removeTemplateFile(42, 'data/templates/shwan-orthodontics-default-receipt.html')).toBe(false);
    expect(existsSync(shipped)).toBe(true);

    expect(await removeTemplateFile(42, 'data/templates/lab-slip-42.html')).toBe(true);
    expect(existsSync(own)).toBe(false);
    expect(existsSync(shipped)).toBe(true);

    // Already gone: not an error.
    expect(await removeTemplateFile(42, 'data/templates/lab-slip-42.html')).toBe(true);
  });
});

describe('templateDeleteBlock — which templates may never be deleted', () => {
  const row = (o: Partial<Parameters<typeof templateDeleteBlock>[0]> = {}) => ({
    template_name: 'Lab Slip',
    document_type_id: 3,
    is_default: false,
    is_system: false,
    ...o,
  });

  it('lets an ordinary template go', () => {
    expect(templateDeleteBlock(row())).toBeNull();
    // The default of a type the code does not print from is ordinary too.
    expect(templateDeleteBlock(row({ is_default: true }))).toBeNull();
    expect(templateDeleteBlock(row({ document_type_id: RECEIPT_DOCUMENT_TYPE_ID }))).toBeNull();
  });

  it('refuses a system template', () => {
    expect(templateDeleteBlock(row({ is_system: true }))).toMatch(/system/);
  });

  it('refuses the layouts receipts are looked up by name, with or without the flag', () => {
    // The original clinic's discount receipt: loaded with is_system = false.
    expect(templateDeleteBlock(row({ template_name: DISCOUNT_RECEIPT_TEMPLATE_NAME, document_type_id: 1 }))).toMatch(/receipts/);
    expect(templateDeleteBlock(row({ template_name: NO_WORK_RECEIPT_TEMPLATE_NAME, document_type_id: 1 }))).toMatch(/receipts/);
    // citext: the lookup that finds the row ignores case, so the guard does.
    expect(templateDeleteBlock(row({ template_name: ` ${NO_WORK_RECEIPT_TEMPLATE_NAME.toUpperCase()} ` }))).toMatch(/receipts/);
  });

  it('refuses the current default receipt, which has no fallback', () => {
    const custom = row({ template_name: 'Our Receipt', document_type_id: RECEIPT_DOCUMENT_TYPE_ID, is_default: true });
    expect(templateDeleteBlock(custom)).toMatch(/default receipt/);
    // Once another template is the default, it is an ordinary template again.
    expect(templateDeleteBlock({ ...custom, is_default: false })).toBeNull();
  });
});
