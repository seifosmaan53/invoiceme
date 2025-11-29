#!/usr/bin/env node

/**
 * Automatic Email Setup Script
 * 
 * This script automatically generates Ethereal Email credentials
 * and configures your .env file for email sending.
 * 
 * Ethereal Email is perfect for development - no signup required!
 * 
 * Usage:
 *   node scripts/setup-email-auto.js
 *   npm run setup:email
 */

const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

async function generateEtherealAccount() {
  log('\n🔧 Generating Ethereal Email account...', 'cyan');
  logInfo('This is free and requires no signup!');
  
  try {
    const account = await nodemailer.createTestAccount();
    logSuccess('Ethereal Email account generated!');
    return account;
  } catch (error) {
    logError(`Failed to generate Ethereal account: ${error.message}`);
    throw error;
  }
}

function readEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  
  if (!fs.existsSync(envPath)) {
    logWarning('.env file not found. Creating from env.example...');
    const examplePath = path.join(__dirname, '..', 'env.example');
    if (fs.existsSync(examplePath)) {
      fs.copyFileSync(examplePath, envPath);
      logSuccess('Created .env file from env.example');
    } else {
      // Create minimal .env file
      fs.writeFileSync(envPath, '# Environment Configuration\n');
      logSuccess('Created new .env file');
    }
  }
  
  return fs.readFileSync(envPath, 'utf-8');
}

function updateEnvFile(envContent, credentials) {
  const lines = envContent.split('\n');
  const newLines = [];
  let emailSectionFound = false;
  let emailSectionEnded = false;
  
  // Email configuration to add/update
  const emailConfig = {
    'SMTP_HOST': credentials.smtp.host,
    'SMTP_PORT': credentials.smtp.port.toString(),
    'SMTP_USER': credentials.user,
    'SMTP_PASS': credentials.pass,
    'EMAIL_FROM': 'noreply@invoiceme.com',
    'FRONTEND_URL': 'http://localhost:8080',
    'SUPPORT_EMAIL': 'support@invoiceme.com',
  };
  
  // Track which configs we've added
  const addedConfigs = new Set();
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Detect email section
    if (line.includes('# Email') || line.includes('# SMTP')) {
      emailSectionFound = true;
    }
    
    // Check if we're past email section
    if (emailSectionFound && !emailSectionEnded) {
      if (line.trim().startsWith('#') && 
          !line.includes('SMTP') && 
          !line.includes('EMAIL') &&
          !line.includes('FRONTEND') &&
          !line.includes('SUPPORT') &&
          line.trim().length > 0) {
        emailSectionEnded = true;
      }
    }
    
    // Update or skip existing email config lines
    let lineUpdated = false;
    for (const [key, value] of Object.entries(emailConfig)) {
      if (line.trim().startsWith(`${key}=`)) {
        newLines.push(`${key}=${value}`);
        addedConfigs.add(key);
        lineUpdated = true;
        break;
      }
    }
    
    if (!lineUpdated) {
      newLines.push(line);
    }
    
    // Add email config after email section header if we haven't added them yet
    if (emailSectionFound && !emailSectionEnded && i === lines.length - 1) {
      // Add configs that weren't found
      for (const [key, value] of Object.entries(emailConfig)) {
        if (!addedConfigs.has(key)) {
          newLines.push(`${key}=${value}`);
        }
      }
    }
  }
  
  // If email section not found, add it at the end
  if (!emailSectionFound) {
    newLines.push('');
    newLines.push('# ============================================================================');
    newLines.push('# Email/SMTP Configuration (Auto-configured with Ethereal Email)');
    newLines.push('# ============================================================================');
    for (const [key, value] of Object.entries(emailConfig)) {
      newLines.push(`${key}=${value}`);
    }
  }
  
  return newLines.join('\n');
}

async function main() {
  console.log('\n');
  log('╔══════════════════════════════════════════════════════════════╗', 'cyan');
  log('║         Automatic Email Setup - Ethereal Email              ║', 'cyan');
  log('╚══════════════════════════════════════════════════════════════╝', 'cyan');
  
  try {
    // Generate Ethereal account
    const account = await generateEtherealAccount();
    
    logSuccess('Account Details:');
    logInfo(`  Host: ${account.smtp.host}`);
    logInfo(`  Port: ${account.smtp.port}`);
    logInfo(`  User: ${account.user}`);
    logInfo(`  Pass: ${account.pass}`);
    logInfo(`  Web URL: ${account.web}`);
    
    // Read current .env
    log('\n📝 Updating .env file...', 'cyan');
    const envContent = readEnvFile();
    
    // Update with credentials
    const credentials = {
      smtp: account.smtp,
      user: account.user,
      pass: account.pass,
    };
    
    const updatedContent = updateEnvFile(envContent, credentials);
    
    // Write back to .env
    const envPath = path.join(__dirname, '..', '.env');
    fs.writeFileSync(envPath, updatedContent);
    logSuccess('.env file updated!');
    
    // Summary
    console.log('\n');
    log('╔══════════════════════════════════════════════════════════════╗', 'green');
    log('║                    ✅ Setup Complete!                        ║', 'green');
    log('╚══════════════════════════════════════════════════════════════╝', 'green');
    
    console.log('\n📧 Email Configuration:');
    logSuccess('SMTP credentials have been automatically configured!');
    logInfo('Using Ethereal Email (free, no signup required)');
    
    console.log('\n🔗 View Your Emails:');
    logInfo(`Open this URL to view received emails:`);
    log(`   ${account.web}`, 'cyan');
    logWarning('(Emails are stored temporarily, typically 24 hours)');
    
    console.log('\n🧪 Next Steps:');
    logInfo('1. Restart your backend: npm run start:dev');
    logInfo('2. Test email configuration: npm run test:email');
    logInfo('3. Test password reset: curl -X POST http://localhost:3000/api/v1/auth/password-reset-request -H "Content-Type: application/json" -d \'{"email": "test@example.com"}\'');
    logInfo('4. Check emails at the URL above');
    
    console.log('\n');
    logSuccess('Your email system is now ready to use! 🎉');
    console.log('\n');
    
  } catch (error) {
    logError(`Setup failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

// Run the setup
main();

