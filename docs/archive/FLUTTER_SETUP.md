# Flutter Setup Guide for InvoiceMe

## Issue: Flutter Not Found

You're encountering two issues:
1. **Wrong directory** - You're in `~` (home) instead of the project directory
2. **Flutter not installed** - Flutter SDK is not in your PATH

## Step 1: Navigate to Project Directory

The correct path is:
```bash
cd "/Users/seifosman/Desktop/invoice maker"
```

Or from your home directory:
```bash
cd ~/Desktop/invoice\ maker
```

Then navigate to mobile:
```bash
cd mobile
```

## Step 2: Install Flutter (if not installed)

### Check if Flutter is installed:
```bash
flutter --version
```

If this fails, you need to install Flutter:

### Install Flutter on macOS:

1. **Download Flutter SDK:**
   ```bash
   cd ~
   git clone https://github.com/flutter/flutter.git -b stable
   ```

2. **Add Flutter to PATH:**
   
   Add this to your `~/.zshrc` file:
   ```bash
   export PATH="$PATH:$HOME/flutter/bin"
   ```

   Then reload:
   ```bash
   source ~/.zshrc
   ```

3. **Verify installation:**
   ```bash
   flutter doctor
   ```

4. **Install Xcode (for iOS development):**
   ```bash
   # Install Xcode from App Store
   # Then run:
   sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
   sudo xcodebuild -runFirstLaunch
   ```

5. **Install Android Studio (for Android development):**
   - Download from: https://developer.android.com/studio
   - Install Android SDK
   - Set up Android emulator

## Step 3: Run Flutter Doctor

After installing Flutter, run:
```bash
flutter doctor
```

This will show what's missing and provide instructions.

## Step 4: Navigate to Mobile Directory

```bash
cd ~/Desktop/invoice\ maker/mobile
```

## Step 5: Install Dependencies

```bash
flutter pub get
```

## Step 6: Run the App

### Option 1: Run on available device
```bash
flutter run
```

### Option 2: List available devices
```bash
flutter devices
```

### Option 3: Run on specific device
```bash
flutter run -d <device-id>
```

## Quick Commands Reference

```bash
# Navigate to project
cd ~/Desktop/invoice\ maker/mobile

# Check Flutter installation
flutter doctor

# Install dependencies
flutter pub get

# List available devices
flutter devices

# Run on default device
flutter run

# Run on iOS simulator (if Xcode installed)
flutter run -d ios

# Run on Android emulator (if Android Studio installed)
flutter run -d android

# Run on Chrome (web)
flutter run -d chrome
```

## Alternative: Use Flutter via Homebrew

If you have Homebrew installed:
```bash
brew install --cask flutter
```

Then add to PATH:
```bash
echo 'export PATH="$PATH:$HOME/flutter/bin"' >> ~/.zshrc
source ~/.zshrc
```

## Troubleshooting

### Issue: "command not found: flutter"
- Flutter is not installed or not in PATH
- Add Flutter to PATH as shown above

### Issue: "cd: no such file or directory: mobile"
- You're in the wrong directory
- Navigate to: `cd ~/Desktop/invoice\ maker/mobile`

### Issue: "No devices found"
- Install Xcode for iOS development
- Install Android Studio for Android development
- Or use Chrome: `flutter run -d chrome`

## Next Steps

1. Install Flutter SDK
2. Run `flutter doctor` to check setup
3. Navigate to mobile directory
4. Run `flutter pub get`
5. Run `flutter run`

