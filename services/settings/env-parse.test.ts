/**
 * Tests for `.env` value parsing — specifically the boundary between a value and
 * a trailing inline comment.
 *
 * The settings form rewrites whole lines, so any key it touches loses whatever
 * documentation sat beside it unless the comment is carried across. The
 * whitespace before the `#` is part of that: emit `PG_PORT=5432# default` and the
 * `#` is no longer comment-introducing, so the next read folds the comment text
 * into the port value.
 */
import { describe, expect, it } from 'vitest';
import { splitEnvComment } from './EnvironmentManager.js';

describe('splitEnvComment', () => {
  it('splits a trailing comment and keeps its leading whitespace', () => {
    expect(splitEnvComment('5432          # default postgres port')).toEqual({
      value: '5432',
      comment: '          # default postgres port',
    });
  });

  it('round-trips: value + comment reconstructs the original', () => {
    const raw = '5432   # note';
    const { value, comment } = splitEnvComment(raw);
    expect(value + comment).toBe(raw);
  });

  it('leaves a value with no comment alone', () => {
    expect(splitEnvComment('shwan_app')).toEqual({ value: 'shwan_app', comment: '' });
  });

  it('does NOT treat a hash inside a value as a comment', () => {
    // A password may legitimately contain '#'.
    expect(splitEnvComment('p@ss#word')).toEqual({ value: 'p@ss#word', comment: '' });
  });

  it('does NOT treat a hash inside quotes as a comment', () => {
    expect(splitEnvComment('"a # b"')).toEqual({ value: '"a # b"', comment: '' });
    expect(splitEnvComment("'a # b'")).toEqual({ value: "'a # b'", comment: '' });
  });

  it('handles a whole-line comment body', () => {
    expect(splitEnvComment('# just a comment')).toEqual({ value: '', comment: '# just a comment' });
  });
});
