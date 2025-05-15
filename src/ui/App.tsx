/**
 * Main App component
 */

import React, { useEffect, useState } from 'react';
import DropdownMenu from './components/DropdownMenu';

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
      chrome.runtime.sendMessage(message, (response: any) => {
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
      <div className="p-6 flex justify-center items-center h-full">
        <div className="animate-pulse flex flex-col items-center">
          <div className="h-12 w-12 rounded-full bg-blue-400 mb-4"></div>
          <p className="text-gray-600 font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className="p-6 bg-white rounded-lg shadow-sm">
        <div className="flex items-center justify-center mb-4">
          <div className="bg-red-100 p-2 rounded-full">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>
        <p className="text-red-600 text-center font-medium mb-4">Error: {error}</p>
        <div className="flex justify-center">
          <button
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 transition-colors"
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  // Show authenticated state
  if (isAuthenticated) {
    return (
      <div className="p-6 bg-white rounded-lg shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-800">DocRewind</h1>
          <DropdownMenu
            buttonText="Options"
            items={[
              { label: 'Settings', onClick: () => console.log('Settings clicked') },
              { label: 'Help', onClick: () => console.log('Help clicked') },
              { label: 'Logout', onClick: () => console.log('Logout clicked') }
            ]}
          />
        </div>
        <div className="bg-blue-50 border-l-4 border-blue-500 p-4 mb-6">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-blue-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-blue-700">
                You are authenticated! Open a Google Doc to use DocRewind.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show login state
  return (
    <div className="p-6 bg-white rounded-lg shadow-sm">
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">DocRewind</h1>
        <p className="text-gray-600">Visualize the evolution of your Google Docs</p>
      </div>
      <div className="bg-gray-50 p-4 rounded-lg mb-6">
        <p className="text-sm text-gray-600 mb-4">
          Please log in with your Google account to access document revision history.
        </p>
        <button
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 transition-colors flex items-center justify-center"
          onClick={handleLogin}
        >
          <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M12.24 10.285V14.4h6.806c-.275 1.765-2.056 5.174-6.806 5.174-4.095 0-7.439-3.389-7.439-7.574s3.345-7.574 7.439-7.574c2.33 0 3.891.989 4.785 1.849l3.254-3.138C18.189 1.186 15.479 0 12.24 0c-6.635 0-12 5.365-12 12s5.365 12 12 12c6.926 0 11.52-4.869 11.52-11.726 0-.788-.085-1.39-.189-1.989H12.24z" fill="currentColor"/>
          </svg>
          Login with Google
        </button>
      </div>
    </div>
  );
};

export default App;
