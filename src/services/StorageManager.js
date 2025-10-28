const R2StorageService = require('./R2StorageService');
const LocalStorageService = require('./LocalStorageService');
const R2Config = require('../utils/r2-config.util');
const logger = require('../utils/logger.util');
const notificationManager = require('../utils/notification.util');

/**
 * StorageManager - Orchestrates between R2 and local storage
 * Implements hybrid storage logic with fallback capabilities
 */
class StorageManager {
    constructor() {
        this.r2Config = new R2Config();
        this.r2Storage = null;
        this.localStorage = null;
        this.r2Available = false;
        this.lastR2Check = null;
        this.r2CheckInterval = 60000; // Check R2 availability every 60 seconds
        this.locationCache = new Map(); // Cache storage locations for files
        
        this.initializeServices();
    }

    /**
     * Initialize storage services based on configuration
     * @private
     */
    initializeServices() {
        try {
            // Always initialize local storage as fallback
            this.localStorage = new LocalStorageService();
            logger.info('LocalStorageService initialized successfully');

            // Initialize R2 storage if enabled
            if (this.r2Config.isR2Enabled()) {
                this.r2Storage = new R2StorageService();
                logger.info('R2StorageService initialized successfully');
                
                // Check R2 availability asynchronously
                this.checkR2Availability().catch(error => {
                    logger.warn('Initial R2 availability check failed', {
                        error: error.message,
                        errorType: 'r2_initial_check_failed'
                    });
                });
            } else {
                logger.info('R2 storage disabled by configuration');
            }

            this.logStorageStatus();

        } catch (error) {
            logger.error('Failed to initialize storage services', {
                error: error.message,
                errorType: 'storage_manager_init_error'
            });
            
            // Ensure local storage is available as fallback
            if (!this.localStorage) {
                this.localStorage = new LocalStorageService();
                logger.info('Fallback to LocalStorageService only');
            }
        }
    }

    /**
     * Check R2 service availability with caching
     * @returns {Promise<boolean>} True if R2 is available
     */
    async isR2Available() {
        // Return cached result if check was recent
        if (this.lastR2Check && (Date.now() - this.lastR2Check) < this.r2CheckInterval) {
            return this.r2Available;
        }

        // If R2 is not configured, return false immediately
        if (!this.r2Storage || !this.r2Config.isR2Enabled()) {
            this.r2Available = false;
            this.lastR2Check = Date.now();
            return false;
        }

        const previousStatus = this.r2Available;
        const startTime = Date.now();

        try {
            // Perform actual availability check
            this.r2Available = await this.r2Storage.checkConnection();
            this.lastR2Check = Date.now();
            const responseTime = Date.now() - startTime;
            
            // Log availability check with metrics
            logger.logR2AvailabilityCheck(this.r2Available, responseTime, {
                previousStatus,
                checkInterval: this.r2CheckInterval
            });

            // Notify if availability status changed
            if (this.r2Available !== previousStatus) {
                notificationManager.notifyR2AvailabilityChange(this.r2Available, previousStatus, {
                    responseTime,
                    checkTimestamp: new Date(this.lastR2Check).toISOString()
                });
            }
            
            return this.r2Available;

        } catch (error) {
            this.r2Available = false;
            this.lastR2Check = Date.now();
            const responseTime = Date.now() - startTime;
            
            // Log availability check failure with metrics
            logger.logR2AvailabilityCheck(false, responseTime, {
                previousStatus,
                error: error.message,
                errorType: 'r2_availability_check_error'
            });

            // Notify if availability status changed (from available to unavailable)
            if (previousStatus !== false) {
                notificationManager.notifyR2AvailabilityChange(false, previousStatus, {
                    error: error.message,
                    responseTime,
                    checkTimestamp: new Date(this.lastR2Check).toISOString()
                });
            }
            
            return false;
        }
    }

    /**
     * Force refresh of R2 availability status
     * @returns {Promise<boolean>} True if R2 is available
     */
    async checkR2Availability() {
        this.lastR2Check = null; // Force fresh check
        return await this.isR2Available();
    }

