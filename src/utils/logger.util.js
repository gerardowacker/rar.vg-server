const fs = require('fs');
const path = require('path');

/**
 * Enhanced logging utility with multiple log levels and environment-based configuration
 * Supports console and file logging with structured log entries
 */
class Logger {
    constructor() {
        // Log levels in order of severity
        this.levels = {
            ERROR: 0,
            WARN: 1,
            INFO: 2,
            DEBUG: 3,
            TRACE: 4
        };

        // Set log level from environment or default to INFO
        this.currentLevel = this.levels[process.env.LOG_LEVEL?.toUpperCase()] ?? this.levels.INFO;
        
        // Enable file logging if specified in environment
        this.fileLogging = process.env.LOG_TO_FILE === 'true';
        this.logDirectory = process.env.LOG_DIRECTORY || path.join(__dirname, '../../logs');
        
        // Initialize file logging if enabled
        if (this.fileLogging) {
            this.initializeFileLogging();
        }

        // Metrics tracking
        this.metrics = {
            requests: 0,
            successes: 0,
            failures: 0,
            totalResponseTime: 0,
            errors: new Map() // Error type -> count
        };

        console.log(`Logger initialized - Level: ${this.getLevelName(this.currentLevel)}, File logging: ${this.fileLogging}`);
    }

    /**
     * Initialize file logging directory and rotation
     */
    initializeFileLogging() {
        try {
            if (!fs.existsSync(this.logDirectory)) {
                fs.mkdirSync(this.logDirectory, { recursive: true });
            }
            
            // Create daily log files
            const today = new Date().toISOString().split('T')[0];
            this.logFile = path.join(this.logDirectory, `app-${today}.log`);
            this.errorLogFile = path.join(this.logDirectory, `error-${today}.log`);
            
        } catch (error) {
            console.error('Failed to initialize file logging:', error.message);
            this.fileLogging = false;
        }
    }

    /**
     * Get level name from level number
     */
    getLevelName(level) {
        return Object.keys(this.levels).find(key => this.levels[key] === level) || 'UNKNOWN';
    }

    /**
     * Check if a log level should be output
     */
    shouldLog(level) {
        return level <= this.currentLevel;
    }

    /**
     * Format log entry with timestamp and context
     */
    formatLogEntry(level, message, context = {}) {
        const timestamp = new Date().toISOString();
        const levelName = this.getLevelName(level);
        
        const logEntry = {
            timestamp,
            level: levelName,
            message,
            ...context
        };

        return logEntry;
    }

    /**
     * Write log entry to console and optionally to file
     */
    writeLog(level, message, context = {}) {
        if (!this.shouldLog(level)) {
            return;
        }

        const logEntry = this.formatLogEntry(level, message, context);
        const logString = JSON.stringify(logEntry);

        // Console output with color coding
        const colors = {
            [this.levels.ERROR]: '\x1b[31m', // Red
            [this.levels.WARN]: '\x1b[33m',  // Yellow
            [this.levels.INFO]: '\x1b[36m',  // Cyan
            [this.levels.DEBUG]: '\x1b[35m', // Magenta
            [this.levels.TRACE]: '\x1b[37m'  // White
        };
        
        const resetColor = '\x1b[0m';
        const color = colors[level] || '';
        
        console.log(`${color}[${logEntry.timestamp}] ${logEntry.level}: ${message}${resetColor}`);
        
        if (context && Object.keys(context).length > 0) {
            console.log(`${color}Context:${resetColor}`, context);
        }

        // File output if enabled
        if (this.fileLogging) {
            try {
                const logFile = level === this.levels.ERROR ? this.errorLogFile : this.logFile;
                fs.appendFileSync(logFile, logString + '\n');
            } catch (error) {
                console.error('Failed to write to log file:', error.message);
            }
        }
    }

    /**
     * Log error messages
     */
    error(message, context = {}) {
        this.writeLog(this.levels.ERROR, message, context);
        
        // Track error metrics
        const errorType = context.errorType || 'unknown';
        this.metrics.errors.set(errorType, (this.metrics.errors.get(errorType) || 0) + 1);
        this.metrics.failures++;
    }

    /**
     * Log warning messages
     */
    warn(message, context = {}) {
        this.writeLog(this.levels.WARN, message, context);
    }

    /**
     * Log info messages
     */
    info(message, context = {}) {
        this.writeLog(this.levels.INFO, message, context);
    }

