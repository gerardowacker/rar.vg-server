const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const R2Config = require('../utils/r2-config.util');
const logger = require('../utils/logger.util');

/**
 * R2StorageService - Handles all Cloudflare R2 storage operations
 * Provides methods for uploading, downloading, and managing files in R2 bucket
 */
class R2StorageService {
    constructor() {
        this.r2Config = new R2Config();
        this.s3Client = null;
        this.isConnected = false;
        
        // Initialize S3 client if R2 is enabled
        if (this.r2Config.isR2Enabled()) {
            this.initializeClient();
        } else {
            logger.warn('R2StorageService initialized but R2 is not enabled');
        }
    }

    /**
     * Initialize AWS S3 client for R2 operations
     * @private
     */
    initializeClient() {
        try {
            const clientConfig = this.r2Config.getClientConfig();
            this.s3Client = new S3Client(clientConfig);
            
            logger.info('R2 S3 client initialized successfully', {
                endpoint: clientConfig.endpoint,
                region: clientConfig.region,
                bucket: this.r2Config.getBucketName()
            });
            
        } catch (error) {
            logger.error('Failed to initialize R2 S3 client', {
                error: error.message,
                errorType: 'r2_client_init_error'
            });
            throw error;
        }
    }

    /**
     * Test connection to R2 service
     * @returns {Promise<boolean>} True if connection is successful
     */
    async checkConnection() {
        if (!this.s3Client) {
            logger.warn('Cannot check R2 connection - S3 client not initialized');
            return false;
        }

        try {
            // Try to list objects in the bucket (with limit 1 to minimize data transfer)
            const command = new HeadObjectCommand({
                Bucket: this.r2Config.getBucketName(),
                Key: 'connection-test' // This key doesn't need to exist
            });

            // We expect this to fail with NoSuchKey, but if it fails with other errors
            // like access denied or bucket not found, we know there's a connection issue
            try {
                await this.s3Client.send(command);
            } catch (error) {
                // NoSuchKey is expected and means connection is working
                if (error.name === 'NoSuchKey' || error.name === 'NotFound') {
                    this.isConnected = true;
                    logger.info('R2 connection test successful');
                    return true;
                }
                
                // Other errors indicate connection problems
                throw error;
            }

            // If we get here, the test key actually exists, which is fine
            this.isConnected = true;
            logger.info('R2 connection test successful');
            return true;

        } catch (error) {
            this.isConnected = false;
            logger.error('R2 connection test failed', {
                error: error.message,
                errorCode: error.name,
                errorType: 'r2_connection_error'
            });
            return false;
        }
    }

    /**
     * Validate R2 credentials and configuration
     * @returns {Promise<boolean>} True if credentials are valid
     */
    async validateCredentials() {
        if (!this.r2Config.isValid) {
            logger.error('R2 configuration is invalid', {
                errorType: 'r2_config_invalid'
            });
            return false;
        }

        if (!this.s3Client) {
            logger.error('R2 S3 client not initialized', {
                errorType: 'r2_client_not_initialized'
            });
            return false;
        }

        // Test connection to validate credentials
        const connectionResult = await this.checkConnection();
        
        if (connectionResult) {
            logger.info('R2 credentials validated successfully');
        } else {
            logger.error('R2 credential validation failed');
        }

        return connectionResult;
    }

    /**
     * Handle network errors and timeouts with retry logic
     * @param {Function} operation - The operation to retry
     * @param {number} maxRetries - Maximum number of retries
     * @param {number} baseDelay - Base delay in milliseconds
     * @returns {Promise<any>} Result of the operation
     * @private
     */
    async retryOperation(operation, maxRetries = 3, baseDelay = 1000) {
        let lastError;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                
                // Don't retry on certain error types
                const nonRetryableErrors = ['NoSuchKey', 'AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch'];
                if (nonRetryableErrors.includes(error.name)) {
                    throw error;
                }
                
                if (attempt === maxRetries) {
                    logger.error(`R2 operation failed after ${maxRetries} attempts`, {
                        error: error.message,
                        errorCode: error.name,
                        errorType: 'r2_operation_retry_exhausted'
                    });
                    throw error;
                }
                
                // Exponential backoff
                const delay = baseDelay * Math.pow(2, attempt - 1);
                logger.warn(`R2 operation failed, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`, {
                    error: error.message,
                    errorCode: error.name,
                    attempt,
                    maxRetries,
                    delay
                });
                
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        throw lastError;
    }

    /**
     * Get the connection status
     * @returns {boolean} True if connected to R2
     */
    isR2Available() {
        return this.isConnected && this.s3Client !== null && this.r2Config.isR2Enabled();
    }

