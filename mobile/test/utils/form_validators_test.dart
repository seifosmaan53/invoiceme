// Flutter imports
import 'package:flutter_test/flutter_test.dart';

// Local imports - Core
import '../../lib/core/utils/form_validators.dart';

void main() {
  group('FormValidators', () {
    test('email should return null for valid email', () {
      final result = FormValidators.email('test@example.com');
      expect(result, isNull);
    });

    test('email should return error for invalid email', () {
      final result = FormValidators.email('invalid-email');
      expect(result, isNotNull);
      expect(result, contains('valid email'));
    });

    test('email should return error for empty email', () {
      final result = FormValidators.email('');
      expect(result, isNotNull);
      expect(result, contains('required'));
    });

    test('required should return null for non-empty string', () {
      final result = FormValidators.required('test');
      expect(result, isNull);
    });

    test('required should return error for empty string', () {
      final result = FormValidators.required('');
      expect(result, isNotNull);
      expect(result, contains('required'));
    });

    test('minLength should return null for valid length', () {
      final result = FormValidators.minLength('password123', 6);
      expect(result, isNull);
    });

    test('minLength should return error for short password', () {
      final result = FormValidators.minLength('short', 6);
      expect(result, isNotNull);
      expect(result, contains('at least 6 characters'));
    });
  });
}

