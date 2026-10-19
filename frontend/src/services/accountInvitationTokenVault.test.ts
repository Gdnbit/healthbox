import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('account invitation token vault', () => {
  beforeEach(() => {
    vi.resetModules();
    window.history.replaceState({}, '', '/');
  });

  it('captures the fragment before app logging and returns it only once', async () => {
    window.history.replaceState(
      {},
      '',
      '/activate#token=synthetic-fragment-token'
    );

    const vault = await import('./accountInvitationTokenVault');

    expect(window.location.pathname).toBe('/activate');
    expect(window.location.hash).toBe('');
    expect(vault.consumeInvitationToken()).toBe('synthetic-fragment-token');
    expect(vault.consumeInvitationToken()).toBeNull();
  });

  it('ignores unrelated fragments and malformed invitation fragments', async () => {
    window.history.replaceState({}, '', '/activate#section=privacy');

    const vault = await import('./accountInvitationTokenVault');

    expect(vault.consumeInvitationToken()).toBeNull();
    expect(window.location.hash).toBe('#section=privacy');
  });
});
