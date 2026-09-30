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

Every copy/sync runs `scripts/prepare-native-offline.mjs`. It binds the bundled reconnect button to the generated workspace URL and embeds the brand image in the offline HTML. Capacitor serves its error page from a local app origin, so the button must use the configured server and its branding must not request a remote image. The web/PWA fallback retains its same-origin link. Rebuild the web assets before synchronizing; missing markers or an invalid server URL fail the native preparation step.

- iOS requires full Xcode, the iOS SDK and your Apple team/bundle-signing configuration. Open `ios/App/App.xcodeproj`, select a team and build/archive on an appropriate device or simulator.
- Android requires a compatible JDK (21 for the supplied Capacitor 8 toolchain), Android Studio/SDK 36 and release keystore. Open `android/` in Android Studio, sync Gradle and build the intended variant.
- Bundle identity is `com.vijaysoftwaresolutions.partnerhub`; review ownership before store submission. The projects include VS launcher/splash assets. Signing keys are ignored by Git.

After syncing a release, check login/MFA, camera/file selection, document download, app background/resume, Android back, network loss and role-specific screens on physical devices. Emulator/simulator acceptance does not cover company signing, store distribution, physical cameras, biometric differences or every operating-system/device combination.

## Downloads and foreground refresh

Reports, private documents, exports, import templates and signing evidence use authenticated same-origin downloads. On Android/iOS, the file is written to the application's private cache and opened in the operating system's Share/Save sheet. The user chooses a destination. Closing that sheet is treated as cancellation. Other origins, redirects, stale sessions and unexpected HTML responses are rejected. Filesystem and Share plugins must be present in the installed package; an older build shows an update message instead of navigating away from the workspace.

Private export cache is cleared on app startup and account/session changes. Logout cancels pending transfers, and a file write that completes after logout is removed. Copies explicitly saved by the user to another destination are controlled by that destination. The iOS project includes the Filesystem privacy reason for access within its own container.

On native foreground/resume, the app explicitly invalidates active data queries, including the session, so records created in another authorized session are refreshed. This does not depend on the browser's window-focus behavior.

## Verification boundary

The `Verify native applications` GitHub workflow compiles Android with JDK 21 / SDK 36 and iOS on a macOS runner with Xcode 26.3. It inspects packaged identity, server configuration, offline reconnect destinations and embedded branding. Android produces a debug-signed APK, unsigned release AAB and lint report. iOS produces an unsigned simulator app, launch screenshot and build log. Reports include commit IDs and artifact hashes. This workflow runs independently of `Verify PartnerHub`; both workflows must pass for a release affecting the native applications.

After copying those production-origin artifacts, the workflow builds separate localhost packages for authenticated acceptance. `scripts/native-fixture.mjs` creates a disposable SQLite database/uploads and a loopback-only test controller; live databases, providers and email delivery are disabled. Android uses Playwright's installed-WebView API on an API 35 emulator. iPhone acceptance uses actual XCTest UI interactions with a simulator. The iOS test target is generated only in the disposable verification checkout.

The acceptance scripts exercise real-form login, reports/KPI dialogs, native file actions, another session creating a record while the app is backgrounded, foreground refresh, a server interruption, reconnect and logout/cache cleanup. Android additionally verifies private-PDF bytes, report ZIP contents and hardware Back. Screenshots, reports and XCTest results are retained under `artifacts/native-verification/*-acceptance/`. Local browser emulation or mocked plugin tests are separate evidence, not substitutes for these installed-app checks.

The first complete hosted verification passed on `4b1610f`: [Android and iOS build run](https://github.com/shxvaayy/VS-PartnerHub/actions/runs/36675834773). The Android APK/AAB inspections passed, and the iOS app compiled, installed and stayed running on an iPhone simulator. Its launch screenshot shows the live sign-in screen. Local copy/reconnect and origin-validation checks also passed 14 checks. Evidence is under `artifacts/native-verification/`; later release runs retain their own commit IDs.

Run it manually with a `server_origin` value to verify a different HTTPS deployment. The scripts do not include production credentials or sign in to production workspaces. The acceptance packages use disposable demonstration accounts on loopback and are separate from the retained production-origin packages. A running simulator process and screenshot alone remain launch evidence; the authenticated acceptance reports identify the actual stages completed.

The web/mobile layouts and installation assets are locally testable. This development Mac has command-line tools, but no full Xcode, Java runtime or Android SDK. Local sync is therefore not evidence of native compilation. Company signing, store/private distribution and physical-device behavior remain separate release requirements even when hosted builds pass.

`npm run mobile:assets` regenerates branded assets using the same VS mark as the public favicon. It requires the projects and Playwright's installed browser.
