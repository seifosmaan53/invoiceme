import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import 'package:intl/intl.dart';
import '../core/providers/providers.dart';
import '../core/providers/refresh_provider.dart';
import '../core/utils/app_animations.dart';
import '../core/services/keyboard_shortcuts.dart';
import '../core/widgets/copyable_error.dart';
import '../widgets/empty_state.dart';
import '../widgets/loading_skeleton.dart';
import '../widgets/client_filter_chips.dart';
import '../models/client.dart';
import 'client_detail_screen.dart';
import 'create_client_screen.dart';

class ClientsScreen extends ConsumerStatefulWidget {
  const ClientsScreen({super.key});

  @override
  ConsumerState<ClientsScreen> createState() => _ClientsScreenState();
}

class _ClientsScreenState extends ConsumerState<ClientsScreen> with AutomaticKeepAliveClientMixin {
  List<Client> _clients = [];
  bool _isLoading = true;
  int _currentPage = 1;
  bool _hasMore = true;
  final TextEditingController _searchController = TextEditingController();
  final FocusNode _searchFocusNode = FocusNode();
  String? _searchQuery;
  bool _isLoadingClients = false;
  Timer? _searchDebounceTimer;
  String? _errorMessage;
  int _lastRefreshCount = 0;
  
  // Filter state
  List<String> _selectedTags = [];
  DateTime? _dateFrom;
  DateTime? _dateTo;
  Set<String> _availableTags = {}; // All unique tags from loaded clients

  @override
  bool get wantKeepAlive => true; // Preserve state when switching tabs

  @override
  void initState() {
    super.initState();
    // Register search focus node for keyboard shortcuts
    SearchFocusRegistry.register('clients', _searchFocusNode);
    _loadClients();
    _searchController.addListener(_onSearchChanged);
  }

