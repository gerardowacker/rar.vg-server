const db = require('../utils/database.util.js')

module.exports = class User
{
    constructor(id, username, displayName, email, creationDate, dateOfBirth, links, components)
    {
      this.id = id
      this.username = username
      this.displayName = displayName
      this.creationDate = creationDate
      this.dateOfBirth = dateOfBirth
      this.links = links
      this.email = email
      this.components = components
    }

    static findOne(matches)
    {
      let queryKeys = Object.keys(matches)
      let argument = 'SELECT id, username, displayName, creationDate, dateOfBirth, components, links FROM users WHERE'

      for (let i = 0; i < queryKeys.length; i++)
      {
        argument.concat((i === 0 ? '' : ' AND '), queryKeys[i] + ' = ' + matches[queryKeys])
      }

      return db.execute(argument)
    }
}
