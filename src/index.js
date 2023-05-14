const port = process.env.PORT || 1300

const WebController = require("./controllers/web.controller")

const web = new WebController()

web.start().then(server => {
    server.listen(port)
    console.log("servidor iniciado en el puerto", port)
})