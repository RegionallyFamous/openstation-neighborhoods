import { BeeperApiError } from './client';

export type BeeperFailureCode =
  | 'desktop-unreachable'
  | 'desktop-timeout'
  | 'local-access-blocked'
  | 'unsupported-version'
  | 'unexpected-local-service'
  | 'authorization-expired'
  | 'permission-denied'
  | 'matrix-account-missing'
  | 'matrix-account-attention'
  | 'room-missing'
  | 'room-mismatch'
  | 'rate-limited'
  | 'beeper-temporary'
  | 'invalid-response'
  | 'authorization-cancelled'
  | 'oauth-browser-blocked'
  | 'unknown';

export type BeeperRecoveryAction =
  | 'retry-probe'
  | 'reauthorize'
  | 'update-beeper'
  | 'fix-account'
  | 'retry-room'
  | 'retry-sync';

export interface BeeperFailure {
  code: BeeperFailureCode;
  title: string;
  message: string;
  action: BeeperRecoveryAction;
  actionLabel: string;
  troubleshooting?: string;
}

export class BeeperFlowError extends Error {
  readonly failureCode: BeeperFailureCode;

  constructor(failureCode: BeeperFailureCode, message?: string) {
    super(message || failureCode);
    this.name = 'BeeperFlowError';
    this.failureCode = failureCode;
  }
}

