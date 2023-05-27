const express = require('express')
const UserController = require('./user.controller')
const FileController = require('./file.controller')
const SessionController = require('./session.controller')

class RouterController
{
    constructor()
    {
        this.sessionController = new SessionController()
        this.userController = new UserController(this.sessionController)
        this.fileController = new FileController()
    }

    // Creates the server.
    create()
    {
        return new Promise(res =>
        {
            // Import the router library.
            const router = express.Router()
            // Configure every route, then resolve the promise.
            router.get('/', (req, res) => res.send("la curiosidad mató al gato"))
            router.get('/profile/:user', (req, res) => this.userController.getProfile(req.params.user).then(result => res.send(result)))
            router.post('/files/upload', (req, res) => this.fileController.upload(req.files, req.body.session, req.body.avatar).then(result => res.status(result.status).send(result.content)))
            router.post('/register', (req, res) => this.userController.register(req.body).then(result => res.send(result)))
            router.post('/login', (req, res) => this.userController.login(req.body).then(result => res.send(result)))
            router.post('/validate', (req, res) => this.sessionController.validate(req.body.token, req.body.clientToken).then(result => res.send(result)))
            res(router)
        })
    }
}

module.exports = RouterController
