import { InMemoryLRUCache } from 'apollo-server-caching'
import sift from 'sift'
import wait from 'waait'

import { createCachingMethods } from '../cache'

const now = new Date()
const oneWeekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7)

const docs = {
  id1: {
    _id: 'id1',
    createdAt: now
  },
  id2: {
    _id: 'id2',
    createdAt: oneWeekAgo
  },
  id3: {
    _id: 'id3',
    createdAt: oneWeekAgo
  }
}

const collectionName = 'test'
const cacheKey = id => 'db:mongo:' + collectionName + ':' + id

describe('createCachingMethods', () => {
  let collection
  let cache
  let allowFlushingCollectionCache
  let api

  beforeEach(() => {
    collection = {
      collectionName,
      find: jest.fn((args) => ({
        toArray: () =>
          new Promise(resolve => {
            if (args.$or) {
              const { $or: queries } = args
              const siftDocs = Object.keys(docs).reduce((a, k) => [...a, docs[k]], [])
              setTimeout(() => resolve(queries.reduce((arr, query) => [...arr, ...siftDocs.filter(sift(query))], [])), 0)
            } else {
              const { _id: { $in: ids } } = args
              setTimeout(() => resolve(ids.map(id => docs[id])), 0)
            }
          })
      }))
    }

    cache = new InMemoryLRUCache()

    allowFlushingCollectionCache = true

    api = createCachingMethods({ collection, cache, allowFlushingCollectionCache })
  })

  it('adds the right methods', () => {
    expect(api.loadOneById).toBeDefined()
    expect(api.loadManyByIds).toBeDefined()
    expect(api.deleteFromCacheById).toBeDefined()
    expect(api.loadManyByQuery).toBeDefined()
  })

  it('finds one', async () => {
    const doc = await api.loadOneById('id1')
    expect(doc).toBe(docs.id1)
    expect(collection.find.mock.calls.length).toBe(1)
  })

  it('finds two with batching', async () => {
    const foundDocs = await api.loadManyByIds(['id2', 'id3'])
    expect(foundDocs[0]).toBe(docs.id2)
    expect(foundDocs[1]).toBe(docs.id3)

    expect(collection.find.mock.calls.length).toBe(1)
  })

  it('finds two with queries batching', async () => {
    const foundDocs = await api.loadManyByQuery({
      createdAt: { $lte: oneWeekAgo }
    })
    expect(foundDocs[0]).toBe(docs.id2)
    expect(foundDocs[1]).toBe(docs.id3)
    expect(foundDocs.length).toBe(2)

    expect(collection.find.mock.calls.length).toBe(1)
  })

  it(`doesn't cache without ttl`, async () => {
    await api.loadOneById('id1')

    let value = await cache.get(cacheKey('id1'))
    expect(value).toBeUndefined()

    const query = {
      createdAt: { $lte: oneWeekAgo }
    }

    await api.loadManyByQuery(query)

    value = await cache.get(cacheKey(JSON.stringify(query)))
    expect(value).toBeUndefined()
  })

  it(`caches`, async () => {
    await api.loadOneById('id1', { ttl: 1 })
    let value = await cache.get(cacheKey('id1'))
    expect(value).toBe(docs.id1)

    await api.loadOneById('id1')
    expect(collection.find.mock.calls.length).toBe(1)

    const query = {
      createdAt: { $lte: oneWeekAgo }
    }
    await api.loadManyByQuery(query, { ttl: 1 })
    value = await cache.get(cacheKey(JSON.stringify(query)))
    expect(value).toEqual([docs.id2, docs.id3])

    await api.loadManyByQuery(query)
    expect(collection.find.mock.calls.length).toBe(2) // it takes count both [ [ { _id: [Object] } ], [ { '$or': [Array] } ] ]
  })

  it(`caches with ttl`, async () => {
    await api.loadOneById('id1', { ttl: 1 })
    await wait(1001)

    let value = await cache.get(cacheKey('id1'))
    expect(value).toBeUndefined()

    const query = {
      createdAt: { $lte: oneWeekAgo }
    }
    await api.loadManyByQuery(query, { ttl: 1 })
    await wait(1001)

    value = await cache.get(cacheKey(JSON.stringify(query)))
    expect(value).toBeUndefined()
  })

  it(`deletes from cache`, async () => {
    await api.loadOneById('id1', { ttl: 1 })

    let valueBefore = await cache.get(cacheKey('id1'))
    expect(valueBefore).toBe(docs.id1)

    await api.deleteFromCacheById('id1')

    let valueAfter = await cache.get(cacheKey('id1'))
    expect(valueAfter).toBeUndefined()

    const query = {
      createdAt: { $lte: oneWeekAgo }
    }

    await api.loadManyByQuery(query, { ttl: 1 })

    valueBefore = await cache.get(cacheKey(JSON.stringify(query)))
    expect(valueBefore).toEqual([docs.id2, docs.id3])

    await api.deleteFromCacheById(query)

    valueAfter = await cache.get(cacheKey(JSON.stringify(query)))
    expect(valueAfter).toBeUndefined()
  })
  it('has collection cache flushing disabled by default', async () => {
    api = createCachingMethods({ collection, cache })
    await api.loadOneById('id1', { ttl: 1 })
    let value = await cache.get(cacheKey('id1'))
    expect(value).toBe(docs.id1)

    const query = {
      createdAt: { $lte: oneWeekAgo }
    }
    await api.loadManyByQuery(query, { ttl: 1 })
    value = await cache.get(cacheKey(JSON.stringify(query)))
    expect(value).toEqual([docs.id2, docs.id3])

    const flush = await api.flushCollectionCache()
    expect(flush).toBeNull()

  })
})
