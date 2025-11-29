import 'dart:convert';
import 'package:flutter/foundation.dart';

/// Service for CSV export and import operations
class CsvService {
  /// Convert list of maps to CSV string
  static String toCsv(List<Map<String, dynamic>> data, List<String> headers) {
    if (data.isEmpty) {
      return headers.join(',');
    }

    final buffer = StringBuffer();
    
    // Write headers
    buffer.writeln(_escapeCsvRow(headers));
    
    // Write data rows
    for (final row in data) {
      final values = headers.map((header) => row[header]?.toString() ?? '').toList();
      buffer.writeln(_escapeCsvRow(values));
    }
    
    return buffer.toString();
  }

  /// Escape CSV field (handle commas, quotes, newlines)
  static String _escapeCsvField(String field) {
    if (field.contains(',') || field.contains('"') || field.contains('\n')) {
      // Escape quotes by doubling them, then wrap in quotes
      return '"${field.replaceAll('"', '""')}"';
    }
    return field;
  }

  /// Escape a row of CSV fields
  static String _escapeCsvRow(List<String> fields) {
    return fields.map(_escapeCsvField).join(',');
  }

  /// Parse CSV string to list of maps
  static List<Map<String, dynamic>> fromCsv(String csvData) {
    final lines = csvData.split('\n').where((line) => line.trim().isNotEmpty).toList();
    if (lines.isEmpty) {
      return [];
    }

    // Parse header
    final headers = _parseCsvLine(lines[0]);
    
    // Parse data rows
    final data = <Map<String, dynamic>>[];
    for (int i = 1; i < lines.length; i++) {
      final values = _parseCsvLine(lines[i]);
      if (values.length == headers.length) {
        final row = <String, dynamic>{};
        for (int j = 0; j < headers.length; j++) {
          row[headers[j]] = values[j];
        }
        data.add(row);
      }
    }
    
    return data;
  }

  /// Parse a single CSV line (handles quoted fields)
  static List<String> _parseCsvLine(String line) {
    final fields = <String>[];
    final buffer = StringBuffer();
    bool inQuotes = false;
    
    for (int i = 0; i < line.length; i++) {
      final char = line[i];
      
      if (char == '"') {
        if (inQuotes && i + 1 < line.length && line[i + 1] == '"') {
          // Escaped quote
          buffer.write('"');
          i++; // Skip next quote
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
        }
      } else if (char == ',' && !inQuotes) {
        // End of field
        fields.add(buffer.toString().trim());
        buffer.clear();
      } else {
        buffer.write(char);
      }
    }
    
    // Add last field
    fields.add(buffer.toString().trim());
    
    return fields;
  }

  /// Validate CSV data structure
  static Map<String, dynamic> validateCsvData(
    List<Map<String, dynamic>> data,
    List<String> requiredHeaders,
    Map<String, Function(dynamic)>? validators,
  ) {
    final errors = <String>[];
    final warnings = <String>[];
    
    if (data.isEmpty) {
      return {
        'valid': false,
        'errors': ['CSV file is empty'],
        'warnings': [],
      };
    }
    
    // Check headers
    if (data.isNotEmpty) {
      final firstRow = data.first;
      final missingHeaders = requiredHeaders.where((h) => !firstRow.containsKey(h)).toList();
      if (missingHeaders.isNotEmpty) {
        errors.add('Missing required columns: ${missingHeaders.join(", ")}');
      }
    }
    
    // Validate each row
    for (int i = 0; i < data.length; i++) {
      final row = data[i];
      final rowNum = i + 2; // +2 because row 1 is header, and we're 0-indexed
      
      // Run custom validators if provided
      if (validators != null) {
        for (final entry in validators.entries) {
          final header = entry.key;
          final validator = entry.value;
          if (row.containsKey(header)) {
            try {
              validator(row[header]);
            } catch (e) {
              errors.add('Row $rowNum, column "$header": ${e.toString()}');
            }
          }
        }
      }
    }
    
    return {
      'valid': errors.isEmpty,
      'errors': errors,
      'warnings': warnings,
      'rowCount': data.length,
    };
  }

  /// Get invoice CSV headers
  static List<String> getInvoiceHeaders() {
    return [
      'number',
      'type',
      'status',
      'clientName',
      'clientEmail',
      'issueDate',
      'dueDate',
      'currency',
      'subtotal',
      'taxTotal',
      'discountTotal',
      'total',
      'notes',
    ];
  }

  /// Get client CSV headers
  static List<String> getClientHeaders() {
    return [
      'name',
      'email',
      'phone',
      'address',
      'notes',
      'tags',
    ];
  }
}

