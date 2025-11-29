# Quick Flutter Installation & Run Guide

## ⚠️ Flutter Not Installed

Flutter SDK is not installed on your system. Here's how to install it and run the app:

## 🚀 Quick Installation

### Option 1: Run Installation Script (Easiest)

```bash
cd ~/Desktop/invoice\ maker
./install_flutter.sh
```

Then close and reopen your terminal, or run:
```bash
source ~/.zshrc
```

### Option 2: Manual Installation

```bash
# Step 1: Clone Flutter SDK
cd ~
git clone https://github.com/flutter/flutter.git -b stable

# Step 2: Add to PATH
echo 'export PATH="$PATH:$HOME/flutter/bin"' >> ~/.zshrc

# Step 3: Reload shell
source ~/.zshrc

# Step 4: Verify installation
flutter --version
flutter doctor
```

### Option 3: Install via Homebrew (if you have it)

```bash
brew install --cask flutter
```

Then add to PATH:
```bash
echo 'export PATH="$PATH:$HOME/flutter/bin"' >> ~/.zshrc
source ~/.zshrc
```

## ✅ After Installation

Once Flutter is installed, run:

```bash
# Navigate to mobile directory
cd ~/Desktop/invoice\ maker/mobile

# Install dependencies
flutter pub get

# Check available devices
flutter devices

# Run on Chrome (web)
flutter run -d chrome

# Or run on macOS desktop
flutter run -d macos
```

## 🎯 Expected Output

After `flutter run -d chrome`, you should see:
1. Compilation progress
2. Chrome browser opening automatically
3. InvoiceMe login screen appearing

## 📝 Troubleshooting

### Issue: "command not found: flutter"
- Flutter is not installed or not in PATH
- Run installation script or manual steps above
- After installation, close and reopen terminal

### Issue: "No devices found"
- Use: `flutter run -d chrome` (web)
- Or: `flutter run -d macos` (desktop)

### Issue: "flutter doctor shows warnings"
- For Chrome/web: You can ignore most warnings
- For iOS: Install Xcode from App Store
- For Android: Install Android Studio

## 🚀 Quick Start Commands (After Installation)

```bash
# 1. Navigate to project
cd ~/Desktop/invoice\ maker/mobile

# 2. Install dependencies
flutter pub get

# 3. Run on Chrome
flutter run -d chrome
```

## ✅ Status

- ✅ All code files exist
- ✅ Import paths fixed
- ✅ Dependencies configured
- ⏳ Flutter SDK needs installation

**Next:** Install Flutter, then run the app!

