import { Controller, Post, Get, Body, Query, Param, ParseUUIDPipe, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiBody } from '@nestjs/swagger';
import { SyncService, SyncPushDto } from './sync.service';
import { SyncConflictsService, ResolveConflictDto } from './sync-conflicts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Sync')
@ApiBearerAuth()
@Controller('v1/sync')
@UseGuards(JwtAuthGuard)
export class SyncController {
  constructor(
    private readonly syncService: SyncService,
    private readonly conflictsService: SyncConflictsService,
  ) {}

  @Post('push')
  @HttpCode(HttpStatus.OK)
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
              change_id: '0f8fad5b-d9cb-469f-a165-70867728950e',
              object_type: 'client',
              object_id: '123e4567-e89b-12d3-a456-426614174000',
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
        protocol: { type: 'number', example: 2 },
        synced: { type: 'number', example: 2, description: 'applied + merged + duplicate' },
        failed: { type: 'number', example: 1, description: 'failed + conflict (not applied)' },
        results: {
          type: 'array',
          description: 'One entry per change, in request order. See docs/SYNC-CONTRACT.md.',
          items: {
            type: 'object',
            properties: {
              index: { type: 'number', example: 0 },
              change_id: { type: 'string', nullable: true, example: '0f8fad5b-d9cb-469f-a165-70867728950e' },
              object_type: { type: 'string', example: 'client' },
              object_id: { type: 'string', example: '123e4567-e89b-12d3-a456-426614174000' },
              status: { type: 'string', enum: ['applied', 'merged', 'duplicate', 'conflict', 'failed'] },
              reason: { type: 'string', nullable: true, example: 'client_upgrade_required' },
              conflict_id: { type: 'string', nullable: true },
              revision: { type: 'number', nullable: true, example: 4 },
            },
          },
        },
      },
    },
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
  @ApiQuery({ name: 'protocol', required: false, description: '2 = paged pull by cursor (recommended)', example: '2' })
  @ApiQuery({ name: 'cursor', required: false, description: 'Cursor from the previous response (protocol 2); omit for a full download' })
  @ApiQuery({ name: 'limit', required: false, description: 'Records per page, 1-1000 (protocol 2; default 500)' })
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
        tombstones: { type: 'array', description: 'Records deleted since `since`: {object_type, object_id, deleted_at}' },
        fullResyncRequired: { type: 'boolean', description: '`since` is older than the retained tombstones; resync from scratch' },
        openConflicts: { type: 'number', description: 'Open sync conflicts of this user' },
        lastSyncTimestamp: { type: 'string', description: 'ISO timestamp of last sync', example: '2025-11-23T10:00:00Z' }
      } 
    } 
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async pull(
    @Query('since') since: string,
    @Query('protocol') protocol: string,
    @Query('cursor') cursor: string,
    @Query('limit') limit: string,
    @CurrentUser() user: any,
  ) {
    // Protocol 2: paged pull by snapshot cursor, every committed change
    // delivered (docs/SYNC-CONTRACT.md "Delivery guarantee"). Older apps keep
    // the unpaged pull by timestamp they understand.
    if (protocol === '2' || cursor) {
      return this.syncService.pullByCursor(user.userId, cursor || undefined, limit ? Number(limit) : undefined);
    }
    return this.syncService.pullChanges(user.userId, since);
  }

  @Get('conflicts')
  @ApiOperation({ summary: 'List your sync conflicts', description: 'Offline changes that were not applied as sent. Open conflicts by default.' })
  @ApiQuery({ name: 'status', required: false, enum: ['open', 'all'] })
  async listConflicts(@Query('status') status: string, @CurrentUser() user: any) {
    return this.conflictsService.list(user.userId, status === 'all' ? 'all' : 'open');
  }

  @Get('conflicts/:id')
  @ApiOperation({ summary: 'One of your sync conflicts, with the record as it is now' })
  @ApiResponse({ status: 404, description: 'No such conflict for this user' })
  async getConflict(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.conflictsService.get(user.userId, id);
  }

  @Post('conflicts/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resolve one of your sync conflicts',
    description: 'Checks ownership, that the conflict is still open, and that the record is still at expected_revision.',
  })
  @ApiResponse({ status: 409, description: 'Already resolved, or the record changed since it was reviewed' })
  @ApiResponse({ status: 422, description: 'Not possible for a sent or paid invoice' })
  async resolveConflict(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveConflictDto, @CurrentUser() user: any) {
    return this.conflictsService.resolve(user.userId, id, dto);
  }
}
