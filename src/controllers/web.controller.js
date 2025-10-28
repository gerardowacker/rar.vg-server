const bodyParser = require('body-parser')
const cors = require('cors')
const http = require('http')
const express = require('express')
const fileUpload = require('express-fileupload');
const path = require('path')
const root = path.normalize(path.join(path.dirname(require.main.filename), '..'))

const RouterController = require('./router.controller')
const StorageManager = require('../services/StorageManager')
const logger = require('../utils/logger.util')

class WebController {
    constructor() {
        // Initialize StorageManager for R2 file serving with error handling
        try {
            this.storageManager = new StorageManager()
            logger.info('StorageManager initialized successfully for WebController');
        } catch (error) {
            logger.error('Failed to initialize StorageManager in WebController', {
                error: error.message,
                errorType: 'storage_manager_init_error'
            });
            this.storageManager = null;
        }

        // Create a new RouterController instance with StorageManager, and save it within the class. 
        this.router = new RouterController(this.storageManager)
    }

    /**
     * Check if StorageManager is available and ready
     * @returns {boolean} True if StorageManager is available
     */
    isStorageManagerAvailable() {
        return this.storageManager !== null;
    }

    /**
     * Custom avatar route handler using StorageManager
     * Serves avatar files from R2 with fallback to local storage
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     * @param {Function} next - Express next function
     */
    async handleAvatarRoute(req, res, next) {
        try {
            // Check if StorageManager is available
            if (!this.isStorageManagerAvailable()) {
                logger.debug('StorageManager not available, falling through to static middleware');
                return next(); // Fall through to static middleware
            }

            // Extract user ID from the route parameter (e.g., /avatar/123.png -> 123)
            const filename = req.params.filename;
            const userId = filename.replace('.png', '');

            // Validate user ID format (should be numeric)
            if (!userId || !/^\d+$/.test(userId)) {
                logger.debug('Invalid user ID format in avatar request', {
                    filename,
                    userId,
                    ip: req.ip
                });
                return next(); // Fall through to static middleware for invalid format
            }

            logger.debug('Avatar request received', {
                userId,
                filename,
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });

            // Get avatar stream from StorageManager
            const avatarResult = await this.storageManager.getAvatar(userId, {
                returnStream: true
            });

            if (!avatarResult) {
                logger.debug('Avatar not found in any storage, falling through to static middleware', {
                    userId,
                    filename
                });
                return next(); // Fall through to static middleware
            }

            // Set proper headers for image serving
            res.set({
                'Content-Type': avatarResult.contentType || 'image/png',
                'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
                'ETag': avatarResult.etag || `"${userId}-avatar"`,
                'Last-Modified': avatarResult.lastModified || new Date().toUTCString()
            });

            // Add storage location header for debugging (optional)
            if (process.env.NODE_ENV === 'development') {
                res.set('X-Storage-Location', avatarResult.storageLocation);
                if (avatarResult.fallbackUsed) {
                    res.set('X-Fallback-Used', 'true');
                }
            }

            // Handle conditional requests (304 Not Modified)
            if (req.headers['if-none-match'] === res.get('ETag')) {
                return res.status(304).end();
            }

            // Stream the avatar file to the client
            if (avatarResult.stream) {
                avatarResult.stream.pipe(res);

                // Handle stream errors
                avatarResult.stream.on('error', (error) => {
                    logger.error('Avatar stream error', {
                        userId,
                        filename,
                        error: error.message,
                        storageLocation: avatarResult.storageLocation
                    });

                    if (!res.headersSent) {
                        res.status(500).send('Error serving avatar');
                    }
                });

                // Log successful avatar serving
                avatarResult.stream.on('end', () => {
                    logger.debug('Avatar served successfully', {
                        userId,
                        filename,
                        storageLocation: avatarResult.storageLocation,
                        fallbackUsed: avatarResult.fallbackUsed || false
                    });
                });
            } else {
                // Fallback to buffer if stream is not available
                res.send(avatarResult.fileData);

                logger.debug('Avatar served successfully (buffer)', {
                    userId,
                    filename,
                    storageLocation: avatarResult.storageLocation,
                    fallbackUsed: avatarResult.fallbackUsed || false
                });
            }

        } catch (error) {
            logger.error('Avatar route handler error', {
                filename: req.params.filename,
                error: error.message,
                stack: error.stack,
                ip: req.ip
            });

            // Check if it's a "file not found" error - fall through to static middleware
            if (error.message.includes('File not found')) {
                logger.debug('Avatar not found in StorageManager, falling through to static middleware', {
                    filename: req.params.filename,
                    error: error.message
                });
                return next();
            }

            // For other errors, fall through to static middleware as well
            logger.warn('Avatar route handler error, falling through to static middleware', {
                filename: req.params.filename,
                error: error.message
            });
            return next();
        }
    }

