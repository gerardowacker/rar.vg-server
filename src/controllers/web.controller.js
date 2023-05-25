const bodyParser = require('body-parser')
const cors = require('cors')
const http = require('http')
const express = require('express')

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
            app.set("trust proxy", true)

            // Create the router, and implement it into the server.
            this.router.create().then(routes => app.use("/", routes))

            // Create the HTTP server, then resolve the promise with it.
            const server = http.createServer(app)
            res(server)
        })
    }
}

module.exports = WebController
