// 把 sw.js 里的缓存版本号 +1（GitHub Actions 每次自动更新时调用）
// 作用：让已经装到手机上的页面知道「有新东西了」，下次打开自动换新缓存。
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const file = join(ROOT, 'sw.js')
const before = readFileSync(file, 'utf8')
const after = before.replace(/arsenal-v(\d+)/, (_, n) => `arsenal-v${Number(n) + 1}`)

if (after === before) {
  console.log('没找到版本号，跳过')
} else {
  writeFileSync(file, after)
  console.log('版本号：', after.match(/arsenal-v\d+/)[0])
}
