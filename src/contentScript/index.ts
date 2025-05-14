/**
 * Content script for the DocRewind extension
 * Injects UI and interacts with Google Docs pages
 */

import logger from '@/utils/logger';

// Module name for logging
const MODULE_NAME = 'ContentScript';

// Initialize the content script
const initialize = async () => {
  logger.info(MODULE_NAME, 'Initializing content script');
  
  // Check if we're on a Google Docs page
  if (!isGoogleDocsPage()) {
    logger.info(MODULE_NAME, 'Not a Google Docs page, exiting');
    return;
  }
  
  // Check if the user is authenticated
  const authStatus = await checkAuthStatus();
  
  if (!authStatus.authenticated) {
    logger.info(MODULE_NAME, 'User not authenticated');
    // We'll handle this in the UI later
  }
  
  // TODO: Initialize UI components
  
  logger.info(MODULE_NAME, 'Content script initialized');
};

/**
 * Check if the current page is a Google Docs page
 * @returns True if the current page is a Google Docs page
 */
const isGoogleDocsPage = (): boolean => {
  return window.location.hostname === 'docs.google.com' && 
         window.location.pathname.startsWith('/document/d/');
};

/**
 * Check if the user is authenticated
 * @returns Object with authentication status
 */
const checkAuthStatus = async (): Promise<{ authenticated: boolean; error?: string }> => {
  try {
    const response = await sendMessageToBackground({ type: 'AUTH_CHECK' });
    
    if (!response.success) {
      throw new Error(response.error || 'Unknown error');
    }
    
    return { authenticated: response.authenticated };
  } catch (error) {
    logger.error(MODULE_NAME, 'Failed to check auth status', error);
    return { authenticated: false, error: (error as Error).message };
  }
};

/**
 * Send a message to the background script
 * @param message - The message to send
 * @returns Promise that resolves with the response
 */
const sendMessageToBackground = (message: any): Promise<any> => {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
};

// Initialize the content script when the page loads
initialize();
