// Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
import { vi } from 'vitest';
import App, { documentLanguageForLocale } from './App';
import render from './test-utils/render';

// Mock the auth service
vi.mock('./services/auth/simpleAuthService', () => ({
  authService: {
    getToken: vi.fn(() => null),
    getCurrentUser: vi.fn(() => null),
  },
}));

describe('App Component', () => {
  test('renders app with error boundary', () => {
    render(<App />, { skipRouter: true });

    // Should render the main app container
    const appElement = document.querySelector('.App');
    expect(appElement).toBeInTheDocument();
  });

  test('renders with authentication context', () => {
    render(<App />, {
      skipRouter: true,
      authContextValue: {
        user: {
          id: 1,
          username: 'testuser',
          email: 'test@example.com',
          full_name: 'Test User',
          role: 'user',
        },
        isAuthenticated: true,
      },
    });

    // Should render the main app
    const appElement = document.querySelector('.App');
    expect(appElement).toBeInTheDocument();
  });

  test('renders with theme provider', () => {
    render(<App />, {
      skipRouter: true,
      authContextValue: {
        isLoading: false,
      },
    });

    // Should render the app with Mantine theme
    const appElement = document.querySelector('.App');
    expect(appElement).toBeInTheDocument();
  });

  test('renders app structure correctly', () => {
    render(<App />, {
      skipRouter: true,
    });

    // Should have the App class
    expect(document.querySelector('.App')).toBeInTheDocument();
  });

  test('maps Chinese locales to the correct document language', () => {
    expect(documentLanguageForLocale('zh')).toBe('zh-CN');
    expect(documentLanguageForLocale('zh-CN')).toBe('zh-CN');
    expect(documentLanguageForLocale('en')).toBe('en');
  });
});
