/**
 * Entry point for the React UI
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// Mount the React app
const container = document.getElementById('root');

if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} else {
  console.error('Root element not found');
}
