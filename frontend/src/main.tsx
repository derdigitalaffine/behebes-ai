import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fortawesome/fontawesome-free/css/all.min.css';
import RootApp from './App';
import { I18nProvider } from './i18n/I18nProvider';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);

root.render(
  <React.StrictMode>
    <I18nProvider>
      <RootApp />
    </I18nProvider>
  </React.StrictMode>
);
