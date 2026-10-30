# iOS: assessment for a future build (no build exists)

Separate release track; it does not block an Android-only test release.
Assessed from the repository on 2026-10-29. **No iOS build has ever been made
from this code, and sync, conflicts and payments have never run on iOS.**
Nothing here installed tools, created certificates or changed the project.

## What the project has now

| Item | Value | Where |
|---|---|---|
| Bundle identifier | `com.example.invoiceme` (placeholder, like Android); tests `com.example.invoiceme.RunnerTests` | `mobile/ios/Runner.xcodeproj/project.pbxproj` |
| Display name | `Invoiceme` | `Info.plist` `CFBundleDisplayName` |
| Version | from Flutter (`FLUTTER_BUILD_NAME` / `FLUTTER_BUILD_NUMBER`, i.e. `pubspec.yaml`) | `Info.plist` |
| Signing | Automatic signing, **no development team set** | `project.pbxproj` |
| Minimum iOS | 13.0 (`IPHONEOS_DEPLOYMENT_TARGET`); `Podfile` platform line commented out | `project.pbxproj`, `Podfile` |
| Devices | iPhone and iPad (`TARGETED_DEVICE_FAMILY = "1,2"`) | `project.pbxproj` |
| CocoaPods | `Podfile.lock` present (CocoaPods 1.16.2) | `mobile/ios/` |
| Privacy usage descriptions | **none** | `Info.plist` |
| Network | App Transport Security not overridden: plain HTTP is blocked, so the server must be `https://` | `Info.plist` |

## Requirements before an iOS build

1. **Bundle identity (owner decision).** A permanent bundle id, normally the
   same reversed-domain base as the Android application id
   (docs/release/ANDROID-RELEASE.md 2.1). It is registered in the Apple
   Developer account and cannot be renamed later.
2. **Apple Developer Program membership** (paid, owner's account) for any
   install outside the owner's own device, TestFlight or the App Store; the
   team id goes into the project (`DEVELOPMENT_TEAM`).
3. **Signing.** An Apple Distribution certificate and a provisioning profile
   (App Store / TestFlight, or Ad Hoc with the test devices' identifiers),
   created by the account holder; kept in the owner's keychain or a CI
   secret store, never in the repository.
4. **Toolchain.** A Mac with an Xcode version supported by the pinned
   Flutter (3.35.7, as in the Android workflows), the iOS SDK, and
   CocoaPods. A macOS CI runner can build once signing secrets exist; none is
   set up.
5. **Permissions to add before review/install** (missing today; the app would
   be rejected or the picker would fail):
   - `NSPhotoLibraryUsageDescription`: attachment upload picks images from
     the photo library (`image_picker`, `lib/screens/attachment_upload_screen.dart`);
   - `NSCameraUsageDescription` only if camera capture is added later;
   - check the `file_picker`, `printing` and `share_plus` iOS notes for the
     versions in `pubspec.lock` when building.
6. **Backend configuration.** `--dart-define=API_BASE_URL=https://<host>/api/v1`
   (the default is a development `http://localhost` address); the server's
   certificate must be trusted by iOS (public CA or a profile-installed
   private CA).
7. **Payments.** The app includes `flutter_stripe`; its iOS setup (minimum
   iOS version, any URL scheme/return URL used by the payment sheet) must be
   checked against the installed version, using Stripe test mode only.
8. **Testing.** The device checklist (DEVICE-ACCEPTANCE.md) on an iPhone,
   plus a check that the local SQLite migration and sync behave as on
   Android (no iOS evidence exists).
9. **The account-switching defect** in DEVICE-ACCEPTANCE.md applies to iOS
   too (shared Dart code).
