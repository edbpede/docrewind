/**
 * Type declarations for browser extension APIs
 * This file provides TypeScript type definitions for Chrome and Firefox extension APIs
 */

// Message sender interface
interface MessageSender {
  tab?: {
    id: number;
    url?: string;
    title?: string;
    favIconUrl?: string;
  };
  frameId?: number;
  id?: string;
  url?: string;
  origin?: string;
}

// Chrome extension API
interface Chrome {
  runtime: {
    id: string;
    lastError: { message: string } | null;
    getManifest(): {
      oauth2?: {
        client_id: string;
      };
      [key: string]: any;
    };
    sendMessage(message: any, responseCallback?: (response: any) => void): void;
    onMessage: {
      addListener(callback: (message: any, sender: MessageSender, sendResponse: (response?: any) => void) => void): void;
      removeListener(callback: (message: any, sender: MessageSender, sendResponse: (response?: any) => void) => void): void;
    };
    MessageSender: MessageSender;
  };

  identity: {
    getRedirectURL(): string;
    launchWebAuthFlow(options: {
      url: string;
      interactive: boolean;
    }, callback: (responseUrl?: string) => void): void;
    getAuthToken(options: {
      interactive: boolean;
      scopes?: string[];
    }, callback: (token?: string) => void): void;
    removeCachedAuthToken(options: {
      token: string;
    }, callback?: () => void): void;
  };

  storage: {
    local: {
      get(keys: string | string[] | null, callback?: (items: { [key: string]: any }) => void): Promise<{ [key: string]: any }>;
      set(items: { [key: string]: any }, callback?: () => void): Promise<void>;
      remove(keys: string | string[], callback?: () => void): Promise<void>;
      clear(callback?: () => void): Promise<void>;
    };
  };
}

// Add namespace for MessageSender
declare namespace chrome.runtime {
  interface MessageSender extends MessageSender {}
}

// Firefox extension API
interface Browser {
  runtime: {
    id: string;
    lastError: { message: string } | null;
    getManifest(): {
      oauth2?: {
        client_id: string;
      };
      [key: string]: any;
    };
    sendMessage(message: any, responseCallback?: (response: any) => void): void;
    onMessage: {
      addListener(callback: (message: any, sender: MessageSender, sendResponse: (response?: any) => void) => void): void;
      removeListener(callback: (message: any, sender: MessageSender, sendResponse: (response?: any) => void) => void): void;
    };
    MessageSender: MessageSender;
  };
  identity: {
    getRedirectURL(): string;
    launchWebAuthFlow(options: {
      url: string;
      interactive: boolean;
    }): Promise<string>;
    getAuthToken(options: {
      interactive: boolean;
      scopes?: string[];
    }): Promise<string>;
    removeCachedAuthToken(options: {
      token: string;
    }): Promise<void>;
  };
  storage: {
    local: {
      get(keys: string | string[] | null): Promise<{ [key: string]: any }>;
      set(items: { [key: string]: any }): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
      clear(): Promise<void>;
    };
  };
}

// Declare global variables
declare global {
  const chrome: Chrome;
  const browser: Browser;
}

// Export as a module
export {};