    /**
     * Get current storage mode based on configuration and availability
     * @returns {string} Current effective storage mode
     */
    getEffectiveStorageMode() {
        const configMode = this.r2Config.getStorageMode();
        
        // If R2 is not available, force local-only mode
        if (!this.r2Available && (configMode === 'r2-only' || configMode === 'hybrid')) {
            return 'local-only';
        }
        
        return configMode;
    }

    /**
     * Determine which storage service to use for upload
     * @param {boolean} forceLocal - Force use of local storage
     * @returns {Promise<Object>} Storage service and mode information
     * @private
     */
    async determineUploadStorage(forceLocal = false) {
        const configMode = this.r2Config.getStorageMode();
        
        // Handle force local override
        if (forceLocal) {
            return {
                service: this.localStorage,
                mode: 'local',
                reason: 'forced_local'
            };
        }

        // Handle local-only mode
        if (configMode === 'local-only') {
            return {
                service: this.localStorage,
                mode: 'local',
                reason: 'config_local_only'
            };
        }

        // Check R2 availability for hybrid and r2-only modes
        const r2Available = await this.isR2Available();
        
        if (configMode === 'r2-only') {
            if (r2Available) {
                return {
                    service: this.r2Storage,
                    mode: 'r2',
                    reason: 'config_r2_only'
                };
            } else {
                throw new Error('R2 storage is not available and local storage is disabled');
            }
        }

        // Hybrid mode (default)
        if (r2Available) {
            return {
                service: this.r2Storage,
                mode: 'r2',
                reason: 'hybrid_r2_available'
            };
        } else {
            return {
                service: this.localStorage,
                mode: 'local',
                reason: 'hybrid_r2_unavailable'
            };
        }
    }

    /**
     * Cache file location for faster retrieval
     * @param {string} userId - User ID
     * @param {string} filename - Filename
     * @param {boolean} isAvatar - Whether this is an avatar file
     * @param {string} location - Storage location ('r2' or 'local')
     * @private
     */
    cacheFileLocation(userId, filename, isAvatar, location) {
        const cacheKey = `${userId}:${filename}:${isAvatar}`;
        this.locationCache.set(cacheKey, {
            location,
            timestamp: Date.now()
        });
        
        // Limit cache size (keep last 1000 entries)
        if (this.locationCache.size > 1000) {
            const firstKey = this.locationCache.keys().next().value;
            this.locationCache.delete(firstKey);
        }
    }

    /**
     * Get cached file location
     * @param {string} userId - User ID
     * @param {string} filename - Filename
     * @param {boolean} isAvatar - Whether this is an avatar file
     * @returns {string|null} Cached location or null if not cached/expired
     * @private
     */
    getCachedFileLocation(userId, filename, isAvatar) {
        const cacheKey = `${userId}:${filename}:${isAvatar}`;
        const cached = this.locationCache.get(cacheKey);
        
        if (!cached) {
            return null;
        }
        
        // Cache expires after 5 minutes
        if (Date.now() - cached.timestamp > 300000) {
            this.locationCache.delete(cacheKey);
            return null;
        }
        
        return cached.location;
    }

    /**
     * Get comprehensive storage status
     * @returns {Object} Complete storage status information
     */
    getStorageStatus() {
        return {
            configMode: this.r2Config.getStorageMode(),
            effectiveMode: this.getEffectiveStorageMode(),
            r2: {
                configured: this.r2Config.isR2Enabled(),
                available: this.r2Available,
                lastCheck: this.lastR2Check,
                service: this.r2Storage ? this.r2Storage.getStatus() : null
            },
            local: {
                available: true,
                service: this.localStorage ? this.localStorage.getStatus() : null
            },
            cache: {
                size: this.locationCache.size,
                maxSize: 1000
            }
        };
    }

