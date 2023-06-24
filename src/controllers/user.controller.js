const User = require('../models/user.model')
const bcrypt = require('bcrypt')

class UserController
{
    verificationTokens = new Map()

    constructor(sessionController, emailController)
    {
        this.sessionController = sessionController
        this.emailController = emailController
    }

    getProfile(username)
    {
        return new Promise(async res =>
        {
            User.findOne({username: username}).then(user =>
            {
                if (!user)
                    return res({
                        status: 404,
                        content: 'There is no user with that username.'
                    })

                // Why would you want this? (ര _ ര )
                delete user.email
                delete user.password
                delete user.dateOfBirth

                // Create a non-proprietary Object using the User class' instance, because JS sucks.
                const {...userObj} = user

                res({
                    status: 200,
                    content: userObj
                })
            })
        })
    }

    login(data)
    {
        return new Promise(res =>
        {
            if (!data.email || !data.password)
                return res({
                    status: 400,
                    content: 'Missing parameters'
                })
            User.findOne({email: data.email}).then(user =>
            {
                if (!user)
                    return res({
                        status: 403,
                        content: 'The provided email or password are incorrect.'
                    })
                bcrypt.compare(data.password, user.password, (err, result) =>
                {
                    if (err) return res({
                        status: 500,
                        content: "There was an error while logging in. [u1]"
                    })
                    if (!result) return res({
                        status: 403,
                        content: "The provided email or password are incorrect."
                    })
                    this.sessionController.generate(user.id, null).then(session =>
                    {
                        if (session.status !== 200)
                            return res(session)
                        res({
                            status: 200,
                            content: {
                                token: session.content.token,
                                clientToken: session.content.clientToken,
                                user: {
                                    id: user.id,
                                    username: user.username,
                                    displayName: user.displayName,
                                    components: user.components,
                                    sociallinks: user.sociallinks
                                }
                            }
                        })
                    })
                })
            })
        })
    }

    register(data)
    {
        return new Promise(async res =>
        {
            if (!data.username || !data.email || !data.password || !data.dateOfBirth || !data.displayName)
                return res({
                    status: 400,
                    content: 'Missing parameters'
                })
            User.findOne({username: data.username.toLowerCase()}, {email: data.email.toLowerCase()}).then(user =>
            {
                if (user)
                {
                    return res({
                        status: 400,
                        content: {
                            // Since we checked for both email and username, we return which one of them is (or if both
                            // are) already in the database.
                            email: user.email === data.email.toLowerCase(),
                            username: user.username === data.username.toLowerCase()
                        }
                    })
                }
                bcrypt.hash(data.password.trim(), 5, (err, hash) =>
                {
                    if (err)
                        return res({
                            status: 500,
                            content: 'There was an error while creating the account. [u2]'
                        })

                    // Generate verification token
                    const verificationToken = this.#generateString(32)
                    this.verificationTokens.set(verificationToken, {
                        username: data.username.toLowerCase(),
                        password: hash,
                        displayName: data.displayName,
                        email: data.email.toLowerCase(),
                        creationDate: new Date(Date.now()).toISOString().split('T')[0],
                        dateOfBirth: data.dateOfBirth
                    })

                    this.emailController.connect().then(conn => conn.send('Verify your rar.vg account',
                        'Thank you for registering!\nTo verify your account, click on this link: https://www.rar.vg/verify?vt=' + verificationToken,
                        data.email.toLowerCase()).then(result =>
                    {
                        return res({
                            status: 200,
                            content: {response: 'The email was sent successfully.'}
                        })
                    }))
                })
            })
        })
    }

    verifyAccount(token)
    {
        return new Promise(res =>
        {
            if (!this.verificationTokens.has(token))
                return res({
                    status: 403,
                    content: 'The provided token is invalid.'
                })

            const user = this.verificationTokens.get(token)

            User.findOne({username: user.username}, {email: user.email}).then(u =>
            {
                if (u)
                {
                    return res({
                        status: 400,
                        content: 'While you were verifying your account, another user has registered with those credentials.'
                    })
                }

                const newUser = new User(null, user.username, user.password, user.displayName, user.email,
                    user.creationDate, user.dateOfBirth, [], [])
                newUser.insert().then((result, err) =>
                {
                    if (err)
                        return res({
                            status: 500,
                            content: 'There was an error while creating the account. [u3]'
                        })

                    this.verificationTokens.delete(token)

                    return res({
                        status: 200,
                        content: {response: 'The user was verified successfully.'}
                    })
                })
            })
        })
    }


    updateProfile(token, clientToken, components, sociallinks)
    {
        return new Promise(res =>
        {
            if (!components || !token || !clientToken)
                return res({
                    status: 400,
                    content: 'Missing parameters.'
                })
            try
            {
                this.sessionController.validate(token, clientToken).then(sessionResult =>
                {
                    if (sessionResult.status !== 200)
                        return res(sessionResult)
                    User.findOne({id: sessionResult.content.id}).then(user =>
                    {
                        if (!user)
                            return res({
                                status: 500,
                                content: 'There was an error within the current session. Please log in again.'
                            })
                        user.update({components: components, sociallinks: sociallinks}).then(updateResult =>
                        {
                            if (updateResult.status !== 200)
                                return res(updateResult)
                            res({
                                status: 200,
                                content: {token: token, message: 'Updated successfully.'}
                            })
                        })
                    })
                })
            }
            catch (err)
            {
                console.log(err)
                return res({
                    status: 500,
                    content: 'An unknown error has occurred.'
                })
            }
        })
    }

    getUser(token, clientToken)
    {
        return new Promise(res =>
        {
            if (!token || !clientToken)
                return res({
                    status: 400,
                    content: 'Missing parameters.'
                })
            try
            {
                this.sessionController.validate(token, clientToken).then(sessionResult =>
                {
                    if (sessionResult.status !== 200)
                        return res(sessionResult)
                    User.findOne({id: sessionResult.content.id}).then(user =>
                    {
                        if (!user)
                            return res({
                                status: 500,
                                content: 'There was an error within the current session. Please log in again.'
                            })
                        delete user.password
                        return res({
                            status: 200,
                            content: {token: token, user: user}
                        })
                    })
                })
            }
            catch (err)
            {
                return res({
                    status: 500,
                    content: 'An unknown error has occurred.'
                })
            }
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

module.exports = UserController