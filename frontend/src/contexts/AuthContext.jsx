// Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
import React, { createContext, useContext, useReducer, useEffect } from 'react';
import { authService } from '../services/auth/simpleAuthService';
import { notifySuccess, notifyInfo } from '../utils/notifyTranslated';
import { env } from '../config/env';
import {
  shouldShowPatientProfileCompletionPrompt,
  isFirstLogin,
} from '../utils/profileUtils';
import logger from '../services/logger';
import { getActivityConfig } from '../config/activityConfig';
import secureActivityLogger from '../utils/secureActivityLogger';
import { isAdminRole } from '../utils/authUtils';
import { getUserPreferences } from '../services/api/userPreferencesApi';

// Auth State Management
const initialState = {
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
  lastActivity: Date.now(),
  sessionTimeoutMinutes: 120, // Default timeout
  mustChangePassword: false,
  privacyConsentRequired: false,
};

// Auth Actions
const AUTH_ACTIONS = {
  SET_LOADING: 'SET_LOADING',
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILURE: 'LOGIN_FAILURE',
  LOGOUT: 'LOGOUT',
  UPDATE_ACTIVITY: 'UPDATE_ACTIVITY',
  SET_ERROR: 'SET_ERROR',
  CLEAR_ERROR: 'CLEAR_ERROR',
  UPDATE_SESSION_TIMEOUT: 'UPDATE_SESSION_TIMEOUT',
  CLEAR_MUST_CHANGE_PASSWORD: 'CLEAR_MUST_CHANGE_PASSWORD',
  CLEAR_PRIVACY_CONSENT_REQUIRED: 'CLEAR_PRIVACY_CONSENT_REQUIRED',
};

// Auth Reducer
function authReducer(state, action) {
  switch (action.type) {
    case AUTH_ACTIONS.SET_LOADING:
      return {
        ...state,
        isLoading: action.payload,
      };

    case AUTH_ACTIONS.LOGIN_SUCCESS:
      return {
        ...state,
        user: action.payload.user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
        lastActivity: Date.now(),
        sessionTimeoutMinutes: action.payload.sessionTimeoutMinutes || 120,
        mustChangePassword: action.payload.mustChangePassword || false,
        privacyConsentRequired: action.payload.privacyConsentRequired || false,
      };

    case AUTH_ACTIONS.CLEAR_MUST_CHANGE_PASSWORD:
      return {
        ...state,
        mustChangePassword: false,
      };

    case AUTH_ACTIONS.CLEAR_PRIVACY_CONSENT_REQUIRED:
      return {
        ...state,
        privacyConsentRequired: false,
      };

    case AUTH_ACTIONS.LOGIN_FAILURE:
      return {
        ...state,
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: action.payload,
      };

    case AUTH_ACTIONS.LOGOUT:
      return {
        ...initialState,
        isLoading: false,
      };

    case AUTH_ACTIONS.UPDATE_ACTIVITY:
      return {
        ...state,
        lastActivity: Date.now(),
      };

    case AUTH_ACTIONS.SET_ERROR:
      return {
        ...state,
        error: action.payload,
        isLoading: false,
      };

    case AUTH_ACTIONS.CLEAR_ERROR:
      return {
        ...state,
        error: null,
      };

    case AUTH_ACTIONS.UPDATE_SESSION_TIMEOUT:
      return {
        ...state,
        sessionTimeoutMinutes: action.payload,
        lastActivity: Date.now(), // Reset activity timer when timeout changes
      };

    default:
      return state;
  }
}

// Create Context
const AuthContext = createContext(null);