    /**
     * Get R2 configuration status
     * @returns {Object} Configuration status information
     */
    getStatus() {
        return {
            isConfigured: this.r2Config.isValid,
            isConnected: this.isConnected,
            isAvailable: this.isR2Available(),
            storageMode: this.r2Config.getStorageMode(),
            bucketName: this.r2Config.getBucketName(),
            endpoint: this.r2Config.getClientConfig()?.endpoint || 'Not configured'
        };
    }

    /**
     * Generate user-specific folder path
     * @param {string} userId - User ID for folder organization
     * @param {boolean} isAvatar - Whether this is an avatar file
     * @returns {string} Folder path for the user
     * @private
     */
    getUserFolderPath(userId, isAvatar = false) {
        if (!userId) {
            throw new Error('User ID is required for file organization');
        }
        
        // For avatars, we use a standard filename within the user folder
        // For regular uploads, we'll append the original filename
        return `user-${userId}/`;
    }

    /**
     * Generate file key for R2 storage
     * @param {string} userId - User ID
     * @param {string} filename - Original filename
     * @param {boolean} isAvatar - Whether this is an avatar file
     * @returns {string} Complete file key for R2
     * @private
     */
    generateFileKey(userId, filename, isAvatar = false) {
        const folderPath = this.getUserFolderPath(userId, isAvatar);
        
        if (isAvatar) {
            // For avatars, use a standard filename
            return `${folderPath}avatar.png`;
        } else {
            // For regular uploads, preserve the original filename
            // Sanitize filename to prevent path traversal
            const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
            return `${folderPath}${sanitizedFilename}`;
        }
    }

    /**
     * Upload file to R2 storage
     * @param {string} userId - User ID for folder organization
     * @param {Buffer|Uint8Array|string} fileData - File data to upload
     * @param {string} filename - Original filename
     * @param {Object} options - Upload options
     * @param {boolean} options.isAvatar - Whether this is an avatar file
     * @param {string} options.contentType - MIME type of the file
     * @param {Object} options.metadata - Additional metadata
     * @returns {Promise<Object>} Upload result with file key and metadata
     */
    async uploadFile(userId, fileData, filename, options = {}) {
        if (!this.isR2Available()) {
            throw new Error('R2 storage is not available');
        }

        const { isAvatar = false, contentType = 'application/octet-stream', metadata = {} } = options;
        
        try {
            const fileKey = this.generateFileKey(userId, filename, isAvatar);
            
            // Prepare upload parameters
            const uploadParams = {
                Bucket: this.r2Config.getBucketName(),
                Key: fileKey,
                Body: fileData,
                ContentType: contentType,
                Metadata: {
                    userId: userId.toString(),
                    originalFilename: filename,
                    uploadDate: new Date().toISOString(),
                    isAvatar: isAvatar.toString(),
                    ...metadata
                }
            };

            // Add cache control for avatars (they change less frequently)
            if (isAvatar) {
                uploadParams.CacheControl = 'public, max-age=86400'; // 24 hours
            } else {
                uploadParams.CacheControl = 'public, max-age=3600'; // 1 hour
            }

            logger.info('Starting R2 file upload', {
                userId,
                filename,
                fileKey,
                isAvatar,
                contentType,
                fileSize: fileData.length
            });

            // Perform upload with retry logic
            const result = await this.retryOperation(async () => {
                const command = new PutObjectCommand(uploadParams);
                return await this.s3Client.send(command);
            });

            const uploadResult = {
                success: true,
                fileKey,
                userId,
                filename,
                isAvatar,
                contentType,
                size: fileData.length,
                uploadDate: new Date().toISOString(),
                etag: result.ETag,
                versionId: result.VersionId
            };

            logger.info('R2 file upload successful', {
                userId,
                filename,
                fileKey,
                size: fileData.length,
                etag: result.ETag
            });

            return uploadResult;

        } catch (error) {
            logger.error('R2 file upload failed', {
                userId,
                filename,
                isAvatar,
                error: error.message,
                errorCode: error.name,
                errorType: 'r2_upload_error'
            });
            throw error;
        }
    }

    /**
     * Upload avatar file with specific handling
     * @param {string} userId - User ID
     * @param {Buffer|Uint8Array} imageData - Avatar image data
     * @param {string} contentType - Image MIME type (default: image/png)
     * @returns {Promise<Object>} Upload result
     */
    async uploadAvatar(userId, imageData, contentType = 'image/png') {
        return await this.uploadFile(userId, imageData, 'avatar.png', {
            isAvatar: true,
            contentType,
            metadata: {
                fileType: 'avatar',
                processedDate: new Date().toISOString()
            }
        });
    }

