import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  initializeAuth,
  startAuthFlow,
  handleAuthRedirect,
  getAuthToken,
  refreshAuthToken,
  clearAuthData
} from '@/core/auth';

// Mock browser APIs
const mockChrome = {
  runtime: {
    lastError: null,
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn()
    },
    id: 'test-extension-id'
  },
  identity: {
    launchWebAuthFlow: vi.fn(),
    getRedirectURL: vi.fn().mockReturnValue('https://test-extension-id.chromiumapp.org/')
  },
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn()
    }
  }
};

const mockBrowser = {
  runtime: {
    lastError: null,
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn()
    },
    id: 'test-extension-id'
  },
  identity: {
    launchWebAuthFlow: vi.fn(),
    getRedirectURL: vi.fn().mockReturnValue('https://test-extension-id.chromiumapp.org/')
  },
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn()
    }
  }
};

// Setup global mocks
vi.stubGlobal('chrome', mockChrome);
vi.stubGlobal('browser', mockBrowser);

describe('Auth Module', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.resetAllMocks();
  });

  afterEach(() => {
    // Clear mocks after each test
    vi.clearAllMocks();
  });

  describe('initializeAuth', () => {
    it('should initialize auth configuration', () => {
      const config = {
        clientId: 'test-client-id',
        scopes: ['https://www.googleapis.com/auth/documents.readonly']
      };

      const result = initializeAuth(config);

      expect(result).toBe(true);
    });
  });

  describe('startAuthFlow', () => {
    beforeEach(() => {
      // Initialize auth before each test
      initializeAuth({
        clientId: 'test-client-id',
        scopes: ['https://www.googleapis.com/auth/documents.readonly']
      });
    });

    it('should launch web auth flow in Chrome', async () => {
      // Setup Chrome mock
      mockChrome.identity.launchWebAuthFlow.mockImplementation((options, callback) => {
        callback('https://example.com/callback?code=test-auth-code');
      });

      // Mock the token exchange
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
          expires_in: 3600
        })
      });

      // Mock storage
      mockChrome.storage.local.set.mockImplementation((data, callback) => {
        callback();
      });

      // Remove browser for this test
      const originalBrowser = global.browser;
      // @ts-ignore
      global.browser = undefined;

      const result = await startAuthFlow();

      expect(mockChrome.identity.launchWebAuthFlow).toHaveBeenCalled();
      expect(result).toBe(true);

      // Restore browser
      global.browser = originalBrowser;
    });

    it('should launch web auth flow in Firefox', async () => {
      // Setup Firefox mock
      mockBrowser.identity.launchWebAuthFlow.mockResolvedValue('https://example.com/callback?code=test-auth-code');

      // Mock the token exchange
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
          expires_in: 3600
        })
      });

      // Mock storage
      mockBrowser.storage.local.set.mockImplementation(() => Promise.resolve());

      // Make sure we're using the Firefox API
      const originalChrome = global.chrome;
      // @ts-ignore - We want to force using the Firefox API path
      global.chrome = undefined;

      const result = await startAuthFlow();

      expect(mockBrowser.identity.launchWebAuthFlow).toHaveBeenCalled();
      expect(result).toBe(true);

      // Restore Chrome
      global.chrome = originalChrome;
    });

    it('should handle auth flow errors', async () => {
      // Setup error in Chrome
      mockChrome.identity.launchWebAuthFlow.mockImplementation((options, callback) => {
        mockChrome.runtime.lastError = { message: 'Auth flow error' };
        callback(undefined);
      });

      // Remove browser for this test
      const originalBrowser = global.browser;
      // @ts-ignore
      global.browser = undefined;

      await expect(startAuthFlow()).rejects.toThrow('Auth flow error');

      // Restore browser and clear lastError
      global.browser = originalBrowser;
      mockChrome.runtime.lastError = null;
    });
  });

  describe('handleAuthRedirect', () => {
    it('should extract auth code from redirect URL', () => {
      const redirectUrl = 'https://example.com/callback?code=test-auth-code';

      const result = handleAuthRedirect(redirectUrl);

      expect(result).toBe('test-auth-code');
    });

    it('should handle redirect URL without code', () => {
      const redirectUrl = 'https://example.com/callback';

      expect(() => handleAuthRedirect(redirectUrl)).toThrow('No auth code found in redirect URL');
    });
  });

  describe('getAuthToken', () => {
    it('should return token from storage in Chrome', async () => {
      // Setup Chrome storage mock
      mockChrome.storage.local.get.mockImplementation((keys, callback) => {
        callback({
          'auth_token': {
            access_token: 'test-access-token',
            refresh_token: 'test-refresh-token',
            expiry_time: Date.now() + 3600000 // 1 hour in the future
          }
        });
      });

      // Remove browser for this test
      const originalBrowser = global.browser;
      // @ts-ignore
      global.browser = undefined;

      const token = await getAuthToken();

      expect(mockChrome.storage.local.get).toHaveBeenCalledWith(['auth_token'], expect.any(Function));
      expect(token).toEqual({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expiry_time: expect.any(Number)
      });

      // Restore browser
      global.browser = originalBrowser;
    });

    it('should return token from storage in Firefox', async () => {
      // Setup Firefox storage mock
      const mockData = {
        'auth_token': {
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
          expiry_time: Date.now() + 3600000 // 1 hour in the future
        }
      };

      // Use mockImplementation instead of mockResolvedValue
      mockBrowser.storage.local.get.mockImplementation(() => Promise.resolve(mockData));

      // Make sure we're using the Firefox API
      const originalChrome = global.chrome;
      // @ts-ignore - We want to force using the Firefox API path
      global.chrome = undefined;

      const token = await getAuthToken();

      expect(mockBrowser.storage.local.get).toHaveBeenCalledWith(['auth_token']);
      expect(token).toEqual({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expiry_time: expect.any(Number)
      });

      // Restore Chrome
      global.chrome = originalChrome;
    });
  });

  describe('refreshAuthToken', () => {
    it('should refresh expired token', async () => {
      // Mock implementation will be added when we implement the actual function
      // This is a placeholder test
      expect(refreshAuthToken).toBeDefined();
    });
  });

  describe('clearAuthData', () => {
    it('should clear auth data from storage in Chrome', async () => {
      // Setup Chrome storage mock
      mockChrome.storage.local.remove.mockImplementation((keys, callback) => {
        callback();
      });

      // Remove browser for this test
      const originalBrowser = global.browser;
      // @ts-ignore
      global.browser = undefined;

      await clearAuthData();

      expect(mockChrome.storage.local.remove).toHaveBeenCalledWith(['auth_token'], expect.any(Function));

      // Restore browser
      global.browser = originalBrowser;
    });

    it('should clear auth data from storage in Firefox', async () => {
      // Setup Firefox storage mock
      mockBrowser.storage.local.remove.mockImplementation(() => Promise.resolve());

      // Make sure we're using the Firefox API
      const originalChrome = global.chrome;
      // @ts-ignore - We want to force using the Firefox API path
      global.chrome = undefined;

      await clearAuthData();

      expect(mockBrowser.storage.local.remove).toHaveBeenCalledWith(['auth_token']);

      // Restore Chrome
      global.chrome = originalChrome;
    });
  });
});
