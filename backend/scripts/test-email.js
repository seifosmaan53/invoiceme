#!/usr/bin/env node

/**
 * Email Configuration Test Script
 * 
 * Tests SMTP configuration by sending a test email
 * 
 * Usage:
 *   node scripts/test-email.js <recipient-email>
 * 
 * Example:
 *   node scripts/test-email.js test@example.com
 */

require('dotenv').config();
const nodemailer = require('nodemailer');

const recipientEmail = process.argv[2];

if (!recipientEmail) {
  console.error('❌ Error: Recipient email is required');
  console.log('\nUsage: node scripts/test-email.js <recipient-email>');
  console.log('Example: node scripts/test-email.js test@example.com');
  process.exit(1);
}

// Get SMTP configuration from environment
const smtpHost = process.env.SMTP_HOST;
const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const emailFrom = process.env.EMAIL_FROM || 'noreply@invoiceme.com';

// Validate configuration
if (!smtpHost) {
  console.error('❌ Error: SMTP_HOST is not configured');
  console.log('\nPlease add SMTP configuration to your .env file:');
  console.log('  SMTP_HOST=smtp.gmail.com');
  console.log('  SMTP_PORT=587');
  console.log('  SMTP_USER=your-email@gmail.com');
  console.log('  SMTP_PASS=your-app-password');
  console.log('  EMAIL_FROM=noreply@invoiceme.com');
  process.exit(1);
}

if (!smtpUser || !smtpPass) {
  console.error('❌ Error: SMTP_USER and SMTP_PASS are required');
  process.exit(1);
}

console.log('📧 Testing SMTP Configuration...\n');
console.log('Configuration:');
console.log(`  Host: ${smtpHost}`);
console.log(`  Port: ${smtpPort}`);
console.log(`  User: ${smtpUser}`);
console.log(`  From: ${emailFrom}`);
console.log(`  To: ${recipientEmail}\n`);

// Create transporter
const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpPort === 465, // true for 465, false for other ports
  auth: {
    user: smtpUser,
    pass: smtpPass,
  },
});

// Test connection
console.log('🔍 Verifying SMTP connection...');
transporter.verify((error, success) => {
  if (error) {
    console.error('❌ SMTP Connection Failed:');
    console.error(`   ${error.message}\n`);
    
    if (error.code === 'EAUTH') {
      console.log('💡 Common fixes:');
      console.log('   - Check SMTP_USER and SMTP_PASS are correct');
      console.log('   - For Gmail: Use App Password, not regular password');
      console.log('   - Generate App Password: https://myaccount.google.com/apppasswords');
    } else if (error.code === 'ECONNREFUSED') {
      console.log('💡 Common fixes:');
      console.log('   - Check SMTP_HOST and SMTP_PORT are correct');
      console.log('   - Verify firewall is not blocking the connection');
    }
    
    process.exit(1);
  }
  
  console.log('✅ SMTP Connection Verified!\n');
  
  // Send test email
  console.log('📨 Sending test email...');
  const mailOptions = {
    from: emailFrom,
    to: recipientEmail,
    subject: 'InvoiceMe - SMTP Configuration Test',
    html: `
      <h2>✅ SMTP Configuration Test</h2>
      <p>Congratulations! Your SMTP configuration is working correctly.</p>
      <p><strong>Configuration Details:</strong></p>
      <ul>
        <li>Host: ${smtpHost}</li>
        <li>Port: ${smtpPort}</li>
        <li>From: ${emailFrom}</li>
      </ul>
      <p>You can now use email notifications in your InvoiceMe application.</p>
      <hr>
      <p><small>This is a test email sent from InvoiceMe SMTP test script.</small></p>
    `,
    text: `
SMTP Configuration Test

Congratulations! Your SMTP configuration is working correctly.

Configuration Details:
- Host: ${smtpHost}
- Port: ${smtpPort}
- From: ${emailFrom}

You can now use email notifications in your InvoiceMe application.

This is a test email sent from InvoiceMe SMTP test script.
    `,
  };
  
  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error('❌ Failed to send test email:');
      console.error(`   ${error.message}\n`);
      process.exit(1);
    }
    
    console.log('✅ Test email sent successfully!');
    console.log(`   Message ID: ${info.messageId}`);
    console.log(`   Response: ${info.response}\n`);
    console.log('🎉 Your SMTP configuration is working correctly!');
    console.log(`   Check ${recipientEmail} for the test email.\n`);
    process.exit(0);
  });
});