    /**
     * Custom uploads route handler using StorageManager
     * Serves uploaded files from R2 with fallback to local storage
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     * @param {Function} next - Express next function
     */
    async handleUploadsRoute(req, res, next) {
        try {
            // Check if StorageManager is available
            if (!this.isStorageManagerAvailable()) {
                logger.debug('StorageManager not available, falling through to static middleware');
                return next(); // Fall through to static middleware
            }

            const filename = req.params.filename;

            // Basic filename validation
            if (!filename || filename.includes('..') || filename.includes('/')) {
                logger.warn('Invalid filename in uploads request', {
                    filename,
                    ip: req.ip
                });
                return next(); // Fall through to static middleware for invalid filenames
            }

            logger.debug('Upload file request received', {
                filename,
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });

            // For uploaded files, we need to search across all users since we don't have user context
            // We'll try to find the file by searching through storage locations
            let fileResult = null;
            let searchError = null;

            // First, try to determine if this is a user-specific file by checking common patterns
            // Since we don't have user context in the URL, we need to search
            try {
                // Try to get file metadata to determine which user owns it
                // This is a limitation of the current URL structure - ideally we'd have /uploads/:userId/:filename
                fileResult = await this.searchFileAcrossUsers(filename);
            } catch (error) {
                searchError = error;
                logger.debug('File search across users failed', {
                    filename,
                    error: error.message
                });
            }

            if (!fileResult) {
                logger.debug('Upload file not found in any storage, falling through to static middleware', {
                    filename,
                    searchError: searchError?.message
                });
                return next(); // Fall through to static middleware
            }

            // Determine content type based on file extension
            const contentType = this.getContentTypeFromFilename(filename);

            // Set proper headers for file serving
            res.set({
                'Content-Type': fileResult.contentType || contentType,
                'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
                'ETag': fileResult.etag || `"${filename}"`,
                'Last-Modified': fileResult.lastModified || new Date().toUTCString()
            });

            // Add storage location header for debugging (optional)
            if (process.env.NODE_ENV === 'development') {
                res.set('X-Storage-Location', fileResult.storageLocation);
                if (fileResult.fallbackUsed) {
                    res.set('X-Fallback-Used', 'true');
                }
                if (fileResult.userId) {
                    res.set('X-File-Owner', fileResult.userId);
                }
            }

            // Handle conditional requests (304 Not Modified)
            if (req.headers['if-none-match'] === res.get('ETag')) {
                return res.status(304).end();
            }

            // Stream the file to the client
            if (fileResult.stream) {
                fileResult.stream.pipe(res);

                // Handle stream errors
                fileResult.stream.on('error', (error) => {
                    logger.error('Upload file stream error', {
                        filename,
                        userId: fileResult.userId,
                        error: error.message,
                        storageLocation: fileResult.storageLocation
                    });

                    if (!res.headersSent) {
                        res.status(500).send('Error serving file');
                    }
                });

                // Log successful file serving
                fileResult.stream.on('end', () => {
                    logger.debug('Upload file served successfully', {
                        filename,
                        userId: fileResult.userId,
                        storageLocation: fileResult.storageLocation,
                        fallbackUsed: fileResult.fallbackUsed || false
                    });
                });
            } else {
                // Fallback to buffer if stream is not available
                res.send(fileResult.fileData);

                logger.debug('Upload file served successfully (buffer)', {
                    filename,
                    userId: fileResult.userId,
                    storageLocation: fileResult.storageLocation,
                    fallbackUsed: fileResult.fallbackUsed || false
                });
            }

        } catch (error) {
            logger.error('Uploads route handler error', {
                filename: req.params.filename,
                error: error.message,
                stack: error.stack,
                ip: req.ip
            });

            // Check if it's a "file not found" error - fall through to static middleware
            if (error.message.includes('File not found')) {
                logger.debug('Upload file not found in StorageManager, falling through to static middleware', {
                    filename: req.params.filename,
                    error: error.message
                });
                return next();
            }

            // For other errors, fall through to static middleware as well
            logger.warn('Uploads route handler error, falling through to static middleware', {
                filename: req.params.filename,
                error: error.message
            });
            return next();
        }
    }

