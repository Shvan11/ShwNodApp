/**
 * The jump-list name rule. Both defects it fixes were invisible in review — a
 * bare `startsWith` reads fine until you remember the server is citext and that
 * a checkbox two rows below the input says otherwise.
 */
import { describe, expect, it } from 'vitest';
import type { PatientLookupMatch } from '@shared/contracts/patient.contract';
import {
  canLookUp,
  matchesLookup,
  matchesPatientName,
  patientLookupModeFor,
  uniquePatients,
} from './patientSearch';

describe('matchesPatientName', () => {
  it('is case-insensitive, like the citext column it mirrors', () => {
    expect(matchesPatientName('Ali Hassan', 'ali', true)).toBe(true);
    expect(matchesPatientName('ali hassan', 'ALI', true)).toBe(true);
  });

  it('matches a later word when prefixOnly is off (the checkbox default)', () => {
    expect(matchesPatientName('سيما كاروان', 'كاروان', false)).toBe(true);
    expect(matchesPatientName('Ali Hassan', 'hass', false)).toBe(true);
  });

  it('matches only the prefix when prefixOnly is on', () => {
    expect(matchesPatientName('سيما كاروان', 'كاروان', true)).toBe(false);
    expect(matchesPatientName('Ali Hassan', 'Ali', true)).toBe(true);
  });

  it('never matches a missing name', () => {
    expect(matchesPatientName(null, 'a', false)).toBe(false);
    expect(matchesPatientName(undefined, 'a', false)).toBe(false);
    expect(matchesPatientName('', 'a', false)).toBe(false);
  });
});

/**
 * The typeahead's rows come from the server, a moment after the text. These are
 * the browser's copy of the server's rules, used to drop the rows the newest
 * text rules out until its own answer arrives — so each must say what
 * `patient-lookup-queries.ts` would.
 */
const row = (over: Partial<PatientLookupMatch>): PatientLookupMatch => ({
  id: 4521,
  name: 'محمد علي حسن',
  phone: '7501234567',
  group: 'name',
  ...over,
});

describe('patientLookupModeFor', () => {
  it('reads a leading digit as phone/ID and anything else as a name', () => {
    expect(patientLookupModeFor('750')).toBe('phoneId');
    expect(patientLookupModeFor('  4521')).toBe('phoneId');
    expect(patientLookupModeFor('محمد')).toBe('name');
    expect(patientLookupModeFor('Ali 2')).toBe('name');
    expect(patientLookupModeFor('')).toBe('name');
  });
});

describe('canLookUp', () => {
  it('needs two characters of a name, one digit of a phone/ID', () => {
    expect(canLookUp('م', 'name')).toBe(false);
    expect(canLookUp('مح', 'name')).toBe(true);
    expect(canLookUp('', 'phoneId')).toBe(false);
    expect(canLookUp('7', 'phoneId')).toBe(true);
  });
});

describe('matchesLookup', () => {
  it('keeps a name row while the name still contains the text', () => {
    const r = row({ group: 'name' });
    expect(matchesLookup(r, 'محمد', 'name', false)).toBe(true);
    expect(matchesLookup(r, 'علي ح', 'name', false)).toBe(true);
    expect(matchesLookup(r, 'محمود', 'name', false)).toBe(false);
  });

  it('keeps a name row only on a prefix when the checkbox is on', () => {
    const r = row({ group: 'name' });
    expect(matchesLookup(r, 'محمد ع', 'name', true)).toBe(true);
    expect(matchesLookup(r, 'علي', 'name', true)).toBe(false);
  });

  it('shows nothing below the minimum length, whatever was on screen', () => {
    expect(matchesLookup(row({ group: 'name' }), 'م', 'name', false)).toBe(false);
    expect(matchesLookup(row({ group: 'phone' }), '7', 'phoneId', false)).toBe(false);
    expect(matchesLookup(row({ group: 'id' }), '', 'phoneId', false)).toBe(false);
  });

  it('keeps an ID row while the ID starts with the digits — not when they sit inside it', () => {
    const r = row({ group: 'id', id: 4521 });
    expect(matchesLookup(r, '4', 'phoneId', false)).toBe(true);
    expect(matchesLookup(r, '452', 'phoneId', false)).toBe(true);
    expect(matchesLookup(r, '4521', 'phoneId', false)).toBe(true);
    expect(matchesLookup(r, '521', 'phoneId', false)).toBe(false);
    expect(matchesLookup(r, '45210', 'phoneId', false)).toBe(false);
    // No ID has a leading zero, and letters are not part of one.
    expect(matchesLookup(row({ group: 'id', id: 45 }), '045', 'phoneId', false)).toBe(false);
    expect(matchesLookup(r, '45a', 'phoneId', false)).toBe(false);
  });

  it('keeps a phone row while its number contains the text, anywhere', () => {
    const r = row({ group: 'phone', phone: '7501234567' });
    expect(matchesLookup(r, '75', 'phoneId', false)).toBe(true);
    expect(matchesLookup(r, '4567', 'phoneId', false)).toBe(true);
    expect(matchesLookup(r, '0750', 'phoneId', false)).toBe(false);
    expect(matchesLookup(row({ group: 'phone', phone: null }), '75', 'phoneId', false)).toBe(false);
  });

  it('drops the other mode’s rows when a box switches between name and phone/ID', () => {
    expect(matchesLookup(row({ group: 'name', name: 'Ali 75' }), '75', 'phoneId', false)).toBe(false);
    expect(matchesLookup(row({ group: 'phone' }), 'محمد', 'name', false)).toBe(false);
    expect(matchesLookup(row({ group: 'id' }), 'محمد', 'name', false)).toBe(false);
  });
});

describe('uniquePatients', () => {
  it('lists a patient once, keeping the first row', () => {
    const rows = [
      row({ group: 'id', id: 75 }),
      row({ group: 'id', id: 750 }),
      row({ group: 'phone', id: 75, phone: '7575757575' }),
      row({ group: 'phone', id: 9 }),
    ];
    expect(uniquePatients(rows).map((r) => `${r.group}:${r.id}`)).toEqual(['id:75', 'id:750', 'phone:9']);
  });
});
