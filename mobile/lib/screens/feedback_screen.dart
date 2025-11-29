import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../core/providers/providers.dart';
import '../core/utils/error_handler.dart';

class FeedbackScreen extends ConsumerStatefulWidget {
  const FeedbackScreen({super.key});

  @override
  ConsumerState<FeedbackScreen> createState() => _FeedbackScreenState();
}

class _FeedbackScreenState extends ConsumerState<FeedbackScreen> {
  final _formKey = GlobalKey<FormState>();
  final _messageController = TextEditingController();
  final _contextController = TextEditingController();
  int? _rating;
  bool _isSubmitting = false;
  Map<String, String?> _fieldErrors = {};

  @override
  void dispose() {
    _messageController.dispose();
    _contextController.dispose();
    super.dispose();
  }

  Future<void> _submitFeedback() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }

    setState(() {
      _isSubmitting = true;
      _fieldErrors = {};
    });

    try {
      final apiClient = ref.read(apiClientProvider);
      
      final response = await apiClient.post('/feedback', data: {
        'message': _messageController.text.trim(),
        if (_contextController.text.trim().isNotEmpty)
          'context': _contextController.text.trim(),
        if (_rating != null) 'rating': _rating,
      });

      if (response.statusCode == 201 || response.statusCode == 200) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Thank you for your feedback!'),
              backgroundColor: Colors.green,
            ),
          );
          Navigator.of(context).pop();
        }
      }
    } on DioException catch (e) {
      final apiError = e.toApiError();
      
      // Handle field-level validation errors
      if (apiError.hasFieldErrors) {
        setState(() {
          _fieldErrors = {};
          for (final fieldError in apiError.fieldErrors!) {
            _fieldErrors[fieldError.field] = fieldError.message;
          }
        });
        
        // Show general error message
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(apiError.getFriendlyMessage()),
              backgroundColor: Colors.red,
            ),
          );
        }
      } else {
        // Show general error
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(apiError.getFriendlyMessage()),
              backgroundColor: Colors.red,
            ),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error submitting feedback: ${e.toString()}'),
            backgroundColor: Colors.red,
          ),
        );
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
        title: const Text('Submit Feedback'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'We value your feedback!',
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Help us improve by sharing your thoughts, reporting bugs, or suggesting features.',
                style: TextStyle(
                  fontSize: 14,
                  color: Colors.grey,
                ),
              ),
              const SizedBox(height: 24),
              
              // Rating
              const Text(
                'Rating (Optional)',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(5, (index) {
                  final rating = index + 1;
                  return IconButton(
                    icon: Icon(
                      _rating != null && rating <= _rating!
                          ? Icons.star
                          : Icons.star_border,
                      color: Colors.amber,
                      size: 40,
                    ),
                    onPressed: () {
                      setState(() {
                        _rating = _rating == rating ? null : rating;
                      });
                    },
                  );
                }),
              ),
              const SizedBox(height: 24),
              
              // Message field
              TextFormField(
                controller: _messageController,
                decoration: InputDecoration(
                  labelText: 'Feedback Message *',
                  hintText: 'Tell us what you think...',
                  border: const OutlineInputBorder(),
                  errorText: _fieldErrors['message'],
                ),
                maxLines: 6,
                validator: (value) {
                  if (value == null || value.trim().isEmpty) {
                    return 'Please enter your feedback';
                  }
                  if (value.trim().length < 10) {
                    return 'Please provide more details (at least 10 characters)';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 16),
              
              // Context field (optional)
              TextFormField(
                controller: _contextController,
                decoration: const InputDecoration(
                  labelText: 'Context (Optional)',
                  hintText: 'e.g., invoice_detail, dashboard, create_invoice',
                  border: OutlineInputBorder(),
                  helperText: 'Where in the app were you when you thought of this?',
                ),
                maxLines: 2,
              ),
              const SizedBox(height: 24),
              
              // Submit button
              ElevatedButton(
                onPressed: _isSubmitting ? null : _submitFeedback,
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                ),
                child: _isSubmitting
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Submit Feedback'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

