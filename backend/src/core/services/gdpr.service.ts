import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';
import { Client } from '../../entities/client.entity';
import { Invoice } from '../../entities/invoice.entity';
import { AuditLog } from '../../entities/audit-log.entity';
import { EncryptionService } from './encryption.service';

@Injectable()
export class GdprService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Client)
    private clientRepository: Repository<Client>,
    @InjectRepository(Invoice)
    private invoiceRepository: Repository<Invoice>,
    @InjectRepository(AuditLog)
    private auditLogRepository: Repository<AuditLog>,
    private encryptionService: EncryptionService,
  ) {}

  /**
   * Export all user data in GDPR-compliant format
   */
  async exportUserData(userId: string): Promise<{
    user: any;
    clients: any[];
    invoices: any[];
    auditLogs: any[];
    exportedAt: string;
  }> {
    // Get user
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    // Get all clients (decrypt sensitive fields)
    const clients = await this.clientRepository.find({
      where: { userId, deletedAt: null },
    });
    const decryptedClients = clients.map((client) =>
      this.encryptionService.decryptFields(client, ['email', 'phone', 'notes']),
    );

    // Get all invoices
    const invoices = await this.invoiceRepository.find({
      where: { userId, deletedAt: null },
      relations: ['client', 'items'],
    });

    // Get audit logs
    const auditLogs = await this.auditLogRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 1000, // Limit to last 1000 logs
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        companyName: user.companyName,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      clients: decryptedClients.map((client) => ({
        id: client.id,
        name: client.name,
        email: client.email,
        phone: client.phone,
        addressJson: client.addressJson,
        notes: client.notes,
        tagsJson: client.tagsJson,
        createdAt: client.createdAt,
        updatedAt: client.updatedAt,
      })),
      invoices: invoices.map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        type: invoice.type,
        status: invoice.status,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        currency: invoice.currency,
        subtotal: invoice.subtotal,
        taxTotal: invoice.taxTotal,
        discountTotal: invoice.discountTotal,
        total: invoice.total,
        notes: invoice.notes,
        items: invoice.items ? invoice.items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxRate: item.taxRate,
          discountRate: item.discountRate,
          lineTotal: item.lineTotal,
        })) : [],
        clientId: invoice.clientId,
        createdAt: invoice.createdAt,
        updatedAt: invoice.updatedAt,
      })),
      auditLogs: auditLogs.map((log) => ({
        id: log.id,
        action: log.action,
        resource: log.resource,
        resourceId: log.resourceId,
        metadataJson: log.metadataJson,
        ipAddress: log.ipAddress,
        createdAt: log.createdAt,
      })),
      exportedAt: new Date().toISOString(),
    };
  }

  /**
   * Delete all user data (GDPR right to be forgotten)
   */
  async deleteUserData(userId: string): Promise<void> {
    // Soft delete all clients
    await this.clientRepository.update(
      { userId },
      { deletedAt: new Date() },
    );

    // Soft delete all invoices
    await this.invoiceRepository.update(
      { userId },
      { deletedAt: new Date() },
    );

    // Delete audit logs (hard delete for privacy)
    await this.auditLogRepository.delete({ userId });

    // Soft delete user account (remove deletedAt if User entity doesn't have it)
    await this.userRepository.update(
      { id: userId },
      { 
        email: `deleted_${Date.now()}@deleted.local`,
        name: 'Deleted User',
        passwordHash: '', // Clear password
        // deletedAt: new Date(), // Remove if User entity doesn't have this field
      },
    );
  }
}

