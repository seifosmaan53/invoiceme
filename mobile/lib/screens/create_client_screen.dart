import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:dio/dio.dart';
import '../core/providers/providers.dart';
import '../core/providers/refresh_provider.dart';
import '../core/widgets/copyable_error.dart';
import '../core/utils/file_helper.dart';
import '../models/client.dart';
import 'clients_screen.dart';

class CreateClientScreen extends ConsumerStatefulWidget {
  const CreateClientScreen({super.key});

  @override
  ConsumerState<CreateClientScreen> createState() => _CreateClientScreenState();
}

class _CreateClientScreenState extends ConsumerState<CreateClientScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _addressController = TextEditingController();
  final _notesController = TextEditingController();
  final _tagInputController = TextEditingController();
  final List<String> _tags = [];
  bool _isSubmitting = false;
  Uint8List? _avatarBytes; // For web platform
  String? _avatarPath; // For mobile platform
  String? _avatarUrl;

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _addressController.dispose();
    _notesController.dispose();
    _tagInputController.dispose();
    super.dispose();
  }

  void _addTag() {
    final value = _tagInputController.text.trim();
    if (value.isEmpty) return;
    if (!_tags.contains(value)) {
      setState(() {
        _tags.add(value);
      });
    }
    _tagInputController.clear();
  }

  void _removeTag(String tag) {
    setState(() {
      _tags.remove(tag);
    });
  }

  Future<void> _pickAvatar() async {
    try {
      final picker = ImagePicker();
      final pickedFile = await picker.pickImage(
        source: ImageSource.gallery,
        imageQuality: 85, // Compress for web performance
        maxWidth: 800, // Limit size for web
        maxHeight: 800,
      );
      
      if (pickedFile != null) {
        if (kIsWeb) {
          // On web, read bytes
          try {
            final bytes = await pickedFile.readAsBytes();
            
            // Validate file size (max 2MB for avatars)
            const maxSizeBytes = 2 * 1024 * 1024; // 2MB
            if (bytes.length > maxSizeBytes) {
              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('Image size exceeds 2MB limit. Please choose a smaller image.'),
                    backgroundColor: Colors.red,
                  ),
                );
              }
              return;
            }
            
            if (mounted) {
              setState(() {
                _avatarBytes = bytes;
                _avatarPath = null;
              });
            }
          } catch (e) {
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('Error reading image: $e'),
                  backgroundColor: Colors.red,
                ),
              );
            }
          }
        } else {
          // On mobile, use path
          if (mounted) {
            setState(() {
              _avatarPath = pickedFile.path;
              _avatarBytes = null;
            });
          }
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error picking image: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  Future<void> _uploadAvatar() async {
    // Avatar will be uploaded after client creation
  }

  Future<void> _uploadAvatarToClient(String clientId) async {
    if (kIsWeb && _avatarBytes == null) return;
    if (!kIsWeb && _avatarPath == null) return;

    try {
      final apiClient = ref.read(apiClientProvider);
      
      MultipartFile multipartFile;
      if (kIsWeb && _avatarBytes != null) {
        // Web: use bytes directly
        multipartFile = MultipartFile.fromBytes(
          _avatarBytes!,
          filename: 'avatar.jpg',
        );
      } else if (!kIsWeb && _avatarPath != null) {
        // Mobile: use file path directly
        multipartFile = await MultipartFile.fromFile(_avatarPath!);
      } else {
        return;
      }
      
      final formData = FormData.fromMap({
        'file': multipartFile,
      });
      final response = await apiClient.post(
        '/clients/$clientId/avatar',
        data: formData,
      );
      if (mounted) {
        setState(() {
          _avatarUrl = response.data['avatarUrl'] ?? response.data['avatar_url'];
        });
      }
    } catch (e) {
      if (mounted) {
        CopyableErrorSnackBar.show(context, 'Error uploading avatar: $e');
      }
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }

    setState(() => _isSubmitting = true);

    try {
      final apiClient = ref.read(apiClientProvider);
      
      // Create a temporary Client object to use toApiPayload()
      final now = DateTime.now();
      final client = Client(
        id: '', // Server will generate
        userId: '', // Server gets from JWT
        name: _nameController.text.trim(),
        email: _emailController.text.trim().isEmpty ? null : _emailController.text.trim(),
        phone: _phoneController.text.trim().isEmpty ? null : _phoneController.text.trim(),
        addressJson: _addressController.text.trim().isNotEmpty
            ? {'address': _addressController.text.trim()}
            : null,
        notes: _notesController.text.trim().isEmpty ? null : _notesController.text.trim(),
        tags: _tags,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      );

      await apiClient.post('/clients', data: client.toApiPayload());

      // Trigger refresh for clients
      triggerRefresh(ref, RefreshType.clients);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Client created successfully!')),
        );
        Navigator.of(context).pop(true); // Return true to indicate success
      }
    } catch (e) {
      if (mounted) {
        CopyableErrorSnackBar.show(context, 'Error creating client: $e');
      }
    } finally {
      if (mounted) {
        setState(() => _isSubmitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Create Client'),
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            // Avatar Upload
            Center(
              child: Stack(
                children: [
                  Container(
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: Theme.of(context).dividerColor,
                        width: 3,
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: Theme.of(context).shadowColor.withOpacity(0.1),
                          blurRadius: 8,
                          offset: const Offset(0, 2),
                        ),
                      ],
                    ),
                    child: CircleAvatar(
                    radius: 50,
                      backgroundColor: Theme.of(context).colorScheme.surfaceVariant,
                    backgroundImage: (kIsWeb && _avatarBytes != null)
                        ? MemoryImage(_avatarBytes!)
                        : (!kIsWeb && _avatarPath != null)
                            ? getFileImageProvider(_avatarPath)
                            : _avatarUrl != null
                                ? NetworkImage(_avatarUrl!) as ImageProvider
                                : null,
                    child: ((kIsWeb && _avatarBytes == null) || (!kIsWeb && _avatarPath == null)) && _avatarUrl == null
                          ? Icon(
                              Icons.person_outline,
                              size: 50,
                              color: Theme.of(context).colorScheme.onSurfaceVariant,
                            )
                        : null,
                    ),
                  ),
                  Positioned(
                    bottom: 0,
                    right: 0,
                    child: Container(
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: Theme.of(context).primaryColor,
                        border: Border.all(
                          color: Theme.of(context).scaffoldBackgroundColor,
                          width: 2,
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: Theme.of(context).shadowColor.withOpacity(0.2),
                            blurRadius: 4,
                            offset: const Offset(0, 2),
                          ),
                        ],
                      ),
                      child: IconButton(
                        icon: Icon(
                          Icons.camera_alt,
                          size: 18,
                          color: Theme.of(context).colorScheme.onPrimary,
                        ),
                        onPressed: _pickAvatar,
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints(),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
            TextFormField(
              controller: _nameController,
              decoration: const InputDecoration(
                labelText: 'Client Name *',
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.person_outline),
                contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 16),
              ),
              textInputAction: TextInputAction.next,
              validator: (value) => value?.isEmpty ?? true ? 'Please enter client name' : null,
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _emailController,
              decoration: const InputDecoration(
                labelText: 'Email (Optional)',
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.email_outlined),
                contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 16),
              ),
              keyboardType: TextInputType.emailAddress,
              textInputAction: TextInputAction.next,
              validator: (value) {
                if (value != null && value.isNotEmpty) {
                  if (!RegExp(r'^[^@]+@[^@]+\.[^@]+').hasMatch(value)) {
                    return 'Please enter a valid email';
                  }
                }
                return null;
              },
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _phoneController,
              decoration: const InputDecoration(
                labelText: 'Phone (Optional)',
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.phone_outlined),
                contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 16),
              ),
              keyboardType: TextInputType.phone,
              textInputAction: TextInputAction.next,
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _addressController,
              decoration: const InputDecoration(
                labelText: 'Address (Optional)',
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.location_on_outlined),
                contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              ),
              maxLines: 2,
              textInputAction: TextInputAction.next,
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _notesController,
              decoration: const InputDecoration(
                labelText: 'Notes (Optional)',
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.note_outlined),
                hintText: 'Additional notes...',
                contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              ),
              maxLines: 2,
              textInputAction: TextInputAction.done,
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                Icon(
                  Icons.label_outline,
                  size: 20,
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
                const SizedBox(width: 8),
                Text(
                  'Tags (Optional)',
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w600,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _tagInputController,
                    decoration: InputDecoration(
                      hintText: 'Add tag (e.g. VIP, Wholesale)',
                      border: const OutlineInputBorder(),
                      prefixIcon: const Icon(Icons.label_outlined, size: 20),
                      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                      filled: true,
                      fillColor: Theme.of(context).colorScheme.surfaceVariant.withOpacity(0.3),
                    ),
                    textInputAction: TextInputAction.done,
                    onSubmitted: (_) => _addTag(),
                  ),
                ),
                const SizedBox(width: 8),
                ElevatedButton.icon(
                  onPressed: _addTag,
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('Add'),
                  style: ElevatedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    backgroundColor: Theme.of(context).primaryColor,
                    foregroundColor: Theme.of(context).colorScheme.onPrimary,
                  ),
                ),
              ],
            ),
            if (_tags.isNotEmpty) ...[
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: _tags.map((tag) {
                  return Chip(
                    label: Text(tag, style: const TextStyle(fontSize: 13)),
                    onDeleted: () => _removeTag(tag),
                    deleteIcon: const Icon(Icons.close, size: 16),
                    backgroundColor: Theme.of(context).colorScheme.primaryContainer,
                    deleteIconColor: Theme.of(context).colorScheme.onPrimaryContainer,
                    labelStyle: TextStyle(
                      color: Theme.of(context).colorScheme.onPrimaryContainer,
                    ),
                  );
                }).toList(),
              ),
            ],
            const SizedBox(height: 32),
            SizedBox(
              width: double.infinity,
              height: 52,
              child: ElevatedButton(
                onPressed: _isSubmitting ? null : _submit,
                style: ElevatedButton.styleFrom(
                  backgroundColor: Theme.of(context).primaryColor,
                  foregroundColor: Theme.of(context).colorScheme.onPrimary,
                  elevation: 2,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  shadowColor: Theme.of(context).primaryColor.withOpacity(0.3),
                ),
                child: _isSubmitting
                    ? SizedBox(
                        height: 24,
                        width: 24,
                        child: CircularProgressIndicator(
                          color: Theme.of(context).colorScheme.onPrimary,
                          strokeWidth: 2.5,
                        ),
                      )
                    : Text(
                        'Create Client',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 0.5,
                          color: Theme.of(context).colorScheme.onPrimary,
                        ),
                      ),
              ),
            ),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }
}

