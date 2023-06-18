const bodyParser = require('body-parser')
const cors = require('cors')
const http = require('http')
const express = require('express')
const fileUpload = require('express-fileupload');
const path = require('path')
const root = path.normalize(path.join(path.dirname(require.main.filename), '..'))

const RouterController = require('./router.controller')

class WebController
{
    constructor()
    {
        // Create a new RouterController instance, and save it within the class. 
        this.router = new RouterController()
    }

    start()
    {
        return new Promise(res =>
        {
            // Create express environment.
            const app = express()

            // Implement some middleware into the server.
            app.use(bodyParser.json())
            app.use(cors())
            app.use(fileUpload())
            app.set("trust proxy", true)

            // Static stuff.
            app.use('/avatar', express.static(root + '/public/avatars', {fallthrough: true}));
            app.use('/uploads', express.static(root + '/public/userfiles'));

            // Create the router, and implement it into the server.
            this.router.create().then(routes => app.use("/", routes))

            // Create the HTTP server, then resolve the promise with it.
            const server = http.createServer(app)
            res(server)
        })
    }
}

module.exports = WebController
