// Load environment variables from .env if present
try { require('dotenv').config(); } catch (_) {}

const port = process.env.PORT || 1300

// Import controllers.
const WebController = require("./controllers/web.controller")

const web = new WebController()

// Import logger for metrics reporting
const logger = require('./utils/logger.util');

// Start the web server, then execute some stuff.
web.start().then(server =>
{
    server.listen(port)
    console.log("🚀 Server started using port", port)
    
    // Set up periodic metrics logging (every 30 minutes)
    setInterval(() => {
        logger.logMetrics();
    }, 30 * 60 * 1000); // 30 minutes in milliseconds
    
    // Log metrics on server shutdown
    process.on('SIGINT', () => {
        logger.info('Server shutting down, logging final metrics');
        logger.logMetrics();
        process.exit(0);
    });
    
    process.on('SIGTERM', () => {
        logger.info('Server shutting down, logging final metrics');
        logger.logMetrics();
        process.exit(0);
    });
})
