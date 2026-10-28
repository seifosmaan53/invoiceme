import { ValueTransformer } from 'typeorm';

/** PostgreSQL bigint arrives as a string; revisions stay far below 2^53. */
export const BIGINT_AS_NUMBER: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value: string | null) => (value == null ? value : Number(value)),
};
