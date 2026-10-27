import { createSignal, createMemo, createEffect, For, Show, onCleanup } from 'solid-js'
import { Portal } from 'solid-js/web'
import { X, Database, Search, Download, Check, Loader2, RefreshCw } from 'lucide-solid'
import { frActions } from '../../store/frStore'
import { parseFrequencyResponseFile } from '../../lib/parser/parseFR'
import {
  loadAutoEqIndex,
  fetchAutoEqMeasurement,
  type AutoEqMeasurementEntry
} from '../../lib/autoeq/measurementsDb'

const MAX_RESULTS = 200

interface Props {
  open: boolean
  onClose: () => void
}

export function AutoEqDatabaseModal(props: Props) {
  const [entries, setEntries] = createSignal<AutoEqMeasurementEntry[]>([])
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [query, setQuery] = createSignal('')
  const [sourceFilter, setSourceFilter] = createSignal('')
  const [typeFilter, setTypeFilter] = createSignal('')
  const [importing, setImporting] = createSignal<Set<string>>(new Set())
  const [imported, setImported] = createSignal<Set<string>>(new Set())
  let searchRef: HTMLInputElement | undefined

  async function load(force = false) {
    setLoading(true)
    setError(null)
    try {
      setEntries(await loadAutoEqIndex(force))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  // Lazily fetch the index the first time the modal opens
  createEffect(() => {
    if (props.open) {
      if (entries().length === 0 && !loading()) load()
      queueMicrotask(() => searchRef?.focus())
    }
  })

  // Close on Escape
  createEffect(() => {
    if (!props.open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose() }
    window.addEventListener('keydown', onKey)
    onCleanup(() => window.removeEventListener('keydown', onKey))
  })

  const sources = createMemo(() => [...new Set(entries().map(e => e.source))].sort((a, b) => a.localeCompare(b)))
  const types = createMemo(() => [...new Set(entries().map(e => e.type))].sort())

  const filtered = createMemo(() => {
    const terms = query().toLowerCase().split(/\s+/).filter(Boolean)
    const src = sourceFilter()
    const typ = typeFilter()
    return entries().filter(e => {
      if (src && e.source !== src) return false
      if (typ && e.type !== typ) return false
      if (terms.length === 0) return true
      const hay = `${e.name} ${e.source} ${e.rig ?? ''}`.toLowerCase()
      return terms.every(t => hay.includes(t))
    })
  })

  async function importEntry(entry: AutoEqMeasurementEntry) {
    if (importing().has(entry.path)) return
    setImporting(prev => new Set(prev).add(entry.path))
    try {
      const text = await fetchAutoEqMeasurement(entry)
      const parsed = parseFrequencyResponseFile(text, `${entry.name}.csv`)
      const label = entry.rig ? `${entry.name} (${entry.source} · ${entry.rig})` : `${entry.name} (${entry.source})`
      frActions.addCurve(label, parsed.frequencies, parsed.rawGains)
      setImported(prev => new Set(prev).add(entry.path))
    } catch (err) {
      alert(`Error al importar ${entry.name}: ${(err as Error).message}`)
    } finally {
      setImporting(prev => {
        const next = new Set(prev)
        next.delete(entry.path)
        return next
      })
    }
  }

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-4 select-none"
          onClick={(e) => { if (e.target === e.currentTarget) props.onClose() }}
        >
          <div class="w-full max-w-2xl h-[85dvh] sm:h-[80vh] bg-[var(--bg-modal)] border border-[var(--border-default)] rounded-xl shadow-2xl overflow-hidden flex flex-col text-xs transition-colors">
            {/* Header */}
            <div class="flex items-center justify-between px-3.5 sm:px-5 py-3 sm:py-3.5 border-b border-[var(--border-default)] bg-[var(--bg-panel)]">
              <div class="flex items-center gap-2 min-w-0">
                <Database size={16} class="text-[var(--accent-blue)] shrink-0" />
                <h2 class="text-xs sm:text-sm font-bold text-[var(--text-pure)] uppercase tracking-wide truncate">
                  Base de datos AutoEq
                </h2>
                <Show when={entries().length > 0}>
                  <span class="px-1.5 py-0.5 text-[10px] font-mono bg-[var(--accent-blue-badge-bg)] text-[var(--accent-blue-badge-text)] border border-[var(--accent-blue-badge-border)] rounded-full font-bold shrink-0">
                    {entries().length}
                  </span>
                </Show>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => load(true)}
                  disabled={loading()}
                  class="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-pure)] rounded transition-colors disabled:opacity-40 cursor-pointer"
                  title="Recargar índice desde GitHub"
                >
                  <RefreshCw size={14} class={loading() ? 'animate-spin' : ''} />
                </button>
                <button
                  onClick={() => props.onClose()}
                  class="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-pure)] rounded transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Filters */}
            <div class="flex flex-col gap-2 px-3.5 sm:px-5 py-2.5 sm:py-3 border-b border-[var(--border-default)] bg-[var(--bg-panel)]">
              <div class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-contrast)] focus-within:border-[var(--accent-blue)]">
                <Search size={14} class="text-[var(--text-muted)] shrink-0" />
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="Buscar auricular (ej. HD 650, Moondrop Aria...)"
                  value={query()}
                  onInput={(e) => setQuery(e.currentTarget.value)}
                  class="flex-1 min-w-0 bg-transparent outline-none text-[var(--text-main)] placeholder:text-[var(--text-dim)] select-text"
                />
              </div>
              <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <select
                  class="flex-1 bg-[var(--bg-surface)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded px-1.5 py-1 text-xs outline-none"
                  value={sourceFilter()}
                  onChange={(e) => setSourceFilter(e.currentTarget.value)}
                >
                  <option value="">Todas las fuentes</option>
                  <For each={sources()}>{(s) => <option value={s}>{s}</option>}</For>
                </select>
                <select
                  class="flex-1 bg-[var(--bg-surface)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded px-1.5 py-1 text-xs outline-none"
                  value={typeFilter()}
                  onChange={(e) => setTypeFilter(e.currentTarget.value)}
                >
                  <option value="">Todos los tipos</option>
                  <For each={types()}>{(t) => <option value={t}>{t}</option>}</For>
                </select>
              </div>
            </div>

            {/* Results */}
            <div class="flex-1 overflow-y-auto p-2">
              <Show when={loading() && entries().length === 0}>
                <div class="flex flex-col items-center justify-center h-full gap-2 text-[var(--text-muted)]">
                  <Loader2 size={20} class="animate-spin text-[var(--accent-blue)]" />
                  <span>Descargando índice de mediciones desde GitHub…</span>
                </div>
              </Show>

              <Show when={error()}>
                <div class="m-2 p-3 rounded-lg border border-[#950101]/60 bg-[#3D0000]/30 text-[#FF6B6B] flex items-center justify-between gap-2">
                  <span>{error()}</span>
                  <button onClick={() => load(true)} class="px-2 py-0.5 rounded border border-current font-semibold">
                    Reintentar
                  </button>
                </div>
              </Show>

              <Show when={!loading() && entries().length > 0 && filtered().length === 0}>
                <div class="flex items-center justify-center h-full text-[var(--text-muted)]">Sin resultados</div>
              </Show>

              <div class="flex flex-col gap-1">
                <For each={filtered().slice(0, MAX_RESULTS)}>
                  {(entry) => {
                    const isImporting = () => importing().has(entry.path)
                    const isImported = () => imported().has(entry.path)
                    return (
                      <button
                        onClick={() => importEntry(entry)}
                        disabled={isImporting()}
                        class="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] hover:border-[var(--accent-blue)] text-left transition-colors group"
                        title={`Importar ${entry.name}`}
                      >
                        <div class="flex flex-col min-w-0">
                          <span class="font-semibold text-[var(--text-pure)] truncate">{entry.name}</span>
                          <span class="text-[10px] text-[var(--text-muted)] truncate">
                            {entry.source} · {entry.type}{entry.rig ? ` · ${entry.rig}` : ''}
                          </span>
                        </div>
                        <span class="shrink-0">
                          <Show
                            when={isImporting()}
                            fallback={
                              isImported()
                                ? <Check size={14} class="text-[#00cc66]" />
                                : <Download size={14} class="text-[var(--text-muted)] group-hover:text-[var(--accent-blue)]" />
                            }
                          >
                            <Loader2 size={14} class="animate-spin text-[var(--accent-blue)]" />
                          </Show>
                        </span>
                      </button>
                    )
                  }}
                </For>
              </div>
            </div>

            {/* Footer */}
            <div class="px-3.5 sm:px-5 py-2 border-t border-[var(--border-default)] bg-[var(--bg-panel)] text-[10px] text-[var(--text-muted)] flex flex-wrap justify-between gap-1">
              <span>
                {filtered().length > MAX_RESULTS
                  ? `Mostrando ${MAX_RESULTS} de ${filtered().length} — refina la búsqueda`
                  : `${filtered().length} resultados`}
              </span>
              <a
                href="https://github.com/jaakkopasanen/AutoEq/tree/master/measurements"
                target="_blank"
                rel="noopener noreferrer"
                class="hover:text-[var(--accent-blue)]"
              >
                Fuente: jaakkopasanen/AutoEq
              </a>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  )
}
