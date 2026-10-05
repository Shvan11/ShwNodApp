/**
 * Tests for the generic options API's visibility rules (FE-F21-1): credentials
 * never leave through it, and a non-admin reads only the rows the working
 * screens need. `option_name` is citext, so every rule is case-insensitive.
 */
import { describe, expect, it } from 'vitest';
import { canReadOption, isSecretOption, withoutSecretOptions } from './option-access.js';

describe('isSecretOption', () => {
  it('flags the credential rows in use, in any case', () => {
    expect(isSecretOption('gram_session')).toBe(true);
    expect(isSecretOption('GRAM_SESSION')).toBe(true);
    expect(isSecretOption('EMAIL_SMTP_PASSWORD')).toBe(true);
    expect(isSecretOption('email_smtp_password')).toBe(true);
    expect(isSecretOption('gemini_api_key')).toBe(true);
  });

  it('flags a name that reads like a credential', () => {
    expect(isSecretOption('SOME_SERVICE_TOKEN')).toBe(true);
    expect(isSecretOption('stripeApiKey')).toBe(true);
    expect(isSecretOption('webhook_secret')).toBe(true);
  });

  it('leaves ordinary settings alone', () => {
    for (const name of ['PatientsFolder', 'EMAIL_SMTP_USER', 'EMAIL_SMTP_HOST', 'gemini_model',
      'whatsapp_group_name', 'MaxAppointmentsPerSlot', 'CLINIC_NAME']) {
      expect(isSecretOption(name)).toBe(false);
    }
  });
});

describe('canReadOption', () => {
  it('lets a non-admin read only the working-screen rows', () => {
    expect(canReadOption('CALENDAR_EARLY_SLOTS', false)).toBe(true);
    expect(canReadOption('calendar_late_slots', false)).toBe(true);
    expect(canReadOption('CALENDAR_SHOW_EXTENDED_SLOTS_DEFAULT', false)).toBe(true);
    expect(canReadOption('DEFAULT_WORK_CURRENCY', false)).toBe(true);
    expect(canReadOption('AlignerSetsFolder', false)).toBe(true);
    expect(canReadOption('EMAIL_SMTP_USER', false)).toBe(false);
    expect(canReadOption('PatientsFolder', false)).toBe(false);
  });

  it('lets an admin read any non-credential row', () => {
    expect(canReadOption('EMAIL_SMTP_USER', true)).toBe(true);
    expect(canReadOption('PatientsFolder', true)).toBe(true);
  });

  it('never returns a credential, to anyone', () => {
    expect(canReadOption('gram_session', true)).toBe(false);
    expect(canReadOption('Gram_Session', false)).toBe(false);
    expect(canReadOption('EMAIL_SMTP_PASSWORD', true)).toBe(false);
  });
});

describe('withoutSecretOptions', () => {
  it('drops the credential rows and keeps the rest in order', () => {
    const rows = [
      { option_name: 'CLINIC_NAME', option_value: 'x' },
      { option_name: 'EMAIL_SMTP_PASSWORD', option_value: 'p' },
      { option_name: 'gram_session', option_value: 's' },
      { option_name: 'PatientsFolder', option_value: '\\\\Clinic\\clinic1' },
    ];
    expect(withoutSecretOptions(rows).map((r) => r.option_name)).toEqual(['CLINIC_NAME', 'PatientsFolder']);
  });
});
