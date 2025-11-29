import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import 'package:file_picker/file_picker.dart';
import 'package:image_picker/image_picker.dart';
import '../core/providers/providers.dart';
import '../core/widgets/copyable_error.dart';

class AttachmentUploadScreen extends ConsumerStatefulWidget {
  final String invoiceId;

  const AttachmentUploadScreen({super.key, required this.invoiceId});

  @override
  ConsumerState<AttachmentUploadScreen> createState() => _AttachmentUploadScreenState();
}

class _AttachmentUploadScreenState extends ConsumerState<AttachmentUploadScreen> {
  bool _isUploading = false;
  String? _selectedFilePath;
  String? _selectedFileName;
  String? _fileType;
  Uint8List? _selectedFileBytes; // For web platform

  Future<void> _pickImage() async {
    try {
      final ImagePicker picker = ImagePicker();
      final XFile? image = await picker.pickImage(source: ImageSource.gallery);

      if (image != null) {
        setState(() {
          if (kIsWeb) {
            // On web, read bytes instead of using path
            image.readAsBytes().then((bytes) {
              if (mounted) {
                setState(() {
                  _selectedFileBytes = bytes;
                });
              }
            });
            _selectedFilePath = null;
          } else {
            _selectedFilePath = image.path;
          }
          _selectedFileName = image.name;
          _fileType = 'image';
        });
      }
    } catch (e) {
      if (mounted) {
        CopyableErrorSnackBar.show(context, 'Error picking image: $e');
      }
    }
  }

  Future<void> _pickFile() async {
    try {
      FilePickerResult? result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['pdf', 'jpg', 'jpeg', 'png', 'gif'],
      );

      if (result != null && result.files.isNotEmpty) {
        final file = result.files.first;
        
        // Validate file size (max 10MB)
        const maxSizeBytes = 10 * 1024 * 1024; // 10MB
        if (file.size > maxSizeBytes) {
          if (mounted) {
            CopyableErrorSnackBar.show(
              context, 
              'File size exceeds 10MB limit. Please choose a smaller file.',
            );
          }
          return;
        }
        
        if (file.size > 0) {
          setState(() {
            if (kIsWeb) {
              // On web, use bytes directly
              if (file.bytes != null) {
                _selectedFileBytes = file.bytes;
                _selectedFilePath = null;
              } else {
                if (mounted) {
                  CopyableErrorSnackBar.show(
                    context,
                    'Failed to read file. Please try again.',
                  );
                }
                return;
              }
            } else {
              // On mobile, use path
              if (file.path != null && file.path!.isNotEmpty) {
                _selectedFilePath = file.path;
                _selectedFileBytes = null;
              } else {
                if (mounted) {
                  CopyableErrorSnackBar.show(
                    context,
                    'Failed to get file path. Please try again.',
                  );
                }
                return;
              }
            }
            _selectedFileName = file.name;
            _fileType = file.extension == 'pdf' ? 'pdf' : 'image';
          });
        } else {
          if (mounted) {
            CopyableErrorSnackBar.show(
              context,
              'Selected file is empty. Please choose a valid file.',
            );
          }
        }
      }
    } catch (e) {
      if (mounted) {
        CopyableErrorSnackBar.show(context, 'Error picking file: $e');
      }
    }
  }

  Future<void> _uploadFile() async {
    if (kIsWeb && _selectedFileBytes == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select a file first')),
      );
      return;
    }
    if (!kIsWeb && _selectedFilePath == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select a file first')),
      );
      return;
    }

    setState(() => _isUploading = true);

    try {
      final apiClient = ref.read(apiClientProvider);

      // Determine content type
      String contentType = 'application/octet-stream';
      if (_fileType == 'image') {
        final ext = _selectedFileName?.split('.').last?.toLowerCase();
        contentType = ext == 'png'
            ? 'image/png'
            : ext == 'jpg' || ext == 'jpeg'
                ? 'image/jpeg'
                : ext == 'gif'
                    ? 'image/gif'
                    : 'image/jpeg';
      } else if (_fileType == 'pdf') {
        contentType = 'application/pdf';
      }

      // Create FormData - handle web and mobile differently
      MultipartFile multipartFile;
      if (kIsWeb && _selectedFileBytes != null) {
        // Web: use bytes directly
        multipartFile = MultipartFile.fromBytes(
          _selectedFileBytes!,
          filename: _selectedFileName ?? 'file',
          contentType: DioMediaType.parse(contentType),
        );
      } else if (!kIsWeb && _selectedFilePath != null) {
        // Mobile: use file path
        multipartFile = await MultipartFile.fromFile(
          _selectedFilePath!,
          filename: _selectedFileName ?? 'file',
          contentType: DioMediaType.parse(contentType),
        );
      } else {
        throw Exception('No file selected');
      }

      final formData = FormData.fromMap({
        'file': multipartFile,
      });

      final response = await apiClient.postMultipart(
        '/invoices/${widget.invoiceId}/attachments',
        formData,
      );

      if (response.statusCode == 201 || response.statusCode == 200) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Attachment uploaded successfully!'),
              backgroundColor: Colors.green,
            ),
          );
          Navigator.pop(context, true);
        }
      }
    } catch (e) {
      if (mounted) {
        String errorMessage = 'Error uploading file';
        if (e is DioException && e.response != null) {
          final responseData = e.response!.data;
          if (responseData is Map && responseData['message'] != null) {
            errorMessage = responseData['message'].toString();
          }
        }
        CopyableErrorSnackBar.show(
          context,
          errorMessage,
          errorCode: e is DioException && e.response != null 
              ? 'HTTP ${e.response!.statusCode}' 
              : null,
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isUploading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Upload Attachment'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (_selectedFileName != null) ...[
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    children: [
                      Icon(
                        _fileType == 'pdf' ? Icons.picture_as_pdf : Icons.image,
                        color: const Color(0xFF4a90e2),
                        size: 32,
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _selectedFileName!,
                              style: const TextStyle(fontWeight: FontWeight.bold),
                              overflow: TextOverflow.ellipsis,
                            ),
                            Text(
                              _fileType == 'pdf' ? 'PDF Document' : 'Image',
                              style: TextStyle(color: Colors.grey[600], fontSize: 12),
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.close),
                        onPressed: () {
                          setState(() {
                            _selectedFilePath = null;
                            _selectedFileName = null;
                            _fileType = null;
                            _selectedFileBytes = null;
                          });
                        },
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: _isUploading ? null : _uploadFile,
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  backgroundColor: const Color(0xFF4a90e2),
                  foregroundColor: Colors.white,
                ),
                child: _isUploading
                    ? const CircularProgressIndicator(color: Colors.white)
                    : const Text('Upload File', style: TextStyle(fontSize: 18)),
              ),
              const SizedBox(height: 16),
            ] else ...[
              const Text(
                'Select a file to upload',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 24),
              ElevatedButton.icon(
                onPressed: _pickImage,
                icon: const Icon(Icons.image),
                label: const Text('Pick Image'),
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                ),
              ),
              const SizedBox(height: 12),
              ElevatedButton.icon(
                onPressed: _pickFile,
                icon: const Icon(Icons.attach_file),
                label: const Text('Pick File (PDF/Image)'),
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                ),
              ),
            ],
            const SizedBox(height: 16),
            const Text(
              'Supported formats: JPEG, PNG, GIF, PDF',
              style: TextStyle(fontSize: 12, color: Colors.grey),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

