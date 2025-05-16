/**
 * OAuth configuration for the DocRewind extension
 * Contains the client ID and other OAuth-related settings
 */

// The client ID for the Google OAuth application
// This should be replaced with your actual client ID from the Google Cloud Console
export const CLIENT_ID = 'YOUR_GOOGLE_OAUTH_CLIENT_ID';

// OAuth scopes required for the application
export const SCOPES = [
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
];

// OAuth configuration for Chrome extension
export const OAUTH_CONFIG = {
  client_id: CLIENT_ID,
  scopes: SCOPES,
};
