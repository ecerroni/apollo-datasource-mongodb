[![npm version](https://badge.fury.io/js/apollo-datasource-mongo.svg)](https://www.npmjs.com/package/apollo-datasource-mongo)[![Build Status](https://img.shields.io/travis/ecerroni/apollo-datasource-mongodb/master.svg?style=flat-square)](https://travis-ci.org/ecerroni/apollo-datasource-mongodb) [![Coverage Status](https://img.shields.io/codecov/c/github/ecerroni/apollo-datasource-mongodb/master.svg?style=flat-square)](https://codecov.io/gh/ecerroni/apollo-datasource-mongodb/branch/master)


Apollo [data source](https://www.apollographql.com/docs/apollo-server/features/data-sources) for MongoDB

```
npm i apollo-datasource-mongo
```

OR

```
yarn add apollo-datasource-mongo
```


This package uses [DataLoader](https://github.com/graphql/dataloader) for batching and per-request memoization caching. It also optionally (if you provide a `ttl`), does shared application-level caching (using either the default Apollo `InMemoryLRUCache` or the [cache you provide to ApolloServer()](https://www.apollographql.com/docs/apollo-server/features/data-sources#using-memcachedredis-as-a-cache-storage-backend)**). It does this only for these three methods:

- [`loadOneById(id, options)`](#loadOneById)
- [`loadManyByIds(ids, options)`](#loadManyByIds)
- [`loadManyByQuery(queries, options)`](#loadManyByIds)

** Tested with Redis only

**Contents:**

- [Usage](#usage)
  - [Basic](#basic)
  - [Batching](#batching)
  - [Caching](#caching)
- [API](#api)
  - [loadOneById](#loadOneById)
  - [loadManyByIds](#loadManyByIds)
  - [loadManyByQuery](#loadManyByQuery)
  - [deleteFromCacheById](#deletefromcachebyid)
  - [flushCollectionCache](#flushcollectioncache)

This package works with either one of the following npm packages:
- mongodb: https://www.npmjs.com/package/mongodb
- mongoose: https://www.npmjs.com/package/mongoose

## Demo

- https://glitch.com/~apollo-datasource-mongo


## Usage

### Basic

The basic setup is subclassing `MongoDataSource`, passing your collection to the constructor, and using the [API methods](#API):

```js
import { MongoDataSource } from 'apollo-datasource-mongo'

export default Class Users extends MongoDataSource {

  getUser(userId) {
    return this.users.loadOneById(userId)
  }
}
```
and:

```js
import Users from './data-sources/Users.js'
import { users } from './your-mongo-schema-folder'

const server = new ApolloServer({
  typeDefs,
  resolvers,
  dataSources: () => ({
    db: new Users({ users })
  })
})
```

The collection is available at `this.users` (e.g. `this.users.update({_id: 'foo, { $set: { name: 'me' }}})`). The request's context is available at `this.context`. For example, if you put the logged-in user's ID on context as `context.currentUserId`:

```js
class Users extends MongoDataSource {
  ...

  async getPrivateUserData(userId) {
    const isAuthorized = this.context.currentUserId === userId
    if (isAuthorized) {
      const user = await this.users.loadOneById(userId)
      return user && user.privateData
    }
  }
}
```

If you want to implement an initialize method, it must call the parent method:

```js
class Users extends MongoDataSource {

  initialize(config) {
    super.initialize(config)
    ...
  }
}
```

For example, you can also enable debugging and whole cache flushing:

```js

class Users extends MongoDataSource {

  initialize(config) {
    super.initialize({
      ...config,
      debug: true,
      allowFlushingCollectionCache: true // to allow flushing collection's cache***
    })
    ...
  }
}
```
*** *By default flushing the collection's cache is not allowed.*

### Batching

This is the main feature, and is always enabled. Here's a full example:

```js
import { MongoDataSource } from 'apollo-datasource-mongo'
import { users, posts } from './your-mongo-schema-foleder'
class Users extends MongoDataSource {

  getUser(userId) {
    return this.users.loadOneById(userId)
  }
}

class Posts extends MongoDataSource {


  getPosts(postIds) {
    return this.posts.loadManyByIds(postIds)
  }

  getUserPostsByQuery(query) {
    return this.posts.loadManyByQuery(query)
  }
}

const resolvers = {
  Post: {
    author: (post, _, { dataSources: { users } }) => users.getUser(post.authorId)
  },
  User: {
    posts: (user, _, { dataSources: { posts } }) => posts.getPosts(user.postIds),
    lastSevenDaysPosts: (user, _, { dataSources: { posts } }) => posts.getUsersPostsByQuery({
      author: user._id,
      createdAt: { $gt: (new Date()).getDate() - 7 }
    })
  }
}

const server = new ApolloServer({
  typeDefs,
  resolvers,
  dataSources: () => ({
    users: new Users({ users }),
    posts: new Posts({ posts })
  })
})
```

### Caching

To enable shared application-level caching, you do everything from the above section, and you add the `ttl` option to `loadOneById()`:

```js
const MINUTE = 60

class Users extends MongoDataSource {

  getUser(userId) {
    return this.users.loadOneById(userId, { ttl: MINUTE })
  }

  async updateUserName(userId, newName) {
    await this.users.deleteFromCacheById(userId)
    
    // await this.users.flushCollectionCache() // to flush the whole collection's cache. It needs allowFlushingCollectionCache to be true in the extended config object passed to the initialize method
    // N.B.: Flushing the collection cache works only with Redis. It has no effect otherwise.
    
    return this.users.updateOne({ 
      _id: userId 
    }, {
      $set: { name: newName }
    })
  }
}

const resolvers = {
  Post: {
    author: (post, _, { dataSources: { users }) => db.getUser(post.authorId)
  },
  Mutation: {
    changeName: (_, { userId, newName }, { users, currentUserId }) => 
      currentUserId === userId && users.updateUserName(userId, newName)
  }
}
```

Here we also call [`deleteFromCacheById()`](#deletefromcachebyid) to remove the user from the cache when the user's data changes. If we're okay with people receiving out-of-date data for the duration of our `ttl`—in this case, for as long as a minute—then we don't need to bother adding calls to `deleteFromCacheById()`.

## API

### loadOneById

`loadOneById(id, { ttl })`

Resolves to the found document. Uses DataLoader to load `id`. DataLoader uses `collection.find({ _id: { $in: ids } })`. Optionally caches the document if `ttl` is set (in whole seconds).

### loadManyByIds

`loadManyByIds(ids, { ttl })`

Calls [`loadOneById()`](#loadOneById) for each id. Resolves to an array of documents.

### loadManyByQuery

`loadManyByQuery(query, { ttl })`

Resolves to the found documents. Uses DataLoader to load the query. DataLoader uses sift to  filter in-memory arrays using MongoDB query objects. Optionally caches the document if `ttl` is set (in whole seconds).

### deleteFromCacheById

`deleteFromCacheById(id)`

`deleteFromCacheById(query)`

Deletes a document from the cache.

//

### flushCollectionCache

`flushCollectionCache()`

Deletes all collection's documents from the cache.

//

## Forked and extended from
- [The GraphQLGuide's Apollo data source for MongoDB](https://github.com/GraphQLGuide/apollo-datasource-mongodb)