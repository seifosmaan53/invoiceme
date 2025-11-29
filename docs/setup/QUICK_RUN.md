# ⚡ Quick Run Commands

## How to Run InvoiceMe

### Step 1: Start Backend (Terminal 1)

```bash
cd "/Users/seifosman/Desktop/invoice maker/backend"
npm run start:dev
```

**Wait for:** `Application is running on: http://localhost:3000/api`

### Step 2: Start Mobile App (Terminal 2)

**Open a NEW terminal window**, then:

```bash
cd "/Users/seifosman/Desktop/invoice maker/mobile"
flutter run
```

**When prompted, choose:**
- Press `c` for Chrome (web browser)
- Press `a` for Android emulator
- Press `i` for iOS simulator
- Or connect a physical device

---

## One-Line Commands (Copy & Paste)

### Backend:
```bash
cd "/Users/seifosman/Desktop/invoice maker/backend" && npm run start:dev
```

### Mobile:
```bash
cd "/Users/seifosman/Desktop/invoice maker/mobile" && flutter run
```

---

## Important Notes

1. **Backend must run first** - Mobile app needs the backend API
2. **Use two terminals** - One for backend, one for mobile
3. **Comments start with `#`** - Don't copy lines starting with `#`

---

## Troubleshooting

### "Cannot connect to backend"
- Make sure backend is running in another terminal
- Check: `curl http://localhost:3000/api/health`

### "Command not found: #"
- `#` starts a comment - don't run those lines
- Only run the actual commands (without `#`)

### Flutter not found
- Run: `./fix_architecture.sh` (if you have architecture issues)
- Or install Flutter: https://docs.flutter.dev/get-started/install

