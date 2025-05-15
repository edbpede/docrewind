/**
 * Type declarations for test files
 */

// Declare global variables for tests
declare global {
  // Allow any properties on global
  interface Window {
    chrome: any;
    browser: any;
  }

  var chrome: any;
  var browser: any;
  var global: typeof globalThis;
}

// Export as a module
export {};
