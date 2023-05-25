const User = require('../models/user.model')

class UserController{

    getProfile(username){
        return new Promise(async res => {
            try {
                const [users] = await User.find({username: username})
                const user = users[0]
                delete user.password
                delete user.dateOfBirth
                delete user.creationDate
                res (user) 
            } catch (error) {
                console.log(error)
            }
        })
    }

}

module.exports = UserController