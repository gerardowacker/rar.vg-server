const db = require('../utils/database.util')

class Session
{
    #isSQLSynced;

    constructor(id, token, expires, clientToken, User_id)
    {
        this.id = id
        this.token = token
        this.expires = expires
        this.clientToken = clientToken
        this.User_id = User_id
        this.#isSQLSynced = false
    }

    static find(..._matches)
    {
        const matches = _matches[0]
        let argument = 'SELECT id, token, expires, clientToken, User_id FROM Sessions WHERE'
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

    insert()
    {
        if (!this.#isSQLSynced)
        return db.execute("INSERT INTO Sessions (token, expires, clientToken, User_id) VALUES ('" +
            this.token + "', '" + this.expires + "', '" + this.clientToken + "', '" + this.User_id + "')")
    }

    async delete()
    {
        return db.execute('DELETE FROM Sessions WHERE id = ' + this.id)
    }

    static async findOne(...matches)
    {
        const [sessions] = await Session.find(matches)
        if (sessions.length > 0)
        {
            const session = sessions[0]

            return new Session(session.id, session.token, session.expires, session.clientToken, session.User_id)
        }
        else return null
    }
}

module.exports = Session