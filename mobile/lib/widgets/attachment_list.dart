// Flutter imports
import 'package:flutter/material.dart';

// Package imports
import 'package:intl/intl.dart';

// Local imports - Models
import '../models/attachment.dart';

/// Widget to display a list of attachments
class AttachmentList extends StatelessWidget {
  final List<Attachment> attachments;
  final bool isLoading;
  final Function(Attachment) onView;
  final Function(Attachment)? onDownload;
  final Function(Attachment)? onDelete;
  final VoidCallback? onRefresh;

  const AttachmentList({
    super.key,
    required this.attachments,
    this.isLoading = false,
    required this.onView,
    this.onDownload,
    this.onDelete,
    this.onRefresh,
  });

  String _formatFileSize(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
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

  @override
  Widget build(BuildContext context) {
    if (isLoading && attachments.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(16),
          child: CircularProgressIndicator(),
        ),
      );
    }

    if (attachments.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.attach_file, size: 48, color: Colors.grey[400]),
              const SizedBox(height: 8),
              Text(
                'No attachments',
                style: TextStyle(color: Colors.grey[600]),
              ),
            ],
          ),
        ),
      );
    }

    return ListView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: attachments.length,
      itemBuilder: (context, index) {
        final attachment = attachments[index];
        final fileIcon = _getFileIcon(attachment.contentType);
        final fileColor = _getFileColor(attachment.contentType);

        return Card(
          margin: const EdgeInsets.only(bottom: 8),
          elevation: 1,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
          ),
          child: ListTile(
            leading: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: fileColor.withOpacity(0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(fileIcon, color: fileColor, size: 24),
            ),
            title: Text(
              attachment.filename,
              style: const TextStyle(
                fontWeight: FontWeight.w500,
                fontSize: 14,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            subtitle: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: 4),
                Text(
                  _formatFileSize(attachment.sizeBytes),
                  style: TextStyle(
                    color: Colors.grey[600],
                    fontSize: 12,
                  ),
                ),
                Text(
                  DateFormat('MMM dd, yyyy • hh:mm a').format(attachment.createdAt),
                  style: TextStyle(
                    color: Colors.grey[500],
                    fontSize: 11,
                  ),
                ),
              ],
            ),
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (onDownload != null)
                  IconButton(
                    icon: const Icon(Icons.download, size: 20),
                    onPressed: () => onDownload!(attachment),
                    tooltip: 'Download',
                  ),
                if (onDelete != null)
                  IconButton(
                    icon: const Icon(Icons.delete, size: 20, color: Colors.red),
                    onPressed: () => onDelete!(attachment),
                    tooltip: 'Delete',
                  ),
                IconButton(
                  icon: const Icon(Icons.open_in_new, size: 20),
                  onPressed: () => onView(attachment),
                  tooltip: 'Open attachment',
                ),
              ],
            ),
            onTap: () => onView(attachment),
          ),
        );
      },
    );
  }
}

