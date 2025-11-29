import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from '../entities/client.entity';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';
import { PaginatedResponse, PaginationDto } from '../core/dto/pagination.dto';

@Injectable()
export class ClientsService {
  constructor(
    @InjectRepository(Client)
    private clientRepository: Repository<Client>,
  ) {}

  async findAll(
    userId: string, 
    pagination?: PaginationDto,
    tags?: string[],
    dateFrom?: string,
    dateTo?: string,
  ): Promise<PaginatedResponse<Client>> {
    const page = pagination?.page || 1;
    const limit = pagination?.limit || 20;
    const skip = (page - 1) * limit;
    const search = (pagination?.search || '').trim();

    const qb = this.clientRepository
      .createQueryBuilder('client')
      .where('client.userId = :userId', { userId })
      .andWhere('client.deletedAt IS NULL');

    // Filter by tags - client must have ALL specified tags
    if (tags && tags.length > 0) {
      // Normalize tags to lowercase for case-insensitive matching
      const normalizedTags = tags.map((tag) => tag.toLowerCase().trim()).filter((tag) => tag.length > 0);
      
      if (normalizedTags.length > 0) {
        // For each tag, ensure it exists in the client's tags_json
        // This ensures the client has ALL specified tags
        normalizedTags.forEach((tag, index) => {
          qb.andWhere(
            `EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(COALESCE(client.tags_json, '[]'::jsonb)) AS tag_elem
              WHERE LOWER(TRIM(tag_elem::text)) = LOWER(:tag${index})
            )`,
            { [`tag${index}`]: tag },
          );
        });
      }
    }

    // Filter by created date range
    if (dateFrom) {
      qb.andWhere('client.createdAt >= :dateFrom', { dateFrom });
    }

    if (dateTo) {
      qb.andWhere('client.createdAt <= :dateTo', { dateTo });
    }

    // Search functionality (searches name, email, phone, notes, and tags)
    if (search) {
      qb.andWhere(
        `(LOWER(client.name) LIKE :search
          OR LOWER(client.email) LIKE :search
          OR LOWER(client.phone) LIKE :search
          OR LOWER(COALESCE(client.notes, '')) LIKE :search
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(COALESCE(client.tags_json, '[]'::jsonb)) AS tag
            WHERE LOWER(tag::text) LIKE :search
          ))`,
        { search: `%${search.toLowerCase()}%` },
      );
    }

    qb.orderBy('client.createdAt', 'DESC')
      .skip(skip)
      .take(limit);

    const [clients, total] = await qb.getManyAndCount();

    return {
      data: clients,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string, userId: string): Promise<Client> {
    const client = await this.clientRepository.findOne({
      where: { id, deletedAt: null },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    // Role check: only owner can view
    if (client.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return client;
  }

  async create(createClientDto: CreateClientDto, userId: string): Promise<Client> {
    const { tags, address_json, ...rest } = createClientDto;
    const client = this.clientRepository.create({
      ...rest,
      addressJson: address_json, // map DTO -> entity
      tagsJson: tags || [],
      userId,
    });

    return this.clientRepository.save(client);
  }

  async update(id: string, updateClientDto: UpdateClientDto, userId: string): Promise<Client> {
    const client = await this.findOne(id, userId);

    const { tags, address_json, ...rest } = updateClientDto;
    Object.assign(client, rest);
    
    if (address_json !== undefined) {
      client.addressJson = address_json;
    }
    
    if (tags !== undefined) {
      client.tagsJson = tags;
    }
    
    return this.clientRepository.save(client);
  }

  async archive(id: string, userId: string): Promise<void> {
    const client = await this.findOne(id, userId);
    client.deletedAt = new Date();
    await this.clientRepository.save(client);
  }

  /**
   * Get all clients for export (no pagination)
   */
  async findAllForExport(userId: string): Promise<Client[]> {
    return this.clientRepository.find({
      where: { userId, deletedAt: null },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Bulk create clients from CSV data
   */
  async bulkCreate(userId: string, clientsData: CreateClientDto[]): Promise<Client[]> {
    const clients = clientsData.map((dto) => {
      const { tags, address_json, ...rest } = dto;
      return this.clientRepository.create({
        ...rest,
        addressJson: address_json,
        tagsJson: tags || [],
        userId,
      });
    });

    return this.clientRepository.save(clients);
  }

  /**
   * Bulk archive clients
   */
  async bulkArchive(userId: string, clientIds: string[]): Promise<number> {
    const result = await this.clientRepository
      .createQueryBuilder()
      .update(Client)
      .set({ deletedAt: new Date() })
      .where('id IN (:...ids)', { ids: clientIds })
      .andWhere('userId = :userId', { userId })
      .andWhere('deletedAt IS NULL')
      .execute();

    return result.affected || 0;
  }
}

