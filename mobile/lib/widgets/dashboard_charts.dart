import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:intl/intl.dart';
import 'package:vector_math/vector_math_64.dart' as vm;
import '../models/invoice.dart';

enum ChartPeriod {
  thisMonth,
  last30Days,
  last3Months,
  last6Months,
  thisYear,
  lastYear,
  allTime,
  customRange,
}

enum ChartType { line, bar }

/// Revenue over time chart with selectable time periods - Optimized with accurate data
class RevenueChart extends StatefulWidget {
  final List<Invoice> invoices;

  const RevenueChart({required this.invoices, super.key});

  @override
  State<RevenueChart> createState() => _RevenueChartState();
}

class _RevenueChartState extends State<RevenueChart> {
  ChartPeriod _selectedPeriod = ChartPeriod.last6Months;
  ChartType _chartType = ChartType.line;
  DateTime? _customStartDate;
  DateTime? _customEndDate;

  // TradingView-style interaction variables
  double _zoom = 1.0;
  double _previousZoom = 1.0;
  double _panX = 0.0;
  double _previousPanX = 0.0;
  Offset? _crosshairPosition;
  int? _selectedIndex;
  bool _isTouching = false;

  // Memoization cache for chart data
  Map<String, double>? _dataCache;
  ChartPeriod? _cachedPeriod;
  List<Invoice>? _cachedInvoices;

  // Helper method to calculate label interval based on data density
  double _calculateLabelInterval(int labelCount) {
    if (labelCount <= 6) {
      return 1.0;
    } else if (labelCount <= 12) {
      return 1.0;
    } else if (labelCount <= 24) {
      return 2.0;
    } else if (labelCount <= 36) {
      return 3.0;
    } else {
      return (labelCount / 12).ceilToDouble();
    }
  }

  Map<String, double> _calculateData(ChartPeriod period) {
    // Check cache first
    if (_dataCache != null && 
        _cachedPeriod == period && 
        _cachedInvoices == widget.invoices) {
      return _dataCache!;
    }

    final now = DateTime.now();
    final data = <String, double>{};
    final orderedKeys = <String>[];
    DateTime? startDate;
    DateTime? endDate;
    bool groupByDay = false;

    switch (period) {
      case ChartPeriod.thisMonth:
        startDate = DateTime(now.year, now.month, 1);
        endDate = DateTime(now.year, now.month + 1, 0);
        groupByDay = true;
        break;

      case ChartPeriod.last30Days:
        startDate = now.subtract(const Duration(days: 29));
        endDate = now;
        groupByDay = true;
        break;

      case ChartPeriod.last3Months:
        startDate = DateTime(now.year, now.month - 2, 1);
        endDate = DateTime(now.year, now.month + 1, 0);
        groupByDay = false;
        break;

      case ChartPeriod.last6Months:
        startDate = DateTime(now.year, now.month - 5, 1);
        endDate = DateTime(now.year, now.month + 1, 0);
        groupByDay = false;
        break;

      case ChartPeriod.thisYear:
        startDate = DateTime(now.year, 1, 1);
        endDate = DateTime(now.year, now.month + 1, 0);
        groupByDay = false;
        break;

      case ChartPeriod.lastYear:
        startDate = DateTime(now.year - 1, 1, 1);
        endDate = DateTime(now.year - 1, 12, 31);
        groupByDay = false;
        break;

      case ChartPeriod.allTime:
        // Find earliest invoice date or use a reasonable default
        if (widget.invoices.isNotEmpty) {
          final earliestDate = widget.invoices
              .map((inv) => inv.issueDate)
              .reduce((a, b) => a.isBefore(b) ? a : b);
          startDate = DateTime(earliestDate.year, earliestDate.month, 1);
        } else {
          startDate = DateTime(now.year - 1, 1, 1);
        }
        endDate = now;
        groupByDay = false;
        break;

      case ChartPeriod.customRange:
        if (_customStartDate != null && _customEndDate != null) {
          startDate = _customStartDate;
          endDate = _customEndDate;
          // Determine grouping based on date range
          final daysDiff = endDate!.difference(startDate!).inDays;
          groupByDay = daysDiff <= 60; // Group by day if <= 60 days
        } else {
          return {}; // Return empty if custom range not set
        }
        break;
    }

    // At this point, startDate and endDate are guaranteed to be non-null
    // (customRange returns early if null)

    // Generate date keys based on grouping
    if (groupByDay) {
      var current = DateTime(startDate.year, startDate.month, startDate.day);
      while (!current.isAfter(endDate)) {
        final dayKey = DateFormat('yyyy-MM-dd').format(current);
        data[dayKey] = 0.0;
        orderedKeys.add(dayKey);
        current = current.add(const Duration(days: 1));
      }
    } else {
      var current = DateTime(startDate.year, startDate.month, 1);
      while (!current.isAfter(endDate)) {
        final monthKey = DateFormat('yyyy-MM').format(current);
        data[monthKey] = 0.0;
        orderedKeys.add(monthKey);
        current = DateTime(current.year, current.month + 1, 1);
      }
    }

    // Calculate revenue based on period
    // startDate and endDate are already validated above

    for (final invoice in widget.invoices) {
      final invoiceDate = DateTime(
        invoice.issueDate.year,
        invoice.issueDate.month,
        invoice.issueDate.day,
      );

      // Check if invoice is within date range
      if (invoiceDate.isBefore(startDate) || invoiceDate.isAfter(endDate)) {
        continue;
      }

      String key;
      if (groupByDay) {
        key = DateFormat('yyyy-MM-dd').format(invoiceDate);
      } else {
        key = DateFormat('yyyy-MM').format(invoiceDate);
      }

      if (data.containsKey(key)) {
        data[key] = (data[key] ?? 0.0) + invoice.total;
      }
    }

    // Return sorted data map
    final sortedData = <String, double>{};
    for (final key in orderedKeys) {
      sortedData[key] = data[key] ?? 0.0;
    }
    
    // Cache the result
    _dataCache = sortedData;
    _cachedPeriod = period;
    _cachedInvoices = widget.invoices;
    
    return sortedData;
  }

