const bodyParser = require('body-parser')
const cors = require('cors')
const http = require('http')
const express = require('express')

const RouterController = require('./router.controller')

class WebController {
    constructor(){
        this.router = new RouterController()
    }
    
    start(){
        return new Promise(res => {
            const app = express()
            
            app.use(bodyParser.json())
            app.use(cors())
            app.set("trust proxy", true)

            this.router.create().then(routes => app.use("/", routes))
            
            const server = http.createServer(app)
            res(server)
        })
    }
}

module.exports = WebController