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

Mobile authentication and onboarding controls retain a 16px font so iOS does not automatically zoom the page when a field receives focus. Report detail and export dialogs keep their close control visible while their contents scroll inside the dialog.

## Downloads and foreground refresh

Reports, private documents, exports, import templates and signing evidence use authenticated same-origin downloads. On Android/iOS, the file is written to the application's private cache and opened in the operating system's Share/Save sheet. The user chooses a destination. Closing that sheet is treated as cancellation. Other origins, redirects, stale sessions and unexpected HTML responses are rejected. Filesystem and Share plugins must be present in the installed package; an older build shows an update message instead of navigating away from the workspace.

Private export cache is cleared on app startup and account/session changes. Logout cancels pending transfers, and a file write that completes after logout is removed. Copies explicitly saved by the user to another destination are controlled by that destination. The iOS project includes the Filesystem privacy reason for access within its own container.

On native foreground/resume, the app explicitly invalidates active data queries, including the session, so records created in another authorized session are refreshed. iOS also handles Capacitor's scene-foreground `resume` event. This does not depend on the browser's window-focus behavior. Selecting a workspace closes mobile navigation even when the destination is already open or only its query parameters change.

## Verification boundary

### Signed Android release

The separate **Build signed Android release** workflow produces a non-debuggable APK and an AAB signed with the same retained project identity. It runs on relevant pushes and supports manual `version_code` and `version_name` inputs. The default version code is its increasing workflow run number. Both packages load the production HTTPS origin; neither contains test credentials or a development server URL.

The public certificate fingerprint is recorded in `android/release-signing.json`. The private PKCS12 and password remain outside Git and are supplied through encrypted Actions secrets `PARTNERHUB_ANDROID_KEYSTORE` and `PARTNERHUB_ANDROID_STORE_PASSWORD`. `PARTNERHUB_ANDROID_SIGNING_ESCROW` encrypts the recovery envelope. A missing key or mismatched release certificate fails the build. The temporary plaintext keystore is removed even after a failing job.

