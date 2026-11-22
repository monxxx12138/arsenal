// 生成 fixtures.json —— 阿森纳本赛季完整赛程（联赛 + 欧战 + 杯赛 + 热身赛）
//
// 为什么要预处理而不是页面里直接拉：
//   1) ICS 源（ics.fixtur.es）没有 CORS 头，浏览器直接 fetch 会被拦；
//   2) 赛程在赛季开始前就定死了，属于「静态数据」，没必要每次打开都拉；
//   3) 预生成后单文件版可以把它内联进去，file:// 打开也能用。
//
// 用法：node build-fixtures.mjs [url]
// 默认源：https://ics.fixtur.es/v2/arsenal.ics
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const URL_ICS = process.argv[2] || 'https://ics.fixtur.es/v2/arsenal.ics'

// 竞赛标签 → 中文名。FIxtur.es 用的缩写：CL 欧冠 / LC 联赛杯 / FA 足总杯 / FA-CS 社区盾 / EL 欧联
const COMP = {
  CL: { code: 'UCL', name: '欧冠', order: 2 },
  LC: { code: 'EFL', name: '联赛杯', order: 3 },
  FA: { code: 'FAC', name: '足总杯', order: 4 },
  'FA-CS': { code: 'CS', name: '社区盾', order: 5 },
  EL: { code: 'UEL', name: '欧联杯', order: 6 },
  FRIENDLY: { code: 'FR', name: '热身赛', order: 9 },
  PL: { code: 'PL', name: '英超', order: 1 },
}

const res = await fetch(URL_ICS, { headers: { 'User-Agent': 'arsenal-app/2.0' } })
if (!res.ok) throw new Error(`拉取失败 HTTP ${res.status}`)
const raw = await res.text()

// iCalendar 的「折行」规则：以空格或制表符开头的下一行是续行，要先拼回去
const unfolded = raw.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '')

const blocks = [...unfolded.matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/g)].map((m) => m[1])

function parseEvent(block) {
  const summary = (/^SUMMARY:(.+)$/m.exec(block)?.[1] || '').trim()
  const dt = /^DTSTART(?:;[^:]*)?:(\d{8}T\d{6}Z?)/m.exec(block)?.[1]
  if (!summary || !dt) return null

  // 例：'Arsenal - Tottenham Hotspur' / 'Napoli - Arsenal [CL] (0-1)' / 'Arsenal - Manchester City [FA-CS] (3-0)'
  const tag = /\[([A-Za-z-]+)\]/.exec(summary)?.[1] || ''
  const score = /\((\d+)\s*-\s*(\d+)\)\s*$/.exec(summary)
  const body = summary.replace(/\[[A-Za-z-]+\]/g, '').replace(/\([^)]*\)\s*$/, '').trim()
  const parts = body.split(' - ')
  if (parts.length < 2) return null
  const homeTeam = parts[0].trim()
  const awayTeam = parts.slice(1).join(' - ').trim()

  const iso = `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}T${dt.slice(9, 11)}:${dt.slice(11, 13)}:${dt.slice(13, 15)}Z`
  const utc = new Date(iso)
  if (Number.isNaN(utc.getTime())) return null

  const isArsenalHome = /arsenal/i.test(homeTeam)
  return {
    utc: utc.toISOString(),
    tag,
    home: isArsenalHome,
    opponent: isArsenalHome ? awayTeam : homeTeam,
    scoreHome: score ? +score[1] : null,
    scoreAway: score ? +score[2] : null,
    raw: summary,
  }
}

const events = blocks.map(parseEvent).filter(Boolean).sort((a, b) => a.utc.localeCompare(b.utc))

// 只保留「本赛季」。以 8 月 1 日为赛季起点（含季前热身），到次年 7 月 31 日为止。
const now = new Date()
const seasonStartYear = now.getMonth() + 1 >= 7 ? now.getFullYear() : now.getFullYear() - 1
const from = `${seasonStartYear}-07-15T00:00:00.000Z`
const to = `${seasonStartYear + 1}-07-31T23:59:59.999Z`
const season = events.filter((e) => e.utc >= from && e.utc <= to)

