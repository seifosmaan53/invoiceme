import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiCreatedResponse, ApiBearerAuth } from '@nestjs/swagger';
import { InvoiceTemplatesService } from './invoice-templates.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Invoice Templates')
@ApiBearerAuth('JWT-auth')
@Controller('v1/invoice-templates')
@UseGuards(JwtAuthGuard)
export class InvoiceTemplatesController {
  constructor(private readonly templatesService: InvoiceTemplatesService) {}

  @Get()
  @ApiOperation({ summary: 'List all invoice templates' })
  @ApiOkResponse({ description: 'List of templates' })
  async findAll(@CurrentUser() user: any) {
    return this.templatesService.findAll(user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a template by ID' })
  @ApiOkResponse({ description: 'Template retrieved successfully' })
  async findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.templatesService.findOne(id, user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new template' })
  @ApiCreatedResponse({ description: 'Template created successfully' })
  async create(
    @Body() body: {
      name: string;
      description?: string;
      type: string;
      currency: string;
      defaultDueDays: number;
      lineItemsJson: any[];
      notes?: string;
    },
    @CurrentUser() user: any,
  ) {
    return this.templatesService.create(
      user.userId,
      body.name,
      body.description || '',
      body.type,
      body.currency,
      body.defaultDueDays,
      body.lineItemsJson,
      body.notes,
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a template' })
  @ApiOkResponse({ description: 'Template updated successfully' })
  async update(
    @Param('id') id: string,
    @Body() body: Partial<any>,
    @CurrentUser() user: any,
  ) {
    return this.templatesService.update(id, user.userId, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a template' })
  @ApiOkResponse({ description: 'Template deleted successfully' })
  async delete(@Param('id') id: string, @CurrentUser() user: any) {
    await this.templatesService.delete(id, user.userId);
    return { success: true };
  }
}

