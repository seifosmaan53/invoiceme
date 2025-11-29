import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserSettings } from '../entities/user-settings.entity';
import { UpdateUserSettingsDto } from './dto/user-settings.dto';

@Injectable()
export class UserSettingsService {
  constructor(
    @InjectRepository(UserSettings)
    private readonly userSettingsRepo: Repository<UserSettings>,
  ) {}

  /**
   * Find settings for user or create with defaults.
   */
  async getForUser(userId: string): Promise<UserSettings> {
    let settings = await this.userSettingsRepo.findOne({
      where: { userId },
    });

    if (!settings) {
      settings = this.userSettingsRepo.create({
        userId,
        pdfLogoUrl: null,
        pdfPrimaryColor: '#4a90e2',
        pdfSecondaryColor: '#333333',
        pdfFontFamily: 'Arial',
      });
      settings = await this.userSettingsRepo.save(settings);
    }

    return settings;
  }

  /**
   * Update settings for user (creates row if missing).
   */
  async updateForUser(
    userId: string,
    dto: UpdateUserSettingsDto,
  ): Promise<UserSettings> {
    const existing = await this.getForUser(userId);

    // Only update fields that are provided
    if (dto.pdfLogoUrl !== undefined) {
      existing.pdfLogoUrl = dto.pdfLogoUrl || null;
    }
    if (dto.pdfPrimaryColor !== undefined) {
      existing.pdfPrimaryColor = dto.pdfPrimaryColor;
    }
    if (dto.pdfSecondaryColor !== undefined) {
      existing.pdfSecondaryColor = dto.pdfSecondaryColor;
    }
    if (dto.pdfFontFamily !== undefined) {
      existing.pdfFontFamily = dto.pdfFontFamily;
    }

    return this.userSettingsRepo.save(existing);
  }
}

