import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiKey } from '../entities/api-key.entity';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import * as crypto from 'crypto';

@Injectable()
export class ApiKeysService {
  constructor(
    @InjectRepository(ApiKey)
    private apiKeyRepository: Repository<ApiKey>,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
  ) {}

  /**
   * Generate a new API key
   */
  async generateApiKey(
    userId: string,
    name: string,
    permissions: string[] = [],
    expiresAt?: Date,
  ): Promise<{ key: string; apiKey: ApiKey }> {
    // Generate secure random key
    const key = `sk_${crypto.randomBytes(32).toString('hex')}`;
    
    // Hash the key for storage
    const keyHash = crypto.createHash('sha256').update(key).digest('hex');

    const apiKey = this.apiKeyRepository.create({
      userId,
      name,
      keyHash,
      permissionsJson: permissions,
      expiresAt,
      isActive: true,
    });

    await this.apiKeyRepository.save(apiKey);

    return { key, apiKey };
  }

  /**
   * Validate API key with rate limiting
   */
  async validateApiKey(key: string): Promise<ApiKey | null> {
    const keyHash = crypto.createHash('sha256').update(key).digest('hex');
    
    // Check cache first for performance
    const cacheKey = `api_key:${keyHash}`;
    const cached = await this.cacheManager.get<ApiKey>(cacheKey);
    if (cached) {
      // Still check expiration
      if (cached.expiresAt && new Date(cached.expiresAt) < new Date()) {
        await this.cacheManager.del(cacheKey);
        return null;
      }
      return cached;
    }
    
    const apiKey = await this.apiKeyRepository.findOne({
      where: { keyHash, isActive: true },
      relations: ['user'],
    });

    if (!apiKey) {
      return null;
    }

    // Check expiration
    if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
      return null;
    }

    // Check rate limit
    const rateLimitKey = `api_key_rate:${apiKey.id}`;
    const requestCount = await this.cacheManager.get<number>(rateLimitKey) || 0;
    const maxRequests = 1000; // 1000 requests per window
    const windowMs = 60 * 1000; // 1 minute window

    if (requestCount >= maxRequests) {
      throw new ForbiddenException('API key rate limit exceeded. Please try again later.');
    }

    // Increment rate limit counter
    await this.cacheManager.set(rateLimitKey, requestCount + 1, windowMs);

    // Update last used (but don't block on this)
    apiKey.lastUsedAt = new Date();
    this.apiKeyRepository.save(apiKey).catch(() => {
      // Ignore save errors for last used update
    });

    // Cache the API key for 5 minutes
    await this.cacheManager.set(cacheKey, apiKey, 300);

    return apiKey;
  }

  /**
   * Check if API key has permission
   */
  hasPermission(apiKey: ApiKey, permission: string): boolean {
    // If no permissions specified, allow all (backward compatibility)
    if (!apiKey.permissionsJson || apiKey.permissionsJson.length === 0) {
      return true;
    }

    // Check for exact permission
    if (apiKey.permissionsJson.includes(permission)) {
      return true;
    }

    // Check for wildcard permissions (e.g., "read:*" matches "read:invoices")
    const [action] = permission.split(':');
    const wildcardPermission = `${action}:*`;
    if (apiKey.permissionsJson.includes(wildcardPermission)) {
      return true;
    }

    // Check for full wildcard
    if (apiKey.permissionsJson.includes('*')) {
      return true;
    }

    return false;
  }

  /**
   * Get API key usage statistics
   */
  async getUsageStats(apiKeyId: string, userId: string): Promise<{
    totalRequests: number;
    requestsLast24h: number;
    requestsLast7d: number;
    requestsLast30d: number;
    lastUsedAt: Date | null;
  }> {
    const apiKey = await this.apiKeyRepository.findOne({
      where: { id: apiKeyId, userId },
    });

    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }

    // Get rate limit counters from cache
    const rateLimitKey = `api_key_rate:${apiKeyId}`;
    const currentRequests = (await this.cacheManager.get<number>(rateLimitKey)) || 0;

    // For now, return basic stats
    // In a production system, you'd want to log requests to a separate table
    return {
      totalRequests: currentRequests, // This is approximate
      requestsLast24h: currentRequests,
      requestsLast7d: currentRequests,
      requestsLast30d: currentRequests,
      lastUsedAt: apiKey.lastUsedAt || null,
    };
  }

  /**
   * List all API keys for a user
   */
  async findAll(userId: string): Promise<ApiKey[]> {
    return this.apiKeyRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Revoke API key
   */
  async revoke(id: string, userId: string): Promise<void> {
    const apiKey = await this.apiKeyRepository.findOne({
      where: { id, userId },
    });

    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }

    apiKey.isActive = false;
    await this.apiKeyRepository.save(apiKey);
  }

  /**
   * Delete API key
   */
  async delete(id: string, userId: string): Promise<void> {
    const apiKey = await this.apiKeyRepository.findOne({
      where: { id, userId },
    });

    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }

    await this.apiKeyRepository.remove(apiKey);
  }
}

