import 'dart:async';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:flutter_slidable/flutter_slidable.dart';
import 'package:share_plus/share_plus.dart';
import 'package:dio/dio.dart';
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as path;
import '../core/providers/providers.dart';
import '../core/providers/refresh_provider.dart';
import '../core/utils/app_animations.dart';
import '../core/services/keyboard_shortcuts.dart';
import '../core/widgets/copyable_error.dart';
import '../widgets/empty_state.dart';
import '../widgets/loading_skeleton.dart';
import '../models/invoice.dart';
import '../models/invoice_template.dart';
import 'invoice_detail_screen.dart';
import 'create_invoice_screen.dart';
import 'edit_invoice_screen.dart';

class InvoicesScreen extends ConsumerStatefulWidget {
  final String? filter; // 'unpaid', 'overdue', 'thisMonth', 'all', or null

  const InvoicesScreen({super.key, this.filter});

  @override
  ConsumerState<InvoicesScreen> createState() => _InvoicesScreenState();
}

class _InvoicesScreenState extends ConsumerState<InvoicesScreen> with AutomaticKeepAliveClientMixin {
  List<Invoice> _invoices = [];
  bool _isLoading = true;
  int _currentPage = 1;
  bool _hasMore = true;
  String? _filterType;
  InvoiceStatus? _statusFilter;
  final TextEditingController _searchController = TextEditingController();
  final FocusNode _searchFocusNode = FocusNode();
  String? _searchQuery;
  bool _isLoadingInvoices = false;
  Timer? _searchDebounceTimer;
  String? _errorMessage;
  int _lastRefreshCount = 0; // Track refresh events

  @override
  bool get wantKeepAlive => true; // Preserve state when switching tabs

  @override
  void initState() {
    super.initState();
    // Register search focus node for keyboard shortcuts
    SearchFocusRegistry.register('invoices', _searchFocusNode);
    // Apply filter from dashboard if provided
    if (widget.filter != null) {
      _applyFilter(widget.filter!);
    }
    _loadInvoices();
    _searchController.addListener(_onSearchChanged);
  }

  @override
  void dispose() {
    // Unregister search focus node
    SearchFocusRegistry.unregister('invoices');
    _searchDebounceTimer?.cancel();
    _searchController.dispose();
    _searchFocusNode.dispose();
    super.dispose();
  }

  void _onSearchChanged() {
    _searchDebounceTimer?.cancel();
    _searchDebounceTimer = Timer(const Duration(milliseconds: 500), () { // Optimal debounce: 500ms balances responsiveness and performance
      if (!mounted) return;
      final query = _searchController.text.trim();
      if (query != _searchQuery) {
        setState(() {
          _searchQuery = query.isEmpty ? null : query;
        });
        _loadInvoices(refresh: true);
      }
    });
  }

  String _getAppBarTitle() {
    if (widget.filter != null) {
      switch (widget.filter) {
        case 'unpaid':
          return 'Unpaid Invoices';
        case 'overdue':
          return 'Overdue Invoices';
        case 'thisMonth':
          return 'This Month\'s Invoices';
        case 'all':
          return 'All Invoices';
        default:
          return 'Invoices';
      }
    }
    return 'Invoices';
  }

  void _applyFilter(String filter) {
    setState(() {
      switch (filter) {
        case 'unpaid':
          _filterType = null; // We'll filter client-side
          break;
        case 'overdue':
          _filterType = null; // We'll filter client-side
          break;
        case 'thisMonth':
          _filterType = null; // We'll filter client-side
          break;
        case 'all':
        default:
          _filterType = null;
      }
    });
  }

