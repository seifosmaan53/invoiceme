import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import * as path from 'path';
import * as fs from 'fs';

export interface HealthStatus {
  status: 'ok' | 'error';
  timestamp: string;
  uptime: number;
  database: 'connected' | 'disconnected';
  cache: 'connected' | 'disconnected';
  version: string;
  environment: string;
}

@Injectable()
export class HealthService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  async check(): Promise<HealthStatus> {
    const timestamp = new Date().toISOString();
    const uptime = Math.floor(process.uptime());
    
    // Get version from package.json (works in both dev and production)
    let version = '1.0.0';
    try {
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      version = packageJson.version || '1.0.0';
    } catch (error) {
      // Fallback if package.json not found
      console.warn('Could not read package.json for version:', error);
    }
    
    const environment = this.configService.get<string>('NODE_ENV', 'development');

    // Check database connection
    let databaseStatus: 'connected' | 'disconnected' = 'disconnected';
    try {
      await this.dataSource.query('SELECT 1');
      databaseStatus = 'connected';
    } catch (error) {
      console.error('Database health check failed:', error);
      databaseStatus = 'disconnected';
    }

    // Check cache connection
    let cacheStatus: 'connected' | 'disconnected' = 'disconnected';
    try {
      await this.cacheManager.set('health-check', 'ok', 1);
      const value = await this.cacheManager.get('health-check');
      if (value === 'ok') {
        cacheStatus = 'connected';
        await this.cacheManager.del('health-check');
      }
    } catch (error) {
      console.error('Cache health check failed:', error);
      cacheStatus = 'disconnected';
    }

    const status: 'ok' | 'error' = 
      databaseStatus === 'connected' && cacheStatus === 'connected' ? 'ok' : 'error';

    return {
      status,
      timestamp,
      uptime,
      database: databaseStatus,
      cache: cacheStatus,
      version,
      environment,
    };
  }

  async checkDatabase(): Promise<{ status: 'ok' | 'error'; message: string }> {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'ok', message: 'Database is connected' };
    } catch (error) {
      return { status: 'error', message: `Database connection failed: ${error.message}` };
    }
  }

  async checkCache(): Promise<{ status: 'ok' | 'error'; message: string }> {
    try {
      await this.cacheManager.set('health-check', 'ok', 1);
      const value = await this.cacheManager.get('health-check');
      await this.cacheManager.del('health-check');
      if (value === 'ok') {
        return { status: 'ok', message: 'Cache is connected' };
      }
      return { status: 'error', message: 'Cache test failed' };
    } catch (error) {
      return { status: 'error', message: `Cache connection failed: ${error.message}` };
    }
  }
}

