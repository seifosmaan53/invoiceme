// Flutter imports
import 'package:flutter_test/flutter_test.dart';

// Local imports - Core
import '../../lib/core/utils/attachment_url.dart';

void main() {
  group('openableAttachmentUri', () {
    test('opens absolute http(s) URLs', () {
      for (final url in [
        'https://bucket.s3.amazonaws.com/invoices/1/attachments/a.png?X-Amz-Signature=abc',
        'http://minio:9000/invoiceme/invoices/1/attachments/a.pdf',
        'HTTPS://cdn.example.com/file.jpg',
      ]) {
        expect(openableAttachmentUri(url), isNotNull, reason: url);
      }
      expect(openableAttachmentUri('https://cdn.example.com/f.jpg')!.host, 'cdn.example.com');
    });

    test('refuses anything a cached row could hold that must not be opened', () {
      for (final url in [
        null,
        '',
        'javascript:alert(1)',
        'JavaScript:alert(1)',
        'data:text/html;base64,PHNjcmlwdD4=',
        'file:///etc/passwd',
        'intent://scan/#Intent;scheme=zxing;end',
        'tel:+10000000000',
        'content://com.example/secret',
        '//evil.example/x',
        'https:evil.example',
        'https:/evil.example',
        'https://user:pass@evil.example/x',
        'https://evil.example/a b',
        'https://evil.example\\@good.example/',
        ' https://evil.example/',
        'https://evil.example/\u0000',
        'invoices/1/attachments/a.png',
        'https://example.com/${'a' * 500}',
      ]) {
        expect(openableAttachmentUri(url), isNull, reason: '$url');
      }
    });
  });
}