  Future<void> _loadInvoices({bool refresh = false}) async {
    // Prevent concurrent loads
    if (_isLoadingInvoices) return;

    if (refresh) {
      if (!mounted) return;
      setState(() {
        _currentPage = 1;
        _hasMore = true;
        _invoices = []; // Clear existing invoices when refreshing
      });
    }

    if (!_hasMore && !refresh) return;

    if (!mounted) return;
    setState(() {
      _isLoadingInvoices = true;
    });

    try {
      final apiClient = ref.read(apiClientProvider);
      final queryParams = <String, dynamic>{
        'page': _currentPage,
        'limit': 20,
      };
      if (_filterType != null) {
        queryParams['type'] = _filterType;
      }
      if (_statusFilter != null) {
        queryParams['status'] = _statusFilter!.name;
      }
      if (_searchQuery != null && _searchQuery!.isNotEmpty) {
        queryParams['search'] = _searchQuery;
      }

      final response = await apiClient.get('/invoices', queryParameters: queryParams);

      final data = response.data['data'] as List;
      final meta = response.data['meta'] as Map<String, dynamic>;

      var newInvoices = data.map((json) => Invoice.fromJson(json)).toList();

      // Apply client-side filtering if filter is set
      if (widget.filter != null) {
        final now = DateTime.now();
        final today = DateTime(now.year, now.month, now.day);
        
        switch (widget.filter) {
          case 'unpaid':
            newInvoices = newInvoices.where((inv) => 
              inv.status != InvoiceStatus.paid && 
              inv.status != InvoiceStatus.cancelled
            ).toList();
            break;
          case 'overdue':
            newInvoices = newInvoices.where((inv) {
              if (inv.dueDate == null) return false;
              final dueDate = DateTime(inv.dueDate!.year, inv.dueDate!.month, inv.dueDate!.day);
              return dueDate.isBefore(today) && 
                     inv.status != InvoiceStatus.paid && 
                     inv.status != InvoiceStatus.cancelled;
            }).toList();
            break;
          case 'thisMonth':
            newInvoices = newInvoices.where((inv) {
              final date = inv.issueDate;
              return date.year == now.year && date.month == now.month;
            }).toList();
            break;
        }
      }

      if (!mounted) return;
      setState(() {
        if (refresh) {
          _invoices = newInvoices;
        } else {
          // Only add invoices that don't already exist (prevent duplicates)
          final existingIds = _invoices.map((inv) => inv.id).toSet();
          final uniqueNewInvoices = newInvoices.where((inv) => !existingIds.contains(inv.id)).toList();
          _invoices.addAll(uniqueNewInvoices);
        }
        _currentPage = meta['page'] as int;
        _hasMore = _currentPage < (meta['totalPages'] as int);
        _isLoading = false;
        _isLoadingInvoices = false;
        _errorMessage = null; // Clear any previous errors
      });
    } catch (e) {
      String errorMsg = 'Error loading invoices';
      if (e is DioException) {
        if (e.response?.statusCode == 401) {
          errorMsg = 'Session expired. Please log in again.';
        } else if (e.type == DioExceptionType.connectionError) {
          errorMsg = 'Cannot connect to server. Please check if the backend is running.';
        } else if (e.type == DioExceptionType.connectionTimeout) {
          errorMsg = 'Connection timeout. Please check your network connection.';
        } else {
          errorMsg = 'Error loading invoices: ${e.message ?? e.toString()}';
        }
      } else {
        errorMsg = 'Error loading invoices: $e';
      }

      if (!mounted) return;
      setState(() {
        _isLoading = false;
        _isLoadingInvoices = false;
        _errorMessage = errorMsg;
      });
      if (mounted) {
        // Check if it's an authentication error
        if (e.toString().contains('401') || e.toString().toLowerCase().contains('unauthorized')) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Session expired. Please log in again.'),
              backgroundColor: Colors.red,
              duration: Duration(seconds: 4),
            ),
          );
          // Navigate back to login after a short delay
          Future.delayed(const Duration(seconds: 2), () {
            if (mounted) {
              final authService = ref.read(authServiceProvider);
              authService.logout();
              Navigator.of(context).pushReplacementNamed('/login');
            }
          });
        } else {
          CopyableErrorSnackBar.show(context, errorMsg);
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context); // Required for AutomaticKeepAliveClientMixin
    // Watch for refresh events in build method (Riverpod requirement)
    final refreshCount = ref.watch(refreshNotifierProvider);
    if (refreshCount != _lastRefreshCount) {
      _lastRefreshCount = refreshCount;
      final refreshType = ref.read(refreshNotifierProvider.notifier).lastRefreshType;
      // Refresh invoices if invoices changed
      if (refreshType == RefreshType.invoices || refreshType == RefreshType.all) {
        // Use WidgetsBinding to avoid calling setState during build
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) {
            _loadInvoices(refresh: true);
          }
        });
      }
    }

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        elevation: 0,
        title: Text(_getAppBarTitle()),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(60),
          child: Padding(
            padding: const EdgeInsets.all(8.0),
            child: TextField(
              controller: _searchController,
              focusNode: _searchFocusNode,
              decoration: InputDecoration(
                hintText: 'Search by customer name, invoice number...',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _searchController.text.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () {
                          _searchController.clear();
                        },
                      )
                    : null,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
                filled: true,
                fillColor: Theme.of(context).colorScheme.surface,
              ),
            ),
          ),
        ),
        actions: [
          PopupMenuButton<String>(
            onSelected: (value) {
              if (value == 'type') {
                // Show type filter dialog
                _showTypeFilterDialog();
              } else if (value == 'status') {
                // Show status filter dialog
                _showStatusFilterDialog();
              } else {
              setState(() {
                _filterType = value == 'all' ? null : value;
                _isLoading = true;
              });
              _loadInvoices(refresh: true);
              }
            },
            itemBuilder: (context) => [
              const PopupMenuItem(
                value: 'type',
                child: Row(
                  children: [
                    Icon(Icons.category, size: 20),
                    SizedBox(width: 8),
                    Text('Filter by Type'),
                  ],
                ),
              ),
              const PopupMenuItem(
                value: 'status',
                child: Row(
                  children: [
                    Icon(Icons.filter_alt, size: 20),
                    SizedBox(width: 8),
                    Text('Filter by Status'),
                  ],
                ),
              ),
            ],
            icon: const Icon(Icons.filter_list),
          ),
          IconButton(
            icon: const Icon(Icons.copy_all),
            tooltip: 'Copy All Invoices',
            onPressed: () => _copyAllInvoices(context),
          ),
          PopupMenuButton<String>(
            icon: const Icon(Icons.add),
            tooltip: 'Create Invoice',
            onSelected: (value) async {
              if (value == 'create') {
                final result = await Navigator.push(
                  context,
                  AppPageTransitions.scale(
                    const CreateInvoiceScreen(),
                  ),
                );
                if (result == true) {
                  _loadInvoices(refresh: true);
                }
              } else if (value == 'from_template') {
                _showTemplateSelectionDialog();
              }
            },
            itemBuilder: (context) => [
              const PopupMenuItem(
                value: 'create',
                child: Row(
                  children: [
                    Icon(Icons.add, size: 20),
                    SizedBox(width: 8),
                    Text('Create Invoice'),
                  ],
                ),
              ),
              const PopupMenuItem(
                value: 'from_template',
                child: Row(
                  children: [
                    Icon(Icons.description, size: 20),
                    SizedBox(width: 8),
                    Text('Create from Template'),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
      body: _isLoading && _invoices.isEmpty
          ? ListView.builder(
              physics: const AlwaysScrollableScrollPhysics(),
              itemCount: 5,
              itemBuilder: (context, index) => const InvoiceListItemSkeleton(),
            )
          : _errorMessage != null && _invoices.isEmpty
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24.0),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      Icons.error_outline,
                      size: 64,
                      color: Colors.red[300],
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'Failed to Load Invoices',
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      _errorMessage!,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: Colors.grey[600],
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 24),
                    ElevatedButton.icon(
                      onPressed: () {
                        setState(() {
                          _isLoading = true;
                          _errorMessage = null;
                        });
                        _loadInvoices(refresh: true);
                      },
                      icon: const Icon(Icons.refresh),
                      label: const Text('Retry'),
                      style: ElevatedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                      ),
                    ),
                  ],
                ),
              ),
            )
          : RefreshIndicator(
              onRefresh: () => _loadInvoices(refresh: true),
              child: _invoices.isEmpty
                  ? LayoutBuilder(
                      builder: (context, constraints) {
                        return SingleChildScrollView(
                          physics: const AlwaysScrollableScrollPhysics(),
                          child: ConstrainedBox(
                            constraints: BoxConstraints(
                              minHeight: constraints.maxHeight,
                            ),
                            child: EmptyState(
                      icon: Icons.receipt_long_outlined,
                      title: 'No invoices yet',
                      subtitle: 'Create your first invoice to get started',
                      actionLabel: 'Create Invoice',
                      onAction: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const CreateInvoiceScreen(),
                          ),
                        ).then((result) {
                          if (result == true) {
                            _loadInvoices(refresh: true);
                          }
                        });
                      },
                    ),
                          ),
                        );
                      },
                    )
                  : ListView.builder(
                      physics: const AlwaysScrollableScrollPhysics(),
                      itemCount: _invoices.length + (_hasMore ? 1 : 0),
                      itemBuilder: (context, index) {
                        if (index == _invoices.length) {
                          _loadInvoices();
                          return const Center(
                            child: Padding(
                              padding: EdgeInsets.all(16),
                              child: CircularProgressIndicator(),
                            ),
                          );
                        }
                        final invoice = _invoices[index];
                        return StaggeredListAnimation(
                          index: index,
                          child: Slidable(
                            key: ValueKey(invoice.id),
                          endActionPane: ActionPane(
                            motion: const DrawerMotion(),
                            children: [
                              SlidableAction(
                                onPressed: (context) async {
                                  final result = await Navigator.push(
                                    context,
                                    MaterialPageRoute(
                                      builder: (_) => EditInvoiceScreen(invoice: invoice),
                                    ),
                                  );
                                  if (result == true) {
                                    _loadInvoices(refresh: true);
                                  }
                                },
                                backgroundColor: Colors.blue,
                                foregroundColor: Colors.white,
                                icon: Icons.edit,
                                label: 'Edit',
                              ),
                              SlidableAction(
                                onPressed: (context) async {
                                  // Share invoice as PDF file
                                  try {
                                    final apiClient = ref.read(apiClientProvider);
                                    
                                    // Generate PDF
                                    final pdfResponse = await apiClient.post('/invoices/${invoice.id}/pdf');
                                    if (pdfResponse.statusCode != 201 && pdfResponse.statusCode != 200) {
                                      throw Exception('Failed to generate PDF');
                                    }

                                    final pdfUrl = pdfResponse.data['url'] as String? ?? pdfResponse.data['pdfUrl'] as String?;
                                    if (pdfUrl == null) {
                                      throw Exception('PDF URL not found');
                                    }

                                    // Download PDF
                                    final dio = Dio();
                                    final pdfBytesResponse = await dio.get<Uint8List>(
                                      pdfUrl,
                                      options: Options(
                                        responseType: ResponseType.bytes,
                                        followRedirects: true,
                                      ),
                                    );

                                    if (pdfBytesResponse.data == null) {
                                      throw Exception('Failed to download PDF');
                                    }

                                    final pdfBytes = pdfBytesResponse.data!;
                                    
                                    // Share as file (mobile) or URL (web)
                                    if (kIsWeb) {
                                      await Share.share(
                                        'Invoice ${invoice.number}\nTotal: ${invoice.currency}${invoice.total.toStringAsFixed(2)}\n\nView PDF: $pdfUrl',
                                        subject: 'Invoice ${invoice.number}',
                                      );
                                    } else {
                                      // Mobile: Save to cache directory (more reliable for sharing)
                                      final cacheDir = await getTemporaryDirectory();
                                      final fileName = 'Invoice_${invoice.number.replaceAll(RegExp(r'[^\w\s-]'), '_')}.pdf';
                                      final filePath = path.join(cacheDir.path, fileName);
                                      final file = File(filePath);
                                      
                                      // Write PDF bytes to file
                                      await file.writeAsBytes(pdfBytes);
                                      
                                      // Verify file exists and has content
                                      if (!await file.exists()) {
                                        throw Exception('Failed to create PDF file');
                                      }
                                      
                                      final fileSize = await file.length();
                                      if (fileSize == 0) {
                                        throw Exception('PDF file is empty');
                                      }
                                      
                                      // Create XFile with proper mime type and name
                                      final pdfFile = XFile(
                                        filePath,
                                        mimeType: 'application/pdf',
                                        name: fileName,
                                      );
                                      
                                      // Verify the file is readable
                                      final canRead = await file.exists();
                                      if (!canRead) {
                                        throw Exception('PDF file is not accessible');
                                      }
                                      
                                      // Share the PDF file
                                      await Share.shareXFiles(
                                        [pdfFile],
                                        subject: 'Invoice ${invoice.number}',
                                        text: 'Please find attached invoice ${invoice.number}',
                                      );
                                      
                                      // Clean up after delay
                                      Future.delayed(const Duration(seconds: 5), () async {
                                        try {
                                          if (await file.exists()) {
                                            await file.delete();
                                          }
                                        } catch (e) {
                                          // Ignore cleanup errors
                                        }
                                      });
                                    }
                                  } catch (e) {
                                    if (mounted) {
                                      ScaffoldMessenger.of(context).showSnackBar(
                                        SnackBar(content: Text('Error sharing: $e')),
                                      );
                                    }
                                  }
                                },
                                backgroundColor: Colors.green,
                                foregroundColor: Colors.white,
                                icon: Icons.share,
                                label: 'Share',
                              ),
                              SlidableAction(
                                onPressed: (context) async {
                                  // Archive invoice
                                  final confirmed = await showDialog<bool>(
                                    context: context,
                                    builder: (context) => AlertDialog(
                                      title: const Text('Archive Invoice'),
                                      content: Text('Are you sure you want to archive invoice ${invoice.number}?'),
                                      actions: [
                                        TextButton(
                                          onPressed: () => Navigator.pop(context, false),
                                          child: const Text('Cancel'),
                                        ),
                                        TextButton(
                                          onPressed: () => Navigator.pop(context, true),
                                          child: const Text('Archive'),
                                        ),
                                      ],
                                    ),
                                  );
                                  if (confirmed == true) {
                                    try {
                                      final apiClient = ref.read(apiClientProvider);
                                      await apiClient.delete('/invoices/${invoice.id}');
                                      if (mounted) {
                                        ScaffoldMessenger.of(context).showSnackBar(
                                          const SnackBar(
                                            content: Text('Invoice archived'),
                                            backgroundColor: Colors.green,
                                          ),
                                        );
                                        _loadInvoices(refresh: true);
                                      }
                                    } catch (e) {
                                      if (mounted) {
                                        CopyableErrorSnackBar.show(context, 'Error archiving invoice: $e');
                                      }
                                    }
                                  }
                                },
                                backgroundColor: Colors.red,
                                foregroundColor: Colors.white,
                                icon: Icons.delete,
                                label: 'Archive',
                              ),
                            ],
                          ),
                          child: _InvoiceListItem(
                            invoice: invoice,
                            onTap: () async {
                              final result = await Navigator.push(
                                context,
                                AppPageTransitions.slideRight(
                                  InvoiceDetailScreen(invoice: invoice),
                                ),
                              );
                              // Refresh invoices list if invoice was updated
                              if (result == true) {
                                _loadInvoices(refresh: true);
                              }
                            },
                          ),
                        ),
                        );
                      },
                    ),
            ),
    );
  }

  Future<void> _copyAllInvoices(BuildContext context) async {
    if (_invoices.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('No invoices to copy'),
          backgroundColor: Colors.orange,
        ),
      );
      return;
    }

    final dateFormat = DateFormat('MMM dd, yyyy');
    final buffer = StringBuffer();
    
    buffer.writeln('═══════════════════════════════════════════════════════════');
    buffer.writeln('                    INVOICES LIST                         ');
    buffer.writeln('═══════════════════════════════════════════════════════════');
    buffer.writeln('');
    buffer.writeln('Total Invoices: ${_invoices.length}');
    buffer.writeln('');

    // Calculate summary statistics
    final paidCount = _invoices.where((inv) => inv.status == InvoiceStatus.paid).length;
    final unpaidCount = _invoices.where((inv) => inv.status != InvoiceStatus.paid && inv.status != InvoiceStatus.cancelled).length;
    final overdueCount = _invoices.where((inv) {
      if (inv.dueDate == null) return false;
      return inv.dueDate!.isBefore(DateTime.now()) && 
             inv.status != InvoiceStatus.paid && 
             inv.status != InvoiceStatus.cancelled;
    }).length;
    
    // Group totals by currency
    final Map<String, double> currencyTotals = {};
    final Map<String, double> currencyPaidTotals = {};
    
    for (final invoice in _invoices) {
      final currency = invoice.currency;
      currencyTotals[currency] = (currencyTotals[currency] ?? 0.0) + invoice.total;
      if (invoice.status == InvoiceStatus.paid) {
        currencyPaidTotals[currency] = (currencyPaidTotals[currency] ?? 0.0) + invoice.total;
      }
    }

    buffer.writeln('Summary:');
    buffer.writeln('  Paid: $paidCount');
    buffer.writeln('  Unpaid: $unpaidCount');
    buffer.writeln('  Overdue: $overdueCount');
    buffer.writeln('');
    buffer.writeln('Total Amounts by Currency:');
    for (final entry in currencyTotals.entries) {
      buffer.writeln('  ${entry.key}: ${entry.key}${entry.value.toStringAsFixed(2)}');
    }
    if (currencyPaidTotals.isNotEmpty) {
      buffer.writeln('');
      buffer.writeln('Paid Amounts by Currency:');
      for (final entry in currencyPaidTotals.entries) {
        buffer.writeln('  ${entry.key}: ${entry.key}${entry.value.toStringAsFixed(2)}');
      }
    }
    buffer.writeln('');
    buffer.writeln('═══════════════════════════════════════════════════════════');
    buffer.writeln('');

    for (var i = 0; i < _invoices.length; i++) {
      final invoice = _invoices[i];
      buffer.writeln('${i + 1}. Invoice: ${invoice.number}');
      buffer.writeln('   Type: ${invoice.type.name.toUpperCase()}');
      buffer.writeln('   Status: ${invoice.status.name.toUpperCase()}');
      
      // Always show client line, even if it's N/A
      final clientName = invoice.clientName ?? invoice.client?.name;
      if (clientName != null && clientName.isNotEmpty) {
        buffer.writeln('   Client: $clientName');
      } else {
        buffer.writeln('   Client: N/A');
      }
      
      buffer.writeln('   Issue Date: ${dateFormat.format(invoice.issueDate)}');
      
      if (invoice.dueDate != null) {
        final isOverdue = invoice.dueDate!.isBefore(DateTime.now()) &&
                          invoice.status != InvoiceStatus.paid &&
                          invoice.status != InvoiceStatus.cancelled;
        buffer.writeln('   Due Date: ${dateFormat.format(invoice.dueDate!)}${isOverdue ? ' (OVERDUE)' : ''}');
      }
      
      buffer.writeln('   Subtotal: ${invoice.currency}${invoice.subtotal.toStringAsFixed(2)}');
      if (invoice.taxTotal > 0) {
        buffer.writeln('   Tax: ${invoice.currency}${invoice.taxTotal.toStringAsFixed(2)}');
      }
      if (invoice.discountTotal > 0) {
        buffer.writeln('   Discount: ${invoice.currency}${invoice.discountTotal.toStringAsFixed(2)}');
      }
      buffer.writeln('   Total: ${invoice.currency}${invoice.total.toStringAsFixed(2)}');
      buffer.writeln('');
    }

    buffer.writeln('═══════════════════════════════════════════════════════════');
    buffer.writeln('              Generated by InvoiceMe                       ');
    buffer.writeln('═══════════════════════════════════════════════════════════');

    try {
      await Clipboard.setData(ClipboardData(text: buffer.toString()));
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Row(
          children: [
            Icon(Icons.check_circle, color: Colors.white),
            SizedBox(width: 8),
            Expanded(
              child: SelectableText(
                'All invoices copied to clipboard',
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
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Unable to copy. Please select and copy manually.'),
            backgroundColor: Colors.orange,
          ),
        );
      }
    }
  }

  Future<void> _showTemplateSelectionDialog() async {
    try {
      final apiClient = ref.read(apiClientProvider);
      final response = await apiClient.get('/invoice-templates');
      final templates = (response.data as List)
          .map((json) => InvoiceTemplate.fromJson(json))
          .toList();

      if (!mounted) return;

      if (templates.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('No templates available. Create a template first.'),
            backgroundColor: Colors.orange,
          ),
        );
        return;
      }

      final selectedTemplate = await showDialog<InvoiceTemplate>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Select Template'),
          content: SizedBox(
            width: double.maxFinite,
            child: ListView.builder(
              shrinkWrap: true,
              itemCount: templates.length,
              itemBuilder: (context, index) {
                final template = templates[index];
                return ListTile(
                  leading: const Icon(Icons.description),
                  title: Text(template.name),
                  subtitle: template.description != null
                      ? Text(template.description!)
                      : Text(
                          '${template.items.length} items • ${template.currency}',
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                  onTap: () => Navigator.pop(context, template),
                );
              },
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
          ],
        ),
      );

      if (selectedTemplate != null && mounted) {
        final result = await Navigator.push(
          context,
          AppPageTransitions.scale(
            CreateInvoiceScreen(template: selectedTemplate),
          ),
        );
        if (result == true) {
          _loadInvoices(refresh: true);
        }
      }
    } catch (e) {
      if (mounted) {
        CopyableErrorSnackBar.show(context, 'Error loading templates: $e');
      }
    }
  }

  void _showTypeFilterDialog() {
    showModalBottomSheet(
      context: context,
      builder: (context) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: Text(
                  'Filter by Type',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
              ListTile(
                leading: const Icon(Icons.receipt_long),
                title: const Text('All Types'),
                trailing: _filterType == null
                    ? const Icon(Icons.check, color: Colors.green)
                    : null,
                onTap: () {
                  setState(() {
                    _filterType = null;
                    _isLoading = true;
                  });
                  Navigator.pop(context);
                  _loadInvoices(refresh: true);
                },
              ),
              ListTile(
                leading: const Icon(Icons.receipt),
                title: const Text('Invoices Only'),
                trailing: _filterType == 'invoice'
                    ? const Icon(Icons.check, color: Colors.green)
                    : null,
                onTap: () {
                  setState(() {
                    _filterType = 'invoice';
                    _isLoading = true;
                  });
                  Navigator.pop(context);
                  _loadInvoices(refresh: true);
                },
              ),
              ListTile(
                leading: const Icon(Icons.description),
                title: const Text('Estimates Only'),
                trailing: _filterType == 'estimate'
                    ? const Icon(Icons.check, color: Colors.green)
                    : null,
                onTap: () {
                  setState(() {
                    _filterType = 'estimate';
                    _isLoading = true;
                  });
                  Navigator.pop(context);
                  _loadInvoices(refresh: true);
                },
              ),
              const SizedBox(height: 16),
            ],
          ),
        );
      },
    );
  }

  void _showStatusFilterDialog() {
    showModalBottomSheet(
      context: context,
      builder: (context) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: Text(
                  'Filter by Status',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
              ListTile(
                leading: const Icon(Icons.filter_alt_off),
                title: const Text('All Statuses'),
                trailing: _statusFilter == null
                    ? const Icon(Icons.check, color: Colors.green)
                    : null,
                onTap: () {
                  setState(() {
                    _statusFilter = null;
                    _isLoading = true;
                  });
                  Navigator.pop(context);
                  _loadInvoices(refresh: true);
                },
              ),
              ...InvoiceStatus.values.map((status) {
                final statusColor = _InvoiceListItem._getStatusColor(context, status);
                return ListTile(
                  leading: Container(
                    width: 12,
                    height: 12,
                    decoration: BoxDecoration(
                      color: statusColor,
                      shape: BoxShape.circle,
                    ),
                  ),
                  title: Text(status.name.toUpperCase()),
                  trailing: _statusFilter == status
                      ? const Icon(Icons.check, color: Colors.green)
                      : null,
                  onTap: () {
                    setState(() {
                      _statusFilter = status;
                      _isLoading = true;
                    });
                    Navigator.pop(context);
                    _loadInvoices(refresh: true);
                  },
                );
              }),
              const SizedBox(height: 16),
            ],
          ),
        );
      },
    );
  }
}

