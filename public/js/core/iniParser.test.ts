import { describe, expect, it } from 'vitest';
import { applyIniChanges, parseIniContent } from './iniParser';

const NOW = new Date('2026-10-03T10:00:00.000Z');

const FILE = [
  '; Written by hand during setup — do not lose this note',
  'Orphan=above any section',
  '',
  '[Paths]',
  '# where the patient folders live',
  'PatientsFolder = \\\\Clinic\\clinic1',
  'DolphinPath=C:\\Dolphin',
  'DolphinPath=C:\\Ignored-Duplicate',
  '',
  '[Applications]',
  'msaccess=C:\\Office\\MSACCESS.EXE',
  '',
].join('\r\n');

describe('parseIniContent', () => {
  it('reads sections and keys, first occurrence wins (like GetPrivateProfileString)', () => {
    expect(parseIniContent(FILE)).toEqual({
      Paths: { PatientsFolder: '\\\\Clinic\\clinic1', DolphinPath: 'C:\\Dolphin' },
      Applications: { msaccess: 'C:\\Office\\MSACCESS.EXE' },
    });
  });
});

describe('applyIniChanges — edit in place (FE-F1-6)', () => {
  it('replaces only the changed value and leaves every other byte alone', () => {
    const out = applyIniChanges(FILE, { Paths: { PatientsFolder: '\\\\NAS\\clinic1' } }, NOW);
    expect(out).toBe(FILE.replace('PatientsFolder = \\\\Clinic\\clinic1', 'PatientsFolder = \\\\NAS\\clinic1'));
  });

  it('keeps comments, keys above the first section, and the CRLF line ending', () => {
    const out = applyIniChanges(FILE, { Applications: { msaccess: 'D:\\MSACCESS.EXE' } }, NOW);
    expect(out).toContain('; Written by hand during setup — do not lose this note\r\n');
    expect(out).toContain('Orphan=above any section\r\n');
    expect(out).toContain('# where the patient folders live\r\n');
    expect(out).not.toMatch(/[^\r]\n/);
  });

  it('edits the FIRST occurrence of a duplicated key — the one Windows reads', () => {
    const out = applyIniChanges(FILE, { Paths: { DolphinPath: 'E:\\Dolphin' } }, NOW);
    expect(out).toContain('DolphinPath=E:\\Dolphin\r\nDolphinPath=C:\\Ignored-Duplicate');
    expect(parseIniContent(out).Paths.DolphinPath).toBe('E:\\Dolphin');
  });

  it('appends a missing key after its section’s last line, before the blank separator', () => {
    const out = applyIniChanges(FILE, { Paths: { UseRunAsDate: 'true' } }, NOW);
    expect(out).toContain('DolphinPath=C:\\Ignored-Duplicate\r\nUseRunAsDate=true\r\n\r\n[Applications]');
  });

  it('appends a missing section at the end of the file', () => {
    const out = applyIniChanges(FILE, { Extra: { A: '1' } }, NOW);
    expect(out.endsWith('msaccess=C:\\Office\\MSACCESS.EXE\r\n\r\n[Extra]\r\nA=1\r\n')).toBe(true);
  });

  it('writes a minimal file from empty content', () => {
    expect(applyIniChanges('', { Paths: { A: '1' } }, NOW)).toBe('[Paths]\nA=1\n');
  });

  it('stamps an existing "Last updated" comment and otherwise adds none', () => {
    const stamped = '# Last updated: 2020-01-01T00:00:00.000Z\n[Paths]\nA=1\n';
    expect(applyIniChanges(stamped, { Paths: { A: '2' } }, NOW)).toBe(
      '# Last updated: 2026-10-03T10:00:00.000Z\n[Paths]\nA=2\n'
    );
    expect(applyIniChanges('[Paths]\nA=1\n', { Paths: { A: '2' } }, NOW)).toBe('[Paths]\nA=2\n');
  });

  it('never lets a value inject a line', () => {
    const out = applyIniChanges('[Paths]\nA=1\n', { Paths: { A: 'x\r\n[Evil]\r\nB=2' } }, NOW);
    expect(parseIniContent(out)).toEqual({ Paths: { A: 'x [Evil] B=2' } });
  });

  it('is a no-op with no changes', () => {
    expect(applyIniChanges(FILE, {}, NOW)).toBe(FILE);
  });
});
