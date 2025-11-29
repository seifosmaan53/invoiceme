import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kIsWeb;

/// Wrapper widget that ensures consistent layout across web and mobile
/// On web: uses full width for better desktop experience
/// On mobile: full width (no constraints)
class MobileViewWrapper extends StatelessWidget {
  final Widget child;
  final double? maxWidth;
  final bool enableTextSelection;

  const MobileViewWrapper({
    super.key,
    required this.child,
    this.maxWidth,
    this.enableTextSelection = true,
  });

  @override
  Widget build(BuildContext context) {
    Widget content = child;
    
    // Wrap with SelectionArea on web for text selection if enabled
    // This allows text selection on web while maintaining the same UI
    if (kIsWeb && enableTextSelection) {
      content = SelectionArea(child: content);
    }
    
    // On web: use full width for better desktop experience
    // On mobile: return as-is (full width)
    if (kIsWeb) {
      // If maxWidth is specified, use it; otherwise use full width
      if (maxWidth != null) {
        return Center(
          child: Container(
            constraints: BoxConstraints(
              maxWidth: maxWidth!,
              minWidth: 0,
            ),
            width: double.infinity,
            child: content,
          ),
        );
      }
      // Full width on web
      return SizedBox(
        width: double.infinity,
        child: content,
      );
    }
    
    // On mobile: return as-is (full width)
    return content;
  }
}