    /**
     * Upload regular file (documents, images, etc.)
     * @param {string} userId - User ID
     * @param {Buffer|Uint8Array} fileData - File data
     * @param {string} filename - Original filename
     * @param {string} contentType - File MIME type
     * @param {Object} additionalMetadata - Additional metadata
     * @returns {Promise<Object>} Upload result
     */
    async uploadRegularFile(userId, fileData, filename, contentType, additionalMetadata = {}) {
        return await this.uploadFile(userId, fileData, filename, {
            isAvatar: false,
            contentType,
            metadata: {
                fileType: 'upload',
                ...additionalMetadata
            }
        });
    }

    /**
     * Check if file exists in R2
     * @param {string} userId - User ID
     * @param {string} filename - Filename to check
     * @param {boolean} isAvatar - Whether this is an avatar file
     * @returns {Promise<boolean>} True if file exists
     */
    async fileExists(userId, filename, isAvatar = false) {
        if (!this.isR2Available()) {
            return false;
        }

        try {
            const fileKey = this.generateFileKey(userId, filename, isAvatar);
            
            const command = new HeadObjectCommand({
                Bucket: this.r2Config.getBucketName(),
                Key: fileKey
            });

            await this.s3Client.send(command);
            return true;

        } catch (error) {
            if (error.name === 'NoSuchKey' || error.name === 'NotFound') {
                return false;
            }
            
            logger.error('Error checking file existence in R2', {
                userId,
                filename,
                isAvatar,
                error: error.message,
                errorCode: error.name,
                errorType: 'r2_file_check_error'
            });
            
            // On error, assume file doesn't exist to allow fallback
            return false;
        }
    }

    /**
     * Download file from R2 storage
     * @param {string} userId - User ID
     * @param {string} filename - Filename to download
     * @param {boolean} isAvatar - Whether this is an avatar file
     * @returns {Promise<Object>} File data and metadata
     */
    async downloadFile(userId, filename, isAvatar = false) {
        if (!this.isR2Available()) {
            throw new Error('R2 storage is not available');
        }

        try {
            const fileKey = this.generateFileKey(userId, filename, isAvatar);
            
            logger.debug('Starting R2 file download', {
                userId,
                filename,
                fileKey,
                isAvatar
            });

            const result = await this.retryOperation(async () => {
                const command = new GetObjectCommand({
                    Bucket: this.r2Config.getBucketName(),
                    Key: fileKey
                });
                return await this.s3Client.send(command);
            });

            // Convert stream to buffer
            const chunks = [];
            for await (const chunk of result.Body) {
                chunks.push(chunk);
            }
            const fileData = Buffer.concat(chunks);

            const downloadResult = {
                success: true,
                fileData,
                metadata: {
                    userId,
                    filename,
                    fileKey,
                    isAvatar,
                    contentType: result.ContentType,
                    contentLength: result.ContentLength,
                    lastModified: result.LastModified,
                    etag: result.ETag,
                    customMetadata: result.Metadata || {}
                }
            };

            logger.info('R2 file download successful', {
                userId,
                filename,
                fileKey,
                contentType: result.ContentType,
                size: result.ContentLength
            });

            return downloadResult;

        } catch (error) {
            if (error.name === 'NoSuchKey' || error.name === 'NotFound') {
                logger.debug('File not found in R2', {
                    userId,
                    filename,
                    isAvatar
                });
                throw new Error(`File not found: ${filename}`);
            }

            logger.error('R2 file download failed', {
                userId,
                filename,
                isAvatar,
                error: error.message,
                errorCode: error.name,
                errorType: 'r2_download_error'
            });
            throw error;
        }
    }

    /**
     * Get file stream from R2 (for efficient streaming to client)
     * @param {string} userId - User ID
     * @param {string} filename - Filename to stream
     * @param {boolean} isAvatar - Whether this is an avatar file
     * @returns {Promise<Object>} Stream and metadata
     */
    async getFileStream(userId, filename, isAvatar = false) {
        if (!this.isR2Available()) {
            throw new Error('R2 storage is not available');
        }

        try {
            const fileKey = this.generateFileKey(userId, filename, isAvatar);
            
            logger.debug('Starting R2 file stream', {
                userId,
                filename,
                fileKey,
                isAvatar
            });

            const result = await this.retryOperation(async () => {
                const command = new GetObjectCommand({
                    Bucket: this.r2Config.getBucketName(),
                    Key: fileKey
                });
                return await this.s3Client.send(command);
            });

            const streamResult = {
                success: true,
                stream: result.Body,
                metadata: {
                    userId,
                    filename,
                    fileKey,
                    isAvatar,
                    contentType: result.ContentType,
                    contentLength: result.ContentLength,
                    lastModified: result.LastModified,
                    etag: result.ETag,
                    customMetadata: result.Metadata || {}
                }
            };

            logger.info('R2 file stream initiated', {
                userId,
                filename,
                fileKey,
                contentType: result.ContentType,
                size: result.ContentLength
            });

            return streamResult;

        } catch (error) {
            if (error.name === 'NoSuchKey' || error.name === 'NotFound') {
                logger.debug('File not found in R2 for streaming', {
                    userId,
                    filename,
                    isAvatar
                });
                throw new Error(`File not found: ${filename}`);
            }

            logger.error('R2 file stream failed', {
                userId,
                filename,
                isAvatar,
                error: error.message,
                errorCode: error.name,
                errorType: 'r2_stream_error'
            });
            throw error;
        }
    }

