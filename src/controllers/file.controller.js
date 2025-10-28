module.exports = class FileController {
    constructor(sessionController, storageManager) {
        this.sessionController = sessionController
        this.storageManager = storageManager
    }

    upload(files, token, clientToken, avatar) {
        return new Promise(async (res) => {
            try {
                // Validate input
                if (!files || Object.keys(files).length === 0) {
                    return res({
                        status: 400,
                        content: "No files were uploaded."
                    })
                }

                // Validate session
                const sessionResult = await this.sessionController.validate(token, clientToken)
                if (sessionResult.status !== 200)
                    return res(sessionResult)

                const file = files.theFile;
                const fileExtension = file.name.split(".").pop().toLowerCase()
                const userId = sessionResult.content.id

                // Validate file format
                const allowedExtensions = ["jpeg", "png", "jpg", "webp", "pdf"]
                if (!allowedExtensions.includes(fileExtension)) {
                    return res({
                        status: 400,
                        content: "File format is not allowed."
                    })
                }

                // Additional validation for avatar files
                if (avatar) {
                    const avatarExtensions = ["jpeg", "png", "jpg", "webp"]
                    if (!avatarExtensions.includes(fileExtension)) {
                        return res({
                            status: 400,
                            content: "File format is not allowed."
                        })
                    }
                }

                // Additional validation for regular files
                if (!avatar) {
                    const regularExtensions = ["png", "jpg", "webp", "pdf"]
                    if (!regularExtensions.includes(fileExtension)) {
                        return res({
                            status: 400,
                            content: "File format is not allowed."
                        })
                    }
                }

                // Determine content type
                let contentType = 'application/octet-stream'
                switch (fileExtension) {
                    case 'png':
                        contentType = 'image/png'
                        break
                    case 'jpg':
                    case 'jpeg':
                        contentType = 'image/jpeg'
                        break
                    case 'webp':
                        contentType = 'image/webp'
                        break
                    case 'pdf':
                        contentType = 'application/pdf'
                        break
                }

                // Prepare file data for upload
                const fileData = file.data

                if (avatar) {
                    // Upload avatar using StorageManager
                    await this.storageManager.uploadAvatar(userId, fileData, contentType)

                    return res({
                        status: 200,
                        content: 'Uploaded successfully.'
                    })
                } else {
                    // Generate new filename for regular uploads
                    const newFileName = this.#generateString() + '.' + fileExtension

                    // Upload regular file using StorageManager
                    await this.storageManager.uploadRegularFile(
                        userId,
                        fileData,
                        newFileName,
                        contentType,
                        {
                            metadata: {
                                originalName: file.name,
                                uploadedAt: new Date().toISOString()
                            }
                        }
                    )

                    return res({
                        status: 200,
                        content: newFileName
                    })
                }

            } catch (error) {
                // Enhanced error handling
                console.error('File upload error:', error)

                // Check if it's a storage-related error
                if (error.message && error.message.includes('storage')) {
                    return res({
                        status: 503,
                        content: "Storage service temporarily unavailable. Please try again later."
                    })
                }

                return res({
                    status: 500,
                    content: "An error occurred during file upload."
                })
            }
        })
    }

    #generateString() {
        let result = '';
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
        const charactersLength = characters.length;
        let counter = 0;
        while (counter < 11) {
            result += characters.charAt(Math.floor(Math.random() * charactersLength));
            counter += 1;
        }
        return result;
    }

}
