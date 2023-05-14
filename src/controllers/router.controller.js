const express = require('express')

class RouterController {
    // Creates the server. 
    create(){
        return new Promise(res => {
            // Import the router library.
            const router = express.Router()
            // Configure every route, then resolve the promise.
            router.get('/', (req, res) => res.send("la curiosidad mató al gato"))
            res(router)
        })
    }
}

module.exports = RouterController