  @override
  void didUpdateWidget(RevenueChart oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Clear cache if invoices changed
    if (oldWidget.invoices != widget.invoices) {
      _dataCache = null;
      _cachedInvoices = null;
    }
  }

  String _getPeriodLabel(ChartPeriod period) {
    switch (period) {
      case ChartPeriod.thisMonth:
        return 'This Month';
      case ChartPeriod.last30Days:
        return 'Last 30 Days';
      case ChartPeriod.last3Months:
        return 'Last 3 Months';
      case ChartPeriod.last6Months:
        return 'Last 6 Months';
      case ChartPeriod.thisYear:
        return 'This Year';
      case ChartPeriod.lastYear:
        return 'Last Year';
      case ChartPeriod.allTime:
        return 'All Time';
      case ChartPeriod.customRange:
        if (_customStartDate != null && _customEndDate != null) {
          return '${DateFormat('MMM d').format(_customStartDate!)} - ${DateFormat('MMM d').format(_customEndDate!)}';
        }
        return 'Custom Range';
    }
  }

  Future<void> _selectCustomDateRange(BuildContext context) async {
    if (!mounted) return;
    
    final now = DateTime.now();
    final start = await showDatePicker(
      context: context,
      initialDate: _customStartDate ?? now.subtract(const Duration(days: 30)),
      firstDate: DateTime(2000),
      lastDate: now,
    );

    if (start == null) return;
    
    if (!mounted) return;
    final end = await showDatePicker(
      // ignore: use_build_context_synchronously
      context: context,
      initialDate: _customEndDate ?? now,
      firstDate: start,
      lastDate: now,
    );

    if (!mounted || end == null) return;
    
    setState(() {
      _customStartDate = start;
      _customEndDate = end;
      _selectedPeriod = ChartPeriod.customRange;
    });
  }

  Map<String, dynamic> _calculateSummaryStats(List<MapEntry<String, double>> sortedData) {
    if (sortedData.isEmpty) {
      return {
        'total': 0.0,
        'average': 0.0,
        'peak': 0.0,
        'peakDate': '',
      };
    }

    final values = sortedData.map((e) => e.value).toList();
    final total = values.fold(0.0, (a, b) => a + b);
    final average = total / values.length;
    final peakEntry = sortedData.reduce((a, b) => a.value > b.value ? a : b);
    final peak = peakEntry.value;
    
    String peakDate;
    try {
      if (peakEntry.key.contains('-') && peakEntry.key.length == 10) {
        // Daily format
        final date = DateTime.tryParse('${peakEntry.key}T00:00:00');
        if (date != null) {
          peakDate = DateFormat('MMM d').format(date);
        } else {
          peakDate = peakEntry.key;
        }
      } else {
        // Monthly format
        final parts = peakEntry.key.split('-');
        if (parts.length >= 2) {
          final year = int.tryParse(parts[0]);
          final month = int.tryParse(parts[1]);
          if (year != null && month != null && month >= 1 && month <= 12) {
            final date = DateTime(year, month, 1);
            peakDate = DateFormat('MMM yyyy').format(date);
          } else {
            peakDate = peakEntry.key;
          }
        } else {
          peakDate = peakEntry.key;
        }
      }
    } catch (e) {
      peakDate = peakEntry.key;
    }

    return {
      'total': total,
      'average': average,
      'peak': peak,
      'peakDate': peakDate,
    };
  }

  @override
  Widget build(BuildContext context) {
    // RepaintBoundary is applied in dashboard_screen.dart
    return _buildChartContent();
  }

