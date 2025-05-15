/**
 * Helper functions for browser storage
 * Provides a unified API for Chrome and Firefox extensions
 */

/**
 * Check if the browser is Firefox (has browser namespace)
 */
export const isFirefox = (): boolean => {
  return typeof browser !== 'undefined';
};

/**
 * Get the appropriate storage API based on the browser
 */
export const getStorageAPI = () => {
  return isFirefox() ? browser.storage : chrome.storage;
};

/**
 * Get data from browser local storage
 * @param keys - The keys to retrieve
 * @returns A promise that resolves with the retrieved data
 */
export const getFromStorage = async <T>(keys: string | string[] | null): Promise<T> => {
  const storage = getStorageAPI();

  if (isFirefox()) {
    return storage.local.get(keys) as Promise<T>;
  } else {
    return new Promise((resolve, reject) => {
      storage.local.get(keys, (result: { [key: string]: any }) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result as T);
        }
      });
    });
  }
};

/**
 * Save data to browser local storage
 * @param items - The items to save
 * @returns A promise that resolves when the data is saved
 */
export const saveToStorage = async (items: Record<string, any>): Promise<void> => {
  const storage = getStorageAPI();

  if (isFirefox()) {
    return storage.local.set(items);
  } else {
    return new Promise((resolve, reject) => {
      storage.local.set(items, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }
};

/**
 * Remove data from browser local storage
 * @param keys - The keys to remove
 * @returns A promise that resolves when the data is removed
 */
export const removeFromStorage = async (keys: string | string[]): Promise<void> => {
  const storage = getStorageAPI();

  if (isFirefox()) {
    return storage.local.remove(keys);
  } else {
    return new Promise((resolve, reject) => {
      storage.local.remove(keys, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }
};

/**
 * Clear all data from browser local storage
 * @returns A promise that resolves when the data is cleared
 */
export const clearStorage = async (): Promise<void> => {
  const storage = getStorageAPI();

  if (isFirefox()) {
    return storage.local.clear();
  } else {
    return new Promise((resolve, reject) => {
      storage.local.clear(() => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }
};
