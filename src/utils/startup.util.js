const R2Config = require('./r2-config.util');
const R2StorageService = require('../services/R2StorageService');
const StorageManager = require('../services/StorageManager');
const logger = require('./logger.util');

/**
 * Startup Utility - Handles application initialization and health checks
 * Provides R2 connectivity testing and graceful degradation setup
 */
class StartupManager {
    constructor() {
        this.r2Config = null;
        this.r2Storage = null;
        this.storageManager = null;
        this.initializationComplete = false;
        this.healthCheckInterval = null;
        this.healthCheckIntervalMs = 5 * 60 * 1000; // 5 minutes
    }

    /**
     * Initialize all storage services and perform startup checks
     * @returns {Promise<Object>} Initialization result with status information
     */
    async initialize() {
        logger.info('=== Starting Application Initialization ===');
        
        const initResult = {
            success: false,
            r2: {
                configured: false,
                connected: false,
                available: false,
                error: null
            },
            storage: {
                mode: 'unknown',
                managerInitialized: false,
                error: null
            },
            timestamp: new Date().toISOString()
        };

        try {
            // Step 1: Initialize and validate R2 configuration
            logger.info('Step 1: Initializing R2 configuration...');
            await this.initializeR2Configuration(initResult);

            // Step 2: Test R2 connectivity if configured
            if (initResult.r2.configured) {
                logger.info('Step 2: Testing R2 connectivity...');
                await this.testR2Connectivity(initResult);
            } else {
                logger.info('Step 2: Skipping R2 connectivity test (not configured)');
            }

            // Step 3: Initialize StorageManager
            logger.info('Step 3: Initializing StorageManager...');
            await this.initializeStorageManager(initResult);

            // Step 4: Log final status
            this.logInitializationStatus(initResult);

            // Step 5: Set up periodic health checks
            this.setupHealthChecks();

            initResult.success = true;
            this.initializationComplete = true;

            logger.info('=== Application Initialization Complete ===');
            return initResult;

        } catch (error) {
            logger.error('Application initialization failed', {
                error: error.message,
                errorType: 'startup_initialization_error'
            });
            
            initResult.success = false;
            initResult.error = error.message;
            
            // Log status even on failure
            this.logInitializationStatus(initResult);
            
            return initResult;
        }
    }

    /**
     * Initialize R2 configuration and validate settings
     * @param {Object} initResult - Initialization result object to update
     * @private
     */
    async initializeR2Configuration(initResult) {
        try {
            this.r2Config = new R2Config();
            
            // Log configuration status
            this.r2Config.logConfigurationStatus();
            
            initResult.r2.configured = this.r2Config.isValid;
            
            if (this.r2Config.isValid) {
                logger.info('R2 configuration validated successfully');
            } else {
                logger.warn('R2 configuration is incomplete or invalid');
                logger.info('Application will run in local-only storage mode');
            }

        } catch (error) {
            logger.error('Failed to initialize R2 configuration', {
                error: error.message,
                errorType: 'r2_config_init_error'
            });
            
            initResult.r2.error = error.message;
            throw error;
        }
    }

    /**
     * Test R2 connectivity and validate credentials
     * @param {Object} initResult - Initialization result object to update
     * @private
     */
    async testR2Connectivity(initResult) {
        try {
            // Initialize R2 storage service
            this.r2Storage = new R2StorageService();
            
            logger.info('Testing R2 connectivity and credentials...');
            
            // Perform connection test with timeout
            const connectionPromise = this.r2Storage.checkConnection();
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Connection test timeout')), 30000);
            });
            
            const isConnected = await Promise.race([connectionPromise, timeoutPromise]);
            
            initResult.r2.connected = isConnected;
            initResult.r2.available = isConnected;
            
