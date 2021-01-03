import DataLoader from 'dataloader'
import sift from 'sift'

function to(promise, errorExt) {
  return promise
    .then(data => [null, data])
    .catch(err => {
      if (errorExt) {
        Object.assign(err, errorExt)
      }

      return [err, undefined]
    })
}
const handleCache = async ({ ttl, doc, key, cache, isRedis = false }) => {
  if (Number.isInteger(ttl)) {
    // https://github.com/apollographql/apollo-server/tree/master/packages/apollo-server-caching#apollo-server-caching
    cache.set(key, isRedis ? JSON.stringify(doc) : doc, {
      ttl
    })
  }
}

const remapDocs = (docs, ids) => {
  const idMap = {}
  docs.forEach(doc => {
    idMap[doc._id] = doc // eslint-disable-line no-underscore-dangle
  })
  return ids.map(id => idMap[id])
}

// eslint-disable-next-line import/prefer-default-export
export const createCachingMethods = ({
  collection,
  cache,
  allowFlushingCollectionCache = false,
  debug = false
}) => {
  const isRedis = typeof cache.store === 'undefined'
  const isMongoose = typeof collection === 'function'
  const loader = new DataLoader(ids =>
    isMongoose
      ? collection
          .find({ _id: { $in: ids } })
          .lean()
          .then(docs => remapDocs(docs, ids))
      : collection
          .find({ _id: { $in: ids } })
          .toArray()
          .then(docs => remapDocs(docs, ids))
  )

  const cachePrefix = `db:mongo:${
    collection.collectionName // eslint-disable-line no-nested-ternary
      ? collection.collectionName
      : collection.modelName
      ? collection.modelName
      : 'test'
  }:`

  const dataQuery = isMongoose
    ? ({ queries }) =>
        collection
          .find({ $or: queries })
          .lean()
          .then(items => queries.map(query => items.filter(sift(query))))
    : ({ queries }) =>
        collection
          .find({ $or: queries })
          .toArray()
          .then(items => queries.map(query => items.filter(sift(query))))

  const queryLoader = new DataLoader(queries => dataQuery({ queries }))

  const methods = {
    // eslint-disable-next-line no-param-reassign
    loadOneById: async (id, { ttl } = {}) => {
      const key = cachePrefix + id

      const [_, cacheDoc] = await to(cache.get(key))
      if (debug) {
        console.log('KEY', key, cacheDoc ? 'cache' : 'miss')
      }
      if (cacheDoc) {
        return isRedis ? JSON.parse(cacheDoc) : cacheDoc
      }

      const doc = await loader.load(id)
      await handleCache({
        ttl,
        doc,
        key,
        cache,
        isRedis
      })

      return doc
    },

    // eslint-disable-next-line no-param-reassign
    loadManyByIds: (ids, { ttl } = {}) =>
      Promise.all(ids.map(id => methods.loadOneById(id, { ttl }))),

    // eslint-disable-next-line no-param-reassign
    loadManyByQuery: async (query, { ttl } = {}) => {
      const key = cachePrefix + JSON.stringify(query)

      const cacheDocs = await cache.get(key)
      if (debug) {
        console.log('KEY', key, cacheDocs ? 'cache' : 'miss')
      }
      if (cacheDocs) {
        return isRedis ? JSON.parse(cacheDocs) : cacheDocs
      }
      const docs = await queryLoader.load(query)
      await handleCache({
        ttl,
        doc: docs,
        key,
        cache,
        isRedis
      })
      return docs
    },

    // eslint-disable-next-line no-param-reassign
    deleteFromCacheById: async id => {
      const key = id && typeof id === 'object' ? JSON.stringify(id) : id // NEW
      await cache.delete(cachePrefix + key)
    }, // this works also for byQueries just passing a stringified query as the id

    // eslint-disable-next-line no-param-reassign
    flushCollectionCache: async () => {
      if (!allowFlushingCollectionCache) return null
      if (isRedis) {
        const redis = cache.client
        const stream = redis.scanStream({
          match: `${cachePrefix}*`
        })
        stream.on('data', keys => {
          // `keys` is an array of strings representing key names
          if (keys.length) {
            const pipeline = redis.pipeline()
            keys.forEach(key => {
              pipeline.del(key)
              if (debug) {
                console.log('KEY', key, 'flushed')
              }
            })
            pipeline.exec()
          }
        })
        stream.on('end', () => {
          if (debug) {
            console.log(`Flushed ${cachePrefix}*`)
          }
        })
        return 'ok'
      }
      return null
    }
  }
  return methods
}
