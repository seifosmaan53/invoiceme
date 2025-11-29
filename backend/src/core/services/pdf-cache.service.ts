import { Injectable } from '@nestjs/common';
import * as puppeteer from 'puppeteer';
import { Browser } from 'puppeteer';
import { CacheService } from './cache.service';

@Injectable()
export class PdfCacheService {
  private browserInstance: Browser | null = null;
  private readonly templateCache = new Map<string, string>();

  constructor(private cacheService: CacheService) {}

  /**
   * Get or create browser instance (reuse for performance)
   */
  async getBrowser(): Promise<Browser> {
    if (!this.browserInstance) {
      this.browserInstance = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage', // Overcome limited resource problems
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
        ],
      });
    }
    return this.browserInstance;
  }

  /**
   * Close browser instance
   */
  async closeBrowser(): Promise<void> {
    if (this.browserInstance) {
      await this.browserInstance.close();
      this.browserInstance = null;
    }
  }

  /**
   * Get cached template or load from file
   */
  async getTemplate(templatePath: string, fallbackTemplate: () => string): Promise<string> {
    const cacheKey = `pdf:template:${templatePath}`;
    
    // Try cache first
    const cached = await this.cacheService.get<string>(cacheKey);
    if (cached) {
      return cached;
    }

    // Try memory cache
    if (this.templateCache.has(templatePath)) {
      return this.templateCache.get(templatePath)!;
    }

    // Load template (from file or fallback)
    let template: string;
    try {
      const fs = require('fs');
      template = fs.readFileSync(templatePath, 'utf-8');
    } catch (error) {
      template = fallbackTemplate();
    }

    // Cache in memory and Redis
    this.templateCache.set(templatePath, template);
    await this.cacheService.set(cacheKey, template, 3600); // Cache for 1 hour

    return template;
  }

  /**
   * Pre-render and cache template with common data
   */
  async preRenderTemplate(template: string, commonData: Record<string, any>): Promise<string> {
    // Replace common placeholders
    let rendered = template;
    for (const [key, value] of Object.entries(commonData)) {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      rendered = rendered.replace(regex, String(value));
    }
    return rendered;
  }
}

