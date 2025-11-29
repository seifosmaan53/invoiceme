import { Injectable } from '@nestjs/common';
import * as csvWriter from 'csv-writer';
import * as csvParse from 'csv-parse';
import { Readable } from 'stream';

@Injectable()
export class CsvService {
  /**
   * Convert array of objects to CSV string
   */
  async toCsv(
    data: Record<string, any>[],
    headers: { id: string; title: string }[],
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const csvStringifier = csvWriter.createObjectCsvStringifier({
        header: headers,
      });

      const header = csvStringifier.getHeaderString();
      const records = csvStringifier.stringifyRecords(data);

      resolve(header + records);
    });
  }

  /**
   * Parse CSV string or buffer to array of objects
   */
  async fromCsv(
    csvData: string | Buffer,
    options?: {
      columns?: boolean;
      skipEmptyLines?: boolean;
      trim?: boolean;
    },
  ): Promise<Record<string, any>[]> {
    return new Promise((resolve, reject) => {
      const parser = csvParse.parse({
        columns: options?.columns ?? true,
        skip_empty_lines: options?.skipEmptyLines ?? true,
        trim: options?.trim ?? true,
      });

      const records: Record<string, any>[] = [];

      parser.on('readable', () => {
        let record;
        while ((record = parser.read()) !== null) {
          records.push(record);
        }
      });

      parser.on('error', (err) => {
        reject(err);
      });

      parser.on('end', () => {
        resolve(records);
      });

      if (Buffer.isBuffer(csvData)) {
        const stream = Readable.from(csvData);
        stream.pipe(parser);
      } else {
        parser.write(csvData);
        parser.end();
      }
    });
  }

  /**
   * Generate CSV headers for clients
   */
  getClientHeaders(): { id: string; title: string }[] {
    return [
      { id: 'name', title: 'Name' },
      { id: 'email', title: 'Email' },
      { id: 'phone', title: 'Phone' },
      { id: 'address', title: 'Address' },
      { id: 'notes', title: 'Notes' },
      { id: 'tags', title: 'Tags' },
    ];
  }

  /**
   * Generate CSV headers for invoices
   */
  getInvoiceHeaders(): { id: string; title: string }[] {
    return [
      { id: 'number', title: 'Invoice Number' },
      { id: 'type', title: 'Type' },
      { id: 'status', title: 'Status' },
      { id: 'clientName', title: 'Client Name' },
      { id: 'clientEmail', title: 'Client Email' },
      { id: 'issueDate', title: 'Issue Date' },
      { id: 'dueDate', title: 'Due Date' },
      { id: 'currency', title: 'Currency' },
      { id: 'subtotal', title: 'Subtotal' },
      { id: 'taxTotal', title: 'Tax' },
      { id: 'discountTotal', title: 'Discount' },
      { id: 'total', title: 'Total' },
      { id: 'notes', title: 'Notes' },
    ];
  }
}