  @override
  void dispose() {
    // Unregister search focus node
    SearchFocusRegistry.unregister('clients');
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
        _loadClients(refresh: true);
      }
    });
  }

  Future<void> _loadClients({bool refresh = false}) async {
    // Prevent concurrent loads
    if (_isLoadingClients) return;

    if (refresh) {
      if (!mounted) return;
      setState(() {
        _currentPage = 1;
        _hasMore = true;
        _clients = []; // Clear existing clients when refreshing
      });
    }

    if (!_hasMore && !refresh) return;

    if (!mounted) return;
    setState(() {
      _isLoadingClients = true;
    });

    try {
      final apiClient = ref.read(apiClientProvider);
      final queryParams = <String, dynamic>{
        'page': _currentPage,
        'limit': 20,
      };
      if (_searchQuery != null && _searchQuery!.isNotEmpty) {
        queryParams['search'] = _searchQuery;
      }
      if (_selectedTags.isNotEmpty) {
        queryParams['tags'] = _selectedTags;
      }
      if (_dateFrom != null) {
        queryParams['dateFrom'] = _dateFrom!.toIso8601String().split('T')[0];
      }
      if (_dateTo != null) {
        queryParams['dateTo'] = _dateTo!.toIso8601String().split('T')[0];
      }
      final response = await apiClient.get('/clients', queryParameters: queryParams);

      final data = response.data['data'] as List;
      final meta = response.data['meta'] as Map<String, dynamic>;

      final newClients = data.map((json) => Client.fromJson(json)).toList();

      // Update available tags from all loaded clients
      final allTags = <String>{};
      for (final client in newClients) {
        if (client.tags != null) {
          allTags.addAll(client.tags!);
        }
      }

      if (!mounted) return;
      setState(() {
        if (refresh) {
          _clients = newClients;
          _availableTags = allTags;
        } else {
          // Only add clients that don't already exist (prevent duplicates)
          final existingIds = _clients.map((client) => client.id).toSet();
          final uniqueNewClients = newClients.where((client) => !existingIds.contains(client.id)).toList();
          _clients.addAll(uniqueNewClients);
          _availableTags.addAll(allTags);
        }
        _currentPage = meta['page'] as int;
        _hasMore = _currentPage < (meta['totalPages'] as int);
        _isLoading = false;
        _isLoadingClients = false;
        _errorMessage = null; // Clear any previous errors
      });
    } catch (e) {
      String errorMsg = 'Error loading clients';
      if (e is DioException) {
        if (e.response?.statusCode == 401) {
          errorMsg = 'Session expired. Please log in again.';
        } else if (e.type == DioExceptionType.connectionError) {
          errorMsg = 'Cannot connect to server. Please check if the backend is running.';
        } else if (e.type == DioExceptionType.connectionTimeout) {
          errorMsg = 'Connection timeout. Please check your network connection.';
        } else {
          errorMsg = 'Error loading clients: ${e.message ?? e.toString()}';
        }
      } else {
        errorMsg = 'Error loading clients: $e';
      }

      if (!mounted) return;
      setState(() {
        _isLoading = false;
        _isLoadingClients = false;
        _errorMessage = errorMsg;
      });
      if (mounted) {
        CopyableErrorSnackBar.show(context, errorMsg);
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
      if (refreshType == RefreshType.clients || refreshType == RefreshType.all) {
        // Use WidgetsBinding to avoid calling setState during build
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) {
            _loadClients(refresh: true);
          }
        });
      }
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Clients'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(60),
          child: Padding(
            padding: const EdgeInsets.all(8.0),
            child: TextField(
              controller: _searchController,
              focusNode: _searchFocusNode,
              decoration: InputDecoration(
                hintText: 'Search by name, email, phone, tags...',
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
          IconButton(
            icon: Stack(
              children: [
                const Icon(Icons.filter_list),
                if (_selectedTags.isNotEmpty || _dateFrom != null || _dateTo != null)
                  Positioned(
                    right: 0,
                    top: 0,
                    child: Container(
                      padding: const EdgeInsets.all(2),
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.error,
                        shape: BoxShape.circle,
                      ),
                      constraints: const BoxConstraints(
                        minWidth: 8,
                        minHeight: 8,
                      ),
                    ),
                  ),
              ],
            ),
            tooltip: 'Filter clients',
            onPressed: _showFilterDialog,
          ),
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: () {
              Navigator.push(
                context,
                AppPageTransitions.scale(
                  const CreateClientScreen(),
                ),
              ).then((_) {
                // Refresh clients list after creating
                _loadClients(refresh: true);
              });
            },
          ),
        ],
      ),
      body: Column(
        children: [
          // Filter chips
          ClientFilterChips(
            selectedTags: _selectedTags,
            dateFrom: _dateFrom,
            dateTo: _dateTo,
            onClearTags: () {
              setState(() {
                _selectedTags = [];
              });
              _loadClients(refresh: true);
            },
            onClearDateRange: () {
              setState(() {
                _dateFrom = null;
                _dateTo = null;
              });
              _loadClients(refresh: true);
            },
            onClearAll: () {
              setState(() {
                _selectedTags = [];
                _dateFrom = null;
                _dateTo = null;
              });
              _loadClients(refresh: true);
            },
          ),
          // Main content
          Expanded(
            child: _isLoading && _clients.isEmpty
                ? ListView.builder(
                    physics: const AlwaysScrollableScrollPhysics(),
                    itemCount: 5,
                    itemBuilder: (context, index) => const ListItemSkeleton(),
                  )
                : _errorMessage != null && _clients.isEmpty
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
                                'Failed to Load Clients',
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
                                  _loadClients(refresh: true);
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
              onRefresh: () => _loadClients(refresh: true),
              child: _clients.isEmpty
                  ? LayoutBuilder(
                      builder: (context, constraints) {
                        return SingleChildScrollView(
                          physics: const AlwaysScrollableScrollPhysics(),
                          child: ConstrainedBox(
                            constraints: BoxConstraints(
                              minHeight: constraints.maxHeight,
                            ),
                            child: EmptyState(
                      icon: Icons.people_outline,
                      title: 'No clients yet',
                      subtitle: 'Create your first client to start invoicing',
                      actionLabel: 'Add Client',
                      onAction: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const CreateClientScreen(),
                          ),
                        ).then((_) {
                          _loadClients(refresh: true);
                        });
                          },
                            ),
                          ),
                        );
                      },
                    )
                  : ListView.builder(
                      physics: const AlwaysScrollableScrollPhysics(),
                      itemCount: _clients.length + (_hasMore ? 1 : 0),
                      itemBuilder: (context, index) {
                        if (index == _clients.length) {
                          _loadClients();
                          return const Center(
                            child: Padding(
                              padding: EdgeInsets.all(16),
                              child: CircularProgressIndicator(),
                            ),
                          );
                        }
                        final client = _clients[index];
                        return StaggeredListAnimation(
                          index: index,
                          child: ListTile(
                            leading: CircleAvatar(
                            backgroundColor: const Color(0xFF4a90e2),
                            child: Text(
                              (client.name.isNotEmpty) ? client.name[0].toUpperCase() : '?',
                              style: TextStyle(
                                color: Theme.of(context).colorScheme.onPrimary,
                              ),
                            ),
                          ),
                          title: Text(client.name),
                          subtitle: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              if (client.phone != null) Text('Phone: ${client.phone}'),
                              if (client.email != null) Text('Email: ${client.email}'),
                              if (client.notes != null && client.notes!.trim().isNotEmpty)
                                Text(
                                  client.notes!,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(fontSize: 12),
                                ),
                              if (client.tags != null && client.tags!.isNotEmpty)
                                Padding(
                                  padding: const EdgeInsets.only(top: 4),
                                  child: Wrap(
                                    spacing: 4,
                                    runSpacing: 4,
                                    children: client.tags!.map((tag) {
                                      return Chip(
                                        label: Text(
                                          tag,
                                          style: const TextStyle(fontSize: 11),
                                        ),
                                        visualDensity: VisualDensity.compact,
                                        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                        padding: EdgeInsets.zero,
                                      );
                                    }).toList(),
                                  ),
                                ),
                            ],
                          ),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () async {
                            final result = await Navigator.push(
                              context,
                              AppPageTransitions.slideRight(
                                ClientDetailScreen(client: client),
                              ),
                            );
                            // Refresh clients list if client was updated
                            if (result == true) {
                              _loadClients(refresh: true);
                            }
                          },
                        ),
                        );
                      },
                    ),
                  ),
          ),
        ],
      ),
    );
  }

  void _showFilterDialog() {
    showDialog(
      context: context,
      builder: (context) => _ClientFilterDialog(
        selectedTags: List.from(_selectedTags),
        dateFrom: _dateFrom,
        dateTo: _dateTo,
        availableTags: _availableTags.toList()..sort(),
        onApply: (tags, dateFrom, dateTo) {
          setState(() {
            _selectedTags = tags;
            _dateFrom = dateFrom;
            _dateTo = dateTo;
          });
          _loadClients(refresh: true);
        },
      ),
    );
  }
}

