# 🎥 InvoiceMe Video Tutorials

Scripts and outlines for creating video tutorials.

---

## Tutorial 1: Getting Started (5 minutes)

### Outline

1. **Introduction (30s)**
   - What is InvoiceMe
   - Key features
   - Who it's for

2. **Installation (2m)**
   - Docker setup
   - Environment configuration
   - Starting services
   - Verifying installation

3. **First Login (1m)**
   - Creating account
   - Logging in
   - Dashboard overview

4. **Creating Your First Client (1m)**
   - Adding client information
   - Saving client
   - Viewing client list

5. **Creating Your First Invoice (1m)**
   - Selecting client
   - Adding line items
   - Previewing invoice
   - Saving invoice

### Script

**Introduction:**
"Welcome to InvoiceMe! InvoiceMe is a professional invoice management system that you can host yourself. It works offline, syncs across all your devices, and gives you complete control over your data."

**Installation:**
"Let's get started. First, make sure you have Docker installed. Then, clone the repository and copy the environment file. Edit the .env file with your configuration, then run docker-compose up -d. The backend will be available at localhost:3000."

**First Login:**
"Open the InvoiceMe app and create your account. Enter your email, password, and company name. Once registered, you'll be automatically logged in and see the dashboard."

**Creating Your First Client:**
"To create an invoice, you first need a client. Tap the Clients tab, then the plus button. Fill in the client's name, email, and phone. You can also add notes and tags to organize clients. Tap Save."

**Creating Your First Invoice:**
"Now let's create an invoice. Go to the Invoices tab and tap the plus button. Select your client, then add line items. Enter a description, quantity, and price. The totals are calculated automatically. Tap Preview to see how it looks, then Save."

---

## Tutorial 2: Managing Clients (3 minutes)

### Outline

1. **Client List (30s)**
   - Viewing all clients
   - Search functionality
   - Filtering by tags

2. **Adding Clients (1m)**
   - Required vs optional fields
   - Adding notes
   - Adding tags
   - Saving client

3. **Editing Clients (1m)**
   - Opening client details
   - Updating information
   - Managing tags
   - Saving changes

4. **Organizing Clients (30s)**
   - Using tags
   - Filtering by tags
   - Best practices

### Script

**Client List:**
"The Clients screen shows all your clients. Use the search bar to find clients by name, email, or phone. You can also filter by tags using the filter button."

**Adding Clients:**
"When adding a client, only the name is required. However, adding email and phone makes it easier to contact them. Notes are great for special instructions or payment terms. Tags help you organize clients - for example, tag VIP clients or wholesale customers."

**Editing Clients:**
"To edit a client, tap on them in the list. You'll see all their information. Make your changes and tap Save. You can also add or remove tags here."

**Organizing Clients:**
"Tags are powerful for organization. Create tags like 'VIP', 'Wholesale', 'Retail', or 'Local'. Then filter by tag to see only those clients."

---

## Tutorial 3: Creating Invoices (5 minutes)

### Outline

1. **Invoice Basics (1m)**
   - Invoice vs Estimate
   - Selecting client
   - Setting dates

2. **Adding Line Items (2m)**
   - Description
   - Quantity and price
   - Tax rates
   - Discounts
   - Automatic totals

3. **Invoice Details (1m)**
   - Adding notes
   - Setting status
   - Previewing invoice

4. **Saving and Sending (1m)**
   - Saving invoice
   - Sending via email
   - Generating PDF
   - Sharing invoice

### Script

**Invoice Basics:**
"Start by choosing whether this is an Invoice or an Estimate. Select the client, then set the issue date and due date. The invoice number is generated automatically."

**Adding Line Items:**
"Add line items by tapping Add Item. Enter a description, quantity, and unit price. You can add tax rates and discounts per item. The line total is calculated automatically, and the invoice total updates in real-time."

**Invoice Details:**
"You can add notes at the bottom of the invoice - payment terms, special instructions, etc. Set the status - Draft, Sent, Paid, or Overdue. Use Preview to see exactly how the invoice will look."

**Saving and Sending:**
"Tap Save to save the invoice. From the invoice detail screen, you can send it via email, generate a PDF, or share it using your device's native share options."

---

## Tutorial 4: Dashboard and Reports (4 minutes)

### Outline

1. **Dashboard Overview (1m)**
   - Key metrics
   - Unpaid invoices
   - Overdue invoices
   - Monthly totals

2. **Charts and Visualizations (2m)**
   - Revenue chart
   - Status pie chart
   - Interpreting data

3. **Filtering and Navigation (1m)**
   - Filtering invoices
   - Navigating to details
   - Exporting data

### Script

**Dashboard Overview:**
"The Dashboard gives you a quick overview of your business. You'll see total unpaid invoices, overdue invoices, and monthly revenue. Tap any card to see the filtered list."

**Charts and Visualizations:**
"The Revenue chart shows your income over the last 6 months. The Status pie chart shows how many invoices are paid, unpaid, or overdue. These help you understand your business at a glance."

**Filtering and Navigation:**
"Tap any dashboard card to see filtered invoices. For example, tap 'Overdue Invoices' to see all overdue invoices. You can also export your data to CSV for further analysis."

---

## Tutorial 5: Offline Mode and Sync (3 minutes)

### Outline

1. **Working Offline (1m)**
   - Creating invoices offline
   - Editing clients offline
   - Viewing cached data

2. **Automatic Sync (1m)**
   - How sync works
   - When sync happens
   - Sync indicators

3. **Manual Sync (1m)**
   - Triggering manual sync
   - Checking sync status
   - Resolving conflicts

### Script

**Working Offline:**
"InvoiceMe works completely offline. You can create invoices, edit clients, and view all your data even without internet. All changes are saved locally and queued for sync."

**Automatic Sync:**
"When you reconnect to the internet, InvoiceMe automatically syncs your changes. It pushes your local changes to the server and pulls any updates from other devices. This happens in the background."

**Manual Sync:**
"If you want to sync immediately, go to Settings and tap 'Sync Now'. You'll see a confirmation when sync completes. If there are conflicts, the server version wins."

---

## Tutorial 6: Settings and Configuration (4 minutes)

### Outline

1. **User Settings (1m)**
   - Viewing profile
   - Updating information
   - Company details

2. **Theme Settings (1m)**
   - Light mode
   - Dark mode
   - System default

3. **Security Settings (1m)**
   - Two-factor authentication
   - Password change
   - Session management

4. **Data Management (1m)**
   - Exporting data
   - Deleting data
   - Backup information

### Script

**User Settings:**
"In Settings, you can view your profile, update your name, and change your company information. This information appears on your invoices."

**Theme Settings:**
"Choose your preferred theme - Light, Dark, or System Default. The System Default option follows your device's theme settings."

**Security Settings:**
"Enable Two-Factor Authentication for extra security. You'll need an authenticator app like Google Authenticator. You can also change your password here."

**Data Management:**
"You can export all your data in GDPR format, or delete all your data if needed. Remember to set up regular backups using the provided backup scripts."

---

## Production Tips

### Recording Guidelines

1. **Screen Resolution:** Record at 1920x1080 or higher
2. **Frame Rate:** 30fps minimum
3. **Audio:** Use a good microphone, minimize background noise
4. **Editing:** Add captions, highlight important areas
5. **Length:** Keep each tutorial under 5 minutes

### Post-Production

1. Add intro/outro screens
2. Include chapter markers
3. Add call-to-action at end
4. Create thumbnail images
5. Optimize for web (MP4, H.264)

### Distribution

- Upload to YouTube
- Embed in documentation
- Include in user manual
- Add to onboarding flow

---

**Last Updated:** January 2025

