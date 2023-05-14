const port = process.env.PORT || 1300

// Import controllers.
const WebController = require("./controllers/web.controller")

const web = new WebController()

// Start the web server, then execute some stuff.
web.start().then(server => {
    server.listen(port)
    console.log("🚀 Server started using port ", port)
})
