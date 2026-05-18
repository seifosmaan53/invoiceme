import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart' show kIsWeb, kDebugMode, debugPrint;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:dio/dio.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../core/providers/providers.dart';
import '../core/widgets/copyable_text.dart';
import '../core/widgets/copyable_error.dart';
import '../models/invoice.dart';
import '../models/invoice_item.dart';
import '../models/attachment.dart';
import '../widgets/invoice_timeline.dart';
import '../widgets/attachment_list.dart';
import '../widgets/attachment_viewer.dart';
import 'edit_invoice_screen.dart';
import 'payment_screen.dart';
import 'attachment_upload_screen.dart';

class InvoiceDetailScreen extends ConsumerStatefulWidget {
  final Invoice invoice;

  const InvoiceDetailScreen({super.key, required this.invoice});

  @override
  ConsumerState<InvoiceDetailScreen> createState() => _InvoiceDetailScreenState();
}

class _InvoiceDetailScreenState extends ConsumerState<InvoiceDetailScreen> {
  Invoice? _fullInvoice;
  bool _isLoading = true;
  List<Attachment> _attachments = [];
  bool _attachmentsLoading = false;

  @override
  void initState() {
    super.initState();
    _loadFullInvoice();
    _loadAttachments();
  }

  Future<void> _loadFullInvoice() async {
    if (!mounted) return;
    try {
      final apiClient = ref.read(apiClientProvider);
      final response = await apiClient.get('/invoices/${widget.invoice.id}');
      if (mounted) {
        setState(() {
          _fullInvoice = Invoice.fromJson(response.data);
          // Check if status should be updated based on due date (overdue check)
          if (_fullInvoice != null && _fullInvoice!.dueDate != null) {
            final now = DateTime.now();
            final dueDate = _fullInvoice!.dueDate!;
            final isOverdue = dueDate.isBefore(now) && 
                             _fullInvoice!.status != InvoiceStatus.paid && 
                             _fullInvoice!.status != InvoiceStatus.cancelled &&
                             _fullInvoice!.status != InvoiceStatus.overdue;
            
            // Status will be updated by backend on next request if overdue
          }
          
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isLoading = false);
        CopyableErrorSnackBar.show(context, 'Error loading invoice: $e');
      }
    }
  }

  Future<void> _loadAttachments() async {
    if (!mounted) return;
    setState(() => _attachmentsLoading = true);
    try {
      final apiClient = ref.read(apiClientProvider);
      final response = await apiClient.get('/invoices/${widget.invoice.id}/attachments');
      if (mounted) {
        setState(() {
          _attachments = (response.data as List)
              .map((json) => Attachment.fromJson(json))
              .toList();
          _attachmentsLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _attachmentsLoading = false);
        // Silently fail - attachments are optional
        if (e.toString().contains('404')) {
          // Invoice might not have attachments yet, that's okay
          setState(() => _attachments = []);
        }
      }
    }
  }

  String _buildInvoiceText(Invoice invoice) {
    final buffer = StringBuffer();
    final dateFormat = DateFormat('MMM dd, yyyy');
    const int lineWidth = 60;
    
    // Professional header with centered title
    final title = invoice.type.name.toUpperCase();
    final titlePadding = ((lineWidth - title.length) / 2).floor();
    buffer.writeln('═' * lineWidth);
    buffer.writeln(' ' * titlePadding + title + ' ' * (lineWidth - titlePadding - title.length));
    buffer.writeln('═' * lineWidth);
    buffer.writeln('');
    
    // Invoice metadata - Two column layout with better spacing
    buffer.writeln('Invoice Number:'.padRight(20) + invoice.number);
    buffer.writeln('Issue Date:'.padRight(20) + dateFormat.format(invoice.issueDate));
    if (invoice.dueDate != null) {
      final isOverdue = invoice.dueDate!.isBefore(DateTime.now()) && 
                       invoice.status != InvoiceStatus.paid && 
                       invoice.status != InvoiceStatus.cancelled;
      final dueDateStr = dateFormat.format(invoice.dueDate!);
      buffer.writeln('Due Date:'.padRight(20) + dueDateStr + (isOverdue ? ' ⚠ OVERDUE' : ''));
    }
    buffer.writeln('Status:'.padRight(20) + invoice.status.name.toUpperCase());
    buffer.writeln('');
    
    // Bill To section - Professional format
    buffer.writeln('─' * lineWidth);
    buffer.writeln('BILL TO');
    buffer.writeln('─' * lineWidth);
    if (invoice.client != null) {
      buffer.writeln(invoice.client!.name);
      if (invoice.client!.email != null && invoice.client!.email!.isNotEmpty) {
        buffer.writeln(invoice.client!.email);
      }
      if (invoice.client!.phone != null && invoice.client!.phone!.isNotEmpty) {
        buffer.writeln(invoice.client!.phone);
      }
      if (invoice.client!.addressJson != null) {
        final addr = invoice.client!.addressJson;
        if (addr != null && addr['address'] != null) {
          buffer.writeln(addr['address']);
        }
      }
    } else {
      buffer.writeln(invoice.clientName ?? 'N/A');
      if (invoice.clientEmail != null) {
        buffer.writeln(invoice.clientEmail);
      }
    }
    buffer.writeln('');
    
    // Items table - Professional table format
    buffer.writeln('─' * lineWidth);
    buffer.writeln('ITEMS');
    buffer.writeln('─' * lineWidth);
    
    if (invoice.items != null && invoice.items!.isNotEmpty) {
      // Table header with better alignment
      buffer.writeln('');
      buffer.writeln('#'.padRight(4) + 
                    'Description'.padRight(28) + 
                    'Qty'.padLeft(6) + 
                    'Price'.padLeft(12) + 
                    'Total'.padLeft(14));
      buffer.writeln('─' * lineWidth);
      
      for (var i = 0; i < invoice.items!.length; i++) {
        final item = invoice.items![i];
        final qty = item.quantity ?? 1;
        final unitPrice = item.unitPrice ?? 0;
        final lineTotal = item.lineTotal ?? (qty * unitPrice);
        final taxRate = item.taxRate ?? 0;
        final discountRate = item.discountRate ?? 0;
        
        // Better description handling - show full description or wrap
        final description = item.description.length > 28 
            ? item.description.substring(0, 25) + '...'
            : item.description;
        
        // Format quantity without decimal if whole number
        final qtyStr = qty == qty.truncateToDouble() 
            ? qty.toInt().toString() 
            : qty.toStringAsFixed(1);
        
        buffer.writeln('${i + 1}'.padRight(4) + 
                      description.padRight(28) + 
                      qtyStr.padLeft(6) + 
                      '${invoice.currency}${unitPrice.toStringAsFixed(2)}'.padLeft(12) + 
                      '${invoice.currency}${lineTotal.toStringAsFixed(2)}'.padLeft(14));
        
        // Show tax and discount on separate lines if applicable
        if (taxRate > 0 || discountRate > 0) {
          final details = <String>[];
          if (discountRate > 0) {
            details.add('Discount: ${discountRate.toStringAsFixed(2)}%');
          }
          if (taxRate > 0) {
            details.add('Tax: ${taxRate.toStringAsFixed(2)}%');
          }
          if (details.isNotEmpty) {
            buffer.writeln('    ' + details.join(' | '));
          }
        }
        buffer.writeln('');
      }
    } else {
      buffer.writeln('No items');
      buffer.writeln('');
    }
    
    // Totals section - Right-aligned professional format
    buffer.writeln('─' * lineWidth);
    buffer.writeln('SUMMARY');
    buffer.writeln('─' * lineWidth);
    
    // Calculate discount amount
    final hasItemDiscount = invoice.items?.any((item) => (item.discountRate ?? 0) > 0) ?? false;
    double discountAmount = 0.0;
    
    if (invoice.discountTotal > 0) {
      discountAmount = invoice.discountTotal;
    } else if (hasItemDiscount) {
      discountAmount = invoice.items?.fold<double>(0.0, (sum, item) {
        final discountRate = item.discountRate ?? 0;
        if (discountRate > 0) {
          final qty = item.quantity ?? 1;
          final unitPrice = item.unitPrice ?? 0;
          final itemSubtotal = qty * unitPrice;
          return sum + (itemSubtotal * discountRate / 100);
        }
        return sum;
      }) ?? 0.0;
    }
    
    // Format totals with proper right alignment - improved spacing
    final labelWidth = 48;
    final amountWidth = 14;
    
    final subtotalStr = '${invoice.currency}${invoice.subtotal.toStringAsFixed(2)}';
    buffer.writeln('Subtotal:'.padRight(labelWidth) + subtotalStr.padLeft(amountWidth));
    
    if (discountAmount > 0) {
      final discountStr = '-${invoice.currency}${discountAmount.toStringAsFixed(2)}';
      buffer.writeln('Discount:'.padRight(labelWidth) + discountStr.padLeft(amountWidth));
    }
    
    if (invoice.taxTotal > 0) {
      final taxStr = '${invoice.currency}${invoice.taxTotal.toStringAsFixed(2)}';
      buffer.writeln('Tax:'.padRight(labelWidth) + taxStr.padLeft(amountWidth));
    }
    
    buffer.writeln('─' * lineWidth);
    final totalStr = '${invoice.currency}${invoice.total.toStringAsFixed(2)}';
    buffer.writeln('TOTAL:'.padRight(labelWidth) + totalStr.padLeft(amountWidth));
    buffer.writeln('═' * lineWidth);
    buffer.writeln('');
    
    // Notes section - Professional format
    if (invoice.notes != null && invoice.notes!.isNotEmpty) {
      buffer.writeln('─' * lineWidth);
      buffer.writeln('NOTES');
      buffer.writeln('─' * lineWidth);
      final notesLines = invoice.notes!.split('\n');
      for (var line in notesLines) {
        if (line.trim().isNotEmpty) {
          // Word wrap long lines
          if (line.length > lineWidth) {
            final words = line.split(' ');
            String currentLine = '';
            for (var word in words) {
              if ((currentLine + word).length > lineWidth) {
                if (currentLine.isNotEmpty) {
                  buffer.writeln('  $currentLine');
                  currentLine = word;
                } else {
                  buffer.writeln('  $word');
                  currentLine = '';
                }
              } else {
                currentLine += (currentLine.isEmpty ? '' : ' ') + word;
              }
            }
            if (currentLine.isNotEmpty) {
              buffer.writeln('  $currentLine');
            }
          } else {
            buffer.writeln('  $line');
          }
        }
      }
      buffer.writeln('');
    }
    
    // Professional footer
    buffer.writeln('═' * lineWidth);
    final thankYou = 'Thank you for your business!';
    final generated = 'Generated by InvoiceMe';
    final thankYouPadding = ((lineWidth - thankYou.length) / 2).floor();
    final generatedPadding = ((lineWidth - generated.length) / 2).floor();
    buffer.writeln(' ' * thankYouPadding + thankYou);
    buffer.writeln(' ' * generatedPadding + generated);
    buffer.writeln('═' * lineWidth);
    
    return buffer.toString();
  }

  Future<void> _copyFullInvoice(BuildContext context) async {
    final invoice = _fullInvoice ?? widget.invoice;
    final text = _buildInvoiceText(invoice);
    
    try {
      await Clipboard.setData(ClipboardData(text: text));
      
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Row(
            children: [
              Icon(Icons.check_circle, color: Colors.white),
              SizedBox(width: 8),
              Expanded(
                child: SelectableText(
                  'Full invoice copied to clipboard',
                  style: TextStyle(color: Colors.white),
                  enableInteractiveSelection: true,
                ),
              ),
            ],
          ),
          backgroundColor: Colors.green,
          duration: const Duration(seconds: 3),
        ),
      );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Unable to copy. Please select and copy manually.'),
            backgroundColor: Colors.orange,
          ),
        );
      }
    }
  }

  Future<void> _viewAttachment(Attachment attachment) async {
    if (!mounted) return;
    
    // Navigate to attachment viewer screen
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => AttachmentViewer(attachment: attachment),
      ),
    );
  }

  Future<void> _generatePDF() async {
    try {
      final apiClient = ref.read(apiClientProvider);
      showDialog(
        context: context,
        barrierDismissible: false,
        builder: (context) => const Center(child: CircularProgressIndicator()),
      );
      
      // Use Dio directly to handle binary PDF responses
      final dio = Dio();
      
      // Get base URL from the invoice request and read auth token from storage
      String baseUrl;
      String? authToken;
      try {
        // Use the invoice detail request that already succeeded to get base URL
        final invoiceResponse = await apiClient.get('/invoices/${widget.invoice.id}');
        baseUrl = invoiceResponse.requestOptions.baseUrl;
        
        // Read auth token directly from storage (same way ApiClient does)
        if (kIsWeb) {
          final prefs = await SharedPreferences.getInstance();
          authToken = prefs.getString('secure_access_token');
        } else {
          const secureStorage = FlutterSecureStorage();
          authToken = await secureStorage.read(key: 'access_token');
        }
        
        // Format token as Bearer if it's not already formatted
        if (authToken != null && !authToken.startsWith('Bearer ')) {
          authToken = 'Bearer $authToken';
        }
        
        debugPrint('Extracted base URL: $baseUrl');
        debugPrint('Has auth token: ${authToken != null && authToken.isNotEmpty}');
      } catch (e) {
        debugPrint('Error getting config from invoice request: $e');
        // Fallback to default base URL
        if (kIsWeb) {
          baseUrl = 'http://localhost:3000/api/v1';
        } else {
          baseUrl = 'http://10.0.0.133:3000/api/v1';
        }
      }
      
      // Configure Dio with base URL and auth token
      dio.options.baseUrl = baseUrl;
      dio.options.headers['Content-Type'] = 'application/json';
      
      // Prepare headers for the request
      final headers = <String, dynamic>{
        'Content-Type': 'application/json',
      };
      if (authToken != null && authToken.isNotEmpty) {
        headers['Authorization'] = authToken;
        dio.options.headers['Authorization'] = authToken;
      }
      
      // Request with bytes response type to handle binary PDF
      final pdfResponse = await dio.post<dynamic>(
        '/invoices/${widget.invoice.id}/pdf',
        options: Options(
          responseType: ResponseType.bytes,
          headers: headers,
          validateStatus: (status) => status != null && status < 500,
        ),
      );
      
      if (!mounted) return;
      Navigator.pop(context);
      
      if (pdfResponse.statusCode != 200 && pdfResponse.statusCode != 201) {
        // Try to parse error message
        String errorMessage = 'PDF generation failed with status ${pdfResponse.statusCode}';
        try {
          if (pdfResponse.data is List<int>) {
            final jsonString = String.fromCharCodes(pdfResponse.data as List<int>);
            final errorData = jsonDecode(jsonString) as Map<String, dynamic>?;
            if (errorData != null && errorData['message'] != null) {
              errorMessage = errorData['message'].toString();
            }
          }
        } catch (e) {
          // Ignore parsing errors
        }
        throw Exception(errorMessage);
      }
      
      // Check Content-Type to determine response format
      final contentType = pdfResponse.headers.value('content-type')?.toLowerCase() ?? '';
      
      if (contentType.contains('application/pdf')) {
        // Binary PDF response (development mode)
        if (pdfResponse.data is! List<int>) {
          throw Exception('Invalid PDF response format');
        }
        
        final pdfBytes = pdfResponse.data as List<int>;
        
        // Verify it's a valid PDF
        if (pdfBytes.length < 4 || String.fromCharCodes(pdfBytes.take(4)) != '%PDF') {
          throw Exception('Response is not a valid PDF');
        }
        
        if (kIsWeb) {
          // On web: Create data URL and open in new window
          final base64Pdf = base64Encode(pdfBytes);
          final dataUrl = 'data:application/pdf;base64,$base64Pdf';
          final uri = Uri.parse(dataUrl);
          
          if (await canLaunchUrl(uri)) {
            await launchUrl(uri, mode: LaunchMode.externalApplication);
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('PDF opened in browser'),
                  backgroundColor: Colors.green,
                ),
              );
            }
          } else {
            throw Exception('Could not open PDF in browser');
          }
        } else {
          // On mobile: Save to temp file and open
          final tempDir = await getTemporaryDirectory();
          final fileName = 'invoice_${widget.invoice.number}.pdf';
          final filePath = '${tempDir.path}/$fileName';
          final file = File(filePath);
          
          if (await file.exists()) {
            await file.delete();
          }
          
          await file.writeAsBytes(pdfBytes);
          
          final uri = Uri.file(filePath);
          if (await canLaunchUrl(uri)) {
            await launchUrl(uri, mode: LaunchMode.externalApplication);
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('PDF opened'),
                  backgroundColor: Colors.green,
                ),
              );
            }
          } else {
            throw Exception('Could not open PDF file');
          }
        }
      } else {
        // JSON response (production mode with S3 URL)
        String jsonString;
        if (pdfResponse.data is List<int>) {
          jsonString = String.fromCharCodes(pdfResponse.data as List<int>);
        } else {
          jsonString = pdfResponse.data.toString();
        }
        
        final jsonData = jsonDecode(jsonString) as Map<String, dynamic>;
        final pdfUrl = jsonData['url'] as String? ?? jsonData['pdfUrl'] as String?;
        
        if (pdfUrl == null || pdfUrl.isEmpty) {
          throw Exception('PDF URL not found in response');
        }
        
        final uri = Uri.parse(pdfUrl);
        if (await canLaunchUrl(uri)) {
          await launchUrl(uri, mode: LaunchMode.externalApplication);
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('PDF opened in browser'),
                backgroundColor: Colors.green,
              ),
            );
          }
        } else {
          throw Exception('Could not open PDF URL');
        }
      }
    } catch (e) {
      if (mounted) {
        if (Navigator.canPop(context)) Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error generating PDF: ${e.toString().replaceFirst('Exception: ', '')}'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  Future<void> _shareInvoice() async {
    final invoice = _fullInvoice ?? widget.invoice;
    final shareService = ref.read(shareServiceProvider);
    
    await shareService.shareInvoice(
      invoice: invoice,
      context: context,
      showLoading: true,
    );
  }

  Future<void> _editInvoice() async {
    if (_fullInvoice == null) return;
    final result = await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => EditInvoiceScreen(invoice: _fullInvoice!),
      ),
    );
    if (result == true) {
      await _loadFullInvoice();
      setState(() {}); // Force UI update
      // Notify parent screen to refresh
      Navigator.pop(context, true);
    }
  }

  void _showStatusChangeDialog(BuildContext context, Invoice invoice) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Change Invoice Status'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: InvoiceStatus.values.map((status) {
            final isCurrentStatus = invoice.status == status;
            return ListTile(
              leading: Icon(
                _InvoiceDetailScreenState._getStatusIcon(status),
                color: isCurrentStatus
                    ? _InvoiceDetailScreenState._getStatusColor(status)
                    : Theme.of(context).colorScheme.onSurfaceVariant,
              ),
              title: Text(
                status.name.toUpperCase(),
                style: TextStyle(
                  fontWeight: isCurrentStatus ? FontWeight.bold : FontWeight.normal,
                  color: isCurrentStatus ? _InvoiceDetailScreenState._getStatusColor(status) : null,
                ),
              ),
              subtitle: Text(_InvoiceDetailScreenState._getStatusDescription(status)),
              trailing: isCurrentStatus
                  ? const Icon(Icons.check, color: Colors.green)
                  : null,
              onTap: isCurrentStatus
                  ? null
                  : () {
                      Navigator.pop(context);
                      _updateStatus(status);
                    },
            );
          }).toList(),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
        ],
      ),
    );
  }

  static IconData _getStatusIcon(InvoiceStatus status) {
    switch (status) {
      case InvoiceStatus.draft:
        return Icons.edit_note;
      case InvoiceStatus.sent:
        return Icons.send;
      case InvoiceStatus.paid:
        return Icons.check_circle;
      case InvoiceStatus.overdue:
        return Icons.warning;
      case InvoiceStatus.cancelled:
        return Icons.cancel;
    }
  }

  static String _getStatusDescription(InvoiceStatus status) {
    switch (status) {
      case InvoiceStatus.draft:
        return 'Invoice is being prepared';
      case InvoiceStatus.sent:
        return 'Invoice has been sent to client';
      case InvoiceStatus.paid:
        return 'Invoice has been paid';
      case InvoiceStatus.overdue:
        return 'Invoice payment is overdue';
      case InvoiceStatus.cancelled:
        return 'Invoice has been cancelled';
    }
  }

  static Color _getStatusColor(InvoiceStatus status) {
    switch (status) {
      case InvoiceStatus.paid:
        return Colors.green;
      case InvoiceStatus.overdue:
        return Colors.red;
      case InvoiceStatus.sent:
        return Colors.blue;
      case InvoiceStatus.draft:
        return Colors.grey;
      case InvoiceStatus.cancelled:
        return Colors.grey;
    }
  }

  Future<void> _updateStatus(InvoiceStatus newStatus) async {
    final invoice = _fullInvoice ?? widget.invoice;
    
    try {
      showDialog(
        context: context,
        barrierDismissible: false,
        builder: (context) => const Center(child: CircularProgressIndicator()),
      );

      final apiClient = ref.read(apiClientProvider);
      
      // Clear cache for this invoice and related endpoints to avoid stale data
      apiClient.clearCache('/invoices/${invoice.id}');
      apiClient.clearCache('/invoices');
      apiClient.clearCache('/invoices/stats');
      
      await apiClient.patch(
        '/invoices/${invoice.id}',
        data: {'status': newStatus.name},
      );

      if (mounted) {
        Navigator.pop(context); // Close loading dialog
        
        // Optimistic update: Create new invoice instance with updated status
        if (_fullInvoice != null) {
          setState(() {
            _fullInvoice = Invoice(
              id: _fullInvoice!.id,
              userId: _fullInvoice!.userId,
              clientId: _fullInvoice!.clientId,
              type: _fullInvoice!.type,
              number: _fullInvoice!.number,
              status: newStatus, // Updated status
              issueDate: _fullInvoice!.issueDate,
              dueDate: _fullInvoice!.dueDate,
              currency: _fullInvoice!.currency,
              subtotal: _fullInvoice!.subtotal,
              taxTotal: _fullInvoice!.taxTotal,
              discountTotal: _fullInvoice!.discountTotal,
              total: _fullInvoice!.total,
              notes: _fullInvoice!.notes,
              metadataJson: _fullInvoice!.metadataJson,
              createdAt: _fullInvoice!.createdAt,
              updatedAt: DateTime.now(), // Update timestamp
              deletedAt: _fullInvoice!.deletedAt,
              client: _fullInvoice!.client,
              items: _fullInvoice!.items,
            );
          });
        }
        
        // Reload in background for any server-side calculations, but don't block UI
        _loadFullInvoice().catchError((e) {
          // If reload fails, we already updated UI optimistically
          if (kDebugMode) {
            debugPrint('Background reload failed: $e');
          }
        });
        
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Status changed to ${newStatus.name.toUpperCase()}'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        if (Navigator.canPop(context)) Navigator.pop(context); // Close loading dialog
        CopyableErrorSnackBar.show(context, 'Error updating status: $e');
      }
    }
  }

  Future<void> _markAsSent() async {
    if (_fullInvoice == null) return;
    
    try {
      final apiClient = ref.read(apiClientProvider);
      
      // Clear cache for this invoice and related endpoints
      apiClient.clearCache('/invoices/${_fullInvoice!.id}');
      apiClient.clearCache('/invoices');
      apiClient.clearCache('/invoices/stats');
      
      await apiClient.patch(
        '/invoices/${_fullInvoice!.id}',
        data: {'status': 'sent'},
      );
      
      if (mounted) {
        // Optimistic update: Create new invoice instance with updated status
        setState(() {
          _fullInvoice = Invoice(
            id: _fullInvoice!.id,
            userId: _fullInvoice!.userId,
            clientId: _fullInvoice!.clientId,
            type: _fullInvoice!.type,
            number: _fullInvoice!.number,
            status: InvoiceStatus.sent, // Updated status
            issueDate: _fullInvoice!.issueDate,
            dueDate: _fullInvoice!.dueDate,
            currency: _fullInvoice!.currency,
            subtotal: _fullInvoice!.subtotal,
            taxTotal: _fullInvoice!.taxTotal,
            discountTotal: _fullInvoice!.discountTotal,
            total: _fullInvoice!.total,
            notes: _fullInvoice!.notes,
            metadataJson: _fullInvoice!.metadataJson,
            createdAt: _fullInvoice!.createdAt,
            updatedAt: DateTime.now(), // Update timestamp
            deletedAt: _fullInvoice!.deletedAt,
            client: _fullInvoice!.client,
            items: _fullInvoice!.items,
          );
        });
        
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Invoice marked as sent successfully!'),
            backgroundColor: Colors.green,
          ),
        );
        
        // Reload in background for any server-side calculations
        _loadFullInvoice().catchError((e) {
          if (kDebugMode) {
            debugPrint('Background reload failed: $e');
          }
        });
      }
    } catch (e) {
      if (mounted) {
        CopyableErrorSnackBar.show(context, 'Error updating status: $e');
      }
    }
  }

  Future<void> _payInvoice() async {
    if (_fullInvoice == null) return;
    final result = await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => PaymentScreen(invoice: _fullInvoice!),
      ),
    );
    if (result == true) {
      await _loadFullInvoice();
      setState(() {}); // Force UI update to show new status
      // Notify parent screen to refresh
      Navigator.pop(context, true);
    }
  }

  Future<void> _uploadAttachment() async {
    final result = await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => AttachmentUploadScreen(invoiceId: widget.invoice.id),
      ),
    );
    
    // Reload attachments after upload
    if (result == true) {
      await _loadAttachments();
      setState(() {}); // Force UI update
    }
  }


  Widget _buildAttachmentsSection() {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    const Icon(Icons.attach_file, color: Color(0xFF4a90e2)),
                    const SizedBox(width: 8),
                    const Text(
                      'Attachments',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                        color: Colors.grey,
                      ),
                    ),
                    if (_attachments.isNotEmpty) ...[
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: const Color(0xFF4a90e2).withOpacity(0.1),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(
                          '${_attachments.length}',
                          style: const TextStyle(
                            color: Color(0xFF4a90e2),
                            fontWeight: FontWeight.bold,
                            fontSize: 12,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
                if (_attachmentsLoading)
                  const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                else
                  IconButton(
                    icon: const Icon(Icons.refresh, size: 20),
                    onPressed: _loadAttachments,
                    tooltip: 'Refresh attachments',
                  ),
              ],
            ),
            const SizedBox(height: 12),
            AttachmentList(
              attachments: _attachments,
              isLoading: _attachmentsLoading,
              onView: (attachment) {
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (context) => AttachmentViewer(attachment: attachment),
                  ),
                );
              },
              onDownload: (attachment) async {
                final uri = Uri.parse(attachment.url);
                if (await canLaunchUrl(uri)) {
                  await launchUrl(uri, mode: LaunchMode.externalApplication);
                }
              },
              onRefresh: _loadAttachments,
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _deleteInvoice() async {
    final invoice = _fullInvoice ?? widget.invoice;
    
    // Show confirmation dialog
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete Invoice'),
        content: Text(
          'Are you sure you want to delete invoice ${invoice.number}? This action cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('Delete'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    try {
      showDialog(
        context: context,
        barrierDismissible: false,
        builder: (context) => const Center(child: CircularProgressIndicator()),
      );

      final apiClient = ref.read(apiClientProvider);
      await apiClient.delete('/invoices/${invoice.id}');

      if (mounted) {
        Navigator.pop(context); // Close loading dialog
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Invoice deleted successfully'),
            backgroundColor: Colors.green,
          ),
        );
        // Navigate back to invoices list
        Navigator.pop(context, true); // Return true to signal parent to refresh
      }
    } catch (e) {
      if (mounted) {
        if (Navigator.canPop(context)) Navigator.pop(context); // Close loading dialog
        CopyableErrorSnackBar.show(context, 'Error deleting invoice: $e');
      }
    }
  }

  Future<void> _duplicateInvoice() async {
    try {
      showDialog(
        context: context,
        barrierDismissible: false,
        builder: (context) => const Center(child: CircularProgressIndicator()),
      );

      final apiClient = ref.read(apiClientProvider);
      final response = await apiClient.post('/invoices/${widget.invoice.id}/duplicate');

      if (mounted) Navigator.pop(context); // Close loading dialog

      if (response.statusCode == 201 || response.statusCode == 200) {
        final duplicatedInvoice = Invoice.fromJson(response.data);
        
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Invoice duplicated successfully!'),
              backgroundColor: Colors.green,
              duration: Duration(seconds: 2),
            ),
          );

          // Navigate to the new invoice detail screen
          Navigator.pushReplacement(
            context,
            MaterialPageRoute(
              builder: (_) => InvoiceDetailScreen(invoice: duplicatedInvoice),
            ),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        if (Navigator.canPop(context)) Navigator.pop(context); // Close loading dialog
        CopyableErrorSnackBar.show(context, 'Error duplicating invoice: $e');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final invoice = _fullInvoice ?? widget.invoice;
    final dateFormat = DateFormat('MMM dd, yyyy');

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        elevation: 0,
        title: Text(invoice.number),
        actions: [
          IconButton(
            icon: const Icon(Icons.share),
            tooltip: 'Share Invoice',
            onPressed: _shareInvoice,
          ),
          IconButton(
            icon: const Icon(Icons.copy_all),
            tooltip: 'Copy Full Invoice',
            onPressed: () => _copyFullInvoice(context),
          ),
          IconButton(
            icon: const Icon(Icons.attach_file),
            tooltip: 'Upload Attachment',
            onPressed: _uploadAttachment,
          ),
          PopupMenuButton(
            itemBuilder: (context) => [
              const PopupMenuItem(
                value: 'share',
                child: Row(
                  children: [
                    Icon(Icons.share, color: Colors.blue),
                    SizedBox(width: 8),
                    Text('Share Invoice'),
                  ],
                ),
              ),
              const PopupMenuItem(
                value: 'pdf',
                child: Row(
                  children: [
                    Icon(Icons.picture_as_pdf, color: Colors.red),
                    SizedBox(width: 8),
                    Text('Generate PDF'),
                  ],
                ),
              ),
              if (_fullInvoice?.status != InvoiceStatus.paid && _fullInvoice?.status != InvoiceStatus.cancelled)
                const PopupMenuItem(
                  value: 'pay',
                  child: Row(
                    children: [
                      Icon(Icons.payment, color: Colors.green),
                      SizedBox(width: 8),
                      Text('Pay Invoice'),
                    ],
                  ),
                ),
              if (_fullInvoice?.status == InvoiceStatus.draft) ...[
                const PopupMenuItem(
                  value: 'markSent',
                  child: Row(
                    children: [
                      Icon(Icons.send, color: Colors.blue),
                      SizedBox(width: 8),
                      Text('Mark as Sent'),
                    ],
                  ),
                ),
                const PopupMenuItem(
                  value: 'edit',
                  child: Row(
                    children: [
                      Icon(Icons.edit, color: Colors.blue),
                      SizedBox(width: 8),
                      Text('Edit'),
                    ],
                  ),
                ),
              ],
              const PopupMenuItem(
                value: 'duplicate',
                child: Row(
                  children: [
                    Icon(Icons.copy, color: Colors.orange),
                    SizedBox(width: 8),
                    Text('Duplicate Invoice'),
                  ],
                ),
              ),
              const PopupMenuItem(
                value: 'delete',
                child: Row(
                  children: [
                    Icon(Icons.delete, color: Colors.red),
                    SizedBox(width: 8),
                    Text('Delete Invoice'),
                  ],
                ),
              ),
            ],
            onSelected: (value) {
              if (value == 'share') {
                _shareInvoice();
                return;
              }
              switch (value) {
                case 'pdf':
                  _generatePDF();
                  break;
                case 'pay':
                  _payInvoice();
                  break;
                case 'markSent':
                  _markAsSent();
                  break;
                case 'edit':
                  _editInvoice();
                  break;
                case 'duplicate':
                  _duplicateInvoice();
                  break;
                case 'delete':
                  _deleteInvoice();
                  break;
              }
            },
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _InvoiceHeaderCard(
                    invoice: invoice,
                    dateFormat: dateFormat,
                    onStatusTap: () => _showStatusChangeDialog(context, invoice),
                  ),
                  const SizedBox(height: 16),
                  _ClientInfoCard(invoice: invoice),
                  const SizedBox(height: 16),
                  _ItemsCard(invoice: invoice),
                  const SizedBox(height: 16),
                  _TotalsCard(invoice: invoice),
                  if (invoice.notes != null && invoice.notes!.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    _NotesCard(invoice: invoice),
                  ],
                  const SizedBox(height: 16),
                  _buildAttachmentsSection(),
                  const SizedBox(height: 16),
                  InvoiceTimeline(invoice: invoice),
                ],
              ),
            ),
    );
  }
}

