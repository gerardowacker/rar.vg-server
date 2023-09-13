const User = require('../models/user.model')
const bcrypt = require('bcrypt')

class UserController
{
    verificationTokens = new Map()
    passwordResetTokens = new Map()
    deletionTokens = new Map()

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
                                    sociallinks: user.sociallinks,
                                    profileDesign: user.profileDesign
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

    requestPasswordChange(email)
    {
        return new Promise(res =>
        {
            if (!email)
                return res({status: 400, content: "Missing email."})

            User.findOne({email: email}).then(user =>
            {
                if (user)
                {
                    const resetToken = this.#generateString(32)
                    this.passwordResetTokens.set(resetToken, user.id)

                    this.emailController.connect().then(client =>
                    {
                        client.send('Reset your rar.vg password',
                            'A password change to the rar.vg account associated with this email has been requested.\n' +
                            'If it wasn\'t you, ignore this email.\n' +
                            'If it was you, use the following link to reset your password: https://www.rar.vg/change-password?t=' + resetToken,
                            email)
                    })
                }

                return res({
                    status: 200,
                    content: {response: 'If an account is associated with that address, an email with the request has been sent.'}
                })
            })
        })
    }

    verifyPasswordToken(token)
    {
        return new Promise(res =>
        {
            if (!this.passwordResetTokens.has(token))
                return res({
                    status: 403,
                    content: "The provided token is invalid. Request a new password change."
                })

            return res({
                status: 200,
                content: {response: 'Curiosity killed the cat'}
            })
        })
    }

    updatePassword(token, password)
    {
        return new Promise(res =>
        {
            if (!password || !token)
                return res({status: 400, content: "Missing parameters."})

            if (!this.passwordResetTokens.has(token))
                return res({status: 403, content: "Token is invalid."})

            const id = this.passwordResetTokens.get(token)
            User.findOne({id: id}).then(user =>
            {
                if (!user)
                    return res({status: 500, content: "Token was linked to a nonexistent user."})
                bcrypt.hash(password.trim(), 5, (err, hash) =>
                {
                    if (err)
                        return res({
                            status: 500,
                            content: 'There was an error while updating the password.'
                        })

                    user.update({password: hash}).then(result =>
                    {
                        if (result.status !== 200)
                            return res(result)

                        this.passwordResetTokens.delete(token)
                        return res({
                            status: 200,
                            content: {message: 'Updated successfully.'}
                        })
                    })
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


    updateProfile(token, clientToken, displayName, components, sociallinks, profiledesign)
    {
        return new Promise(res =>
        {
            if (!components || !token || !clientToken || !displayName || !sociallinks || !profiledesign)
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
                        user.update({displayName: displayName, components: components, sociallinks: sociallinks, profiledesign}).then(updateResult =>
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

    deletionRequest(token, clientToken, password)
    {
        return new Promise(res =>
        {
            if (!token || !clientToken || !password)
                return res({
                    status: 400,
                    content: 'Missing parameters.'
                })

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

                    bcrypt.compare(password, user.password, (err, result) =>
                    {
                        if (err) return res({
                            status: 500,
                            content: "There was an error. [d1]"
                        })
                        if (!result) return res({
                            status: 403,
                            content: "The provided password is incorrect."
                        })

                        const deletionToken = this.#generateString(32)
                        this.deletionTokens.set(deletionToken, user.id)

                        this.emailController.connect().then(conn => conn.send('rar.vg Account deletion',
                            'An account deletion request has been received.\n' +
                            'If it wasn\'t you, then your password may be compromised. Be sure to change it by clicking this link: https://www.rar.vg/forgot-password\n' +
                            'If it was you, click on this link to confirm account deletion: https://www.rar.vg/verify-account-deletion?t=' + deletionToken,
                            user.email).then(result =>
                        {
                            return res({
                                status: 200,
                                content: {response: 'The email was sent successfully.'}
                            })
                        }))
                    })
                })
            })
        })
    }

    verifyDeletionToken(token)
    {
        return new Promise(res =>
        {
            if (!this.deletionTokens.has(token))
                return res({
                    status: 403,
                    content: "The provided token is invalid. Try again."
                })

            return res({
                status: 200,
                content: {response: 'Curiosity killed the cat'}
            })
        })
    }

    deleteAccount(token)
    {
        return new Promise(res =>
        {
            if (!token)
                return res({status: 400, content: "Missing parameters."})

            if (!this.deletionTokens.has(token))
                return res({status: 403, content: "Token is invalid."})

            const id = this.deletionTokens.get(token)

            User.findOne({id: id}).then(user =>
            {
                if(!user)
                    return res({
                        status: 500,
                        content: 'There was an error with the current request. Try again.'
                    })

                user.delete().then(result =>
                {
                    res(result)
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

module
    .exports = UserController