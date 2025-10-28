// Load environment variables from .env if present
try { require('dotenv').config(); } catch (_) {}

const port = process.env.PORT || 1300

// Import controllers and utilities
const WebController = require("./controllers/web.controller")
const logger = require('./utils/logger.util');
const startupManager = require('./utils/startup.util');

// Initialize startup manager and storage services
async function initializeApplication() {
    try {
        logger.info('Initializing application...');
        
        // Initialize storage services and perform health checks
        const initResult = await startupManager.initialize();
        
        if (!initResult.success) {
            logger.warn('Application initialization completed with warnings');
            logger.warn('Some storage features may be limited');
        } else {
            logger.info('Application initialization successful');
        }
        
        return initResult;
        
    } catch (error) {
        logger.error('Critical initialization failure', {
            error: error.message,
            errorType: 'critical_init_error'
        });
        
        // Don't exit - allow server to start with limited functionality
        logger.warn('Continuing with limited functionality...');
        return { success: false, error: error.message };
    }
}

// Start the application
async function startServer() {
    try {
        // Initialize application services
        const initResult = await initializeApplication();
        
        // Get StorageManager from startup
        const storageManager = startupManager.getStorageManager();
        
        // Create web controller with StorageManager and start server
        const web = new WebController()
        
        // Pass StorageManager to WebController if available
        if (storageManager && web.setStorageManager) {
            web.setStorageManager(storageManager);
            logger.info('StorageManager integrated with WebController');
        }
        
        const server = await web.start();
        
        server.listen(port);
        console.log("🚀 Server started using port", port);
        
        // Log startup summary
        logger.info('=== Server Startup Complete ===');
        logger.info(`Port: ${port}`);
        logger.info(`Storage initialization: ${initResult.success ? 'Success' : 'Partial/Failed'}`);
        if (initResult.storage) {
            logger.info(`Storage mode: ${initResult.storage.mode}`);
        }
        logger.info('===============================');
        
        // Set up periodic metrics logging (every 30 minutes)
        setInterval(() => {
            logger.logMetrics();
        }, 30 * 60 * 1000); // 30 minutes in milliseconds
        
        // Set up graceful shutdown handlers
        const gracefulShutdown = (signal) => {
            logger.info(`Received ${signal}, initiating graceful shutdown...`);
            
            // Shutdown startup manager and health checks
            startupManager.shutdown();
            
            // Log final metrics
            logger.logMetrics();
            
            // Close server
            server.close(() => {
                logger.info('Server closed successfully');
                process.exit(0);
            });
            
            // Force exit after 10 seconds if graceful shutdown fails
            setTimeout(() => {
                logger.error('Forced shutdown after timeout');
                process.exit(1);
            }, 10000);
        };
        
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        
        return server;
        
    } catch (error) {
        logger.error('Failed to start server', {
            error: error.message,
            errorType: 'server_start_error'
        });
        process.exit(1);
    }
}

// Start the server
startServer().catch(error => {
    logger.error('Unhandled server startup error', {
        error: error.message,
        errorType: 'unhandled_startup_error'
    });
    process.exit(1);
});