class _InvoiceHeaderCard extends StatelessWidget {
  final Invoice invoice;
  final DateFormat dateFormat;
  final VoidCallback onStatusTap;

  const _InvoiceHeaderCard({
    required this.invoice,
    required this.dateFormat,
    required this.onStatusTap,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          gradient: LinearGradient(
            colors: [
              Theme.of(context).colorScheme.primaryContainer.withOpacity(0.3),
              Theme.of(context).colorScheme.surface,
            ],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: CopyableText(
                      text: invoice.number,
                      style: const TextStyle(
                        fontSize: 26,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF4a90e2),
                      ),
                      showCopyButton: false,
                    ),
                  ),
                  InkWell(
                    onTap: onStatusTap,
                    borderRadius: BorderRadius.circular(20),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                      decoration: BoxDecoration(
                        color: _InvoiceHeaderCard._getStatusColor(invoice.status),
                        borderRadius: BorderRadius.circular(20),
                        boxShadow: [
                          BoxShadow(
                            color: _InvoiceHeaderCard._getStatusColor(invoice.status).withOpacity(0.3),
                            blurRadius: 4,
                            offset: const Offset(0, 2),
                          ),
                        ],
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            invoice.status.name.toUpperCase(),
                            style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.bold,
                              fontSize: 12,
                              letterSpacing: 0.5,
                            ),
                          ),
                          const SizedBox(width: 4),
                          const Icon(
                            Icons.edit,
                            color: Colors.white,
                            size: 14,
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              Row(
                children: [
                  Expanded(
                    child: _InfoItem(
                      label: 'Issue Date',
                      value: dateFormat.format(invoice.issueDate),
                      icon: Icons.calendar_today,
                    ),
                  ),
                  if (invoice.dueDate != null) ...[
                    const SizedBox(width: 16),
                    Expanded(
                      child: _InfoItem(
                        label: 'Due Date',
                        value: dateFormat.format(invoice.dueDate!),
                        icon: Icons.event,
                      ),
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  static Color _getStatusColor(InvoiceStatus status) {
    switch (status) {
      case InvoiceStatus.paid:
        return Colors.green;
      case InvoiceStatus.overdue:
        return Colors.red;
      case InvoiceStatus.sent:
        return Colors.blue;
      case InvoiceStatus.draft:
        return Colors.grey;
      case InvoiceStatus.cancelled:
        return Colors.grey;
    }
  }
}

class _InfoItem extends StatelessWidget {
  final String label;
  final String value;
  final IconData? icon;

  const _InfoItem({required this.label, required this.value, this.icon});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.grey[200]!),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (icon != null) ...[
                Icon(icon, size: 16, color: Colors.grey[600]),
                const SizedBox(width: 4),
              ],
              Text(
                label,
                style: TextStyle(fontSize: 12, color: Colors.grey[600], fontWeight: FontWeight.w500),
              ),
            ],
          ),
          const SizedBox(height: 6),
          CopyableText(
            text: value,
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            showCopyButton: false,
          ),
        ],
      ),
    );
  }
}