            if (isConnected) {
                logger.info('R2 connectivity test successful');
                logger.info('R2 storage is available and ready for use');
            } else {
                logger.warn('R2 connectivity test failed');
                logger.warn('Application will fall back to local storage');
            }

        } catch (error) {
            logger.error('R2 connectivity test failed', {
                error: error.message,
                errorType: 'r2_connectivity_error'
            });
            
            initResult.r2.connected = false;
            initResult.r2.available = false;
            initResult.r2.error = error.message;
            
            // Don't throw error here - allow graceful degradation
            logger.warn('Continuing with local storage fallback');
        }
    }

    /**
     * Initialize StorageManager with proper configuration
     * @param {Object} initResult - Initialization result object to update
     * @private
     */
    async initializeStorageManager(initResult) {
        try {
            this.storageManager = new StorageManager();
            
            // Get storage status
            const storageStatus = this.storageManager.getStorageStatus();
            
            initResult.storage.mode = storageStatus.effectiveMode;
            initResult.storage.managerInitialized = true;
            
            logger.info('StorageManager initialized successfully', {
                configMode: storageStatus.configMode,
                effectiveMode: storageStatus.effectiveMode,
                r2Available: storageStatus.r2.available,
                localAvailable: storageStatus.local.available
            });

        } catch (error) {
            logger.error('Failed to initialize StorageManager', {
                error: error.message,
                errorType: 'storage_manager_init_error'
            });
            
            initResult.storage.error = error.message;
            throw error;
        }
    }

    /**
     * Log comprehensive initialization status
     * @param {Object} initResult - Initialization result
     * @private
     */
    logInitializationStatus(initResult) {
        logger.info('=== Initialization Status Summary ===');
        logger.info(`Overall Success: ${initResult.success}`);
        logger.info(`Timestamp: ${initResult.timestamp}`);
        
        logger.info('--- R2 Storage Status ---');
        logger.info(`Configured: ${initResult.r2.configured}`);
        logger.info(`Connected: ${initResult.r2.connected}`);
        logger.info(`Available: ${initResult.r2.available}`);
        if (initResult.r2.error) {
            logger.info(`Error: ${initResult.r2.error}`);
        }
        
        logger.info('--- Storage Manager Status ---');
        logger.info(`Mode: ${initResult.storage.mode}`);
        logger.info(`Initialized: ${initResult.storage.managerInitialized}`);
        if (initResult.storage.error) {
            logger.info(`Error: ${initResult.storage.error}`);
        }
        
        // Log effective storage configuration
        if (this.storageManager) {
            const status = this.storageManager.getStorageStatus();
            logger.info('--- Effective Storage Configuration ---');
            logger.info(`Config Mode: ${status.configMode}`);
            logger.info(`Effective Mode: ${status.effectiveMode}`);
            logger.info(`R2 Enabled: ${status.r2.configured}`);
            logger.info(`R2 Available: ${status.r2.available}`);
            logger.info(`Local Storage Available: ${status.local.available}`);
        }
        
        logger.info('=====================================');
    }

    /**
     * Set up periodic health checks for R2 connectivity
     * @private
     */
    setupHealthChecks() {
        if (!this.r2Config || !this.r2Config.isR2Enabled()) {
            logger.info('Skipping R2 health checks (R2 not enabled)');
            return;
        }

        logger.info(`Setting up R2 health checks (interval: ${this.healthCheckIntervalMs / 1000}s)`);
        
        this.healthCheckInterval = setInterval(async () => {
            await this.performHealthCheck();
        }, this.healthCheckIntervalMs);

        // Perform initial health check after a short delay
        setTimeout(async () => {
            await this.performHealthCheck();
        }, 30000); // 30 seconds after startup
    }

    /**
     * Perform periodic health check
     * @private
     */
    async performHealthCheck() {
        try {
            logger.debug('Performing R2 health check...');
            
            if (!this.storageManager) {
                logger.warn('StorageManager not available for health check');
                return;
            }

            // Check R2 availability through StorageManager
            const isAvailable = await this.storageManager.checkR2Availability();
            const storageStatus = this.storageManager.getStorageStatus();
            
            logger.debug('R2 health check completed', {
                r2Available: isAvailable,
                effectiveMode: storageStatus.effectiveMode,
                lastCheck: storageStatus.r2.lastCheck
            });

            // Log warning if R2 becomes unavailable
            if (!isAvailable && this.r2Config.isR2Enabled()) {
                logger.warn('R2 health check: Service unavailable, using fallback storage');
            }

        } catch (error) {
            logger.error('R2 health check failed', {
                error: error.message,
                errorType: 'r2_health_check_error'
            });
        }
    }

    /**
     * Get current initialization status
     * @returns {Object} Current status information
     */
    getStatus() {
        const status = {
            initialized: this.initializationComplete,
            timestamp: new Date().toISOString()
        };

        if (this.r2Config) {
            status.r2Config = {
                isValid: this.r2Config.isValid,
                storageMode: this.r2Config.getStorageMode(),
                isR2Enabled: this.r2Config.isR2Enabled(),
                isLocalEnabled: this.r2Config.isLocalStorageEnabled()
            };
        }

        if (this.storageManager) {
            status.storage = this.storageManager.getStorageStatus();
        }

        return status;
    }

    /**
     * Get StorageManager instance (for use by controllers)
     * @returns {StorageManager|null} StorageManager instance or null if not initialized
     */
    getStorageManager() {
        if (!this.initializationComplete) {
            logger.warn('StorageManager requested before initialization complete');
        }
        return this.storageManager;
    }

    /**
     * Gracefully shutdown health checks and cleanup
     */
    shutdown() {
        logger.info('Shutting down StartupManager...');
        
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
            logger.info('R2 health checks stopped');
        }

        // Log final storage status
        if (this.storageManager) {
            const finalStatus = this.storageManager.getStorageStatus();
            logger.info('Final storage status', finalStatus);
        }

        logger.info('StartupManager shutdown complete');
    }

    /**
     * Force refresh of R2 connectivity status
     * @returns {Promise<boolean>} Current R2 availability status
     */
    async refreshR2Status() {
        if (!this.storageManager) {
            logger.warn('Cannot refresh R2 status - StorageManager not initialized');
            return false;
        }

        logger.info('Forcing R2 status refresh...');
        const isAvailable = await this.storageManager.checkR2Availability();
        
        logger.info('R2 status refresh completed', {
            available: isAvailable,
            timestamp: new Date().toISOString()
        });

        return isAvailable;
    }

    /**
     * Test storage operations (for debugging/monitoring)
     * @returns {Promise<Object>} Test results
     */
    async testStorageOperations() {
        if (!this.storageManager) {
            throw new Error('StorageManager not initialized');
        }

        logger.info('Starting storage operations test...');
        
        const testResults = {
            timestamp: new Date().toISOString(),
            tests: {}
        };

        try {
            // Test file upload and retrieval
            const testData = Buffer.from('test-file-content');
            const testUserId = 'test-user';
            const testFilename = 'test-file.txt';

            // Upload test
            logger.debug('Testing file upload...');
            const uploadResult = await this.storageManager.uploadFile(
                testUserId, 
                testData, 
                testFilename, 
                { contentType: 'text/plain' }
            );
            
            testResults.tests.upload = {
                success: true,
                storageLocation: uploadResult.storageLocation,
                fallbackUsed: uploadResult.fallbackUsed
            };

            // Retrieval test
            logger.debug('Testing file retrieval...');
            const retrievalResult = await this.storageManager.getFile(
                testUserId, 
                testFilename
            );
            
            testResults.tests.retrieval = {
                success: true,
                storageLocation: retrievalResult.storageLocation,
                fallbackUsed: retrievalResult.fallbackUsed
            };

            logger.info('Storage operations test completed successfully', testResults);
            return testResults;

        } catch (error) {
            logger.error('Storage operations test failed', {
                error: error.message,
                errorType: 'storage_test_error'
            });
            
            testResults.error = error.message;
            return testResults;
        }
    }
}

// Create singleton instance
const startupManager = new StartupManager();

module.exports = startupManager;