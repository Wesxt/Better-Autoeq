import { createSignal, For, Show } from 'solid-js'
import { state, frActions } from '../../store/frStore'
import { parseFrequencyResponseFile } from '../../lib/parser/parseFR'
import type { SmoothingType } from '../../lib/autoeq/smoothing'
import {
  Upload,
  Mic,
  Trash2,
  Eye,
  EyeOff,
  GitCompare,
  CheckCircle2,
  Database,
  X
} from 'lucide-solid'
import { ColorPickerPopover } from '../Common/ColorPickerPopover'
import { AutoEqDatabaseModal } from './AutoEqDatabaseModal'

export interface CurveListProps {
  isOpen?: boolean
  onClose?: () => void
}

export function CurveList(props: CurveListProps) {
  let fileInputRef!: HTMLInputElement
  const [isDragging, setIsDragging] = createSignal(false)
  const [isDbOpen, setIsDbOpen] = createSignal(false)

  const smoothingOptions: SmoothingType[] = ['none', '1/1', '1/3', '1/6', '1/12', '1/24', '1/48']

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      try {
        const text = await file.text()
        const parsed = parseFrequencyResponseFile(text, file.name)
        frActions.addCurve(parsed.name, parsed.frequencies, parsed.rawGains)
      } catch (err) {
        console.error('Error parsing file:', err)
        alert(`Error al leer archivo ${file.name}: ${(err as Error).message}`)
      }
    }
  }

  return (
    <>
      {/* Backdrop overlay on mobile & tablet (< lg) */}
      <Show when={props.isOpen}>
        <div
          class="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs lg:hidden"
          onClick={() => props.onClose?.()}
        />
      </Show>

      <aside
        class={`fixed inset-y-0 left-0 z-50 w-[86vw] max-w-80 lg:static lg:z-auto lg:w-72 xl:w-80 h-full flex flex-col bg-[var(--bg-panel)] border-r border-[var(--border-default)] select-none transition-transform duration-200 ease-out shrink-0 ${
          props.isOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Sidebar Header */}
        <div class="flex items-center justify-between p-3 border-b border-[var(--border-default)] bg-[var(--bg-panel)] gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <h2 class="text-xs font-bold uppercase tracking-wider text-[var(--text-pure)] truncate">Respuestas FR</h2>
            <span class="px-1.5 py-0.5 text-[10px] font-mono bg-[var(--accent-blue-badge-bg)] text-[var(--accent-blue-badge-text)] border border-[var(--accent-blue-badge-border)] rounded-full font-bold shrink-0">
              {state.curves.length}
            </span>
          </div>

          <div class="flex items-center gap-1.5 shrink-0">
            {/* Global Smoothing selector */}
            <div class="flex items-center gap-1 text-xs text-[var(--text-muted)]">
              <span class="text-[10px]">Suavizado:</span>
              <select
                class="bg-[var(--bg-surface)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded px-1.5 py-0.5 text-xs focus:border-[var(--accent-blue)] outline-none"
                value={state.globalSmoothing}
                onChange={(e) => frActions.setGlobalSmoothing(e.currentTarget.value as SmoothingType)}
              >
                <For each={smoothingOptions}>
                  {(opt) => <option value={opt}>{opt === 'none' ? 'Raw' : opt + ' oct'}</option>}
                </For>
              </select>
            </div>

            {/* Close Drawer Button on Mobile/Tablet (< lg) */}
            <button
              type="button"
              onClick={() => props.onClose?.()}
              class="lg:hidden p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-pure)] hover:bg-[var(--bg-surface)] transition-colors cursor-pointer"
              title="Cerrar panel"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Upload Drop Zone & Actions */}
        <div class="p-3 border-b border-[var(--border-default)] flex flex-col gap-2 bg-[var(--bg-panel)]">
          <input
            type="file"
            ref={fileInputRef}
            multiple
            accept=".txt,.csv"
            class="hidden"
            onChange={(e) => handleFiles(e.currentTarget.files)}
          />

          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setIsDragging(false)
              handleFiles(e.dataTransfer?.files || null)
            }}
            onClick={() => fileInputRef.click()}
            class={`flex flex-col items-center justify-center p-3 rounded-lg border-2 border-dashed cursor-pointer transition-all active:scale-[0.99] text-center ${
              isDragging()
                ? 'border-[var(--accent-blue)] bg-[var(--accent-blue-bg)]'
                : 'border-[var(--border-contrast)] hover:border-[var(--border-hover)] bg-[var(--bg-surface)]'
            }`}
          >
            <Upload size={18} class="text-[var(--text-main)] mb-1" />
            <span class="text-xs font-semibold text-[var(--text-pure)]">Cargar archivos .txt o .csv</span>
            <span class="text-[10px] text-[var(--text-muted)]">Toca o arrastra (REW, AutoEq, Crinacle)</span>
          </div>

          <button
            onClick={() => setIsDbOpen(true)}
            class="flex items-center justify-center gap-2 py-2 px-3 bg-[var(--bg-surface)] hover:bg-[var(--border-contrast)] active:scale-[0.99] text-[var(--text-main)] border border-[var(--border-contrast)] hover:border-[var(--accent-blue)] rounded-lg text-xs font-semibold transition-all group cursor-pointer"
            title="Buscar e importar mediciones del repositorio AutoEq"
          >
            <Database size={14} class="text-[var(--accent-blue)] group-hover:scale-110 transition-transform" />
            <span>Importar desde AutoEq</span>
          </button>

          <button
            onClick={() => {
              props.onClose?.()
              frActions.openMicModal()
            }}
            class="flex items-center justify-center gap-2 py-2 px-3 bg-[var(--bg-surface)] hover:bg-[var(--border-contrast)] active:scale-[0.99] text-[var(--text-main)] border border-[var(--border-contrast)] hover:border-[var(--accent-blue)] rounded-lg text-xs font-semibold transition-all group cursor-pointer"
          >
            <Mic size={14} class="text-[var(--accent-blue)] group-hover:scale-110 transition-transform" />
            <span>Medir con Micrófono en Vivo</span>
          </button>
        </div>

      {/* Loaded Curves List */}
      <div class="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
        <For each={state.curves}>
          {(curve) => {
            const isRef = () => curve.id === state.activeReferenceCurveId

            return (
              <div
                class={`p-2.5 rounded-lg border transition-all flex flex-col gap-2 ${
                  isRef()
                    ? 'bg-[var(--bg-surface)] border-[var(--accent-blue)] shadow-[0_0_12px_rgba(0,85,255,0.15)]'
                    : 'bg-[var(--bg-card)] border-[var(--border-default)] hover:border-[var(--border-contrast)]'
                }`}
              >
                {/* Curve Header */}
                <div class="flex items-center justify-between gap-1.5">
                  <div class="flex items-center gap-2 min-w-0 flex-1">
                    {/* Interactive Color Picker */}
                    <ColorPickerPopover
                      color={curve.color}
                      onChange={(newColor) => frActions.setCurveColor(curve.id, newColor)}
                      title={`Color: ${curve.name}`}
                      size="sm"
                    />
                    {/* Curve title */}
                    <span class="text-xs font-semibold text-[var(--text-pure)] truncate" title={curve.name}>
                      {curve.name}
                    </span>
                  </div>

                  {/* Actions */}
                  <div class="flex items-center gap-1 shrink-0">
                    {/* Visibility */}
                    <button
                      onClick={() => frActions.toggleCurveVisibility(curve.id)}
                      class="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-pure)] active:scale-95 transition-all cursor-pointer"
                      title={curve.visible ? 'Ocultar en gráfica' : 'Mostrar en gráfica'}
                    >
                      {curve.visible ? <Eye size={14} class="text-[var(--text-main)]" /> : <EyeOff size={14} class="text-[var(--text-dim)]" />}
                    </button>

                    {/* Delete */}
                    <button
                      onClick={() => frActions.removeCurve(curve.id)}
                      class="p-1.5 rounded text-[var(--text-muted)] hover:text-[#FF0000] hover:bg-[#3D0000]/30 hover:border hover:border-[#950101]/60 active:scale-95 transition-all cursor-pointer"
                      title="Eliminar curva"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Reference Curve Selector Badge */}
                <div class="flex items-center justify-between text-[11px] pt-1 border-t border-[var(--border-default)]">
                  <button
                    onClick={() => frActions.setActiveReference(curve.id)}
                    class={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                      isRef()
                        ? 'bg-[var(--accent-blue)] text-[#ffffff]'
                        : 'bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-pure)]'
                    }`}
                  >
                    <CheckCircle2 size={11} />
                    {isRef() ? 'Referencia AutoEq' : 'Fijar Referencia'}
                  </button>

                  {/* Individual Smoothing */}
                  <select
                    class="bg-[var(--bg-surface)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded px-1 text-[10px] outline-none"
                    value={curve.smoothing}
                    onChange={(e) => frActions.setCurveSmoothing(curve.id, e.currentTarget.value as SmoothingType)}
                  >
                    <For each={smoothingOptions}>
                      {(opt) => <option value={opt}>{opt === 'none' ? 'Raw' : opt}</option>}
                    </For>
                  </select>
                </div>

                {/* Gain offset slider */}
                <div class="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                  <span class="w-10">Offset:</span>
                  <input
                    type="range"
                    min="-20"
                    max="20"
                    step="0.5"
                    value={curve.offsetDb}
                    onInput={(e) => frActions.setCurveOffset(curve.id, parseFloat(e.currentTarget.value))}
                    class="flex-1 h-1 bg-[var(--border-contrast)] rounded appearance-none cursor-pointer accent-[var(--accent-blue)]"
                  />
                  <span class="w-10 text-right font-mono text-[var(--text-main)]">{curve.offsetDb > 0 ? `+${curve.offsetDb}` : curve.offsetDb} dB</span>
                </div>
              </div>
            )
          }}
        </For>
      </div>

      {/* Delta (Difference Curve A - B) Tool */}
      <div class="p-3 border-t border-[var(--border-default)] bg-[var(--bg-panel)] flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5 text-xs font-bold text-[var(--text-pure)]">
            <ColorPickerPopover
              color={state.overlayColors.delta || '#FF0000'}
              onChange={(newColor) => frActions.setOverlayColor('delta', newColor)}
              title="Color de Curva Delta"
              size="sm"
            />
            <GitCompare size={14} class={state.showDelta ? 'text-[#FF0000]' : 'text-[var(--accent-blue)]'} />
            <span>Comparar Delta (A - B)</span>
          </div>

          <button
            onClick={() => frActions.toggleShowDelta()}
            class={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
              state.showDelta
                ? 'bg-gradient-to-r from-[#FF0000] to-[#950101] text-[#ffffff] border-[#FF0000] shadow-[0_0_12px_rgba(255,0,0,0.4)]'
                : 'bg-[var(--bg-surface)] text-[var(--text-muted)] border-[var(--border-contrast)] hover:text-[var(--text-pure)]'
            }`}
          >
            {state.showDelta ? 'ACTIVO' : 'ACTIVAR'}
          </button>
        </div>

        {state.showDelta && (
          <div class="flex flex-col gap-1.5 text-[11px] text-[var(--text-muted)] pt-1">
            <div class="flex items-center justify-between">
              <span>Curva Base (A):</span>
              <span class="text-[var(--text-pure)] font-medium truncate max-w-[140px]">
                {state.curves.find(c => c.id === state.activeReferenceCurveId)?.name || 'Ninguna'}
              </span>
            </div>
            <div class="flex items-center justify-between">
              <span>Comparar con (B):</span>
              <select
                class="bg-[var(--bg-surface)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded px-1.5 py-0.5 text-[10px] outline-none max-w-[150px]"
                value={state.deltaSecondaryCurveId || ''}
                onChange={(e) => frActions.setDeltaSecondaryCurve(e.currentTarget.value)}
              >
                <For each={state.curves.filter(c => c.id !== state.activeReferenceCurveId)}>
                  {(c) => <option value={c.id}>{c.name}</option>}
                </For>
              </select>
            </div>
          </div>
        )}
      </div>

      <AutoEqDatabaseModal open={isDbOpen()} onClose={() => setIsDbOpen(false)} />
      </aside>
    </>
  )
}
