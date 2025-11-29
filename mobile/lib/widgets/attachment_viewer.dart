// Flutter imports
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';

// Package imports
import 'package:url_launcher/url_launcher.dart';

// Local imports - Models
import '../models/attachment.dart';

/// Widget to view attachments (images, PDFs, etc.)
class AttachmentViewer extends StatelessWidget {
  final Attachment attachment;

  const AttachmentViewer({
    super.key,
    required this.attachment,
  });

  bool get isImage => attachment.contentType.contains('image');
  bool get isPdf => attachment.contentType.contains('pdf');

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          attachment.filename,
          overflow: TextOverflow.ellipsis,
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.open_in_new),
            tooltip: 'Open in browser',
            onPressed: () => _openInBrowser(context),
          ),
          IconButton(
            icon: const Icon(Icons.download),
            tooltip: 'Download',
            onPressed: () => _downloadFile(context),
          ),
        ],
      ),
      body: Center(
        child: _buildViewer(context),
      ),
    );
  }

  Widget _buildViewer(BuildContext context) {
    if (isImage) {
      return _buildImageViewer(context);
    } else if (isPdf) {
      return _buildPdfViewer(context);
    } else {
      return _buildGenericViewer(context);
    }
  }

  Widget _buildImageViewer(BuildContext context) {
    return InteractiveViewer(
      minScale: 0.5,
      maxScale: 4.0,
      child: Center(
        child: Image.network(
          attachment.url,
          fit: BoxFit.contain,
          loadingBuilder: (context, child, loadingProgress) {
            if (loadingProgress == null) return child;
            return Center(
              child: CircularProgressIndicator(
                value: loadingProgress.expectedTotalBytes != null
                    ? loadingProgress.cumulativeBytesLoaded /
                        loadingProgress.expectedTotalBytes!
                    : null,
              ),
            );
          },
          errorBuilder: (context, error, stackTrace) {
            return Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.error_outline, size: 64, color: Colors.red),
                const SizedBox(height: 16),
                const Text('Failed to load image'),
                const SizedBox(height: 8),
                ElevatedButton(
                  onPressed: () => _openInBrowser(context),
                  child: const Text('Open in Browser'),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _buildPdfViewer(BuildContext context) {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const Icon(Icons.picture_as_pdf, size: 64, color: Colors.red),
        const SizedBox(height: 16),
        Text(
          attachment.filename,
          style: Theme.of(context).textTheme.titleLarge,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 8),
        Text(
          _formatFileSize(attachment.sizeBytes),
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: Colors.grey[600],
              ),
        ),
        const SizedBox(height: 24),
        ElevatedButton.icon(
          onPressed: () => _openInBrowser(context),
          icon: const Icon(Icons.open_in_new),
          label: const Text('Open PDF in Browser'),
          style: ElevatedButton.styleFrom(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
          ),
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: () => _downloadFile(context),
          icon: const Icon(Icons.download),
          label: const Text('Download PDF'),
          style: OutlinedButton.styleFrom(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
          ),
        ),
      ],
    );
  }

  Widget _buildGenericViewer(BuildContext context) {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(
          _getFileIcon(attachment.contentType),
          size: 64,
          color: _getFileColor(attachment.contentType),
        ),
        const SizedBox(height: 16),
        Text(
          attachment.filename,
          style: Theme.of(context).textTheme.titleLarge,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 8),
        Text(
          _formatFileSize(attachment.sizeBytes),
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: Colors.grey[600],
              ),
        ),
        const SizedBox(height: 24),
        ElevatedButton.icon(
          onPressed: () => _openInBrowser(context),
          icon: const Icon(Icons.open_in_new),
          label: const Text('Open in Browser'),
          style: ElevatedButton.styleFrom(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
          ),
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: () => _downloadFile(context),
          icon: const Icon(Icons.download),
          label: const Text('Download'),
          style: OutlinedButton.styleFrom(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
          ),
        ),
      ],
    );
  }

  IconData _getFileIcon(String? contentType) {
    if (contentType == null) return Icons.attach_file;
    if (contentType.contains('pdf')) return Icons.picture_as_pdf;
    if (contentType.contains('image')) return Icons.image;
    if (contentType.contains('video')) return Icons.video_file;
    if (contentType.contains('audio')) return Icons.audio_file;
    if (contentType.contains('text')) return Icons.description;
    return Icons.attach_file;
  }

  Color _getFileColor(String? contentType) {
    if (contentType == null) return Colors.grey;
    if (contentType.contains('pdf')) return Colors.red;
    if (contentType.contains('image')) return Colors.blue;
    if (contentType.contains('video')) return Colors.purple;
    if (contentType.contains('audio')) return Colors.orange;
    if (contentType.contains('text')) return Colors.green;
    return Colors.grey;
  }

  String _formatFileSize(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  Future<void> _openInBrowser(BuildContext context) async {
    try {
      final uri = Uri.parse(attachment.url);
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      } else {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Could not open attachment'),
              backgroundColor: Colors.red,
            ),
          );
        }
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error opening attachment: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  Future<void> _downloadFile(BuildContext context) async {
    // On web, opening the URL will trigger download
    // On mobile, we'd need a download manager plugin
    try {
      final uri = Uri.parse(attachment.url);
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Opening download...'),
              duration: Duration(seconds: 2),
            ),
          );
        }
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error downloading file: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }
}

