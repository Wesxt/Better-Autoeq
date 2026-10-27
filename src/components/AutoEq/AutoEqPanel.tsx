import { createSignal, For, Show } from 'solid-js'
import {
  state,
  frActions,
  targetCurve,
  equalizationCurve,
  peqCompoundCurve,
  firCompoundCurve,
  graphicEqCompoundCurve,
  equalizedResultCurve,
  activeEqualizationCurve
} from '../../store/frStore'
import { BUILT_IN_TARGETS, PREAMP_HEADROOM, STANDARD_FREQUENCIES } from '../../lib/autoeq/constants'
import { parseFrequencyResponseFile } from '../../lib/parser/parseFR'
import {
  generateEqualizerApoConfig,
  generateGraphicEqString,
  generateRewText,
  generateCsv,
  downloadTextFile,
  cleanExportFilename
} from '../../lib/autoeq/exporters'
import { formatGraphicEqApoDirective, type GraphicEqBandCount } from '../../lib/autoeq/graphicEq'
import { generateImpulseResponse } from '../../lib/autoeq/impulseResponse'
import { encodeWav, downloadWavFile } from '../../lib/audio/wavEncoder'
import {
  SlidersHorizontal,
  Target,
  Wand2,
  Copy,
  Download,
  Check,
  Sliders,
  FileAudio,
  Sparkles,
  Layers,
  Activity,
  Plus,
  Trash2,
  Filter
} from 'lucide-solid'

