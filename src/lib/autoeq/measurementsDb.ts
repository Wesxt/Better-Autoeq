/**
 * Remote access to the public AutoEq measurements database
 * (https://github.com/jaakkopasanen/AutoEq/tree/master/measurements).
 *
 * The index is built from the GitHub git-trees API (only 2 requests, which keeps us far
 * below the 60 req/h anonymous rate limit) and cached in localStorage. Individual CSV files
 * are downloaded from raw.githubusercontent.com, which is not rate limited and allows CORS.
 */

const REPO = 'jaakkopasanen/AutoEq'
const BRANCH = 'master'
const CACHE_KEY = 'better-autoeq:autoeq-measurements-index:v1'
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export interface AutoEqMeasurementEntry {
  /** Path relative to the `measurements/` folder */
  path: string
  /** Measurement source / reviewer (e.g. "oratory1990", "crinacle") */
  source: string
  /** Headphone form factor (e.g. "over-ear", "in-ear", "earbud") */
  type: string
  /** Optional measurement rig subfolder (e.g. "GRAS 43AG-7", "711") */
  rig?: string
  /** Product name */
  name: string
}

interface CachedIndex {
  ts: number
  paths: string[]
}

function pathToEntry(path: string): AutoEqMeasurementEntry | null {
  if (!path.toLowerCase().endsWith('.csv')) return null
  const parts = path.split('/')
  // Expected: <source>/data/<type>/[<rig>/]<name>.csv
  if (parts.length < 4 || parts[1] !== 'data') return null
  const source = parts[0]
  const type = parts[2]
  const rig = parts.length >= 5 ? parts.slice(3, -1).join(' / ') : undefined
  const name = parts[parts.length - 1].replace(/\.csv$/i, '')
  return { path, source, type, rig, name }
}

function readCache(): string[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedIndex
    if (!parsed || !Array.isArray(parsed.paths)) return null
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null
    return parsed.paths
  } catch {
    return null
  }
}

function writeCache(paths: string[]) {
  try {
    const payload: CachedIndex = { ts: Date.now(), paths }
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload))
  } catch {
    // Quota exceeded or storage unavailable: index will simply be refetched next time
  }
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } })
  if (!res.ok) {
    if (res.status === 403 || res.status === 429) {
      throw new Error('Límite de peticiones de GitHub alcanzado. Inténtalo de nuevo en unos minutos.')
    }
    throw new Error(`GitHub respondió ${res.status} ${res.statusText}`)
  }
  return res.json()
}

let memoryIndex: AutoEqMeasurementEntry[] | null = null

/**
 * Loads (and caches) the full list of AutoEq measurements.
 * @param forceRefresh skip caches and re-download the index from GitHub
 */
export async function loadAutoEqIndex(forceRefresh = false): Promise<AutoEqMeasurementEntry[]> {
  if (!forceRefresh && memoryIndex) return memoryIndex

  let paths = forceRefresh ? null : readCache()

  if (!paths) {
    const root = await fetchJson(`https://api.github.com/repos/${REPO}/git/trees/${BRANCH}`)
    const measurementsNode = (root.tree as any[]).find(n => n.path === 'measurements' && n.type === 'tree')
    if (!measurementsNode) throw new Error('No se encontró la carpeta "measurements" en el repositorio AutoEq.')

    const tree = await fetchJson(`https://api.github.com/repos/${REPO}/git/trees/${measurementsNode.sha}?recursive=1`)
    paths = (tree.tree as any[])
      .filter(n => n.type === 'blob' && typeof n.path === 'string' && n.path.toLowerCase().endsWith('.csv'))
      .map(n => n.path as string)
    writeCache(paths)
  }

  const entries: AutoEqMeasurementEntry[] = []
  for (const p of paths) {
    const e = pathToEntry(p)
    if (e) entries.push(e)
  }
  entries.sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source))
  memoryIndex = entries
  return entries
}

/** Downloads the raw CSV contents of one measurement. */
export async function fetchAutoEqMeasurement(entry: AutoEqMeasurementEntry): Promise<string> {
  const encodedPath = ['measurements', ...entry.path.split('/')].map(encodeURIComponent).join('/')
  const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${encodedPath}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`No se pudo descargar "${entry.name}" (${res.status})`)
  return res.text()
}
