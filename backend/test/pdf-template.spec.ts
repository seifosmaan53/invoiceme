/**
 * Invoice HTML rendering (PdfService.renderTemplate), no browser.
 *
 * Values were once inserted with string replacements, where `$1`, `$&` and
 * similar are patterns: a line total of $110.00 pulled the item-row template
 * back into the page as raw `{{this.description}}` text.
 */
import { PdfService } from '../src/core/services/pdf.service';

function render(items: Array<Record<string, unknown>>, overrides: Record<string, unknown> = {}): Promise<string> {
  const service = new PdfService() as any;
  const data = service.normalizeData({
    invoice: {
      id: '00000000-0000-4000-8000-000000000001',
      number: 'TPL-INV-0001',
      type: 'invoice',
      status: 'sent',
      currency: 'USD',
      issueDate: new Date('2026-01-15T00:00:00Z'),
      dueDate: new Date('2026-02-14T00:00:00Z'),
      subtotal: 165,
      taxTotal: 0,
      discountTotal: 0,
      total: 165,
      ...overrides,
    },
    client: { id: '00000000-0000-4000-8000-000000000002', name: 'Template Client' },
    items,
    user: { companyName: 'Template Co' },
  });
  return service.renderTemplate(data);
}

describe('PdfService.renderTemplate', () => {
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('renders dollar amounts literally, without leaving template text behind', async () => {
    const html = await render([
      { description: 'Widget', quantity: 2, unitPrice: 50, taxRate: 10, discountRate: 0, lineTotal: 110 },
      { description: 'Hour', quantity: 1, unitPrice: 55, taxRate: 0, discountRate: 0, lineTotal: 55 },
    ]);
    expect(html).toContain('$110.00');
    expect(html).toContain('$55.00');
    expect(html).not.toContain('{{this.');
    expect(html).not.toContain('{{formatCurrency');
  });

  it('prints the issue and due dates as written, whatever the server timezone', async () => {
    const html = await render([{ description: 'x', quantity: 1, unitPrice: 1, taxRate: 0, discountRate: 0, lineTotal: 1 }], {
      issueDate: '2025-01-01',
      dueDate: '2025-01-31',
    });
    expect(html).toContain('January 1, 2025');
    expect(html).toContain('January 31, 2025');
    expect(html).not.toContain('December 31, 2024');
  });

  it('keeps $& and $1 in user text as written', async () => {
    const html = await render(
      [{ description: 'Costs $& fees $1 and $$', quantity: 1, unitPrice: 5, taxRate: 0, discountRate: 0, lineTotal: 5 }],
      { notes: 'Pay $1 now' },
    );
    expect(html).toContain('Costs $&amp; fees $1 and $$');
    expect(html).toContain('Pay $1 now');
    expect(html).not.toContain('{{');
  });
});
