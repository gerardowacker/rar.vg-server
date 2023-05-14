const express = require('express')

class RouterController {
    create(){
        return new Promise(res => {
            const router = express.Router()
            router.get('/', (req, res) => res.send("la curiosidad mató al gato"))
            router.get('/perro', (req, res) => res.send("la curiosidad mató al perro"))
            res(router)
        })
    }
}

module.exports = RouterController