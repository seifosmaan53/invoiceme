/// Attachment URLs come from the server or from this device's local database,
/// which may hold values cached before the server validated them. The app
/// opens them with url_launcher (external application) and loads images with
/// Image.network, so a `javascript:`, `intent:`, `file:` or similar value must
/// never reach either.
///
/// Mirrors the server's rule (backend/src/common/attachment-url.ts): only an
/// absolute http(s) URL with a host, no credentials, no whitespace, control
/// characters or backslashes, at most 500 characters. Storage keys are valid
/// on the server but are not openable, so they return null here too.
library;

const int attachmentUrlMaxLength = 500;

final RegExp _forbiddenChars = RegExp(
  '[\u0000- \u007f-  ᠎ -‏    　﻿\\\\]',
);
final RegExp _absoluteHttp = RegExp(r'^https?://[^/]', caseSensitive: false);

/// The URI to open or load for [url], or null if it must not be opened.
Uri? openableAttachmentUri(String? url) {
  if (url == null || url.isEmpty || url.length > attachmentUrlMaxLength) {
    return null;
  }
  if (_forbiddenChars.hasMatch(url) || !_absoluteHttp.hasMatch(url)) {
    return null;
  }
  final Uri uri;
  try {
    uri = Uri.parse(url);
  } on FormatException {
    return null;
  }
  final scheme = uri.scheme.toLowerCase();
  if ((scheme != 'http' && scheme != 'https') || uri.host.isEmpty || uri.userInfo.isNotEmpty) {
    return null;
  }
  return uri;
}