class _ClientFilterDialog extends StatefulWidget {
  final List<String> selectedTags;
  final DateTime? dateFrom;
  final DateTime? dateTo;
  final List<String> availableTags;
  final Function(List<String>, DateTime?, DateTime?) onApply;

  const _ClientFilterDialog({
    required this.selectedTags,
    required this.dateFrom,
    required this.dateTo,
    required this.availableTags,
    required this.onApply,
  });

  @override
  State<_ClientFilterDialog> createState() => _ClientFilterDialogState();
}

class _ClientFilterDialogState extends State<_ClientFilterDialog> {
  late List<String> _selectedTags;
  DateTime? _dateFrom;
  DateTime? _dateTo;

  @override
  void initState() {
    super.initState();
    _selectedTags = List.from(widget.selectedTags);
    _dateFrom = widget.dateFrom;
    _dateTo = widget.dateTo;
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Filter Clients'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Tags section
            const Text(
              'Tags',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            if (widget.availableTags.isEmpty)
              const Text(
                'No tags available',
                style: TextStyle(color: Colors.grey, fontSize: 14),
              )
            else
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: widget.availableTags.map((tag) {
                  final isSelected = _selectedTags.contains(tag);
                  return FilterChip(
                    label: Text(tag),
                    selected: isSelected,
                    onSelected: (selected) {
                      setState(() {
                        if (selected) {
                          _selectedTags.add(tag);
                        } else {
                          _selectedTags.remove(tag);
                        }
                      });
                    },
                  );
                }).toList(),
              ),
            const SizedBox(height: 24),
            
            // Date range section
            const Text(
              'Created Date',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: InkWell(
                    onTap: () async {
                      final picked = await showDatePicker(
                        context: context,
                        initialDate: _dateFrom ?? DateTime.now(),
                        firstDate: DateTime(2000),
                        lastDate: DateTime(2100),
                      );
                      if (picked != null) {
                        setState(() {
                          _dateFrom = picked;
                          // If dateTo is before dateFrom, clear it
                          if (_dateTo != null && _dateTo!.isBefore(picked)) {
                            _dateTo = null;
                          }
                        });
                      }
                    },
                    child: InputDecorator(
                      decoration: const InputDecoration(
                        labelText: 'From',
                        border: OutlineInputBorder(),
                        suffixIcon: Icon(Icons.calendar_today),
                      ),
                      child: Text(
                        _dateFrom != null
                            ? DateFormat('MMM d, y').format(_dateFrom!)
                            : 'Select date',
                        style: TextStyle(
                          color: _dateFrom != null
                              ? null
                              : Colors.grey[600],
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: InkWell(
                    onTap: () async {
                      final picked = await showDatePicker(
                        context: context,
                        initialDate: _dateTo ?? _dateFrom ?? DateTime.now(),
                        firstDate: _dateFrom ?? DateTime(2000),
                        lastDate: DateTime(2100),
                      );
                      if (picked != null) {
                        setState(() {
                          _dateTo = picked;
                        });
                      }
                    },
                    child: InputDecorator(
                      decoration: const InputDecoration(
                        labelText: 'To',
                        border: OutlineInputBorder(),
                        suffixIcon: Icon(Icons.calendar_today),
                      ),
                      child: Text(
                        _dateTo != null
                            ? DateFormat('MMM d, y').format(_dateTo!)
                            : 'Select date',
                        style: TextStyle(
                          color: _dateTo != null
                              ? null
                              : Colors.grey[600],
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
            if (_dateFrom != null || _dateTo != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: TextButton.icon(
                  onPressed: () {
                    setState(() {
                      _dateFrom = null;
                      _dateTo = null;
                    });
                  },
                  icon: const Icon(Icons.clear, size: 16),
                  label: const Text('Clear dates'),
                ),
              ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () {
            Navigator.pop(context);
          },
          child: const Text('Cancel'),
        ),
        TextButton(
          onPressed: () {
            setState(() {
              _selectedTags = [];
              _dateFrom = null;
              _dateTo = null;
            });
            widget.onApply(_selectedTags, _dateFrom, _dateTo);
            Navigator.pop(context);
          },
          child: const Text('Clear All'),
        ),
        ElevatedButton(
          onPressed: () {
            widget.onApply(_selectedTags, _dateFrom, _dateTo);
            Navigator.pop(context);
          },
          child: const Text('Apply'),
        ),
      ],
    );
  }
}

