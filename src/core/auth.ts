/**
 * Authentication module for Google OAuth
 * Handles the OAuth flow, token management, and storage
 */

import { OAUTH, ERRORS } from '@/utils/constants';
import { getFromStorage, saveToStorage, removeFromStorage } from '@/utils/storageHelper';
import logger from '@/utils/logger';

// Module name for logging
const MODULE_NAME = 'Auth';

// Auth configuration
interface AuthConfig {
  clientId: string;
  scopes: string[];
  redirectUrl?: string;
}

// Auth token interface
export interface AuthToken {
  access_token: string;
  refresh_token: string;
  expiry_time: number;
  token_type?: string;
  id_token?: string;
}

// Global auth configuration
let authConfig: AuthConfig | null = null;

/**
 * Initialize the auth module with configuration
 * @param config - The auth configuration
 * @returns True if initialization was successful
 */
export const initializeAuth = (config: AuthConfig): boolean => {
  try {
    // Use the provided redirectUrl or generate a default one
    const redirectUrl = config.redirectUrl ||
      (typeof chrome !== 'undefined' && chrome.identity && chrome.identity.getRedirectURL ?
        chrome.identity.getRedirectURL() :
        `https://${chrome.runtime.id}.chromiumapp.org/`);

    authConfig = {
      ...config,
      redirectUrl
    };

    // Update OAuth constants with config values
    OAUTH.CLIENT_ID = config.clientId;
    OAUTH.REDIRECT_URL = authConfig.redirectUrl || '';

    logger.info(MODULE_NAME, 'Auth initialized with config', authConfig);
    return true;
  } catch (error) {
    logger.error(MODULE_NAME, ERRORS.AUTH_INITIALIZATION_FAILED, error);
    return false;
  }
};

/**
 * Get the auth configuration
 * @returns The current auth configuration
 * @throws Error if auth is not initialized
 */
export const getAuthConfig = (): AuthConfig => {
  if (!authConfig) {
    throw new Error(ERRORS.AUTH_INITIALIZATION_FAILED);
  }
  return authConfig;
};

/**
 * Start the OAuth flow
 * @returns A promise that resolves when the flow is complete
 */
export const startAuthFlow = async (): Promise<boolean> => {
  try {
    const config = getAuthConfig();

    // Build the auth URL
    const authUrl = new URL(OAUTH.AUTH_ENDPOINT);
    authUrl.searchParams.append('client_id', config.clientId);
    authUrl.searchParams.append('redirect_uri', config.redirectUrl || '');
    authUrl.searchParams.append('response_type', OAUTH.RESPONSE_TYPE);
    authUrl.searchParams.append('scope', config.scopes.join(' '));
    authUrl.searchParams.append('access_type', OAUTH.ACCESS_TYPE);
    authUrl.searchParams.append('prompt', OAUTH.PROMPT);

    logger.debug(MODULE_NAME, 'Starting auth flow with URL', authUrl.toString());

    // Launch the web auth flow
    let redirectUrl: string;

    if (typeof browser !== 'undefined') {
      // Firefox
      redirectUrl = await browser.identity.launchWebAuthFlow({
        url: authUrl.toString(),
        interactive: true
      });
    } else {
      // Chrome
      redirectUrl = await new Promise<string>((resolve, reject) => {
        chrome.identity.launchWebAuthFlow({
          url: authUrl.toString(),
          interactive: true
        }, (responseUrl?: string) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (!responseUrl) {
            reject(new Error(ERRORS.AUTH_FLOW_FAILED));
          } else {
            resolve(responseUrl);
          }
        });
      });
    }

    // Handle the redirect URL
    const authCode = handleAuthRedirect(redirectUrl);

    // Exchange the auth code for tokens
    await exchangeCodeForTokens(authCode);

    logger.info(MODULE_NAME, 'Auth flow completed successfully');
    return true;
  } catch (error) {
    logger.error(MODULE_NAME, ERRORS.AUTH_FLOW_FAILED, error);
    throw error;
  }
};

/**
 * Handle the redirect URL from the auth flow
 * @param redirectUrl - The redirect URL
 * @returns The authorization code
 * @throws Error if no auth code is found
 */
export const handleAuthRedirect = (redirectUrl: string): string => {
  try {
    const url = new URL(redirectUrl);
    const authCode = url.searchParams.get('code');

    if (!authCode) {
      throw new Error(ERRORS.NO_AUTH_CODE);
    }

    logger.debug(MODULE_NAME, 'Auth code extracted from redirect URL');
    return authCode;
  } catch (error) {
    logger.error(MODULE_NAME, ERRORS.NO_AUTH_CODE, error);
    throw new Error(ERRORS.NO_AUTH_CODE);
  }
};

/**
 * Exchange an authorization code for access and refresh tokens
 * @param authCode - The authorization code
 * @returns A promise that resolves with the tokens
 */
