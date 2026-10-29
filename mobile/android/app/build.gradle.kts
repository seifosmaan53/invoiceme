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
        applicationId = "com.example.invoiceme"
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

    buildTypes {
        release {
            // TODO: Add your own signing config for the release build.
            // Signing with the debug keys for now, so `flutter run --release` works.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

flutter {
    source = "../.."
}
