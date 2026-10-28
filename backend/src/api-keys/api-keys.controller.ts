import { Controller, Get, Post, Delete, Body, Param, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiCreatedResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ApiKeysService } from './api-keys.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('API Keys')
@ApiBearerAuth('JWT-auth')
@Controller('v1/api-keys')
@UseGuards(JwtAuthGuard)
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  @ApiOperation({ summary: 'Generate a new API key' })
  @ApiCreatedResponse({
    description: 'API key generated successfully',
    schema: {
      type: 'object',
      properties: {
        key: { type: 'string', example: 'sk_...' },
        apiKey: { type: 'object' },
      },
    },
  })
  async generate(
    @Body() body: { name: string; permissions?: string[]; expiresAt?: string },
    @CurrentUser() user: any,
  ) {
    const permissions = body.permissions;
    if (
      !Array.isArray(permissions) ||
      permissions.length === 0 ||
      !permissions.every((p) => typeof p === 'string' && p.trim() !== '')
    ) {
      throw new BadRequestException("Choose at least one permission; '*' grants full access");
    }
    return this.apiKeysService.generateApiKey(
      user.userId,
      body.name,
      permissions,
      body.expiresAt ? new Date(body.expiresAt) : undefined,
    );
  }

  @Get()
  @ApiOperation({ summary: 'List all API keys for current user' })
  @ApiOkResponse({ description: 'List of API keys' })
  async findAll(@CurrentUser() user: any) {
    return this.apiKeysService.findAll(user.userId);
  }

  @Get(':id/stats')
  @ApiOperation({ summary: 'Get usage statistics for an API key' })
  @ApiOkResponse({ description: 'API key usage statistics' })
  async getStats(@Param('id') id: string, @CurrentUser() user: any) {
    return this.apiKeysService.getUsageStats(id, user.userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revoke an API key' })
  @ApiOkResponse({ description: 'API key revoked successfully' })
  async revoke(@Param('id') id: string, @CurrentUser() user: any) {
    await this.apiKeysService.revoke(id, user.userId);
    return { success: true };
  }
}

