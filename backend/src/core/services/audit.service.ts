import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog, AuditAction, AuditResource } from '../../entities/audit-log.entity';

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private auditLogRepository: Repository<AuditLog>,
  ) {}

  /**
   * Log an audit event
   */
  async log(
    userId: string,
    action: AuditAction,
    resource: AuditResource,
    resourceId: string,
    metadata?: Record<string, any>,
    ipAddress?: string,
  ): Promise<AuditLog> {
    const auditLog = this.auditLogRepository.create({
      userId,
      action,
      resource,
      resourceId,
      metadataJson: metadata || {},
      ipAddress,
    });

    return this.auditLogRepository.save(auditLog);
  }

  /**
   * Find audit logs for a user
   */
  async findByUserId(userId: string, limit: number = 100): Promise<AuditLog[]> {
    return this.auditLogRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Find audit logs for a resource
   */
  async findByResource(
    resource: AuditResource,
    resourceId: string,
    limit: number = 100,
  ): Promise<AuditLog[]> {
    return this.auditLogRepository.find({
      where: { resource, resourceId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
