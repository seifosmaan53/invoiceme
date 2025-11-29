import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as AWS from 'aws-sdk';

@Injectable()
export class S3Service {
  private s3: AWS.S3;
  private bucket: string;
  private endpoint: string;

  constructor(private configService: ConfigService) {
    this.endpoint = this.configService.get('S3_ENDPOINT');
    this.bucket = this.configService.get('S3_BUCKET');
    
    this.s3 = new AWS.S3({
      endpoint: this.endpoint,
      region: this.configService.get('S3_REGION'),
      accessKeyId: this.configService.get('S3_ACCESS_KEY_ID'),
      secretAccessKey: this.configService.get('S3_SECRET_ACCESS_KEY'),
      s3ForcePathStyle: true,
    });
  }

  /**
   * Upload a file to S3
   * @param key S3 object key (path)
   * @param buffer File buffer
   * @param contentType MIME type
   * @param isPublic Whether file should be publicly accessible (default: false for security)
   * @returns URL of uploaded file (public URL if isPublic=true, otherwise returns key for signed URL generation)
   */
  async uploadFile(key: string, buffer: Buffer, contentType: string, isPublic: boolean = false): Promise<string> {
    const params: AWS.S3.PutObjectRequest = {
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      // Security: Don't make files public by default
      ACL: isPublic ? 'public-read' : 'private',
    };

    await this.s3.putObject(params).promise();
    
    // Return public URL only if explicitly set to public
    if (isPublic) {
      if (this.endpoint.includes('localhost') || this.endpoint.includes('127.0.0.1')) {
        // Local/MinIO setup
        return `${this.endpoint}/${this.bucket}/${key}`;
      } else {
        // AWS S3 or other S3-compatible
        return `https://${this.bucket}.s3.${this.configService.get('S3_REGION')}.amazonaws.com/${key}`;
      }
    }
    
    // For private files, return the key (caller should use getSignedUrl for access)
    return key;
  }

  /**
   * Delete a file from S3
   * @param key S3 object key (path)
   */
  async deleteFile(key: string): Promise<void> {
    const params: AWS.S3.DeleteObjectRequest = {
      Bucket: this.bucket,
      Key: key,
    };

    await this.s3.deleteObject(params).promise();
  }

  /**
   * Get a pre-signed URL for temporary access
   * @param key S3 object key (path)
   * @param expiresIn Expiration time in seconds (default: 1 hour)
   * @returns Pre-signed URL
   */
  getSignedUrl(key: string, expiresIn: number = 3600): string {
    return this.s3.getSignedUrl('getObject', {
      Bucket: this.bucket,
      Key: key,
      Expires: expiresIn,
    });
  }

  /**
   * Get public URL for a file
   * @param key S3 object key (path)
   * @returns Public URL (with CDN if configured)
   */
  getPublicUrl(key: string): string {
    const cdnBaseUrl = this.configService.get<string>('CDN_BASE_URL');
    
    // Use CDN if configured
    if (cdnBaseUrl) {
      return `${cdnBaseUrl}/${key}`;
    }
    
    // Fallback to S3 URL
    if (this.endpoint.includes('localhost') || this.endpoint.includes('127.0.0.1')) {
      return `${this.endpoint}/${this.bucket}/${key}`;
    } else {
      return `https://${this.bucket}.s3.${this.configService.get('S3_REGION')}.amazonaws.com/${key}`;
    }
  }

  /**
   * Get CDN URL for a file (if CDN is configured)
   * @param key S3 object key (path)
   * @returns CDN URL or null if CDN not configured
   */
  getCdnUrl(key: string): string | null {
    const cdnBaseUrl = this.configService.get<string>('CDN_BASE_URL');
    return cdnBaseUrl ? `${cdnBaseUrl}/${key}` : null;
  }
}

