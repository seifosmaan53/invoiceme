import { Injectable } from '@nestjs/common';
import * as puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import { Invoice } from '../../entities/invoice.entity';
import { InvoiceItem } from '../../entities/invoice-item.entity';
import { Client } from '../../entities/client.entity';

interface InvoiceData {
  invoice: Invoice;
  client: Client;
  items: InvoiceItem[];
  user?: {
    name?: string;
    companyName?: string;
  };
  settings?: {
    logoUrl?: string;
    primaryColor?: string;
    secondaryColor?: string;
    fontFamily?: string;
    layout?: 'classic' | 'minimal';
    showLogo?: boolean;
    showClientDetails?: boolean;
    showInvoiceDetails?: boolean;
    showNotes?: boolean;
    showFooter?: boolean;
    thankYouMessage?: string;
  };
}

@Injectable()
export class PdfService {
  private readonly templatePath: string;

  constructor() {
    // Handle both development and production paths
    // In development mode (start:dev), code runs from dist but source is in src
    // In production, code runs from dist and templates are copied there
    const isProduction = process.env.NODE_ENV === 'production';
    const isDist = __dirname.includes('dist');
    
    // Try multiple possible template locations with fallback order
    const possiblePaths: string[] = [];
    
    if (isDist) {
      // When running from dist directory
      // Try dist location first (where templates should be copied)
      possiblePaths.push(path.join(__dirname, '..', 'templates', 'invoice.html'));
      
      // Fallback: try source location (for dev mode)
      const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');
      possiblePaths.push(path.join(projectRoot, 'src', 'core', 'templates', 'invoice.html'));
    } else {
      // When running from src directory (unlikely but possible)
      possiblePaths.push(path.join(__dirname, '..', 'templates', 'invoice.html'));
    }
    
    // Find the first existing template path
    let foundPath: string | null = null;
    for (const templatePath of possiblePaths) {
      if (fs.existsSync(templatePath)) {
        foundPath = templatePath;
        break;
      }
    }
    
    // Use first path as default (will fallback to inline template if not found)
    this.templatePath = foundPath || possiblePaths[0];
    
    // Log template path for debugging
    console.log('PDF Service initialized with template path:', this.templatePath);
    console.log('Template file exists:', fs.existsSync(this.templatePath));
    console.log('Current __dirname:', __dirname);
    console.log('NODE_ENV:', process.env.NODE_ENV || 'undefined');
    if (!fs.existsSync(this.templatePath)) {
      console.warn('⚠️  Template file not found - will use inline template fallback');
    }
  }

  /**
   * Get the Chrome executable path for Puppeteer.
   * Explicitly sets the path to avoid Rosetta/x64 Node issues on Apple Silicon Macs.
   * 
   * On Apple Silicon Macs with x64 Node.js (running through Rosetta), we use
   * Puppeteer's bundled Chromium (which is arm64) to avoid Rosetta translation
   * performance issues. This can improve PDF generation speed by 3-5x.
   */
  private getChromeExecutablePath(): string | undefined {
    // 1) If set in .env, use that (most flexible - allows override)
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      return process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    // 2) On macOS with x64 Node.js, use bundled Chromium to avoid Rosetta
    // This handles the case where Node.js is running through Rosetta on Apple Silicon
    // Puppeteer's bundled Chromium is arm64 native, avoiding performance degradation
    if (process.platform === 'darwin' && process.arch === 'x64') {
      console.log('[PDF Generation] Detected x64 Node.js on macOS - using Puppeteer bundled Chromium to avoid Rosetta performance issues');
      return undefined; // Let Puppeteer use its bundled Chromium (arm64 native)
    }

    // 3) On macOS with arm64 Node.js, try system Chrome first
    if (process.platform === 'darwin' && process.arch === 'arm64') {
      const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      if (fs.existsSync(chromePath)) {
        return chromePath;
      }
      const chromiumPath = '/Applications/Chromium.app/Contents/MacOS/Chromium';
      if (fs.existsSync(chromiumPath)) {
        return chromiumPath;
      }
    }

    // 4) Fallback: let Puppeteer decide (for Linux/Windows or if Chrome not found)
    // Return undefined to let Puppeteer use its bundled Chromium
    return undefined;
  }

