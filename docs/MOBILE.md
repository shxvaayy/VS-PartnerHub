# Mobile applications

VS PartnerHub includes a responsive installable web app and Capacitor projects at `android/` and `ios/`. They load the configured PartnerHub origin, keeping sessions, document access and authorization on the same API used by the web workspace.

## PWA

Serve the production build through HTTPS. A manifest, icons and service worker support installation. Chromium shows **Install PartnerHub** when the browser makes installation available; on iOS use Safari's Add to Home Screen.

The worker caches only the offline page and public icons. It never caches API responses, private documents, personalized pages or transaction data. When offline, navigation explains that a connection is needed. Business writes require an online authorized request.

## Native builds

Build the web app, then sync against your deployed origin:

```sh
npm run build
MOBILE_SERVER_URL=https://your-partnerhub-origin.example npm run mobile:sync
MOBILE_SERVER_URL=https://your-partnerhub-origin.example npm run mobile:ios
MOBILE_SERVER_URL=https://your-partnerhub-origin.example npm run mobile:android
```

Replace the example with your real deployed origin. Configuration rejects an absent origin, embedded credentials and production HTTP. Local simulator development is an explicit exception:

```sh
MOBILE_DEV=true MOBILE_SERVER_URL=http://localhost:5173 npm run mobile:sync
```

Android emulator access to the host uses `http://10.0.2.2:5173`; iOS Simulator can use localhost. Do not publish a build synchronized with a development URL. The Android debug manifest permits local HTTP; release defaults require HTTPS. App state restoration refreshes workspace data, and the Android back action navigates history or minimizes the app.

- iOS requires full Xcode, the iOS SDK and your Apple team/bundle-signing configuration. Open `ios/App/App.xcodeproj`, select a team and build/archive on an appropriate device or simulator.
- Android requires a compatible JDK (21 for the supplied Capacitor 8 toolchain), Android Studio/SDK 36 and release keystore. Open `android/` in Android Studio, sync Gradle and build the intended variant.
- Bundle identity is `com.vijaysoftwaresolutions.partnerhub`; review ownership before store submission. The projects include VS launcher/splash assets. Signing keys are ignored by Git.

After syncing a release, check login/MFA, camera/file selection, document download, app background/resume, Android back, network loss and role-specific screens on physical devices. Native app store review/distribution and platform-specific file handling require this device verification.

## Verification boundary

The web/mobile layouts and installation assets are locally testable. Project generation and Capacitor plugin sync were executed locally. This Mac has command-line tools, but full Xcode, a Java runtime and Android SDK are absent. Native binaries, signing and physical-device behavior have therefore not been certified by this local run.

`npm run mobile:assets` regenerates branded assets using the same VS mark as the public favicon. It requires the projects and Playwright's installed browser.
