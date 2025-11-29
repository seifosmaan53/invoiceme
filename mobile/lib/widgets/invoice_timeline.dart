import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/invoice.dart';

class InvoiceTimeline extends StatelessWidget {
  final Invoice invoice;

  const InvoiceTimeline({super.key, required this.invoice});

  @override
  Widget build(BuildContext context) {
    final events = _buildTimelineEvents();
    
    if (events.isEmpty) {
      return const SizedBox.shrink();
    }

    return Card(
      elevation: 2,
      margin: const EdgeInsets.all(16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Timeline',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
            ),
            const SizedBox(height: 16),
            ...events.map((event) => _TimelineItem(event: event)),
          ],
        ),
      ),
    );
  }

  List<_TimelineEvent> _buildTimelineEvents() {
    final events = <_TimelineEvent>[];
    final dateFormat = DateFormat('MMM dd, yyyy • hh:mm a');

    // Created event
    events.add(_TimelineEvent(
      icon: Icons.add_circle,
      iconColor: Colors.blue,
      title: 'Invoice Created',
      description: 'Invoice ${invoice.number} was created',
      timestamp: invoice.createdAt,
      dateFormat: dateFormat,
    ));

    // Status changes based on timestamps
    if (invoice.updatedAt.isAfter(invoice.createdAt.add(const Duration(seconds: 1)))) {
      // Status might have changed
      String statusTitle = 'Invoice Updated';
      IconData statusIcon = Icons.edit;
      Color statusColor = Colors.orange;

      switch (invoice.status) {
        case InvoiceStatus.sent:
          statusTitle = 'Invoice Sent';
          statusIcon = Icons.send;
          statusColor = Colors.blue;
          break;
        case InvoiceStatus.paid:
          statusTitle = 'Invoice Paid';
          statusIcon = Icons.check_circle;
          statusColor = Colors.green;
          break;
        case InvoiceStatus.overdue:
          statusTitle = 'Invoice Overdue';
          statusIcon = Icons.warning;
          statusColor = Colors.red;
          break;
        case InvoiceStatus.cancelled:
          statusTitle = 'Invoice Cancelled';
          statusIcon = Icons.cancel;
          statusColor = Colors.grey;
          break;
        case InvoiceStatus.draft:
          statusTitle = 'Invoice Updated';
          statusIcon = Icons.edit;
          statusColor = Colors.orange;
          break;
      }

      events.add(_TimelineEvent(
        icon: statusIcon,
        iconColor: statusColor,
        title: statusTitle,
        description: 'Status: ${invoice.status.name.toUpperCase()}',
        timestamp: invoice.updatedAt,
        dateFormat: dateFormat,
      ));
    }

    // Due date event (if set and not paid)
    if (invoice.dueDate != null && invoice.status != InvoiceStatus.paid) {
      final now = DateTime.now();
      final dueDate = invoice.dueDate!;
      
      if (dueDate.isBefore(now) && invoice.status != InvoiceStatus.overdue) {
        // Due date passed but not marked overdue yet
        events.add(_TimelineEvent(
          icon: Icons.calendar_today,
          iconColor: Colors.orange,
          title: 'Due Date',
          description: 'Due date was ${DateFormat('MMM dd, yyyy').format(dueDate)}',
          timestamp: dueDate,
          dateFormat: dateFormat,
        ));
      } else if (dueDate.isAfter(now)) {
        // Future due date
        events.add(_TimelineEvent(
          icon: Icons.calendar_today,
          iconColor: Colors.blue,
          title: 'Due Date',
          description: 'Due on ${DateFormat('MMM dd, yyyy').format(dueDate)}',
          timestamp: dueDate,
          dateFormat: dateFormat,
        ));
      }
    }

    // Sort by timestamp (newest first)
    events.sort((a, b) => b.timestamp.compareTo(a.timestamp));

    return events;
  }
}

class _TimelineEvent {
  final IconData icon;
  final Color iconColor;
  final String title;
  final String description;
  final DateTime timestamp;
  final DateFormat dateFormat;

  _TimelineEvent({
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.description,
    required this.timestamp,
    required this.dateFormat,
  });
}

class _TimelineItem extends StatelessWidget {
  final _TimelineEvent event;

  const _TimelineItem({required this.event});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: event.iconColor.withOpacity(0.1),
              shape: BoxShape.circle,
              border: Border.all(color: event.iconColor, width: 2),
            ),
            child: Icon(event.icon, color: event.iconColor, size: 20),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  event.title,
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                ),
                const SizedBox(height: 4),
                Text(
                  event.description,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: Colors.grey[600],
                      ),
                ),
                const SizedBox(height: 4),
                Text(
                  event.dateFormat.format(event.timestamp),
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Colors.grey[500],
                        fontSize: 12,
                      ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