  async generateInvoicePdf(data: InvoiceData | any): Promise<Buffer> {
    try {
      // Validate input data
      if (!data) {
        throw new Error('Invoice data is required');
      }

      // Handle both old format (flat object) and new format (structured)
      const invoiceData = this.normalizeData(data);
      
      // Validate normalized data
      if (!invoiceData.invoice) {
        throw new Error('Invoice is required');
      }
      if (!invoiceData.client) {
        throw new Error('Client is required');
      }

      const html = await this.renderTemplate(invoiceData);
      
      // Validate HTML was generated
      if (!html || html.trim().length === 0) {
        throw new Error('Generated HTML template is empty');
      }

      // Log context for debugging
      const invoiceId = invoiceData.invoice?.id || 'unknown';
      const invoiceNumber = invoiceData.invoice?.number || 'unknown';
      const clientName = invoiceData.client?.name || 'unknown';
      console.log(`[PDF Generation] Starting PDF generation for invoice ${invoiceNumber} (ID: ${invoiceId}), client: ${clientName}`);
      
      console.log('[PDF Generation] Launching Puppeteer browser...');
      const chromePath = this.getChromeExecutablePath();
      
      // Try to launch browser with fallback logic
      let browser: puppeteer.Browser;
      const launchOptions: puppeteer.PuppeteerLaunchOptions = {
        headless: 'new', // Use new headless mode for better compatibility
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage', // Overcome limited resource problems
          '--disable-accelerated-2d-canvas', // Better compatibility
        ],
      };
      
      try {
        if (chromePath) {
          console.log(`[PDF Generation] Using Chrome executable: ${chromePath}`);
          launchOptions.executablePath = chromePath;
          browser = await puppeteer.launch(launchOptions);
        } else {
          console.log('[PDF Generation] Attempting to use Puppeteer bundled Chromium');
          // Try bundled Chromium first
          browser = await puppeteer.launch(launchOptions);
        }
        console.log('[PDF Generation] Browser launched successfully');
      } catch (bundledError: any) {
        // If bundled Chromium fails, try system Chrome as fallback
        if (!chromePath && process.platform === 'darwin') {
          console.warn('[PDF Generation] Bundled Chromium failed, trying system Chrome as fallback...');
          console.warn(`[PDF Generation] Error: ${bundledError?.message || bundledError}`);
          
          const systemChromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
          const systemChromiumPath = '/Applications/Chromium.app/Contents/MacOS/Chromium';
          
          let fallbackPath: string | null = null;
          if (fs.existsSync(systemChromePath)) {
            fallbackPath = systemChromePath;
          } else if (fs.existsSync(systemChromiumPath)) {
            fallbackPath = systemChromiumPath;
          }
          
          if (fallbackPath) {
            console.log(`[PDF Generation] Using fallback Chrome: ${fallbackPath}`);
            launchOptions.executablePath = fallbackPath;
            try {
              browser = await puppeteer.launch(launchOptions);
              console.log('[PDF Generation] Browser launched successfully with fallback');
            } catch (fallbackError: any) {
              console.error('[PDF Generation] Fallback Chrome also failed:', fallbackError?.message || fallbackError);
              throw new Error(
                `Failed to launch browser. Bundled Chromium failed: ${bundledError?.message || 'Unknown error'}. ` +
                `Fallback Chrome also failed: ${fallbackError?.message || 'Unknown error'}. ` +
                `Please ensure Chrome is installed or set PUPPETEER_EXECUTABLE_PATH environment variable.`
              );
            }
          } else {
            throw new Error(
              `Failed to launch bundled Chromium: ${bundledError?.message || 'Unknown error'}. ` +
              `No system Chrome found. Please install Chrome or set PUPPETEER_EXECUTABLE_PATH environment variable.`
            );
          }
        } else {
          // Re-throw if we don't have a fallback option
          throw bundledError;
        }
      }

      try {
        console.log('[PDF Generation] Creating new page...');
        const page = await browser.newPage();
        
        console.log(`[PDF Generation] Setting page content (HTML length: ${html.length} chars)...`);
        // Set content with timeout to prevent hanging
        await page.setContent(html, { 
          waitUntil: 'networkidle0',
          timeout: 30000, // 30 second timeout
        });
        console.log('[PDF Generation] Page content set successfully');
        
        console.log('[PDF Generation] Generating PDF...');
        const pdf = await page.pdf({
          format: 'A4',
          margin: {
            top: '20mm',
            right: '20mm',
            bottom: '20mm',
            left: '20mm',
          },
          printBackground: true,
        });
        console.log(`[PDF Generation] PDF generated successfully (${pdf.length} bytes)`);

        return Buffer.from(pdf);
      } finally {
        await browser.close();
      }
    } catch (error) {
      // Try to extract context for better error logging
      let invoiceContext = '';
      try {
        const invoiceId = data?.invoice?.id || data?.id || 'unknown';
        const invoiceNumber = data?.invoice?.number || data?.number || 'unknown';
        invoiceContext = ` (Invoice: ${invoiceNumber}, ID: ${invoiceId})`;
      } catch {
        // Ignore errors when extracting context
      }

      console.error(`=== PDF SERVICE GENERATION ERROR${invoiceContext} ===`);
      console.error('Error type:', error?.constructor?.name || typeof error);

      if (error instanceof Error) {
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        // Re-throw the original error so Nest (or your controller) sees the real message
        // This preserves the original error message and stack trace
        throw error;
      }

      // Fallback for non-Error objects
      try {
        console.error(
          'Error object (stringified):',
          JSON.stringify(error, Object.getOwnPropertyNames(error), 2),
        );
      } catch {
        console.error('Error object (as string):', String(error));
      }

      throw new Error('Failed to generate PDF (unknown non-Error object)');
    }
  }

  private normalizeData(data: any): InvoiceData {
    // If data is already structured, return as is
    if (data.invoice && data.client && data.items) {
      return data;
    }

    // Otherwise, assume flat structure from old format
    return {
      invoice: data as Invoice,
      client: data.client as Client,
      items: data.items || ([] as InvoiceItem[]),
      user: data.user || {},
    };
  }

  private async renderTemplate(data: InvoiceData): Promise<string> {
    // Check if template file exists, if not use inline template
    let template: string;
    try {
      if (!fs.existsSync(this.templatePath)) {
        console.warn(`Template file not found at ${this.templatePath}, using inline template`);
        template = this.getInlineTemplate();
      } else {
        template = fs.readFileSync(this.templatePath, 'utf-8');
        console.log(`Template loaded from ${this.templatePath} (${template.length} chars)`);
      }
    } catch (error) {
      console.error(`Error reading template file from ${this.templatePath}:`, error);
      // Fallback to inline template if file not found
      template = this.getInlineTemplate();
    }
    
    const invoice = data.invoice;
    const client = data.client;
    const items = data.items || [];
    const user = data.user || {};

    // Format dates
    const issueDate = this.formatDate(invoice.issueDate);
    const dueDate = invoice.dueDate ? this.formatDate(invoice.dueDate) : null;

    // Safe getters with defaults (move before formatCurrency function)
    const invoiceNumber = invoice.number || 'N/A';
    const invoiceType = invoice.type || 'invoice';
    const invoiceStatus = invoice.status || 'draft';
    const invoiceCurrency = invoice.currency || 'USD';
    const clientName = client.name || 'N/A';
    const invoiceSubtotal = invoice.subtotal || 0;
    const invoiceTaxTotal = invoice.taxTotal || 0;
    const invoiceDiscountTotal = invoice.discountTotal || 0;
    const invoiceTotal = invoice.total || 0;
    const statusDisplay = invoiceStatus.charAt(0).toUpperCase() + invoiceStatus.slice(1);

    // Format currency helper - robust handling of number/string and default currency
    const formatCurrency = (amount: number | string, currency: string = invoiceCurrency): string => {
      const num = typeof amount === 'string' ? Number(amount) : amount;
      if (isNaN(num)) {
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: invoiceCurrency,
        }).format(0);
      }
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency || invoiceCurrency,
      }).format(num);
    };

    // Format client address
    let clientAddress = '';
    if (client.addressJson) {
      const addr = typeof client.addressJson === 'string' 
        ? JSON.parse(client.addressJson) 
        : client.addressJson;
      const parts = [];
      if (addr.street) parts.push(addr.street);
      if (addr.city) parts.push(addr.city);
      if (addr.state) parts.push(addr.state);
      if (addr.zip) parts.push(addr.zip);
      if (addr.country) parts.push(addr.country);
      clientAddress = parts.join(', ');
    }

    // Check if any item has tax or discount
    const showTaxOrDiscount = items.some(
      (item) => (item.taxRate && item.taxRate > 0) || (item.discountRate && item.discountRate > 0)
    );

    // Get customization settings
    const settings = data.settings || {};
    const logoUrl = settings.logoUrl || '';
    const primaryColor = settings.primaryColor || '#4a90e2';
    const secondaryColor = settings.secondaryColor || '#333333';
    const fontFamily = settings.fontFamily || 'Arial';
    const layout = settings.layout === 'minimal' ? 'minimal' : 'classic';
    const showLogo = settings.showLogo !== false;
    const showClientDetails = settings.showClientDetails !== false;
    const showInvoiceDetails = settings.showInvoiceDetails !== false;
    const showFooter = settings.showFooter !== false;
    const rawNotes = invoice.notes ? this.escapeHtml(invoice.notes) : '';
    const hasNotesContent = Boolean(rawNotes);
    const showNotes = settings.showNotes !== false && hasNotesContent;
    const thankYouMessage = settings.thankYouMessage?.trim() || 'Thank you for your business!';
    const thankYouMessageEscaped = this.escapeHtml(thankYouMessage);
    const companyName = this.escapeHtml(user.companyName || 'InvoiceMe');

    const bodyClass = [
      `layout-${layout}`,
      showLogo && logoUrl ? 'show-logo' : 'hide-logo',
      showClientDetails ? 'show-client-details' : 'hide-client-details',
      showInvoiceDetails ? 'show-invoice-details' : 'hide-invoice-details',
      showFooter ? 'show-footer' : 'hide-footer',
      showNotes ? 'show-notes' : 'hide-notes',
    ].join(' ');

    const escapedLogoUrl = logoUrl ? this.escapeHtml(logoUrl) : '';
    const logoBlock = showLogo && escapedLogoUrl
      ? `<img src="${escapedLogoUrl}" alt="Company logo" class="company-logo" />`
      : '';

    const notesSection = showNotes
      ? `
    <div class="notes-section">
      <div class="section-title">Notes</div>
      <div class="notes-content">${rawNotes}</div>
    </div>`
      : '';

    const footerSection = showFooter
      ? `
    <div class="footer">
      <p>${thankYouMessageEscaped}</p>
      <p class="brand">${companyName}</p>
      <p>This is a computer-generated ${invoiceType === 'invoice' ? 'invoice' : 'estimate'}.</p>
    </div>`
      : '';

    // Replace template variables
    let html = template
      .replace(/\{\{invoiceNumber\}\}/g, invoiceNumber)
      .replace(/\{\{invoiceType\}\}/g, invoiceType === 'invoice' ? 'Invoice' : 'Estimate')
      .replace(/\{\{invoiceTypeDisplay\}\}/g, invoiceType === 'invoice' ? 'Invoice' : 'Estimate')
      .replace(/\{\{issueDate\}\}/g, issueDate)
      .replace(/\{\{#if dueDate\}\}/g, dueDate ? '' : '<!--')
      .replace(/\{\{\/if\}\}/g, dueDate ? '' : '-->')
      .replace(/\{\{dueDate\}\}/g, dueDate || '')
      .replace(/\{\{status\}\}/g, statusDisplay)
      .replace(/\{\{currency\}\}/g, invoiceCurrency)
      .replace(/\{\{companyName\}\}/g, companyName)
      .replace(/\{\{logoUrl\}\}/g, logoUrl)
      .replace(/\{\{primaryColor\}\}/g, primaryColor)
      .replace(/\{\{secondaryColor\}\}/g, secondaryColor)
      .replace(/\{\{fontFamily\}\}/g, fontFamily)
      .replace(/\{\{clientName\}\}/g, this.escapeHtml(clientName))
      .replace(/\{\{clientEmail\}\}/g, client.email ? this.escapeHtml(client.email) : '')
      .replace(/\{\{clientPhone\}\}/g, client.phone ? this.escapeHtml(client.phone) : '')
      .replace(/\{\{clientAddress\}\}/g, this.escapeHtml(clientAddress))
      .replace(/\{\{subtotal\}\}/g, formatCurrency(invoiceSubtotal, invoiceCurrency))
      .replace(/\{\{taxTotal\}\}/g, formatCurrency(invoiceTaxTotal, invoiceCurrency))
      .replace(/\{\{discountTotal\}\}/g, formatCurrency(invoiceDiscountTotal, invoiceCurrency))
      .replace(/\{\{total\}\}/g, formatCurrency(invoiceTotal, invoiceCurrency))
      .replace(/\{\{notes\}\}/g, rawNotes)
      .replace(/\{\{showTaxOrDiscount\}\}/g, showTaxOrDiscount ? 'true' : '')
      .replace(/\{\{bodyClass\}\}/g, bodyClass.trim())
      .replace(/\{\{logoBlock\}\}/g, logoBlock)
      .replace(/\{\{notesSection\}\}/g, notesSection)
      .replace(/\{\{footerSection\}\}/g, footerSection);

    // Replace items
    const itemsHtml = items
      .map((item) => {
        const taxRate = item.taxRate && item.taxRate > 0 ? `${item.taxRate}%` : '-';
        const discountRate = item.discountRate && item.discountRate > 0 ? `${item.discountRate}%` : '-';
        const taxCell = showTaxOrDiscount ? `<td style="text-align: center;">${taxRate}</td>` : '';
        const discountCell = showTaxOrDiscount ? `<td style="text-align: center;">${discountRate}</td>` : '';
        
        return `
        <tr>
          <td class="description">${this.escapeHtml(item.description)}</td>
          <td style="text-align: center;">${item.quantity}</td>
          <td style="text-align: right;">${formatCurrency(item.unitPrice, invoiceCurrency)}</td>
          ${taxCell}
          ${discountCell}
          <td>${formatCurrency(item.lineTotal, invoiceCurrency)}</td>
        </tr>`;
      })
      .join('');

    html = html.replace(/\{\{#each items\}\}([\s\S]*?)\{\{\/each\}\}/g, itemsHtml);

    // Replace status badge class - use invoiceStatus (already has safe default)
    const statusLower = invoiceStatus.toLowerCase();
    html = html.replace(/class="badge {{status}}"/g, `class="badge ${statusLower}"`);

    // Handle client field conditionals (email, phone, address)
    const hasClientEmail = Boolean(client.email);
    const hasClientPhone = Boolean(client.phone);
    const hasClientAddress = Boolean(clientAddress);
    const hasDiscountTotal = invoiceDiscountTotal > 0;
    const hasTaxTotal = invoiceTaxTotal > 0;

    // Replace client conditionals
    html = html.replace(/\{\{#if clientEmail\}\}([\s\S]*?)\{\{\/if\}\}/g, hasClientEmail ? '$1' : '');
    html = html.replace(/\{\{#if clientPhone\}\}([\s\S]*?)\{\{\/if\}\}/g, hasClientPhone ? '$1' : '');
    html = html.replace(/\{\{#if clientAddress\}\}([\s\S]*?)\{\{\/if\}\}/g, hasClientAddress ? '$1' : '');
    html = html.replace(/\{\{#if discountTotal\}\}([\s\S]*?)\{\{\/if\}\}/g, hasDiscountTotal ? '$1' : '');
    html = html.replace(/\{\{#if taxTotal\}\}([\s\S]*?)\{\{\/if\}\}/g, hasTaxTotal ? '$1' : '');

    // Clean up any remaining handlebars conditionals
    html = html.replace(/\{\{#if ([^}]+)\}\}/g, '');
    html = html.replace(/\{\{\/if\}\}/g, '');

    return html;
  }

  private formatDate(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  private escapeHtml(text: string): string {
    if (!text) return '';
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return String(text).replace(/[&<>"']/g, (m) => map[m]);
  }

  private getInlineTemplate(): string {
    // Return the HTML template as a string if file not found
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Invoice {{invoiceNumber}}</title>
  <style>
    body { font-family: {{fontFamily}}, sans-serif; padding: 40px; }
    .header { border-bottom: 2px solid {{primaryColor}}; padding-bottom: 20px; margin-bottom: 30px; }
    .logo { max-height: 80px; margin-bottom: 10px; }
    .invoice-info { text-align: right; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f5f5f5; color: {{secondaryColor}}; }
    .total { font-weight: bold; font-size: 18px; color: {{primaryColor}}; }
    h1, h2 { color: {{primaryColor}}; }
  </style>
</head>
<body class="{{bodyClass}}">
  <div class="header">
    {{logoBlock}}
    <div class="invoice-info">
      <h2>{{invoiceType}} #{{invoiceNumber}}</h2>
      <p>Date: {{issueDate}}</p>
      {{#if dueDate}}<p>Due: {{dueDate}}</p>{{/if}}
    </div>
  </div>
  <div>
    <strong>Bill To:</strong><br>
    {{clientName}}<br>
    {{clientEmail}}<br>
    {{clientPhone}}
  </div>
  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th>Qty</th>
        <th>Price</th>
        <th>Total</th>
      </tr>
    </thead>
    <tbody>
      {{#each items}}
      <tr>
        <td>{{this.description}}</td>
        <td>{{this.quantity}}</td>
        <td>{{formatCurrency this.unitPrice ../currency}}</td>
        <td>{{formatCurrency this.lineTotal ../currency}}</td>
      </tr>
      {{/each}}
    </tbody>
  </table>
  <div style="text-align: right;">
    <p>Subtotal: {{subtotal}}</p>
    <p>Tax: {{taxTotal}}</p>
    <p class="total">Total: {{total}}</p>
  </div>
  {{notesSection}}
  {{footerSection}}
</body>
</html>`;
  }
}
