# iOS Simulator Setup Guide

## Issue
The Simulator app is open, but no iOS runtimes are installed. You need to install an iOS runtime to use the simulator.

## Solution

### Option 1: Install via Xcode (Recommended)

1. **Open Xcode** (already opened for you)
2. Go to **Xcode → Settings** (or **Preferences**)
3. Click on **Platforms** (or **Components** in older versions)
4. Find **iOS** and click the **Download** button next to the latest iOS version
5. Wait for the download to complete (this can take 10-30 minutes depending on your internet speed)

### Option 2: Install via Command Line

```bash
# List available runtimes
xcodebuild -downloadPlatform iOS

# Or use xcode-select to install
sudo xcode-select --install
```

### Option 3: Install via Xcode Command Line Tools

```bash
# Install command line tools (if not already installed)
xcode-select --install

# Then download iOS runtime through Xcode GUI
```

## Verify Installation

After installing the runtime, verify it's available:

```bash
# Check runtimes
xcrun simctl list runtimes

# Check devices
xcrun simctl list devices

# Check Flutter devices
flutter devices
```

## Create and Boot a Simulator

Once a runtime is installed, you can create and boot a simulator:

```bash
# List available device types
xcrun simctl list devicetypes | grep iPhone

# Create a device (replace with actual runtime)
xcrun simctl create "My iPhone" "iPhone 16 Pro" "iOS-18.0"

# Boot the device
xcrun simctl boot "My iPhone"

# Open Simulator
open -a Simulator
```

## Quick Fix

If you just need to test the app quickly, you can:

1. **Use macOS Desktop**: Run `flutter run -d macos`
2. **Use Chrome Web**: Run `flutter run -d chrome`
3. **Use Physical Device**: Connect an iPhone via USB

## Troubleshooting

### Simulator Not Showing in Flutter

If the simulator is open but Flutter doesn't detect it:

```bash
# Restart Flutter daemon
flutter daemon --kill

# Check Flutter doctor
flutter doctor -v

# Verify Xcode is properly configured
xcode-select -p
```

### Runtime Still Not Available

If runtimes don't appear after installation:

1. Restart Xcode
2. Restart Simulator app
3. Run `xcrun simctl list runtimes` to verify
4. Check Xcode → Settings → Platforms again

---

**Note:** The iOS runtime download is large (several GB) and requires an Apple Developer account (free account works).

