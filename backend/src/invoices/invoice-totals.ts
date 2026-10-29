/**
 * Invoice arithmetic shared by the REST service and sync conflict
 * resolution, so every server-side write of items derives the same totals.
 * Inputs may be PostgreSQL numerics (strings); amounts round to cents.
 */
export interface TotalsInput {
  quantity: number | string;
  unitPrice: number | string;
  taxRate?: number | string | null;
  discountRate?: number | string | null;
}

export interface InvoiceTotals {
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  total: number;
}

const round = (value: number) => Math.round(value * 100) / 100;

export function calculateLineTotal(item: TotalsInput): number {
  const discountRate = Number(item.discountRate ?? 0);
  const taxRate = Number(item.taxRate ?? 0);
  let lineTotal = Number(item.quantity) * Number(item.unitPrice);
  if (discountRate > 0) {
    lineTotal -= (lineTotal * discountRate) / 100;
  }
  if (taxRate > 0) {
    lineTotal += (lineTotal * taxRate) / 100;
  }
  return round(lineTotal);
}

export function calculateTotals(items: TotalsInput[]): InvoiceTotals {
  let subtotal = 0;
  let taxTotal = 0;
  let discountTotal = 0;
  for (const item of items) {
    const discountRate = Number(item.discountRate ?? 0);
    const taxRate = Number(item.taxRate ?? 0);
    const itemSubtotal = Number(item.quantity) * Number(item.unitPrice);
    subtotal += itemSubtotal;
    if (discountRate > 0) {
      discountTotal += (itemSubtotal * discountRate) / 100;
    }
    const afterDiscount = itemSubtotal - (discountRate ? (itemSubtotal * discountRate) / 100 : 0);
    if (taxRate > 0) {
      taxTotal += (afterDiscount * taxRate) / 100;
    }
  }
  return {
    subtotal: round(subtotal),
    taxTotal: round(taxTotal),
    discountTotal: round(discountTotal),
    total: round(subtotal - discountTotal + taxTotal),
  };
}