    /**
     * Upload file with orchestration and fallback logic
     * @param {string} userId - User ID for folder organization
     * @param {Buffer|Uint8Array} fileData - File data to upload
     * @param {string} filename - Original filename
     * @param {Object} options - Upload options
     * @param {boolean} options.isAvatar - Whether this is an avatar file
     * @param {string} options.contentType - MIME type of the file
     * @param {Object} options.metadata - Additional metadata
     * @param {boolean} options.forceLocal - Force use of local storage
     * @returns {Promise<Object>} Upload result with storage location info
     */
    async uploadFile(userId, fileData, filename, options = {}) {
        const { isAvatar = false, contentType = 'application/octet-stream', metadata = {}, forceLocal = false } = options;
        
        if (!userId) {
            throw new Error('User ID is required for file uploads');
        }

        if (!fileData || !filename) {
            throw new Error('File data and filename are required');
        }

        logger.info('Starting file upload orchestration', {
            userId,
            filename,
            isAvatar,
            contentType,
            fileSize: fileData.length,
            forceLocal
        });

        let uploadResult = null;
        let primaryStorage = null;
        let fallbackUsed = false;

        try {
            // Determine primary storage service
            const storageInfo = await this.determineUploadStorage(forceLocal);
            primaryStorage = storageInfo;

            logger.debug('Primary storage determined', {
                userId,
                filename,
                storageMode: storageInfo.mode,
                reason: storageInfo.reason
            });

            // Attempt upload with primary storage
            if (storageInfo.mode === 'r2') {
                uploadResult = await this.r2Storage.uploadFile(userId, fileData, filename, {
                    isAvatar,
                    contentType,
                    metadata
                });
                
                // Cache successful R2 upload location
                this.cacheFileLocation(userId, filename, isAvatar, 'r2');
                
            } else {
                uploadResult = await this.localStorage.uploadFile(fileData, filename, {
                    type: isAvatar ? 'avatar' : 'upload',
                    userId: isAvatar ? userId : null
                });
                
                // Cache successful local upload location
                this.cacheFileLocation(userId, filename, isAvatar, 'local');
            }

            // Add storage metadata to result
            uploadResult.storageLocation = storageInfo.mode;
            uploadResult.storageReason = storageInfo.reason;
            uploadResult.fallbackUsed = false;

            logger.info('File upload successful', {
                userId,
                filename,
                storageLocation: storageInfo.mode,
                fileSize: fileData.length,
                fallbackUsed: false
            });

            // Log storage operation metrics
            logger.logStorageOperation('upload', storageInfo.mode, true, false, {
                userId,
                filename,
                fileSize: fileData.length,
                isAvatar,
                storageReason: storageInfo.reason
            });

            // Notify successful storage operation
            notificationManager.notifyStorageSuccess(storageInfo.mode, 'upload', {
                userId,
                filename,
                fileSize: fileData.length,
                isAvatar,
                storageReason: storageInfo.reason
            });

            return uploadResult;

        } catch (primaryError) {
            logger.warn('Primary storage upload failed, attempting fallback', {
                userId,
                filename,
                primaryStorage: primaryStorage?.mode,
                error: primaryError.message,
                errorType: 'primary_upload_failed'
            });

            // Attempt fallback only if we're in hybrid mode and primary was R2
            if (this.r2Config.getStorageMode() === 'hybrid' && primaryStorage?.mode === 'r2') {
                try {
                    logger.info('Attempting fallback to local storage', {
                        userId,
                        filename,
                        isAvatar
                    });

                    uploadResult = await this.localStorage.uploadFile(fileData, filename, {
                        type: isAvatar ? 'avatar' : 'upload',
                        userId: isAvatar ? userId : null
                    });

                    // Cache fallback upload location
                    this.cacheFileLocation(userId, filename, isAvatar, 'local');
                    
                    // Add storage metadata to result
                    uploadResult.storageLocation = 'local';
                    uploadResult.storageReason = 'fallback_from_r2';
                    uploadResult.fallbackUsed = true;
                    uploadResult.primaryError = primaryError.message;
                    fallbackUsed = true;

                    logger.warn('File upload successful using fallback storage', {
                        userId,
                        filename,
                        storageLocation: 'local',
                        fileSize: fileData.length,
                        fallbackUsed: true,
                        primaryError: primaryError.message
                    });

                    // Log fallback usage for monitoring
                    this.logFallbackUsage('upload', userId, filename, primaryError);

                    // Notify fallback usage
                    notificationManager.notifyFallbackUsage('upload', 'r2', 'local', primaryError, {
                        userId,
                        filename,
                        fileSize: fileData.length,
                        isAvatar
                    });

                    return uploadResult;

                } catch (fallbackError) {
                    logger.error('Fallback storage upload also failed', {
                        userId,
                        filename,
                        primaryError: primaryError.message,
                        fallbackError: fallbackError.message,
                        errorType: 'upload_complete_failure'
                    });

                    // Notify both storage failures
                    notificationManager.notifyStorageFailure('r2', 'upload', primaryError, {
                        userId,
                        filename,
                        fileSize: fileData.length,
                        isAvatar
                    });
                    notificationManager.notifyStorageFailure('local', 'upload', fallbackError, {
                        userId,
                        filename,
                        fileSize: fileData.length,
                        isAvatar,
                        primaryError: primaryError.message
                    });

                    // Throw the original primary error with fallback context
                    const combinedError = new Error(`Upload failed on both primary and fallback storage. Primary: ${primaryError.message}, Fallback: ${fallbackError.message}`);
                    combinedError.primaryError = primaryError;
                    combinedError.fallbackError = fallbackError;
                    throw combinedError;
                }
            } else {
                // No fallback available or not in hybrid mode
                logger.error('File upload failed and no fallback available', {
                    userId,
                    filename,
                    storageMode: this.r2Config.getStorageMode(),
                    primaryStorage: primaryStorage?.mode,
                    error: primaryError.message,
                    errorType: 'upload_failed_no_fallback'
                });

                // Notify storage failure
                notificationManager.notifyStorageFailure(primaryStorage?.mode || 'unknown', 'upload', primaryError, {
                    userId,
                    filename,
                    fileSize: fileData.length,
                    isAvatar,
                    storageMode: this.r2Config.getStorageMode(),
                    noFallbackAvailable: true
                });

                throw primaryError;
            }
        }
    }