// Auth Provider Component
export function AuthProvider({ children }) {
  const [state, dispatch] = useReducer(authReducer, initialState);

  // Check if user should see patient profile completion prompts (first login only)
  const shouldShowProfilePrompts = patient => {
    return (
      state.user &&
      shouldShowPatientProfileCompletionPrompt(state.user, patient)
    );
  };

  // Check if this is user's first login
  const checkIsFirstLogin = () => {
    return state.user && isFirstLogin(state.user.username);
  };

  // Initialize auth state on app load.
  // The HttpOnly cookie is sent automatically -- we verify the session by
  // calling /users/me. If the cookie is valid the user is returned; otherwise
  // we treat the session as expired.
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        dispatch({ type: AUTH_ACTIONS.SET_LOADING, payload: true });

        logger.info('Verifying session with server', {
          category: 'auth_restore_attempt',
          timestamp: new Date().toISOString(),
        });

        const user = await authService.getCurrentUser();

        if (!user) {
          logger.info('No valid session found', {
            category: 'auth_init_no_session',
            timestamp: new Date().toISOString(),
          });
          clearAuthData();
          dispatch({ type: AUTH_ACTIONS.LOGOUT });
          return;
        }

        const mustChangePassword = user.must_change_password === true;
        const privacyConsentRequired = user.privacy_consent_required === true;

        // Load user preferences from backend (session timeout + language)
        let sessionTimeoutMinutes = 120;
        if (!privacyConsentRequired) {
          try {
            const userPrefs = await getUserPreferences();
            if (userPrefs.session_timeout_minutes) {
              sessionTimeoutMinutes = userPrefs.session_timeout_minutes;
              localStorage.setItem(
                'medapp_sessionTimeoutMinutes',
                sessionTimeoutMinutes.toString()
              );
            }
            // Language preference is applied by UserPreferencesContext
          } catch (prefError) {
            // Fall back to cached localStorage value
            const cached = localStorage.getItem('medapp_sessionTimeoutMinutes');
            if (cached) sessionTimeoutMinutes = parseInt(cached);
            logger.warn(
              'Failed to load user preferences, using cached timeout',
              {
                category: 'prefs_load_failed',
                error: prefError.message,
                sessionTimeoutMinutes,
              }
            );
          }
        } else {
          const cached = localStorage.getItem('medapp_sessionTimeoutMinutes');
          if (cached) sessionTimeoutMinutes = parseInt(cached);
          logger.info('User preferences deferred until privacy consent', {
            category: 'prefs_load_deferred',
            sessionTimeoutMinutes,
          });
        }

        dispatch({
          type: AUTH_ACTIONS.LOGIN_SUCCESS,
          payload: {
            user,
            sessionTimeoutMinutes,
            mustChangePassword,
            privacyConsentRequired,
          },
        });

        logger.info('Authentication restored successfully', {
          category: 'auth_restore_success',
          userId: user.id,
          username: user.username,
          sessionTimeoutMinutes,
        });
      } catch (error) {
        logger.error('auth_context_init_error', {
          message: 'Auth initialization failed',
          error: error.message,
          stack: error.stack,
          timestamp: new Date().toISOString(),
        });
        dispatch({ type: AUTH_ACTIONS.LOGOUT });
      } finally {
        dispatch({ type: AUTH_ACTIONS.SET_LOADING, payload: false });
      }
    };

    initializeAuth();
  }, []);

  // Refs so the interval closure reads fresh values without re-registering
  const lastActivityRef = React.useRef(state.lastActivity);
  const sessionTimeoutRef = React.useRef(state.sessionTimeoutMinutes);
  useEffect(() => {
    lastActivityRef.current = state.lastActivity;
  }, [state.lastActivity]);
  useEffect(() => {
    sessionTimeoutRef.current = state.sessionTimeoutMinutes;
  }, [state.sessionTimeoutMinutes]);

  // Inactivity check -- single interval, created once on login, torn down on logout
  useEffect(() => {
    if (!state.isAuthenticated) return;

    const { SESSION_CHECK_INTERVAL } = getActivityConfig();

    const activityTimer = setInterval(async () => {
      const idle = Date.now() - lastActivityRef.current;
      const timeoutMs = (sessionTimeoutRef.current || 120) * 60 * 1000;

      if (idle > timeoutMs) {
        logger.warn('Session expired due to inactivity', {
          category: 'auth_session_expired',
          idleSeconds: Math.floor(idle / 1000),
          sessionTimeoutMinutes: sessionTimeoutRef.current || 120,
        });
        notifyInfo('notifications:toasts.auth.sessionExpired');
        // Await the server-side cookie clear before tearing down auth state.
        // Racing this with the Login page's config fetches caused the SSO
        // button to disappear after auto-logout (issue #723). May fail if the
        // JWT is already expired -- that's OK.
        try {
          await authService.logout();
        } catch {
          // ignored -- expired JWT will 401, that's expected
        }
        clearAuthData();
        dispatch({ type: AUTH_ACTIONS.LOGOUT });
      }
    }, SESSION_CHECK_INTERVAL);

    return () => clearInterval(activityTimer);
  }, [state.isAuthenticated]);

  // Helper functions
  // Clear client-side auth data. The HttpOnly cookie is cleared server-side on logout.
  const clearAuthData = () => {
    localStorage.removeItem('medapp_sessionTimeoutMinutes');

    const cacheKeys = Object.keys(localStorage).filter(
      key =>
        key.startsWith('appData_') ||
        key.startsWith('patient_') ||
        key.startsWith('cache_')
    );
    cacheKeys.forEach(key => localStorage.removeItem(key));
  };

  // Update user data in context -- preserve existing session state
  const updateUser = updatedUserData => {
    const updatedUser = { ...state.user, ...updatedUserData };

    dispatch({
      type: AUTH_ACTIONS.LOGIN_SUCCESS,
      payload: {
        user: updatedUser,
        sessionTimeoutMinutes: state.sessionTimeoutMinutes,
        mustChangePassword: state.mustChangePassword,
        privacyConsentRequired: state.privacyConsentRequired,
      },
    });

    return updatedUser;
  };

  const finalizeAuthenticatedResult = result => {
    const user = result.user;
    const cacheKeys = Object.keys(localStorage).filter(
      key =>
        key.startsWith('appData_') ||
        key.startsWith('patient_') ||
        key.startsWith('cache_')
    );
    cacheKeys.forEach(key => localStorage.removeItem(key));

    const sessionTimeoutMinutes = result.sessionTimeoutMinutes || 120;
    const mustChangePassword = result.mustChangePassword || false;
    const privacyConsentRequired = result.privacyConsentRequired || false;
    localStorage.setItem(
      'medapp_sessionTimeoutMinutes',
      sessionTimeoutMinutes.toString()
    );
    dispatch({
      type: AUTH_ACTIONS.LOGIN_SUCCESS,
      payload: {
        user,
        sessionTimeoutMinutes,
        mustChangePassword,
        privacyConsentRequired,
      },
    });
    notifySuccess('notifications:toasts.auth.loginSuccess');
    return {
      success: true,
      user,
      isFirstLogin: isFirstLogin(user.username),
      mustChangePassword,
      privacyConsentRequired,
    };
  };

  // Auth Actions - handles both username/password credentials and SSO user object.
  const login = async (credentialsOrUser, ssoFlag = null) => {
    try {
      // Interactive login has its own page-level busy state. Reusing the
      // provider's bootstrap loading flag unmounts PublicRoute while an
      // administrator MFA challenge is being prepared, which discards the
      // enrollment screen before it can render.
      dispatch({ type: AUTH_ACTIONS.CLEAR_ERROR });

      const isSSO =
        ssoFlag !== null &&
        typeof credentialsOrUser === 'object' &&
        credentialsOrUser.username;
      let result;
      if (isSSO) {
        result = {
          success: true,
          user: {
            ...credentialsOrUser,
            isAdmin: isAdminRole(credentialsOrUser.role),
          },
          sessionTimeoutMinutes: 120,
          mustChangePassword: false,
          privacyConsentRequired:
            credentialsOrUser.privacy_consent_required === true,
        };
      } else {
        result = await authService.login(credentialsOrUser);
      }

      if (!result.success) {
        dispatch({
          type: AUTH_ACTIONS.LOGIN_FAILURE,
          payload: result.error || 'Login failed',
        });
        return { success: false, error: result.error };
      }
      if (result.authenticationPending) {
        dispatch({ type: AUTH_ACTIONS.SET_LOADING, payload: false });
        return result;
      }

      logger.info('Authentication factors completed', {
        category: isSSO ? 'auth_sso_login' : 'auth_regular_login',
        username: result.user.username,
        userId: result.user.id,
        role: result.user.role,
      });
      return finalizeAuthenticatedResult(result);
    } catch (error) {
      const errorMessage = error.message || 'Login failed';
      dispatch({
        type: AUTH_ACTIONS.LOGIN_FAILURE,
        payload: errorMessage,
      });
      notifyInfo('notifications:toasts.auth.loginFailed');
      return { success: false, error: errorMessage };
    }
  };

  const setupAdminTotp = challengeToken =>
    authService.setupAdminTotp(challengeToken);

  const completeAdminMfa = async ({
    challengeToken,
    code,
    method = 'totp',
    enrollment = false,
  }) => {
    dispatch({ type: AUTH_ACTIONS.CLEAR_ERROR });
    const result = enrollment
      ? await authService.confirmAdminTotp(challengeToken, code)
      : await authService.verifyAdminMfa(challengeToken, code, method);
    if (!result.success) {
      dispatch({ type: AUTH_ACTIONS.SET_ERROR, payload: result.error });
      return result;
    }
    // During first enrollment, keep the UI on the recovery-code screen.
    // The cookie already exists, but context/navigation is finalized only
    // after the administrator confirms the codes were saved.
    if (result.recoveryCodes?.length) {
      return { ...result, authenticationPending: true };
    }
    return { ...result, ...finalizeAuthenticatedResult(result) };
  };

  const acceptAdminMfaSession = result => finalizeAuthenticatedResult(result);

  const logout = async () => {
    try {
      // Call backend logout to clear the HttpOnly cookie
      await authService.logout();
    } catch (error) {
      logger.error('auth_context_logout_error', {
        message: 'Logout API call failed',
        error: error.message,
        stack: error.stack,
        isAuthenticated: state.isAuthenticated,
        userId: state.user?.id,
        timestamp: new Date().toISOString(),
      });
    } finally {
      // Clear auth data first
      clearAuthData();

      // Dispatch logout action to update state
      dispatch({ type: AUTH_ACTIONS.LOGOUT });

      notifyInfo('notifications:toasts.auth.logoutSuccess');
    }
  };

  const updateActivity = () => {
    try {
      const now = Date.now();
      const timeSinceLastUpdate = now - state.lastActivity;

      if (timeSinceLastUpdate < 5000) {
        return;
      }

      dispatch({ type: AUTH_ACTIONS.UPDATE_ACTIVITY });

      // Log activity update in development mode only
      if (env.DEV) {
        secureActivityLogger.logActivityDetected({
          component: 'AuthContext',
          action: 'activity_updated',
          timeSinceLastUpdate,
        });
      }
    } catch (error) {
      secureActivityLogger.logActivityError(error, {
        component: 'AuthContext',
        action: 'updateActivity',
      });

      // Don't throw the error to prevent breaking the app
      logger.error('Failed to update activity', {
        error: error.message,
        category: 'auth_context_error',
      });
    }
  };

  const clearError = () => {
    dispatch({ type: AUTH_ACTIONS.CLEAR_ERROR });
  };

  const clearMustChangePassword = () => {
    dispatch({ type: AUTH_ACTIONS.CLEAR_MUST_CHANGE_PASSWORD });
  };

  const clearPrivacyConsentRequired = () => {
    dispatch({ type: AUTH_ACTIONS.CLEAR_PRIVACY_CONSENT_REQUIRED });
  };

  // Check if user has specific role
  const hasRole = role => {
    return state.user?.role === role || state.user?.roles?.includes(role);
  };

  // Check if user has any of the specified roles
  const hasAnyRole = roles => {
    if (!state.user) return false;
    if (state.user.role && roles.includes(state.user.role)) return true;
    if (state.user.roles) {
      return roles.some(role => state.user.roles.includes(role));
    }
    return false;
  };

  const updateSessionTimeout = timeoutMinutes => {
    localStorage.setItem(
      'medapp_sessionTimeoutMinutes',
      timeoutMinutes.toString()
    );
    dispatch({
      type: AUTH_ACTIONS.UPDATE_SESSION_TIMEOUT,
      payload: timeoutMinutes,
    });
  };

  const contextValue = {
    // State
    user: state.user,
    isAuthenticated: state.isAuthenticated,
    isLoading: state.isLoading,
    error: state.error,
    sessionTimeoutMinutes: state.sessionTimeoutMinutes,
    mustChangePassword: state.mustChangePassword,
    privacyConsentRequired: state.privacyConsentRequired,

    // Actions
    login,
    setupAdminTotp,
    completeAdminMfa,
    acceptAdminMfaSession,
    logout,
    updateActivity,
    clearError,
    clearMustChangePassword,
    clearPrivacyConsentRequired,
    updateUser,
    updateSessionTimeout,

    // Utilities
    hasRole,
    hasAnyRole,
    shouldShowProfilePrompts,
    checkIsFirstLogin,
  };

  return (
    <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
  );
}

// Custom hook to use auth context
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;
