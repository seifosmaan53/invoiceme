import { Injectable } from '@nestjs/common';
import { InvoiceType } from '../../entities/invoice.entity';

@Injectable()
export class InvoiceNumberFormatterService {
  /**
   * Default format patterns
   */
  private readonly DEFAULT_INVOICE_FORMAT = 'INV-{YYYY}-{####}';
  private readonly DEFAULT_ESTIMATE_FORMAT = 'EST-{YYYY}-{####}';

  /**
   * Format an invoice number based on the user's pattern
   * @param format - The format pattern (e.g., "INV-{YYYY}-{####}")
   * @param type - Invoice type (invoice or estimate)
   * @param sequence - Sequence number
   * @param issueDate - Issue date (optional, defaults to today)
   * @returns Formatted invoice number
   */
  format(
    format: string | null | undefined,
    type: InvoiceType,
    sequence: number,
    issueDate?: Date,
  ): string {
    // Use default format if user hasn't configured one
    const pattern = format || (type === InvoiceType.INVOICE ? this.DEFAULT_INVOICE_FORMAT : this.DEFAULT_ESTIMATE_FORMAT);

    const date = issueDate || new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    // Replace placeholders
    let formatted = pattern
      .replace(/{PREFIX}/g, type === InvoiceType.INVOICE ? 'INV' : 'EST')
      .replace(/{YYYY}/g, String(year))
      .replace(/{YY}/g, String(year).slice(-2))
      .replace(/{MM}/g, month)
      .replace(/{DD}/g, day);

    // Handle sequence number placeholders
    // Support {####} for 4-digit padding, {###} for 3-digit, etc.
    const sequencePlaceholder = formatted.match(/{#+}/);
    if (sequencePlaceholder) {
      const padding = sequencePlaceholder[0].length - 2; // Subtract { and }
      const paddedSequence = String(sequence).padStart(padding, '0');
      formatted = formatted.replace(/{#+}/, paddedSequence);
    } else {
      // Fallback: replace any remaining {#} patterns
      formatted = formatted.replace(/{#}/g, String(sequence));
    }

    return formatted;
  }

  /**
   * Extract sequence number from an existing invoice number
   * This is used to determine the next sequence number
   * @param invoiceNumber - Existing invoice number
   * @param format - The format pattern used
   * @param type - Invoice type
   * @returns Extracted sequence number or null if extraction fails
   */
  extractSequence(
    invoiceNumber: string,
    format: string | null | undefined,
    type: InvoiceType,
  ): number | null {
    const pattern = format || (type === InvoiceType.INVOICE ? this.DEFAULT_INVOICE_FORMAT : this.DEFAULT_ESTIMATE_FORMAT);

    // Try to extract sequence from the pattern
    // For patterns like "INV-{YYYY}-{####}", extract the last numeric part
    const sequenceMatch = invoiceNumber.match(/(\d+)$/);
    if (sequenceMatch) {
      return parseInt(sequenceMatch[1], 10);
    }

    // Fallback: try to match common patterns
    const commonPattern = /^\w+-(\d{4})-(\d+)$/;
    const match = invoiceNumber.match(commonPattern);
    if (match) {
      return parseInt(match[2], 10);
    }

    return null;
  }

  /**
   * Validate if a format pattern is valid
   * @param format - Format pattern to validate
   * @returns True if valid, false otherwise
   */
  isValidFormat(format: string): boolean {
    if (!format || format.length > 100) {
      return false;
    }

    // Must contain at least one sequence placeholder
    if (!format.includes('{') || !format.includes('}')) {
      return false;
    }

    // Check for valid placeholders
    const validPlaceholders = ['{PREFIX}', '{YYYY}', '{YY}', '{MM}', '{DD}', '{#', '}'];
    const hasSequence = format.match(/{#+}/);
    
    return hasSequence !== null;
  }
}

