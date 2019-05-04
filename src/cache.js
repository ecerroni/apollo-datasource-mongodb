import DataLoader from 'dataloader'
import sift from 'sift'

export const setupCaching = ({ collection, cache }) => {
  const loader = new DataLoader(ids =>
    collection
      .find({ _id: { $in: ids } })
      .toArray()
      .then(docs => {
        const idMap = {}
        docs.forEach(doc => {
          idMap[doc._id] = doc
        })
        return ids.map(id => idMap[id])
      })
  )

  const cachePrefix = `mongo-${collection.collectionName}-`

  collection.findOneById = async (id, { ttl } = {}) => {
    const key = cachePrefix + id

    const cacheDoc = await cache.get(key)
    if (cacheDoc) {
      return cacheDoc
    }

    const doc = await loader.load(id)
    if (Number.isInteger(ttl)) {
      // https://github.com/apollographql/apollo-server/tree/master/packages/apollo-server-caching#apollo-server-caching
      cache.set(key, doc, { ttl })
    }

    return doc
  }

  collection.findManyByIds = (ids, { ttl } = {}) => {
    return Promise.all(ids.map(id => collection.findOneById(id, { ttl })))
  }

  // Only batching, no caching atm
  collection.findOneByQuery = (queries) => collection.find({ $or: queries })
  .then(items => queries.map((query) => {
    const arr = sift(query, items);
    if (Array.isArray(arr) && arr.length > 0) return arr[0];
    return null;
  }));

  // Only batching, no caching atm
  collection.findManyByQuery = (queries) => collection.find({ $or: queries })
  .then(items => queries.map((query) => sift(query, items)));


  collection.deleteFromCacheById = id => cache.delete(cachePrefix + id)
}
