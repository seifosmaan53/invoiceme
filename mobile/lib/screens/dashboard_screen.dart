import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:vector_math/vector_math_64.dart' as vm;
import 'dart:async';
import 'dart:convert';
import '../core/providers/providers.dart';
import '../core/providers/refresh_provider.dart';
import '../core/services/api_client.dart';
import '../core/widgets/copyable_error.dart';
import '../widgets/loading_skeleton.dart';
import '../widgets/dashboard_charts.dart';
import '../widgets/offline_banner.dart';
import '../widgets/mobile_view_wrapper.dart';
import '../models/invoice.dart';
import 'clients_screen.dart';
import 'invoices_screen.dart';
import 'settings_screen.dart';

class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  int _selectedIndex = 0;
  final GlobalKey<_DashboardHomeState> _dashboardKey = GlobalKey<_DashboardHomeState>();
  final GlobalKey<NavigatorState> _invoicesKey = GlobalKey<NavigatorState>();
  final GlobalKey<NavigatorState> _clientsKey = GlobalKey<NavigatorState>();

  /// Navigate to a specific tab (used by keyboard shortcuts)
  void _navigateToTab(int index) {
    if (index == 0) {
      _dashboardKey.currentState?._loadStats();
    }
  }

  /// Refresh current tab (used by keyboard shortcuts)
  void _refreshCurrentTab() {
    if (_selectedIndex == 0) {
      _dashboardKey.currentState?._loadStats(forceRefresh: true);
    }
    // Other tabs can implement their own refresh logic
  }

  @override
  Widget build(BuildContext context) {
    final screens = [
      _DashboardHome(key: _dashboardKey),
      const InvoicesScreen(),
      const ClientsScreen(),
      const SettingsScreen(),
    ];
    
    final scaffold = Scaffold(
      body: IndexedStack(
        index: _selectedIndex,
        children: screens,
      ),
      bottomNavigationBar: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        child: BottomNavigationBar(
          currentIndex: _selectedIndex,
          onTap: (index) {
            setState(() {
              _selectedIndex = index;
            });
            // If tapping the same tab, refresh it
            if (_selectedIndex == index) {
              if (index == 0) {
                // Refresh dashboard stats
                _dashboardKey.currentState?._loadStats();
              }
            }
          },
          type: BottomNavigationBarType.fixed,
          selectedItemColor: Theme.of(context).colorScheme.primary,
          unselectedItemColor: Theme.of(context).colorScheme.onSurfaceVariant,
          selectedFontSize: 12,
          unselectedFontSize: 12,
          iconSize: 24,
          elevation: 8,
          items: const [
            BottomNavigationBarItem(
              icon: Icon(Icons.dashboard_outlined),
              activeIcon: Icon(Icons.dashboard),
              label: 'Dashboard',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.receipt_long_outlined),
              activeIcon: Icon(Icons.receipt_long),
              label: 'Invoices',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.people_outline),
              activeIcon: Icon(Icons.people),
              label: 'Clients',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.settings_outlined),
              activeIcon: Icon(Icons.settings),
              label: 'Settings',
            ),
          ],
        ),
      ),
    );
    
    // On web, use full width; on mobile, use MobileViewWrapper
    if (kIsWeb) {
      return scaffold; // Full width on web
    }
    return MobileViewWrapper(
      child: scaffold,
    );
  }
}

class _DashboardHome extends ConsumerStatefulWidget {
  const _DashboardHome({super.key});

  @override
  ConsumerState<_DashboardHome> createState() => _DashboardHomeState();
}

class _DashboardHomeState extends ConsumerState<_DashboardHome> {
  Map<String, dynamic>? _stats;
  bool _isLoading = false; // Start as false - will be set to true when loading starts
  List<Invoice>? _cachedInvoices;
  List<Invoice> _chartInvoices = const []; // Strongly-typed list for charts (fixes web casting issue)
  DateTime? _lastStatsLoad;
  String? _errorMessage;
  int _lastRefreshCount = 0; // Track refresh events
  static const _cacheKey = 'dashboard_stats_cache';
  static const _cacheExpiryMinutes = 5;

