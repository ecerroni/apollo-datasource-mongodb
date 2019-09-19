import { MongoDataSource } from '../datasource'

const users = {}
const posts = {}

class Users extends MongoDataSource {

  initialize(config) {
    super.initialize(config)
  }
}

describe('MongoDataSource', () => {
  it('sets up caching functions', () => {
    const source = new Users({ users })
    source.initialize({})
    expect(source.users.loadOneById).toBeDefined()
    expect(source.users.loadManyByQuery).toBeDefined()
    expect(source.users.loadManyByQuery).toBeDefined()
    expect(source.users).toEqual(users)
  })
})