    /**
     * Upload avatar file with specific handling
     * @param {string} userId - User ID
     * @param {Buffer|Uint8Array} imageData - Avatar image data
     * @param {string} contentType - Image MIME type (default: image/png)
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} Upload result
     */
    async uploadAvatar(userId, imageData, contentType = 'image/png', options = {}) {
        return await this.uploadFile(userId, imageData, 'avatar.png', {
            isAvatar: true,
            contentType,
            metadata: {
                fileType: 'avatar',
                processedDate: new Date().toISOString()
            },
            ...options
        });
    }

    /**
     * Upload regular file (documents, images, etc.)
     * @param {string} userId - User ID
     * @param {Buffer|Uint8Array} fileData - File data
     * @param {string} filename - Original filename
     * @param {string} contentType - File MIME type
     * @param {Object} options - Additional options including metadata
     * @returns {Promise<Object>} Upload result
     */
    async uploadRegularFile(userId, fileData, filename, contentType, options = {}) {
        const { metadata = {}, ...otherOptions } = options;
        
        return await this.uploadFile(userId, fileData, filename, {
            isAvatar: false,
            contentType,
            metadata: {
                fileType: 'upload',
                ...metadata
            },
            ...otherOptions
        });
    }

    /**
     * Get file with fallback logic (checks R2 first, then local storage)
     * @param {string} userId - User ID
     * @param {string} filename - Filename to retrieve
     * @param {Object} options - Retrieval options
     * @param {boolean} options.isAvatar - Whether this is an avatar file
     * @param {boolean} options.returnStream - Whether to return stream instead of buffer
     * @param {boolean} options.forceLocal - Force use of local storage
     * @returns {Promise<Object>} File data and metadata with storage location info
     */
    async getFile(userId, filename, options = {}) {
        const { isAvatar = false, returnStream = false, forceLocal = false } = options;
        
        if (!userId) {
            throw new Error('User ID is required for file retrieval');
        }

        if (!filename) {
            throw new Error('Filename is required');
        }

        logger.debug('Starting file retrieval with fallback logic', {
            userId,
            filename,
            isAvatar,
            returnStream,
            forceLocal
        });

        // Check cache first for known location
        let cachedLocation = null;
        if (!forceLocal) {
            cachedLocation = this.getCachedFileLocation(userId, filename, isAvatar);
            if (cachedLocation) {
                logger.debug('Using cached file location', {
                    userId,
                    filename,
                    cachedLocation
                });
            }
        }

        let result = null;
        let fallbackUsed = false;
        let primaryError = null;

        // Determine search order based on cache and configuration
        const searchOrder = this.determineRetrievalOrder(cachedLocation, forceLocal);

        for (const storageType of searchOrder) {
            try {
                logger.debug(`Attempting file retrieval from ${storageType} storage`, {
                    userId,
                    filename,
                    isAvatar,
                    returnStream
                });

                if (storageType === 'r2') {
                    // Check R2 availability first
                    const r2Available = await this.isR2Available();
                    if (!r2Available) {
                        logger.debug('R2 not available, skipping R2 retrieval', {
                            userId,
                            filename
                        });
                        continue;
                    }

                    if (returnStream) {
                        result = await this.r2Storage.getFileStream(userId, filename, isAvatar);
                    } else {
                        result = await this.r2Storage.downloadFile(userId, filename, isAvatar);
                    }
                    
                    // Cache successful R2 retrieval
                    this.cacheFileLocation(userId, filename, isAvatar, 'r2');
                    
                } else {
                    // Local storage retrieval
                    if (returnStream) {
                        result = await this.localStorage.getFileStream(filename, isAvatar ? 'avatar' : 'upload', isAvatar ? userId : null);
                    } else {
                        result = await this.localStorage.getFile(filename, isAvatar ? 'avatar' : 'upload', isAvatar ? userId : null);
                    }
                    
                    // Cache successful local retrieval
                    this.cacheFileLocation(userId, filename, isAvatar, 'local');
                }

                // Add storage metadata to result
                result.storageLocation = storageType;
                result.fallbackUsed = fallbackUsed;
                if (primaryError) {
                    result.primaryError = primaryError.message;
                }

                logger.info('File retrieval successful', {
                    userId,
                    filename,
                    storageLocation: storageType,
                    fallbackUsed,
                    returnStream
                });

                return result;

            } catch (error) {
                logger.debug(`File retrieval failed from ${storageType} storage`, {
                    userId,
                    filename,
                    storageType,
                    error: error.message,
                    errorType: 'retrieval_attempt_failed'
                });

                // Store the first error as primary error
                if (!primaryError) {
                    primaryError = error;
                } else {
                    fallbackUsed = true;
                }

                // If this was a "file not found" error, continue to next storage
                if (error.message.includes('File not found') || error.message.includes('not found')) {
                    continue;
                }

                // For other errors, log and continue to fallback
                logger.warn(`Non-file-not-found error in ${storageType} storage, trying fallback`, {
                    userId,
                    filename,
                    storageType,
                    error: error.message
                });
                
                // Log fallback usage for monitoring
                if (storageType === 'r2') {
                    this.logFallbackUsage('retrieval', userId, filename, error);
                }
            }
        }

        // If we get here, file was not found in any storage
        logger.debug('File not found in any storage location', {
            userId,
            filename,
            isAvatar,
            searchOrder,
            primaryError: primaryError?.message
        });

        const notFoundError = new Error(`File not found: ${filename}`);
        notFoundError.userId = userId;
        notFoundError.filename = filename;
        notFoundError.isAvatar = isAvatar;
        notFoundError.searchedLocations = searchOrder;
        if (primaryError) {
            notFoundError.primaryError = primaryError;
        }
        
        throw notFoundError;
    }

