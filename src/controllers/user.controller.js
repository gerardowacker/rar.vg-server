const User = require('../models/user.model')
const bcrypt = require('bcrypt')

class UserController
{

    constructor(sessionController)
    {
        this.sessionController = sessionController
    }

    getProfile(username)
    {
        return new Promise(async res =>
        {
            User.findOne({username: username}).then(user =>
            {
                if (!user)
                    return res({
                        status: 400,
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
            User.findOne({email: data.email}).then(user =>
            {
                if(!user)
                    return res({
                        status: 400,
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

                    const newUser = new User(null, data.username.toLowerCase(), hash, data.displayName, data.email.toLowerCase(),
                        new Date(Date.now()).toISOString().split('T')[0], data.dateOfBirth, [], [])
                    newUser.insert().then((result, err) =>
                    {
                        if (err)
                            return res({
                                status: 500,
                                content: 'There was an error while creating the account. [u3]'
                            })

                        res({
                            status: 200,
                            content: 'The user was registered successfully.'
                        })
                    })
                })
            })
        })
    }

    test()
    {
        return new Promise(async res =>
        {
            const newUser = new User(null, "juani", "passwdtest", "juanchi", "jv@test.com", "2023-05-25", "2000-01-01", [], [])
            newUser.insert().then(() =>
            {
                try
                {
                    User.findOne({username: "juani"}).then(u =>
                    {
                        console.log(u)
                        u.update({password: "pruebapasswd"}).then(updated =>
                        {
                            console.log(updated)
                            res("jaja")
                        })

                    })
                }
                catch (error)
                {
                    console.error(error)
                }

            })
        })
    }
}

module.exports = UserController