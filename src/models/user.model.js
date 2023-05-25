const db = require('../utils/database.util.js')

module.exports = class User
{
    constructor(id, username, password, displayName, email, creationDate, dateOfBirth, links, components)
    {
        this.id = id
        this.username = username
        this.password = password
        this.displayName = displayName
        this.creationDate = creationDate
        this.dateOfBirth = dateOfBirth
        this.links = links
        this.email = email
        this.components = components
    }

    static find(matches)
    {
        let queryKeys = Object.keys(matches)
        let argument = 'SELECT id, username, password, displayName, creationDate, dateOfBirth, components, sociallinks FROM Users WHERE'

        for (let i = 0; i < queryKeys.length; i++)
        {
            argument = argument + ((i === 0 ? ' ' : ' AND ') + queryKeys[i] + ' = \'' + matches[queryKeys] + '\'')
        }

        return db.execute(argument)
    }
}