    /**
     * Determine the order to search for files based on cache and configuration
     * @param {string|null} cachedLocation - Cached file location
     * @param {boolean} forceLocal - Force local storage only
     * @returns {string[]} Array of storage types to search in order
     * @private
     */
    determineRetrievalOrder(cachedLocation, forceLocal) {
        if (forceLocal) {
            return ['local'];
        }

        const configMode = this.r2Config.getStorageMode();

        // If we have a cached location, try it first
        if (cachedLocation) {
            if (cachedLocation === 'r2') {
                return configMode === 'local-only' ? ['local'] : ['r2', 'local'];
            } else {
                return configMode === 'r2-only' ? ['r2'] : ['local', 'r2'];
            }
        }

        // Default search order based on configuration
        switch (configMode) {
            case 'r2-only':
                return ['r2'];
            case 'local-only':
                return ['local'];
            case 'hybrid':
            default:
                // In hybrid mode, prefer R2 first, then fallback to local
                return ['r2', 'local'];
        }
    }

    /**
     * Get file stream for efficient streaming to client
     * @param {string} userId - User ID
     * @param {string} filename - Filename to stream
     * @param {Object} options - Stream options
     * @param {boolean} options.isAvatar - Whether this is an avatar file
     * @param {boolean} options.forceLocal - Force use of local storage
     * @returns {Promise<Object>} Stream and metadata
     */
    async getFileStream(userId, filename, options = {}) {
        return await this.getFile(userId, filename, {
            ...options,
            returnStream: true
        });
    }

