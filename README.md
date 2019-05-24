[![npm version](https://badge.fury.io/js/apollo-datasource-mongo.svg)](https://www.npmjs.com/package/apollo-datasource-mongo)

Apollo [data source](https://www.apollographql.com/docs/apollo-server/features/data-sources) for MongoDB

```
npm i apollo-datasource-mongo
```

OR

```
yarn add apollo-datasource-mongo
```


This package uses [DataLoader](https://github.com/graphql/dataloader) for batching and per-request memoization caching. It also optionally (if you provide a `ttl`), does shared application-level caching (using either the default Apollo `InMemoryLRUCache` or the [cache you provide to ApolloServer()](https://www.apollographql.com/docs/apollo-server/features/data-sources#using-memcachedredis-as-a-cache-storage-backend)). It does this only for these three methods, which are added to your collections:

- [`findOneById(id, options)`](#findonebyid)
- [`findManyByIds(ids, options)`](#findmanybyids)
- [`findManyByQuery(queries, options)`](#findmanybyids)


**Contents:**

- [Usage](#usage)
  - [Basic](#basic)
  - [Batching](#batching)
  - [Caching](#caching)
- [API](#api)
  - [findOneById](#findonebyid)
  - [findManyByIds](#findmanybyids)
  - [findManyByQuery](#findmanybyquery)
  - [deleteFromCacheById](#deletefromcachebyid)
  - [flushCollectionCache](#flushcollectioncache)

This package works with either one of the following npm packages:
- mongodb: https://www.npmjs.com/package/mongodb
- mongoose: https://www.npmjs.com/package/mongoose

## Usage

### Basic

The basic setup is subclassing `MongoDataSource`, setting your collections in the constructor, and then using the [API methods](#API) on your collections:

```js
import { MongoDataSource } from 'apollo-datasource-mongo'

class MyMongo extends MongoDataSource {
  constructor() {
    super()
    this.collections = [users, posts]
  }

  getUser(userId) {
    return users.findOneById(userId)
  }
}
```

The request's context is available at `this.context`. For example, if you put the logged-in user's ID on context as `context.currentUserId`:

```js
class MyMongo extends MongoDataSource {
  ...

  async getPrivateUserData(userId) {
    const isAuthorized = this.context.currentUserId === userId
    if (isAuthorized) {
      const user = await users.findOneById(userId)
      return user && user.privateData
    }
  }
}
```

If you want to implement an initialize method, it must call the parent method:

```js
class MyMongo extends MongoDataSource {
  constructor() {
    super()
    this.collections = [users, posts]
  }

  initialize(config) {
    super.initialize(config)
    ...
  }
}
```

### Batching

This is the main feature, and is always enabled. Here's a full example:

```js
import { MongoClient } from 'mongodb'
// OR [Using MONGOOSE]
// import mongoose from 'mongoose';
// import { users, posts } from './your-mongo-schema-folder'
import { MongoDataSource } from 'apollo-datasource-mongo'
import { ApolloServer } from 'apollo-server'

let users
let posts

const client = new MongoClient('mongodb://localhost:27017')

client.connect(e => {
  users = client.db('dbname').collection('users')
  posts = client.db('dbname').collection('posts')
})

// OR [Using MONGOOSE]
// mongoose.pluralize(null); // legacy db has no plulars in collections' names

// mongoose.connect('mongodb://localhost:27017/dbname');


// const db = mongoose.connection;
// db.on('error', e => console.error('MongoDB connection error.', e));
// db.on('open', () => {
//   console.log('Connected to db');
// });



class MyMongo extends MongoDataSource {
  constructor() {
    super()
    this.collections = [users, posts]
    // this.mongoose = true // default is mongoClient
    // this.debug = true // to enable debugging console.logs
    // this.flushCollectionCache = true // to allow flushing collection's cache**
  }

  getUser(userId) {
    return users.findOneById(userId)
  }

  getPosts(postIds) {
    return posts.findManyByIds(postIds)
  }

  getUserPostsByQuery(query) {
    return posts.findManyByQuery(query)
  }
}

const resolvers = {
  Post: {
    author: (post, _, { dataSources: { db } }) => db.getUser(post.authorId)
  },
  User: {
    posts: (user, _, { dataSources: { db } }) => db.getPosts(user.postIds),
    lastSevenDaysPosts: (user, _, { dataSources: { db } }) => db.getUsersPostsByQuery({
      author: user._id,
      createdAt: { $gt: (new Date()).getDate() - 7 }
    })
  }
}

const server = new ApolloServer({
  typeDefs,
  resolvers,
  dataSources: () => ({
    db: new MyMongo()
  })
})
```
** *By default `flushCollectionCache` is not allowed as I implemented tracking of all cache keys without thinking about the performance implications. Actually I have no clue atm :) so I am making this optional for now.*

You might prefer to structure it as one data source per collection, in which case you'd do:

```js
class Users extends MongoDataSource {
  constructor() {
    super()
    this.collections = [users]
  }

  getUser(userId) {
    return users.findOneById(userId)
  }
}

class Posts extends MongoDataSource {
  constructor() {
    super()
    this.collections = [posts]
  }

  getPosts(postIds) {
    return posts.findManyByIds(postIds)
  }
}

const resolvers = {
  Post: {
    author: (post, _, { dataSources: { users } }) => users.getUser(post.authorId)
  },
  User: {
    posts: (user, _, { dataSources: { posts } }) => posts.getPosts(user.postIds)
  }
}

const server = new ApolloServer({
  typeDefs,
  resolvers,
  dataSources: () => ({
    users: new Users(),
    posts: new Posts()
  })
})
```

This is purely a code structure choice—it doesn't affect batching or caching. The latter option probably makes more sense if you have more than a few methods in your class.

### Caching

To enable shared application-level caching, you do everything from the above section, and you add the `ttl` option to `findOneById()`:

```js
const MINUTE = 60

class MyMongo extends MongoDataSource {
  constructor() {
    super()
    this.collections = [users, posts]
  }

  getUser(userId) {
    return users.findOneById(userId, { ttl: MINUTE })
  }

  updateUserName(userId, newName) {
    users.deleteFromCacheById(userId)
    // users.flushCollectionCache() // to flush the whole collection's cache. It needs this.flushCollectionCache to be true
    return users.updateOne({ 
      _id: userId 
    }, {
      $set: { name: newName }
    })
  }
}

const resolvers = {
  User: {
    posts: (user, _, { dataSources: { db } }) => db.getPosts(user.postIds)
  },
  Mutation: {
    changeName: (_, { userId, newName }, { db, currentUserId }) => 
      currentUserId === userId && db.updateUserName(userId, newName)
  }
}
```

Here we also call [`deleteFromCacheById()`](#deletefromcachebyid) to remove the user from the cache when the user's data changes. If we're okay with people receiving out-of-date data for the duration of our `ttl`—in this case, for as long as a minute—then we don't need to bother adding calls to `deleteFromCacheById()`.

## API

### findOneById

`collection.findOneById(id, { ttl })`

Resolves to the found document. Uses DataLoader to load `id`. DataLoader uses `collection.find({ _id: { $in: ids } })`. Optionally caches the document if `ttl` is set (in whole seconds).

### findManyByIds

`collection.findManyByIds(ids, { ttl })`

Calls [`findOneById()`](#findonebyid) for each id. Resolves to an array of documents.

### findManyByQuery

`collection.findManyByQuery(query, { ttl })`

Resolves to the found documents. Uses DataLoader to load the query. DataLoader uses sift to  filter in-memory arrays using MongoDB query objects. Optionally caches the document if `ttl` is set (in whole seconds).

### deleteFromCacheById

`collection.deleteFromCacheById(id)`

`collection.deleteFromCacheById(query)`

Deletes a document from the cache.

//

### flushCollectionCache

`collection.flushCollectionCache()`

Deletes all collection's documents from the cache.

//

## Forked and extended from
- [The GraphQLGuide's Apollo data source for MongoDB](https://github.com/GraphQLGuide/apollo-datasource-mongodb)