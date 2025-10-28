const express = require('express')
const UserController = require('./user.controller')
const FileController = require('./file.controller')
const SessionController = require('./session.controller')
const EmailController = require('./email.controller')
const AIController = require('./ai.controller')
const path = require("path");
const root = path.normalize(path.join(path.dirname(require.main.filename), '..'))

class RouterController
{
    constructor(storageManager = null)
    {
        this.emailController = new EmailController()
        this.sessionController = new SessionController()
        this.userController = new UserController(this.sessionController, this.emailController)
        this.fileController = new FileController(this.sessionController, storageManager)
        this.aiController = new AIController()
        this.storageManager = storageManager
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
            router.get('/profile/:user', (req, res) => this.userController.getProfile(req.params.user).then(result => res.status(result.status).send(result.content)))
            router.get('/avatar/:user', (req, res) => res.sendFile(root + '/public/avatars/default.png'))
            router.post('/files/upload', (req, res) => this.fileController.upload(req.files, req.body.token, req.body.clientToken, req.body.avatar === '1').then(result => res.status(result.status).send(result.content)))
            router.post('/register', (req, res) => this.userController.register(req.body).then(result => res.status(result.status).send(result.content)))
            router.post('/login', (req, res) => this.userController.login(req.body).then(result => res.status(result.status).send(result.content)))
            router.post('/validate', (req, res) => this.sessionController.validate(req.body.token, req.body.clientToken).then(result => res.status(result.status).send(result.content)))
            router.post('/update', (req, res) => this.userController.updateProfile(req.body.token, req.body.clientToken, req.body.displayName, req.body.components, req.body.sociallinks, req.body.profileDesign).then(result => res.status(result.status).send(result.content)))
            router.post('/getUser', (req, res) => this.userController.getUser(req.body.token, req.body.clientToken).then(result => res.status(result.status).send(result.content)))
            router.post('/verify', (req, res) => this.userController.verifyAccount(req.body.token).then(result => res.status(result.status).send(result.content)))
            router.post('/request-password-change', (req, res) => this.userController.requestPasswordChange(req.body.email).then(result => res.status(result.status).send(result.content)))
            router.post('/verify-password-token', (req, res) => this.userController.verifyPasswordToken(req.body.token).then(result => res.status(result.status).send(result.content)))
            router.post('/update-password', (req, res) => this.userController.updatePassword(req.body.token, req.body.password).then(result => res.status(result.status).send(result.content)))
            router.post('/deletion-request', (req, res) => this.userController.deletionRequest(req.body.token, req.body.clientToken, req.body.password).then(result => res.status(result.status).send(result.content)))
            router.post('/verify-deletion-token', (req, res) => this.userController.verifyDeletionToken(req.body.token).then(result => res.status(result.status).send(result.content)))
            router.post('/delete-account', (req, res) => this.userController.deleteAccount(req.body.token).then(result => res.status(result.status).send(result.content)))
            router.post('/logout', (req, res) => this.userController.logOut(req.body.token, req.body.clientToken, req.body.single).then(result => res.status(result.status).send(result.content)))
            
            // AI Chat routes
            router.post('/ai/chat', (req, res) => this.aiController.processAIChat(req.body.message, req.body.context).then(result => res.status(result.status).send(result.content)))
            
            res(router)
        })
    }
}

module.exports = RouterController
