# Google OAuth Setup for DocRewind

This document provides instructions for setting up Google OAuth for the DocRewind extension.

## Creating a Google OAuth Client ID

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Navigate to "APIs & Services" > "Credentials"
4. Click "Create Credentials" and select "OAuth client ID"
5. Select "Chrome App" as the application type
6. Enter a name for your OAuth client (e.g., "DocRewind Extension")
7. For Chrome extensions, enter your extension's ID in the "Application ID" field
   - If you're developing locally, you can find your extension ID in Chrome by going to `chrome://extensions/` and enabling Developer Mode
   - For production, you'll need to use the ID assigned by the Chrome Web Store
8. Click "Create"

## Configuring the Extension

1. Copy the generated Client ID
2. Open `src/config/oauth.ts` in the DocRewind project
3. Replace `YOUR_GOOGLE_OAUTH_CLIENT_ID` with your actual Client ID:

```typescript
export const CLIENT_ID = 'your-client-id-here';
```

4. Save the file and rebuild the extension

## Required OAuth Scopes

The extension requires the following OAuth scopes:

- `https://www.googleapis.com/auth/documents.readonly` - For read-only access to Google Docs
- `https://www.googleapis.com/auth/drive.metadata.readonly` - For read-only access to file metadata

These scopes are already configured in the extension code.

## Testing the OAuth Flow

1. Build the extension with `npm run build`
2. Load the extension in Chrome from the `dist` directory
3. Click the extension icon to open the popup
4. Click "Login with Google"
5. Follow the Google authentication prompts
6. After successful authentication, you should see the authenticated state in the extension popup

## Publishing Considerations

When publishing the extension to the Chrome Web Store:

1. Make sure to update the Client ID in `src/config/oauth.ts` with the production Client ID
2. In the Google Cloud Console, add the Chrome Web Store extension ID to the OAuth client configuration
3. Ensure the OAuth consent screen is properly configured with the required information
4. If you plan to publish the extension publicly, you may need to go through Google's OAuth verification process

## Troubleshooting

If you encounter authentication issues:

1. Check the browser console for error messages
2. Verify that the Client ID is correctly set in `src/config/oauth.ts`
3. Ensure the extension ID is correctly configured in the Google Cloud Console
4. Check that the required OAuth scopes are properly configured
5. Try clearing the extension's storage and authenticating again

For more information, refer to the [Chrome Identity API documentation](https://developer.chrome.com/docs/extensions/reference/identity/).
