import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// [MIGRATION] Apply saved dark mode before first render to prevent FOUC.
// Legacy Index.html stored the preference under 'theme' = 'dark'/'light'.
// New SPA uses 'billfree_darkMode' = 'true'/'false'. Migrate the legacy key
// so existing users keep their preference on first load of the new build.
const legacyTheme = localStorage.getItem('theme');
if (legacyTheme && localStorage.getItem('billfree_darkMode') === null) {
  localStorage.setItem('billfree_darkMode', String(legacyTheme === 'dark'));
}

const saved = localStorage.getItem('billfree_darkMode');
const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
if (saved === 'true' || (saved === null && prefersDark)) {
  document.documentElement.setAttribute('data-theme', 'dark');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
