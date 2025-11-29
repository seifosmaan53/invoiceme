import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Shows a copyable error SnackBar with a copy button
class CopyableErrorSnackBar {
  static void show(BuildContext context, String errorMessage, {String? errorCode}) {
    // Ensure we have a valid error message
    if (errorMessage.isEmpty) {
      errorMessage = 'An unknown error occurred';
    }
    
    final fullError = errorCode != null ? '$errorCode: $errorMessage' : errorMessage;
    
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            const Icon(Icons.error, color: Colors.white),
            const SizedBox(width: 8),
            Expanded(
              child: SelectableText(
                fullError,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 14, // Make text slightly larger for easier selection
                ),
                // Enable text selection with better UX
                enableInteractiveSelection: true,
              ),
            ),
            const SizedBox(width: 8),
            IconButton(
              icon: const Icon(Icons.copy, color: Colors.white, size: 20),
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(),
              onPressed: () async {
                try {
                  await Clipboard.setData(ClipboardData(text: fullError));
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Row(
                          children: [
                            Icon(Icons.check_circle, color: Colors.white),
                            SizedBox(width: 8),
                            Text('Error copied to clipboard'),
                          ],
                        ),
                        duration: Duration(seconds: 2),
                        backgroundColor: Colors.green,
                      ),
                    );
                  }
                } catch (e) {
                  // Clipboard might not be available, show alternative message
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text('Unable to copy. Please select and copy manually.'),
                        backgroundColor: Colors.orange,
                        duration: const Duration(seconds: 3),
                      ),
                    );
                  }
                }
              },
              tooltip: 'Copy error',
            ),
          ],
        ),
        backgroundColor: Colors.red,
        duration: const Duration(seconds: 10), // Even longer duration for errors
        action: SnackBarAction(
          label: 'Dismiss',
          textColor: Colors.white,
          onPressed: () {
            ScaffoldMessenger.of(context).hideCurrentSnackBar();
          },
        ),
      ),
    );
  }
}

/// Shows a success SnackBar with a checkmark icon
class SuccessSnackBar {
  static void show(BuildContext context, String message, {Duration? duration}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            const Icon(Icons.check_circle, color: Colors.white),
            const SizedBox(width: 8),
            Expanded(
              child: SelectableText(
                message,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 14,
                ),
                enableInteractiveSelection: true,
                toolbarOptions: const ToolbarOptions(
                  copy: true,
                  selectAll: true,
                ),
              ),
            ),
          ],
        ),
        backgroundColor: Colors.green,
        duration: duration ?? const Duration(seconds: 4),
        action: SnackBarAction(
          label: 'Dismiss',
          textColor: Colors.white,
          onPressed: () {
            ScaffoldMessenger.of(context).hideCurrentSnackBar();
          },
        ),
      ),
    );
  }
}

/// Shows a copyable error dialog
class CopyableErrorDialog {
  static Future<void> show(BuildContext context, String title, String errorMessage, {String? errorCode}) {
    final fullError = errorCode != null ? '$errorCode: $errorMessage' : errorMessage;
    
    return showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Row(
          children: [
            const Icon(Icons.error, color: Colors.red),
            const SizedBox(width: 8),
            Expanded(child: Text(title)),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SelectableText(
                fullError,
                style: const TextStyle(fontSize: 14),
                enableInteractiveSelection: true,
              ),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton.icon(
                    onPressed: () async {
                      try {
                        await Clipboard.setData(ClipboardData(text: fullError));
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Row(
                                children: [
                                  Icon(Icons.check_circle, color: Colors.white),
                                  SizedBox(width: 8),
                                  Text('Error copied to clipboard'),
                                ],
                              ),
                              duration: Duration(seconds: 2),
                              backgroundColor: Colors.green,
                            ),
                          );
                        }
                      } catch (e) {
                        // Clipboard might not be available
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('Unable to copy. Please select and copy manually.'),
                              backgroundColor: Colors.orange,
                              duration: Duration(seconds: 3),
                            ),
                          );
                        }
                      }
                    },
                    icon: const Icon(Icons.copy, size: 18),
                    label: const Text('Copy Error'),
                  ),
                ],
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }
}

