// Flutter imports
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';

// Package imports
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

// Local imports - Core
import '../core/providers/providers.dart';
import '../core/providers/refresh_provider.dart';
import '../core/services/stripe_service.dart';

// Local imports - Models
import '../models/invoice.dart';

class PaymentScreen extends ConsumerStatefulWidget {
  final Invoice invoice;

  const PaymentScreen({super.key, required this.invoice});

  @override
  ConsumerState<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends ConsumerState<PaymentScreen> {
  bool _isLoading = false;
  bool _paymentCreated = false;
  String? _paymentUrl;
  String? _clientSecret;
  String? _paymentIntentId;
  bool _stripeAvailable = false;
  
  @override
  void initState() {
    super.initState();
    // Try to initialize Stripe if publishable key is available
    _initializeStripe();
  }
  
  Future<void> _initializeStripe() async {
    try {
      // Try to get publishable key from backend config endpoint
      final apiClient = ref.read(apiClientProvider);
      final response = await apiClient.get('/config/stripe-public-key');
      final publishableKey = response.data['publishableKey'] as String?;
      
      if (publishableKey != null && publishableKey.isNotEmpty) {
        final initialized = await StripeService.initialize(publishableKey);
        if (mounted) {
          setState(() {
            _stripeAvailable = initialized;
          });
        }
      }
    } catch (e) {
      // Backend endpoint not available or Stripe not configured
      // Fallback to environment variable
      const publishableKey = String.fromEnvironment('STRIPE_PUBLISHABLE_KEY', defaultValue: '');
      if (publishableKey.isNotEmpty) {
        final initialized = await StripeService.initialize(publishableKey);
        if (mounted) {
          setState(() {
            _stripeAvailable = initialized;
          });
        }
      }
    }
  }

  Future<void> _markAsPaid() async {
    setState(() {
      _isLoading = true;
    });

    try {
      final apiClient = ref.read(apiClientProvider);
      
      // Clear cache for this invoice and invoices list to avoid stale data
      apiClient.clearCache('/invoices/${widget.invoice.id}');
      apiClient.clearCache('/invoices');
      apiClient.clearCache('/invoices/stats');
      
      final response = await apiClient.patch(
        '/invoices/${widget.invoice.id}',
        data: {'status': 'paid'},
      );

      if (response.statusCode == 200) {
        // Update state immediately (optimistic update)
        setState(() {
          _isLoading = false;
        });

        // Trigger refresh AFTER UI update for better perceived performance
        // Use a small delay to let UI update first
        Future.microtask(() {
          triggerRefresh(ref, RefreshType.invoices);
          triggerRefresh(ref, RefreshType.dashboard);
        });

        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Invoice marked as paid successfully!'),
              backgroundColor: Colors.green,
            ),
          );
          Navigator.pop(context, true); // Return success to refresh invoice
        }
      }
    } catch (e) {
      setState(() => _isLoading = false);
      if (mounted) {
        String errorMessage = 'Error marking invoice as paid';
        if (e is DioException && e.response != null) {
          final responseData = e.response!.data;
          if (responseData is Map) {
            if (responseData['message'] != null) {
              final message = responseData['message'];
              errorMessage = message is List ? message.join(', ') : message.toString();
            } else if (responseData['error'] != null) {
              errorMessage = responseData['error'].toString();
            }
          }
        } else if (e is DioException && e.message != null) {
          errorMessage = e.message!;
        }
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(errorMessage),
            backgroundColor: Colors.red,
            duration: const Duration(seconds: 4),
          ),
        );
      }
    }
  }

  Future<void> _createPaymentIntent() async {
    setState(() {
      _isLoading = true;
    });

    try {
      final apiClient = ref.read(apiClientProvider);
      final response = await apiClient.post('/invoices/${widget.invoice.id}/pay');

      if (response.statusCode == 200) {
        final data = response.data;
        final clientSecret = data['clientSecret'] as String?;
        final paymentIntentId = data['paymentIntentId'] as String?;
        
        setState(() {
          _clientSecret = clientSecret;
          _paymentIntentId = paymentIntentId;
        });

        // Try to use Stripe SDK if available
        if (_stripeAvailable && clientSecret != null && !kIsWeb) {
          // Use Stripe SDK for mobile
          try {
            final success = await StripeService.presentPaymentSheet(
              clientSecret: clientSecret,
              merchantDisplayName: 'InvoiceMe',
            );
            
            if (mounted) {
              setState(() {
                _paymentCreated = success;
                _isLoading = false;
              });
              
              if (success) {
                // Payment successful - mark invoice as paid
                // Refresh is already triggered in _markAsPaid()
                await _markAsPaid();
              } else {
                // User canceled
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('Payment canceled'),
                    backgroundColor: Colors.orange,
                  ),
                );
              }
            }
          } catch (e) {
            if (mounted) {
              setState(() {
                _isLoading = false;
              });
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('Payment error: $e'),
                  backgroundColor: Colors.red,
                ),
              );
            }
          }
        } else {
          // Fallback: show instructions or open web checkout
          setState(() {
            _paymentCreated = true;
            _isLoading = false;
          });
          
          if (kIsWeb && data['checkoutUrl'] != null) {
            // Open Stripe Checkout on web
            final checkoutUrl = data['checkoutUrl'] as String;
            final uri = Uri.parse(checkoutUrl);
            if (await canLaunchUrl(uri)) {
              await launchUrl(uri, mode: LaunchMode.externalApplication);
            }
          } else {
            // Show instructions for manual payment or webhook processing
            _showPaymentInstructions();
          }
        }
      }
    } catch (e) {
      setState(() => _isLoading = false);
      if (mounted) {
        String errorMessage = 'Error creating payment';
        if (e is DioException && e.response != null) {
          final responseData = e.response!.data;
          if (responseData is Map && responseData['message'] != null) {
            errorMessage = responseData['message'].toString();
          }
        }
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(errorMessage),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  void _showPaymentInstructions() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Payment Instructions'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Payment Intent Created Successfully!'),
            const SizedBox(height: 16),
            Text('Invoice: ${widget.invoice.number}'),
            Text('Amount: \$${widget.invoice.total.toStringAsFixed(2)} ${widget.invoice.currency}'),
            const SizedBox(height: 16),
            const Text(
              'To complete payment integration:\n\n'
              '1. Install Stripe Flutter SDK: flutter_stripe\n'
              '2. Use the client secret to initialize payment\n'
              '3. Handle payment confirmation\n\n'
              'For now, payment processing is handled server-side via webhooks.',
              style: TextStyle(fontSize: 12),
            ),
            if (_clientSecret != null) ...[
              const SizedBox(height: 16),
              const Text('Client Secret:', style: TextStyle(fontWeight: FontWeight.bold)),
              SelectableText(
                _clientSecret!,
                style: const TextStyle(fontSize: 10, fontFamily: 'monospace'),
              ),
            ],
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Close'),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(context);
              Navigator.pop(context, true); // Return success
            },
            child: const Text('OK'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Pay Invoice'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Invoice ${widget.invoice.number}',
                      style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Total Amount:'),
                        Text(
                          '\$${widget.invoice.total.toStringAsFixed(2)} ${widget.invoice.currency}',
                          style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Color(0xFF4a90e2)),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Due Date:'),
                        Text(
                          widget.invoice.dueDate != null
                              ? '${widget.invoice.dueDate!.year}-${widget.invoice.dueDate!.month.toString().padLeft(2, '0')}-${widget.invoice.dueDate!.day.toString().padLeft(2, '0')}'
                              : 'N/A',
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),
            if (!_paymentCreated) ...[
              ElevatedButton(
                onPressed: _isLoading ? null : _markAsPaid,
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  backgroundColor: Colors.green,
                  foregroundColor: Colors.white,
                ),
                child: _isLoading
                    ? const CircularProgressIndicator(color: Colors.white)
                    : const Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.check_circle, size: 24),
                          SizedBox(width: 8),
                          Text('Mark as Paid', style: TextStyle(fontSize: 18)),
                        ],
                      ),
              ),
              const SizedBox(height: 12),
              OutlinedButton(
                onPressed: _isLoading ? null : _createPaymentIntent,
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  side: const BorderSide(color: Color(0xFF4a90e2), width: 2),
                ),
                child: const Text(
                  'Create Stripe Payment',
                  style: TextStyle(fontSize: 16, color: Color(0xFF4a90e2)),
                ),
              ),
            ] else
              Column(
                children: [
                  const Icon(Icons.check_circle, color: Colors.green, size: 64),
                  const SizedBox(height: 16),
                  const Text(
                    'Payment Intent Created',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Payment Intent ID: $_paymentIntentId',
                    style: TextStyle(fontSize: 12, color: Colors.grey[600]),
                  ),
                  const SizedBox(height: 24),
                  ElevatedButton(
                    onPressed: () => Navigator.pop(context, true),
                    child: const Text('Done'),
                  ),
                ],
              ),
            const SizedBox(height: 16),
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
          ],
        ),
      ),
    );
  }
}

