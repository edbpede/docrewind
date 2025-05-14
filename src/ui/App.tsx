/**
 * Main App component
 */

import React, { useEffect, useState } from 'react';

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check authentication status when the component mounts
    checkAuthStatus();
  }, []);

  /**
   * Check if the user is authenticated
   */
  const checkAuthStatus = async () => {
    try {
      setIsLoading(true);
      const response = await sendMessageToBackground({ type: 'AUTH_CHECK' });
      
      if (!response.success) {
        throw new Error(response.error || 'Unknown error');
      }
      
      setIsAuthenticated(response.authenticated);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Start the authentication flow
   */
  const handleLogin = async () => {
    try {
      setIsLoading(true);
      const response = await sendMessageToBackground({ type: 'AUTH_START' });
      
      if (!response.success) {
        throw new Error(response.error || 'Authentication failed');
      }
      
      // Check auth status again after login
      await checkAuthStatus();
    } catch (error) {
      setError((error as Error).message);
      setIsLoading(false);
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

  // Show loading state
  if (isLoading) {
    return (
      <div className="p-4">
        <p>Loading...</p>
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className="p-4">
        <p className="text-red-500">Error: {error}</p>
        <button 
          className="mt-2 px-4 py-2 bg-blue-500 text-white rounded"
          onClick={() => setError(null)}
        >
          Dismiss
        </button>
      </div>
    );
  }

  // Show authenticated state
  if (isAuthenticated) {
    return (
      <div className="p-4">
        <h1 className="text-xl font-bold">DocRewind</h1>
        <p className="mt-2">You are authenticated!</p>
        <p className="mt-2">Open a Google Doc to use DocRewind.</p>
      </div>
    );
  }

  // Show login state
  return (
    <div className="p-4">
      <h1 className="text-xl font-bold">DocRewind</h1>
      <p className="mt-2">Please log in to use DocRewind.</p>
      <button 
        className="mt-4 px-4 py-2 bg-blue-500 text-white rounded"
        onClick={handleLogin}
      >
        Login with Google
      </button>
    </div>
  );
};

export default App;