export const exchangeCodeForTokens = async (authCode: string): Promise<AuthToken> => {
  try {
    const config = getAuthConfig();

    // Build the token request
    const tokenRequest = new URLSearchParams();
    tokenRequest.append('code', authCode);
    tokenRequest.append('client_id', config.clientId);
    tokenRequest.append('redirect_uri', config.redirectUrl || '');
    tokenRequest.append('grant_type', OAUTH.GRANT_TYPE);

    // Make the token request
    const response = await fetch(OAUTH.TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: tokenRequest.toString()
    });

    if (!response.ok) {
      throw new Error(`${ERRORS.TOKEN_EXCHANGE_FAILED}: ${response.status} ${response.statusText}`);
    }

    const tokenData = await response.json();

    // Calculate expiry time
    const expiryTime = Date.now() + (tokenData.expires_in * 1000);

    // Create the auth token
    const authToken: AuthToken = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expiry_time: expiryTime,
      token_type: tokenData.token_type,
      id_token: tokenData.id_token
    };

    // Save the token to storage
    await saveAuthToken(authToken);

    logger.info(MODULE_NAME, 'Successfully exchanged auth code for tokens');
    return authToken;
  } catch (error) {
    logger.error(MODULE_NAME, ERRORS.TOKEN_EXCHANGE_FAILED, error);
    throw error;
  }
};

/**
 * Save the auth token to storage
 * @param token - The auth token to save
 */
export const saveAuthToken = async (token: AuthToken): Promise<void> => {
  try {
    await saveToStorage({ [OAUTH.STORAGE_KEY]: token });
    logger.debug(MODULE_NAME, 'Auth token saved to storage');
  } catch (error) {
    logger.error(MODULE_NAME, 'Failed to save auth token', error);
    throw error;
  }
};

/**
 * Get the current auth token from storage
 * @returns The auth token, or null if not found
 */
export const getAuthToken = async (): Promise<AuthToken | null> => {
  try {
    // Use a type with an index signature for the storage key
    type StorageData = { [key: string]: AuthToken | undefined };
    const data = await getFromStorage<StorageData>([OAUTH.STORAGE_KEY]);
    const token = data[OAUTH.STORAGE_KEY];

    if (!token) {
      logger.debug(MODULE_NAME, 'No auth token found in storage');
      return null;
    }

    // Check if token is expired and needs refresh
    if (token.expiry_time <= Date.now()) {
      logger.debug(MODULE_NAME, 'Auth token is expired, refreshing');
      return refreshAuthToken(token);
    }

    logger.debug(MODULE_NAME, 'Auth token retrieved from storage');
    return token;
  } catch (error) {
    logger.error(MODULE_NAME, 'Failed to get auth token', error);
    return null;
  }
};

/**
 * Refresh an expired auth token
 * @param token - The expired auth token
 * @returns The refreshed auth token
 */
export const refreshAuthToken = async (token: AuthToken): Promise<AuthToken | null> => {
  try {
    if (!token.refresh_token) {
      logger.error(MODULE_NAME, 'No refresh token available');
      return null;
    }

    const config = getAuthConfig();

    // Build the refresh request
    const refreshRequest = new URLSearchParams();
    refreshRequest.append('refresh_token', token.refresh_token);
    refreshRequest.append('client_id', config.clientId);
    refreshRequest.append('grant_type', OAUTH.REFRESH_GRANT_TYPE);

    // Make the refresh request
    const response = await fetch(OAUTH.TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: refreshRequest.toString()
    });

    if (!response.ok) {
      throw new Error(`${ERRORS.TOKEN_REFRESH_FAILED}: ${response.status} ${response.statusText}`);
    }

    const refreshData = await response.json();

    // Calculate new expiry time
    const expiryTime = Date.now() + (refreshData.expires_in * 1000);

    // Create the refreshed auth token
    const refreshedToken: AuthToken = {
      access_token: refreshData.access_token,
      refresh_token: token.refresh_token, // Keep the existing refresh token
      expiry_time: expiryTime,
      token_type: refreshData.token_type,
      id_token: refreshData.id_token
    };

    // Save the refreshed token to storage
    await saveAuthToken(refreshedToken);

    logger.info(MODULE_NAME, 'Successfully refreshed auth token');
    return refreshedToken;
  } catch (error) {
    logger.error(MODULE_NAME, ERRORS.TOKEN_REFRESH_FAILED, error);
    return null;
  }
};

/**
 * Clear all auth data from storage
 */
export const clearAuthData = async (): Promise<void> => {
  try {
    await removeFromStorage([OAUTH.STORAGE_KEY]);
    logger.info(MODULE_NAME, 'Auth data cleared from storage');
  } catch (error) {
    logger.error(MODULE_NAME, 'Failed to clear auth data', error);
    throw error;
  }
};

/**
 * Check if the user is authenticated
 * @returns True if the user is authenticated
 */
export const isAuthenticated = async (): Promise<boolean> => {
  const token = await getAuthToken();
  return !!token;
};
