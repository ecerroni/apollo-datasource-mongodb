import { MongoDataSource } from '../datasource'

const users = {}
const posts = {}

class MyMongo extends MongoDataSource {
  constructor() {
    super()
    this.collections = [users, posts]
  }

  initialize(config) {
    super.initialize(config)
  }
}

describe('MongoDataSource', () => {
  it('sets up caching functions', () => {
    const source = new MyMongo()
    source.initialize({})
    expect(users.findOneById).toBeDefined()
    expect(users.findOneByQuery).toBeDefined()
    expect(users.findManyByQuery).toBeDefined()
    expect(posts.findOneById).toBeDefined()
    expect(posts.findOneByQuery).toBeDefined()
    expect(posts.findManyByQuery).toBeDefined()
  })
})
