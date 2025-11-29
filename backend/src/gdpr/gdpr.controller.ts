import { Controller, Get, Delete, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiOkResponse, ApiNoContentResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GdprService } from '../core/services/gdpr.service';

@ApiTags('GDPR')
@ApiBearerAuth('JWT-auth')
@Controller('v1/gdpr')
@UseGuards(JwtAuthGuard)
export class GdprController {
  constructor(private readonly gdprService: GdprService) {}

  @Get('export')
  @ApiOperation({ summary: 'Export all user data (GDPR)' })
  @ApiOkResponse({ description: 'User data exported successfully' })
  async exportData(@Req() req: any) {
    const userId = req.user.userId || req.user.id;
    return this.gdprService.exportUserData(userId);
  }

  @Delete('delete')
  @ApiOperation({ summary: 'Delete all user data (GDPR Right to be Forgotten)' })
  @ApiNoContentResponse({ description: 'User data deleted successfully' })
  async deleteData(@Req() req: any) {
    const userId = req.user.userId || req.user.id;
    await this.gdprService.deleteUserData(userId);
    return { message: 'All user data has been deleted' };
  }
}

