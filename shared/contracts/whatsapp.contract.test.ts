import { describe, expect, it } from 'vitest';
import { groupSettings } from './whatsapp.contract.js';

describe('groupSettings body', () => {
  it('needs a group name to turn the post on', () => {
    expect(groupSettings.body.safeParse({ enabled: true, groupName: '' }).success).toBe(false);
    expect(groupSettings.body.safeParse({ enabled: true, groupName: '   ' }).success).toBe(false);
    expect(groupSettings.body.parse({ enabled: true, groupName: ' Front Desk ' })).toEqual({
      enabled: true,
      groupName: 'Front Desk',
    });
  });

  it('saves "off" with no group named — what a new install starts with', () => {
    expect(groupSettings.body.parse({ enabled: false, groupName: '' })).toEqual({ enabled: false, groupName: '' });
  });

  it('keeps the 100-character cap', () => {
    expect(groupSettings.body.safeParse({ enabled: false, groupName: 'x'.repeat(101) }).success).toBe(false);
  });
});
