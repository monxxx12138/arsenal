// 生成 details.json —— 下一场（以及后面几场）的比赛前瞻：历史交手、预计首发、双方近期战绩
//
// 数据源：FotMob 的公开接口（非官方，但免费、无需 key、数据很全）
//   /api/data/teams?id=9825              阿森纳的赛程 + 大名单 + 近况
//   /api/data/matchDetails?matchId=xxx   某场比赛的 H2H 与（赛前的）预测阵容
// 注意：这些接口没有 CORS 头，所以只能在构建时抓，浏览器里抓不到。
//
// 用法：node build-details.mjs [场次数，默认 6]
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const LIMIT = Number(process.argv[2] || 6)
const ARSENAL_ID = 9825
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  Accept: 'application/json',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { headers: H })
    if (r.status === 429 || r.status >= 500) {
      await sleep(2000 * (i + 1))
      continue
    }
    if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`)
    return r.json()
  }
  throw new Error(`${url} -> 多次失败`)
}

/** 从某个队的 fixtures 里算出最近 n 场（已结束）的胜平负 */
function recentForm(fixtures, teamName, n = 5) {
  const done = fixtures
    .filter((f) => f.status?.finished && f.home?.score != null && f.away?.score != null)
    .sort((a, b) => new Date(b.status.utcTime) - new Date(a.status.utcTime))
    .slice(0, n)
  return done.map((f) => {
    const isHome = String(f.home?.name || '').toLowerCase() === teamName.toLowerCase()
    const gf = Number(isHome ? f.home.score : f.away.score)
    const ga = Number(isHome ? f.away.score : f.home.score)
    return {
      utc: f.status?.utcTime,
      comp: f.tournament?.name || '',
      home: f.home?.name,
      away: f.away?.name,
      opp: isHome ? f.away?.name : f.home?.name,
      gf,
      ga,
      result: gf > ga ? 'W' : gf === ga ? 'D' : 'L',
    }
  })
}

function squadOf(team) {
  const groups = team?.squad?.squad || []
  return groups
    .filter((g) => g.title !== 'coach')
    .map((g) => ({
      group: g.title,
      players: (g.members || []).map((m) => ({ name: m.name || m.cname, pos: m.role?.fallback || '' })),
    }))
    .filter((g) => g.players.length)
}

function lineupOf(md) {
  const lu = md?.content?.lineup
  if (!lu) return null
  const side = (t) => {
    if (!t) return null
    return {
      name: t.name,
      formation: t.formation || '',
      coach: t.coach?.name || '',
      starters: (t.starters || []).map((p) => ({
        name: p.name || '',
        shirt: p.shirtNumber ? Number(p.shirtNumber) : null,
      })).filter((p) => p.name),
      unavailable: (t.unavailable || []).map((p) => ({
        name: p.name || '',
        type: p.unavailability?.type || '',
        back: p.unavailability?.expectedReturn || '',
      })).filter((p) => p.name),
    }
  }
  const home = side(lu.homeTeam)
  const away = side(lu.awayTeam)
  if (!home?.starters?.length && !away?.starters?.length) return null
  return { type: lu.lineupType || '', home, away }
}

function h2hOf(md) {
  const arr = md?.content?.h2h?.matches || []
  return arr
    .filter((m) => m.status?.finished && m.status?.scoreStr)
    .sort((a, b) => new Date(b.status.utcTime) - new Date(a.status.utcTime))
    .slice(0, 8)
    .map((m) => ({
      utc: m.status?.utcTime,
      league: m.league?.name || '',
      home: m.home?.name || '',
      away: m.away?.name || '',
      score: m.status.scoreStr,
      homeId: m.home?.id,
      awayId: m.away?.id,
    }))
}

// ── 主流程 ───────────────────────────────────────────────────────
console.log('拉取阿森纳球队数据…')
const team = await getJson(`https://www.fotmob.com/api/data/teams?id=${ARSENAL_ID}`)
const fixtures = team?.fixtures?.allFixtures?.fixtures || []
console.log(`  赛程 ${fixtures.length} 场，大名单 ${(team?.squad?.squad || []).length} 组`)

const now = Date.now()
const upcoming = fixtures
  .filter((f) => new Date(f.status?.utcTime || 0).getTime() > now - 2 * 3600e3)
  .sort((a, b) => new Date(a.status.utcTime) - new Date(b.status.utcTime))
  .slice(0, LIMIT)

console.log(`取接下来 ${upcoming.length} 场做前瞻…`)

const matches = []
for (const f of upcoming) {
  const oppId = f.opponent?.id
  const entry = {
    matchId: f.id,
    utc: f.status?.utcTime,
    home: f.home?.name,
    away: f.away?.name,
    competition: f.tournament?.name || '',
    opponentId: oppId,
    opponent: f.opponent?.name,
    h2h: [],
    lineup: null,
    opponentForm: [],
  }
  try {
    const md = await getJson(`https://www.fotmob.com/api/data/matchDetails?matchId=${f.id}`)
    entry.h2h = h2hOf(md)
    entry.lineup = lineupOf(md)
    console.log(`  ${entry.utc?.slice(0, 10)} ${entry.home} vs ${entry.away}: H2H ${entry.h2h.length} 场, 阵容 ${entry.lineup ? entry.lineup.type : '无'}`)
  } catch (e) {
    console.log(`  ${entry.utc?.slice(0, 10)} 详情失败：${e.message}`)
  }

  // 对手近况（多一次请求；失败不影响主体）
  if (oppId) {
    try {
      await sleep(400)
      const opp = await getJson(`https://www.fotmob.com/api/data/teams?id=${oppId}`)
      const oppFixtures = opp?.fixtures?.allFixtures?.fixtures || []
      entry.opponentForm = recentForm(oppFixtures, entry.opponent || '')
    } catch { /* 拿不到就算了 */ }
  }
  matches.push(entry)
  await sleep(500)
}

const out = {
  generatedAt: new Date().toISOString(),
  source: 'fotmob',
  arsenal: {
    squad: squadOf(team),
    form: recentForm(fixtures, 'Arsenal', 5),
  },
  matches,
}
writeFileSync(join(ROOT, 'details.json'), JSON.stringify(out, null, 1))
console.log(`\ndetails.json 完成：${matches.length} 场前瞻，${(JSON.stringify(out).length / 1024).toFixed(1)} KB`)
