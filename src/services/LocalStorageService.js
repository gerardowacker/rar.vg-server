const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const logger = require('../utils/logger.util');

/**
 * LocalStorageService - Handles local file system storage operations
 * Provides fallback storage functionality wrapping existing file operations
 */
class LocalStorageService {
    constructor() {
        // Get the root directory (same pattern as FileController)
        this.root = path.normalize(path.join(path.dirname(require.main.filename), '..'));
        this.avatarsPath = path.join(this.root, 'public', 'avatars');
        this.userfilesPath = path.join(this.root, 'public', 'userfiles');
        
        logger.info('LocalStorageService initialized', {
            root: this.root,
            avatarsPath: this.avatarsPath,
            userfilesPath: this.userfilesPath
        });
    }

    /**
     * Generate file path for local storage
     * @param {string} filename - Filename
     * @param {string} type - File type ('avatar' or 'upload')
     * @param {string} userId - User ID (for avatars)
     * @returns {string} Complete file path
     */
    getFilePath(filename, type = 'upload', userId = null) {
        if (type === 'avatar') {
            if (!userId) {
                throw new Error('User ID is required for avatar file paths');
            }
            return path.join(this.avatarsPath, `${userId}.png`);
        } else {
            return path.join(this.userfilesPath, filename);
        }
    }

    /**
     * Check if file exists in local storage
     * @param {string} filePath - Complete file path to check
     * @returns {Promise<boolean>} True if file exists
     */
    async fileExists(filePath) {
        try {
            await fs.access(filePath, fsSync.constants.F_OK);
            return true;
        } catch (error) {
            if (error.code === 'ENOENT') {
                return false;
            }
            
            logger.error('Error checking file existence in local storage', {
                filePath,
                error: error.message,
                errorCode: error.code,
                errorType: 'local_file_check_error'
            });
            
            // On other errors, assume file doesn't exist to be safe
            return false;
        }
    }

    /**
     * Check if file exists by filename and type
     * @param {string} filename - Filename to check
     * @param {string} type - File type ('avatar' or 'upload')
     * @param {string} userId - User ID (for avatars)
     * @returns {Promise<boolean>} True if file exists
     */
    async fileExistsByName(filename, type = 'upload', userId = null) {
        const filePath = this.getFilePath(filename, type, userId);
        return await this.fileExists(filePath);
    }

    /**
     * Upload file to local storage
     * @param {Buffer|Uint8Array} fileData - File data to write
     * @param {string} filename - Target filename
     * @param {Object} options - Upload options
     * @param {string} options.type - File type ('avatar' or 'upload')
     * @param {string} options.userId - User ID (required for avatars)
     * @returns {Promise<Object>} Upload result
     */
    async uploadFile(fileData, filename, options = {}) {
        const { type = 'upload', userId = null } = options;
        
        try {
            const filePath = this.getFilePath(filename, type, userId);
            
            // Ensure directory exists
            const directory = path.dirname(filePath);
            await fs.mkdir(directory, { recursive: true });
            
            logger.info('Starting local file upload', {
                filename,
                filePath,
                type,
                userId,
                fileSize: fileData.length
            });

            // Write file to local storage
            await fs.writeFile(filePath, fileData);

            const uploadResult = {
                success: true,
                filePath,
                filename,
                type,
                userId,
                size: fileData.length,
                uploadDate: new Date().toISOString()
            };

            logger.info('Local file upload successful', {
                filename,
                filePath,
                type,
                size: fileData.length
            });

            return uploadResult;

        } catch (error) {
            logger.error('Local file upload failed', {
                filename,
                type,
                userId,
                error: error.message,
                errorCode: error.code,
                errorType: 'local_upload_error'
            });
            throw error;
        }
    }

    /**
     * Upload avatar file with specific handling
     * @param {string} userId - User ID
     * @param {Buffer|Uint8Array} imageData - Avatar image data
     * @returns {Promise<Object>} Upload result
     */
    async uploadAvatar(userId, imageData) {
        return await this.uploadFile(imageData, 'avatar.png', {
            type: 'avatar',
            userId
        });
    }