    /**
     * Search for a file across all possible user locations
     * This is a workaround for the current URL structure that doesn't include user ID
     * @param {string} filename - Filename to search for
     * @returns {Promise<Object>} File result with user context
     */
    async searchFileAcrossUsers(filename) {
        // First, try the legacy local storage approach
        try {
            const localResult = await this.storageManager.localStorage.getFile(filename, 'upload', null);
            if (localResult && localResult.success) {
                return {
                    ...localResult,
                    storageLocation: 'local',
                    userId: null, // Legacy files don't have user context
                    stream: await this.storageManager.localStorage.getFileStream(filename, 'upload', null)
                };
            }
        } catch (error) {
            // Continue searching if local file not found
            logger.debug('File not found in legacy local storage', {
                filename,
                error: error.message
            });
        }

        // If not found in legacy storage, we'd need to implement a more sophisticated search
        // For now, we'll throw an error indicating the limitation
        throw new Error(`File not found: ${filename}. Note: User-specific file search not implemented for current URL structure.`);
    }

    /**
     * Determine content type based on filename extension
     * @param {string} filename - Filename to analyze
     * @returns {string} MIME type
     */
    getContentTypeFromFilename(filename) {
        const ext = filename.toLowerCase().split('.').pop();

        const contentTypes = {
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'pdf': 'application/pdf',
            'txt': 'text/plain',
            'html': 'text/html',
            'css': 'text/css',
            'js': 'application/javascript',
            'json': 'application/json',
            'xml': 'application/xml',
            'zip': 'application/zip',
            'mp4': 'video/mp4',
            'mp3': 'audio/mpeg',
            'wav': 'audio/wav'
        };

        return contentTypes[ext] || 'application/octet-stream';
    }