class _InvoiceListItem extends StatelessWidget {
  final Invoice invoice;
  final VoidCallback onTap;

  const _InvoiceListItem({
    required this.invoice,
    required this.onTap,
  });

  static Color _getStatusColor(BuildContext context, InvoiceStatus status) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    switch (status) {
      case InvoiceStatus.paid:
        return isDark ? Colors.green[300]! : Colors.green[700]!;
      case InvoiceStatus.overdue:
        return Colors.red;
      case InvoiceStatus.sent:
        return isDark ? Colors.blue[300]! : Colors.blue[700]!;
      case InvoiceStatus.draft:
        return Theme.of(context).colorScheme.onSurfaceVariant;
      case InvoiceStatus.cancelled:
        return Theme.of(context).colorScheme.onSurfaceVariant;
    }
  }

  @override
  Widget build(BuildContext context) {
    final dateFormat = DateFormat('MMM dd, yyyy');
    final statusColor = _InvoiceListItem._getStatusColor(context, invoice.status);

    return Card(
      elevation: 1,
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(
          color: Theme.of(context).dividerColor.withOpacity(0.1),
          width: 1,
        ),
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: statusColor.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: statusColor.withOpacity(0.3),
                    width: 1,
                  ),
                ),
                child: Icon(
                  invoice.type == InvoiceType.estimate ? Icons.description : Icons.receipt,
                  color: statusColor,
                  size: 24,
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                      invoice.number,
                            style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                              color: Theme.of(context).colorScheme.onSurface,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (invoice.type == InvoiceType.estimate) ...[
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: Theme.of(context).colorScheme.primaryContainer,
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Text(
                              'ESTIMATE',
                              style: TextStyle(
                                fontSize: 9,
                                fontWeight: FontWeight.bold,
                                color: Theme.of(context).colorScheme.onPrimaryContainer,
                                letterSpacing: 0.5,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 6),
                    if (invoice.clientName != null || invoice.client != null) ...[
                      Row(
                        children: [
                          Icon(
                            Icons.person_outline,
                            size: 14,
                            color: Theme.of(context).colorScheme.onSurfaceVariant,
                          ),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Text(
                              invoice.clientName ?? invoice.client?.name ?? 'N/A',
                              style: TextStyle(
                                fontSize: 13,
                                color: Theme.of(context).colorScheme.onSurfaceVariant,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                    ),
                      const SizedBox(height: 6),
                    ],
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              Icons.calendar_today_outlined,
                              size: 14,
                              color: Theme.of(context).colorScheme.onSurfaceVariant,
                            ),
                            const SizedBox(width: 4),
                            Flexible(
                              child: Text(
                                'Issued: ${dateFormat.format(invoice.issueDate)}',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                        if (invoice.dueDate != null) ...[
                          const SizedBox(height: 4),
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                Icons.event_outlined,
                                size: 14,
                                color: invoice.dueDate!.isBefore(DateTime.now()) &&
                                        invoice.status != InvoiceStatus.paid &&
                                        invoice.status != InvoiceStatus.cancelled
                                    ? Colors.red
                                    : Theme.of(context).colorScheme.onSurfaceVariant,
                              ),
                              const SizedBox(width: 4),
                              Flexible(
                                child: Text(
                                  'Due: ${dateFormat.format(invoice.dueDate!)}',
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: invoice.dueDate!.isBefore(DateTime.now()) &&
                                            invoice.status != InvoiceStatus.paid &&
                                            invoice.status != InvoiceStatus.cancelled
                                        ? Colors.red
                                        : Theme.of(context).colorScheme.onSurfaceVariant,
                                    fontWeight: invoice.dueDate!.isBefore(DateTime.now()) &&
                                            invoice.status != InvoiceStatus.paid &&
                                            invoice.status != InvoiceStatus.cancelled
                                        ? FontWeight.w600
                                        : FontWeight.normal,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
              SizedBox(
                width: 100,
                child: Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                  mainAxisSize: MainAxisSize.min,
                children: [
                    FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerRight,
                      child: Text(
                        '${invoice.currency}${invoice.total.toStringAsFixed(2)}',
                        style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                          color: Theme.of(context).primaryColor,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        textAlign: TextAlign.end,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: statusColor.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: statusColor.withOpacity(0.3),
                          width: 1,
                        ),
                    ),
                    child: Text(
                      invoice.status.name.toUpperCase(),
                      style: TextStyle(
                        fontSize: 10,
                        color: statusColor,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 0.5,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                  ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

