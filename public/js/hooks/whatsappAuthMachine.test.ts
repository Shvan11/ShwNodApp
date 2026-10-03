import { describe, expect, it } from 'vitest';
import { AUTH_STATES as S, authReducer, initialAuthModel, type AuthEvent, type AuthModel } from './whatsappAuthMachine';

const run = (m: AuthModel, ...events: AuthEvent[]) => events.reduce(authReducer, m);
const fresh = () => initialAuthModel(false, null);

describe('whatsappAuthMachine (FE-F3-5)', () => {
  it('a QR arriving while RESTORING shows the QR (the case only the old block 1 covered)', () => {
    const m = run(fresh(), { type: 'initialState', data: { restoring: true } });
    expect(m.authState).toBe(S.RESTORING);
    expect(run(m, { type: 'status', clientReady: false, qrCode: 'qr-1' }).authState).toBe(S.QR_REQUIRED);
  });

  it('entering CHECKING_SESSION with a QR already in hand shows it (the case only block 2 covered)', () => {
    const m = run(fresh(), { type: 'status', clientReady: false, qrCode: 'qr-1' }, { type: 'reset' });
    expect(m.authState).toBe(S.INITIALIZING);
    expect(run(m, { type: 'initialState', data: {} }).authState).toBe(S.QR_REQUIRED);
  });

  it('a ready client is AUTHENTICATED after any event', () => {
    const ready = run(fresh(), { type: 'status', clientReady: true, qrCode: null });
    expect(ready.authState).toBe(S.AUTHENTICATED);
    for (const e of [
      { type: 'transport', event: 'disconnected' },
      { type: 'failed', error: 'x' },
      { type: 'reset' },
      { type: 'initialState', data: { restoring: true } },
    ] as AuthEvent[]) {
      expect(run(ready, e).authState).toBe(S.AUTHENTICATED);
    }
  });

  it('the client dropping with a QR in hand flips AUTHENTICATED to QR_REQUIRED', () => {
    const m = run(fresh(), { type: 'status', clientReady: true, qrCode: null });
    expect(run(m, { type: 'status', clientReady: false, qrCode: 'qr-2' }).authState).toBe(S.QR_REQUIRED);
  });

  it('CHECKING_SESSION settles to QR_REQUIRED, and only from CHECKING_SESSION', () => {
    const checking = run(fresh(), { type: 'initialState', data: {} });
    expect(checking.authState).toBe(S.CHECKING_SESSION);
    expect(run(checking, { type: 'settleCheck' }).authState).toBe(S.QR_REQUIRED);
    const relink = run(fresh(), { type: 'initialState', data: { needsRelink: true } });
    expect(run(relink, { type: 'settleCheck' }).authState).toBe(S.NEEDS_RELINK);
  });

  it('a parked session stays NEEDS_RELINK when the snapshot has nothing new', () => {
    const relink = run(fresh(), { type: 'clientFrame', state: 'needs_relink' });
    expect(run(relink, { type: 'initialState', data: {} }).authState).toBe(S.NEEDS_RELINK);
  });

  it('connecting keeps a shown QR or an authenticated client', () => {
    const qr = run(fresh(), { type: 'status', clientReady: false, qrCode: 'qr-1' });
    expect(run(qr, { type: 'transport', event: 'connecting' }).authState).toBe(S.QR_REQUIRED);
    expect(run(fresh(), { type: 'transport', event: 'connecting' }).authState).toBe(S.CONNECTING);
  });

  it('carries the error with ERROR and clears it on reset', () => {
    const failed = run(fresh(), { type: 'failed', error: 'SSE connection failed' });
    expect(failed).toMatchObject({ authState: S.ERROR, error: 'SSE connection failed' });
    expect(run(failed, { type: 'reset' })).toMatchObject({ authState: S.INITIALIZING, error: null });
    expect(run(fresh(), { type: 'initialState', data: { error: 'boom' } })).toMatchObject({ authState: S.ERROR, error: 'boom' });
  });

  it('starts AUTHENTICATED when the client is already ready at mount', () => {
    expect(initialAuthModel(true, null).authState).toBe(S.AUTHENTICATED);
    expect(initialAuthModel(false, 'qr').authState).toBe(S.INITIALIZING);
  });
});
