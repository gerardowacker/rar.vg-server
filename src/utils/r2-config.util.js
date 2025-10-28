const config = require('./config.util');
const logger = require('./logger.util');

/**
 * R2 Configuration Utility
 * Handles Cloudflare R2 configuration validation and setup
 */
class R2Config {
    constructor() {
        this.accountId = config('R2_ACCOUNT_ID');
        this.accessKeyId = config('R2_ACCESS_KEY_ID');
        this.secretAccessKey = config('R2_SECRET_ACCESS_KEY');
        this.bucketName = config('R2_BUCKET_NAME');
        this.endpoint = config('R2_ENDPOINT');
        this.storageMode = config('STORAGE_MODE') || 'hybrid';
        
        this.isValid = this.validateConfiguration();
    }

    /**
     * Validate R2 configuration
     * @returns {boolean} True if configuration is valid
     */
    validateConfiguration() {
        const requiredFields = [
            { key: 'R2_ACCOUNT_ID', value: this.accountId },
            { key: 'R2_ACCESS_KEY_ID', value: this.accessKeyId },
            { key: 'R2_SECRET_ACCESS_KEY', value: this.secretAccessKey },
            { key: 'R2_BUCKET_NAME', value: this.bucketName }
        ];

        const missingFields = requiredFields.filter(field => !field.value || field.value.trim() === '');

        if (missingFields.length > 0) {
            const missingFieldNames = missingFields.map(field => field.key).join(', ');
            logger.warn(`R2 configuration incomplete. Missing fields: ${missingFieldNames}`);
            logger.warn('Falling back to local storage mode');
            return false;
        }

        // Validate storage mode
        const validStorageModes = ['hybrid', 'r2-only', 'local-only'];
        if (!validStorageModes.includes(this.storageMode)) {
            logger.warn(`Invalid STORAGE_MODE: ${this.storageMode}. Using 'hybrid' as default`);
            this.storageMode = 'hybrid';
        }

        logger.info('R2 configuration validated successfully');
        logger.info(`Storage mode: ${this.storageMode}`);
        return true;
    }

    /**
     * Get R2 client configuration
     * @returns {Object} AWS SDK S3 client configuration
     */
    getClientConfig() {
        if (!this.isValid) {
            throw new Error('R2 configuration is invalid. Cannot create client configuration.');
        }

        const clientConfig = {
            region: 'auto',
            credentials: {
                accessKeyId: this.accessKeyId,
                secretAccessKey: this.secretAccessKey
            }
        };

        // Add custom endpoint if provided
        if (this.endpoint && this.endpoint.trim() !== '') {
            clientConfig.endpoint = this.endpoint;
        } else {
            // Default R2 endpoint format
            clientConfig.endpoint = `https://${this.accountId}.r2.cloudflarestorage.com`;
        }

        return clientConfig;
    }

    /**
     * Get bucket name
     * @returns {string} R2 bucket name
     */
    getBucketName() {
        return this.bucketName;
    }

    /**
     * Get storage mode
     * @returns {string} Current storage mode
     */
    getStorageMode() {
        return this.storageMode;
    }

    /**
     * Check if R2 is enabled
     * @returns {boolean} True if R2 should be used
     */
    isR2Enabled() {
        return this.isValid && (this.storageMode === 'hybrid' || this.storageMode === 'r2-only');
    }

    /**
     * Check if local storage is enabled
     * @returns {boolean} True if local storage should be used
     */
    isLocalStorageEnabled() {
        return this.storageMode === 'hybrid' || this.storageMode === 'local-only' || !this.isValid;
    }

    /**
     * Log configuration status
     */
    logConfigurationStatus() {
        logger.info('=== R2 Configuration Status ===');
        logger.info(`Account ID: ${this.accountId ? '[SET]' : '[NOT SET]'}`);
        logger.info(`Access Key ID: ${this.accessKeyId ? '[SET]' : '[NOT SET]'}`);
        logger.info(`Secret Access Key: ${this.secretAccessKey ? '[SET]' : '[NOT SET]'}`);
        logger.info(`Bucket Name: ${this.bucketName || '[NOT SET]'}`);
        logger.info(`Endpoint: ${this.endpoint || '[DEFAULT]'}`);
        logger.info(`Storage Mode: ${this.storageMode}`);
        logger.info(`R2 Enabled: ${this.isR2Enabled()}`);
        logger.info(`Local Storage Enabled: ${this.isLocalStorageEnabled()}`);
        logger.info(`Configuration Valid: ${this.isValid}`);
        logger.info('===============================');
    }
}

module.exports = R2Config;