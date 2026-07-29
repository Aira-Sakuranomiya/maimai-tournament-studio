import { buildApp } from './app.js'
import { HOST, PORT } from './config.js'
import { getSongCacheInfo, syncSongs } from './service.js'

const { app, db } = await buildApp()

await app.listen({ host: HOST, port: PORT })

const cache = getSongCacheInfo(db)
const stale = !cache.updatedAt || Date.now() - new Date(cache.updatedAt).getTime() > 24 * 60 * 60 * 1000
if (stale) {
  syncSongs(db).then((result) => app.log.info(`已缓存 ${result.count} 首曲目`)).catch((error) => app.log.warn(error, '曲库同步失败，继续使用本地缓存'))
}

setInterval(() => {
  syncSongs(db).catch((error) => app.log.warn(error, '定时曲库同步失败'))
}, 24 * 60 * 60 * 1000).unref()
