import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/services/api_client.dart';
import '../models/client.dart';
import 'edit_client_screen.dart';

class ClientDetailScreen extends ConsumerWidget {
  final Client client;

  const ClientDetailScreen({super.key, required this.client});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(
        title: Text(client.name),
        actions: [
          IconButton(
            icon: const Icon(Icons.copy_all),
            tooltip: 'Copy Client Info',
            onPressed: () => _copyClientInfo(context),
          ),
          IconButton(
            icon: const Icon(Icons.edit),
            tooltip: 'Edit Client',
            onPressed: () async {
              final result = await Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (context) => EditClientScreen(client: client),
                ),
              );
              if (result == true && context.mounted) {
                Navigator.pop(context, true); // Return to refresh list
              }
            },
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Contact Information',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 16),
                  if (client.email != null) ...[
                    _InfoRow(
                      icon: Icons.email,
                      label: 'Email',
                      value: client.email!,
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (client.phone != null) ...[
                    _InfoRow(
                      icon: Icons.phone,
                      label: 'Phone',
                      value: client.phone!,
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (client.addressJson != null) ...[
                    _InfoRow(
                      icon: Icons.location_on,
                      label: 'Address',
                      value: _formatAddress(client.addressJson!),
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (client.notes != null && client.notes!.trim().isNotEmpty) ...[
                    _InfoRow(
                      icon: Icons.note,
                      label: 'Notes',
                      value: client.notes!,
                    ),
                  ],
                ],
              ),
            ),
          ),
          if (client.tags != null && client.tags!.isNotEmpty) ...[
            const SizedBox(height: 16),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Tags',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: client.tags!.map((tag) {
                        return Chip(
                          label: Text(tag),
                          backgroundColor: Theme.of(context).colorScheme.primaryContainer,
                        );
                      }).toList(),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  String _formatAddress(Map<String, dynamic> address) {
    final parts = <String>[];
    if (address['address'] != null) parts.add(address['address']);
    if (address['street'] != null) parts.add(address['street']);
    if (address['city'] != null) parts.add(address['city']);
    if (address['state'] != null) parts.add(address['state']);
    if (address['zip'] != null) parts.add(address['zip']);
    if (address['country'] != null) parts.add(address['country']);
    return parts.join(', ');
  }

  String _buildClientText(Client client) {
    final buffer = StringBuffer();
    
    buffer.writeln('═══════════════════════════════════════');
    buffer.writeln('CLIENT INFORMATION');
    buffer.writeln('═══════════════════════════════════════');
    buffer.writeln('');
    buffer.writeln('Name: ${client.name}');
    buffer.writeln('');
    
    if (client.email != null && client.email!.isNotEmpty) {
      buffer.writeln('Email: ${client.email}');
    }
    
    if (client.phone != null && client.phone!.isNotEmpty) {
      buffer.writeln('Phone: ${client.phone}');
    }
    
    if (client.addressJson != null) {
      final address = _formatAddress(client.addressJson!);
      if (address.isNotEmpty) {
        buffer.writeln('Address: $address');
      }
    }
    
    buffer.writeln('');
    buffer.writeln('═══════════════════════════════════════');
    
    return buffer.toString();
  }

  Future<void> _copyClientInfo(BuildContext context) async {
    final text = _buildClientText(client);
    try {
      await Clipboard.setData(ClipboardData(text: text));
      
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Row(
            children: [
              Icon(Icons.check_circle, color: Colors.white),
              SizedBox(width: 8),
              Expanded(
                child: SelectableText(
                  'Client information copied to clipboard',
                  style: TextStyle(color: Colors.white),
                  enableInteractiveSelection: true,
                ),
              ),
            ],
          ),
          backgroundColor: Colors.green,
          duration: const Duration(seconds: 2),
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
}

class _InfoRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;

  const _InfoRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 20, color: Colors.grey[600]),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: TextStyle(
                  fontSize: 12,
                  color: Colors.grey[600],
                ),
              ),
              const SizedBox(height: 4),
              Text(
                value,
                style: const TextStyle(
                  fontSize: 16,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

