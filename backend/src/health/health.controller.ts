import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Overall health check', description: 'Returns health status of all services' })
  @ApiResponse({
    status: 200,
    description: 'Health check endpoint',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ok', 'error'] },
        timestamp: { type: 'string' },
        uptime: { type: 'number' },
        database: { type: 'string', enum: ['connected', 'disconnected'] },
        cache: { type: 'string', enum: ['connected', 'disconnected'] },
        version: { type: 'string' },
        environment: { type: 'string' },
      },
    },
  })
  async check() {
    return this.healthService.check();
  }

  @Get('db')
  @ApiOperation({ summary: 'Database health check', description: 'Checks database connection status' })
  @ApiResponse({
    status: 200,
    description: 'Database health status',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ok', 'error'] },
        message: { type: 'string' },
      },
    },
  })
  async checkDatabase() {
    return this.healthService.checkDatabase();
  }

  @Get('cache')
  @ApiOperation({ summary: 'Cache health check', description: 'Checks cache (Redis) connection status' })
  @ApiResponse({
    status: 200,
    description: 'Cache health status',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ok', 'error'] },
        message: { type: 'string' },
      },
    },
  })
  async checkCache() {
    return this.healthService.checkCache();
  }
}

