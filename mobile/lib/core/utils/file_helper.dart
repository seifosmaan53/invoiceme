// Conditional export - uses mobile implementation on non-web, web implementation on web
export 'file_helper_io.dart' if (dart.library.html) 'file_helper_web.dart';

