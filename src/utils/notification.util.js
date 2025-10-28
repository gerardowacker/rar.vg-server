const logger = require('./logger.util');

/**
 * Notification utility for storage failures and system alerts
 * Provides a centralized way to handle notifications for storage issues
 */
class NotificationManager {
    constructor() {
        this.notificationQueue = [];
        this.maxQueueSize = 100;
        this.alertThresholds = {
            r2FailureRate: 50, // Alert if R2 failure rate exceeds 50%
            fallbackUsageRate: 30, // Alert if fallback usage exceeds 30%
            consecutiveFailures: 5 // Alert after 5 consecutive failures
        };
        this.consecutiveFailures = {
            r2: 0,
            local: 0
        };
    }

    /**
     * Send storage failure notification
     * @param {string} storageType - Type of storage that failed ('r2' or 'local')
     * @param {string} operation - Operation that failed ('upload' or 'download')
     * @param {Error} error - The error that occurred
     * @param {Object} context - Additional context information
     */
    notifyStorageFailure(storageType, operation, error, context = {}) {
        const notification = {
            type: 'storage_failure',
            storageType,
            operation,
            error: error.message,
            timestamp: new Date().toISOString(),
            context,
            severity: this.determineSeverity(storageType, operation, error)
        };

        this.addNotification(notification);

        // Track consecutive failures
        this.consecutiveFailures[storageType]++;

        // Check if we need to create an alert
        if (this.consecutiveFailures[storageType] >= this.alertThresholds.consecutiveFailures) {
            this.createAlert('consecutive_failures', 'high', 
                `${this.consecutiveFailures[storageType]} consecutive failures in ${storageType} storage`,
                { storageType, operation, consecutiveCount: this.consecutiveFailures[storageType] }
            );
        }

        logger.logStorageError(operation, storageType, error, context);
    }

    /**
     * Send fallback usage notification
     * @param {string} operation - Operation type
     * @param {string} primaryStorage - Primary storage that failed
     * @param {string} fallbackStorage - Fallback storage used
     * @param {Error} primaryError - Error that caused fallback
     * @param {Object} context - Additional context
     */
    notifyFallbackUsage(operation, primaryStorage, fallbackStorage, primaryError, context = {}) {
        const notification = {
            type: 'fallback_usage',
            operation,
            primaryStorage,
            fallbackStorage,
            primaryError: primaryError.message,
            timestamp: new Date().toISOString(),
            context,
            severity: 'medium'
        };

        this.addNotification(notification);

        // Reset consecutive failures for fallback storage since it worked
        this.consecutiveFailures[fallbackStorage] = 0;

        logger.logStorageFallback(operation, primaryStorage, fallbackStorage, primaryError, context);
    }

    /**
     * Send storage success notification (resets failure counters)
     * @param {string} storageType - Type of storage that succeeded
     * @param {string} operation - Operation that succeeded
     * @param {Object} context - Additional context
     */
    notifyStorageSuccess(storageType, operation, context = {}) {
        // Reset consecutive failures on success
        this.consecutiveFailures[storageType] = 0;

        // Log success with metrics
        logger.logStorageOperation(operation, storageType, true, false, context);
    }

    /**
     * Send R2 availability change notification
     * @param {boolean} isAvailable - Current R2 availability status
     * @param {boolean} previousStatus - Previous availability status
     * @param {Object} context - Additional context
     */
    notifyR2AvailabilityChange(isAvailable, previousStatus, context = {}) {
        if (isAvailable === previousStatus) {
            return; // No change, no notification needed
        }

        const notification = {
            type: 'r2_availability_change',
            isAvailable,
            previousStatus,
            timestamp: new Date().toISOString(),
            context,
            severity: isAvailable ? 'low' : 'high'
        };

        this.addNotification(notification);

        const message = isAvailable 
            ? 'R2 storage is now available' 
            : 'R2 storage is no longer available';

        this.createAlert('r2_availability_change', notification.severity, message, {
            isAvailable,
            previousStatus,
            ...context
        });
    }

    /**
     * Create system alert
     * @param {string} alertType - Type of alert
     * @param {string} severity - Alert severity
     * @param {string} message - Alert message
     * @param {Object} context - Alert context
     */
    createAlert(alertType, severity, message, context = {}) {
        logger.createStorageAlert(alertType, severity, message, context);

        // In a production environment, this could:
        // - Send emails to administrators
        // - Post to Slack/Discord channels
        // - Trigger PagerDuty alerts
        // - Send push notifications
        // - Update monitoring dashboards

        // For now, we'll add it to our notification queue
        const alert = {
            type: 'alert',
            alertType,
            severity,
            message,
            timestamp: new Date().toISOString(),
            context
        };

        this.addNotification(alert);
    }

