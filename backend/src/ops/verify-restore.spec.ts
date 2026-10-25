import { compareSnapshots, normaliseCheck, SchemaSnapshot, OBJECT_CATEGORIES, formatComparison } from './verify-restore';

const snap = (constraints: string[], unreadable: string[] = []): SchemaSnapshot => ({
  tables: new Map([['t', { rows: 1, hash: 'h' }]]),
  objects: Object.fromEntries(OBJECT_CATEGORIES.map((c) => [c, c === 'constraints' ? constraints : []])) as any,
  unreadable,
});

// Exactly what a pg_dump/pg_restore round trip produced for this repository's recurring_invoices table.
const BEFORE =
  "recurring_invoices recurring_invoices_frequency_check CHECK (((frequency)::text = ANY ((ARRAY['daily'::character varying, 'weekly'::character varying])::text[])))";
const AFTER =
  "recurring_invoices recurring_invoices_frequency_check CHECK (((frequency)::text = ANY (ARRAY[('daily'::character varying)::text, ('weekly'::character varying)::text])))";

describe('verify-restore comparison', () => {
  it('reports a re-printed CHECK rule as EQUIVALENT (listed for review), not as a plain match', () => {
    const c = compareSnapshots(snap([BEFORE]), snap([AFTER]));
    const constraints = c.objects.find((o) => o.category === 'constraints')!;
    expect(constraints.status).toBe('equivalent');
    expect(constraints.equivalent).toEqual([[BEFORE, AFTER]]);
    expect(c.ok).toBe(true);
    expect(formatComparison(c)).toMatch(/differ only in casts\/parentheses; review them above/);
  });

  it('exact matches are plain matches', () => {
    const c = compareSnapshots(snap([BEFORE]), snap([BEFORE]));
    expect(c.objects.find((o) => o.category === 'constraints')!.status).toBe('match');
  });

  it.each([
    ['operator precedence', 't c CHECK ((((a > 0) AND (b > 0)) OR (c > 0)))', 't c CHECK (((a > 0) AND ((b > 0) OR (c > 0))))'],
    ['IS NULL vs IS NOT NULL', "t c CHECK (((x)::text IS NOT NULL OR (y)::text = 'a'::text))", "t c CHECK (((x)::text IS NULL OR (y)::text = 'a'::text))"],
    ['a different value', "t c CHECK ((status)::text = 'a'::text)", "t c CHECK ((status)::text = 'b'::text)"],
    ['a different function', 't c CHECK ((lower(name) = name))', 't c CHECK ((upper(name) = name))'],
  ])('a genuinely different rule (%s) is a MISMATCH', (_label, a, b) => {
    expect(normaliseCheck(a)).not.toBe(normaliseCheck(b));
    const c = compareSnapshots(snap([a]), snap([b]));
    expect(c.objects.find((o) => o.category === 'constraints')!.status).toBe('mismatch');
    expect(c.ok).toBe(false);
  });

  it('does not strip the parentheses of a function call', () => {
    expect(normaliseCheck('t c CHECK ((lower(name) = name))')).toContain('lower(name)');
  });

  it('anything unreadable makes the result NOT PROVEN, never OK', () => {
    const c = compareSnapshots(snap([BEFORE], ['sequence receipt_no']), snap([BEFORE]));
    expect(c.ok).toBe(false);
    expect(c.unreadable).toEqual(['source: sequence receipt_no']);
    const text = formatComparison(c);
    expect(text).toMatch(/NOT PROVEN: the role cannot read/);
    expect(text).not.toMatch(/OK: all/);
  });
});