    /**
     * Log debug messages
     */
    debug(message, context = {}) {
        this.writeLog(this.levels.DEBUG, message, context);
    }

    /**
     * Log trace messages
     */
    trace(message, context = {}) {
        this.writeLog(this.levels.TRACE, message, context);
    }

    /**
     * Log AI chat request with sanitized content
     */
    logAIChatRequest(requestId, message, context, metadata = {}) {
        const sanitizedMessage = this.sanitizeContent(message);
        const sanitizedContext = context.map(msg => ({
            ...msg,
            text: this.sanitizeContent(msg.text)
        }));

        this.info('AI Chat Request', {
            requestId,
            messageLength: message?.length || 0,
            messagePreview: sanitizedMessage.substring(0, 100) + (sanitizedMessage.length > 100 ? '...' : ''),
            contextMessages: context?.length || 0,
            ...metadata
        });

        this.debug('AI Chat Request Details', {
            requestId,
            sanitizedMessage,
            sanitizedContext,
            ...metadata
        });

        this.metrics.requests++;
    }

    /**
     * Log AI chat response with timing and success metrics
     */
    logAIChatResponse(requestId, success, responseTime, metadata = {}) {
        const message = success ? 'AI Chat Response Success' : 'AI Chat Response Failure';
        const logMethod = success ? 'info' : 'error';
        
        this[logMethod](message, {
            requestId,
            success,
            responseTime: `${responseTime}ms`,
            ...metadata
        });

        // Update metrics
        this.metrics.totalResponseTime += responseTime;
        if (success) {
            this.metrics.successes++;
        } else {
            this.metrics.failures++;
        }
    }

    /**
     * Log API call details with timing
     */
    logAPICall(requestId, endpoint, method, responseTime, statusCode, metadata = {}) {
        this.info('API Call', {
            requestId,
            endpoint,
            method,
            responseTime: `${responseTime}ms`,
            statusCode,
            ...metadata
        });
    }

    /**
     * Log error with full context information
     */
    logErrorWithContext(requestId, error, context = {}) {
        const errorContext = {
            requestId,
            errorMessage: error.message,
            errorStack: error.stack,
            errorCode: error.code,
            ...context
        };

        // Determine error type for metrics
        let errorType = 'unknown';
        if (error.code) {
            errorType = error.code;
        } else if (error.response?.status) {
            errorType = `http_${error.response.status}`;
        } else if (error.message.includes('timeout')) {
            errorType = 'timeout';
        } else if (error.message.includes('network')) {
            errorType = 'network';
        }

        this.error('Error with Context', {
            ...errorContext,
            errorType
        });
    }

    /**
     * Sanitize content for logging (remove sensitive information)
     */
    sanitizeContent(content) {
        if (!content || typeof content !== 'string') {
            return content;
        }

        // Remove potential sensitive patterns
        let sanitized = content
            // Remove email addresses
            .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]')
            // Remove phone numbers
            .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE]')
            // Remove potential API keys or tokens (long alphanumeric strings)
            .replace(/\b[A-Za-z0-9]{32,}\b/g, '[TOKEN]')
            // Remove potential URLs with sensitive info
            .replace(/https?:\/\/[^\s]+/g, '[URL]');

        return sanitized;
    }

    /**
     * Get current metrics summary
     */
    getMetrics() {
        const avgResponseTime = this.metrics.requests > 0 
            ? Math.round(this.metrics.totalResponseTime / this.metrics.requests)
            : 0;

        const successRate = this.metrics.requests > 0
            ? Math.round((this.metrics.successes / this.metrics.requests) * 100)
            : 0;

        return {
            totalRequests: this.metrics.requests,
            successes: this.metrics.successes,
            failures: this.metrics.failures,
            successRate: `${successRate}%`,
            averageResponseTime: `${avgResponseTime}ms`,
            errorBreakdown: Object.fromEntries(this.metrics.errors)
        };
    }

    /**
     * Log metrics summary
     */
    logMetrics() {
        const metrics = this.getMetrics();
        this.info('AI Chat Metrics Summary', metrics);
    }

    /**
     * Reset metrics (useful for periodic reporting)
     */
    resetMetrics() {
        this.metrics = {
            requests: 0,
            successes: 0,
            failures: 0,
            totalResponseTime: 0,
            errors: new Map()
        };
        this.info('Metrics reset');
    }
}

// Create singleton instance
const logger = new Logger();

module.exports = logger;