    /**
     * Add notification to queue
     * @param {Object} notification - Notification object
     * @private
     */
    addNotification(notification) {
        this.notificationQueue.push(notification);

        // Limit queue size
        if (this.notificationQueue.length > this.maxQueueSize) {
            this.notificationQueue.shift(); // Remove oldest notification
        }

        logger.debug('Notification added to queue', {
            type: notification.type,
            severity: notification.severity,
            queueSize: this.notificationQueue.length
        });
    }

    /**
     * Determine severity based on storage type, operation, and error
     * @param {string} storageType - Storage type
     * @param {string} operation - Operation type
     * @param {Error} error - Error object
     * @returns {string} Severity level
     * @private
     */
    determineSeverity(storageType, operation, error) {
        // Critical: Local storage failures (no fallback)
        if (storageType === 'local') {
            return 'critical';
        }

        // High: R2 failures that affect core functionality
        if (storageType === 'r2' && operation === 'upload') {
            return 'high';
        }

        // Medium: R2 download failures (can fallback to local)
        if (storageType === 'r2' && operation === 'download') {
            return 'medium';
        }

        // Check error type for additional severity determination
        if (error.message.includes('credentials') || error.message.includes('authentication')) {
            return 'critical';
        }

        if (error.message.includes('timeout') || error.message.includes('network')) {
            return 'medium';
        }

        return 'low';
    }

    /**
     * Get recent notifications
     * @param {number} limit - Maximum number of notifications to return
     * @returns {Array} Recent notifications
     */
    getRecentNotifications(limit = 10) {
        return this.notificationQueue
            .slice(-limit)
            .reverse(); // Most recent first
    }

    /**
     * Get notifications by type
     * @param {string} type - Notification type to filter by
     * @param {number} limit - Maximum number of notifications to return
     * @returns {Array} Filtered notifications
     */
    getNotificationsByType(type, limit = 10) {
        return this.notificationQueue
            .filter(notification => notification.type === type)
            .slice(-limit)
            .reverse();
    }

    /**
     * Clear notification queue
     */
    clearNotifications() {
        const clearedCount = this.notificationQueue.length;
        this.notificationQueue = [];
        
        logger.info('Notification queue cleared', {
            clearedCount,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Get notification statistics
     * @returns {Object} Notification statistics
     */
    getNotificationStats() {
        const stats = {
            total: this.notificationQueue.length,
            byType: {},
            bySeverity: {},
            consecutiveFailures: { ...this.consecutiveFailures }
        };

        this.notificationQueue.forEach(notification => {
            // Count by type
            stats.byType[notification.type] = (stats.byType[notification.type] || 0) + 1;
            
            // Count by severity
            if (notification.severity) {
                stats.bySeverity[notification.severity] = (stats.bySeverity[notification.severity] || 0) + 1;
            }
        });

        return stats;
    }

    /**
     * Check if system health is degraded based on notifications
     * @returns {Object} Health status information
     */
    getSystemHealthStatus() {
        const stats = this.getNotificationStats();
        const recentNotifications = this.getRecentNotifications(20);
        
        // Count recent critical/high severity notifications
        const recentCritical = recentNotifications.filter(n => 
            n.severity === 'critical' && 
            Date.now() - new Date(n.timestamp).getTime() < 300000 // Last 5 minutes
        ).length;

        const recentHigh = recentNotifications.filter(n => 
            n.severity === 'high' && 
            Date.now() - new Date(n.timestamp).getTime() < 300000 // Last 5 minutes
        ).length;

        let healthStatus = 'healthy';
        let healthMessage = 'All storage systems operating normally';

        if (recentCritical > 0) {
            healthStatus = 'critical';
            healthMessage = `${recentCritical} critical storage issues in the last 5 minutes`;
        } else if (recentHigh > 2) {
            healthStatus = 'degraded';
            healthMessage = `${recentHigh} high-priority storage issues in the last 5 minutes`;
        } else if (this.consecutiveFailures.r2 > 3 || this.consecutiveFailures.local > 1) {
            healthStatus = 'degraded';
            healthMessage = 'Consecutive storage failures detected';
        }

        return {
            status: healthStatus,
            message: healthMessage,
            timestamp: new Date().toISOString(),
            stats,
            recentCritical,
            recentHigh,
            consecutiveFailures: this.consecutiveFailures
        };
    }
}

// Create singleton instance
const notificationManager = new NotificationManager();

module.exports = notificationManager;