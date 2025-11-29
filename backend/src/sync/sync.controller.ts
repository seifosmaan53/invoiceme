import { Controller, Post, Get, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiBody } from '@nestjs/swagger';
import { SyncService, SyncPushDto } from './sync.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Sync')
@ApiBearerAuth()
@Controller('v1/sync')
@UseGuards(JwtAuthGuard)
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('push')
  @ApiOperation({ 
    summary: 'Push local changes to server', 
    description: 'Synchronizes local changes (creates, updates, deletes) to the server for offline-first mobile support. Use this when your mobile app has been offline and needs to sync changes back to the server.' 
  })
  @ApiBody({ 
    type: SyncPushDto,
    examples: {
      example1: {
        summary: 'Push client creation',
        value: {
          deviceId: 'mobile-device-abc123',
          changes: [
            {
              object_type: 'client',
              object_id: 'temp-id-123',
              change_type: 'create',
              data: { name: 'Acme Corp', email: 'contact@acme.com' },
              device_id: 'mobile-device-abc123',
              updated_at: '2025-11-23T10:00:00Z'
            }
          ]
        }
      }
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Changes pushed successfully', 
    schema: { 
      type: 'object', 
      properties: { 
        success: { type: 'boolean', example: true }, 
        synced: { type: 'number', example: 5 },
        conflicts: { type: 'number', example: 0 }
      } 
    } 
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async push(@Body() syncPushDto: SyncPushDto, @CurrentUser() user: any) {
    return this.syncService.pushChanges(user.userId, syncPushDto);
  }

  @Get('pull')
  @ApiOperation({ 
    summary: 'Pull changes from server', 
    description: 'Retrieves all changes from the server since a specific timestamp for offline-first mobile support. Use this to sync server changes to your mobile app.' 
  })
  @ApiQuery({ 
    name: 'since', 
    required: false, 
    type: String, 
    description: 'ISO timestamp to pull changes since (e.g., 2025-11-23T00:00:00Z). If not provided, returns all data.',
    example: '2025-11-23T00:00:00Z'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Changes retrieved successfully', 
    schema: { 
      type: 'object', 
      properties: { 
        clients: { type: 'array', description: 'List of clients' },
        invoices: { type: 'array', description: 'List of invoices' },
        invoiceItems: { type: 'array', description: 'List of invoice items' },
        attachments: { type: 'array', description: 'List of attachments' },
        lastSyncTimestamp: { type: 'string', description: 'ISO timestamp of last sync', example: '2025-11-23T10:00:00Z' }
      } 
    } 
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async pull(@Query('since') since: string, @CurrentUser() user: any) {
    return this.syncService.pullChanges(user.userId, since);
  }
}

