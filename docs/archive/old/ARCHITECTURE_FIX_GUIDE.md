# Architecture Fix Guide

## Problem
Your system is **ARM64 (Apple Silicon)**, but Node.js and Flutter are installed as **x86_64 (Intel)** binaries, causing "Bad CPU type in executable" errors.

## Quick Fix Options

### Option 1: Automated Script (Recommended)
Run the provided fix script:

```bash
cd "/Users/seifosman/Desktop/invoice maker"
./fix_architecture.sh
```

This will:
- Install ARM64 Homebrew (if needed)
- Install Node.js ARM64 via Homebrew
- Install Flutter ARM64 via Homebrew or manual download
- Update your PATH

**After running, restart your terminal or run:**
```bash
source ~/.zshrc
```

### Option 2: Manual Installation

#### Install ARM64 Homebrew
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
eval "$(/opt/homebrew/bin/brew shellenv)"
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zshrc
```

#### Install Node.js (ARM64)
```bash
/opt/homebrew/bin/brew install node
```

#### Install Flutter (ARM64)
```bash
# Option A: Via Homebrew
/opt/homebrew/bin/brew install --cask flutter

# Option B: Manual download
cd ~
rm -rf flutter  # Remove old installation
git clone https://github.com/flutter/flutter.git -b stable
echo 'export PATH="$HOME/flutter/bin:$PATH"' >> ~/.zshrc
```

#### Verify Installations
```bash
# Restart terminal first, then:
node --version    # Should show v20.x.x or similar
npm --version     # Should show 10.x.x or similar
flutter --version # Should show Flutter 3.19+ or similar
```

### Option 3: Use Node Version Manager (nvm)

If you prefer nvm:

```bash
# Install nvm for ARM64
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.zshrc

# Install Node.js LTS
nvm install --lts
nvm use --lts
```

## Verification

After fixing, verify everything works:

```bash
# Check architectures
file $(which node)      # Should show: arm64
file $(which dart)      # Should show: arm64 (if Flutter installed)

# Check versions
node --version
npm --version
flutter --version
dart --version
```

## Running Tests After Fix

Once Node.js and Flutter are fixed:

```bash
# Backend tests
cd backend
npm install  # If needed
npm test
npm run test:e2e

# Mobile tests
cd mobile
flutter pub get  # If needed
flutter test
```

## Troubleshooting

### "Command not found" after installation
- Restart your terminal
- Or run: `source ~/.zshrc`
- Check PATH: `echo $PATH`

### Homebrew still shows x86_64
- Uninstall old Homebrew: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/uninstall.sh)"`
- Reinstall ARM64 Homebrew (see Option 2 above)

### Flutter doctor issues
```bash
flutter doctor
flutter doctor --android-licenses  # If using Android
```

### Node.js version conflicts
- Remove old Node.js: `sudo rm -rf /usr/local/bin/node /usr/local/bin/npm`
- Use Homebrew version: `/opt/homebrew/bin/brew install node`

## Next Steps

After fixing architecture issues:
1. ✅ Run test suite (see PRE_DEPLOYMENT_CHECKLIST.md)
2. ✅ Configure production .env
3. ✅ Build and deploy