    /**
     * Basic health check endpoint
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    async handleHealthCheck(req, res) {
        try {
            const healthStatus = {
                status: 'healthy',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                version: process.version,
                storage: {
                    available: this.isStorageManagerAvailable()
                }
            };

            // Add basic storage info if available
            if (this.storageManager) {
                const storageStatus = this.storageManager.getStorageStatus();
                healthStatus.storage.mode = storageStatus.effectiveMode;
                healthStatus.storage.r2Available = storageStatus.r2.available;
                healthStatus.storage.localAvailable = storageStatus.local.available;
            }

            logger.debug('Health check requested', {
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });

            res.status(200).json(healthStatus);

        } catch (error) {
            logger.error('Health check failed', {
                error: error.message,
                errorType: 'health_check_error'
            });

            res.status(500).json({
                status: 'unhealthy',
                timestamp: new Date().toISOString(),
                error: error.message
            });
        }
    }

    /**
     * Detailed storage health check endpoint
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    async handleStorageHealthCheck(req, res) {
        try {
            if (!this.isStorageManagerAvailable()) {
                return res.status(503).json({
                    status: 'unavailable',
                    timestamp: new Date().toISOString(),
                    error: 'StorageManager not initialized'
                });
            }

            // Get comprehensive storage status
            const storageStatus = this.storageManager.getStorageStatus();
            
            // Perform R2 availability check if requested
            const forceCheck = req.query.check === 'true';
            if (forceCheck && storageStatus.r2.configured) {
                logger.info('Performing forced R2 availability check');
                await this.storageManager.checkR2Availability();
                // Get updated status after forced check
                const updatedStatus = this.storageManager.getStorageStatus();
                storageStatus.r2 = updatedStatus.r2;
            }

            const healthResponse = {
                status: 'healthy',
                timestamp: new Date().toISOString(),
                storage: {
                    configMode: storageStatus.configMode,
                    effectiveMode: storageStatus.effectiveMode,
                    r2: {
                        configured: storageStatus.r2.configured,
                        available: storageStatus.r2.available,
                        lastCheck: storageStatus.r2.lastCheck,
                        service: storageStatus.r2.service
                    },
                    local: {
                        available: storageStatus.local.available,
                        service: storageStatus.local.service
                    },
                    cache: storageStatus.cache
                }
            };

            logger.debug('Storage health check requested', {
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                forceCheck,
                effectiveMode: storageStatus.effectiveMode
            });

            res.status(200).json(healthResponse);

        } catch (error) {
            logger.error('Storage health check failed', {
                error: error.message,
                errorType: 'storage_health_check_error'
            });

            res.status(500).json({
                status: 'error',
                timestamp: new Date().toISOString(),
                error: error.message
            });
        }
    }

    /**
     * Set StorageManager instance (called from startup)
     * @param {StorageManager} storageManager - StorageManager instance
     */
    setStorageManager(storageManager) {
        this.storageManager = storageManager;
        
        // Update RouterController with new StorageManager
        if (this.router) {
            this.router.storageManager = storageManager;
            // Update FileController with new StorageManager
            if (this.router.fileController) {
                this.router.fileController.storageManager = storageManager;
                logger.info('StorageManager updated in FileController via RouterController');
            }
        }
        
        logger.info('StorageManager updated in WebController');
    }

    start() {
        return new Promise(res => {
            // Create express environment.
            const app = express()

            // Implement some middleware into the server.
            app.use(bodyParser.json())
            app.use(cors())
            app.use(fileUpload())
            app.set("trust proxy", true)

            // Health check endpoint for monitoring storage status
            app.get('/health', this.handleHealthCheck.bind(this));
            app.get('/health/storage', this.handleStorageHealthCheck.bind(this));

            // Custom route handlers with R2 support and fallback to local storage
            // These handlers will be tried first, before falling back to static middleware
            app.get('/avatar/:filename', this.handleAvatarRoute.bind(this));
            app.get('/uploads/:filename', this.handleUploadsRoute.bind(this));

            // Static file serving as final fallback
            // Configure with proper options for fallthrough behavior
            const staticOptions = {
                fallthrough: true,  // Allow falling through to next middleware if file not found
                maxAge: '1h',       // Cache static files for 1 hour
                etag: true,         // Enable ETag generation
                lastModified: true, // Enable Last-Modified headers
                index: false        // Don't serve index files
            };

            app.use('/avatar', express.static(root + '/public/avatars', staticOptions));
            app.use('/uploads', express.static(root + '/public/userfiles', staticOptions));

            // Add final 404 handlers for avatar and upload routes
            app.use('/avatar/*', (req, res) => {
                logger.debug('Avatar not found in any location', {
                    path: req.path,
                    ip: req.ip
                });
                res.status(404).send('Avatar not found');
            });

            app.use('/uploads/*', (req, res) => {
                logger.debug('Upload file not found in any location', {
                    path: req.path,
                    ip: req.ip
                });
                res.status(404).send('File not found');
            });

            // Create the router, and implement it into the server.
            this.router.create().then(routes => app.use("/", routes))

            // Create the HTTP server, then resolve the promise with it.
            const server = http.createServer(app)
            res(server)
        })
    }
}

module.exports = WebController