// 热身赛判定：没有标签、且早于本赛季第一场「有标签或联赛」之前的比赛。
// 依据：正式赛季从社区盾/联赛首轮开始，此前无标签的就是季前热身。
const firstReal = season.find((e) => e.tag || e.utc >= `${seasonStartYear}-08-15`)

const matches = season.map((e, i) => {
  const friendly = !e.tag && firstReal && e.utc < firstReal.utc
  const comp = e.tag ? (COMP[e.tag] || { code: e.tag, name: e.tag, order: 8 }) : (friendly ? COMP.FRIENDLY : COMP.PL)
  return {
    id: `${e.utc.slice(0, 10)}-${i}`,
    utc: e.utc,
    comp: comp.code,
    compName: comp.name,
    compOrder: comp.order,
    home: e.home,
    opponent: e.opponent,
    // 已完赛才有比分；主客顺序按「阿森纳视角」存，渲染时不用再判断
    gf: e.scoreHome == null ? null : (e.home ? e.scoreHome : e.scoreAway),
    ga: e.scoreHome == null ? null : (e.home ? e.scoreAway : e.scoreHome),
  }
})

const out = {
  team: 'Arsenal',
  season: `${seasonStartYear}-${seasonStartYear + 1}`,
  generatedAt: new Date().toISOString(),
  source: URL_ICS,
  count: matches.length,
  matches,
}

// ── 补比分 ───────────────────────────────────────────────────────
// 经验：ICS 源和 eventslast 都比「按轮次查」慢一拍（刚踢完的比赛要过一两小时才出现）。
// 关键技巧：英超每轮每队正好一场，所以阿森纳第 k 场英超 = 联赛第 k 轮 ——
// 只查缺比分那几场对应的轮次，1 场 1 个请求，不会把免费接口打到 429。
const API = 'https://www.thesportsdb.com/api/v1/json/123'

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { headers: { 'User-Agent': 'arsenal-app/2.0' } })
    if (r.status === 429) {
      const wait = 3000 * (i + 1)
      console.log(`  ⏳ 接口限流，等 ${wait / 1000}s 重试…`)
      await new Promise((res) => setTimeout(res, wait))
      continue
    }
    if (!r.ok) return null
    return r.json()
  }
  return null
}

const plMatches = matches.filter((m) => m.comp === 'PL')
const missing = plMatches.filter((m) => m.gf == null && m.utc < new Date().toISOString())
let filled = 0

for (const m of missing) {
  const round = plMatches.indexOf(m) + 1 // 阿森纳第 n 场英超 = 第 n 轮
  if (round < 1) continue
  const j = await getJson(`${API}/eventsround.php?id=4328&r=${round}&s=${out.season}`)
  const ev = (j?.events || []).find((e) => /arsenal/i.test(e.strEvent || '') && e.intHomeScore != null)
  if (!ev) continue
  const isHome = /^arsenal/i.test(ev.strHomeTeam)
  m.gf = Number(isHome ? ev.intHomeScore : ev.intAwayScore)
  m.ga = Number(isHome ? ev.intAwayScore : ev.intHomeScore)
  filled++
  await new Promise((res) => setTimeout(res, 600))
}
if (missing.length) console.log(`补齐比分：${filled}/${missing.length} 场`)
writeFileSync(join(ROOT, 'fixtures.json'), JSON.stringify(out, null, 1))
console.log(`fixtures.json  ${matches.length} 场  (${out.season})`)
for (const m of matches.slice(0, 3)) console.log(`  ${m.utc.slice(0, 10)}  ${m.compName.padEnd(4)} ${m.home ? '主' : '客'} ${m.opponent}${m.gf == null ? '' : `  ${m.gf}-${m.ga}`}`)
console.log(`  …`)
for (const m of matches.slice(-2)) console.log(`  ${m.utc.slice(0, 10)}  ${m.compName.padEnd(4)} ${m.home ? '主' : '客'} ${m.opponent}${m.gf == null ? '' : `  ${m.gf}-${m.ga}`}`)
