import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCreatedResponse, ApiBearerAuth } from '@nestjs/swagger';
import { FeedbackService } from './feedback.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Feedback')
@ApiBearerAuth('JWT-auth')
@Controller('v1/feedback')
@UseGuards(JwtAuthGuard)
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  @ApiOperation({ summary: 'Submit feedback' })
  @ApiCreatedResponse({ description: 'Feedback submitted successfully' })
  async submit(
    @Body() body: { message: string; context?: string; rating?: number },
    @CurrentUser() user: any,
  ) {
    return this.feedbackService.create(
      user.userId,
      body.message,
      body.context,
      body.rating,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Get all feedback (admin only)' })
  async findAll(@CurrentUser() user: any) {
    return this.feedbackService.findAll(user.userId);
  }
}
