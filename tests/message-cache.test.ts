import { describe, it, expect } from 'vitest';
import { MessageCache } from '../src/core/message-cache.js';

describe('message cache (Baileys retry support)', () => {
  it('stores and returns the raw message so getMessage can re-send it', () => {
    const cache = new MessageCache();
    const raw = { key: { id: 'ABC' }, message: { conversation: 'hello' } };
    cache.set('ABC', raw);

    expect(cache.get('ABC')).toBe(raw);
    expect(cache.get('ABC').message.conversation).toBe('hello');
    expect(cache.get('missing')).toBeUndefined();
  });

  it('drops entries once they expire', () => {
    const cache = new MessageCache(100, 5);
    cache.set('OLD', { key: { id: 'OLD' }, message: { conversation: 'x' } });
    expect(cache.get('OLD')).toBeDefined();

    // Simulate ageing past the TTL without sleeping.
    (cache as any).store.get('OLD').storedAt = Date.now() - 10_000;
    expect(cache.get('OLD')).toBeUndefined();
  });

  it('evicts the oldest message when the cap is exceeded', () => {
    const cache = new MessageCache(3);
    for (const id of ['a', 'b', 'c', 'd']) {
      cache.set(id, { key: { id }, message: { conversation: id } });
    }

    expect(cache.size).toBe(3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeDefined();
    expect(cache.get('d')).toBeDefined();
  });

  it('ignores empty ids and payloads', () => {
    const cache = new MessageCache();
    cache.set('', { message: {} });
    cache.set('X', null);
    expect(cache.size).toBe(0);
  });

  it('supports deletion (anti-delete consumes the stored message)', () => {
    const cache = new MessageCache();
    cache.set('D', { key: { id: 'D' }, message: { conversation: 'bye' } });
    cache.delete('D');
    expect(cache.get('D')).toBeUndefined();
  });
});