  @override
  void initState() {
    super.initState();
    
    // Load cached stats first for instant display
    _loadCachedStats();
    
    // Use addPostFrameCallback to avoid build warnings
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      
      // Add a global safety timeout that ALWAYS runs - this is critical!
      Timer(const Duration(seconds: 12), () {
        if (mounted && _isLoading && _stats == null) {
          setState(() {
            _isLoading = false;
            _errorMessage = 'Dashboard failed to load after 12 seconds. Please check:\n1. Backend is running\n2. You are logged in\n3. Check browser console for errors';
          });
        }
      });
      
      // Wrap _loadStats in try-catch to ensure we never hang forever
      _loadStats().catchError((error, stackTrace) {
        if (mounted) {
          setState(() {
            _isLoading = false;
            _errorMessage = 'Error loading dashboard: $error';
          });
        }
      });
    });
  }

  Future<void> _loadCachedStats() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final cachedJson = prefs.getString(_cacheKey);
      if (cachedJson != null) {
        try {
          final cached = jsonDecode(cachedJson) as Map<String, dynamic>?;
          if (cached != null) {
            final timestampStr = cached['timestamp'] as String?;
            if (timestampStr != null) {
              final cacheTime = DateTime.tryParse(timestampStr);
              if (cacheTime != null) {
                final now = DateTime.now();
                
                // Use cache if less than 5 minutes old
                if (now.difference(cacheTime).inMinutes < _cacheExpiryMinutes) {
                  if (mounted) {
                    final stats = cached['stats'];
                    if (stats is Map) {
                      setState(() {
                        _stats = Map<String, dynamic>.from(stats);
                        _isLoading = false; // Set to false so UI shows cached data
                      });
                      return; // Exit early if we have cached data
                    }
                  }
                }
              }
            }
          }
        } catch (e) {
          // Ignore JSON decode/parse errors, will load fresh data
        }
      }
      
      // Don't set _isLoading = true here - let _loadStats() handle it
      // This prevents the race condition where _loadStats() sees _isLoading = true
      // and returns early before making the API call
    } catch (e) {
      // Don't set _isLoading = true here either - let _loadStats() handle it
      // This ensures _loadStats() will actually make the API call
    }
  }

  Future<void> _saveCachedStats(Map<String, dynamic> stats) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final cacheData = {
        'stats': stats,
        'timestamp': DateTime.now().toIso8601String(),
      };
      await prefs.setString(_cacheKey, jsonEncode(cacheData));
    } catch (e) {
      // Ignore cache save errors
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Don't use ref.watch here - it can cause infinite rebuild loops
    // Refresh logic is handled in build method instead
  }


  void _navigateToFilteredInvoices(String filter) async {
    // Navigate to invoices screen with filter
    final result = await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => InvoicesScreen(filter: filter),
      ),
    );
    // Refresh dashboard stats when returning from invoices screen
    if (result == true || mounted) {
      _loadStats();
    }
  }

  Future<void> _copyAllStats(BuildContext context) async {
    if (_stats == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('No stats available to copy'),
          backgroundColor: Colors.orange,
        ),
      );
      return;
    }

    final buffer = StringBuffer();
    buffer.writeln('═══════════════════════════════════════════════════════════');
    buffer.writeln('              DASHBOARD STATISTICS                         ');
    buffer.writeln('═══════════════════════════════════════════════════════════');
    buffer.writeln('');
    
    final unpaid = _stats!['unpaid'] ?? 0;
    final overdue = _stats!['overdue'] ?? 0;
    final totalInvoices = _stats!['totalInvoices'] ?? 0;
    final monthlyRevenue = _stats!['totalThisMonth'] ?? 0.0;
    final unpaidAmount = _stats!['unpaidAmount'] ?? 0.0;
    final overdueAmount = _stats!['overdueAmount'] ?? 0.0;
    
    buffer.writeln('Invoice Counts:');
    buffer.writeln('  Total Invoices: $totalInvoices');
    buffer.writeln('  Unpaid: $unpaid');
    buffer.writeln('  Overdue: $overdue');
    buffer.writeln('');
    
    buffer.writeln('Revenue:');
    if (monthlyRevenue > 0) {
      buffer.writeln('  Total This Month: \$${monthlyRevenue.toStringAsFixed(2)}');
    }
    if (unpaidAmount > 0) {
      buffer.writeln('  Unpaid Amount: \$${unpaidAmount.toStringAsFixed(2)}');
    }
    if (overdueAmount > 0) {
      buffer.writeln('  Overdue Amount: \$${overdueAmount.toStringAsFixed(2)}');
    }
    
    buffer.writeln('');
    buffer.writeln('═══════════════════════════════════════════════════════════');
    buffer.writeln('              Generated by InvoiceMe                       ');
    buffer.writeln('═══════════════════════════════════════════════════════════');

    try {
      await Clipboard.setData(ClipboardData(text: buffer.toString()));
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Row(
          children: [
            Icon(Icons.check_circle, color: Colors.white),
            SizedBox(width: 8),
            Expanded(
              child: SelectableText(
                'All dashboard stats copied to clipboard',
                style: TextStyle(color: Colors.white),
                enableInteractiveSelection: true,
              ),
            ),
          ],
        ),
        duration: const Duration(seconds: 2),
        backgroundColor: Colors.green,
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

  Future<void> _loadStats({bool forceRefresh = false}) async {
    // Skip if recently loaded (unless forced)
    if (!forceRefresh && _lastStatsLoad != null) {
      final now = DateTime.now();
      if (now.difference(_lastStatsLoad!).inSeconds < 5) {
        return; // Don't reload if less than 5 seconds ago
      }
    }

    // Prevent concurrent loads - but be smart about it
    // If _isLoading is true but we don't have stats yet, it might be a stale state
    // from _loadCachedStats(), so we should proceed anyway
    if (_isLoading && !forceRefresh && _stats != null) {
      // Only skip if we're loading AND we already have stats (likely a duplicate call)
      return;
    }
    
    // If _isLoading is true but we don't have stats, reset it and proceed
    // This handles the case where _loadCachedStats() set it but _loadStats() never ran
    if (_isLoading && _stats == null && !forceRefresh) {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }

    // Initialize with default values if we don't have stats yet
    if (_stats == null && mounted) {
      setState(() {
        _stats = {
          'unpaid': 0,
          'unpaidAmount': 0.0,
          'overdue': 0,
          'overdueAmount': 0.0,
          'totalThisMonth': 0.0,
          'totalInvoices': 0,
        };
        _chartInvoices = const [];
      });
    }

    // Set loading state at the start
    if (mounted) {
      setState(() {
        _isLoading = true;
        _errorMessage = null;
      });
    }

    // Add a safety timeout that will force an error if loading takes too long
    Timer? safetyTimer;
    bool timeoutTriggered = false; // Declare outside try block so finally can access it
    
    // CRITICAL: Set up a guaranteed timeout that ALWAYS runs
    safetyTimer = Timer(const Duration(seconds: 8), () {
      if (mounted && _isLoading && !timeoutTriggered) {
        timeoutTriggered = true;
        setState(() {
          _isLoading = false;
          _errorMessage = 'Request timed out. Please check:\n1. Backend is running at http://localhost:3000\n2. You are logged in\n3. Network connection is working';
        });
      }
    });
    
    try {
      // Get API client with error handling
      ApiClient apiClient;
      try {
        apiClient = ref.read(apiClientProvider);
      } catch (e) {
        throw Exception('API client not available. Please restart the app.');
      }
      
      // Check if we have a token - with timeout
      bool hasToken = false;
      try {
        hasToken = await apiClient.hasToken().timeout(
          const Duration(seconds: 3),
          onTimeout: () => false,
        );
      } catch (e) {
        hasToken = false;
      }
      
      if (!hasToken) {
        throw Exception('No authentication token found. Please log in again.');
      }
      
      // Use backend stats endpoint - it already calculates everything efficiently
      // Add timeout to prevent hanging - wrap in try-catch for better error handling
      Response<dynamic> statsResponse;
      try {
        // Make the API call with a timeout
        statsResponse = await apiClient.get('/invoices/stats').timeout(
          const Duration(seconds: 8),
          onTimeout: () {
            throw DioException(
              requestOptions: RequestOptions(
                path: '/invoices/stats',
                baseUrl: 'http://localhost:3000/api/v1',
              ),
              type: DioExceptionType.connectionTimeout,
              message: 'Request timeout after 8 seconds',
            );
          },
        );
      } catch (e) {
        rethrow; // Re-throw to be caught by outer catch block
      }
      
      // Validate response data
      if (statsResponse.data == null) {
        throw Exception('Stats response data is null');
      }
      
      final stats = statsResponse.data as Map<String, dynamic>?;
      if (stats == null) {
        throw Exception('Stats response data is not a Map: ${statsResponse.data.runtimeType}');
      }

      // Only load invoices if we need them for charts (lazy loading)
      // Load a smaller sample for charts (first 100 invoices should be enough)
      List<Invoice> chartInvoices = [];
      if (_stats == null || _cachedInvoices == null) {
        // Only load invoices on first load or when cache is empty
        try {
          final response = await apiClient.get('/invoices', queryParameters: {
            'page': 1,
            'limit': 100, // Reduced from 300 to 100 for better performance
          }).timeout(
            const Duration(seconds: 10),
            onTimeout: () {
              throw DioException(
                requestOptions: RequestOptions(
                  path: '/invoices',
                  baseUrl: 'http://localhost:3000/api/v1',
                ),
                type: DioExceptionType.connectionTimeout,
                message: 'Request timeout after 10 seconds',
              );
            },
          );
          
          final data = response.data['data'] as List?;
          if (data != null && data.isNotEmpty) {
            chartInvoices = data.map((json) => Invoice.fromJson(json)).toList();
            _cachedInvoices = chartInvoices;
          } else {
            chartInvoices = _cachedInvoices ?? [];
          }
        } catch (e) {
          // If invoice loading fails, use empty list - charts will show "no data"
          chartInvoices = _cachedInvoices ?? [];
        }
      } else {
        // Use cached invoices
        chartInvoices = _cachedInvoices ?? [];
      }

      // Extract stats from backend response - ensure we handle null/undefined values
      final unpaidCount = (stats['totalUnpaid'] as num?)?.toInt() ?? 0;
      final overdueCount = (stats['totalOverdue'] as num?)?.toInt() ?? 0;
      final totalInvoices = (stats['totalInvoices'] as num?)?.toInt() ?? 0;
      final monthlyRevenue = (stats['monthlyRevenue'] as num?)?.toDouble() ?? 0.0;
      
      // Calculate unpaid and overdue amounts from actual invoice data
      // This is more accurate than estimating from a sample
      double unpaidAmount = 0.0;
      double overdueAmount = 0.0;
      
      if (chartInvoices.isNotEmpty) {
        final now = DateTime.now();
        final today = DateTime(now.year, now.month, now.day);
        
        // Calculate actual amounts from loaded invoices
        final unpaidInvoices = chartInvoices
            .where((inv) =>
                inv.status != InvoiceStatus.paid &&
                inv.status != InvoiceStatus.cancelled)
            .toList();
        
        unpaidAmount = unpaidInvoices.fold<double>(0.0, (sum, inv) => sum + inv.total);
        
        final overdueInvoices = chartInvoices.where((inv) {
          if (inv.dueDate == null) return false;
          final dueDate = DateTime(inv.dueDate!.year, inv.dueDate!.month, inv.dueDate!.day);
          return dueDate.isBefore(today) && 
                 inv.status != InvoiceStatus.paid && 
                 inv.status != InvoiceStatus.cancelled;
        }).toList();
        
        overdueAmount = overdueInvoices.fold<double>(0.0, (sum, inv) => sum + inv.total);
      }

      // Check if widget is still mounted before calling setState
      if (!mounted) {
        safetyTimer?.cancel();
        return;
      }
      
      // Cancel timeout since we succeeded
      if (!timeoutTriggered) {
        safetyTimer?.cancel();
      }

      // Always create stats object, even if values are 0
      final newStats = {
        'unpaid': unpaidCount,
        'unpaidAmount': unpaidAmount,
        'overdue': overdueCount,
        'overdueAmount': overdueAmount,
        'totalThisMonth': monthlyRevenue,
        'totalInvoices': totalInvoices,
        // Note: allInvoices removed from map - use _chartInvoices instead (fixes web type casting)
      };

      // Cancel safety timer since we succeeded
      safetyTimer?.cancel();

      setState(() {
        _stats = newStats;
        _chartInvoices = chartInvoices; // Store in strongly-typed list (fixes web casting issue)
        _isLoading = false;
        _lastStatsLoad = DateTime.now();
        _errorMessage = null; // Clear any previous errors
      });

      // Cache the stats
      await _saveCachedStats(newStats);
    } catch (e) {
      // Cancel safety timer on error
      safetyTimer?.cancel();
      
      // Check if widget is still mounted before calling setState
      if (!mounted) {
        return;
      }

      // Log error to console for debugging (keep critical error logging)
      debugPrint('Error loading dashboard stats: $e');
      if (e is DioException) {
        debugPrint('DioException: type=${e.type}, status=${e.response?.statusCode}');
        if (e.response?.statusCode == 401) {
          _errorMessage = 'Session expired. Please log in again.';
        } else if (e.type == DioExceptionType.connectionError) {
          _errorMessage = 'Cannot connect to server. Please check if the backend is running at http://localhost:3000';
        } else if (e.type == DioExceptionType.connectionTimeout) {
          _errorMessage = 'Connection timeout. Please check your network connection.';
        } else if (e.response != null) {
          // Backend returned an error response
          final errorData = e.response!.data;
          if (errorData is Map && errorData['message'] != null) {
            _errorMessage = 'Error loading stats: ${errorData['message']}';
          } else {
            _errorMessage = 'Error loading stats: ${e.message ?? e.toString()}';
          }
        } else {
          _errorMessage = 'Error loading stats: ${e.message ?? e.toString()}';
        }
      } else if (e is TimeoutException) {
        _errorMessage = 'Request timed out. Please check your connection and try again.';
      } else {
        _errorMessage = 'Error loading stats: $e';
      }

      // ALWAYS set loading to false, even on error
      // If we have cached stats, show them but also show the error
      // If no cached stats, initialize with defaults so UI always shows something
      if (mounted) {
        setState(() {
          _isLoading = false;
          // _errorMessage is already set above
          // Ensure we always have stats to display (use defaults if needed)
          if (_stats == null) {
            _stats = {
              'unpaid': 0,
              'unpaidAmount': 0.0,
              'overdue': 0,
              'overdueAmount': 0.0,
              'totalThisMonth': 0.0,
              'totalInvoices': 0,
            };
            _chartInvoices = const [];
          }
        });
        
        // Check if it's an authentication error
        if (e is DioException && e.response?.statusCode == 401) {
          // Token refresh should have been attempted by the interceptor
          // If we're here, refresh failed - user needs to log in again
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Session expired. Please log in again.'),
              backgroundColor: Colors.orange,
              duration: Duration(seconds: 3),
            ),
          );
          // Don't show the technical error for auth failures
        } else if (_errorMessage != null) {
          // Show error snackbar
          CopyableErrorSnackBar.show(context, _errorMessage!);
        }
      }
    } finally {
      // ALWAYS cancel safety timer
      safetyTimer?.cancel();
      
      // ALWAYS ensure loading is set to false, even if something unexpected happens
      // This is the safety net - if timeout didn't trigger and we're still loading, force it off
      if (mounted && _isLoading) {
        setState(() {
          _isLoading = false;
          // If we don't have stats and no error message, set a generic error
          if (_stats == null && _errorMessage == null) {
            _errorMessage = 'Failed to load dashboard. Please check your connection and try again.';
          }
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    // Watch for refresh events in build method (Riverpod requirement)
    final refreshCount = ref.watch(refreshNotifierProvider);
    if (refreshCount != _lastRefreshCount) {
      _lastRefreshCount = refreshCount;
      final refreshType = ref.read(refreshNotifierProvider.notifier).lastRefreshType;
      // Refresh dashboard if invoices or clients changed
      if (refreshType == RefreshType.invoices || 
          refreshType == RefreshType.clients || 
          refreshType == RefreshType.dashboard ||
          refreshType == RefreshType.all) {
        // Use WidgetsBinding to avoid calling setState during build
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) {
            _loadStats(forceRefresh: true);
          }
        });
      }
    }

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        elevation: 0,
        backgroundColor: Theme.of(context).colorScheme.surface,
        title: Text(
          'Dashboard',
          style: TextStyle(
            color: Theme.of(context).colorScheme.onSurface,
            fontWeight: FontWeight.bold,
            fontSize: 20,
          ),
        ),
        actions: [
          IconButton(
            icon: Icon(
              Icons.copy_all,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
            tooltip: 'Copy all stats',
            onPressed: () => _copyAllStats(context),
          ),
          IconButton(
            icon: Icon(
              Icons.refresh,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
            tooltip: 'Refresh',
            onPressed: () {
              setState(() => _isLoading = true);
              _loadStats(forceRefresh: true);
            },
          ),
        ],
      ),
      body: Stack(
        children: [
          // Show loading ONLY if we're loading AND have no stats (cached or fresh)
          _isLoading && _stats == null
          ? Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const CircularProgressIndicator(),
                  const SizedBox(height: 16),
                  Text(
                    'Loading dashboard...',
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: Colors.grey[600],
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'If this takes more than 15 seconds, check the browser console',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Colors.grey[500],
                      fontSize: 11,
                    ),
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            )
          : _errorMessage != null && _stats == null
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
                      'Failed to Load Dashboard',
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
                        _loadStats(forceRefresh: true);
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
              onRefresh: () async {
                await _loadStats(forceRefresh: true);
              },
              child: LayoutBuilder(
                builder: (context, constraints) {
                  // On web, use responsive padding; on mobile, use fixed padding
                  final padding = kIsWeb 
                      ? EdgeInsets.symmetric(
                          horizontal: constraints.maxWidth > 1200 ? 48.0 : 
                                     constraints.maxWidth > 800 ? 32.0 : 16.0,
                          vertical: 16.0,
                        )
                      : const EdgeInsets.all(16);
                  
                  return SingleChildScrollView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: padding,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                            // Show error banner if there's an error but we have cached stats
                            if (_errorMessage != null && _stats != null)
                              Container(
                                margin: const EdgeInsets.only(bottom: 16),
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  color: Colors.orange[50],
                                  border: Border.all(color: Colors.orange[300]!),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Row(
                                  children: [
                                    Icon(Icons.warning_amber_rounded, color: Colors.orange[700], size: 20),
                                    const SizedBox(width: 8),
                                    Expanded(
                                      child: Text(
                                        _errorMessage!,
                                        style: TextStyle(
                                          color: Colors.orange[900],
                                          fontSize: 12,
                                        ),
                                      ),
                                    ),
                                    TextButton(
                                      onPressed: () {
                                        setState(() {
                                          _isLoading = true;
                                          _errorMessage = null;
                                        });
                                        _loadStats(forceRefresh: true);
                                      },
                                      child: const Text('Retry', style: TextStyle(fontSize: 12)),
                                    ),
                                  ],
                                ),
                              ),
                            // Show loading indicator overlay if loading but have cached stats
                            if (_isLoading && _stats != null)
                              Container(
                                margin: const EdgeInsets.only(bottom: 16),
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  color: Colors.blue[50],
                                  border: Border.all(color: Colors.blue[300]!),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Row(
                                  children: [
                                    SizedBox(
                                      width: 16,
                                      height: 16,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        valueColor: AlwaysStoppedAnimation<Color>(Colors.blue[700]!),
                                      ),
                                    ),
                                    const SizedBox(width: 8),
                                    Text(
                                      'Refreshing dashboard...',
                                      style: TextStyle(
                                        color: Colors.blue[900],
                                        fontSize: 12,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            // First row - Unpaid and Overdue (always show, even if 0)
                            Row(
                              children: [
                                Expanded(
                                  child: _StatCard(
                                    title: 'Unpaid Invoices',
                                    value: (_stats?['unpaid'] as int?)?.toString() ?? '0',
                                    subtitle: () {
                                      final unpaid = (_stats?['unpaid'] as int?) ?? 0;
                                      final unpaidAmount = (_stats?['unpaidAmount'] as double?) ?? 0.0;
                                      if (unpaid > 0 && unpaidAmount > 0) {
                                        return '\$${unpaidAmount.toStringAsFixed(2)}';
                                      } else if (unpaid > 0) {
                                        return 'Amount calculating...';
                                      } else {
                                        return 'No unpaid invoices';
                                      }
                                    }(),
                                    icon: Icons.pending_actions_rounded,
                                    color: const Color(0xFFF59E0B),
                                    onTap: () => _navigateToFilteredInvoices('unpaid'),
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: _StatCard(
                                    title: 'Overdue Invoices',
                                    value: (_stats?['overdue'] as int?)?.toString() ?? '0',
                                    subtitle: () {
                                      final overdue = (_stats?['overdue'] as int?) ?? 0;
                                      final overdueAmount = (_stats?['overdueAmount'] as double?) ?? 0.0;
                                      if (overdue > 0 && overdueAmount > 0) {
                                        return '\$${overdueAmount.toStringAsFixed(2)}';
                                      } else if (overdue > 0) {
                                        return 'Amount calculating...';
                                      } else {
                                        return 'All up to date';
                                      }
                                    }(),
                                    icon: Icons.warning_amber_rounded,
                                    color: const Color(0xFFEF4444),
                                    onTap: () => _navigateToFilteredInvoices('overdue'),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 12),
                            // Second row - Monthly Total and Total Invoices (always show, even if 0)
                            Row(
                              children: [
                                Expanded(
                                  child: _StatCard(
                                    title: 'Total This Month',
                                    value: () {
                                      final monthly = (_stats?['totalThisMonth'] as double?) ?? 0.0;
                                      return '\$${monthly.toStringAsFixed(2)}';
                                    }(),
                                    subtitle: () {
                                      final total = (_stats?['totalInvoices'] as int?) ?? 0;
                                      return '$total ${total == 1 ? 'invoice' : 'invoices'}';
                                    }(),
                                    icon: Icons.trending_up_rounded,
                                    color: const Color(0xFF10B981),
                                    onTap: () => _navigateToFilteredInvoices('thisMonth'),
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: _StatCard(
                                    title: 'Total Invoices',
                                    value: (_stats?['totalInvoices'] as int?)?.toString() ?? '0',
                                    subtitle: 'All time',
                                    icon: Icons.receipt_long_rounded,
                                    color: const Color(0xFF4a90e2),
                                    onTap: () => _navigateToFilteredInvoices('all'),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 24),
                            // Charts Section - Only show if we have invoice data
                            if (_chartInvoices.isNotEmpty) ...[
                              RepaintBoundary(
                                child: RevenueChart(
                                  invoices: _chartInvoices, // Use strongly-typed list (fixes web casting issue)
                                ),
                              ),
                              const SizedBox(height: 20),
                              RepaintBoundary(
                                child: StatusPieChart(
                                  unpaid: _chartInvoices
                                      .where((inv) =>
                                          inv.status != InvoiceStatus.paid &&
                                          inv.status != InvoiceStatus.cancelled)
                                      .length,
                                  paid: _chartInvoices
                                      .where((inv) => inv.status == InvoiceStatus.paid)
                                      .length,
                                  overdue: _chartInvoices
                                      .where((inv) => inv.status == InvoiceStatus.overdue)
                                      .length,
                                ),
                              ),
                              const SizedBox(height: 16),
                            ] else if (_stats != null && (_stats!['totalInvoices'] as int? ?? 0) == 0) ...[
                              // Show message when no invoices exist yet
                              Container(
                                padding: const EdgeInsets.all(24),
                                decoration: BoxDecoration(
                                  color: Colors.grey[50],
                                  borderRadius: BorderRadius.circular(12),
                                  border: Border.all(color: Colors.grey[200]!),
                                ),
                                child: Column(
                                  children: [
                                    Icon(
                                      Icons.insert_chart_outlined,
                                      size: 48,
                                      color: Colors.grey[400],
                                    ),
                                    const SizedBox(height: 12),
                                    Text(
                                      'No invoices yet',
                                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                                        color: Colors.grey[600],
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      'Create your first invoice to see charts and analytics here',
                                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                        color: Colors.grey[500],
                                      ),
                                      textAlign: TextAlign.center,
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ],
                        ),
                    );
                },
              ),
            ),
          const Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: OfflineBanner(),
          ),
        ],
      ),
    );
  }
}

class _StatCard extends StatefulWidget {
  final String title;
  final String value;
  final String? subtitle;
  final IconData icon;
  final Color color;
  final VoidCallback? onTap;

  const _StatCard({
    required this.title,
    required this.value,
    this.subtitle,
    required this.icon,
    required this.color,
    this.onTap,
    super.key,
  });

  @override
  State<_StatCard> createState() => _StatCardState();
}

class _StatCardState extends State<_StatCard>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnimation;
  late Animation<double> _fadeAnimation;
  bool _isPressed = false;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );
    _scaleAnimation = Tween<double>(begin: 0.95, end: 1.0).animate(
      CurvedAnimation(
        parent: _controller,
        curve: Curves.easeOutCubic,
      ),
    );
    _fadeAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _controller,
        curve: Curves.easeOut,
      ),
    );
    _controller.forward();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _copyCardToClipboard(BuildContext context) async {
    final cardContent = '${widget.title}: ${widget.value}';
    try {
      await Clipboard.setData(ClipboardData(text: cardContent));
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                const Icon(Icons.check_circle, color: Colors.white),
                const SizedBox(width: 8),
                Expanded(
                  child: SelectableText(
                    'Copied "$cardContent" to clipboard',
                    style: const TextStyle(color: Colors.white),
                    enableInteractiveSelection: true,
                  ),
                ),
              ],
            ),
            duration: const Duration(seconds: 2),
            backgroundColor: Colors.green,
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

  @override
  Widget build(BuildContext context) {
    final isCurrency = widget.value.startsWith('\$');
    final numericValue = isCurrency 
        ? widget.value.replaceAll('\$', '').replaceAll(',', '')
        : widget.value;
    final isZero = numericValue == '0' || numericValue == '0.00';
    
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return FadeTransition(
          opacity: _fadeAnimation,
          child: Transform.scale(
            scale: _scaleAnimation.value,
            child: GestureDetector(
              onTapDown: (_) {
                if (widget.onTap != null) {
                  setState(() => _isPressed = true);
                }
              },
              onTapUp: (_) {
                setState(() => _isPressed = false);
                widget.onTap?.call();
              },
              onTapCancel: () {
                setState(() => _isPressed = false);
              },
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 150),
                transform: Matrix4.identity()
                  ..scaleByVector3(vm.Vector3(_isPressed ? 0.98 : 1.0, _isPressed ? 0.98 : 1.0, 1.0)),
          child: Container(
            decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(18),
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                      colors: [
                        Theme.of(context).colorScheme.surface,
                        widget.color.withValues(alpha: 0.02),
                      ],
              ),
                    border: Border.all(
                      color: widget.color.withValues(alpha: 0.15),
                      width: 1.5,
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: widget.color.withValues(alpha: 0.08),
                        blurRadius: 12,
                        offset: const Offset(0, 4),
                        spreadRadius: 0,
                      ),
                      BoxShadow(
                        color: Theme.of(context).shadowColor.withValues(alpha: 0.02),
                        blurRadius: 4,
                        offset: const Offset(0, 2),
                      ),
                    ],
            ),
            child: Stack(
              children: [
                      // Background accent
                      Positioned(
                        top: 0,
                        right: 0,
                        child: Container(
                          width: 120,
                          height: 120,
                          decoration: BoxDecoration(
                            borderRadius: const BorderRadius.only(
                              topRight: Radius.circular(18),
                              bottomLeft: Radius.circular(100),
                            ),
                            gradient: RadialGradient(
                              colors: [
                                widget.color.withValues(alpha: 0.06),
                                widget.color.withValues(alpha: 0.0),
                              ],
                            ),
                          ),
                        ),
                      ),
                Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                            // Icon row
                      Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                                  padding: const EdgeInsets.all(14),
                            decoration: BoxDecoration(
                                    gradient: LinearGradient(
                                      begin: Alignment.topLeft,
                                      end: Alignment.bottomRight,
                                      colors: [
                                        widget.color.withValues(alpha: 0.2),
                                        widget.color.withValues(alpha: 0.1),
                                      ],
                                    ),
                                    borderRadius: BorderRadius.circular(14),
                              boxShadow: [
                                BoxShadow(
                                        color: widget.color.withValues(alpha: 0.15),
                                  blurRadius: 8,
                                        offset: const Offset(0, 3),
                                      ),
                                    ],
                                  ),
                                  child: Icon(
                                    widget.icon,
                                    color: widget.color,
                                    size: 24,
                                  ),
                                ),
                                if (widget.onTap != null)
                                  Container(
                                    padding: const EdgeInsets.all(8),
                                    decoration: BoxDecoration(
                                      color: Theme.of(context).colorScheme.surfaceContainerHighest.withValues(alpha: 0.3),
                                      borderRadius: BorderRadius.circular(8),
                                    ),
                                    child: Icon(
                                      Icons.arrow_forward_ios_rounded,
                                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                                      size: 12,
                                    ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 24),
                            // Title
                            Text(
                              widget.title,
                              style: TextStyle(
                                fontSize: 13,
                                color: Theme.of(context).colorScheme.onSurfaceVariant,
                                fontWeight: FontWeight.w600,
                                letterSpacing: 0.3,
                                height: 1.3,
                            ),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                      ),
                            const SizedBox(height: 14),
                            // Value
                            FittedBox(
                              fit: BoxFit.scaleDown,
                              alignment: Alignment.centerLeft,
                              child: Text(
                                widget.value,
                        style: TextStyle(
                                  fontSize: isCurrency ? 30 : 32,
                                  fontWeight: FontWeight.w800,
                                  color: isZero
                                      ? Theme.of(context).colorScheme.onSurfaceVariant.withValues(alpha: 0.5)
                                      : widget.color,
                                  height: 1.0,
                                  letterSpacing: isCurrency ? -1.2 : -1.0,
                                ),
                        ),
                      ),
                            // Subtitle
                            if (widget.subtitle != null) ...[
                              const SizedBox(height: 10),
                              Text(
                                widget.subtitle!,
                          style: TextStyle(
                            fontSize: 12,
                            color: Colors.grey[600],
                            fontWeight: FontWeight.w500,
                                  height: 1.4,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ],
                  ),
                ),
                      // Copy button
                Positioned(
                        top: 14,
                        right: 14,
                  child: Material(
                    color: Colors.transparent,
                    child: InkWell(
                            onTap: () => _copyCardToClipboard(context),
                            borderRadius: BorderRadius.circular(10),
                      child: Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(10),
                                boxShadow: [
                                  BoxShadow(
                                    color: Colors.black.withValues(alpha: 0.05),
                                    blurRadius: 4,
                                    offset: const Offset(0, 2),
                                  ),
                                ],
                        ),
                              child: Icon(
                                Icons.copy_rounded,
                                color: Colors.grey[600],
                                size: 14,
                              ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
          ),
        );
      },
    );
  }
}
