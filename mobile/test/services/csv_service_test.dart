// Flutter imports
import 'package:flutter_test/flutter_test.dart';

// Local imports - Core
import '../../lib/core/services/csv_service.dart';

void main() {
  group('CsvService', () {
    test('toCsv should convert list of maps to CSV string', () {
      final data = [
        {'name': 'John', 'email': 'john@example.com', 'age': '30'},
        {'name': 'Jane', 'email': 'jane@example.com', 'age': '25'},
      ];
      final headers = ['name', 'email', 'age'];

      final result = CsvService.toCsv(data, headers);

      expect(result, contains('name,email,age'));
      expect(result, contains('John,john@example.com,30'));
      expect(result, contains('Jane,jane@example.com,25'));
    });

    test('toCsv should handle empty data', () {
      final data = <Map<String, dynamic>>[];
      final headers = ['name', 'email'];

      final result = CsvService.toCsv(data, headers);

      expect(result, 'name,email');
    });

    test('toCsv should escape commas in fields', () {
      final data = [
        {'name': 'John, Doe', 'email': 'john@example.com'},
      ];
      final headers = ['name', 'email'];

      final result = CsvService.toCsv(data, headers);

      expect(result, contains('"John, Doe"'));
    });

    test('fromCsv should parse CSV string to list of maps', () {
      final csvData = '''name,email,age
John,john@example.com,30
Jane,jane@example.com,25''';

      final result = CsvService.fromCsv(csvData);

      expect(result.length, 2);
      expect(result[0]['name'], 'John');
      expect(result[0]['email'], 'john@example.com');
      expect(result[1]['name'], 'Jane');
      expect(result[1]['email'], 'jane@example.com');
    });

    test('fromCsv should handle quoted fields', () {
      final csvData = '''name,email
"John, Doe",john@example.com''';

      final result = CsvService.fromCsv(csvData);

      expect(result.length, 1);
      expect(result[0]['name'], 'John, Doe');
    });

    test('validateCsvData should return valid for correct data', () {
      final data = [
        {'name': 'John', 'email': 'john@example.com'},
      ];
      final requiredHeaders = ['name', 'email'];

      final result = CsvService.validateCsvData(data, requiredHeaders, null);

      expect(result['valid'], isTrue);
      expect(result['errors'], isEmpty);
    });

    test('validateCsvData should return errors for missing headers', () {
      final data = [
        {'name': 'John'},
      ];
      final requiredHeaders = ['name', 'email'];

      final result = CsvService.validateCsvData(data, requiredHeaders, null);

      expect(result['valid'], isFalse);
      expect(result['errors'], isNotEmpty);
    });

    test('getInvoiceHeaders should return correct headers', () {
      final headers = CsvService.getInvoiceHeaders();

      expect(headers, contains('number'));
      expect(headers, contains('status'));
      expect(headers, contains('total'));
    });

    test('getClientHeaders should return correct headers', () {
      final headers = CsvService.getClientHeaders();

      expect(headers, contains('name'));
      expect(headers, contains('email'));
      expect(headers, contains('tags'));
    });
  });
}