    /**
     * Upload regular file
     * @param {Buffer|Uint8Array} fileData - File data
     * @param {string} filename - Target filename
     * @returns {Promise<Object>} Upload result
     */
    async uploadRegularFile(fileData, filename) {
        return await this.uploadFile(fileData, filename, {
            type: 'upload'
        });
    }

    /**
     * Read file from local storage
     * @param {string} filePath - Complete file path
     * @returns {Promise<Buffer>} File data
     */
    async readFile(filePath) {
        try {
            logger.debug('Reading file from local storage', { filePath });
            
            const fileData = await fs.readFile(filePath);
            
            logger.debug('Local file read successful', {
                filePath,
                size: fileData.length
            });
            
            return fileData;
            
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.debug('File not found in local storage', { filePath });
                throw new Error(`File not found: ${path.basename(filePath)}`);
            }
            
            logger.error('Local file read failed', {
                filePath,
                error: error.message,
                errorCode: error.code,
                errorType: 'local_read_error'
            });
            throw error;
        }
    }

    /**
     * Get file data by filename and type
     * @param {string} filename - Filename to read
     * @param {string} type - File type ('avatar' or 'upload')
     * @param {string} userId - User ID (for avatars)
     * @returns {Promise<Object>} File data and metadata
     */
    async getFile(filename, type = 'upload', userId = null) {
        try {
            const filePath = this.getFilePath(filename, type, userId);
            const fileData = await this.readFile(filePath);
            
            // Get file stats for metadata
            const stats = await fs.stat(filePath);
            
            const result = {
                success: true,
                fileData,
                metadata: {
                    filename,
                    filePath,
                    type,
                    userId,
                    size: stats.size,
                    lastModified: stats.mtime,
                    created: stats.birthtime
                }
            };

            logger.info('Local file retrieval successful', {
                filename,
                filePath,
                type,
                size: stats.size
            });

            return result;

        } catch (error) {
            logger.error('Local file retrieval failed', {
                filename,
                type,
                userId,
                error: error.message,
                errorType: 'local_retrieval_error'
            });
            throw error;
        }
    }

    /**
     * Get avatar data for a specific user
     * @param {string} userId - User ID
     * @returns {Promise<Object|null>} Avatar data or null if not found
     */
    async getAvatar(userId) {
        try {
            return await this.getFile('avatar.png', 'avatar', userId);
        } catch (error) {
            if (error.message.includes('File not found')) {
                logger.debug('Avatar not found in local storage', { userId });
                return null;
            }
            throw error;
        }
    }

    /**
     * Get file stream for efficient streaming to client
     * @param {string} filename - Filename to stream
     * @param {string} type - File type ('avatar' or 'upload')
     * @param {string} userId - User ID (for avatars)
     * @returns {Promise<Object>} Stream and metadata
     */
    async getFileStream(filename, type = 'upload', userId = null) {
        try {
            const filePath = this.getFilePath(filename, type, userId);
            
            // Check if file exists first
            const exists = await this.fileExists(filePath);
            if (!exists) {
                throw new Error(`File not found: ${filename}`);
            }
            
            // Get file stats for metadata
            const stats = await fs.stat(filePath);
            
            // Create readable stream
            const stream = fsSync.createReadStream(filePath);
            
            const result = {
                success: true,
                stream,
                metadata: {
                    filename,
                    filePath,
                    type,
                    userId,
                    size: stats.size,
                    lastModified: stats.mtime,
                    created: stats.birthtime
                }
            };

            logger.info('Local file stream initiated', {
                filename,
                filePath,
                type,
                size: stats.size
            });

            return result;

        } catch (error) {
            logger.error('Local file stream failed', {
                filename,
                type,
                userId,
                error: error.message,
                errorType: 'local_stream_error'
            });
            throw error;
        }
    }

    /**
     * Delete file from local storage
     * @param {string} filename - Filename to delete
     * @param {string} type - File type ('avatar' or 'upload')
     * @param {string} userId - User ID (for avatars)
     * @returns {Promise<Object>} Deletion result
     */
    async deleteFile(filename, type = 'upload', userId = null) {
        try {
            const filePath = this.getFilePath(filename, type, userId);
            
            logger.info('Starting local file deletion', {
                filename,
                filePath,
                type,
                userId
            });

            await fs.unlink(filePath);

            const deleteResult = {
                success: true,
                filename,
                filePath,
                type,
                userId,
                deletedAt: new Date().toISOString()
            };

            logger.info('Local file deletion successful', {
                filename,
                filePath,
                type
            });

            return deleteResult;

        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.debug('File not found for deletion in local storage', {
                    filename,
                    type,
                    userId
                });
                // Return success even if file doesn't exist (idempotent operation)
                return {
                    success: true,
                    filename,
                    type,
                    userId,
                    deletedAt: new Date().toISOString(),
                    note: 'File did not exist'
                };
            }

            logger.error('Local file deletion failed', {
                filename,
                type,
                userId,
                error: error.message,
                errorCode: error.code,
                errorType: 'local_delete_error'
            });
            throw error;
        }
    }

    /**
     * Get file metadata without reading the file
     * @param {string} filename - Filename
     * @param {string} type - File type ('avatar' or 'upload')
     * @param {string} userId - User ID (for avatars)
     * @returns {Promise<Object|null>} File metadata or null if not found
     */
    async getFileMetadata(filename, type = 'upload', userId = null) {
        try {
            const filePath = this.getFilePath(filename, type, userId);
            
            const stats = await fs.stat(filePath);
            
            const metadata = {
                filename,
                filePath,
                type,
                userId,
                size: stats.size,
                lastModified: stats.mtime,
                created: stats.birthtime,
                isDirectory: stats.isDirectory(),
                isFile: stats.isFile()
            };

            logger.debug('Local file metadata retrieved', {
                filename,
                filePath,
                type,
                size: stats.size
            });

            return metadata;

        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.debug('File metadata not found in local storage', {
                    filename,
                    type,
                    userId
                });
                return null;
            }

            logger.error('Local file metadata retrieval failed', {
                filename,
                type,
                userId,
                error: error.message,
                errorCode: error.code,
                errorType: 'local_metadata_error'
            });
            throw error;
        }
    }

    /**
     * Generate a random string for filenames (same as FileController)
     * @param {number} length - Length of the string (default: 11)
     * @returns {string} Random string
     */
    generateString(length = 11) {
        let result = '';
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
        const charactersLength = characters.length;
        let counter = 0;
        while (counter < length) {
            result += characters.charAt(Math.floor(Math.random() * charactersLength));
            counter += 1;
        }
        return result;
    }

    /**
     * Generate a new filename with extension
     * @param {string} originalFilename - Original filename with extension
     * @returns {string} Generated filename with original extension
     */
    generateFilename(originalFilename) {
        const fileExtension = originalFilename.split('.').pop();
        const newFileName = this.generateString() + '.' + fileExtension;
        return newFileName;
    }

    /**
     * Get service status and configuration
     * @returns {Object} Service status information
     */
    getStatus() {
        return {
            isAvailable: true,
            storageMode: 'local',
            root: this.root,
            avatarsPath: this.avatarsPath,
            userfilesPath: this.userfilesPath,
            type: 'LocalStorageService'
        };
    }

    /**
     * Log current service status
     */
    logStatus() {
        const status = this.getStatus();
        logger.info('=== LocalStorageService Status ===');
        logger.info(`Available: ${status.isAvailable}`);
        logger.info(`Storage Mode: ${status.storageMode}`);
        logger.info(`Root: ${status.root}`);
        logger.info(`Avatars Path: ${status.avatarsPath}`);
        logger.info(`Userfiles Path: ${status.userfilesPath}`);
        logger.info('==================================');
    }
}

module.exports = LocalStorageService;