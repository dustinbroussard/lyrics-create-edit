# LyricSmith

## Progressive Web App

LyricSmith is a fully installable PWA with offline support powered by a service worker.

### Test installability

1. Serve the project over HTTPS (e.g. `npx http-server -p 8080`).
2. Open the site in Chrome and visit **Application → Manifest** in DevTools to verify install readiness.
3. Use the built in install banner or Chrome's install option to add the app to your device.

### Generate an Android APK with Bubblewrap

1. Install Bubblewrap globally: `npm i -g @bubblewrap/cli`.
2. Initialize: `bubblewrap init --manifest https://your-domain/manifest.webmanifest`.
3. Build the project: `bubblewrap build`.
4. Sign and install the generated APK on your device.

# lyrics-create-edit
