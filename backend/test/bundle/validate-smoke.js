#!/usr/bin/env node
/**
 * Validates the JSON line printed by test/container/pdf-smoke.js when it is run
 * against an installed update bundle (CI: .github/workflows/update-bundle.yml).
 * Usage: node validate-smoke.js <result.json> <invoice-number>
 * Both PDFs must start with %PDF-, end with %%EOF and contain a page object;
 * if pdftotext is available, the service PDF must contain the invoice number.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const [file, invoiceNumber] = process.argv.slice(2);
const result = JSON.parse(fs.readFileSync(file, 'utf8').trim().split('\n').pop());
let failed = false;
for (const key of ['servicePdf', 'cachePdf']) {
  const pdf = Buffer.from(result[key] || '', 'base64');
  const text = pdf.toString('latin1');
  const pages = (text.match(/\/Type\s*\/Page(?!s)/g) || []).length;
  const ok = text.startsWith('%PDF-') && /%%EOF\s*$/.test(text) && pages >= 1;
  console.log(`${ok ? 'OK' : 'FAIL'} ${key}: ${pdf.length} bytes, ${pages} page(s)`);
  if (!ok) failed = true;
  if (key === 'servicePdf' && invoiceNumber) {
    const tmp = path.join(os.tmpdir(), `smoke-${process.pid}.pdf`);
    fs.writeFileSync(tmp, pdf);
    const r = spawnSync('pdftotext', [tmp, '-'], { encoding: 'utf8' });
    if (r.error) console.log('   (pdftotext not available; text not checked)');
    else if (!r.stdout.includes(invoiceNumber)) { console.log(`FAIL servicePdf does not contain ${invoiceNumber}`); failed = true; }
    else console.log(`OK servicePdf contains ${invoiceNumber}`);
    fs.rmSync(tmp, { force: true });
  }
}
console.log(`browser ${result.browserVersion} via ${result.cacheExecutable || result.executablePathEnv}, node ${result.node}, puppeteer ${result.puppeteer}`);
process.exit(failed ? 1 : 0);
