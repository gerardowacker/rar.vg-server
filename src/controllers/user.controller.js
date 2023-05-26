const User = require('../models/user.model')
const bcrypt = require('bcrypt')

class UserController
{
    getProfile(username)
    {
        return new Promise(async res =>
        {
            try
            {
                const [users] = await User.find({username: username})
                const user = users[0]
                delete user.password
                delete user.dateOfBirth
                delete user.creationDate
                res(user)
            }
            catch (error)
            {
                console.log(error)
            }
        })
    }

    register(data){
        return new Promise (async res =>{
            const [users] = await User.find({username: data.username.toLowerCase()}, {email: data.email.toLowerCase()})
            if(users.length !== 0) res({status: 400, content: "Fields already in use."})
            else bcrypt.hash(data.password.trim(), 5, (err, hash) => {
                if(err) res({status: 500, content: err})
                const newUser = new User(null, data.username.toLowerCase(), hash, data.displayName, data.email.toLowerCase(), new Date(Date.now()).toISOString().split('T')[0], data.dateOfBirth, [], [])
                newUser.insert().then((result, err) =>{
                    if(err) res({status: 500, content: err})
                    res({
                        status: 200,
                        content: result
                    })
                })
            })
            
        })
    }

    test(){
        return new Promise(async res =>{
            const newUser = new User(null, "juani", "passwdtest", "juanchi", "jv@test.com", "2023-05-25","2000-01-01", [],[])
            newUser.insert().then(() => {
                try {
                    User.findOne({username: "juani"}).then(u => {
                        console.log(u)
                        u.update({password: "pruebapasswd"}).then(updated => {
                            console.log(updated)
                            res("jaja")
                        })
                        
                    })
                } catch (error) {
                    console.error(error)
                }
                
            })
        })
    }
}

module.exports = UserController