/**
 * INI File Parser Utility
 * Client-side reading and IN-PLACE editing of INI configuration files
 * (Settings → Protocol Handlers → C:\ShwanOrtho\ProtocolHandlers.ini).
 *
 * Saving EDITS the file rather than regenerating it (audit FE-F1-6, owner's
 * call 2026-10-03). The old save parsed the file into `{section: {key: value}}`
 * and wrote that object back out, which deleted every comment, every key above
 * the first section, every line the parser didn't understand and any edit made
 * on disk since the page loaded — on a file staff edit by hand during setup.
 * `applyIniChanges` touches only the lines of the keys that changed.
 *
 * Semantics follow the Windows profile API (GetPrivateProfileString), which is
 * what the protocol handlers read the file with: the FIRST occurrence of a key
 * in a section wins, `;` starts a comment line, and everything after `=` is the
 * value (there are no inline comments). `#` lines are treated as comments too —
 * the old formatter wrote its header with them.
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/** INI section with key-value pairs */
export interface IniSection {
  [key: string]: string;
}

/** Complete INI configuration */
export interface IniConfig {
  [section: string]: IniSection;
}

// ============================================================================
// LINE GRAMMAR
// ============================================================================

const SECTION_RE = /^\s*\[([^\]]+)\]\s*(?:[;#].*)?$/;
const COMMENT_RE = /^\s*[;#]/;
// indent · key · `=` with its surrounding spaces · value (rest of the line)
const KEY_RE = /^(\s*)([^=\s[][^=]*?)(\s*=\s*)(.*)$/;
const LAST_UPDATED_RE = /^(\s*[#;]\s*Last updated:\s*).*$/i;

function splitLines(content: string): { lines: string[]; eol: string } {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  return { lines: content.split(/\r?\n/), eol };
}

// ============================================================================
// PARSING
// ============================================================================

/**
 * Parse INI content into `{ section: { key: value } }` for display. Keys above
 * the first section, comments and unparseable lines are not part of the result
 * (they are still preserved on save — see `applyIniChanges`). First occurrence
 * of a key wins, as it does for the Windows reader.
 */
export function parseIniContent(content: string): IniConfig {
  const config: IniConfig = {};
  let currentSection = '';

  for (const line of splitLines(content).lines) {
    if (!line.trim() || COMMENT_RE.test(line)) continue;

    const section = SECTION_RE.exec(line);
    if (section) {
      currentSection = section[1].trim();
      config[currentSection] ??= {};
      continue;
    }

    const kv = KEY_RE.exec(line);
    if (kv && currentSection) {
      const key = kv[2].trim();
      if (!(key in config[currentSection])) {
        config[currentSection][key] = kv[4].trim();
      }
    }
  }

  return config;
}

// ============================================================================
// EDITING
// ============================================================================

/**
 * Apply `changes` to the INI text and return the new text, editing in place:
 * - a changed key's line keeps its indent, key spelling and `=` spacing — only
 *   the value is replaced (first occurrence in its section, the one Windows reads);
 * - a key missing from its section is appended after that section's last
 *   non-blank line; a missing section is appended at the end of the file;
 * - every other line — comments, keys above the first section, blank lines,
 *   unknown lines, other sections — is left byte-for-byte alone, and the file's
 *   own line ending (CRLF or LF) is kept;
 * - an existing `# Last updated:` comment gets the save time.
 *
 * Values are single-line by construction: CR/LF inside a value is replaced by a
 * space, so an edit can never inject a line.
 */
export function applyIniChanges(
  content: string,
  changes: Partial<IniConfig>,
  now: Date = new Date()
): string {
  const { lines, eol } = splitLines(content);
  const clean = (value: string) => value.replace(/[\r\n]+/g, ' ');

  // What is still to be written, per section — entries are deleted as applied.
  const pending = new Map<string, Map<string, string>>();
  for (const [section, values] of Object.entries(changes)) {
    if (values && Object.keys(values).length > 0) {
      pending.set(section, new Map(Object.entries(values)));
    }
  }

  const out: string[] = [];
  let currentSection: string | null = null;
  // Index in `out` just past the current section's last non-blank line, where
  // its missing keys are appended when the section closes.
  let insertAt = 0;

  const closeSection = () => {
    if (currentSection === null) return;
    const remaining = pending.get(currentSection);
    if (remaining && remaining.size > 0) {
      const added = [...remaining].map(([key, value]) => `${key}=${clean(value)}`);
      out.splice(insertAt, 0, ...added);
      remaining.clear();
    }
  };

  for (const line of lines) {
    const section = SECTION_RE.exec(line);
    if (section) {
      closeSection();
      currentSection = section[1].trim();
      out.push(line);
      insertAt = out.length;
      continue;
    }

    const stamp = LAST_UPDATED_RE.exec(line);
    if (stamp) {
      out.push(`${stamp[1]}${now.toISOString()}`);
      if (currentSection !== null) insertAt = out.length;
      continue;
    }

    const kv = currentSection !== null && !COMMENT_RE.test(line) ? KEY_RE.exec(line) : null;
    const remaining = currentSection !== null ? pending.get(currentSection) : undefined;
    const key = kv?.[2].trim();
    if (kv && key !== undefined && remaining?.has(key)) {
      out.push(`${kv[1]}${kv[2]}${kv[3]}${clean(remaining.get(key)!)}`);
      remaining.delete(key);
    } else {
      out.push(line);
    }
    if (currentSection !== null && line.trim()) insertAt = out.length;
  }
  closeSection();

  // Sections the file doesn't have at all go at the end, after one blank line.
  const newSections = [...pending].filter(([, values]) => values.size > 0);
  if (newSections.length > 0) {
    while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
    for (const [section, values] of newSections) {
      if (out.length > 0) out.push('');
      out.push(`[${section}]`);
      for (const [key, value] of values) out.push(`${key}=${clean(value)}`);
    }
    out.push('');
  }

  return out.join(eol);
}
