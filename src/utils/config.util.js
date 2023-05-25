const config = require('../../config/config.json')

module.exports = key => {
    return config[key] === "" ? process.env[key] : config[key]
}