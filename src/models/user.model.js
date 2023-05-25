const db = require('../utils/database.util.js')

module.exports = class User
{
    constructor(id, username, password, displayName, email, creationDate, dateOfBirth, sociallinks, components)
    {
        this.id = id
        this.username = username
        this.password = password
        this.displayName = displayName
        this.creationDate = creationDate
        this.dateOfBirth = dateOfBirth
        this.sociallinks = sociallinks
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

    insert()
    {
        return db.execute("INSERT INTO Users (username, password, displayName, creationDate, dateOfBirth, socialLinks, email, components) VALUES ('" +
            this.username + "', '" + this.password + "', '" + this.displayName + "', '" + this.creationDate + "', '" + this.dateOfBirth + "', '" +
            JSON.stringify(this.sociallinks) + "', '" + this.email + "', '" + JSON.stringify(this.components) + "')")
    }

    update(values)
    {
        let valueKeys = Object.keys(values)
        let argument = 'UPDATE Users SET'

        for (let i = 0; i < valueKeys.length; i++)
        {
            argument = argument + ((i === 0 ? ' ' : ', ') + valueKeys[i] + ' = \'' + values[valueKeys] + '\'')
        }

        argument = argument + ' WHERE id = ' + this.id

        console.log(argument)

        return db.execute(argument)
    }

    static async findOne(matches)
    {
        const [users] = await User.find(matches)
        const user = users[0]
        return new User(user.id, user.username, user.password, user.displayName, user.email, user.creationDate, user.dateOfBirth, user.sociallinks, user.components)
    }
}
