import { afterEach, describe, expect, it, vi } from 'vitest';
import { BeeperApiError, BeeperClient } from '../src/beeper/client';
import {
  BeeperFlowError,
  classifyBeeperFailure,
} from '../src/beeper/failures';

describe('Beeper failure guidance', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    {
      error: new BeeperApiError('Invalid token', 401, 'unauthorized'),
      code: 'authorization-expired',
      action: 'reauthorize',
      phrase: 'pass expired',
    },
    {
      error: new BeeperApiError('Beeper timed out', 0, 'timeout'),
      code: 'desktop-timeout',
      action: 'retry-probe',
      phrase: 'fully open',
    },
    {
      error: new BeeperApiError('OpenStation requires Beeper Desktop 4.2.936 or newer.', 0, 'unsupported_version'),
      code: 'unsupported-version',
      action: 'update-beeper',
      phrase: 'Update Beeper',
    },
    {
      error: new BeeperApiError('Forbidden', 403),
      code: 'permission-denied',
      action: 'fix-account',
      phrase: 'permission',
    },
    {
      error: new BeeperApiError('Missing', 404),
      code: 'room-missing',
      action: 'retry-room',
      phrase: 'room map',
    },
    {
      error: new BeeperApiError('Slow down', 429, 'M_LIMIT_EXCEEDED'),
      code: 'rate-limited',
      action: 'retry-sync',
      phrase: 'Nothing is lost',
    },
    {
      error: new BeeperApiError('Server error', 502),
      code: 'beeper-temporary',
      action: 'retry-sync',
      phrase: 'temporary',
    },
    {
      error: new BeeperApiError('Same-origin only', 403, 'oauth_unavailable'),
      code: 'oauth-browser-blocked',
      action: 'reauthorize',
      phrase: 'Settings → Integrations',
    },
    {
      error: new BeeperFlowError('matrix-account-missing'),
      code: 'matrix-account-missing',
      action: 'fix-account',
      phrase: 'finish any account prompt',
    },
  ])('turns $code into a concrete recovery', ({ error, code, action, phrase }) => {
    expect(classifyBeeperFailure(error)).toMatchObject({
      code,
      action,
      message: expect.stringContaining(phrase),
      actionLabel: expect.any(String),
    });
  });

  it('keeps unknown internal details out of the user-facing message', () => {
    const classified = classifyBeeperFailure(new Error('Bearer secret-token-value'));
    expect(classified).toMatchObject({
      code: 'unknown',
      message: expect.stringContaining('messages are unchanged'),
    });
    expect(classified.message).not.toContain('secret-token-value');
  });

  it('turns a transport timeout into a stable machine-readable failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      new DOMException('The operation timed out.', 'TimeoutError'),
    ));

    await expect(new BeeperClient().getInfo()).rejects.toMatchObject({
      status: 0,
      code: 'timeout',
      message: expect.stringContaining('timed out'),
    });
  });
});
