// Dart imports
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

// Flutter imports
import 'package:flutter/foundation.dart' show kIsWeb, debugPrint;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

// Package imports
import 'package:dio/dio.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

// Local imports
import 'api_client.dart';
import '../../models/invoice.dart';

/// Centralized service for sharing invoices and other content
class ShareService {
  final ApiClient _apiClient;

  ShareService(this._apiClient);

  /// Share an invoice as PDF
  /// 
  /// This method handles:
  /// - PDF generation via API
  /// - Downloading PDF file (mobile)
  /// - Sharing via native share sheet
  /// - Fallback to text sharing if PDF fails
  /// - Web-specific handling (URL sharing)
  Future<ShareResult> shareInvoice({
    required Invoice invoice,
    required BuildContext context,
    bool showLoading = true,
  }) async {
    // Show loading dialog with proper context handling
    if (showLoading && context.mounted) {
      showDialog(
        context: context,
        barrierDismissible: false,
        barrierColor: Colors.black54,
        builder: (dialogContext) => PopScope(
          canPop: false, // Prevent back button from closing
          child: const Center(
            child: CircularProgressIndicator(),
          ),
        ),
      );
    }

    try {
      // Step 1: Generate PDF
      final pdfUrl = await _generatePDF(invoice.id);
      
      // Close loading dialog safely
      if (showLoading && context.mounted) {
        try {
          if (Navigator.canPop(context)) {
            Navigator.of(context, rootNavigator: false).pop();
          }
        } catch (e) {
          // Ignore dialog pop errors - dialog might already be closed
        }
      }

      // Step 2: Handle web vs mobile differently
      if (kIsWeb) {
        return await _shareInvoiceWeb(invoice, pdfUrl, context);
      } else {
        return await _shareInvoiceMobile(invoice, pdfUrl, context);
      }
    } catch (e) {
      // Close loading dialog safely in error case
      if (showLoading && context.mounted) {
        try {
          if (Navigator.canPop(context)) {
            Navigator.of(context, rootNavigator: false).pop();
          }
        } catch (popError) {
          // Ignore dialog pop errors - dialog might already be closed
        }
      }

      // Don't fall back to text sharing - it's confusing
      // Instead, show a clear error message
      debugPrint('PDF share error: $e');
      if (!context.mounted) {
        return ShareResult.error('Sharing failed', e.toString());
      }
      
      // Show error to user
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Failed to share PDF',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 4),
              Text(
                e.toString().replaceFirst('Exception: ', ''),
                style: const TextStyle(fontSize: 12),
              ),
            ],
          ),
          backgroundColor: Colors.red,
          duration: const Duration(seconds: 5),
        ),
      );
      
      return ShareResult.error('Sharing failed', e.toString());
    }
  }

  /// Generate PDF via API
  /// Returns either a file path (for binary PDF in dev mode) or URL (for JSON response in prod mode)
  Future<String> _generatePDF(String invoiceId) async {
    try {
      // Use Dio directly to have control over response type
      // We need to handle both binary PDF (dev) and JSON (prod) responses
      // Create a new Dio instance with same configuration as ApiClient
      final dio = Dio();
      
      // Get base URL and auth token from ApiClient
      // We'll use any successful API request to get the base URL and auth token
      String baseUrl;
      String? authToken;
      try {
        // Make a request to get the base URL (use invoices endpoint which should always work)
        final testResponse = await _apiClient.get('/invoices', queryParameters: {'limit': 1});
        baseUrl = testResponse.requestOptions.baseUrl;
        
        // Try to get auth token from the request headers first (most reliable)
        final authHeader = testResponse.requestOptions.headers['Authorization'];
        if (authHeader != null) {
          authToken = authHeader.toString();
        }
        
        // If not found in headers, read from storage as fallback
        if (authToken == null || authToken.isEmpty) {
          debugPrint('Auth token not in request headers, reading from storage...');
          if (kIsWeb) {
            final prefs = await SharedPreferences.getInstance();
            final tokenFromStorage = prefs.getString('secure_access_token');
            if (tokenFromStorage != null && tokenFromStorage.isNotEmpty) {
              authToken = 'Bearer $tokenFromStorage';
            }
          } else {
            const secureStorage = FlutterSecureStorage();
            final tokenFromStorage = await secureStorage.read(key: 'access_token');
            if (tokenFromStorage != null && tokenFromStorage.isNotEmpty) {
              authToken = 'Bearer $tokenFromStorage';
            }
          }
        }
        
        debugPrint('Extracted base URL: $baseUrl');
        debugPrint('Has auth token: ${authToken != null && authToken.isNotEmpty}');
      } catch (e) {
        debugPrint('Error getting config for PDF generation: $e');
        // Fallback to default base URL (same logic as ApiClient)
        if (kIsWeb) {
          baseUrl = 'http://localhost:3000/api/v1';
        } else {
          baseUrl = 'http://10.0.0.133:3000/api/v1'; // Default from ApiClient
        }
        // Token will be null - request might fail if auth is required
      }
      
      // Configure Dio with base URL
      dio.options.baseUrl = baseUrl;
      dio.options.headers['Content-Type'] = 'application/json';
      
      // Prepare headers for the request (including auth token)
      final headers = <String, dynamic>{
        'Content-Type': 'application/json',
      };
      if (authToken != null && authToken.isNotEmpty) {
        headers['Authorization'] = authToken;
        debugPrint('Setting Authorization header for PDF request');
      } else {
        debugPrint('⚠️ WARNING: No auth token found!');
      }
      
      // Request with bytes response type to handle binary PDF
      final pdfResponse = await dio.post<dynamic>(
        '/invoices/$invoiceId/pdf',
        options: Options(
          responseType: ResponseType.bytes,
          headers: headers,
          validateStatus: (status) => status != null && status < 500,
        ),
      );
      
      if (pdfResponse.statusCode != 201 && pdfResponse.statusCode != 200) {
        // Try to parse error message from response
        String errorMessage = 'PDF generation failed with status ${pdfResponse.statusCode}';
        try {
          if (pdfResponse.data is List<int>) {
            // Try to parse as JSON string
            final jsonString = String.fromCharCodes(pdfResponse.data as List<int>);
            final errorData = jsonDecode(jsonString) as Map<String, dynamic>?;
            if (errorData != null && errorData['message'] != null) {
              errorMessage = errorData['message'].toString();
            }
          }
        } catch (e) {
          // Ignore parsing errors, use default message
        }
        throw Exception('PDF generation failed: $errorMessage');
      }

      // Check Content-Type header to determine response format
      final contentType = pdfResponse.headers.value('content-type')?.toLowerCase() ?? '';
      debugPrint('PDF response Content-Type: $contentType');
      
      if (contentType.contains('application/pdf')) {
        // Binary PDF response (development mode)
        debugPrint('Received binary PDF response (${pdfResponse.data.length} bytes)');
        
        // Verify it's actually a PDF by checking the header
        if (pdfResponse.data is List<int>) {
          final pdfBytes = pdfResponse.data as List<int>;
          if (pdfBytes.length < 4 || 
              String.fromCharCodes(pdfBytes.take(4)) != '%PDF') {
            throw Exception('Response is not a valid PDF (missing PDF header)');
          }
          
          if (kIsWeb) {
            // On web, create a blob URL from the binary data
            // Convert bytes to base64 and create data URL
            final base64Pdf = base64Encode(pdfBytes);
            final dataUrl = 'data:application/pdf;base64,$base64Pdf';
            debugPrint('Created data URL for web (${pdfBytes.length} bytes)');
            return dataUrl; // Return data URL for web
          } else {
            // On mobile, save to temporary file
            final tempDir = await getTemporaryDirectory();
            final sanitizedId = invoiceId.replaceAll(RegExp(r'[^\w-]'), '_');
            final fileName = 'invoice_$sanitizedId.pdf';
            final filePath = '${tempDir.path}/$fileName';
            final file = File(filePath);
            
            // Delete existing file if it exists
            if (await file.exists()) {
              await file.delete();
            }
            
            await file.writeAsBytes(pdfBytes);
            
            if (!await file.exists()) {
              throw Exception('PDF file was not created at: $filePath');
            }
            
            final fileSize = await file.length();
            if (fileSize == 0) {
              throw Exception('PDF file is empty after write');
            }
            
            debugPrint('PDF saved to temp file: $filePath (${fileSize} bytes)');
            return filePath; // Return file path for mobile
          }
        } else {
          throw Exception('Unexpected PDF response data type');
        }
      } else {
        // JSON response (production mode with S3 URL)
        debugPrint('Received JSON response, parsing for URL...');
        
        // Parse JSON from bytes
        String jsonString;
        if (pdfResponse.data is List<int>) {
          jsonString = String.fromCharCodes(pdfResponse.data as List<int>);
        } else {
          jsonString = pdfResponse.data.toString();
        }
        
        final jsonData = jsonDecode(jsonString) as Map<String, dynamic>;
        final pdfUrl = jsonData['url'] as String? ?? 
                      jsonData['pdfUrl'] as String?;
        
        if (pdfUrl == null || pdfUrl.isEmpty) {
          throw Exception('PDF URL not found in response');
        }
        
        debugPrint('PDF URL extracted from JSON: $pdfUrl');
        return pdfUrl;
      }
    } on DioException catch (e) {
      // Handle Dio-specific errors (network, 500, etc.)
      debugPrint('DioException in PDF generation: ${e.type} - ${e.message}');
      debugPrint('Response status: ${e.response?.statusCode}');
      debugPrint('Response data: ${e.response?.data}');
      
      if (e.response != null) {
        final statusCode = e.response!.statusCode;
        final errorData = e.response!.data;
        final errorMessage = errorData is Map && errorData['message'] != null
            ? (errorData['message'] is List 
                ? errorData['message'].join(', ')
                : errorData['message'].toString())
            : 'Server error (${statusCode})';
        
        if (statusCode == 500) {
          throw Exception('PDF generation failed on server: $errorMessage. Please check backend logs.');
        } else if (statusCode == 404) {
          throw Exception('Invoice not found');
        } else if (statusCode == 400) {
          throw Exception('Invalid request: $errorMessage');
        } else {
          throw Exception('PDF generation failed: $errorMessage');
        }
      } else if (e.type == DioExceptionType.connectionTimeout || 
                 e.type == DioExceptionType.receiveTimeout) {
        throw Exception('PDF generation timed out. Please try again.');
      } else if (e.type == DioExceptionType.connectionError) {
        throw Exception('Cannot connect to server. Please check your connection.');
      } else {
        throw Exception('PDF generation failed: ${e.message ?? 'Unknown error'}');
      }
    } catch (e) {
      debugPrint('Unexpected error in PDF generation: $e');
      throw Exception('Failed to generate PDF: ${e.toString()}');
    }
  }

  /// Share invoice on web (URL sharing or file download)
  Future<ShareResult> _shareInvoiceWeb(
    Invoice invoice,
    String pdfUrl,
    BuildContext context,
  ) async {
    try {
      // If it's a data URL, trigger download instead of sharing URL
      if (pdfUrl.startsWith('data:')) {
        debugPrint('Web: Handling data URL for PDF download');
        
        // Extract base64 data from data URL
        final base64Data = pdfUrl.split(',')[1];
        final pdfBytes = base64Decode(base64Data);
        
        // Create blob URL and trigger download
        // On web, we'll use the Share API with the data URL as a file
        final sanitizedNumber = invoice.number.replaceAll(RegExp(r'[^\w\s-]'), '_');
        final fileName = 'Invoice_$sanitizedNumber.pdf';
        
        // Create XFile from data URL
        final pdfFile = XFile(
          pdfUrl,
          mimeType: 'application/pdf',
          name: fileName,
        );
        
        // Try to share as file
        try {
          await Share.shareXFiles(
            [pdfFile],
            subject: 'Invoice ${invoice.number}',
          );
          
          if (!context.mounted) return ShareResult.success('Invoice PDF shared successfully');
          
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Invoice PDF shared successfully'),
              backgroundColor: Colors.green,
              duration: Duration(seconds: 3),
            ),
          );
          
          return ShareResult.success('Invoice PDF shared successfully');
        } catch (shareError) {
          // If shareXFiles fails, fall back to copying URL to clipboard
          debugPrint('ShareXFiles failed, falling back to clipboard: $shareError');
          await Clipboard.setData(ClipboardData(text: 'Invoice ${invoice.number} PDF (data URL available)'));
          
          if (!context.mounted) return ShareResult.partial('Data copied to clipboard', pdfUrl);
          
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Invoice information copied to clipboard. Use download button to save PDF.'),
              backgroundColor: Colors.blue,
              duration: Duration(seconds: 5),
            ),
          );
          
          return ShareResult.partial('Data copied to clipboard', pdfUrl);
        }
      } else {
        // Regular URL - copy to clipboard and share
        await Clipboard.setData(ClipboardData(text: pdfUrl));
        
        // Try to share
        await Share.share(
          'Invoice ${invoice.number}\n\nTotal: ${invoice.currency}${invoice.total.toStringAsFixed(2)}\n\nView invoice: $pdfUrl',
          subject: 'Invoice ${invoice.number}',
        );
        
        if (!context.mounted) return ShareResult.success('Invoice shared successfully');
        
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Invoice URL copied to clipboard and shared'),
            backgroundColor: Colors.green,
            duration: Duration(seconds: 3),
          ),
        );

        return ShareResult.success('Invoice shared successfully');
      }
    } catch (shareError) {
      // If share fails, at least we copied to clipboard
      if (!context.mounted) return ShareResult.partial('URL copied to clipboard', pdfUrl);
      
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Invoice URL copied to clipboard: ${pdfUrl.length > 100 ? pdfUrl.substring(0, 100) + "..." : pdfUrl}'),
          backgroundColor: Colors.blue,
          duration: const Duration(seconds: 5),
          action: SnackBarAction(
            label: 'Copy',
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: pdfUrl));
            },
          ),
        ),
      );

      return ShareResult.partial('URL copied to clipboard', pdfUrl);
    }
  }

  /// Share invoice on mobile (file sharing)
  Future<ShareResult> _shareInvoiceMobile(
    Invoice invoice,
    String pdfUrl,
    BuildContext context,
  ) async {
    File? tempFile;
    try {
      debugPrint('Starting PDF share for invoice: ${invoice.number}');
      debugPrint('PDF URL/path: $pdfUrl');
      
      // Download PDF file
      final pdfFile = await _downloadPDFFile(invoice, pdfUrl);
      
      debugPrint('PDF file created: ${pdfFile.path}');
      debugPrint('File name: ${pdfFile.name}');
      debugPrint('MIME type: ${pdfFile.mimeType}');
      
      // Handle data URLs (shouldn't happen on mobile, but be safe)
      if (pdfFile.path.startsWith('data:')) {
        // Data URL - use directly with XFile
        await Share.shareXFiles(
          [pdfFile],
          subject: 'Invoice ${invoice.number}',
        );
        
        if (!context.mounted) return ShareResult.success('Invoice PDF shared successfully');
        
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Invoice PDF shared successfully'),
            backgroundColor: Colors.green,
            duration: Duration(seconds: 3),
          ),
        );
        
        return ShareResult.success('Invoice PDF shared successfully');
      }
      
      // For file paths, verify file exists and is readable
      tempFile = File(pdfFile.path);
      
      if (!await tempFile.exists()) {
        throw Exception('PDF file does not exist at path: ${pdfFile.path}');
      }
      
      final fileSize = await tempFile.length();
      debugPrint('File size: $fileSize bytes');
      
      if (fileSize == 0) {
        throw Exception('PDF file is empty (0 bytes)');
      }
      
      // Verify it's a valid PDF by checking the first few bytes
      final fileBytes = await tempFile.readAsBytes();
      if (fileBytes.length < 4 || 
          String.fromCharCodes(fileBytes.take(4)) != '%PDF') {
        throw Exception('File is not a valid PDF (missing PDF header)');
      }
      
      debugPrint('Sharing PDF file via shareXFiles...');
      
      // Share the PDF file - ONLY pass the file, no text parameter
      // The text parameter can cause some apps to paste text instead of attaching the file
      await Share.shareXFiles(
        [pdfFile],
        subject: 'Invoice ${invoice.number}',
        // Explicitly NO text parameter - we want to share the FILE, not text
      );
      
      debugPrint('PDF shared successfully');
      
      // Clean up temp file after a delay (give time for share to complete)
      Future.delayed(const Duration(seconds: 10), () async {
        try {
          if (tempFile != null && await tempFile.exists()) {
            await tempFile.delete();
            debugPrint('Cleaned up temp PDF file');
          }
        } catch (e) {
          debugPrint('Error cleaning up temp file: $e');
        }
      });
      
      if (!context.mounted) return ShareResult.success('Invoice PDF shared successfully');
      
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Invoice PDF shared successfully'),
          backgroundColor: Colors.green,
          duration: Duration(seconds: 3),
        ),
      );

      return ShareResult.success('Invoice PDF shared successfully');
    } catch (shareError) {
      // Log the error for debugging
      debugPrint('PDF share error: $shareError');
      debugPrint('Error type: ${shareError.runtimeType}');
      debugPrint('PDF URL: $pdfUrl');
      if (tempFile != null) {
        try {
          final exists = await tempFile.exists();
          final size = exists ? await tempFile.length() : 0;
          debugPrint('File path: ${tempFile.path}');
          debugPrint('File exists: $exists');
          debugPrint('File size: $size bytes');
        } catch (e) {
          debugPrint('Error checking file: $e');
        }
      }
      
      // If sharing fails, show the PDF URL as fallback
      if (!context.mounted) return ShareResult.error('Sharing failed', shareError.toString());
      
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Sharing failed: ${shareError.toString().replaceFirst('Exception: ', '')}',
                style: const TextStyle(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              const Text('PDF URL:', style: TextStyle(fontSize: 12)),
              const SizedBox(height: 4),
              SelectableText(
                pdfUrl,
                style: const TextStyle(fontSize: 11),
              ),
            ],
          ),
          backgroundColor: Colors.orange,
          duration: const Duration(seconds: 8),
          action: SnackBarAction(
            label: 'Copy URL',
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: pdfUrl));
            },
          ),
        ),
      );

      return ShareResult.error('Sharing failed', shareError.toString());
    }
  }

  /// Download PDF file from URL or use local file path
  /// Handles both:
  /// - Data URLs (from binary PDF response in dev mode on web)
  /// - Local file paths (from binary PDF response in dev mode on mobile)
  /// - Remote URLs (from JSON response in prod mode)
  Future<XFile> _downloadPDFFile(Invoice invoice, String pdfPathOrUrl) async {
    try {
      // Check if it's a data URL (web)
      if (pdfPathOrUrl.startsWith('data:')) {
        // It's a data URL - create XFile from it
        debugPrint('Using data URL for PDF');
        final sanitizedNumber = invoice.number.replaceAll(RegExp(r'[^\w\s-]'), '_');
        final fileName = 'Invoice_$sanitizedNumber.pdf';
        
        // XFile can handle data URLs directly
        return XFile(
          pdfPathOrUrl,
          mimeType: 'application/pdf',
          name: fileName,
        );
      }
      // Check if it's a remote URL
      else if (pdfPathOrUrl.startsWith('http://') || pdfPathOrUrl.startsWith('https://')) {
        // It's a URL - download it
        debugPrint('Downloading PDF from URL: $pdfPathOrUrl');
        return await _downloadPDFFromUrl(invoice, pdfPathOrUrl);
      } else {
        // It's a local file path - use it directly (mobile only)
        if (kIsWeb) {
          throw Exception('Local file paths are not supported on web. Expected URL or data URL.');
        }
        
        debugPrint('Using local PDF file: $pdfPathOrUrl');
        final file = File(pdfPathOrUrl);
        
        if (!await file.exists()) {
          throw Exception('PDF file does not exist at path: $pdfPathOrUrl');
        }
        
        final fileSize = await file.length();
        if (fileSize == 0) {
          throw Exception('PDF file is empty (0 bytes)');
        }
        
        // Verify it's actually a PDF by checking the header
        final fileBytes = await file.readAsBytes();
        if (fileBytes.length < 4 || 
            String.fromCharCodes(fileBytes.take(4)) != '%PDF') {
          throw Exception('File is not a valid PDF (missing PDF header)');
        }
        
        final fileName = pdfPathOrUrl.split('/').last;
        debugPrint('Using existing PDF file: $pdfPathOrUrl (${fileSize} bytes)');
        
        return XFile(
          pdfPathOrUrl,
          mimeType: 'application/pdf',
          name: fileName,
        );
      }
    } catch (e) {
      debugPrint('PDF file access error: $e');
      throw Exception('Failed to access PDF: ${e.toString()}');
    }
  }

  /// Download PDF file from remote URL
  /// Only used on mobile - web should use data URLs directly
  Future<XFile> _downloadPDFFromUrl(Invoice invoice, String pdfUrl) async {
    if (kIsWeb) {
      throw Exception('_downloadPDFFromUrl should not be called on web. Use data URLs instead.');
    }
    
    final dio = Dio();
    
    try {
      debugPrint('Downloading PDF from: $pdfUrl');
      
      final pdfBytesResponse = await dio.get<Uint8List>(
        pdfUrl,
        options: Options(
          responseType: ResponseType.bytes,
          followRedirects: true,
          validateStatus: (status) => status! < 500,
          receiveTimeout: const Duration(seconds: 30),
        ),
      );

      if (pdfBytesResponse.data == null) {
        throw Exception('PDF download failed: No data received (status: ${pdfBytesResponse.statusCode})');
      }
      
      if (pdfBytesResponse.statusCode != 200) {
        throw Exception('PDF download failed: HTTP ${pdfBytesResponse.statusCode}');
      }

      final pdfBytes = pdfBytesResponse.data!;
      debugPrint('Downloaded ${pdfBytes.length} bytes');
      
      if (pdfBytes.isEmpty) {
        throw Exception('Downloaded PDF is empty (0 bytes)');
      }
      
      // Verify it's actually a PDF by checking the header
      if (pdfBytes.length < 4 || 
          String.fromCharCodes(pdfBytes.take(4)) != '%PDF') {
        throw Exception('Downloaded file does not appear to be a valid PDF');
      }
      
      // Save to temporary file with proper path handling (mobile only)
      final cacheDir = await getTemporaryDirectory();
      final sanitizedNumber = invoice.number.replaceAll(RegExp(r'[^\w\s-]'), '_');
      final fileName = 'Invoice_$sanitizedNumber.pdf';
      final filePath = '${cacheDir.path}/$fileName';
      final file = File(filePath);
      
      // Delete existing file if it exists
      if (await file.exists()) {
        await file.delete();
      }
      
      await file.writeAsBytes(pdfBytes);
      
      if (!await file.exists()) {
        throw Exception('PDF file was not created at: $filePath');
      }
      
      final fileSize = await file.length();
      if (fileSize == 0) {
        throw Exception('PDF file is empty after write');
      }
      
      if (fileSize != pdfBytes.length) {
        throw Exception('PDF file size mismatch: expected ${pdfBytes.length}, got $fileSize');
      }
      
      debugPrint('PDF saved successfully: $filePath (${fileSize} bytes)');
      
      return XFile(
        filePath,
        mimeType: 'application/pdf',
        name: fileName,
      );
    } catch (e) {
      debugPrint('PDF download error: $e');
      throw Exception('Failed to download PDF: ${e.toString()}');
    }
  }

  /// Fallback: Share invoice as text if PDF sharing fails
  Future<ShareResult> _shareInvoiceTextFallback(
    Invoice invoice,
    BuildContext context,
    String errorMessage,
  ) async {
    try {
      final invoiceText = _buildInvoiceText(invoice);
      
      await Share.share(
        invoiceText,
        subject: 'Invoice ${invoice.number}',
      );
      
      if (!context.mounted) return ShareResult.partial('Shared as text', errorMessage);
      
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Shared invoice as text (PDF sharing failed)',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 4),
              Text(
                'Error: ${errorMessage.replaceFirst('Exception: ', '')}',
                style: const TextStyle(fontSize: 12),
              ),
            ],
          ),
          backgroundColor: Colors.orange,
          duration: const Duration(seconds: 5),
        ),
      );

      return ShareResult.partial('Shared as text', errorMessage);
    } catch (shareError) {
      if (!context.mounted) return ShareResult.error('Sharing failed', shareError.toString());
      
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Error sharing invoice:',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 4),
              Text(errorMessage.replaceFirst('Exception: ', '')),
            ],
          ),
          backgroundColor: Colors.red,
          duration: const Duration(seconds: 5),
        ),
      );

      return ShareResult.error('Sharing failed', shareError.toString());
    }
  }

  /// Build text representation of invoice for sharing
  String _buildInvoiceText(Invoice invoice) {
    final buffer = StringBuffer();
    buffer.writeln('INVOICE ${invoice.number}');
    buffer.writeln('=' * 40);
    buffer.writeln();
    
    if (invoice.client != null) {
      buffer.writeln('Client: ${invoice.client!.name}');
      if (invoice.client!.email != null) {
        buffer.writeln('Email: ${invoice.client!.email}');
      }
      buffer.writeln();
    }
    
    buffer.writeln('Date: ${invoice.issueDate.toString().split(' ')[0]}');
    if (invoice.dueDate != null) {
      buffer.writeln('Due Date: ${invoice.dueDate!.toString().split(' ')[0]}');
    }
    buffer.writeln('Status: ${invoice.status}');
    buffer.writeln();
    
    if (invoice.items != null && invoice.items!.isNotEmpty) {
      buffer.writeln('Items:');
      for (final item in invoice.items!) {
        buffer.writeln('  - ${item.description}');
        buffer.writeln('    ${invoice.currency}${item.lineTotal.toStringAsFixed(2)} (${item.quantity} x ${invoice.currency}${item.unitPrice.toStringAsFixed(2)})');
      }
      buffer.writeln();
    }
    
    buffer.writeln('Subtotal: ${invoice.currency}${invoice.subtotal.toStringAsFixed(2)}');
    if (invoice.taxTotal > 0) {
      buffer.writeln('Tax: ${invoice.currency}${invoice.taxTotal.toStringAsFixed(2)}');
    }
    buffer.writeln('Total: ${invoice.currency}${invoice.total.toStringAsFixed(2)}');
    
    if (invoice.notes != null && invoice.notes!.isNotEmpty) {
      buffer.writeln();
      buffer.writeln('Notes:');
      buffer.writeln(invoice.notes!);
    }
    
    return buffer.toString();
  }

  /// Share text content
  Future<ShareResult> shareText({
    required String text,
    required BuildContext context,
    String? subject,
  }) async {
    try {
      await Share.share(text, subject: subject);
      
      if (!context.mounted) return ShareResult.success('Content shared successfully');
      
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Content shared successfully'),
          backgroundColor: Colors.green,
          duration: Duration(seconds: 2),
        ),
      );

      return ShareResult.success('Content shared successfully');
    } catch (e) {
      if (!context.mounted) return ShareResult.error('Sharing failed', e.toString());
      
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to share: ${e.toString()}'),
          backgroundColor: Colors.red,
          duration: const Duration(seconds: 3),
        ),
      );

      return ShareResult.error('Sharing failed', e.toString());
    }
  }

}

/// Result of a share operation
class ShareResult {
  final bool success;
  final String message;
  final String? data;
  final String? error;

  ShareResult({
    required this.success,
    required this.message,
    this.data,
    this.error,
  });

  factory ShareResult.success(String message, [String? data]) {
    return ShareResult(success: true, message: message, data: data);
  }

  factory ShareResult.partial(String message, String? data) {
    return ShareResult(success: true, message: message, data: data);
  }

  factory ShareResult.error(String message, String error) {
    return ShareResult(success: false, message: message, error: error);
  }
}

