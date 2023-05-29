const db = require('../utils/database.util.js')

module.exports = class User
{
    #isSQLSynced;

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
        this.#isSQLSynced = false
    }

    static find(..._matches)
    {
        const matches = _matches[0]
        let argument = 'SELECT id, username, password, displayName, email, creationDate, dateOfBirth, components, sociallinks FROM Users WHERE'
        for (let i = 0; i < matches.length; i++)
        {
            let match = matches[i]
            let queryKeys = Object.keys(match)
            let subargument = (i === 0 ? ' (' : ' OR (')
            for (let j = 0; j < queryKeys.length; j++)
            {
                subargument = subargument + ((j === 0 ? ' ' : ' AND ') + queryKeys[j] + ' = \'' + match[queryKeys] + '\'')
            }
            subargument = subargument + ")"
            argument = argument + subargument
        }
        return db.execute(argument)
    }

    static async findOne(...matches)
    {
        const [users] = await User.find(matches)
        if (users.length > 0)
        {
            const user = users[0]

            const u = new User(user.id, user.username, user.password, user.displayName, user.email, user.creationDate, user.dateOfBirth, user.sociallinks, user.components)
            u.setSQLSynced(true)

            return u
        }
        else return null
    }

    update(values)
    {
        return new Promise(res =>
        {
            let valueKeys = Object.keys(values)
            let argument = 'UPDATE Users SET'

            for (let i = 0; i < valueKeys.length; i++)
            {
                argument = argument + ((i === 0 ? ' ' : ', ') + valueKeys[i] + ' = \'' + values[valueKeys] + '\'')
            }

            argument = argument + 'WHERE id = ' + this.id

            db.query(argument).then((result) =>
            {

                this.username = values['username'] || this.username
                this.password = values['password'] || this.password
                this.displayName = values['displayName'] || this.displayName
                this.email = values['email'] || this.email
                this.creationDate = values['creationDate'] || this.creationDate
                this.dateOfBirth = values['dateOfBirth'] || this.dateOfBirth
                this.sociallinks = values['sociallinks'] || this.sociallinks
                this.components = values['components'] || this.components

                res({
                    status: 200,
                    content: result
                })
            }).catch(err =>
            {
                if (err)
                {
                    return res({
                        status: 500,
                        content: err
                    })
                }
            })
        })
    }

    setSQLSynced(value)
    {
        this.#isSQLSynced = value
    }

    insert()
    {
        if (this.#isSQLSynced) return
        return db.execute("INSERT INTO Users (username, password, displayName, creationDate, dateOfBirth, socialLinks, email, components) VALUES ('" +
            this.username + "', '" + this.password + "', '" + this.displayName + "', '" + this.creationDate + "', '" + this.dateOfBirth + "', '" +
            JSON.stringify(this.sociallinks) + "', '" + this.email + "', '" + JSON.stringify(this.components) + "')")
    }
}
