const Session = require('../models/session.model')
const {v4: uuid} = require('uuid')

class SessionController
{
    generate(userId, previousToken)
    {
        return new Promise(res =>
        {
            // Generate tokens.
            let token = this.#generateString(32)

            Session.findOne({token: token}).then(session =>
            {
                if (session)
                    token = this.#generateString(32)
            })

            const clientToken = previousToken || uuid()
            const date = new Date()
            date.setDate(date.getDate() + 8);

            const expires = date.toISOString().split("T")[0]

            const session = new Session(null, token, expires, clientToken, userId)
            session.insert().then((result, err) =>
            {
                if (err)
                    return res({
                        status: 500,
                        content: 'There was an error while generating the session [s1]'
                    })
                res({
                    status: 200,
                    content: {
                        token: token,
                        clientToken: clientToken
                    }
                })
            })
        })
    }

    validate(token, clientToken)
    {
        return new Promise(res =>
            {
                Session.findOne({token: token}).then(session =>
                {
                    if (!session)
                        return res({
                            status: 400,
                            content: 'Invalid token. Log in again.'
                        })
                    const expiresDate = new Date(session.expires)
                    // Check for expired tokens.
                    if (Date.now() > expiresDate)
                    {
                        // We want those tokens freeeeshh~~
                        this.refresh(session, clientToken).then(result =>
                        {
                            if (result.status !== 200)
                            {
                                return res(result)
                            }
                            res({
                                status: 200,
                                content: {
                                    id: session.User_id,
                                    token: result.content.token,
                                }
                            })
                        })
                    }
                    else
                    {
                        res({
                            status: 200,
                            content: {
                                id: session.User_id,
                                token: token,
                            }
                        })
                    }
                })
            }
        )
    }

    refresh(session, clientToken)
    {
        return new Promise(res =>
        {
            if (session.clientToken !== clientToken)
            {
                return res({
                    status: 400,
                    content: 'Client tokens do not match.'
                })
            }
            this.generate(session.User_id, clientToken).then(result =>
            {
                if (result.status !== 200)
                {
                    return res(result)
                }
                session.delete()
                res({
                    status: 200,
                    content: {
                        token: result.content.token,
                        clientToken: result.content.clientToken
                    }
                })
            })
        })
    }

    #generateString(length)
    {
        let result = '';
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
        const charactersLength = characters.length;
        let counter = 0;
        while (counter < length)
        {
            result += characters.charAt(Math.floor(Math.random() * charactersLength));
            counter += 1;
        }
        return result;
    }

}

module.exports = SessionController