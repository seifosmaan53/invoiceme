import {
  ATTACHMENT_URL_MAX_LENGTH,
  InvalidAttachmentUrlError,
  assertValidAttachmentUrl,
  checkAttachmentUrl,
  isValidAttachmentUrl,
  withValidAttachmentUrls,
} from '../src/common/attachment-url';

const ch = (code: number) => String.fromCharCode(code);

describe('attachment URL validation', () => {
  describe('accepts the supported storage shapes', () => {
    it.each([
      // REST upload: S3Service.getSignedUrl on AWS (virtual-hosted and path style)
      [
        'https://invoiceme.s3.us-east-1.amazonaws.com/invoices/1/attachments/1-a.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKID%2F20261025%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Signature=ab12',
        'url',
      ],
      ['https://s3.eu-west-1.amazonaws.com/invoiceme/invoices/1/attachments/1-a.pdf?AWSAccessKeyId=AKID&Expires=1&Signature=a%2Bb%3D', 'url'],
      // docker-compose default S3_ENDPOINT=http://minio:9000, and a local endpoint
      ['http://minio:9000/invoiceme/invoices/1/attachments/1-a.pdf?AWSAccessKeyId=minioadmin&Expires=1&Signature=x', 'url'],
      ['http://localhost:9000/invoiceme/a.png', 'url'],
      ['HTTPS://CDN.EXAMPLE.TEST/receipts/r1.png', 'url'],
      ['https://[2001:db8::1]/a.pdf', 'url'],
      // stored object keys
      ['invoices/2f1c/attachments/1761350400000-receipt.pdf', 'storage-key'],
      ["a!b_c.d*e'(f)-g/h", 'storage-key'],
      ['u', 'storage-key'],
    ])('%s', (value, kind) => {
      expect(checkAttachmentUrl(value)).toEqual({ valid: true, kind });
      expect(isValidAttachmentUrl(value)).toBe(true);
      expect(() => assertValidAttachmentUrl(value)).not.toThrow();
    });

    it('accepts the maximum stored length', () => {
      const url = 'https://a.example.test/' + 'x'.repeat(ATTACHMENT_URL_MAX_LENGTH - 23);
      expect(url).toHaveLength(ATTACHMENT_URL_MAX_LENGTH);
      expect(isValidAttachmentUrl(url)).toBe(true);
    });
  });

  describe('rejects', () => {
    it.each([
      ['javascript:alert(1)', 'scheme'],
      ['JaVaScRiPt:alert(1)', 'scheme'],
      ['data:text/html;base64,PHNjcmlwdD4=', 'scheme'],
      ['data:image/png;base64,iVBORw0KGgo=', 'scheme'],
      ['file:///etc/passwd', 'scheme'],
      ['vbscript:msgbox(1)', 'scheme'],
      ['blob:https://a.example.test/uuid', 'scheme'],
      ['intent://scan/#Intent;scheme=zxing;end', 'scheme'],
      ['tel:+15550100', 'scheme'],
      ['sms:+15550100', 'scheme'],
      ['mailto:a@example.test', 'scheme'],
      ['ftp://a.example.test/x.pdf', 'scheme'],
      ['content://com.android.providers/x', 'scheme'],
      ['itms-services://?action=download-manifest', 'scheme'],
      ['C:/Windows/win.ini', 'scheme'],
      ['https:evil.example.test/x', 'absolute'],
      ['https:/evil.example.test/x', 'absolute'],
      ['https://', 'absolute'],
      ['http:///x', 'absolute'],
      ['https://user:pass@evil.example.test/x.pdf', 'credentials'],
      ['https://good.example.test@evil.example.test/x.pdf', 'credentials'],
      ['https://a b.example.test/x', 'whitespace'],
      ['https:\\\\evil.example.test\\x.pdf', 'backslash'],
      ['//evil.example.test/x.pdf', 'neither'],
      ['/etc/passwd', 'neither'],
      ['invoices//x.pdf', 'neither'],
      ['invoices/x.pdf?download=1', 'neither'],
      ['../../secret.pdf', 'dot segment'],
      ['invoices/./x.pdf', 'dot segment'],
      ['javascript&colon;alert(1)', 'neither'],
      ['', 'empty'],
    ])('%s', (value, reason) => {
      const check = checkAttachmentUrl(value);
      expect(check.valid).toBe(false);
      expect(check.reason).toContain(reason);
      expect(() => assertValidAttachmentUrl(value)).toThrow(InvalidAttachmentUrlError);
    });

    it.each([
      ['leading space', ' javascript:alert(1)'],
      ['tab inside the scheme', 'java' + ch(9) + 'script:alert(1)'],
      ['newline', 'https://a.example.test/x' + ch(10)],
      ['NUL', 'https://a.example.test/x' + ch(0) + '.pdf'],
      ['DEL', 'https://a.example.test/' + ch(0x7f)],
      ['C1 control', ch(0x85) + 'https://a.example.test/'],
      ['no-break space', 'https://a.example.test/' + ch(0xa0)],
      ['line separator', 'https://a.example.test/' + ch(0x2028)],
      ['zero-width / bidi mark', 'https://a.example.test/' + ch(0x200f) + 'fdp.exe'],
      ['BOM', ch(0xfeff) + 'javascript:alert(1)'],
    ])('%s', (_label, value) => {
      expect(checkAttachmentUrl(value)).toEqual({ valid: false, reason: 'whitespace, control character or backslash' });
    });

    it.each([[undefined], [null], [42], [['https://a.example.test/x']], [{ href: 'https://a.example.test/x' }]])(
      'non-string %j',
      (value) => {
        expect(checkAttachmentUrl(value)).toEqual({ valid: false, reason: 'not a string' });
      },
    );

    it('a URL longer than the column', () => {
      const url = 'https://a.example.test/' + 'x'.repeat(ATTACHMENT_URL_MAX_LENGTH);
      expect(checkAttachmentUrl(url)).toEqual({ valid: false, reason: 'too long' });
    });
  });

  describe('withValidAttachmentUrls', () => {
    it('drops invalid rows, keeps order, and does not modify any row', () => {
      const rows = [
        { id: '1', url: 'https://a.example.test/1.pdf' },
        { id: '2', url: 'javascript:alert(1)' },
        { id: '3', url: 'invoices/1/attachments/3.pdf' },
        { id: '4', url: null },
      ];
      const snapshot = JSON.parse(JSON.stringify(rows));

      expect(withValidAttachmentUrls(rows).map((r) => r.id)).toEqual(['1', '3']);
      expect(rows).toEqual(snapshot);
    });
  });
});