    /**
     * Get avatar data or stream for a specific user
     * @param {string} userId - User ID
     * @param {Object} options - Retrieval options
     * @param {boolean} options.returnStream - Whether to return stream instead of buffer
     * @param {boolean} options.forceLocal - Force use of local storage
     * @returns {Promise<Object|null>} Avatar data/stream or null if not found
     */
    async getAvatar(userId, options = {}) {
        try {
            return await this.getFile(userId, 'avatar.png', {
                ...options,
                isAvatar: true
            });
        } catch (error) {
            if (error.message.includes('File not found')) {
                logger.debug('Avatar not found in any storage', { userId });
                return null;
            }
            throw error;
        }
    }

    /**
     * Check if file exists in any storage location
     * @param {string} userId - User ID
     * @param {string} filename - Filename to check
     * @param {boolean} isAvatar - Whether this is an avatar file
     * @returns {Promise<Object>} Existence information with location
     */
    async fileExists(userId, filename, isAvatar = false) {
        try {
            // Try to get file metadata without downloading
            const result = await this.getFileMetadata(userId, filename, isAvatar);
            return {
                exists: true,
                location: result.storageLocation,
                metadata: result
            };
        } catch (error) {
            if (error.message.includes('File not found')) {
                return {
                    exists: false,
                    location: null,
                    searchedLocations: error.searchedLocations || []
                };
            }
            throw error;
        }
    }

    /**
     * Get file metadata without downloading the file
     * @param {string} userId - User ID
     * @param {string} filename - Filename
     * @param {boolean} isAvatar - Whether this is an avatar file
     * @returns {Promise<Object>} File metadata with storage location
     */
    async getFileMetadata(userId, filename, isAvatar = false) {
        if (!userId || !filename) {
            throw new Error('User ID and filename are required');
        }

        logger.debug('Getting file metadata', {
            userId,
            filename,
            isAvatar
        });

        // Check cache first
        const cachedLocation = this.getCachedFileLocation(userId, filename, isAvatar);
        const searchOrder = this.determineRetrievalOrder(cachedLocation, false);

        let primaryError = null;

        for (const storageType of searchOrder) {
            try {
                let metadata = null;

                if (storageType === 'r2') {
                    // Check R2 availability first
                    const r2Available = await this.isR2Available();
                    if (!r2Available) {
                        continue;
                    }

                    metadata = await this.r2Storage.getFileMetadata(userId, filename, isAvatar);
                } else {
                    metadata = await this.localStorage.getFileMetadata(filename, isAvatar ? 'avatar' : 'upload', isAvatar ? userId : null);
                }

                if (metadata) {
                    // Cache successful metadata retrieval
                    this.cacheFileLocation(userId, filename, isAvatar, storageType);
                    
                    // Add storage location info
                    metadata.storageLocation = storageType;
                    
                    logger.debug('File metadata retrieved successfully', {
                        userId,
                        filename,
                        storageLocation: storageType
                    });

                    return metadata;
                }

            } catch (error) {
                if (!primaryError) {
                    primaryError = error;
                }

                logger.debug(`Metadata retrieval failed from ${storageType} storage`, {
                    userId,
                    filename,
                    storageType,
                    error: error.message
                });

                // Continue to next storage location
                continue;
            }
        }

        // File not found in any location
        const notFoundError = new Error(`File not found: ${filename}`);
        notFoundError.userId = userId;
        notFoundError.filename = filename;
        notFoundError.isAvatar = isAvatar;
        notFoundError.searchedLocations = searchOrder;
        if (primaryError) {
            notFoundError.primaryError = primaryError;
        }
        
        throw notFoundError;
    }

