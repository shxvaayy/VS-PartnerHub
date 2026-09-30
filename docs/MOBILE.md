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

Every copy/sync runs `scripts/prepare-native-offline.mjs`. It binds the bundled reconnect button to the generated workspace URL. Capacitor serves its error page from a local app origin, so that button must use the configured server rather than a relative `/app` path. The web/PWA fallback retains its same-origin link. Rebuild the web assets before synchronizing; missing markers or an invalid server URL fail the native preparation step.

- iOS requires full Xcode, the iOS SDK and your Apple team/bundle-signing configuration. Open `ios/App/App.xcodeproj`, select a team and build/archive on an appropriate device or simulator.
- Android requires a compatible JDK (21 for the supplied Capacitor 8 toolchain), Android Studio/SDK 36 and release keystore. Open `android/` in Android Studio, sync Gradle and build the intended variant.
- Bundle identity is `com.vijaysoftwaresolutions.partnerhub`; review ownership before store submission. The projects include VS launcher/splash assets. Signing keys are ignored by Git.

After syncing a release, check login/MFA, camera/file selection, document download, app background/resume, Android back, network loss and role-specific screens on physical devices. Native app store review/distribution and platform-specific file handling require this device verification.

## Verification boundary

The `Verify native applications` GitHub workflow compiles Android with JDK 21 / SDK 36 and iOS on a macOS runner with Xcode 26.3. It inspects packaged identity, server configuration and offline reconnect destinations. Android produces a debug-signed APK, unsigned release AAB and lint report. iOS produces an unsigned simulator app, launch screenshot and build log. Reports include commit IDs and artifact hashes. This workflow runs independently of `Verify PartnerHub`; both workflows must pass for a release affecting the native applications.

The first complete hosted verification passed on `4b1610f`: [Android and iOS build run](https://github.com/shxvaayy/VS-PartnerHub/actions/runs/36675834773). The Android APK/AAB inspections passed, and the iOS app compiled, installed and stayed running on an iPhone simulator. Its launch screenshot shows the live sign-in screen. Local copy/reconnect and origin-validation checks also passed 14 checks. Evidence is under `artifacts/native-verification/`; later release runs retain their own commit IDs.

Run it manually with a `server_origin` value to verify a different HTTPS deployment. The scripts do not include production credentials or sign in to private workspaces. A running simulator process and screenshot are launch evidence; review the screenshot and execute authenticated device acceptance before claiming complete native workflow verification.

The web/mobile layouts and installation assets are locally testable. This development Mac has command-line tools, but no full Xcode, Java runtime or Android SDK. Local sync is therefore not evidence of native compilation. Company signing, store/private distribution and physical-device behavior remain separate release requirements even when hosted builds pass.

`npm run mobile:assets` regenerates branded assets using the same VS mark as the public favicon. It requires the projects and Playwright's installed browser.
