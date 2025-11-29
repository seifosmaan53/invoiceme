import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { UserSettingsService } from './user-settings.service';
import { UpdateUserSettingsDto } from './dto/user-settings.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserSettings } from '../entities/user-settings.entity';

@ApiTags('User Settings')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('v1/user-settings')
export class UserSettingsController {
  constructor(private readonly userSettingsService: UserSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get user PDF settings', description: 'Retrieves the current user\'s PDF customization settings. Creates default settings if none exist.' })
  @ApiOkResponse({
    description: 'User settings retrieved successfully',
    type: UserSettings,
  })
  async getUserSettings(@CurrentUser() user: any) {
    return this.userSettingsService.getForUser(user.userId);
  }

  @Patch()
  @ApiOperation({ summary: 'Update user PDF settings', description: 'Updates the user\'s PDF customization settings (logo, colors, font).' })
  @ApiOkResponse({
    description: 'Settings updated successfully',
    type: UserSettings,
  })
  async updateUserSettings(
    @CurrentUser() user: any,
    @Body() dto: UpdateUserSettingsDto,
  ) {
    return this.userSettingsService.updateForUser(user.userId, dto);
  }
}

