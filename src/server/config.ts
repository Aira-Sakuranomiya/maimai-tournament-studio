import path from 'node:path'
import fs from 'node:fs'

export const PORT = Number(process.env.PORT || 8787)
export const HOST = process.env.HOST || '0.0.0.0'
export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data')
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads')
export const JACKET_DIR = path.join(DATA_DIR, 'jackets')
export const LXNS_API_BASE = process.env.LXNS_API_BASE || 'https://maimai.lxns.net'
export const LXNS_ASSET_BASE = process.env.LXNS_ASSET_BASE || 'https://assets2.lxns.net/maimai'

for (const directory of [DATA_DIR, UPLOAD_DIR, JACKET_DIR]) {
  fs.mkdirSync(directory, { recursive: true })
}
