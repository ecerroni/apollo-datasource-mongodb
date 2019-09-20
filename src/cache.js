import DataLoader from 'dataloader'
import sift from 'sift'

const handleCache = async ({
  ttl,
  doc,
  key,
  cache,
  allCacheKeys,
  debug,
  allowFlushingCollectionCache
}) => {
  if (Number.isInteger(ttl)) {
    // https://github.com/apollographql/apollo-server/tree/master/packages/apollo-server-caching#apollo-server-caching
    cache.set(key, doc, {
      ttl
    })
    if (allowFlushingCollectionCache) {
      const allKeys = (await cache.get(allCacheKeys)) || []

      if (!allKeys.find(k => k === key)) {
        allKeys.push(key)
        const newKeys = [...new Set(allKeys)]
        cache.set(allCacheKeys, newKeys, { ttl })
        if (debug) {
          console.log(
            'All Keys Cache: Added => ',
            key,
            '#keys',
            (await cache.get(allCacheKeys)) &&
              (await cache.get(allCacheKeys)).length
          )
        }
      } else if (debug) {
        console.log(
          'All Keys Cache: Found => ',
          key,
          '#keys',
          (await cache.get(allCacheKeys)) &&
            (await cache.get(allCacheKeys)).length
        )
      }
    }
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
  mongoose = false,
  debug = false
}) => {
  const loader = new DataLoader(ids =>
    mongoose
      ? collection
          .find({ _id: { $in: ids } })
          .lean()
          .then(docs => remapDocs(docs, ids))
      : collection
          .find({ _id: { $in: ids } })
          .toArray()
          .then(docs => remapDocs(docs, ids))
  )

  const cachePrefix = `mongo-${
    collection.collectionName // eslint-disable-line no-nested-ternary
      ? collection.collectionName
      : collection.modelName
      ? collection.modelName
      : 'test'
  }-`
  const allCacheKeys = `${cachePrefix}all-keys`

  const dataQuery = mongoose
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

      const cacheDoc = await cache.get(key)
      if (debug) {
        console.log('KEY', key, cacheDoc ? 'cache' : 'miss')
      }
      if (cacheDoc) {
        return cacheDoc
      }

      const doc = await loader.load(id)
      await handleCache({
        ttl,
        doc,
        key,
        cache,
        allCacheKeys,
        debug,
        allowFlushingCollectionCache
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
        return cacheDocs
      }
      const docs = await queryLoader.load(query)
      await handleCache({
        ttl,
        doc: docs,
        key,
        cache,
        allCacheKeys,
        debug,
        allowFlushingCollectionCache
      })
      return docs
    },

    // eslint-disable-next-line no-param-reassign
    deleteFromCacheById: async id => {
      const key = id && typeof id === 'object' ? JSON.stringify(id) : id
      const allKeys = (await cache.get(allCacheKeys)) || []
      const newKeys = allKeys.filter(k => k !== `${cachePrefix}${key}`)
      await cache.delete(cachePrefix + key)
      if (allowFlushingCollectionCache) cache.set(allCacheKeys, newKeys)
    }, // this works also for byQueries just passing a stringified query as the id

    // eslint-disable-next-line no-param-reassign
    flushCollectionCache: async () => {
      if (!allowFlushingCollectionCache) return null
      const allKeys = (await cache.get(allCacheKeys)) || []
      // eslint-disable-next-line no-restricted-syntax
      for (const key of allKeys) {
        cache.delete(key)
      }
      cache.set(allCacheKeys, [])
      return true
    }
  }
  return methods
}
