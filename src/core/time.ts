import config from '../config/index.js';

/**
 * Format a timestamp in the configured TIMEZONE.
 *
 * Every timestamp in the bot used to be `new Date().toLocaleString()`, i.e. the
 * server's clock — which on Render is UTC, so a Dar es Salaam owner saw alert
 * times three hours behind. The TIMEZONE env var existed but was never read.
 */
export function formatLocal(date: Date = new Date()): string {
  try {
    return date.toLocaleString('en-GB', {
      timeZone: config.TIMEZONE,
      hour12: false,
    });
  } catch {
    // An invalid TIMEZONE value makes toLocaleString throw: fall back to the
    // server clock rather than breaking the reply that carries the timestamp.
    return date.toLocaleString('en-GB', { hour12: false });
  }
}

export function timezoneName(): string {
  return config.TIMEZONE;
}
