import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import WorkoutTracker from './WorkoutTracker.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WorkoutTracker />
  </React.StrictMode>
);

// Standalone hosting only. Inside the artifact frame there is no service worker
// to register and no offline story to tell: the host serves the page and the
// record lives in its store.
if ('serviceWorker' in navigator && !window.claude) {
  window.addEventListener('load', () => {
    // Relative to the page, because the app is served from a project
    // subdirectory on Pages and a worker scoped to / would be rejected.
    navigator.serviceWorker.register(new URL('sw.js', document.baseURI)).catch(() => {
      // No worker means no offline. The app still runs; it just needs signal to
      // open. Nothing here is worth interrupting the lifter for.
    });
  });

  // Ask the browser to keep this data through storage pressure. Until there is
  // a backend, what is on the phone IS the record — Safari evicts ordinary
  // site data for sites left unused, and an installed app that has quietly
  // forgotten a month of training is worse than one that never worked.
  //
  // Best-effort by design: it is granted on installed apps and often declined
  // in a plain tab, and there is nothing useful to say to the lifter either
  // way. The backup nudge on Profile is what actually covers this.
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
}