[Release acceptance on `2898cf6`](https://github.com/shxvaayy/VS-PartnerHub/actions/runs/36790218566) passed all **4/4 identity, package and signature checks** and **3/3 installed-release checks**. The exact signed APK installed on an API 35 emulator, rendered the actual live HTTPS sign-in screen and remained running. The driver waits for Android's validated network before launch; connection diagnostics contain host/error codes and never weaken TLS verification. This launch used no live login credentials, changed no production business records and sent no email. Full authenticated workflows have their separate installed-app evidence below.

The run's `partnerhub-android-release-3` artifact contains `VS-PartnerHub-Android.apk`, `VS-PartnerHub-Android.aab`, their SHA-256 hashes, public signing metadata, launch evidence, release lint results and an encrypted signing backup. Artifacts have 30-day retention. APK files support direct installation; AAB files are for a chosen Android distribution service. Google Play publication and company physical-device acceptance remain separate.

Signing recovery passed six local checks, including tampered ciphertext, the wrong recovery key and refusal to overwrite an existing destination. The independently downloaded GitHub recovery envelope was also restored and its certificate and package hashes matched. Restore into a new private directory using:

```sh
node scripts/restore-android-signing.mjs \
  --input /private/recovery/signing-backup.json.enc \
  --key /private/recovery/android-escrow-key \
  --output /private/recovery/restored-android-signing
```

Keep the recovery key and restored signing material private. Future updates must retain this certificate and increase the version code unless the selected distribution service performs its own managed app signing. Android signing does not supply an Apple signing identity.

### Authenticated emulator and simulator workflows

The `Verify native applications` GitHub workflow compiles Android with JDK 21 / SDK 36 and iOS on a macOS runner with Xcode 26.3. It inspects packaged identity, server configuration, offline reconnect destinations and embedded branding. Android produces a debug-signed APK, unsigned release AAB and lint report. iOS produces an unsigned simulator app, launch screenshot and build log. Reports include commit IDs and artifact hashes. This workflow runs independently of `Verify PartnerHub`; both workflows must pass for a release affecting the native applications.

After copying those production-origin artifacts, the workflow builds separate localhost packages for authenticated acceptance. `scripts/native-fixture.mjs` creates a disposable SQLite database/uploads and a loopback-only test controller; live databases, providers and email delivery are disabled. Android uses Playwright's installed-WebView API on an API 35 emulator. iPhone acceptance uses actual XCTest UI interactions with a simulator. The iOS test target is generated only in the disposable verification checkout.

The acceptance scripts exercise real-form login, reports/KPI dialogs, native file actions, another session creating a record while the app is backgrounded, foreground refresh, a server interruption, reconnect and logout/cache cleanup. Both platforms compare the private report archive with the real authorized API. iPhone cache checks run while XCTest is still active, before Xcode shuts down the simulator, and verify both a fresh file before logout and its removal afterward. Android additionally verifies private-PDF bytes and hardware Back. Screenshots, reports and XCTest results are retained under `artifacts/native-verification/*-acceptance/`. Local browser emulation or mocked plugin tests are separate evidence, not substitutes for these installed-app checks.

Acceptance reports retain a bounded HTTP request journal with method, path, timestamp and response status. Request bodies, cookies, query parameters and credentials are excluded. Android compares each downloaded file's size and SHA-256 from inside the app container with the actual HTTP body and the encoded ADB transfer; isolated report/PDF files and their integrity report are retained for diagnosis. A failing iPhone test also requests simulator/WebKit startup diagnostics before Xcode tears down the device.

Android share acceptance waits for the actual focused chooser window and visible filename before sending Back. The workflow installs the matching Playwright Android accessibility driver before those native UI checks. It then verifies that input focus returns to PartnerHub and the workspace URL stays unchanged. Activity-history entries alone are insufficient: they can describe an old or still-opening chooser. Focus transitions and native report/document share screenshots are retained. A specifically identified Pixel Launcher ANR may be closed at most twice with its screenshot and current accessibility control recorded; an application ANR still fails the check. Recovery waits for the actual alert to disappear and never taps coordinates from a previous UI dump. Initial login and workspace navigation also wait for PartnerHub to own the focused native window.

Android acceptance explicitly stops Playwright's two test-driver packages before closing its automation connection. Their instrumentation session can otherwise keep the runner alive after all eight app checks and the report have completed. Device and fixture cleanup have bounded waits; failures remain recorded and fail the job. The PartnerHub application is not force-stopped by this cleanup. iPhone acceptance separately waits for the native share sheet and its visible Save to Files action, allowing up to 60 seconds for the system's remote share service on a cold simulator. The private-file and logout assertions still run against the actual app container.

The complete authenticated acceptance passed on `2637b05`: [Android and iPhone acceptance run](https://github.com/shxvaayy/VS-PartnerHub/actions/runs/36764870471), with **8/8 workflow checks on each platform**. The iPhone report confirms two populated-cache checks against the authorized API and one empty-cache check after logout. Production-origin package checks, Android lint and iPhone build/launch also passed. Evidence is retained under `artifacts/native-verification/36764870471/`.

The first hosted compilation/launch verification passed on `4b1610f`: [Android and iOS build run](https://github.com/shxvaayy/VS-PartnerHub/actions/runs/36675834773). The Android APK/AAB inspections passed, and the iOS app compiled, installed and stayed running on an iPhone simulator. Its launch screenshot shows the live sign-in screen. Local copy/reconnect and origin-validation checks also passed 14 checks. Evidence is under `artifacts/native-verification/`; later release runs retain their own commit IDs.

Run it manually with a `server_origin` value to verify a different HTTPS deployment. The scripts do not include production credentials or sign in to production workspaces. The acceptance packages use disposable demonstration accounts on loopback and are separate from the retained production-origin packages. A running simulator process and screenshot alone remain launch evidence; the authenticated acceptance reports identify the actual stages completed.

The web/mobile layouts and installation assets are locally testable. This development Mac has command-line tools, but no full Xcode, Java runtime or Android SDK. Local sync is therefore not evidence of native compilation. Company signing, store/private distribution and physical-device behavior remain separate release requirements even when hosted builds pass.

`npm run mobile:assets` regenerates branded assets using the same VS mark as the public favicon. It requires the projects and Playwright's installed browser.
