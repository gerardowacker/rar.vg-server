const path = require('path')
const root = path.normalize(path.join(path.dirname(require.main.filename), '..'))

module.exports = class FileController
{
    constructor(sessionController)
    {
        this.sessionController = sessionController
    }

    upload(files, token, clientToken, avatar)
    {
        return new Promise(res =>
        {
            if (!files || Object.keys(files).length === 0)
            {
                res({
                    status: 400,
                    content: "No files were uploaded."
                })
            }

            this.sessionController.validate(token, clientToken).then(sessionResult =>
            {
                if (sessionResult.status !== 200)
                    return res(sessionResult)

                const file = files.theFile;
                const fileExtension = file.name.split(".").pop()
                const newFileName = this.#generateString() + '.' + fileExtension
                let uploadPath;
                if (fileExtension !== "png" && fileExtension !== "jpg" && fileExtension !== "webp" && fileExtension !== "pdf")
                    return res({
                        status: 400,
                        content: "File format is not allowed."
                    })
                if (avatar)
                {
                    const id = sessionResult.content.id
                    uploadPath = root + '/public/avatars/' + id + '.png';
                }
                else
                {
                    uploadPath = root + '/public/userfiles/' + newFileName;
                }

                file.mv(uploadPath, err =>
                {
                    if (err)
                        return res({
                            status: 500,
                            content: err
                        })

                    res({
                        status: 200,
                        content: newFileName
                    })
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