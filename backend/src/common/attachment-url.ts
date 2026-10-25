import { Logger } from '@nestjs/common';

/**
 * Attachment URL validation.
 *
 * An attachment's `url` is what the mobile app opens with url_launcher
 * (external application) and loads with Image.network. The server never
 * fetches it. Two shapes are legitimate:
 *
 * - an absolute http(s) URL: the presigned URL the REST upload stores
 *   (AWS, or http://minio:9000/... with the docker-compose S3_ENDPOINT), or a
 *   hosted/CDN file URL;
 * - a storage object key (`invoices/<id>/attachments/<file>`), which is not
 *   navigable and is kept for stored keys.
 *
 * Anything else (javascript:, data:, file:, intent:, tel:, ..., protocol-
 * relative `//host`, absolute paths, dot segments, embedded credentials,
 * whitespace, control characters or backslashes) is rejected.
 *
 * This is a format check. It is NOT an allowlist of hosts and NOT SSRF
 * protection: if the server ever fetches these URLs, that code needs its own
 * destination, redirect and size controls.
 */

/** attachments.url is varchar(500) in the entity */
export const ATTACHMENT_URL_MAX_LENGTH = 500;

export interface AttachmentUrlCheck {
  valid: boolean;
  /** Set when valid */
  kind?: 'url' | 'storage-key';
  /** Set when not valid */
  reason?: string;
}

const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
const ALLOWED_SCHEMES = new Set(['http', 'https']);
// Whitespace (incl. Unicode spaces and BOM), C0/C1 controls, and backslash,
// which WHATWG URL parsing treats as '/' in http(s) URLs.
const FORBIDDEN_CHARS = /[\u0000-\u0020\u007f-\u00a0\u1680\u180e\u2000-\u200f\u2028\u2029\u202f\u205f\u3000\ufeff\\]/;
// S3 "safe characters" per segment, no empty segments, no leading slash
const STORAGE_KEY = /^[A-Za-z0-9!_.*'()-]+(\/[A-Za-z0-9!_.*'()-]+)*$/;

const invalid = (reason: string): AttachmentUrlCheck => ({ valid: false, reason });

export function checkAttachmentUrl(value: unknown): AttachmentUrlCheck {
  if (typeof value !== 'string') return invalid('not a string');
  if (value.length === 0) return invalid('empty');
  if (value.length > ATTACHMENT_URL_MAX_LENGTH) return invalid('too long');
  if (FORBIDDEN_CHARS.test(value)) return invalid('whitespace, control character or backslash');

  const scheme = SCHEME.exec(value);
  if (scheme) {
    if (!ALLOWED_SCHEMES.has(scheme[1].toLowerCase())) return invalid(`scheme "${scheme[1]}:" is not allowed`);
    // Require the authority form: WHATWG would also accept "https:host" or "https:/host"
    if (!/^https?:\/\/[^/]/i.test(value)) return invalid('not an absolute http(s) URL');
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return invalid('malformed URL');
    }
    if (!url.hostname) return invalid('no host');
    if (url.username || url.password) return invalid('credentials in URL');
    return { valid: true, kind: 'url' };
  }

  if (!STORAGE_KEY.test(value)) return invalid('neither an http(s) URL nor a storage key');
  if (value.split('/').some((segment) => segment === '.' || segment === '..')) return invalid('dot segment');
  return { valid: true, kind: 'storage-key' };
}

export function isValidAttachmentUrl(value: unknown): boolean {
  return checkAttachmentUrl(value).valid;
}

export class InvalidAttachmentUrlError extends Error {}

/** For write paths: throws unless the value is a valid attachment URL. */
export function assertValidAttachmentUrl(value: unknown): void {
  const check = checkAttachmentUrl(value);
  if (!check.valid) {
    throw new InvalidAttachmentUrlError(`invalid attachment url: ${check.reason}`);
  }
}

const logger = new Logger('AttachmentUrl');

/**
 * For read paths: leaves out attachments whose stored URL is not valid
 * (written before validation existed), so they are never returned, opened or
 * fetched. The rows themselves are not changed.
 */
export function withValidAttachmentUrls<T extends { id: string; url: unknown }>(attachments: T[]): T[] {
  return attachments.filter((attachment) => {
    const check = checkAttachmentUrl(attachment.url);
    if (!check.valid) {
      logger.warn(`Leaving out attachment ${attachment.id}: ${check.reason}`);
    }
    return check.valid;
  });
}
