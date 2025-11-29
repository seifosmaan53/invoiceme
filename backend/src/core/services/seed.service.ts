import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../../entities/user.entity';

/**
 * Seed Service - For creating initial/default data
 * 
 * ⚠️ CRITICAL SECURITY RULES:
 * 
 * 1. NEVER overwrite existing user passwords
 *    - Always check if user exists before creating
 *    - If user exists, skip creation entirely (don't update password)
 * 
 * 2. NEVER hash an already hashed password
 *    - Only hash plain text passwords
 *    - Use bcrypt.hash() for new passwords
 *    - Use bcrypt.compare() for verification
 * 
 * 3. NEVER run seed operations in production
 *    - Only use for development/testing
 *    - Add environment checks before seeding
 * 
 * Example safe pattern:
 * ```typescript
 * async seedAdmin() {
 *   const existing = await this.userRepository.findOne({ 
 *     where: { email: 'admin@example.com' } 
 *   });
 *   
 *   if (existing) {
 *     // User exists - DO NOT overwrite password
 *     return;
 *   }
 *   
 *   // Only create if user doesn't exist
 *   const hash = await bcrypt.hash('ChangeMe123!', 10);
 *   const admin = this.userRepository.create({
 *     email: 'admin@example.com',
 *     passwordHash: hash, // Hashed once, never re-hashed
 *     name: 'Admin User',
 *   });
 *   await this.userRepository.save(admin);
 * }
 * ```
 */
@Injectable()
export class SeedService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /**
   * Example: Seed admin user (only if doesn't exist)
   * 
   * This is a template - modify as needed but ALWAYS follow the pattern:
   * 1. Check if user exists
   * 2. If exists, return (don't overwrite)
   * 3. If not exists, create with hashed password
   */
  async seedAdmin(): Promise<void> {
    const adminEmail = 'admin@invoiceme.app';
    
    // CRITICAL: Always check if user exists first
    const existing = await this.userRepository.findOne({
      where: { email: adminEmail },
    });

    if (existing) {
      // User exists - DO NOT overwrite password or any other data
      // This ensures passwords persist across backend restarts
      console.log(`⚠️  Admin user ${adminEmail} already exists. Skipping seed to preserve password.`);
      return;
    }

    // Only create if user doesn't exist
    // Hash password once - never hash an already hashed password
    const passwordHash = await bcrypt.hash('ChangeMe123!', 10);

    const admin = this.userRepository.create({
      email: adminEmail,
      passwordHash, // Stored as hash, never re-hashed
      name: 'Admin User',
      companyName: 'InvoiceMe',
    });

    await this.userRepository.save(admin);
    console.log(`✅ Admin user ${adminEmail} created successfully.`);
  }

  /**
   * Seed multiple default users (only if they don't exist)
   * 
   * Follows the same safe pattern: check first, create only if missing
   */
  async seedDefaultUsers(): Promise<void> {
    const defaultUsers = [
      {
        email: 'admin@invoiceme.app',
        password: 'ChangeMe123!',
        name: 'Admin User',
        companyName: 'InvoiceMe',
      },
      // Add more default users here if needed
    ];

    for (const userData of defaultUsers) {
      // CRITICAL: Always check if user exists first
      const existing = await this.userRepository.findOne({
        where: { email: userData.email },
      });

      if (existing) {
        // User exists - skip to preserve password
        console.log(`⚠️  User ${userData.email} already exists. Skipping.`);
        continue;
      }

      // Only create if user doesn't exist
      const passwordHash = await bcrypt.hash(userData.password, 10);

      const user = this.userRepository.create({
        email: userData.email,
        passwordHash,
        name: userData.name,
        companyName: userData.companyName,
      });

      await this.userRepository.save(user);
      console.log(`✅ User ${userData.email} created successfully.`);
    }
  }
}