    /**
     * Log fallback usage for monitoring purposes
     * @param {string} operation - Operation type ('upload' or 'download')
     * @param {string} userId - User ID
     * @param {string} filename - Filename
     * @param {Error} primaryError - The error that caused fallback
     * @private
     */
    logFallbackUsage(operation, userId, filename, primaryError) {
        logger.warn(`Fallback storage used for ${operation}`, {
            operation,
            userId,
            filename,
            primaryError: primaryError.message,
            timestamp: new Date().toISOString(),
            errorType: 'fallback_usage',
            // This can be used for monitoring and alerting
            monitoring: {
                fallbackUsed: true,
                operation,
                reason: primaryError.name || 'unknown'
            }
        });
    }

    /**
     * Delete file from storage (tries both locations if necessary)
     * @param {string} userId - User ID
     * @param {string} filename - Filename to delete
     * @param {boolean} isAvatar - Whether this is an avatar file
     * @returns {Promise<Object>} Deletion result
     */
    async deleteFile(userId, filename, isAvatar = false) {
        if (!userId || !filename) {
            throw new Error('User ID and filename are required for file deletion');
        }

        logger.info('Starting file deletion', {
            userId,
            filename,
            isAvatar
        });

        const results = [];
        let anySuccess = false;

        // Try to delete from both storage locations to ensure cleanup
        // Check R2 first if available
        if (await this.isR2Available()) {
            try {
                const r2Result = await this.r2Storage.deleteFile(userId, filename, isAvatar);
                results.push({ storage: 'r2', success: true, result: r2Result });
                anySuccess = true;
                
                logger.info('File deleted from R2 storage', {
                    userId,
                    filename,
                    isAvatar
                });
            } catch (error) {
                results.push({ storage: 'r2', success: false, error: error.message });
                
                logger.debug('R2 file deletion failed (file may not exist)', {
                    userId,
                    filename,
                    error: error.message
                });
            }
        }

        // Try local storage
        try {
            const localResult = await this.localStorage.deleteFile(filename, isAvatar ? 'avatar' : 'upload', isAvatar ? userId : null);
            results.push({ storage: 'local', success: true, result: localResult });
            anySuccess = true;
            
            logger.info('File deleted from local storage', {
                userId,
                filename,
                isAvatar
            });
        } catch (error) {
            results.push({ storage: 'local', success: false, error: error.message });
            
            logger.debug('Local file deletion failed (file may not exist)', {
                userId,
                filename,
                error: error.message
            });
        }

        // Clear from cache
        this.locationCache.delete(`${userId}:${filename}:${isAvatar}`);

        const deleteResult = {
            success: anySuccess,
            userId,
            filename,
            isAvatar,
            deletedAt: new Date().toISOString(),
            results
        };

        if (anySuccess) {
            logger.info('File deletion completed', {
                userId,
                filename,
                isAvatar,
                deletedFromStorages: results.filter(r => r.success).map(r => r.storage)
            });
        } else {
            logger.warn('File deletion failed from all storage locations', {
                userId,
                filename,
                isAvatar,
                results
            });
        }

        return deleteResult;
    }

