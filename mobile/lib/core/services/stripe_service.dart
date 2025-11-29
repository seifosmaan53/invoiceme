// Flutter imports
import 'package:flutter/foundation.dart' show kDebugMode, debugPrint;
import 'package:flutter/material.dart';

// Package imports
import 'package:flutter_stripe/flutter_stripe.dart';

/// Service for Stripe payment processing
class StripeService {
  static bool _initialized = false;

  /// Initialize Stripe with publishable key
  /// Returns true if initialization was successful
  static Future<bool> initialize(String? publishableKey) async {
    if (publishableKey == null || publishableKey.isEmpty) {
      if (kDebugMode) {
        debugPrint('Stripe publishable key not provided. Stripe SDK will not be available.');
      }
      return false;
    }

    try {
      Stripe.publishableKey = publishableKey;
      await Stripe.instance.applySettings();
      _initialized = true;
      return true;
    } catch (e) {
      if (kDebugMode) {
        debugPrint('Error initializing Stripe: $e');
      }
      return false;
    }
  }

  /// Check if Stripe is initialized
  static bool get isInitialized => _initialized;

  /// Present payment sheet for payment intent
  /// Returns true if payment was successful
  static Future<bool> presentPaymentSheet({
    required String clientSecret,
    String? merchantDisplayName,
  }) async {
    if (!_initialized) {
      throw Exception('Stripe is not initialized. Please provide a publishable key.');
    }

    try {
      // Initialize payment sheet
      await Stripe.instance.initPaymentSheet(
        paymentSheetParameters: SetupPaymentSheetParameters(
          paymentIntentClientSecret: clientSecret,
          merchantDisplayName: merchantDisplayName ?? 'InvoiceMe',
        ),
      );

      // Present payment sheet
      await Stripe.instance.presentPaymentSheet();

      // Payment was successful
      return true;
    } on StripeException catch (e) {
      // Handle Stripe-specific errors
      if (e.error.code == FailureCode.Canceled) {
        // User canceled payment
        return false;
      } else {
        // Other Stripe errors
        throw Exception('Payment failed: ${e.error.message}');
      }
    } catch (e) {
      throw Exception('Error presenting payment sheet: $e');
    }
  }

}

