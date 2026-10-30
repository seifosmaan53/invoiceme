plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Test build for sync testing on devices and the CI emulator, only with
// -PinvoicemeTestBuild=true (or ORG_GRADLE_PROJECT_invoicemeTestBuild=true):
// a separate app id (".synctest", installs beside the normal app), the label
// "InvoiceMe (sync test)", and cleartext HTTP allowed (the emulator reaches a
// local backend at http://10.0.2.2:3000). Without the property nothing changes.
val invoicemeTestBuild = (project.findProperty("invoicemeTestBuild") as String?)?.toBoolean() == true

// Release identity and signing (docs/release/ANDROID-RELEASE.md). Nothing here
// is stored in the repository:
// - invoicemeApplicationId: the production application id, given by the
//   release workflow from the owner's configuration. Unset = the unchanged
//   placeholder below.
// - Signing comes only from the environment, which the workflows fill from a
//   secret store: INVOICEME_SIGNING_STORE_FILE (a keystore written to a
//   temporary file during the build), INVOICEME_SIGNING_STORE_PASSWORD,
//   INVOICEME_SIGNING_KEY_ALIAS, INVOICEME_SIGNING_KEY_PASSWORD. Without them
//   release builds keep the debug key (local `flutter run --release`, and
//   per-build test APKs).
// - invoicemeRequireSigning=true: fail instead of falling back to the debug key.
val invoicemeApplicationId = (project.findProperty("invoicemeApplicationId") as String?)?.trim().orEmpty()
if (invoicemeApplicationId.isNotEmpty() && !Regex("^[a-zA-Z][a-zA-Z0-9_]*(\\.[a-zA-Z][a-zA-Z0-9_]*)+$").matches(invoicemeApplicationId)) {
    throw GradleException("invoicemeApplicationId is not a valid application id: \"$invoicemeApplicationId\"")
}
val signingEnvNames = listOf(
    "INVOICEME_SIGNING_STORE_FILE",
    "INVOICEME_SIGNING_STORE_PASSWORD",
    "INVOICEME_SIGNING_KEY_ALIAS",
    "INVOICEME_SIGNING_KEY_PASSWORD",
)
val signingEnv = signingEnvNames.associateWith { System.getenv(it).orEmpty() }
val hasSigning = signingEnv.values.all { it.isNotEmpty() }
val requireSigning = (project.findProperty("invoicemeRequireSigning") as String?)?.toBoolean() == true
if (requireSigning && !hasSigning) {
    // Names only, never values
    throw GradleException(
        "Release signing is required (invoicemeRequireSigning=true) but not configured. Missing: " +
            signingEnvNames.filter { signingEnv[it].isNullOrEmpty() }.joinToString(", "),
    )
}

android {
    namespace = "com.example.invoiceme"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_11.toString()
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = invoicemeApplicationId.ifEmpty { "com.example.invoiceme" }
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        manifestPlaceholders["appLabel"] = "invoiceme"
        if (invoicemeTestBuild) {
            applicationIdSuffix = ".synctest"
            manifestPlaceholders["appLabel"] = "InvoiceMe (sync test)"
        }
    }

    if (invoicemeTestBuild) {
        // Cleartext HTTP for the test build only (src/synctest/AndroidManifest.xml,
        // which also keeps the debug manifest's INTERNET permission).
        sourceSets.getByName("debug").manifest.srcFile("src/synctest/AndroidManifest.xml")
        sourceSets.getByName("release").manifest.srcFile("src/synctest/AndroidManifest.xml")
    }

    signingConfigs {
        if (hasSigning) {
            create("invoiceme") {
                storeFile = file(signingEnv.getValue("INVOICEME_SIGNING_STORE_FILE"))
                storePassword = signingEnv.getValue("INVOICEME_SIGNING_STORE_PASSWORD")
                keyAlias = signingEnv.getValue("INVOICEME_SIGNING_KEY_ALIAS")
                keyPassword = signingEnv.getValue("INVOICEME_SIGNING_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            // The key from the environment when configured (release workflow:
            // production key; test workflow: the dedicated test key), else the
            // debug key so `flutter run --release` and per-build test APKs work.
            signingConfig = signingConfigs.getByName(if (hasSigning) "invoiceme" else "debug")
        }
    }
}

flutter {
    source = "../.."
}
