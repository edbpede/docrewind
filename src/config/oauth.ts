/**
 * OAuth configuration for the DocRewind extension
 * Contains the client ID and other OAuth-related settings
 */

// Get the client ID from environment variables or use a fallback for production builds
// In development, this comes from the .env file
// In production, this should be set during the build process
export const CLIENT_ID = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID || 'YOUR_GOOGLE_OAUTH_CLIENT_ID';

// Log a warning if the client ID is not set
if (CLIENT_ID === 'YOUR_GOOGLE_OAUTH_CLIENT_ID') {
  console.warn(
    'OAuth Client ID not configured. Please set VITE_GOOGLE_OAUTH_CLIENT_ID in your .env file ' +
    'or replace the placeholder in src/config/oauth.ts for production builds.'
  );
}

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
