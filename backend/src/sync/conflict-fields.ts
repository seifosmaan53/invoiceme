import { ChangeObjectType } from '../entities/device-change.entity';

/**
 * Fields a conflict record may keep and show, per record type (property
 * names). Everything else in a change (metadata, ids the server sets,
 * unknown keys) is left out and listed in omitted_fields, so conflicts never
 * hold credentials, payment data or arbitrary client payloads.
 */
export const CONFLICT_FIELDS: Record<string, ReadonlyArray<string>> = {
  [ChangeObjectType.CLIENT]: ['name', 'email', 'phone', 'addressJson', 'notes', 'tagsJson', 'avatarUrl'],
  [ChangeObjectType.INVOICE]: [
    'clientId',
    'type',
    'number',
    'status',
    'issueDate',
    'dueDate',
    'currency',
    'subtotal',
    'taxTotal',
    'discountTotal',
    'total',
    'notes',
  ],
  [ChangeObjectType.INVOICE_ITEM]: ['invoiceId', 'description', 'quantity', 'unitPrice', 'taxRate', 'discountRate', 'lineTotal'],
};

/** Longest string kept per field; longer values are cut and marked. */
export const CONFLICT_TEXT_LIMIT = 2000;
/** Longest JSON value (address, tags) kept per field. */
export const CONFLICT_JSON_LIMIT = 4000;

export interface ConflictFields {
  fields: Record<string, any>;
  omitted: string[];
}

function bounded(value: unknown): unknown {
  if (typeof value === 'string' && value.length > CONFLICT_TEXT_LIMIT) {
    return `${value.slice(0, CONFLICT_TEXT_LIMIT)}… [truncated]`;
  }
  if (value !== null && typeof value === 'object') {
    const json = JSON.stringify(value);
    if (json.length > CONFLICT_JSON_LIMIT) return '[value too large to keep]';
  }
  return value;
}

/** The allowlisted, size-bounded subset of `data` for a conflict record. */
export function conflictFields(objectType: string, data: Record<string, any> | null | undefined): ConflictFields {
  const allowed = new Set(CONFLICT_FIELDS[objectType] ?? []);
  const fields: Record<string, any> = {};
  const omitted: string[] = [];
  for (const [key, value] of Object.entries(data ?? {})) {
    if (allowed.has(key)) fields[key] = bounded(value);
    else omitted.push(key);
  }
  return { fields, omitted: omitted.sort() };
}
