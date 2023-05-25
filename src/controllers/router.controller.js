const express = require('express')
const UserController = require('./user.controller')

class RouterController {
    constructor(){
        this.userController = new UserController() 
    }
    // Creates the server. 
    create(){
        return new Promise(res => {
            // Import the router library.
            const router = express.Router()
            // Configure every route, then resolve the promise.
            router.get('/', (req, res) => res.send("la curiosidad mató al gato"))
            router.get('/profile/:user', (req, res) => this.userController.getProfile(req.params.user).then(result => res.send(result)))
            res(router)
        })
    }
}

module.exports = RouterController
