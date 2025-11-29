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
  };
}

@Injectable()
export class PdfService {
  private readonly templatePath: string;

  constructor() {
    // Handle both development and production paths
    const isProduction = __dirname.includes('dist');
    if (isProduction) {
      // In production, templates are in dist/core/templates
      this.templatePath = path.join(__dirname, 'templates', 'invoice.html');
    } else {
      // In development, templates are in src/core/templates
      this.templatePath = path.join(__dirname, 'templates', 'invoice.html');
    }
  }

  async generateInvoicePdf(data: InvoiceData | any): Promise<Buffer> {
    // Handle both old format (flat object) and new format (structured)
    const invoiceData = this.normalizeData(data);
    const html = await this.renderTemplate(invoiceData);
    
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      
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

      return Buffer.from(pdf);
    } finally {
      await browser.close();
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
      template = fs.readFileSync(this.templatePath, 'utf-8');
    } catch (error) {
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

    // Format currency helper
    const formatCurrency = (amount: number, currency: string = 'USD'): string => {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency,
      }).format(amount);
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

    // Replace template variables
    let html = template
      .replace(/\{\{invoiceNumber\}\}/g, invoice.number)
      .replace(/\{\{invoiceType\}\}/g, invoice.type === 'invoice' ? 'Invoice' : 'Estimate')
      .replace(/\{\{invoiceTypeDisplay\}\}/g, invoice.type === 'invoice' ? 'Invoice' : 'Estimate')
      .replace(/\{\{issueDate\}\}/g, issueDate)
      .replace(/\{\{#if dueDate\}\}/g, dueDate ? '' : '<!--')
      .replace(/\{\{\/if\}\}/g, dueDate ? '' : '-->')
      .replace(/\{\{dueDate\}\}/g, dueDate || '')
      .replace(/\{\{status\}\}/g, invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1))
      .replace(/\{\{currency\}\}/g, invoice.currency || 'USD')
      .replace(/\{\{companyName\}\}/g, user.companyName || 'InvoiceMe')
      .replace(/\{\{logoUrl\}\}/g, logoUrl)
      .replace(/\{\{primaryColor\}\}/g, primaryColor)
      .replace(/\{\{secondaryColor\}\}/g, secondaryColor)
      .replace(/\{\{fontFamily\}\}/g, fontFamily)
      .replace(/\{\{clientName\}\}/g, this.escapeHtml(client.name))
      .replace(/\{\{clientEmail\}\}/g, client.email ? this.escapeHtml(client.email) : '')
      .replace(/\{\{clientPhone\}\}/g, client.phone ? this.escapeHtml(client.phone) : '')
      .replace(/\{\{clientAddress\}\}/g, this.escapeHtml(clientAddress))
      .replace(/\{\{subtotal\}\}/g, formatCurrency(invoice.subtotal, invoice.currency))
      .replace(/\{\{taxTotal\}\}/g, formatCurrency(invoice.taxTotal, invoice.currency))
      .replace(/\{\{discountTotal\}\}/g, formatCurrency(invoice.discountTotal, invoice.currency))
      .replace(/\{\{total\}\}/g, formatCurrency(invoice.total, invoice.currency))
      .replace(/\{\{notes\}\}/g, invoice.notes ? this.escapeHtml(invoice.notes) : '')
      .replace(/\{\{showTaxOrDiscount\}\}/g, showTaxOrDiscount ? 'true' : '');

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
          <td style="text-align: right;">${formatCurrency(item.unitPrice, invoice.currency)}</td>
          ${taxCell}
          ${discountCell}
          <td>${formatCurrency(item.lineTotal, invoice.currency)}</td>
        </tr>`;
      })
      .join('');

    html = html.replace(/\{\{#each items\}\}([\s\S]*?)\{\{\/each\}\}/g, itemsHtml);

    // Replace status badge class
    const statusLower = invoice.status.toLowerCase();
    html = html.replace(/class="badge {{status}}"/g, `class="badge ${statusLower}"`);

    // Clean up remaining handlebars conditionals
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
<body>
  <div class="header">
    {{#if logoUrl}}
    <img src="{{logoUrl}}" alt="Logo" class="logo" />
    {{else}}
    <h1>InvoiceMe</h1>
    {{/if}}
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
</body>
</html>`;
  }
}
