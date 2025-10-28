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
            errors: new Map(), // Error type -> count
            storage: {
                uploads: {
                    total: 0,
                    r2: 0,
                    local: 0,
                    fallbacks: 0,
                    failures: 0
                },
                downloads: {
                    total: 0,
                    r2: 0,
                    local: 0,
                    fallbacks: 0,
                    failures: 0
                },
                r2Availability: {
                    checks: 0,
                    successes: 0,
                    failures: 0,
                    lastCheck: null,
                    lastStatus: null
                }
            }
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
     * Log storage operation with metrics tracking
     * @param {string} operation - Operation type ('upload' or 'download')
     * @param {string} storageLocation - Storage location ('r2' or 'local')
     * @param {boolean} success - Whether operation was successful
     * @param {boolean} fallbackUsed - Whether fallback storage was used
     * @param {Object} context - Additional context information
     */
    logStorageOperation(operation, storageLocation, success, fallbackUsed = false, context = {}) {
        const operationType = operation.toLowerCase();
        
        // Update metrics
        if (this.metrics.storage[operationType + 's']) {
            const opMetrics = this.metrics.storage[operationType + 's'];
            opMetrics.total++;
            
            if (success) {
                opMetrics[storageLocation]++;
                if (fallbackUsed) {
                    opMetrics.fallbacks++;
                }
            } else {
                opMetrics.failures++;
            }
        }

        // Log the operation
        const logLevel = success ? 'info' : 'error';
        const message = `Storage ${operation} ${success ? 'successful' : 'failed'}`;
        
        this[logLevel](message, {
            operation,
            storageLocation,
            success,
            fallbackUsed,
            ...context
        });
    }

    /**
     * Log R2 availability check with metrics tracking
     * @param {boolean} available - Whether R2 is available
     * @param {number} responseTime - Response time in milliseconds
     * @param {Object} context - Additional context information
     */
    logR2AvailabilityCheck(available, responseTime, context = {}) {
        const r2Metrics = this.metrics.storage.r2Availability;
        r2Metrics.checks++;
        r2Metrics.lastCheck = new Date().toISOString();
        r2Metrics.lastStatus = available;
        
        if (available) {
            r2Metrics.successes++;
        } else {
            r2Metrics.failures++;
        }

        const logLevel = available ? 'debug' : 'warn';
        const message = `R2 availability check: ${available ? 'Available' : 'Unavailable'}`;
        
        this[logLevel](message, {
            available,
            responseTime: `${responseTime}ms`,
            successRate: r2Metrics.checks > 0 ? Math.round((r2Metrics.successes / r2Metrics.checks) * 100) : 0,
            ...context
        });
    }

    /**
     * Log storage fallback usage with detailed context
     * @param {string} operation - Operation type
     * @param {string} primaryStorage - Primary storage that failed
     * @param {string} fallbackStorage - Fallback storage used
     * @param {Error} primaryError - Error that caused fallback
     * @param {Object} context - Additional context
     */
    logStorageFallback(operation, primaryStorage, fallbackStorage, primaryError, context = {}) {
        this.warn(`Storage fallback used: ${operation}`, {
            operation,
            primaryStorage,
            fallbackStorage,
            primaryError: primaryError.message,
            errorType: 'storage_fallback',
            monitoring: {
                fallbackUsed: true,
                operation,
                primaryStorage,
                fallbackStorage,
                reason: primaryError.name || 'unknown'
            },
            ...context
        });

        // Track fallback in metrics
        const operationType = operation.toLowerCase();
        if (this.metrics.storage[operationType + 's']) {
            this.metrics.storage[operationType + 's'].fallbacks++;
        }
    }

    /**
     * Log storage error with enhanced context and monitoring hooks
     * @param {string} operation - Operation type
     * @param {string} storageLocation - Storage location where error occurred
     * @param {Error} error - The error that occurred
     * @param {Object} context - Additional context
     */
    logStorageError(operation, storageLocation, error, context = {}) {
        // Determine error category for better monitoring
        let errorCategory = 'unknown';
        if (error.code) {
            errorCategory = error.code;
        } else if (error.message.includes('timeout')) {
            errorCategory = 'timeout';
        } else if (error.message.includes('network')) {
            errorCategory = 'network';
        } else if (error.message.includes('credentials')) {
            errorCategory = 'authentication';
        } else if (error.message.includes('permission')) {
            errorCategory = 'authorization';
        } else if (error.message.includes('not found')) {
            errorCategory = 'not_found';
        }

        this.error(`Storage ${operation} error in ${storageLocation}`, {
            operation,
            storageLocation,
            errorCategory,
            errorMessage: error.message,
            errorCode: error.code,
            errorStack: error.stack,
            errorType: 'storage_operation_error',
            monitoring: {
                storageError: true,
                operation,
                storageLocation,
                errorCategory
            },
            ...context
        });

        // Track error in metrics
        const errorKey = `${storageLocation}_${errorCategory}`;
        this.metrics.errors.set(errorKey, (this.metrics.errors.get(errorKey) || 0) + 1);
    }

    /**
     * Get comprehensive storage metrics
     * @returns {Object} Storage metrics summary
     */
    getStorageMetrics() {
        const storage = this.metrics.storage;
        
        return {
            uploads: {
                total: storage.uploads.total,
                r2: storage.uploads.r2,
                local: storage.uploads.local,
                fallbacks: storage.uploads.fallbacks,
                failures: storage.uploads.failures,
                successRate: storage.uploads.total > 0 
                    ? Math.round(((storage.uploads.total - storage.uploads.failures) / storage.uploads.total) * 100)
                    : 0,
                fallbackRate: storage.uploads.total > 0
                    ? Math.round((storage.uploads.fallbacks / storage.uploads.total) * 100)
                    : 0
            },
            downloads: {
                total: storage.downloads.total,
                r2: storage.downloads.r2,
                local: storage.downloads.local,
                fallbacks: storage.downloads.fallbacks,
                failures: storage.downloads.failures,
                successRate: storage.downloads.total > 0
                    ? Math.round(((storage.downloads.total - storage.downloads.failures) / storage.downloads.total) * 100)
                    : 0,
                fallbackRate: storage.downloads.total > 0
                    ? Math.round((storage.downloads.fallbacks / storage.downloads.total) * 100)
                    : 0
            },
            r2Availability: {
                checks: storage.r2Availability.checks,
                successes: storage.r2Availability.successes,
                failures: storage.r2Availability.failures,
                successRate: storage.r2Availability.checks > 0
                    ? Math.round((storage.r2Availability.successes / storage.r2Availability.checks) * 100)
                    : 0,
                lastCheck: storage.r2Availability.lastCheck,
                lastStatus: storage.r2Availability.lastStatus
            }
        };
    }

    /**
     * Log comprehensive storage metrics summary
     */
    logStorageMetrics() {
        const metrics = this.getStorageMetrics();
        this.info('Storage Metrics Summary', metrics);
    }

    /**
     * Create monitoring alert for storage issues
     * @param {string} alertType - Type of alert
     * @param {string} severity - Alert severity ('low', 'medium', 'high', 'critical')
     * @param {string} message - Alert message
     * @param {Object} context - Alert context
     */
    createStorageAlert(alertType, severity, message, context = {}) {
        const alert = {
            alertType,
            severity,
            message,
            timestamp: new Date().toISOString(),
            context,
            monitoring: {
                alert: true,
                alertType,
                severity
            }
        };

        // Log at appropriate level based on severity
        const logLevel = severity === 'critical' ? 'error' : 
                        severity === 'high' ? 'error' :
                        severity === 'medium' ? 'warn' : 'info';

        this[logLevel](`Storage Alert [${severity.toUpperCase()}]: ${message}`, alert);

        // In a production environment, this could trigger external monitoring systems
        // For now, we'll just ensure it's prominently logged
        if (severity === 'critical' || severity === 'high') {
            console.error(`🚨 STORAGE ALERT [${severity.toUpperCase()}]: ${message}`);
        }
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
            errors: new Map(),
            storage: {
                uploads: {
                    total: 0,
                    r2: 0,
                    local: 0,
                    fallbacks: 0,
                    failures: 0
                },
                downloads: {
                    total: 0,
                    r2: 0,
                    local: 0,
                    fallbacks: 0,
                    failures: 0
                },
                r2Availability: {
                    checks: 0,
                    successes: 0,
                    failures: 0,
                    lastCheck: null,
                    lastStatus: null
                }
            }
        };
        this.info('Metrics reset');
    }
}

// Create singleton instance
const logger = new Logger();

module.exports = logger;