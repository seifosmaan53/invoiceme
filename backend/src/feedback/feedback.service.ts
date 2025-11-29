import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Feedback } from '../entities/feedback.entity';

@Injectable()
export class FeedbackService {
  constructor(
    @InjectRepository(Feedback)
    private feedbackRepository: Repository<Feedback>,
  ) {}

  async create(
    userId: string,
    message: string,
    context?: string,
    rating?: number,
  ): Promise<Feedback> {
    const feedback = this.feedbackRepository.create({
      userId,
      message,
      context,
      rating,
    });

    return this.feedbackRepository.save(feedback);
  }

  async findAll(userId?: string): Promise<Feedback[]> {
    if (userId) {
      return this.feedbackRepository.find({
        where: { userId },
        order: { createdAt: 'DESC' },
      });
    }
    return this.feedbackRepository.find({
      order: { createdAt: 'DESC' },
    });
  }
}
