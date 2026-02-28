import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fortawesome/fontawesome-free/css/all.min.css';
import App from './App';
import './index.css';

// Ensure existing root-scope service workers pick up latest rules (important for /admin reload behavior).
if ('serviceWorker' in navigator) {
  const triggerActivation = (registration: ServiceWorkerRegistration | undefined) => {
    if (!registration?.waiting) return;
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  };

  let controllerChangeHandled = false;
  const handleControllerChange = () => {
    if (controllerChangeHandled) return;
    controllerChangeHandled = true;
    window.location.reload();
  };

  navigator.serviceWorker
    .getRegistration('/')
    .then((registration) => {
      if (!registration) return;

      navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

      triggerActivation(registration);
      registration.update().catch(() => undefined);

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            triggerActivation(registration);
          }
        });
      });
    })
    .catch(() => undefined);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
