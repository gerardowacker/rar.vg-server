module.exports = class FileController
{
    upload(files, session, avatar)
    {
        return new Promise(resolve =>
        {
            if (!files || Object.keys(files).length === 0)
            {
                resolve({
                    status: 400,
                    content: "No files were uploaded."
                })
            }

            // TODO: Check for session token in here. Should be able to work for now, but needs to
            // include everything authentication when it's implemented.

            const file = files.theFile;
            const fileExtension = file.split(".").pop()
            const newFileName = this.#generateString() + '.' + fileExtension
            let uploadPath;
            if (fileExtension !== "png" && fileExtension !== "jpg" && fileExtension !== "webp" && fileExtension !== "pdf")
                resolve({
                    status: 400,
                    content: "File format is not allowed."
                })
            if (avatar)
            {
                const id = 0 // Will get everything done once session parsing is implemented.
                uploadPath = __dirname + '/public/avatars/' + id + '.' + fileExtension;
            }
            else
            {
                uploadPath = __dirname + '/public/userfiles/' + newFileName;
            }

            file.mv(uploadPath, err =>
            {
                if (err)
                    resolve({
                        status: 500,
                        content: err
                    })

                resolve({
                    status: 200,
                    content: newFileName
                })
            })
        })
    }

    #generateString()
    {
        let result = '';
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
        const charactersLength = characters.length;
        let counter = 0;
        while (counter < 11)
        {
            result += characters.charAt(Math.floor(Math.random() * charactersLength));
            counter += 1;
        }
        return result;
    }

}