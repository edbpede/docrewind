/**
 * Constants used throughout the DocRewind extension
 */

// OAuth Constants
export const OAUTH = {
  // Google OAuth endpoints
  AUTH_ENDPOINT: 'https://accounts.google.com/o/oauth2/auth',
  TOKEN_ENDPOINT: 'https://oauth2.googleapis.com/token',
  REVOKE_ENDPOINT: 'https://oauth2.googleapis.com/revoke',
  
  // Required scopes for accessing Google Docs
  SCOPES: [
    'https://www.googleapis.com/auth/documents.readonly', // Read-only access to Google Docs
    'https://www.googleapis.com/auth/drive.metadata.readonly', // Read-only access to file metadata
  ],
  
  // Redirect URL for the extension (will be set dynamically based on extension ID)
  REDIRECT_URL: '',
  
  // Client ID (to be set from environment or config)
  CLIENT_ID: '',
  
  // Storage keys
  STORAGE_KEY: 'auth_token',
  
  // Response type for OAuth flow
  RESPONSE_TYPE: 'code',
  
  // Grant type for token exchange
  GRANT_TYPE: 'authorization_code',
  
  // Grant type for token refresh
  REFRESH_GRANT_TYPE: 'refresh_token',
  
  // Access type (offline to get refresh token)
  ACCESS_TYPE: 'offline',
  
  // Prompt for consent
  PROMPT: 'consent',
};

// Google API endpoints
export const API = {
  // Google Docs API
  DOCS_API: 'https://docs.googleapis.com/v1/documents',
  
  // Google Drive API
  DRIVE_API: 'https://www.googleapis.com/drive/v3',
};

// Storage constants
export const STORAGE = {
  // Local storage keys
  AUTH_TOKEN: 'auth_token',
  USER_PREFERENCES: 'user_preferences',
};

// Extension constants
export const EXTENSION = {
  // Extension name
  NAME: 'DocRewind',
  
  // Extension version (should match manifest)
  VERSION: '0.1.0',
};

// Error messages
export const ERRORS = {
  // Auth errors
  AUTH_INITIALIZATION_FAILED: 'Failed to initialize authentication',
  AUTH_FLOW_FAILED: 'Authentication flow failed',
  NO_AUTH_CODE: 'No auth code found in redirect URL',
  TOKEN_EXCHANGE_FAILED: 'Failed to exchange authorization code for tokens',
  TOKEN_REFRESH_FAILED: 'Failed to refresh access token',
  NO_AUTH_TOKEN: 'No authentication token found',
  
  // Storage errors
  STORAGE_ERROR: 'Error accessing browser storage',
  
  // API errors
  API_REQUEST_FAILED: 'API request failed',
};
