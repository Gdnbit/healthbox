/**
 * Keeps an account-invitation secret in memory only.
 *
 * This module is imported eagerly by App.jsx so the URL fragment is removed
 * before application and navigation logging can observe the full URL.
 */
let invitationToken: string | null = null;

if (
  typeof window !== 'undefined' &&
  window.location.pathname === '/activate' &&
  window.location.hash.startsWith('#token=')
) {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const candidate = fragment.get('token')?.trim() || null;

  invitationToken = candidate;
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}`
  );
}

export const consumeInvitationToken = (): string | null => {
  const token = invitationToken;
  invitationToken = null;
  return token;
};