  Widget _buildChartContent() {
    final data = _calculateData(_selectedPeriod);
    final sortedData = data.entries.toList();

    // Early return if no data
    if (sortedData.isEmpty) {
      return Card(
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: BorderSide(color: Colors.grey[200]!, width: 1),
        ),
        child: Container(
          padding: const EdgeInsets.all(32),
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.bar_chart_outlined, size: 48, color: Colors.grey[400]),
                const SizedBox(height: 12),
                Text(
                  'No data available for this period',
                  style: TextStyle(color: Colors.grey[600], fontSize: 14),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final stats = _calculateSummaryStats(sortedData);

    // Determine if grouping by day
    final groupByDay = _selectedPeriod == ChartPeriod.thisMonth ||
        _selectedPeriod == ChartPeriod.last30Days ||
        (_selectedPeriod == ChartPeriod.customRange &&
            _customStartDate != null &&
            _customEndDate != null &&
            _customEndDate!.difference(_customStartDate!).inDays <= 60);

    // Labels for X-axis, one per point (index-based)
    final labels = sortedData.map((e) {
      try {
        if (groupByDay) {
          final date = DateTime.tryParse('${e.key}T00:00:00');
          if (date != null) {
            if (sortedData.length > 30) {
              return DateFormat('M/d').format(date);
            }
            return DateFormat('MMM d').format(date);
          }
        } else {
          final parts = e.key.split('-');
          if (parts.length >= 2) {
            final year = int.tryParse(parts[0]);
            final month = int.tryParse(parts[1]);
            if (year != null && month != null && month >= 1 && month <= 12) {
              final date = DateTime(year, month, 1);
              final now = DateTime.now();
              if (year == now.year) {
                return DateFormat('MMM').format(date);
              } else {
                return DateFormat('MMM yyyy').format(date);
              }
            }
          }
        }
        return e.key;
      } catch (_) {
        return e.key;
      }
    }).toList();

    // Y-axis range
    final maxValue = sortedData
        .map((e) => e.value)
        .fold<double>(0.0, (a, b) => a > b ? a : b);
    final minValue = 0.0;
    final range = maxValue - minValue;
    final interval = range > 0 ? (range / 4).ceilToDouble() : 100.0;

    if (maxValue.isNaN || maxValue.isInfinite) {
      return Card(
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: BorderSide(color: Colors.grey[200]!, width: 1),
        ),
        child: Container(
          padding: const EdgeInsets.all(32),
          child: Center(
            child: Text(
              'Invalid data values',
              style: TextStyle(color: Colors.grey[600], fontSize: 14),
            ),
          ),
        ),
      );
    }

    final bool denseData = sortedData.length >= 30;
    final double chartWidth = sortedData.length * (groupByDay ? 26 : 36);

    // --- INDEX-BASED SPOTS (no milliseconds) ---
    final finalSpots = List<FlSpot>.generate(
      sortedData.length,
      (i) => FlSpot(i.toDouble(), sortedData[i].value),
    );
    final double minXFinal = -0.5;
    final double maxXFinal =
        sortedData.isNotEmpty ? sortedData.length - 0.5 : 0.5;

    // Simple helper
    String formatCurrency(double value) {
      if (value >= 1000) {
        return '\$${(value / 1000).toStringAsFixed(1)}k';
      }
      return '\$${value.toInt()}';
    }

    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(color: Colors.grey[200]!, width: 1),
      ),
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(20),
          gradient: LinearGradient(
            colors: [
              Colors.white,
              const Color(0xFF4a90e2).withValues(alpha: 0.02),
            ],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                    Flexible(
                      child: Text(
                  'Revenue Over Time',
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.bold,
                        fontSize: 18,
                        color: Colors.grey[800],
                      ),
                        overflow: TextOverflow.ellipsis,
                ),
                    ),
                    const SizedBox(width: 8),
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                    // Chart type toggle
                    GestureDetector(
                      onTap: () {
                        setState(() {
                          _chartType = _chartType == ChartType.line
                              ? ChartType.bar
                              : ChartType.line;
                        });
                      },
                      child: Container(
                        padding: const EdgeInsets.all(6),
                        decoration: BoxDecoration(
                          color: Colors.grey[100],
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Icon(
                          _chartType == ChartType.line
                              ? Icons.bar_chart_rounded
                              : Icons.show_chart_rounded,
                          color: Colors.grey[700],
                          size: 18,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    // Period selector
                    GestureDetector(
                      onTap: () {
                        showModalBottomSheet(
                          context: context,
                          shape: const RoundedRectangleBorder(
                            borderRadius: BorderRadius.vertical(
                              top: Radius.circular(20),
                            ),
                          ),
                          builder: (context) => Container(
                            padding: const EdgeInsets.symmetric(vertical: 20),
                            constraints: BoxConstraints(
                              maxHeight: MediaQuery.of(context).size.height * 0.7,
                            ),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                Container(
                                  width: 40,
                                  height: 4,
                                  margin: const EdgeInsets.only(bottom: 20),
                                  decoration: BoxDecoration(
                                    color: Colors.grey[300],
                                    borderRadius: BorderRadius.circular(2),
                                  ),
                                ),
                                Flexible(
                                  child: SingleChildScrollView(
                                    child: Column(
                                      children: [
                                        _PeriodOption(
                                          label: 'Last 3 Months',
                                          period: ChartPeriod.last3Months,
                                          selected:
                                              _selectedPeriod ==
                                                  ChartPeriod.last3Months,
                                          onTap: () {
                                            setState(() {
                                              _selectedPeriod =
                                                  ChartPeriod.last3Months;
                                            });
                                            Navigator.pop(context);
                                          },
                                        ),
                                        _PeriodOption(
                                          label: 'Last 6 Months',
                                          period: ChartPeriod.last6Months,
                                          selected:
                                              _selectedPeriod ==
                                                  ChartPeriod.last6Months,
                                          onTap: () {
                                            setState(() {
                                              _selectedPeriod =
                                                  ChartPeriod.last6Months;
                                            });
                                            Navigator.pop(context);
                                          },
                                        ),
                                        _PeriodOption(
                                          label: 'This Year',
                                          period: ChartPeriod.thisYear,
                                          selected:
                                              _selectedPeriod ==
                                                  ChartPeriod.thisYear,
                                          onTap: () {
                                            setState(() {
                                              _selectedPeriod =
                                                  ChartPeriod.thisYear;
                                            });
                                            Navigator.pop(context);
                                          },
                                        ),
                                        _PeriodOption(
                                          label: 'All Time',
                                          period: ChartPeriod.allTime,
                                          selected:
                                              _selectedPeriod ==
                                                  ChartPeriod.allTime,
                                          onTap: () {
                                            setState(() {
                                              _selectedPeriod =
                                                  ChartPeriod.allTime;
                                            });
                                            Navigator.pop(context);
                                          },
                                        ),
                                        _PeriodOption(
                                          label: 'Custom Range',
                                          period: ChartPeriod.customRange,
                                          selected:
                                              _selectedPeriod ==
                                                  ChartPeriod.customRange,
                                          onTap: () async {
                                            Navigator.pop(context);
                                            await _selectCustomDateRange(
                                                context,
                                            );
                                          },
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 10),
                              ],
                            ),
                          ),
                        );
                      },
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 6,
                        ),
                  decoration: BoxDecoration(
                    color: const Color(0xFF4a90e2).withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: const Color(0xFF4a90e2).withValues(alpha: 0.3),
                            width: 1,
                  ),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Flexible(
                              child: FittedBox(
                                fit: BoxFit.scaleDown,
                  child: Text(
                                  _getPeriodLabel(_selectedPeriod),
                                  style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                                    color: Color(0xFF4a90e2),
                    ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ),
                            const SizedBox(width: 4),
                            const Icon(
                              Icons.arrow_drop_down,
                              color: Color(0xFF4a90e2),
                              size: 18,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
            // Summary statistics
            if (sortedData.isNotEmpty) ...[
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 16),
                decoration: BoxDecoration(
                  color: Colors.grey[50],
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.grey[200]!, width: 1),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    Expanded(
                      child: _StatItem(
                        label: 'Total',
                        value: '\$${stats['total'].toStringAsFixed(2)}',
                        icon: Icons.account_balance_wallet_rounded,
                      ),
                    ),
                    Container(
                      width: 1,
                      height: 40,
                      color: Colors.grey[300],
                    ),
                    Expanded(
                      child: _StatItem(
                        label: 'Average',
                        value: '\$${stats['average'].toStringAsFixed(2)}',
                        icon: Icons.trending_up_rounded,
                      ),
                    ),
                    Container(
                      width: 1,
                      height: 40,
                      color: Colors.grey[300],
                    ),
                    Expanded(
                      child: _StatItem(
                        label: 'Peak',
                        value: '\$${stats['peak'].toStringAsFixed(2)}',
                        subtitle: stats['peakDate'] as String,
                        icon: Icons.arrow_upward_rounded,
                      ),
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 24),
            ConstrainedBox(
              constraints: BoxConstraints(
                maxHeight: groupByDay ? 280 : 300,
                minHeight: 200,
              ),
              child: SizedBox(
                height: groupByDay ? 280 : 300,
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: SizedBox(
                    width: chartWidth < MediaQuery.of(context).size.width
                        ? MediaQuery.of(context).size.width
                        : chartWidth,
                    child: Padding(
                      padding: EdgeInsets.symmetric(
                        horizontal: groupByDay ? 4.0 : 8.0,
                      ),
                      child: LayoutBuilder(
                        builder: (context, constraints) {
                          return Stack(
                            children: [
                              GestureDetector(
                                onScaleStart: (details) {
                                  _previousZoom = _zoom;
                                  _previousPanX = _panX;
                                },
                                onScaleUpdate: (details) {
                                  setState(() {
                                    // Pinch Zoom
                                    _zoom = (_previousZoom * details.scale).clamp(1.0, 8.0);

                                    // Horizontal Pan
                                    _panX = (_previousPanX + details.focalPointDelta.dx)
                                        .clamp(-chartWidth * (_zoom - 1), 0.0);
                                  });
                                },
                                onDoubleTap: () {
                                  setState(() {
                                    _zoom = 1.0;
                                    _panX = 0.0;
                                  });
                                },
                                onLongPressMoveUpdate: (details) {
                                  _isTouching = true;

                                  final localX =
                                      (details.localPosition.dx - _panX) /
                                          _zoom;
                                  final visibleWidth =
                                      constraints.maxWidth;
                                  if (sortedData.isEmpty ||
                                      visibleWidth <= 0) return;

                                  // Map finger X (0..visibleWidth) -> index (0..len-1)
                                  final chartX = (localX / visibleWidth) *
                                      (sortedData.length - 1);
                                  final closestIndex = chartX
                                      .round()
                                      .clamp(0, sortedData.length - 1);

                                  setState(() {
                                    _crosshairPosition = Offset(
                                      details.localPosition.dx,
                                      details.localPosition.dy,
                                    );
                                    _selectedIndex = closestIndex;
                                  });
                                },
                            onLongPressEnd: (_) {
                              setState(() {
                                _isTouching = false;
                                _crosshairPosition = null;
                                _selectedIndex = null;
                              });
                            },
                                child: Transform(
                                  transform: Matrix4.identity()
                                    ..translate(_panX)
                                    ..scale(_zoom, 1.0),
                              child: _chartType == ChartType.line
                                  ? LineChart(
                                      LineChartData(
                                        minY: minValue,
                                        maxY: maxValue > 0
                                            ? (maxValue * 1.15).clamp(100.0, double.infinity)
                                            : 100.0,
                                            minX: minXFinal,
                                            maxX: maxXFinal,
                                        clipData: const FlClipData.all(),
                                        gridData: FlGridData(
                                          show: true,
                                          drawVerticalLine: false,
                                          horizontalInterval: interval > 0 ? interval : 100,
                                          getDrawingHorizontalLine: (value) {
                                            return FlLine(
                                              color: Colors.grey[300]!,
                                              strokeWidth: 1.5,
                                              dashArray: const [4, 4],
                                            );
                                          },
                                        ),
                                        titlesData: FlTitlesData(
                                          leftTitles: AxisTitles(
                                            sideTitles: SideTitles(
                                              showTitles: true,
                                              reservedSize: 60,
                                              interval: interval,
                                              getTitlesWidget: (value, meta) {
                                                if (value == meta.min || value == meta.max) {
                                                  return const SizedBox.shrink();
                                                }
                                                return Padding(
                                                  padding: const EdgeInsets.only(right: 10),
                                                  child: Text(
                                                    formatCurrency(value),
                                                    style: TextStyle(
                                                      fontSize: 12,
                                                      fontWeight: FontWeight.w700,
                                                      color: Colors.grey[800],
                                                      letterSpacing: 0.2,
                                                    ),
                                                    textAlign: TextAlign.right,
                                                  ),
                                                );
                                              },
                                            ),
                                          ),
                                          bottomTitles: AxisTitles(
                                            sideTitles: SideTitles(
                                              showTitles: true,
                                              reservedSize: groupByDay ? 30 : 40,
                                              interval: _calculateLabelInterval(labels.length),
                                              getTitlesWidget: (value, meta) {
                                                // Round to nearest integer to handle fractional positions
                                                final index = value.round();

                                                if (index < 0 || index >= labels.length) {
                                                  return const SizedBox.shrink();
                                                }

                                                // Only show labels at integer positions that match interval
                                                final interval = _calculateLabelInterval(labels.length);
                                                if (interval > 1) {
                                                  final shouldShow = (index % interval.toInt() == 0);
                                                  if (!shouldShow) {
                                                    return const SizedBox.shrink();
                                                  }
                                                }

                                                return Padding(
                                                  padding: const EdgeInsets.only(top: 6),
                                                  child: Text(
                                                    labels[index],
                                                    style: TextStyle(
                                                      fontSize: groupByDay ? 9 : 10,
                                                      fontWeight: FontWeight.w600,
                                                    ),
                                                    maxLines: 1,
                                                    overflow: TextOverflow.ellipsis,
                                                  ),
                                                );
                                              },
                                            ),
                                          ),
                                          topTitles: const AxisTitles(
                                            sideTitles: SideTitles(showTitles: false),
                                          ),
                                          rightTitles: const AxisTitles(
                                            sideTitles: SideTitles(showTitles: false),
                                          ),
                                        ),
                                        borderData: FlBorderData(
                                          show: true,
                                          border: Border(
                                            bottom: BorderSide(
                                              color: Colors.grey[400]!,
                                              width: 1.5,
                                            ),
                                            left: BorderSide(
                                              color: Colors.grey[400]!,
                                              width: 1.5,
                                            ),
                                          ),
                                        ),
                                        lineBarsData: [
                                          LineChartBarData(
                                            spots: finalSpots,
                                            isCurved: true,
                                            curveSmoothness: _selectedPeriod ==
                                                    ChartPeriod.thisMonth
                                                ? 0.4
                                                : 0.5,
                                            color: const Color(0xFF4a90e2),
                                            barWidth: _selectedPeriod == ChartPeriod.thisMonth
                                                ? 4
                                                : 4.5,
                                            isStrokeCapRound: true,
                                            dotData: FlDotData(
                                              show: !denseData,
                                              getDotPainter: (spot, percent, barData, index) {
                                                if (denseData) {
                                                  return FlDotCirclePainter(
                                                    radius: 0,
                                                    color: Colors.transparent,
                                                  );
                                                }
                                                return FlDotCirclePainter(
                                                  radius: 5,
                                                  color: Colors.white,
                                                  strokeWidth: 3,
                                                  strokeColor: const Color(0xFF4a90e2),
                                                );
                                              },
                                            ),
                                            belowBarData: BarAreaData(
                                              show: true,
                                              gradient: LinearGradient(
                                                colors: [
                                                  const Color(0xFF4a90e2).withValues(
                                                    alpha: _selectedPeriod ==
                                                            ChartPeriod.thisMonth
                                                        ? 0.25
                                                        : 0.3,
                                                  ),
                                                  const Color(0xFF4a90e2)
                                                      .withValues(alpha: 0.03),
                                                ],
                                                begin: Alignment.topCenter,
                                                end: Alignment.bottomCenter,
                                              ),
                                            ),
                                          ),
                                        ],
                                        lineTouchData: const LineTouchData(
                                          enabled: false,
                                        ),
                                      ),
                                    )
                                  : BarChart(
                                      BarChartData(
                                        minY: minValue,
                                        maxY: maxValue > 0
                                            ? (maxValue * 1.15).clamp(100.0, double.infinity)
                                            : 100.0,
                                        barTouchData: BarTouchData(
                                          enabled: true,
                                          touchTooltipData: BarTouchTooltipData(
                                            getTooltipColor: (group) =>
                                                const Color(0xFF4a90e2),
                                            tooltipPadding: const EdgeInsets.symmetric(
                                              horizontal: 12,
                                              vertical: 8,
                                            ),
                                            tooltipMargin: 8,
                                            getTooltipItem: (group, groupIndex, rod, rodIndex) {
                                              final index = group.x.toInt();
                                              if (index >= 0 && index < sortedData.length) {
                                                final key = sortedData[index].key;
                                                String displayLabel;
                                                try {
                                                  if (groupByDay) {
                                                    final date =
                                                        DateTime.parse('${key}T00:00:00');
                                                    displayLabel =
                                                        DateFormat('MMM dd, yyyy').format(date);
                                                  } else {
                                                    final parts = key.split('-');
                                                    if (parts.length >= 2) {
                                                      final year = int.tryParse(parts[0]);
                                                      final month = int.tryParse(parts[1]);
                                                      if (year != null &&
                                                          month != null &&
                                                          month >= 1 &&
                                                          month <= 12) {
                                                        final date = DateTime(year, month, 1);
                                                        displayLabel =
                                                            DateFormat('MMM yyyy').format(date);
                                                      } else {
                                                        displayLabel = key;
                                                      }
                                                    } else {
                                                      displayLabel = key;
                                                    }
                                                  }
                                                } catch (e) {
                                                  displayLabel = key;
                                                }
                                                return BarTooltipItem(
                                                  '\$${rod.toY.toStringAsFixed(2)}\n$displayLabel',
                                                  const TextStyle(
                                                    color: Colors.white,
                                                    fontWeight: FontWeight.bold,
                                                    fontSize: 13,
                                                    height: 1.4,
                                                  ),
                                                );
                                              }
                                              return BarTooltipItem(
                                                '\$${rod.toY.toStringAsFixed(2)}',
                                                const TextStyle(
                                                  color: Colors.white,
                                                  fontWeight: FontWeight.bold,
                                                  fontSize: 13,
                                                ),
                                              );
                                            },
                                          ),
                                        ),
                                        gridData: FlGridData(
                                          show: true,
                                          drawVerticalLine: false,
                                          horizontalInterval: interval > 0 ? interval : 100,
                                          getDrawingHorizontalLine: (value) {
                                            return FlLine(
                                              color: Colors.grey[300]!,
                                              strokeWidth: 1.5,
                                              dashArray: const [4, 4],
                                            );
                                          },
                                        ),
                                        titlesData: FlTitlesData(
                                          leftTitles: AxisTitles(
                                            sideTitles: SideTitles(
                                              showTitles: true,
                                              reservedSize: 60,
                                              interval: interval,
                                              getTitlesWidget: (value, meta) {
                                                if (value == meta.min || value == meta.max) {
                                                  return const SizedBox.shrink();
                                                }
                                                return Padding(
                                                  padding: const EdgeInsets.only(right: 10),
                                                  child: Text(
                                                    formatCurrency(value),
                                                    style: TextStyle(
                                                      fontSize: 12,
                                                      fontWeight: FontWeight.w700,
                                                      color: Colors.grey[800],
                                                      letterSpacing: 0.2,
                                                    ),
                                                    textAlign: TextAlign.right,
                                                  ),
                                                );
                                              },
                                            ),
                                          ),
                                              bottomTitles: AxisTitles(
                                                sideTitles: SideTitles(
                                                  showTitles: true,
                                                  reservedSize: groupByDay
                                                      ? 30
                                                      : 40,
                                                  getTitlesWidget:
                                                      (value, meta) {
                                                    final index =
                                                        value.round();
                                                    if (index < 0 ||
                                                        index >=
                                                            labels.length) {
                                                      return const SizedBox
                                                          .shrink();
                                                    }
                                                    return Padding(
                                                      padding:
                                                          const EdgeInsets
                                                                  .only(
                                                              top: 6),
                                                      child: Text(
                                                        labels[index],
                                                        style: TextStyle(
                                                          fontSize:
                                                              groupByDay
                                                                  ? 9
                                                                  : 10,
                                                          fontWeight:
                                                              FontWeight
                                                                  .w600,
                                                        ),
                                                        maxLines: 1,
                                                        overflow:
                                                            TextOverflow
                                                                .ellipsis,
                                                      ),
                                                    );
                                                  },
                                                ),
                                              ),
                                          topTitles: const AxisTitles(
                                            sideTitles: SideTitles(showTitles: false),
                                          ),
                                          rightTitles: const AxisTitles(
                                            sideTitles: SideTitles(showTitles: false),
                                          ),
                                        ),
                                        borderData: FlBorderData(
                                          show: true,
                                          border: Border(
                                            bottom: BorderSide(
                                              color: Colors.grey[400]!,
                                              width: 1.5,
                                            ),
                                            left: BorderSide(
                                              color: Colors.grey[400]!,
                                              width: 1.5,
                                            ),
                                          ),
                                        ),
                                            barGroups: List<
                                                BarChartGroupData>.generate(
                                              sortedData.length,
                                              (i) => BarChartGroupData(
                                                x: i,
                                                barRods: [
                                                  BarChartRodData(
                                                    toY: sortedData[i]
                                                        .value,
                                                    color: const Color(
                                                        0xFF4a90e2),
                                                    width: groupByDay
                                                        ? 8
                                                        : 20,
                                                    borderRadius:
                                                        const BorderRadius
                                                            .vertical(
                                                      top: Radius.circular(
                                                          4),
                                                    ),
                                                  ),
                                                ],
                                              ),
                                            ),
                                      ),
                                    ),
                            ),
                          ),

                          // Crosshair overlay
                          if (_isTouching && _crosshairPosition != null && _selectedIndex != null)
                            Positioned.fill(
                              child: IgnorePointer(
                                child: CustomPaint(
                                  painter: _CrosshairPainter(
                                    pos: _crosshairPosition!,
                                    color: const Color(0xFF4a90e2),
                                  ),
                                ),
                              ),
                            ),

                          // Floating Tooltip next to crosshair
                          if (_isTouching && _selectedIndex != null && _crosshairPosition != null &&
                              _selectedIndex! >= 0 && _selectedIndex! < sortedData.length &&
                              _selectedIndex! < labels.length)
                            Positioned(
                              left: _crosshairPosition!.dx + 10,
                              top: _crosshairPosition!.dy - 40,
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                                decoration: BoxDecoration(
                                  color: const Color(0xFF4a90e2),
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      '\$${sortedData[_selectedIndex!].value.toStringAsFixed(2)}',
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontWeight: FontWeight.bold,
                                        fontSize: 12,
                                      ),
                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      labels[_selectedIndex!],
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontSize: 11,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                        ],
                      );
                    },
                ),
                ),
              ),
            ),
            ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Crosshair painter for TradingView-style crosshair overlay
class _CrosshairPainter extends CustomPainter {
  final Offset pos;
  final Color color;

  _CrosshairPainter({required this.pos, required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color.withValues(alpha: 0.6)
      ..strokeWidth = 1.2;

    // Vertical line
    canvas.drawLine(
      Offset(pos.dx, 0),
      Offset(pos.dx, size.height),
      paint,
    );

    // Horizontal line
    canvas.drawLine(
      Offset(0, pos.dy),
      Offset(size.width, pos.dy),
      paint,
    );

    // Circle at crosshair center
    canvas.drawCircle(
      pos,
      4,
      paint..color = color,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => true;
}

/// Pie chart showing invoice status distribution - Advanced design with animations
class StatusPieChart extends StatefulWidget {
  final int unpaid;
  final int paid;
  final int overdue;

  const StatusPieChart({
    required this.unpaid,
    required this.paid,
    required this.overdue,
    super.key,
  });

  @override
  State<StatusPieChart> createState() => _StatusPieChartState();
}

class _StatusPieChartState extends State<StatusPieChart>
    with SingleTickerProviderStateMixin {
  late AnimationController _animationController;
  late Animation<double> _animation;

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    );
    _animation = CurvedAnimation(
      parent: _animationController,
      curve: Curves.easeOutCubic,
    );
    _animationController.forward();
  }

  @override
  void dispose() {
    _animationController.dispose();
    super.dispose();
  }

  List<Widget> _buildLegendItems(int total) {
    final items = <Widget>[];
    
    if (widget.paid > 0) {
      items.add(_buildLegendItem(
        const Color(0xFF10B981),
        'Paid',
        widget.paid,
        total,
      ),);
    }
    
    if (widget.unpaid > 0) {
      items.add(_buildLegendItem(
        const Color(0xFFF59E0B),
        'Unpaid',
        widget.unpaid,
        total,
      ),);
    }
    
    if (widget.overdue > 0) {
      items.add(_buildLegendItem(
        const Color(0xFFEF4444),
        'Overdue',
        widget.overdue,
        total,
      ),);
    }
    
    return items;
  }

  Widget _buildLegendItem(Color color, String label, int value, int total) {
    final percentage = ((value / total) * 100).toStringAsFixed(1);
    
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        children: [
          Container(
            width: 12,
            height: 12,
            decoration: BoxDecoration(
              color: color,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                    color: Colors.grey[800],
                  ),
                ),
                Row(
                  children: [
                    Text(
                      '$value',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: Colors.grey[900],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      '($percentage%)',
                      style: TextStyle(
                        fontSize: 13,
                        color: Colors.grey[600],
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final total = widget.unpaid + widget.paid + widget.overdue;
    if (total == 0) {
      return Card(
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: BorderSide(color: Colors.grey[200]!, width: 1),
        ),
        child: Container(
          padding: const EdgeInsets.all(32),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            gradient: LinearGradient(
              colors: [
                Colors.white,
                Colors.grey[50]!,
              ],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
          ),
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.pie_chart_outline, size: 48, color: Colors.grey[400]),
                const SizedBox(height: 12),
                Text(
                  'No invoices to display',
                  style: TextStyle(
                    color: Colors.grey[600],
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final sections = <PieChartSectionData>[];
    
    // Only add sections for statuses that have values
    // Calculate percentage for each section
    final paidPercent = total > 0 ? (widget.paid / total) * 100 : 0.0;
    final unpaidPercent = total > 0 ? (widget.unpaid / total) * 100 : 0.0;
    final overduePercent = total > 0 ? (widget.overdue / total) * 100 : 0.0;
    
    // Advanced gradient colors
    if (widget.paid > 0) {
      sections.add(
        PieChartSectionData(
          value: widget.paid.toDouble(),
          title: paidPercent >= 8 ? '${paidPercent.toStringAsFixed(0)}%' : '',
          color: const Color(0xFF10B981),
          radius: 70,
          titleStyle: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: Colors.white,
          ),
        ),
      );
    }
    
    if (widget.unpaid > 0) {
      sections.add(
        PieChartSectionData(
          value: widget.unpaid.toDouble(),
          title: unpaidPercent >= 8 ? '${unpaidPercent.toStringAsFixed(0)}%' : '',
          color: const Color(0xFFF59E0B),
          radius: 70,
          titleStyle: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: Colors.white,
          ),
        ),
      );
    }
    
    if (widget.overdue > 0) {
      sections.add(
        PieChartSectionData(
          value: widget.overdue.toDouble(),
          title: overduePercent >= 8 ? '${overduePercent.toStringAsFixed(0)}%' : '',
          color: const Color(0xFFEF4444),
          radius: 70,
          titleStyle: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: Colors.white,
          ),
        ),
      );
    }

    return AnimatedBuilder(
      animation: _animation,
      builder: (context, child) {
        return FadeTransition(
          opacity: _animation,
          child: Card(
            elevation: 2,
      shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: Colors.grey[200]!, width: 1),
      ),
      child: Container(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Invoice Status',
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w600,
                          color: Colors.grey[900],
                          letterSpacing: -0.3,
                      ),
                ),
                Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: Colors.grey[100],
                          borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                          '$total total',
                    style: TextStyle(
                            fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: Colors.grey[700],
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),
                  Center(
                    child: SizedBox(
                      width: 180,
                      height: 180,
                      child: Stack(
                        alignment: Alignment.center,
              children: [
                          PieChart(
                    PieChartData(
                              sections: sections.map((section) {
                                return PieChartSectionData(
                                  value: section.value * _animation.value,
                                  title: section.title,
                                  color: section.color,
                                  radius: 70,
                                  titleStyle: section.titleStyle,
                                );
                              }).toList(),
                              sectionsSpace: 2,
                      centerSpaceRadius: 50,
                      startDegreeOffset: -90,
                    ),
                  ),
                          Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                              Text(
                                '$total',
                                style: TextStyle(
                                  fontSize: 28,
                                  fontWeight: FontWeight.bold,
                                  color: Colors.grey[900],
                                  height: 1,
                                ),
                        ),
                              const SizedBox(height: 4),
                              Text(
                                'Invoices',
                                style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w500,
                                  color: Colors.grey[600],
                                ),
                              ),
                            ],
                        ),
                    ],
                  ),
                ),
            ),
                  const SizedBox(height: 24),
                  ..._buildLegendItems(total),
          ],
              ),
        ),
      ),
        );
      },
    );
  }
}


class _StatItem extends StatelessWidget {
  final String label;
  final String value;
  final String? subtitle;
  final IconData icon;

  const _StatItem({
    required this.label,
    required this.value,
    this.subtitle,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(icon, size: 16, color: Colors.grey[600]),
        const SizedBox(height: 6),
        FittedBox(
          fit: BoxFit.scaleDown,
          child: Text(
            value,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.bold,
              color: Colors.grey[900],
            ),
            textAlign: TextAlign.center,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          label,
          style: TextStyle(
            fontSize: 10,
            color: Colors.grey[600],
            fontWeight: FontWeight.w500,
          ),
          textAlign: TextAlign.center,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        if (subtitle != null) ...[
          const SizedBox(height: 2),
          FittedBox(
            fit: BoxFit.scaleDown,
            child: Text(
              subtitle!,
              style: TextStyle(
                fontSize: 9,
                color: Colors.grey[500],
              ),
              textAlign: TextAlign.center,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ],
    );
  }
}

class _PeriodOption extends StatelessWidget {
  final String label;
  final ChartPeriod period;
  final bool selected;
  final VoidCallback onTap;

  const _PeriodOption({
    required this.label,
    required this.period,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
        decoration: BoxDecoration(
          color: selected
              ? const Color(0xFF4a90e2).withValues(alpha: 0.1)
              : Colors.transparent,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: selected ? const Color(0xFF4a90e2) : Colors.grey[300]!,
            width: selected ? 1.5 : 1,
          ),
        ),
        child: Row(
          children: [
            Container(
              width: 20,
              height: 20,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: selected
                      ? const Color(0xFF4a90e2)
                      : Colors.grey[400]!,
                  width: 2,
                ),
                color: selected ? const Color(0xFF4a90e2) : Colors.transparent,
              ),
              child: selected
                  ? const Icon(Icons.check, size: 14, color: Colors.white)
                  : null,
            ),
            const SizedBox(width: 12),
            Text(
              label,
              style: TextStyle(
                fontSize: 15,
                fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                color:
                    selected ? const Color(0xFF4a90e2) : Colors.grey[700],
              ),
            ),
          ],
        ),
      ),
    );
  }
}