export function AutoEqPanel() {
  const [copiedType, setCopiedType] = createSignal<string | null>(null)
  const [mobileView, setMobileView] = createSignal<'target' | 'method'>('method')
  let customTargetInputRef!: HTMLInputElement

  // Calculate compound max gain for preamp based on active EQ method
  const maxGain = () => {
    const eq = activeEqualizationCurve()
    let max = 0
    for (const g of eq) if (g > max) max = g
    return max
  }

  const calculatedPreamp = () => {
    const mg = maxGain()
    return mg > 0 ? -(mg + PREAMP_HEADROOM) : 0
  }

  const activeCurve = () => state.curves.find(c => c.id === state.activeReferenceCurveId)

  async function handleCustomTarget(file: File | null) {
    if (!file) return
    try {
      const text = await file.text()
      const parsed = parseFrequencyResponseFile(text, file.name)
      const points: [number, number][] = parsed.frequencies.map((f, i) => [f, parsed.rawGains[i]])
      frActions.setCustomTarget({
        id: 'custom',
        name: parsed.name,
        description: 'Curva objetivo personalizada cargada por el usuario',
        points
      })
    } catch (err) {
      alert(`Error al cargar target: ${(err as Error).message}`)
    }
  }

  // PEQ Actions
  function copyEqApo() {
    const config = generateEqualizerApoConfig(state.peqFilters, STANDARD_FREQUENCIES)
    navigator.clipboard.writeText(config)
    setCopiedType('eqapo')
    setTimeout(() => setCopiedType(null), 2000)
  }

  function downloadEqApo() {
    const c = activeCurve()
    const name = c ? cleanExportFilename(c.name) : 'Equalizer'
    const config = generateEqualizerApoConfig(state.peqFilters, STANDARD_FREQUENCIES)
    downloadTextFile(config, `${name}_EqualizerAPO.txt`)
  }

  // FIR Actions
  function downloadFirWav() {
    const eqData = equalizationCurve()
    const ir = generateImpulseResponse(STANDARD_FREQUENCIES, eqData, {
      fs: state.firSampleRate,
      taps: state.firTaps,
      phase: state.firPhase,
      normalize: true,
      preamp: 0
    })
    const wavBytes = encodeWav(ir, {
      sampleRate: state.firSampleRate,
      bitDepth: 24,
      channels: 'stereo'
    })
    const c = activeCurve()
    const baseName = c ? cleanExportFilename(c.name) : 'AutoEq'
    downloadWavFile(wavBytes, `${baseName}_FIR_${state.firSampleRate}Hz_${state.firTaps}taps_${state.firPhase}.wav`)
  }

  // GraphicEQ Actions
  function copyGraphicEqApo() {
    const str = formatGraphicEqApoDirective(state.graphicEqBands, calculatedPreamp())
    navigator.clipboard.writeText(str)
    setCopiedType('graphiceq')
    setTimeout(() => setCopiedType(null), 2000)
  }

  function downloadGraphicEqApo() {
    const c = activeCurve()
    const baseName = c ? cleanExportFilename(c.name) : 'AutoEq'
    const str = formatGraphicEqApoDirective(state.graphicEqBands, calculatedPreamp())
    const suffix = state.graphicEqBandsCount === 127 ? '_GraphicEQ_Wavelet.txt' : `_GraphicEQ_${state.graphicEqBandsCount}bands.txt`
    downloadTextFile(str, `${baseName}${suffix}`)
  }

  function copyWaveletGraphicEq() {
    const eq = equalizationCurve()
    if (!eq || eq.length === 0) return
    const str = generateGraphicEqString(STANDARD_FREQUENCIES, eq, true, calculatedPreamp())
    navigator.clipboard.writeText(str)
    setCopiedType('wavelet')
    setTimeout(() => setCopiedType(null), 2000)
  }

  // Ideal Actions
  function copyRew() {
    const c = activeCurve()
    const name = c ? c.name : 'Target Equalization'
    const text = generateRewText(STANDARD_FREQUENCIES, equalizationCurve(), name)
    navigator.clipboard.writeText(text)
    setCopiedType('rew')
    setTimeout(() => setCopiedType(null), 2000)
  }

  function downloadRew() {
    const c = activeCurve()
    const baseName = c ? cleanExportFilename(c.name) : 'AutoEq'
    const text = generateRewText(STANDARD_FREQUENCIES, equalizationCurve(), baseName)
    downloadTextFile(text, `${baseName}_REW_Inverse.txt`)
  }

  function downloadCsvData() {
    const c = activeCurve()
    const baseName = c ? cleanExportFilename(c.name) : 'AutoEq'
    const csv = generateCsv(STANDARD_FREQUENCIES, [
      { name: 'measurement_raw', values: c ? c.rawGains : [] },
      { name: 'measurement_smoothed', values: c ? c.smoothedGains : [] },
      { name: 'target', values: targetCurve() },
      { name: 'equalization_ideal', values: equalizationCurve() },
      { name: 'peq_compound', values: peqCompoundCurve() },
      { name: 'fir_compound', values: firCompoundCurve() },
      { name: 'graphiceq_compound', values: graphicEqCompoundCurve() },
      { name: 'equalized_result', values: equalizedResultCurve() }
    ])
    downloadTextFile(csv, `${baseName}_AutoEq_AllCurves.csv`, 'text/csv;charset=utf-8')
  }

  function formatBandFreq(f: number): string {
    if (f >= 1000) {
      const k = f / 1000
      return k % 1 === 0 ? `${k}k` : `${k.toFixed(1)}k`
    }
    return `${Math.round(f)}`
  }

  return (
    <div class="h-[45dvh] min-h-[250px] max-h-[360px] lg:max-h-none lg:h-64 xl:h-72 shrink-0 flex flex-col bg-[var(--bg-panel)] border rounded-[8px] overflow-clip border-[var(--border-default)] select-none text-xs transition-colors shadow-sm">
      {/* Panel Navigation / Header */}
      <div class="flex flex-wrap items-center justify-between px-2.5 sm:px-3.5 py-1.5 border-b border-[var(--border-default)] bg-[var(--bg-panel)] gap-1.5 sm:gap-2">
        <div class="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
          <div class="flex items-center gap-1.5 font-bold text-[var(--text-pure)] uppercase tracking-wide text-[11px] shrink-0">
            <Wand2 size={14} class="text-[var(--accent-blue)]" />
            <span class="hidden sm:inline">AutoEq Processing Studio</span>
            <span class="sm:hidden">AutoEq</span>
          </div>

          {/* Target Selector */}
          <div class="flex items-center gap-1.5 sm:ml-1 min-w-0">
            <Target size={13} class="text-[var(--text-muted)] shrink-0" />
            <span class="hidden sm:inline text-[var(--text-muted)]">Target:</span>
            <select
              class="bg-[var(--bg-surface)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded px-1.5 sm:px-2 py-0.5 font-medium outline-none focus:border-[var(--accent-blue)] max-w-[145px] sm:max-w-none truncate"
              value={state.selectedTargetId}
              onChange={(e) => frActions.setTarget(e.currentTarget.value)}
            >
              <For each={BUILT_IN_TARGETS}>
                {(t) => <option value={t.id}>{t.name}</option>}
              </For>
              {state.customTarget && <option value="custom">★ {state.customTarget.name} (Custom)</option>}
            </select>

            {/* Upload Custom Target Button */}
            <input
              type="file"
              ref={customTargetInputRef}
              accept=".txt,.csv"
              class="hidden"
              onChange={(e) => handleCustomTarget(e.currentTarget.files?.[0] || null)}
            />
            <button
              onClick={() => customTargetInputRef.click()}
              class="px-2 py-0.5 bg-[var(--bg-surface)] hover:bg-[var(--border-contrast)] text-[var(--text-main)] hover:text-[var(--text-pure)] rounded border border-[var(--border-contrast)] text-[10px] transition-colors shrink-0 whitespace-nowrap cursor-pointer"
              title="Cargar archivo de curva objetivo personalizada"
            >
              + Subir Target
            </button>
          </div>
        </div>

        {/* Preamp Headroom & Action Buttons */}
        <div class="flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar max-w-full">
          {/* Preamp badge */}
          <div class="flex items-center gap-1 px-2 py-0.5 bg-[var(--bg-card)] border border-[var(--border-default)] rounded font-mono text-[11px] shrink-0 whitespace-nowrap" title="Atenuación automática anti-clipping calculada para el método de ecualización activo">
            <span class="text-[var(--text-muted)]">Preamp:</span>
            <span class={`font-bold ${calculatedPreamp() < -6 ? 'text-[#FF0000]' : 'text-[var(--accent-blue-badge-text)]'}`}>
              {calculatedPreamp().toFixed(1)} dB
            </span>
          </div>

          {/* Contextual Action Buttons for Active EQ Method */}
          <Show when={state.selectedEqMethod === 'peq'}>
            <button
              onClick={copyEqApo}
              class="flex items-center gap-1 px-2 sm:px-2.5 py-1 bg-[var(--bg-surface)] hover:bg-[var(--border-contrast)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded font-semibold transition-colors shrink-0 whitespace-nowrap cursor-pointer"
              title="Copiar filtros de EqualizerAPO al portapapeles"
            >
              {copiedType() === 'eqapo' ? <Check size={12} class="text-[#00FF88]" /> : <Copy size={12} />}
              <span>{copiedType() === 'eqapo' ? '¡Copiado!' : 'Copiar PEQ'}</span>
            </button>
            <button
              onClick={downloadEqApo}
              class="flex items-center gap-1 px-2 sm:px-2.5 py-1 bg-[var(--bg-surface)] hover:bg-[var(--border-contrast)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded font-semibold transition-colors shrink-0 whitespace-nowrap cursor-pointer"
              title="Descargar archivo config.txt para EqualizerAPO"
            >
              <Download size={12} />
              <span>Descargar PEQ</span>
            </button>
          </Show>

          <Show when={state.selectedEqMethod === 'fir'}>
            <button
              onClick={downloadFirWav}
              class="flex items-center gap-1.5 px-2 sm:px-2.5 py-1 bg-[var(--bg-surface)] hover:bg-[var(--border-contrast)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded font-semibold transition-colors shrink-0 whitespace-nowrap cursor-pointer"
              title="Descargar respuesta al impulso en formato WAV estéreo de 24-bit"
            >
              <Download size={12} />
              <span>Descargar WAV FIR</span>
            </button>
          </Show>

          <Show when={state.selectedEqMethod === 'graphiceq'}>
            <button
              onClick={copyGraphicEqApo}
              class="flex items-center gap-1 px-2 sm:px-2.5 py-1 bg-[var(--bg-surface)] hover:bg-[var(--border-contrast)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded font-semibold transition-colors shrink-0 whitespace-nowrap cursor-pointer"
              title={state.graphicEqBandsCount === 127 ? 'Copiar 127 frecuencias estándar para Wavelet y Equalizer APO' : 'Copiar directiva GraphicEQ para EqualizerAPO'}
            >
              {copiedType() === 'graphiceq' ? <Check size={12} class="text-[#00FF88]" /> : <Copy size={12} />}
              <span>{copiedType() === 'graphiceq' ? '¡Copiado!' : (state.graphicEqBandsCount === 127 ? 'Copiar Wavelet (127)' : 'Copiar GraphicEQ')}</span>
            </button>
            <button
              onClick={downloadGraphicEqApo}
              class="flex items-center gap-1 px-2 sm:px-2.5 py-1 bg-[var(--bg-surface)] hover:bg-[var(--border-contrast)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded font-semibold transition-colors shrink-0 whitespace-nowrap cursor-pointer"
              title="Descargar directiva GraphicEQ en archivo .txt"
            >
              <Download size={12} />
              <span>{state.graphicEqBandsCount === 127 ? 'Descargar Wavelet (127)' : 'Descargar GraphicEQ'}</span>
            </button>
            <Show when={state.graphicEqBandsCount !== 127}>
              <button
                onClick={copyWaveletGraphicEq}
                class="flex items-center gap-1 px-2 sm:px-2.5 py-1 bg-[var(--bg-surface)] hover:bg-[var(--border-contrast)] text-[var(--accent-blue)] border border-[var(--border-contrast)] rounded font-semibold transition-colors shrink-0 whitespace-nowrap cursor-pointer"
                title="Copiar las 127 frecuencias exactas (20 Hz - 19,871 Hz) requeridas por la aplicación Android Wavelet"
              >
                {copiedType() === 'wavelet' ? <Check size={12} class="text-[#00FF88]" /> : <Copy size={12} />}
                <span>{copiedType() === 'wavelet' ? '¡Copiado!' : 'Copiar Wavelet (127)'}</span>
              </button>
            </Show>
          </Show>

          <Show when={state.selectedEqMethod === 'ideal'}>
            <button
              onClick={copyRew}
              class="flex items-center gap-1 px-2 sm:px-2.5 py-1 bg-[var(--bg-surface)] hover:bg-[var(--border-contrast)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded font-semibold transition-colors shrink-0 whitespace-nowrap cursor-pointer"
              title="Copiar curva analítica en formato REW al portapapeles"
            >
              {copiedType() === 'rew' ? <Check size={12} class="text-[#00FF88]" /> : <Copy size={12} />}
              <span>{copiedType() === 'rew' ? '¡Copiado!' : 'Copiar REW'}</span>
            </button>
            <button
              onClick={downloadRew}
              class="flex items-center gap-1 px-2 sm:px-2.5 py-1 bg-[var(--bg-surface)] hover:bg-[var(--border-contrast)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded font-semibold transition-colors shrink-0 whitespace-nowrap cursor-pointer"
              title="Descargar curva analítica para Room EQ Wizard"
            >
              <Download size={12} />
              <span>Descargar REW</span>
            </button>
            <button
              onClick={downloadCsvData}
              class="flex items-center gap-1 px-2 sm:px-2.5 py-1 bg-[var(--bg-surface)] hover:bg-[var(--border-contrast)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded font-semibold transition-colors shrink-0 whitespace-nowrap cursor-pointer"
              title="Descargar matriz CSV con todas las curvas calculadas"
            >
              <Download size={12} />
              <span>Descargar CSV</span>
            </button>
          </Show>

          {/* Advanced Export Modal Trigger */}
          <button
            onClick={() => frActions.openExportModal()}
            class="flex items-center gap-1.5 px-2.5 sm:px-3 py-1 bg-[var(--accent-blue)] hover:opacity-90 text-[#ffffff] rounded font-bold transition-all shadow-[0_0_12px_rgba(0,85,255,0.3)] shrink-0 whitespace-nowrap cursor-pointer"
          >
            <Download size={13} />
            <span class="hidden sm:inline">Exportar Avanzado</span>
            <span class="sm:hidden">Exportar</span>
          </button>
        </div>
      </div>

      {/* Main Studio Body: Controls + Method Views */}
      <div class="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
        {/* Left Side: Target Adjustment Sliders (Always visible on lg+, toggled via 'Ajustes Target' tab on < lg) */}
        <div
          class={`order-2 lg:order-1 w-full lg:w-72 xl:w-80 p-3 border-r border-[var(--border-default)] flex-col gap-2.5 overflow-y-auto bg-[var(--bg-panel)] lg:shrink-0 ${
            mobileView() === 'target' ? 'flex flex-1 lg:flex-initial' : 'hidden lg:flex'
          }`}
        >
          <div class="flex items-center gap-1.5 font-bold text-[var(--text-pure)] text-[11px] uppercase tracking-wide">
            <SlidersHorizontal size={13} class="text-[var(--accent-blue)]" />
            <span>Ajustes de Sonido (Target)</span>
          </div>

          {/* Section 1: Ajustes Tonales (Shelving & Tilt) */}
          <div class="flex flex-col gap-2 p-2 rounded bg-[var(--bg-surface)] border border-[var(--border-default)]">
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-bold text-[var(--text-pure)] uppercase tracking-wider">Ajustes Tonales</span>
              <span class="text-[9px] text-[var(--text-dim)]">Shelving & Tilt</span>
            </div>

            {/* Bass Shelf Gain (Boost / Cut) */}
            <div class="flex flex-col gap-0.5">
              <div class="flex justify-between text-[11px]">
                <span class="text-[var(--text-muted)]">Bass Shelf (Ganancia):</span>
                <span class={`font-mono font-bold ${
                  state.targetParams.bassBoostGain > 0 ? 'text-[#00FF88]' : state.targetParams.bassBoostGain < 0 ? 'text-[#FF4444]' : 'text-[var(--text-main)]'
                }`}>
                  {state.targetParams.bassBoostGain > 0 ? `+${state.targetParams.bassBoostGain.toFixed(1)}` : state.targetParams.bassBoostGain.toFixed(1)} dB
                </span>
              </div>
              <input
                type="range"
                min="-12"
                max="12"
                step="0.5"
                value={state.targetParams.bassBoostGain}
                onInput={(e) => frActions.setTargetParams({ bassBoostGain: parseFloat(e.currentTarget.value) })}
                class="w-full h-1 bg-[var(--border-contrast)] rounded appearance-none cursor-pointer accent-[var(--accent-blue)]"
                title="Aumentar (+) o disminuir (-) los graves con filtro shelving"
              />
            </div>

            {/* Bass Shelf Fc */}
            <div class="flex flex-col gap-0.5">
              <div class="flex justify-between text-[11px]">
                <span class="text-[var(--text-muted)]">Frecuencia Graves (Fc):</span>
                <span class="font-mono text-[var(--text-main)] font-bold">{state.targetParams.bassBoostFc} Hz</span>
              </div>
              <input
                type="range"
                min="40"
                max="250"
                step="5"
                value={state.targetParams.bassBoostFc}
                onInput={(e) => frActions.setTargetParams({ bassBoostFc: parseInt(e.currentTarget.value) })}
                class="w-full h-1 bg-[var(--border-contrast)] rounded appearance-none cursor-pointer accent-[var(--accent-blue)]"
              />
            </div>

            {/* Bass Shelf Q (Calidad / Resonancia) */}
            <div class="flex flex-col gap-0.5">
              <div class="flex items-center justify-between text-[11px]">
                <span class="text-[var(--text-muted)]">Calidad Graves (Q):</span>
                <input
                  type="number"
                  step="0.05"
                  min="0.2"
                  max="2.5"
                  value={(state.targetParams.bassBoostQ ?? 0.707).toFixed(2)}
                  onChange={(e) => {
                    const val = Math.max(0.2, Math.min(2.5, parseFloat(e.currentTarget.value) || 0.707))
                    frActions.setTargetParams({ bassBoostQ: val })
                  }}
                  class="w-14 bg-[var(--bg-input)] border border-[var(--border-contrast)] rounded px-1.5 py-0.5 text-right font-mono font-bold text-[var(--text-main)] focus:border-[var(--accent-blue)] outline-none text-[11px]"
                />
              </div>
              <input
                type="range"
                min="0.2"
                max="2.5"
                step="0.05"
                value={state.targetParams.bassBoostQ ?? 0.707}
                onInput={(e) => frActions.setTargetParams({ bassBoostQ: parseFloat(e.currentTarget.value) })}
                class="w-full h-1 bg-[var(--border-contrast)] rounded appearance-none cursor-pointer accent-[var(--accent-blue)]"
                title="Ajustar la pendiente y resonancia (Q) del filtro de graves"
              />
              <div class="flex items-center justify-between text-[9px] font-mono text-[var(--text-dim)]">
                <span>0.3 (Gradual)</span>
                <span class={Math.abs((state.targetParams.bassBoostQ ?? 0.707) - 0.707) < 0.05 ? 'text-[#00FF88] font-bold' : ''}>0.71 (Butterworth)</span>
                <span>2.5 (Resonante)</span>
              </div>
            </div>

            {/* High Shelf Gain (Boost / Cut) */}
            <div class="flex flex-col gap-0.5 pt-1.5 border-t border-[var(--border-contrast)]">
              <div class="flex justify-between text-[11px]">
                <span class="text-[var(--text-muted)]">High Shelf (Ganancia):</span>
                <span class={`font-mono font-bold ${
                  state.targetParams.trebleShelfGain > 0 ? 'text-[#00FF88]' : state.targetParams.trebleShelfGain < 0 ? 'text-[#FF4444]' : 'text-[var(--text-main)]'
                }`}>
                  {state.targetParams.trebleShelfGain > 0 ? `+${state.targetParams.trebleShelfGain.toFixed(1)}` : state.targetParams.trebleShelfGain.toFixed(1)} dB
                </span>
              </div>
              <input
                type="range"
                min="-12"
                max="12"
                step="0.5"
                value={state.targetParams.trebleShelfGain}
                onInput={(e) => frActions.setTargetParams({ trebleShelfGain: parseFloat(e.currentTarget.value) })}
                class="w-full h-1 bg-[var(--border-contrast)] rounded appearance-none cursor-pointer accent-[var(--accent-blue)]"
                title="Aumentar (+) o disminuir (-) los agudos con filtro shelving"
              />
            </div>

            {/* High Shelf Fc */}
            <div class="flex flex-col gap-0.5">
              <div class="flex justify-between text-[11px]">
                <span class="text-[var(--text-muted)]">Frecuencia Agudos (Fc):</span>
                <span class="font-mono text-[var(--text-main)] font-bold">
                  {state.targetParams.trebleShelfFc >= 1000 ? `${(state.targetParams.trebleShelfFc / 1000).toFixed(1)}k` : state.targetParams.trebleShelfFc} Hz
                </span>
              </div>
              <input
                type="range"
                min="2000"
                max="16000"
                step="250"
                value={state.targetParams.trebleShelfFc}
                onInput={(e) => frActions.setTargetParams({ trebleShelfFc: parseInt(e.currentTarget.value) })}
                class="w-full h-1 bg-[var(--border-contrast)] rounded appearance-none cursor-pointer accent-[var(--accent-blue)]"
              />
            </div>

            {/* High Shelf Q (Calidad / Resonancia) */}
            <div class="flex flex-col gap-0.5">
              <div class="flex items-center justify-between text-[11px]">
                <span class="text-[var(--text-muted)]">Calidad Agudos (Q):</span>
                <input
                  type="number"
                  step="0.05"
                  min="0.2"
                  max="2.5"
                  value={(state.targetParams.trebleShelfQ ?? 0.707).toFixed(2)}
                  onChange={(e) => {
                    const val = Math.max(0.2, Math.min(2.5, parseFloat(e.currentTarget.value) || 0.707))
                    frActions.setTargetParams({ trebleShelfQ: val })
                  }}
                  class="w-14 bg-[var(--bg-input)] border border-[var(--border-contrast)] rounded px-1.5 py-0.5 text-right font-mono font-bold text-[var(--text-main)] focus:border-[var(--accent-blue)] outline-none text-[11px]"
                />
              </div>
              <input
                type="range"
                min="0.2"
                max="2.5"
                step="0.05"
                value={state.targetParams.trebleShelfQ ?? 0.707}
                onInput={(e) => frActions.setTargetParams({ trebleShelfQ: parseFloat(e.currentTarget.value) })}
                class="w-full h-1 bg-[var(--border-contrast)] rounded appearance-none cursor-pointer accent-[var(--accent-blue)]"
                title="Ajustar la pendiente y resonancia (Q) del filtro de agudos"
              />
              <div class="flex items-center justify-between text-[9px] font-mono text-[var(--text-dim)]">
                <span>0.3 (Gradual)</span>
                <span class={Math.abs((state.targetParams.trebleShelfQ ?? 0.707) - 0.707) < 0.05 ? 'text-[#00FF88] font-bold' : ''}>0.71 (Butterworth)</span>
                <span>2.5 (Resonante)</span>
              </div>
            </div>

            {/* Treble Tilt */}
            <div class="flex flex-col gap-0.5 pt-1.5 border-t border-[var(--border-contrast)]">
              <div class="flex justify-between text-[11px]">
                <span class="text-[var(--text-muted)]">Inclinación (Tilt):</span>
                <span class="font-mono text-[var(--text-main)] font-bold">
                  {state.targetParams.trebleTilt > 0 ? `+${state.targetParams.trebleTilt.toFixed(1)}` : state.targetParams.trebleTilt.toFixed(1)} dB/oct
                </span>
              </div>
              <input
                type="range"
                min="-2"
                max="2"
                step="0.2"
                value={state.targetParams.trebleTilt}
                onInput={(e) => frActions.setTargetParams({ trebleTilt: parseFloat(e.currentTarget.value) })}
                class="w-full h-1 bg-[var(--border-contrast)] rounded appearance-none cursor-pointer accent-[var(--accent-blue)]"
              />
            </div>
          </div>

          {/* Section 2: Filtro Pasa Altos (HPF / Low Cut) — Totalmente Independiente */}
          <div class={`flex flex-col gap-2 p-2.5 rounded bg-[var(--bg-surface)] border transition-all ${
            state.targetParams.hpfEnabled ? 'border-[var(--accent-blue)] shadow-[0_0_8px_rgba(0,102,255,0.15)]' : 'border-[var(--border-default)]'
          }`}>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5">
                <Filter size={12} class={state.targetParams.hpfEnabled ? 'text-[var(--accent-blue)]' : 'text-[var(--text-muted)]'} />
                <span class="text-[10px] font-bold text-[var(--text-pure)] uppercase tracking-wider">Pasa Altos (HPF)</span>
              </div>
              <button
                type="button"
                onClick={() => frActions.setTargetParams({ hpfEnabled: !state.targetParams.hpfEnabled })}
                class={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
                  state.targetParams.hpfEnabled
                    ? 'bg-[var(--accent-blue)] text-white border-[var(--accent-blue)]'
                    : 'bg-[var(--bg-panel)] text-[var(--text-muted)] border-[var(--border-contrast)] hover:text-[var(--text-main)]'
                }`}
              >
                {state.targetParams.hpfEnabled ? 'Activo' : 'Desactivado'}
              </button>
            </div>

            <Show when={state.targetParams.hpfEnabled}>
              <div class="flex flex-col gap-2 pt-1 border-t border-[var(--border-contrast)]">
                {/* Fc Control with Direct Numeric Input and Slider */}
                <div class="flex flex-col gap-1">
                  <div class="flex items-center justify-between text-[11px]">
                    <span class="text-[var(--text-muted)]">Frecuencia de Corte (Fc):</span>
                    <div class="flex items-center gap-1">
                      <input
                        type="number"
                        min="10"
                        max="10000"
                        value={state.targetParams.hpfFc}
                        onChange={(e) => {
                          const val = Math.max(10, Math.min(10000, parseInt(e.currentTarget.value) || 20))
                          frActions.setTargetParams({ hpfFc: val })
                        }}
                        class="w-16 bg-[var(--bg-input)] border border-[var(--border-contrast)] rounded px-1.5 py-0.5 text-right font-mono font-bold text-[var(--text-main)] focus:border-[var(--accent-blue)] outline-none text-[11px]"
                      />
                      <span class="font-mono text-[var(--text-dim)] text-[10px]">Hz</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="2000"
                    step="1"
                    value={state.targetParams.hpfFc}
                    onInput={(e) => frActions.setTargetParams({ hpfFc: parseInt(e.currentTarget.value) })}
                    class="w-full h-1 bg-[var(--border-contrast)] rounded appearance-none cursor-pointer accent-[var(--accent-blue)]"
                  />
                  {/* Quick Frequency Presets */}
                  <div class="flex items-center gap-1 flex-wrap pt-0.5">
                    <span class="text-[9px] text-[var(--text-dim)]">Presets:</span>
                    <For each={[20, 30, 40, 80, 120, 250, 500]}>
                      {(preset) => (
                        <button
                          type="button"
                          onClick={() => frActions.setTargetParams({ hpfFc: preset })}
                          class={`px-1.5 py-0.5 text-[9px] font-mono rounded border transition-colors ${
                            state.targetParams.hpfFc === preset
                              ? 'bg-[var(--accent-blue-badge-bg)] text-[var(--accent-blue-badge-text)] border-[var(--accent-blue)] font-bold'
                              : 'bg-[var(--bg-panel)] text-[var(--text-muted)] border-[var(--border-contrast)] hover:text-[var(--text-main)]'
                          }`}
                        >
                          {preset}Hz
                        </button>
                      )}
                    </For>
                  </div>
                </div>

                {/* Slope / Pendiente Selector */}
                <div class="flex flex-col gap-0.5 pt-1 border-t border-[var(--border-contrast)]">
                  <div class="flex justify-between text-[11px]">
                    <span class="text-[var(--text-muted)]">Pendiente (Atenuación):</span>
                    <span class="font-mono font-bold text-[var(--accent-blue-badge-text)]">
                      {state.targetParams.hpfSlope || 12} dB/oct
                    </span>
                  </div>
                  <select
                    class="bg-[var(--bg-input)] border border-[var(--border-contrast)] text-[var(--text-main)] rounded px-1.5 py-1 text-[11px] font-medium outline-none focus:border-[var(--accent-blue)] cursor-pointer"
                    value={state.targetParams.hpfSlope || 12}
                    onChange={(e) => frActions.setTargetParams({ hpfSlope: parseInt(e.currentTarget.value) as any })}
                  >
                    <option value="6">6 dB/oct (1er Orden · Caída muy suave)</option>
                    <option value="12">12 dB/oct (2do Orden · 1 Biquad / Estándar)</option>
                    <option value="18">18 dB/oct (3er Orden · 18 dB/octava)</option>
                    <option value="24">24 dB/oct (4to Orden · Linkwitz-Riley LR4)</option>
                    <option value="36">36 dB/oct (6to Orden · Corte empinado)</option>
                    <option value="48">48 dB/oct (8vo Orden · Pendiente Brickwall)</option>
                  </select>
                </div>

                {/* Topology / Alignment Pills */}
                <div class="flex flex-col gap-1 pt-1 border-t border-[var(--border-contrast)]">
                  <div class="flex justify-between text-[10px]">
                    <span class="text-[var(--text-muted)] font-medium">Alineación / Carácter:</span>
                  </div>
                  <div class="grid grid-cols-4 gap-1">
                    <button
                      type="button"
                      onClick={() => frActions.setTargetParams({ hpfType: 'butterworth', hpfQ: 0.707 })}
                      class={`px-1 py-1 rounded text-[9px] font-medium text-center border transition-colors ${
                        (state.targetParams.hpfType === 'butterworth' || Math.abs((state.targetParams.hpfQ || 0.707) - 0.707) < 0.02)
                          ? 'bg-[var(--accent-blue-badge-bg)] text-[var(--accent-blue-badge-text)] border-[var(--accent-blue)] font-bold'
                          : 'bg-[var(--bg-panel)] text-[var(--text-muted)] border-[var(--border-contrast)] hover:text-[var(--text-main)]'
                      }`}
                    >
                      Butterworth
                    </button>
                    <button
                      type="button"
                      onClick={() => frActions.setTargetParams({ hpfType: 'linkwitz-riley', hpfQ: 0.50 })}
                      class={`px-1 py-1 rounded text-[9px] font-medium text-center border transition-colors ${
                        (state.targetParams.hpfType === 'linkwitz-riley' || Math.abs((state.targetParams.hpfQ || 0.707) - 0.50) < 0.02)
                          ? 'bg-[var(--accent-blue-badge-bg)] text-[var(--accent-blue-badge-text)] border-[var(--accent-blue)] font-bold'
                          : 'bg-[var(--bg-panel)] text-[var(--text-muted)] border-[var(--border-contrast)] hover:text-[var(--text-main)]'
                      }`}
                    >
                      Linkwitz-R.
                    </button>
                    <button
                      type="button"
                      onClick={() => frActions.setTargetParams({ hpfType: 'bessel', hpfQ: 0.58 })}
                      class={`px-1 py-1 rounded text-[9px] font-medium text-center border transition-colors ${
                        (state.targetParams.hpfType === 'bessel' || Math.abs((state.targetParams.hpfQ || 0.707) - 0.58) < 0.02)
                          ? 'bg-[var(--accent-blue-badge-bg)] text-[var(--accent-blue-badge-text)] border-[var(--accent-blue)] font-bold'
                          : 'bg-[var(--bg-panel)] text-[var(--text-muted)] border-[var(--border-contrast)] hover:text-[var(--text-main)]'
                      }`}
                    >
                      Bessel
                    </button>
                    <button
                      type="button"
                      onClick={() => frActions.setTargetParams({ hpfType: 'custom' })}
                      class={`px-1 py-1 rounded text-[9px] font-medium text-center border transition-colors ${
                        state.targetParams.hpfType === 'custom'
                          ? 'bg-[var(--accent-blue-badge-bg)] text-[var(--accent-blue-badge-text)] border-[var(--accent-blue)] font-bold'
                          : 'bg-[var(--bg-panel)] text-[var(--text-muted)] border-[var(--border-contrast)] hover:text-[var(--text-main)]'
                      }`}
                    >
                      Manual / Q
                    </button>
                  </div>
                </div>

                {/* Quality / Resonance Q */}
                <div class="flex flex-col gap-0.5">
                  <div class="flex items-center justify-between text-[11px]">
                    <span class="text-[var(--text-muted)]">Resonancia / Calidad (Q):</span>
                    <input
                      type="number"
                      step="0.05"
                      min="0.2"
                      max="3.0"
                      value={(state.targetParams.hpfQ || 0.707).toFixed(2)}
                      onChange={(e) => {
                        const val = Math.max(0.2, Math.min(3.0, parseFloat(e.currentTarget.value) || 0.707))
                        frActions.setTargetParams({ hpfQ: val, hpfType: 'custom' })
                      }}
                      class="w-16 bg-[var(--bg-input)] border border-[var(--border-contrast)] rounded px-1.5 py-0.5 text-right font-mono font-bold text-[var(--text-main)] focus:border-[var(--accent-blue)] outline-none text-[11px]"
                    />
                  </div>
                  <input
                    type="range"
                    min="0.2"
                    max="3.0"
                    step="0.05"
                    value={state.targetParams.hpfQ || 0.707}
                    onInput={(e) => frActions.setTargetParams({ hpfQ: parseFloat(e.currentTarget.value), hpfType: 'custom' })}
                    class="w-full h-1 bg-[var(--border-contrast)] rounded appearance-none cursor-pointer accent-[var(--accent-blue)]"
                  />
                  {/* Contextual dynamic indicator */}
                  <div class="text-[9px] font-mono mt-0.5">
                    <Show when={(state.targetParams.hpfQ || 0.707) > 0.75}>
                      <span class="text-[#FFAA00]">
                        ⚠️ Resonancia: +{(20 * Math.log10(state.targetParams.hpfQ || 0.707)).toFixed(1)} dB antes del corte
                      </span>
                    </Show>
                    <Show when={Math.abs((state.targetParams.hpfQ || 0.707) - 0.707) <= 0.05}>
                      <span class="text-[#00FF88]">✓ Respuesta plana óptima (Butterworth)</span>
                    </Show>
                    <Show when={(state.targetParams.hpfQ || 0.707) < 0.65}>
                      <span class="text-[var(--text-muted)]">✓ Amortiguado (Sin resonancia ni overshoot)</span>
                    </Show>
                  </div>
                </div>
              </div>
            </Show>
          </div>

          {/* Section 3: Filtro Pasa Bajos (LPF / High Cut) — Totalmente Independiente */}
          <div class={`flex flex-col gap-2 p-2.5 rounded bg-[var(--bg-surface)] border transition-all ${
            state.targetParams.lpfEnabled ? 'border-[#00FF88] shadow-[0_0_8px_rgba(0,255,136,0.15)]' : 'border-[var(--border-default)]'
          }`}>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5">
                <Filter size={12} class={state.targetParams.lpfEnabled ? 'text-[#00FF88]' : 'text-[var(--text-muted)]'} />
                <span class="text-[10px] font-bold text-[var(--text-pure)] uppercase tracking-wider">Pasa Bajos (LPF)</span>
              </div>
              <button
                type="button"
                onClick={() => frActions.setTargetParams({ lpfEnabled: !state.targetParams.lpfEnabled })}
                class={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
                  state.targetParams.lpfEnabled
                    ? 'bg-[#00FF88] text-black border-[#00FF88]'
                    : 'bg-[var(--bg-panel)] text-[var(--text-muted)] border-[var(--border-contrast)] hover:text-[var(--text-main)]'
                }`}
              >
                {state.targetParams.lpfEnabled ? 'Activo' : 'Desactivado'}
              </button>
            </div>

            <Show when={state.targetParams.lpfEnabled}>
              <div class="flex flex-col gap-2 pt-1 border-t border-[var(--border-contrast)]">
                {/* Fc Control with Direct Numeric Input and Slider */}
                <div class="flex flex-col gap-1">
                  <div class="flex items-center justify-between text-[11px]">
                    <span class="text-[var(--text-muted)]">Frecuencia de Corte (Fc):</span>
                    <div class="flex items-center gap-1">
                      <input
                        type="number"
                        min="50"
                        max="22000"
                        value={state.targetParams.lpfFc}
                        onChange={(e) => {
                          const val = Math.max(50, Math.min(22000, parseInt(e.currentTarget.value) || 20000))
                          frActions.setTargetParams({ lpfFc: val })
                        }}
                        class="w-16 bg-[var(--bg-input)] border border-[var(--border-contrast)] rounded px-1.5 py-0.5 text-right font-mono font-bold text-[var(--text-main)] focus:border-[#00FF88] outline-none text-[11px]"
                      />
                      <span class="font-mono text-[var(--text-dim)] text-[10px]">Hz</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min="200"
                    max="22000"
                    step="100"
                    value={state.targetParams.lpfFc}
                    onInput={(e) => frActions.setTargetParams({ lpfFc: parseInt(e.currentTarget.value) })}
                    class="w-full h-1 bg-[var(--border-contrast)] rounded appearance-none cursor-pointer accent-[#00FF88]"
                  />
                  {/* Quick Frequency Presets */}
                  <div class="flex items-center gap-1 flex-wrap pt-0.5">
                    <span class="text-[9px] text-[var(--text-dim)]">Presets:</span>
                    <For each={[20000, 18000, 16000, 12000, 8000, 4000, 1000]}>
                      {(preset) => (
                        <button
                          type="button"
                          onClick={() => frActions.setTargetParams({ lpfFc: preset })}
                          class={`px-1.5 py-0.5 text-[9px] font-mono rounded border transition-colors ${
                            state.targetParams.lpfFc === preset
                              ? 'bg-[var(--accent-blue-badge-bg)] text-[#00FF88] border-[#00FF88] font-bold'
                              : 'bg-[var(--bg-panel)] text-[var(--text-muted)] border-[var(--border-contrast)] hover:text-[var(--text-main)]'
                          }`}
                        >
                          {preset >= 1000 ? `${preset / 1000}k` : `${preset}Hz`}
                        </button>
                      )}
                    </For>
                  </div>
                </div>

                {/* Slope / Pendiente Selector */}
                <div class="flex flex-col gap-0.5 pt-1 border-t border-[var(--border-contrast)]">
                  <div class="flex justify-between text-[11px]">
                    <span class="text-[var(--text-muted)]">Pendiente (Atenuación):</span>
                    <span class="font-mono font-bold text-[#00FF88]">
                      {state.targetParams.lpfSlope || 12} dB/oct
                    </span>
                  </div>
                  <select
                    class="bg-[var(--bg-input)] border border-[var(--border-contrast)] text-[var(--text-main)] rounded px-1.5 py-1 text-[11px] font-medium outline-none focus:border-[#00FF88] cursor-pointer"
                    value={state.targetParams.lpfSlope || 12}
                    onChange={(e) => frActions.setTargetParams({ lpfSlope: parseInt(e.currentTarget.value) as any })}
                  >
                    <option value="6">6 dB/oct (1er Orden · Caída muy suave)</option>
                    <option value="12">12 dB/oct (2do Orden · 1 Biquad / Estándar)</option>
                    <option value="18">18 dB/oct (3er Orden · 18 dB/octava)</option>
                    <option value="24">24 dB/oct (4to Orden · Linkwitz-Riley LR4)</option>
                    <option value="36">36 dB/oct (6to Orden · Corte empinado)</option>
                    <option value="48">48 dB/oct (8vo Orden · Pendiente Brickwall)</option>
                  </select>
                </div>

                {/* Topology / Alignment Pills */}
                <div class="flex flex-col gap-1 pt-1 border-t border-[var(--border-contrast)]">
                  <div class="flex justify-between text-[10px]">
                    <span class="text-[var(--text-muted)] font-medium">Alineación / Carácter:</span>
                  </div>
                  <div class="grid grid-cols-4 gap-1">
                    <button
                      type="button"
                      onClick={() => frActions.setTargetParams({ lpfType: 'butterworth', lpfQ: 0.707 })}
                      class={`px-1 py-1 rounded text-[9px] font-medium text-center border transition-colors ${
                        (state.targetParams.lpfType === 'butterworth' || Math.abs((state.targetParams.lpfQ || 0.707) - 0.707) < 0.02)
                          ? 'bg-[var(--accent-blue-badge-bg)] text-[#00FF88] border-[#00FF88] font-bold'
                          : 'bg-[var(--bg-panel)] text-[var(--text-muted)] border-[var(--border-contrast)] hover:text-[var(--text-main)]'
                      }`}
                    >
                      Butterworth
                    </button>
                    <button
                      type="button"
                      onClick={() => frActions.setTargetParams({ lpfType: 'linkwitz-riley', lpfQ: 0.50 })}
                      class={`px-1 py-1 rounded text-[9px] font-medium text-center border transition-colors ${
                        (state.targetParams.lpfType === 'linkwitz-riley' || Math.abs((state.targetParams.lpfQ || 0.707) - 0.50) < 0.02)
                          ? 'bg-[var(--accent-blue-badge-bg)] text-[#00FF88] border-[#00FF88] font-bold'
                          : 'bg-[var(--bg-panel)] text-[var(--text-muted)] border-[var(--border-contrast)] hover:text-[var(--text-main)]'
                      }`}
                    >
                      Linkwitz-R.
                    </button>
                    <button
                      type="button"
                      onClick={() => frActions.setTargetParams({ lpfType: 'bessel', lpfQ: 0.58 })}
                      class={`px-1 py-1 rounded text-[9px] font-medium text-center border transition-colors ${
                        (state.targetParams.lpfType === 'bessel' || Math.abs((state.targetParams.lpfQ || 0.707) - 0.58) < 0.02)
                          ? 'bg-[var(--accent-blue-badge-bg)] text-[#00FF88] border-[#00FF88] font-bold'
                          : 'bg-[var(--bg-panel)] text-[var(--text-muted)] border-[var(--border-contrast)] hover:text-[var(--text-main)]'
                      }`}
                    >
                      Bessel
                    </button>
                    <button
                      type="button"
                      onClick={() => frActions.setTargetParams({ lpfType: 'custom' })}
                      class={`px-1 py-1 rounded text-[9px] font-medium text-center border transition-colors ${
                        state.targetParams.lpfType === 'custom'
                          ? 'bg-[var(--accent-blue-badge-bg)] text-[#00FF88] border-[#00FF88] font-bold'
                          : 'bg-[var(--bg-panel)] text-[var(--text-muted)] border-[var(--border-contrast)] hover:text-[var(--text-main)]'
                      }`}
                    >
                      Manual / Q
                    </button>
                  </div>
                </div>

                {/* Quality / Resonance Q */}
                <div class="flex flex-col gap-0.5">
                  <div class="flex items-center justify-between text-[11px]">
                    <span class="text-[var(--text-muted)]">Resonancia / Calidad (Q):</span>
                    <input
                      type="number"
                      step="0.05"
                      min="0.2"
                      max="3.0"
                      value={(state.targetParams.lpfQ || 0.707).toFixed(2)}
                      onChange={(e) => {
                        const val = Math.max(0.2, Math.min(3.0, parseFloat(e.currentTarget.value) || 0.707))
                        frActions.setTargetParams({ lpfQ: val, lpfType: 'custom' })
                      }}
                      class="w-16 bg-[var(--bg-input)] border border-[var(--border-contrast)] rounded px-1.5 py-0.5 text-right font-mono font-bold text-[var(--text-main)] focus:border-[#00FF88] outline-none text-[11px]"
                    />
                  </div>
                  <input
                    type="range"
                    min="0.2"
                    max="3.0"
                    step="0.05"
                    value={state.targetParams.lpfQ || 0.707}
                    onInput={(e) => frActions.setTargetParams({ lpfQ: parseFloat(e.currentTarget.value), lpfType: 'custom' })}
                    class="w-full h-1 bg-[var(--border-contrast)] rounded appearance-none cursor-pointer accent-[#00FF88]"
                  />
                  {/* Contextual dynamic indicator */}
                  <div class="text-[9px] font-mono mt-0.5">
                    <Show when={(state.targetParams.lpfQ || 0.707) > 0.75}>
                      <span class="text-[#FFAA00]">
                        ⚠️ Resonancia: +{(20 * Math.log10(state.targetParams.lpfQ || 0.707)).toFixed(1)} dB antes del corte
                      </span>
                    </Show>
                    <Show when={Math.abs((state.targetParams.lpfQ || 0.707) - 0.707) <= 0.05}>
                      <span class="text-[#00FF88]">✓ Respuesta plana óptima (Butterworth)</span>
                    </Show>
                    <Show when={(state.targetParams.lpfQ || 0.707) < 0.65}>
                      <span class="text-[var(--text-muted)]">✓ Amortiguado (Sin resonancia ni overshoot)</span>
                    </Show>
                  </div>
                </div>
              </div>
            </Show>
          </div>

          {/* Section 3: Límites y Seguridad */}
          <div class="flex flex-col gap-2 p-2 rounded bg-[var(--bg-surface)] border border-[var(--border-default)]">
            <span class="text-[10px] font-bold text-[var(--text-pure)] uppercase tracking-wider">Límites y Seguridad</span>

            {/* Max Boost Limit */}
            <div class="flex flex-col gap-0.5">
              <div class="flex justify-between text-[11px]">
                <span class="text-[var(--text-muted)]">Límite Max Boost:</span>
                <span class="font-mono text-[var(--text-main)] font-bold">+{state.targetParams.maxBoost} dB</span>
              </div>
              <input
                type="range"
                min="4"
                max="20"
                step="1"
                value={state.targetParams.maxBoost}
                onInput={(e) => frActions.setTargetParams({ maxBoost: parseInt(e.currentTarget.value) })}
                class="w-full h-1 bg-[var(--border-contrast)] rounded appearance-none cursor-pointer accent-[var(--accent-blue)]"
              />
            </div>

            {/* Treble Boost Limiter (10 kHz - 20 kHz) */}
            <div class="flex flex-col gap-1 pt-1.5 border-t border-[var(--border-contrast)]">
              <div class="flex items-center justify-between text-[11px]">
                <span class="text-[var(--text-muted)]" title="Atenúa la ganancia de ecualización por encima de 10 kHz para prevenir sibilancias ásperas, distorsión y sobreexcursión en el tweeter">
                  Atenuar Agudos (&gt;10k):
                </span>
                <button
                  type="button"
                  onClick={() => frActions.setTargetParams({ limitTrebleBoost: !state.targetParams.limitTrebleBoost })}
                  class={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
                    state.targetParams.limitTrebleBoost
                      ? 'bg-[var(--accent-blue-badge-bg)] text-[var(--accent-blue-badge-text)] border-[var(--accent-blue)]'
                      : 'bg-[var(--bg-panel)] text-[var(--text-muted)] border-[var(--border-contrast)] hover:text-[var(--text-main)]'
                  }`}
                  title={state.targetParams.limitTrebleBoost
                    ? 'Activo: Reduce boosts agresivos entre 10 kHz y 20 kHz para proteger el transductor'
                    : 'Desactivado: Aplica ecualización completa hasta 20 kHz sin atenuación'}
                >
                  {state.targetParams.limitTrebleBoost ? 'Activo (Seguro)' : 'Desactivado (Full 20k)'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Tab Bar + Active EQ Method View */}
        <div
          class={`order-1 lg:order-2 flex flex-col overflow-hidden bg-[var(--bg-card)] min-w-0 ${
            mobileView() === 'target' ? 'shrink-0 lg:flex-1' : 'flex-1'
          }`}
        >
          {/* Method Selector Tabs Header */}
          <div class="flex flex-wrap items-center justify-between px-2 sm:px-3 pt-1.5 pb-1.5 border-b border-[var(--border-default)] bg-[var(--bg-panel)] gap-1.5 shrink-0">
            {/* Tabs List */}
            <div class="flex items-center gap-1 overflow-x-auto no-scrollbar max-w-full">
              {/* Mobile/Tablet Target Adjustments Tab (< lg) */}
              <button
                type="button"
                onClick={() => setMobileView('target')}
                class={`lg:hidden flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-semibold transition-all shrink-0 whitespace-nowrap cursor-pointer ${
                  mobileView() === 'target'
                    ? 'bg-[var(--accent-blue)] text-white shadow-[0_0_10px_rgba(0,85,255,0.25)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface)]'
                }`}
              >
                <SlidersHorizontal size={12} />
                <span>Ajustes Target</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMobileView('method')
                  frActions.setEqMethod('peq')
                }}
                class={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded text-[11px] font-semibold transition-all shrink-0 whitespace-nowrap cursor-pointer ${
                  state.selectedEqMethod === 'peq' && mobileView() === 'method'
                    ? 'bg-[var(--accent-blue)] text-white shadow-[0_0_10px_rgba(0,85,255,0.25)]'
                    : state.selectedEqMethod === 'peq'
                      ? 'lg:bg-[var(--accent-blue)] lg:text-white lg:shadow-[0_0_10px_rgba(0,85,255,0.25)] text-[var(--text-muted)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface)]'
                }`}
              >
                <Sliders size={12} />
                <span>Paramétrico (PEQ)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMobileView('method')
                  frActions.setEqMethod('fir')
                }}
                class={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded text-[11px] font-semibold transition-all shrink-0 whitespace-nowrap cursor-pointer ${
                  state.selectedEqMethod === 'fir' && mobileView() === 'method'
                    ? 'bg-[var(--accent-blue)] text-white shadow-[0_0_10px_rgba(0,85,255,0.25)]'
                    : state.selectedEqMethod === 'fir'
                      ? 'lg:bg-[var(--accent-blue)] lg:text-white lg:shadow-[0_0_10px_rgba(0,85,255,0.25)] text-[var(--text-muted)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface)]'
                }`}
              >
                <FileAudio size={12} />
                <span>Convolución FIR</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMobileView('method')
                  frActions.setEqMethod('graphiceq')
                }}
                class={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded text-[11px] font-semibold transition-all shrink-0 whitespace-nowrap cursor-pointer ${
                  state.selectedEqMethod === 'graphiceq' && mobileView() === 'method'
                    ? 'bg-[var(--accent-blue)] text-white shadow-[0_0_10px_rgba(0,85,255,0.25)]'
                    : state.selectedEqMethod === 'graphiceq'
                      ? 'lg:bg-[var(--accent-blue)] lg:text-white lg:shadow-[0_0_10px_rgba(0,85,255,0.25)] text-[var(--text-muted)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface)]'
                }`}
              >
                <SlidersHorizontal size={12} />
                <span>Ecualizador Gráfico</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMobileView('method')
                  frActions.setEqMethod('ideal')
                }}
                class={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded text-[11px] font-semibold transition-all shrink-0 whitespace-nowrap cursor-pointer ${
                  state.selectedEqMethod === 'ideal' && mobileView() === 'method'
                    ? 'bg-[var(--accent-blue)] text-white shadow-[0_0_10px_rgba(0,85,255,0.25)]'
                    : state.selectedEqMethod === 'ideal'
                      ? 'lg:bg-[var(--accent-blue)] lg:text-white lg:shadow-[0_0_10px_rgba(0,85,255,0.25)] text-[var(--text-muted)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface)]'
                }`}
              >
                <Sparkles size={12} />
                <span>Inversión Ideal</span>
              </button>
            </div>

            {/* Quick Contextual Sub-controls in Tab Header */}
            <div class={`${mobileView() === 'target' ? 'hidden lg:flex' : 'flex'} items-center`}>
              <Show when={state.selectedEqMethod === 'peq'}>
                <div class="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                  <span>Bandas:</span>
                  <select
                    class="bg-[var(--bg-surface)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded px-1.5 py-0.5 outline-none focus:border-[var(--accent-blue)] font-medium"
                    value={state.maxFiltersCount}
                    onChange={(e) => frActions.setMaxFilters(parseInt(e.currentTarget.value))}
                  >
                    <option value="5">5 Bandas</option>
                    <option value="7">7 Bandas</option>
                    <option value="10">10 Bandas</option>
                    <option value="15">15 Bandas</option>
                  </select>
                </div>
              </Show>

              <Show when={state.selectedEqMethod === 'fir'}>
                <div class="flex items-center gap-2 text-[11px] flex-wrap">
                  <div class="flex items-center gap-1 text-[var(--text-muted)]">
                    <span>Taps:</span>
                    <select
                      class="bg-[var(--bg-surface)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded px-1.5 py-0.5 outline-none focus:border-[var(--accent-blue)] font-medium"
                      value={state.firTaps}
                      onChange={(e) => frActions.setFirTaps(parseInt(e.currentTarget.value))}
                    >
                      <option value="2048">2048 Taps</option>
                      <option value="4096">4096 Taps</option>
                      <option value="8192">8192 Taps (Recomendado)</option>
                      <option value="16384">16384 Taps</option>
                      <option value="32768">32768 Taps</option>
                      <option value="65536">65536 Taps (Hi-Res)</option>
                    </select>
                  </div>
                  <div class="flex items-center gap-1 text-[var(--text-muted)]">
                    <span>Fase:</span>
                    <select
                      class="bg-[var(--bg-surface)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded px-1.5 py-0.5 outline-none focus:border-[var(--accent-blue)] font-medium"
                      value={state.firPhase}
                      onChange={(e) => frActions.setFirPhase(e.currentTarget.value as 'minimum' | 'linear')}
                    >
                      <option value="minimum">Fase Mínima (0 ms)</option>
                      <option value="linear">Fase Lineal (Simétrica)</option>
                    </select>
                  </div>
                </div>
              </Show>

              <Show when={state.selectedEqMethod === 'graphiceq'}>
                <div class="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                  <span>Bandas:</span>
                  <select
                    class="bg-[var(--bg-surface)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded px-1.5 py-0.5 outline-none focus:border-[var(--accent-blue)] font-medium"
                    value={state.graphicEqBandsCount}
                    onChange={(e) => frActions.setGraphicEqBandsCount(parseInt(e.currentTarget.value) as GraphicEqBandCount)}
                  >
                    <option value="10">10 Bandas (1 octava)</option>
                    <option value="15">15 Bandas (2/3 octava)</option>
                    <option value="31">31 Bandas (1/3 octava ISO)</option>
                    <option value="127">127 Bandas (Wavelet / AutoEq)</option>
                  </select>
                </div>
              </Show>

              <Show when={state.selectedEqMethod === 'ideal'}>
                <div class="hidden sm:block text-[10px] text-[var(--text-dim)] font-mono">
                  Matemática Continua Pura (Sin Restricción de Biquads)
                </div>
              </Show>
            </div>
          </div>

          {/* Tab 1 Content: Parametric PEQ Table */}
          <Show when={state.selectedEqMethod === 'peq'}>
            <div class={`flex-1 flex-col p-2 sm:p-2.5 overflow-hidden ${mobileView() === 'target' ? 'hidden lg:flex' : 'flex'}`}>
              {/* Toolbar */}
              <div class="flex flex-wrap items-center justify-between gap-1.5 pb-2">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-bold text-[var(--text-pure)]">Filtros Paramétricos ({state.peqFilters.length})</span>
                  <span class="hidden sm:inline text-[10px] text-[var(--text-dim)]">Formato Equalizer APO / MiniDSP compatible</span>
                </div>
                <div class="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => frActions.addFilter({ type: 'PK', fc: 1000, gain: 0, q: 1.41 })}
                    class="flex items-center gap-1 px-2 py-0.5 bg-[var(--bg-surface)] hover:bg-[var(--border-contrast)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded text-[10px] font-semibold transition-colors cursor-pointer"
                    title="Añadir una nueva banda Peaking a la tabla"
                  >
                    <Plus size={11} class="text-[var(--accent-blue)]" />
                    <span>+ Peaking</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => frActions.addFilter({ type: 'HP', fc: 40, gain: 0, q: 0.71 })}
                    class="flex items-center gap-1 px-2 py-0.5 bg-[var(--bg-surface)] hover:bg-[var(--border-contrast)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded text-[10px] font-semibold transition-colors cursor-pointer"
                    title="Añadir un filtro Pasa Altos independiente a la tabla"
                  >
                    <Plus size={11} class="text-[var(--accent-blue)]" />
                    <span>+ Pasa Altos (HP)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => frActions.addFilter({ type: 'LP', fc: 16000, gain: 0, q: 0.71 })}
                    class="flex items-center gap-1 px-2 py-0.5 bg-[var(--bg-surface)] hover:bg-[var(--border-contrast)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded text-[10px] font-semibold transition-colors cursor-pointer"
                    title="Añadir un filtro Pasa Bajos independiente a la tabla"
                  >
                    <Plus size={11} class="text-[#00FF88]" />
                    <span>+ Pasa Bajos (LP)</span>
                  </button>
                </div>
              </div>

              <div class="flex-1 overflow-auto border border-[var(--border-default)] rounded bg-[var(--bg-panel)]">
                <table class="w-full min-w-[520px] text-left text-[11px]">
                  <thead class="bg-[var(--bg-table-header)] text-[var(--text-muted)] border-b border-[var(--border-default)] sticky top-0 z-10">
                    <tr>
                      <th class="py-1 px-3 w-12 text-center">Estado</th>
                      <th class="py-1 px-3">Filtro</th>
                      <th class="py-1 px-3">Tipo</th>
                      <th class="py-1 px-3 font-mono">Frecuencia (Fc)</th>
                      <th class="py-1 px-3 font-mono">Ganancia (Gain)</th>
                      <th class="py-1 px-3 font-mono">Calidad (Q)</th>
                      <th class="py-1 px-2 w-10 text-center"></th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-[var(--border-default)] font-mono">
                    <For each={state.peqFilters}>
                      {(f, index) => (
                        <tr class={`hover:bg-[var(--bg-table-row-hover)] transition-colors ${f.enabled ? '' : 'opacity-40'}`}>
                          {/* Toggle */}
                          <td class="py-1 px-3 text-center">
                            <input
                              type="checkbox"
                              checked={f.enabled}
                              onChange={() => frActions.toggleFilterEnabled(f.id)}
                              class="accent-[var(--accent-blue)] cursor-pointer"
                            />
                          </td>
                          {/* Name */}
                          <td class="py-1 px-3 text-[var(--text-pure)] font-bold">
                            Banda {index() + 1}
                          </td>
                          {/* Type */}
                          <td class="py-1 px-3">
                            <select
                              class="bg-[var(--bg-input)] border border-[var(--border-contrast)] rounded px-1.5 py-0.5 text-[10px] font-bold text-[var(--text-main)] outline-none focus:border-[var(--accent-blue)] cursor-pointer"
                              value={f.type}
                              onChange={(e) => frActions.updateFilterParam(f.id, 'type', e.currentTarget.value as any)}
                            >
                              <option value="PK">Peaking (PK)</option>
                              <option value="LSC">Low Shelf (LSC)</option>
                              <option value="HSC">High Shelf (HSC)</option>
                              <option value="HP">Pasa Altos (HP)</option>
                              <option value="LP">Pasa Bajos (LP)</option>
                            </select>
                          </td>
                          {/* Fc */}
                          <td class="py-1 px-3 text-[var(--text-main)]">
                            <input
                              type="number"
                              class="w-20 bg-[var(--bg-input)] border border-[var(--border-contrast)] rounded px-1.5 py-0.5 text-center text-[var(--text-main)] focus:border-[var(--accent-blue)] outline-none"
                              value={Math.round(f.fc)}
                              onChange={(e) => frActions.updateFilterParam(f.id, 'fc', parseInt(e.currentTarget.value) || f.fc)}
                            /> Hz
                          </td>
                          {/* Gain */}
                          <td class="py-1 px-3">
                            <Show
                              when={f.type !== 'HP' && f.type !== 'LP'}
                              fallback={<span class="text-[10px] text-[var(--text-dim)] italic font-mono px-2 select-none">Corte</span>}
                            >
                              <input
                                type="number"
                                step="0.1"
                                class={`w-20 bg-[var(--bg-input)] border border-[var(--border-contrast)] rounded px-1.5 py-0.5 text-center font-bold focus:border-[var(--accent-blue)] outline-none ${f.gain >= 0 ? 'text-[#00FF88]' : 'text-[#FF0000]'
                                  }`}
                                value={f.gain.toFixed(1)}
                                onChange={(e) => frActions.updateFilterParam(f.id, 'gain', parseFloat(e.currentTarget.value) || f.gain)}
                              /> dB
                            </Show>
                          </td>
                          {/* Q */}
                          <td class="py-1 px-3 text-[var(--text-secondary)]">
                            <input
                              type="number"
                              step="0.05"
                              class="w-16 bg-[var(--bg-input)] border border-[var(--border-contrast)] rounded px-1.5 py-0.5 text-center text-[var(--text-secondary)] focus:border-[var(--accent-blue)] outline-none"
                              value={f.q.toFixed(2)}
                              onChange={(e) => frActions.updateFilterParam(f.id, 'q', parseFloat(e.currentTarget.value) || f.q)}
                            />
                          </td>
                          {/* Delete */}
                          <td class="py-1 px-2 text-center">
                            <button
                              type="button"
                              onClick={() => frActions.removeFilter(f.id)}
                              class="p-1 text-[var(--text-dim)] hover:text-[#FF4444] rounded hover:bg-[rgba(255,68,68,0.1)] transition-colors"
                              title="Eliminar este filtro"
                            >
                              <Trash2 size={12} />
                            </button>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </div>
          </Show>

          {/* Tab 2 Content: FIR Convolution */}
          <Show when={state.selectedEqMethod === 'fir'}>
            <div class={`flex-1 flex-col p-2.5 sm:p-3 gap-2.5 sm:gap-3 overflow-y-auto ${mobileView() === 'target' ? 'hidden lg:flex' : 'flex'}`}>
              {/* Metrics Grid */}
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-2.5">
                <div class="bg-[var(--bg-panel)] border border-[var(--border-default)] rounded p-2 sm:p-2.5 flex flex-col justify-between">
                  <span class="text-[10px] text-[var(--text-muted)] font-medium">Resolución en Graves</span>
                  <div class="text-xs sm:text-sm font-mono font-bold text-[var(--accent-blue-badge-text)] mt-1">
                    {(state.firSampleRate / state.firTaps).toFixed(1)} Hz / bin
                  </div>
                  <span class="text-[9px] text-[var(--text-dim)] mt-0.5">Precisión de contorno sub-grave</span>
                </div>

                <div class="bg-[var(--bg-panel)] border border-[var(--border-default)] rounded p-2 sm:p-2.5 flex flex-col justify-between">
                  <span class="text-[10px] text-[var(--text-muted)] font-medium">Latencia de Grupo</span>
                  <div class="text-xs sm:text-sm font-mono font-bold text-[#00FF88] mt-1">
                    {state.firPhase === 'linear'
                      ? `${(state.firTaps / 2 / state.firSampleRate * 1000).toFixed(1)} ms`
                      : '0.0 ms (Tiempo Real)'}
                  </div>
                  <span class="text-[9px] text-[var(--text-dim)] mt-0.5">
                    {state.firPhase === 'linear' ? 'Fase perfectamente lineal' : 'Ideal para gaming y monitoreo'}
                  </span>
                </div>

                <div class="bg-[var(--bg-panel)] border border-[var(--border-default)] rounded p-2 sm:p-2.5 flex flex-col justify-between">
                  <span class="text-[10px] text-[var(--text-muted)] font-medium">Longitud Temporal</span>
                  <div class="text-xs sm:text-sm font-mono font-bold text-[var(--text-main)] mt-1">
                    {(state.firTaps / state.firSampleRate * 1000).toFixed(1)} ms
                  </div>
                  <span class="text-[9px] text-[var(--text-dim)] mt-0.5">{state.firTaps} coeficientes analíticos</span>
                </div>

                <div class="bg-[var(--bg-panel)] border border-[var(--border-default)] rounded p-2 sm:p-2.5 flex flex-col justify-between">
                  <span class="text-[10px] text-[var(--text-muted)] font-medium">Frecuencia de Muestreo</span>
                  <div class="flex items-center mt-1">
                    <select
                      class="w-full bg-[var(--bg-surface)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded px-1.5 py-0.5 text-[11px] sm:text-xs font-mono font-bold outline-none focus:border-[var(--accent-blue)]"
                      value={state.firSampleRate}
                      onChange={(e) => frActions.setFirSampleRate(parseInt(e.currentTarget.value))}
                    >
                      <option value="44100">44.1 kHz (CD Audio)</option>
                      <option value="48000">48.0 kHz (Estándar)</option>
                      <option value="96000">96.0 kHz (Hi-Res)</option>
                    </select>
                  </div>
                  <span class="text-[9px] text-[var(--text-dim)] mt-0.5">Frecuencia de simulación IFFT</span>
                </div>
              </div>

              {/* Explanatory banner */}
              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-2.5 bg-[var(--bg-panel)] border border-[var(--border-default)] rounded">
                <div class="flex items-start sm:items-center gap-2">
                  <Activity size={16} class="text-[var(--accent-blue)] shrink-0 mt-0.5 sm:mt-0" />
                  <div class="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                    La curva <strong class="text-[var(--accent-blue-badge-text)]">AutoEq (FIR)</strong> en la gráfica refleja la simulación de respuesta física real calculada por transformada de Fourier rápida. No agrega distorsión de fase biquad y se adapta punto a punto a la respuesta del auricular.
                  </div>
                </div>

                <button
                  onClick={downloadFirWav}
                  class="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[var(--accent-blue)] hover:opacity-90 text-white rounded font-bold shrink-0 transition-all shadow-[0_0_10px_rgba(0,85,255,0.25)] sm:ml-3 cursor-pointer"
                >
                  <Download size={13} />
                  <span>Descargar WAV Convolución</span>
                </button>
              </div>
            </div>
          </Show>

          {/* Tab 3 Content: Graphic EQ ISO Bands */}
          <Show when={state.selectedEqMethod === 'graphiceq'}>
            <div class={`flex-1 flex-col p-2 sm:p-2.5 gap-2 overflow-hidden ${mobileView() === 'target' ? 'hidden lg:flex' : 'flex'}`}>
              <div class="text-[10px] text-[var(--text-dim)] flex flex-wrap items-center justify-between gap-1 px-1">
                <span class="truncate">
                  {state.graphicEqBandsCount === 127
                    ? '127 Frecuencias fijas de 20 Hz a 19,871 Hz (estándar AutoEq / Wavelet).'
                    : 'Bandas ISO con filtros paramétricos de factor Q normalizado.'}
                </span>
                <span class="shrink-0">Rango: -12.0 dB a +12.0 dB</span>
              </div>

              {/* Scrollable Horizontal Slider / Gain Rack */}
              <div class="flex-1 overflow-x-auto overflow-y-hidden border border-[var(--border-default)] rounded bg-[var(--bg-panel)] p-2 flex items-center gap-1.5 min-h-0">
                <For each={state.graphicEqBands}>
                  {(band) => (
                    <div class="flex flex-col items-center justify-between h-full min-w-[48px] sm:min-w-[44px] max-w-[54px] px-1 py-1 bg-[var(--bg-card)] rounded border border-[var(--border-default)] hover:border-[var(--accent-blue)] transition-colors shrink-0">
                      {/* Frequency Badge */}
                      <span class="font-mono font-bold text-[10px] text-[var(--text-main)] truncate" title={`${band.fc} Hz`}>
                        {formatBandFreq(band.fc)}
                      </span>

                      {/* Gain Input */}
                      <input
                        type="number"
                        step="0.5"
                        min="-24"
                        max="24"
                        value={band.gain.toFixed(1)}
                        onChange={(e) => frActions.updateGraphicEqBandGain(band.id, parseFloat(e.currentTarget.value) || 0)}
                        class={`w-full text-center font-mono font-bold text-[10px] bg-[var(--bg-input)] border border-[var(--border-contrast)] rounded py-0.5 outline-none focus:border-[var(--accent-blue)] ${
                          band.gain > 0 ? 'text-[#00FF88]' : band.gain < 0 ? 'text-[#FF4444]' : 'text-[var(--text-muted)]'
                        }`}
                      />

                      {/* Compact Slider (touch-none-slider prevents horizontal rack scroll hijack on capacitive screens) */}
                      <div
                        class="w-full flex justify-center py-1"
                        onTouchStart={(e) => e.stopPropagation()}
                        onTouchMove={(e) => e.stopPropagation()}
                      >
                        <input
                          type="range"
                          min="-12"
                          max="12"
                          step="0.5"
                          value={band.gain}
                          onInput={(e) => frActions.updateGraphicEqBandGain(band.id, parseFloat(e.currentTarget.value))}
                          class="touch-none-slider w-full h-1 bg-[var(--border-contrast)] rounded appearance-none cursor-pointer accent-[var(--accent-blue)]"
                          title={`${band.fc} Hz: ${band.gain.toFixed(1)} dB`}
                        />
                      </div>

                      {/* Q Indicator */}
                      <span class="text-[8px] font-mono text-[var(--text-dim)]">Q {band.q.toFixed(1)}</span>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>

          {/* Tab 4 Content: Ideal Analytic Inversion */}
          <Show when={state.selectedEqMethod === 'ideal'}>
            <div class={`flex-1 flex-col p-2.5 sm:p-3 gap-2.5 sm:gap-3 overflow-y-auto ${mobileView() === 'target' ? 'hidden lg:flex' : 'flex'}`}>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-2.5">
                <div class="bg-[var(--bg-panel)] border border-[var(--border-default)] rounded p-2 sm:p-2.5 flex flex-col justify-between">
                  <span class="text-[10px] text-[var(--text-muted)] font-medium">Resolución Espectral</span>
                  <div class="text-xs sm:text-sm font-mono font-bold text-[var(--accent-blue-badge-text)] mt-1">
                    500 Puntos Logarítmicos
                  </div>
                  <span class="text-[9px] text-[var(--text-dim)] mt-0.5">Espaciado estándar Hi-Res (20 Hz - 20 kHz)</span>
                </div>

                <div class="bg-[var(--bg-panel)] border border-[var(--border-default)] rounded p-2 sm:p-2.5 flex flex-col justify-between">
                  <span class="text-[10px] text-[var(--text-muted)] font-medium">Desviación respecto al Target</span>
                  <div class="text-xs sm:text-sm font-mono font-bold text-[#00FF88] mt-1">
                    0.00 dB (Fidelidad 100%)
                  </div>
                  <span class="text-[9px] text-[var(--text-dim)] mt-0.5">Sin limitaciones de bandas físicas</span>
                </div>

                <div class="bg-[var(--bg-panel)] border border-[var(--border-default)] rounded p-2 sm:p-2.5 flex flex-col justify-between">
                  <span class="text-[10px] text-[var(--text-muted)] font-medium">Límite Anti-Saturación</span>
                  <div class="text-xs sm:text-sm font-mono font-bold text-[var(--text-main)] mt-1">
                    +{state.targetParams.maxBoost} dB Máx Boost
                  </div>
                  <span class="text-[9px] text-[var(--text-dim)] mt-0.5">Protección dinámica frente a distorsión</span>
                </div>
              </div>

              {/* Explanatory banner */}
              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-2.5 bg-[var(--bg-panel)] border border-[var(--border-default)] rounded">
                <div class="flex items-start sm:items-center gap-2">
                  <Layers size={16} class="text-[var(--accent-blue)] shrink-0 mt-0.5 sm:mt-0" />
                  <div class="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                    La <strong class="text-[var(--accent-blue-badge-text)]">Inversión Ideal</strong> es el modelo matemático exacto de compensación punto a punto. No sufre de distorsión de fase ni de atenuación entre filtros. Sirve como la referencia dorada para comparar cómo rinden los filtros paramétricos PEQ, la convolución FIR y el ecualizador gráfico.
                  </div>
                </div>

                <div class="flex items-center gap-2 shrink-0 sm:ml-3">
                  <button
                    onClick={downloadRew}
                    class="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[var(--bg-surface)] hover:bg-[var(--border-contrast)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded font-semibold transition-colors cursor-pointer"
                  >
                    <Download size={13} />
                    <span>Descargar REW</span>
                  </button>

                  <button
                    onClick={downloadCsvData}
                    class="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[var(--accent-blue)] hover:opacity-90 text-white rounded font-bold transition-all shadow-[0_0_10px_rgba(0,85,255,0.25)] cursor-pointer"
                  >
                    <Download size={13} />
                    <span>Descargar CSV</span>
                  </button>
                </div>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}
