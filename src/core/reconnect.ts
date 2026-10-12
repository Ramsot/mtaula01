import { DisconnectReason } from 'baileys';

export type DisconnectDecision =
  | { action: 'logout'; reason: string }
  | { action: 'reconnect'; delayMs: number; resetBackoff: boolean };

const FAST_RECONNECT_MS = 2000;
const FORBIDDEN_BASE_MS = 30_000;
const FORBIDDEN_MAX_MS = 5 * 60_000;
const DEFAULT_BASE_MS = 5_000;
const DEFAULT_MAX_MS = 60_000;

/**
 * Decide what to do after the WhatsApp socket closes.
 *
 * The only codes that genuinely mean "this device must be paired again" are
 * 401 (loggedOut) and 411 (multideviceMismatch). Everything else — including
 * 515 (restartRequired) and 440 (connectionReplaced), which WhatsApp sends
 * routinely and which do NOT invalidate the session — is a transient drop we
 * should reconnect through without wiping credentials. Treating 515/440 as a
 * failure is what made the bot flap and eventually look "logged out".
 */
export function classifyDisconnect(
  statusCode: number | undefined,
  attempt: number,
  hasQr = false
): DisconnectDecision {
  switch (statusCode) {
    case DisconnectReason.loggedOut: // 401
      return { action: 'logout', reason: 'loggedOut' };
    case DisconnectReason.multideviceMismatch: // 411
      return { action: 'logout', reason: 'multideviceMismatch' };
    case DisconnectReason.restartRequired: // 515
    case DisconnectReason.connectionReplaced: // 440
    case DisconnectReason.connectionClosed: // 428
      // Not failures: WhatsApp asked us to cycle the socket. Reconnect straight
      // away and do not grow the backoff.
      return { action: 'reconnect', delayMs: FAST_RECONNECT_MS, resetBackoff: true };
    case DisconnectReason.forbidden: // 403 — usually a temporary block
      return {
        action: 'reconnect',
        delayMs: Math.min(FORBIDDEN_BASE_MS * 2 ** Math.min(Math.max(attempt, 0), 3), FORBIDDEN_MAX_MS),
        resetBackoff: false,
      };
    default: {
      // While unpaired we are just waiting for a scan, so retry steadily.
      const delayMs = hasQr
        ? 5000
        : Math.min(DEFAULT_BASE_MS * 2 ** Math.min(Math.max(attempt, 0), 4), DEFAULT_MAX_MS);
      return { action: 'reconnect', delayMs, resetBackoff: false };
    }
  }
}