    /**
     * Migrate file from local storage to R2 (if R2 is available)
     * @param {string} userId - User ID
     * @param {string} filename - Filename to migrate
     * @param {boolean} isAvatar - Whether this is an avatar file
     * @param {boolean} deleteLocal - Whether to delete local copy after successful migration
     * @returns {Promise<Object>} Migration result
     */
    async migrateFile(userId, filename, isAvatar = false, deleteLocal = false) {
        if (!userId || !filename) {
            throw new Error('User ID and filename are required for file migration');
        }

        // Check if R2 is available
        const r2Available = await this.isR2Available();
        if (!r2Available) {
            throw new Error('R2 storage is not available for migration');
        }

        logger.info('Starting file migration from local to R2', {
            userId,
            filename,
            isAvatar,
            deleteLocal
        });

        try {
            // Get file from local storage
            const localFile = await this.localStorage.getFile(filename, isAvatar ? 'avatar' : 'upload', isAvatar ? userId : null);
            
            if (!localFile.success) {
                throw new Error('File not found in local storage');
            }

            // Determine content type (basic detection)
            let contentType = 'application/octet-stream';
            if (filename.toLowerCase().endsWith('.png')) {
                contentType = 'image/png';
            } else if (filename.toLowerCase().endsWith('.jpg') || filename.toLowerCase().endsWith('.jpeg')) {
                contentType = 'image/jpeg';
            } else if (filename.toLowerCase().endsWith('.pdf')) {
                contentType = 'application/pdf';
            }

            // Upload to R2
            const r2Result = await this.r2Storage.uploadFile(userId, localFile.fileData, filename, {
                isAvatar,
                contentType,
                metadata: {
                    migratedFrom: 'local',
                    migrationDate: new Date().toISOString(),
                    originalSize: localFile.metadata.size
                }
            });

            // Update cache to reflect new location
            this.cacheFileLocation(userId, filename, isAvatar, 'r2');

            const migrationResult = {
                success: true,
                userId,
                filename,
                isAvatar,
                migratedAt: new Date().toISOString(),
                localFile: localFile.metadata,
                r2File: r2Result,
                localDeleted: false
            };

            // Delete local copy if requested
            if (deleteLocal) {
                try {
                    await this.localStorage.deleteFile(filename, isAvatar ? 'avatar' : 'upload', isAvatar ? userId : null);
                    migrationResult.localDeleted = true;
                    
                    logger.info('Local file deleted after successful migration', {
                        userId,
                        filename,
                        isAvatar
                    });
                } catch (deleteError) {
                    logger.warn('Failed to delete local file after migration', {
                        userId,
                        filename,
                        isAvatar,
                        error: deleteError.message
                    });
                    migrationResult.localDeleteError = deleteError.message;
                }
            }

            logger.info('File migration completed successfully', {
                userId,
                filename,
                isAvatar,
                deleteLocal,
                localDeleted: migrationResult.localDeleted
            });

            return migrationResult;

        } catch (error) {
            logger.error('File migration failed', {
                userId,
                filename,
                isAvatar,
                error: error.message,
                errorType: 'migration_failed'
            });
            throw error;
        }
    }

    /**
     * Clear location cache (useful for testing or manual cache management)
     */
    clearLocationCache() {
        const previousSize = this.locationCache.size;
        this.locationCache.clear();
        
        logger.info('Location cache cleared', {
            previousSize,
            currentSize: this.locationCache.size
        });
    }

    /**
     * Get cache statistics
     * @returns {Object} Cache statistics
     */
    getCacheStats() {
        return {
            size: this.locationCache.size,
            maxSize: 1000,
            entries: Array.from(this.locationCache.entries()).map(([key, value]) => ({
                key,
                location: value.location,
                age: Date.now() - value.timestamp
            }))
        };
    }

    /**
     * Log current storage status
     */
    logStorageStatus() {
        const status = this.getStorageStatus();
        logger.info('=== StorageManager Status ===');
        logger.info(`Config Mode: ${status.configMode}`);
        logger.info(`Effective Mode: ${status.effectiveMode}`);
        logger.info(`R2 Configured: ${status.r2.configured}`);
        logger.info(`R2 Available: ${status.r2.available}`);
        logger.info(`Local Available: ${status.local.available}`);
        logger.info(`Cache Size: ${status.cache.size}/${status.cache.maxSize}`);
        logger.info('=============================');
    }
}

module.exports = StorageManager;