    /**
     * Get avatar URL or data for a specific user
     * @param {string} userId - User ID
     * @param {boolean} returnStream - Whether to return stream instead of buffer
     * @returns {Promise<Object>} Avatar data or stream
     */
    async getAvatarUrl(userId, returnStream = false) {
        try {
            if (returnStream) {
                return await this.getFileStream(userId, 'avatar.png', true);
            } else {
                return await this.downloadFile(userId, 'avatar.png', true);
            }
        } catch (error) {
            // If avatar not found, this is not necessarily an error
            if (error.message.includes('File not found')) {
                logger.debug('Avatar not found in R2', { userId });
                return null;
            }
            throw error;
        }
    }

    /**
     * Delete file from R2 storage
     * @param {string} userId - User ID
     * @param {string} filename - Filename to delete
     * @param {boolean} isAvatar - Whether this is an avatar file
     * @returns {Promise<Object>} Deletion result
     */
    async deleteFile(userId, filename, isAvatar = false) {
        if (!this.isR2Available()) {
            throw new Error('R2 storage is not available');
        }

        try {
            const fileKey = this.generateFileKey(userId, filename, isAvatar);
            
            logger.info('Starting R2 file deletion', {
                userId,
                filename,
                fileKey,
                isAvatar
            });

            const result = await this.retryOperation(async () => {
                const command = new DeleteObjectCommand({
                    Bucket: this.r2Config.getBucketName(),
                    Key: fileKey
                });
                return await this.s3Client.send(command);
            });

            const deleteResult = {
                success: true,
                userId,
                filename,
                fileKey,
                isAvatar,
                deletedAt: new Date().toISOString(),
                versionId: result.VersionId
            };

            logger.info('R2 file deletion successful', {
                userId,
                filename,
                fileKey
            });

            return deleteResult;

        } catch (error) {
            logger.error('R2 file deletion failed', {
                userId,
                filename,
                isAvatar,
                error: error.message,
                errorCode: error.name,
                errorType: 'r2_delete_error'
            });
            throw error;
        }
    }

    /**
     * Get file metadata without downloading the file
     * @param {string} userId - User ID
     * @param {string} filename - Filename
     * @param {boolean} isAvatar - Whether this is an avatar file
     * @returns {Promise<Object>} File metadata
     */
    async getFileMetadata(userId, filename, isAvatar = false) {
        if (!this.isR2Available()) {
            throw new Error('R2 storage is not available');
        }

        try {
            const fileKey = this.generateFileKey(userId, filename, isAvatar);
            
            const result = await this.retryOperation(async () => {
                const command = new HeadObjectCommand({
                    Bucket: this.r2Config.getBucketName(),
                    Key: fileKey
                });
                return await this.s3Client.send(command);
            });

            const metadata = {
                userId,
                filename,
                fileKey,
                isAvatar,
                contentType: result.ContentType,
                contentLength: result.ContentLength,
                lastModified: result.LastModified,
                etag: result.ETag,
                customMetadata: result.Metadata || {}
            };

            logger.debug('R2 file metadata retrieved', {
                userId,
                filename,
                fileKey,
                contentType: result.ContentType,
                size: result.ContentLength
            });

            return metadata;

        } catch (error) {
            if (error.name === 'NoSuchKey' || error.name === 'NotFound') {
                logger.debug('File metadata not found in R2', {
                    userId,
                    filename,
                    isAvatar
                });
                return null;
            }

            logger.error('R2 file metadata retrieval failed', {
                userId,
                filename,
                isAvatar,
                error: error.message,
                errorCode: error.name,
                errorType: 'r2_metadata_error'
            });
            throw error;
        }
    }

    /**
     * Log current service status
     */
    logStatus() {
        const status = this.getStatus();
        logger.info('=== R2StorageService Status ===');
        logger.info(`Configured: ${status.isConfigured}`);
        logger.info(`Connected: ${status.isConnected}`);
        logger.info(`Available: ${status.isAvailable}`);
        logger.info(`Storage Mode: ${status.storageMode}`);
        logger.info(`Bucket: ${status.bucketName}`);
        logger.info(`Endpoint: ${status.endpoint}`);
        logger.info('==============================');
    }
}

module.exports = R2StorageService;