class _ClientInfoCard extends StatelessWidget {
  final Invoice invoice;

  const _ClientInfoCard({required this.invoice});

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFF4a90e2).withOpacity(0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(Icons.person, color: Color(0xFF4a90e2)),
                ),
                const SizedBox(width: 12),
                const Text(
                  'Bill To',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            CopyableText(
              text: invoice.clientName ?? 'N/A',
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
              prefixIcon: const Icon(Icons.business, size: 20),
            ),
            if (invoice.clientEmail != null) ...[
              const SizedBox(height: 12),
              CopyableText(
                text: invoice.clientEmail!,
                style: TextStyle(
                  fontSize: 16,
                  color: Theme.of(context).colorScheme.onSurface,
                ),
                prefixIcon: Icon(
                  Icons.email,
                  size: 18,
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ItemsCard extends StatelessWidget {
  final Invoice invoice;

  const _ItemsCard({required this.invoice});

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surfaceVariant.withOpacity(0.3),
              borderRadius: const BorderRadius.vertical(top: Radius.circular(12)),
            ),
            child: Row(
              children: [
                Icon(
                  Icons.list,
                  color: Theme.of(context).primaryColor,
                ),
                const SizedBox(width: 8),
                Text(
                  'Items',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: Theme.of(context).colorScheme.onSurface,
                  ),
                ),
              ],
            ),
          ),
          if (invoice.items == null || invoice.items!.isEmpty)
            Padding(
              padding: const EdgeInsets.all(24),
              child: Center(
                child: Text(
                  'No items',
                  style: TextStyle(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
            )
          else
            ...invoice.items!.map((item) => _InvoiceItemRow(item: item, currency: invoice.currency)),
        ],
      ),
    );
  }
}

