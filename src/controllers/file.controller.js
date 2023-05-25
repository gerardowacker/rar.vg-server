module.exports = class FileController
{
    upload(files, session)
    {
        return new Promise(resolve =>
        {
            if (!files || Object.keys(files).length === 0)
            {
                resolve({
                    status: 400,
                    "content": "No files were uploaded"
                })
            }

            // TODO: Check for session token in here. Should be able to work for now, but needs to
            // include everything authentication when it's implemented.

            const file = files.theFile;
            const newFileName = this.#generateString() + '.' + file.split(".").pop()
            const uploadPath = __dirname + '/public/userfiles/' + newFileName;

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