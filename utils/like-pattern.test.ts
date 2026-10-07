import { describe, expect, it } from 'vitest';
import { escapeLike } from './like-pattern';

describe('escapeLike', () => {
  it('leaves ordinary text alone, Arabic included', () => {
    expect(escapeLike('Ali Hassan')).toBe('Ali Hassan');
    expect(escapeLike('محمد علي')).toBe('محمد علي');
    expect(escapeLike('7501234567')).toBe('7501234567');
  });

  it('escapes the two wildcards and the escape character itself', () => {
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('a\\b')).toBe('a\\\\b');
    expect(escapeLike('%_\\')).toBe('\\%\\_\\\\');
  });
});