export function classifyBeeperFailure(error: unknown): BeeperFailure {
  const message = error instanceof Error ? error.message : '';
  const normalized = message.toLowerCase();
  const flowCode = error instanceof BeeperFlowError ? error.failureCode : undefined;
  const apiCode = error instanceof BeeperApiError ? error.code?.toLowerCase() : undefined;
  const status = error instanceof BeeperApiError ? error.status : undefined;

  if (
    flowCode === 'authorization-expired' ||
    status === 401 ||
    apiCode === 'unauthorized' ||
    /invalid token|authorization is invalid|authorization.*expired/.test(normalized)
  ) {
    return failure(
      'authorization-expired',
      'Beeper needs a fresh pass',
      'The saved Beeper pass expired or was revoked. Create a new OpenStation token in Beeper, then paste it here.',
      'reauthorize',
      'USE A NEW PASS',
    );
  }

  if (flowCode === 'authorization-cancelled' || /cancelled or declined/.test(normalized)) {
    return failure(
      'authorization-cancelled',
      'No worries—the invite is still here',
      'Beeper did not approve the connection. Try again whenever you’re ready.',
      'reauthorize',
      'TRY APPROVAL AGAIN',
    );
  }

  if (flowCode === 'matrix-account-missing') {
    return failure(
      flowCode,
      'Your Beeper account is not ready yet',
      'Beeper is open, but its Beeper account has not finished setting up. Open Beeper, finish any account prompt, then check again.',
      'fix-account',
      'CHECK BEEPER AGAIN',
    );
  }

  if (flowCode === 'matrix-account-attention') {
    return failure(
      flowCode,
      'Beeper needs a quick check',
      message || 'Open Beeper and resolve the account notice shown there, then check again.',
      'fix-account',
      'I FIXED IT — CHECK AGAIN',
    );
  }

  if (
    flowCode === 'unsupported-version' ||
    apiCode === 'unsupported_version' ||
    /requires beeper desktop .* or newer/.test(normalized)
  ) {
    return failure(
      'unsupported-version',
      'Beeper needs an update',
      'Update Beeper Desktop to version 4.2.936 or newer, reopen it, then check again.',
      'update-beeper',
      'CHECK AFTER UPDATING',
    );
  }

  if (apiCode === 'oauth_unavailable') {
    return failure(
      'oauth-browser-blocked',
      'Beeper changed browser approval',
      'Beeper no longer lets a hosted page finish this approval flow. Create an OpenStation access token under Beeper Settings → Integrations, then paste it here.',
      'reauthorize',
      'USE A BEEPER PASS',
    );
  }

  if (
    flowCode === 'unexpected-local-service' ||
    apiCode === 'unexpected_service' ||
    /not a supported beeper desktop|desktop api must use/.test(normalized)
  ) {
    return failure(
      'unexpected-local-service',
      'That was not Beeper',
      'Something else answered at Beeper’s local address. Close it, reopen Beeper Desktop, and try again.',
      'retry-probe',
      'CHECK AGAIN',
    );
  }

  if (flowCode === 'room-mismatch') {
    return failure(
      flowCode,
      'Beeper opened the wrong room',
      'OpenStation stopped before showing or posting to an unexpected room. Try this room again; if it repeats, the room map needs an update.',
      'retry-room',
      'TRY THIS ROOM AGAIN',
    );
  }

  if (flowCode === 'room-missing' || status === 404) {
    return failure(
      'room-missing',
      'This room moved',
      'Beeper cannot find this OpenStation room right now. Try again shortly; the room map may need an update.',
      'retry-room',
      'TRY THIS ROOM AGAIN',
    );
  }

  if (status === 403 || flowCode === 'permission-denied') {
    return failure(
      'permission-denied',
      'Beeper said no to that request',
      'This Beeper account does not currently have permission for that room or action. Check the account in Beeper, then try again.',
      'fix-account',
      'CHECK BEEPER AGAIN',
    );
  }

  if (status === 429 || apiCode === 'm_limit_exceeded' || flowCode === 'rate-limited') {
    return failure(
      'rate-limited',
      'Beeper asked us to slow down',
      'Nothing is lost. OpenStation will pause briefly, then try again.',
      'retry-sync',
      'TRY AGAIN NOW',
    );
  }

  if (
    flowCode === 'desktop-timeout' ||
    apiCode === 'timeout' ||
    /timed out|timeout|signal timed out/.test(normalized)
  ) {
    return failure(
      'desktop-timeout',
      'Beeper is taking too long',
      'Make sure Beeper Desktop is fully open—not just starting up—then try again.',
      'retry-probe',
      'TRY AGAIN',
      'If Beeper is already open, quit and reopen it. Then return here and try again.',
    );
  }

  if (status === 0 || apiCode === 'network_error' || apiCode === 'aborted') {
    return failure(
      isLikelySafari() ? 'local-access-blocked' : 'desktop-unreachable',
      isLikelySafari() ? 'This browser cannot reach Beeper' : 'Beeper did not answer',
      isLikelySafari()
        ? 'OpenStation chat currently needs Chrome, Edge, or Firefox on the same computer as Beeper Desktop.'
        : 'Open Beeper Desktop on this computer. If it is already open, allow Local Network Access for openstation.chat in your browser, then try again.',
      'retry-probe',
      'CHECK FOR BEEPER',
      isLikelySafari()
        ? 'Safari blocks the secure-page-to-local-app connection this Beeper integration uses.'
        : 'In your browser’s site settings, allow Local Network Access for openstation.chat. Beeper’s Desktop API should also be enabled under Settings → Integrations.',
    );
  }

  if (status !== undefined && status >= 500) {
    return failure(
      'beeper-temporary',
      'Beeper hit a temporary snag',
      'Beeper hit a temporary problem. Your session is still safe—keep Beeper open and try again in a moment.',
      'retry-sync',
      'TRY AGAIN',
    );
  }

  if (status === 400 || status === 422 || /incomplete|invalid.*response/.test(normalized)) {
    return failure(
      'invalid-response',
      'Beeper sent something unexpected',
      'OpenStation stopped safely instead of guessing. Update Beeper and try again.',
      'update-beeper',
      'CHECK AGAIN',
    );
  }

  return failure(
    'unknown',
    'The door got stuck',
    'OpenStation could not finish that request. Your Beeper account and messages are unchanged. Try again, or reopen Beeper if it repeats.',
    'retry-probe',
    'TRY AGAIN',
  );
}

function failure(
  code: BeeperFailureCode,
  title: string,
  message: string,
  action: BeeperRecoveryAction,
  actionLabel: string,
  troubleshooting?: string,
): BeeperFailure {
  return { code, title, message, action, actionLabel, troubleshooting };
}

function isLikelySafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const agent = navigator.userAgent;
  return /Safari\//.test(agent) && !/(?:Chrome|Chromium|CriOS|Edg|OPR)\//.test(agent);
}