class _InvoiceItemRow extends StatelessWidget {
  final InvoiceItem item;
  final String currency;

  const _InvoiceItemRow({
    required this.item,
    required this.currency,
  });

  @override
  Widget build(BuildContext context) {
    // Null-safe extraction of item fields
    final qty = item.quantity ?? 1;
    final unitPrice = item.unitPrice ?? 0;
    final taxRate = item.taxRate ?? 0;
    final discountRate = item.discountRate ?? 0;
    final lineTotal = item.lineTotal ?? (qty * unitPrice);
    
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(color: Theme.of(context).dividerColor),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                CopyableText(
                  text: item.description,
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                  showCopyButton: false,
                ),
                const SizedBox(height: 6),
                Text(
                  'Qty: $qty × $currency${unitPrice.toStringAsFixed(2)}',
                  style: TextStyle(
                    fontSize: 13,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
                if (discountRate > 0 || taxRate > 0) ...[
                  const SizedBox(height: 4),
                  Wrap(
                    spacing: 8,
                    children: [
                      if (discountRate > 0)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: Theme.of(context).brightness == Brightness.dark
                                ? Colors.orange.withOpacity(0.2)
                                : Colors.orange[50],
                            borderRadius: BorderRadius.circular(4),
                            border: Border.all(
                              color: Theme.of(context).brightness == Brightness.dark
                                  ? Colors.orange.withOpacity(0.5)
                                  : Colors.orange[200]!,
                            ),
                          ),
                          child: Text(
                            'Discount: ${discountRate.toStringAsFixed(1)}%',
                            style: TextStyle(
                              fontSize: 11,
                              color: Theme.of(context).brightness == Brightness.dark
                                  ? Colors.orange[300]
                                  : Colors.orange[900],
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ),
                      if (taxRate > 0)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: Theme.of(context).brightness == Brightness.dark
                                ? Colors.blue.withOpacity(0.2)
                                : Colors.blue[50],
                            borderRadius: BorderRadius.circular(4),
                            border: Border.all(
                              color: Theme.of(context).brightness == Brightness.dark
                                  ? Colors.blue.withOpacity(0.5)
                                  : Colors.blue[200]!,
                            ),
                          ),
                          child: Text(
                            'Tax: ${taxRate.toStringAsFixed(1)}%',
                            style: TextStyle(
                              fontSize: 11,
                              color: Theme.of(context).brightness == Brightness.dark
                                  ? Colors.blue[300]
                                  : Colors.blue[900],
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              CopyableText(
                text: '$currency${lineTotal.toStringAsFixed(2)}',
                style: const TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 18,
                  color: Color(0xFF4a90e2),
                ),
                showCopyButton: false,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _TotalsCard extends StatelessWidget {
  final Invoice invoice;

  const _TotalsCard({required this.invoice});

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 3,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          gradient: LinearGradient(
            colors: [
              Theme.of(context).colorScheme.primaryContainer.withOpacity(0.2),
              Theme.of(context).colorScheme.surface,
            ],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            children: [
              _TotalRow(label: 'Subtotal', value: invoice.subtotal, currency: invoice.currency),
              Builder(
                builder: (context) {
                  // Calculate discount amount with null-safety
                  double discountAmount = 0.0;
                  if (invoice.discountTotal > 0) {
                    discountAmount = invoice.discountTotal;
                  } else {
                    final hasItemDiscount = invoice.items?.any((item) => (item.discountRate ?? 0) > 0) ?? false;
                    if (hasItemDiscount) {
                      discountAmount = invoice.items?.fold<double>(0.0, (sum, item) {
                        final discountRate = item.discountRate ?? 0;
                        if (discountRate > 0) {
                          final qty = item.quantity ?? 1;
                          final unitPrice = item.unitPrice ?? 0;
                          final itemSubtotal = qty * unitPrice;
                          return sum + (itemSubtotal * discountRate / 100);
                        }
                        return sum;
                      }) ?? 0.0;
                    }
                  }
                  
                  if (discountAmount > 0) {
                    return _TotalRow(
                      label: 'Discount', 
                      value: -discountAmount,
                      currency: invoice.currency,
                      isDiscount: true
                    );
                  }
                  return const SizedBox.shrink();
                },
              ),
              if (invoice.taxTotal > 0)
                _TotalRow(label: 'Tax', value: invoice.taxTotal, currency: invoice.currency),
              const Divider(height: 24),
              _TotalRow(
                label: 'Total',
                value: invoice.total,
                currency: invoice.currency,
                isTotal: true,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TotalRow extends StatelessWidget {
  final String label;
  final double value;
  final String currency;
  final bool isTotal;
  final bool isDiscount;

  const _TotalRow({
    required this.label,
    required this.value,
    required this.currency,
    this.isTotal = false,
    this.isDiscount = false,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: isTotal ? 20 : 16,
              fontWeight: isTotal ? FontWeight.bold : FontWeight.w500,
              color: isDiscount
                  ? Colors.red
                  : Theme.of(context).colorScheme.onSurface,
            ),
          ),
          CopyableText(
            text: '$currency${value.toStringAsFixed(2)}',
            style: TextStyle(
              fontSize: isTotal ? 24 : 18,
              fontWeight: FontWeight.bold,
              color: isTotal
                  ? Theme.of(context).primaryColor
                  : (isDiscount
                      ? Colors.red
                      : Theme.of(context).colorScheme.onSurface),
            ),
            showCopyButton: false,
          ),
        ],
      ),
    );
  }
}

class _NotesCard extends StatelessWidget {
  final Invoice invoice;

  const _NotesCard({required this.invoice});

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  Icons.note,
                  color: Theme.of(context).primaryColor,
                ),
                const SizedBox(width: 8),
                Text(
                  'Notes',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: Theme.of(context).colorScheme.onSurface,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            CopyableText(
              text: invoice.notes!,
              style: TextStyle(fontSize: 15, color: Colors.grey[800], height: 1.5),
            ),
          ],
        ),
      ),
    );
  }
}


