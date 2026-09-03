import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'fs';
import path from 'path';

// The service worker has to cache the built bundle by name, and the names are
// content-hashed — so the list can only be written after the build.
//
// Without this the worker caches the page shell and nothing else: the JS and
// CSS are requested before the worker is controlling anything, so they never
// pass through its fetch handler and are never stored. The app then opens
// offline to a blank page, which is worse than not opening at all. A suite
// caught exactly that.
const precacheServiceWorker = () => ({
  name: 'precache-service-worker',
  closeBundle() {
    const dist = path.resolve('dist');
    const sw = path.join(dist, 'sw.js');
    if (!fs.existsSync(sw)) return;
    const assets = fs
      .readdirSync(path.join(dist, 'assets'))
      .map((f) => './assets/' + f);
    const shell = ['./', './index.html', './manifest.webmanifest', './favicon.svg',
                   './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
    fs.writeFileSync(
      sw,
      fs.readFileSync(sw, 'utf8').replace('__PRECACHE__', JSON.stringify([...shell, ...assets], null, 2))
    );
  },
});

export default defineConfig({
  // Relative asset paths. On GitHub Pages the app is served from
  // /Workouts/, not from the domain root, and an absolute /assets/... would
  // 404 there. The artifact build inlines everything and does not care either
  // way, so one setting serves both.
  base: './',
  plugins: [react(), tailwindcss(), precacheServiceWorker()],
});
