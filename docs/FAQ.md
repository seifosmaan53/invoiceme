# ❓ InvoiceMe FAQ

Frequently asked questions for users and administrators.

---

## General Questions

### What is InvoiceMe?

InvoiceMe is a professional invoice management system designed for businesses that want to own and control their data. It works offline, syncs across all your devices, and can be self-hosted on your own server.

### Do I need internet to use InvoiceMe?

No! InvoiceMe works offline. You can create invoices, edit clients, and view data without internet. Changes are automatically synced when you reconnect.

### Which devices are supported?

InvoiceMe works on:
- **iPhone** (iOS 12+)
- **iPad** (iOS 12+)
- **Android** phones and tablets (Android 8+)
- **Desktop** (Windows, macOS, Linux)
- **Web** (any modern browser)

### How much does it cost?

InvoiceMe is a one-time purchase. You own the software and host it yourself. No monthly fees, no subscriptions.

---

## Setup & Installation

### How do I install InvoiceMe?

See the [Deployment Guide](DEPLOYMENT_GUIDE.md) for complete installation instructions. Quick start:

1. Install Docker
2. Clone the repository
3. Configure environment variables
4. Run `docker-compose up -d`

### Do I need a server?

You can run InvoiceMe on:
- Your own computer (for personal use)
- A cloud server (DigitalOcean, AWS, etc.)
- A local network server

### What are the system requirements?

- **Server:** 2GB RAM, 20GB storage, Linux/macOS
- **Mobile:** iOS 12+ or Android 8+
- **Database:** PostgreSQL 14+

---

## Features

### Can I customize invoice numbers?

Yes! Invoice numbers can be customized per user. Default format: `INV-YYYY-###`

### Can I send invoices via email?

Yes! Configure SMTP settings in your environment variables, then use the "Send Invoice" feature.

### Can I accept online payments?

Yes! InvoiceMe integrates with Stripe for secure online payments.

### Can I export my data?

Yes! You can export:
- Clients to CSV
- Invoices to CSV
- Complete data export (GDPR format)

### Can I delete all my data?

Yes! Use the GDPR delete endpoint to remove all your data (Right to be Forgotten).

---

## Data & Security

### Where is my data stored?

Your data is stored in your own PostgreSQL database. You have complete control and ownership.

### Is my data encrypted?

Yes! Sensitive fields (email, phone, notes) are encrypted at rest using AES encryption.

### Is my data backed up?

InvoiceMe includes backup scripts. Set up automated daily backups using the provided scripts.

### Can multiple users access the same data?

Each user has their own account and sees only their own data. Multi-user support is available through separate user accounts.

---

## Troubleshooting

### I can't log in. What should I do?

1. Check your email and password
2. Use "Forgot Password" to reset
3. Clear app cache and try again
4. Check backend logs for errors

### The app won't connect to the server.

1. Verify the API URL is correct
2. Check if backend is running
3. Verify CORS configuration
4. Check network connectivity

### Invoices aren't syncing.

1. Check internet connection
2. Manually trigger sync (Settings → Sync Now)
3. Check backend logs
4. Verify database connection

### PDFs won't generate.

1. Check backend logs
2. Verify Puppeteer is installed
3. Check S3/MinIO configuration
4. Verify file permissions

---

## Technical Questions

### Can I customize the invoice template?

Yes! Edit the HTML template in `backend/src/core/services/templates/invoice.html`

### Can I add custom fields?

Yes! You can extend the database schema and add custom fields to clients or invoices.

### Can I integrate with other services?

Yes! InvoiceMe has a REST API that can be integrated with other systems.

### How do I update InvoiceMe?

1. Pull latest code: `git pull`
2. Run migrations: `npm run migration:run`
3. Rebuild: `npm run build`
4. Restart: `pm2 restart invoiceme-api` or `docker-compose restart`

---

## Support

### Where can I get help?

- Check the [Troubleshooting Guide](TROUBLESHOOTING_GUIDE.md)
- Review the [User Manual](USER_MANUAL.md)
- Check the [Developer Guide](DEVELOPER_GUIDE.md)
- Review API documentation at `/api/docs` (if enabled)

### How do I report a bug?

1. Check if it's a known issue in the troubleshooting guide
2. Review backend logs
3. Check browser/device console
4. Document steps to reproduce
5. Report with logs and error messages

---

## Business Questions

### Can I resell InvoiceMe?

Check your license agreement. InvoiceMe is typically sold as a one-time purchase for end-user use.

### Can I white-label InvoiceMe?

Yes! You can customize branding, colors, and templates to match your business.

### Do you offer support?

Support depends on your purchase agreement. Check included support terms.

---

## Advanced Topics

### How do I set up SSL/HTTPS?

See the [Deployment Guide](DEPLOYMENT_GUIDE.md) section on SSL/HTTPS setup using Let's Encrypt.

### How do I configure a CDN?

Set `CDN_BASE_URL` in your environment variables to enable CDN for images and PDFs.

### How do I enable 2FA?

1. Go to Settings
2. Enable Two-Factor Authentication
3. Scan QR code with authenticator app
4. Enter verification code

### How do I configure email notifications?

Set SMTP environment variables:
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASSWORD`

---

**Last Updated:** January 2025

