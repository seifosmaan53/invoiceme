#!/usr/bin/env node
/*
 * Prints the path of an installed Chrome/Chromium for PUPPETEER_EXECUTABLE_PATH
 * and exits 0, or explains what is missing and exits 1. It only looks; it never
 * downloads or installs anything.
 *
 *   export PUPPETEER_EXECUTABLE_PATH="$(node scripts/find-browser.js)"      (bash)
 *   $env:PUPPETEER_EXECUTABLE_PATH = (node scripts/find-browser.js)          (PowerShell)
 *
 * Order: an existing PUPPETEER_EXECUTABLE_PATH (checked, not trusted blindly),
 * then the usual install locations for this platform, then the PATH.
 */
const fs = require('fs');
const path = require('path');

const candidates = {
  linux: ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/snap/bin/chromium'],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
  win32: [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Chromium', 'Application', 'chrome.exe'),
  ],
};
const onPath = process.platform === 'win32' ? ['chrome.exe'] : ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];

const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH;
if (fromEnv) {
  if (isFile(fromEnv)) {
    console.log(fromEnv);
    process.exit(0);
  }
  console.error(`PUPPETEER_EXECUTABLE_PATH is set but is not a file: ${fromEnv}`);
  process.exit(1);
}

const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
const found = (candidates[process.platform] || []).filter(Boolean).find(isFile) ||
  onPath.map((name) => dirs.map((d) => path.join(d, name)).find(isFile)).find(Boolean);

if (found) {
  console.log(found);
  process.exit(0);
}
console.error(
  'No Chrome/Chromium found. Install one (e.g. `apt-get install chromium`, Google Chrome on Windows/macOS) ' +
    'and set PUPPETEER_EXECUTABLE_PATH to it.',
);
process.exit(1);
