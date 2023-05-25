const mysql = require('mysql2')
const config = require('./config.util')

const pool = mysql.createPool({
    host: config("DB_HOST"),
    port: config("DB_PORT"),
    user: config("DB_USER"),
    database: config("DB_DATABASE"),
    password: config("DB_PASSWORD"),
})

module.exports = pool.promise()