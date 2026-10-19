import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const authServiceMock = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('../services/auth/simpleAuthService', () => ({
  authService: authServiceMock,
}));

vi.mock('../services/api/userPreferencesApi', () => ({
  getUserPreferences: vi.fn(),
}));

vi.mock('../utils/notifyTranslated', () => ({
  notifySuccess: vi.fn(),
  notifyInfo: vi.fn(),
}));

import { AuthProvider, useAuth } from './AuthContext';

function AuthLoadingProbe() {
  const { isLoading, login } = useAuth();

  return (
    <>
      <output data-testid="auth-loading">{String(isLoading)}</output>
      <button type="button" onClick={() => void login({ username: '123' })}>
        开始登录
      </button>
    </>
  );
}

describe('AuthProvider interactive login state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authServiceMock.getCurrentUser.mockResolvedValue(null);
    authServiceMock.logout.mockResolvedValue({ success: true });
  });

  test('does not unmount the login route while an MFA challenge is pending', async () => {
    let resolveLogin;
    authServiceMock.login.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveLogin = resolve;
        })
    );

    render(
      <AuthProvider>
        <AuthLoadingProbe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-loading')).toHaveTextContent('false');
    });

    fireEvent.click(screen.getByRole('button', { name: '开始登录' }));

    expect(screen.getByTestId('auth-loading')).toHaveTextContent('false');

    await act(async () => {
      resolveLogin({
        success: true,
        authenticationPending: true,
        challengeType: 'mfa_enrollment_required',
        challengeToken: 'candidate-challenge',
      });
    });

    expect(screen.getByTestId('auth-loading')).toHaveTextContent('false');
  });
});
