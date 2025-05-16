/**
 * Background script for the DocRewind extension
 * Handles OAuth redirects and manages extension state
 */

import { initializeAuth, startAuthFlow, isAuthenticated, logout } from '@/core/auth';
import logger from '@/utils/logger';
import { CLIENT_ID, SCOPES } from '@/config/oauth';

// Module name for logging
const MODULE_NAME = 'Background';

// Initialize the extension
const initialize = async () => {
  logger.info(MODULE_NAME, 'Initializing background script');

  // Get the client ID from our config
  const clientId = CLIENT_ID;

  if (!clientId || clientId === 'YOUR_GOOGLE_OAUTH_CLIENT_ID') {
    logger.error(MODULE_NAME, 'Client ID not configured in config/oauth.ts');
    return;
  }

  // Initialize auth with the client ID and scopes
  const authInitialized = initializeAuth({
    clientId,
    scopes: SCOPES,
  });

  if (!authInitialized) {
    logger.error(MODULE_NAME, 'Failed to initialize auth');
    return;
  }

  logger.info(MODULE_NAME, 'Background script initialized');
};

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((
  message: { type: string; [key: string]: any },
  sender: any, // Use any type to avoid namespace issues
  sendResponse: (response: any) => void
) => {
  logger.debug(MODULE_NAME, 'Received message', { message, sender });

  // Handle different message types
  switch (message.type) {
    case 'AUTH_START':
      handleAuthStart(sendResponse);
      return true; // Keep the message channel open for async response

    case 'AUTH_CHECK':
      handleAuthCheck(sendResponse);
      return true; // Keep the message channel open for async response

    case 'AUTH_LOGOUT':
      handleAuthLogout(sendResponse);
      return true; // Keep the message channel open for async response

    default:
      logger.warn(MODULE_NAME, 'Unknown message type', message.type);
      sendResponse({ success: false, error: 'Unknown message type' });
      return false;
  }
});

/**
 * Handle auth start message
 * @param sendResponse - Function to send response back to sender
 */
const handleAuthStart = async (sendResponse: (response: any) => void) => {
  try {
    logger.info(MODULE_NAME, 'Starting auth flow');
    await startAuthFlow();
    sendResponse({ success: true });
  } catch (error) {
    logger.error(MODULE_NAME, 'Auth flow failed', error);
    sendResponse({ success: false, error: (error as Error).message });
  }
};

/**
 * Handle auth check message
 * @param sendResponse - Function to send response back to sender
 */
const handleAuthCheck = async (sendResponse: (response: any) => void) => {
  try {
    const authenticated = await isAuthenticated();
    logger.info(MODULE_NAME, 'Auth check', { authenticated });
    sendResponse({ success: true, authenticated });
  } catch (error) {
    logger.error(MODULE_NAME, 'Auth check failed', error);
    sendResponse({ success: false, error: (error as Error).message });
  }
};

/**
 * Handle auth logout message
 * @param sendResponse - Function to send response back to sender
 */
const handleAuthLogout = async (sendResponse: (response: any) => void) => {
  try {
    logger.info(MODULE_NAME, 'Logging out user');
    const success = await logout();
    sendResponse({ success });
  } catch (error) {
    logger.error(MODULE_NAME, 'Logout failed', error);
    sendResponse({ success: false, error: (error as Error).message });
  }
};

// Initialize the extension when the background script loads
initialize();
