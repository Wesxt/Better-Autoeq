import { createSignal, Show } from 'solid-js'
import {
  state,
  frActions,
  equalizationCurve,
  targetCurve,
  equalizedResultCurve
} from '../../store/frStore'
import { STANDARD_FREQUENCIES, BUILT_IN_TARGETS } from '../../lib/autoeq/constants'
import { generateImpulseResponse } from '../../lib/autoeq/impulseResponse'
import type { ImpulseResponseOptions } from '../../lib/autoeq/impulseResponse'
import { encodeWav, downloadWavFile } from '../../lib/audio/wavEncoder'
import type { BitDepth, ChannelMode } from '../../lib/audio/wavEncoder'
import {
  generateEqualizerApoConfig,
  generateGraphicEqString,
  generateRewText,
  generateCsv,
  downloadTextFile,
  cleanExportFilename,
  generateDetailedWavFilename
} from '../../lib/autoeq/exporters'
import { X, Download, FileAudio, FileText, Sliders, Copy, Check } from 'lucide-solid'

export function ExportModal() {
  const [activeTab, setActiveTab] = createSignal<'wav' | 'eqapo' | 'graphiceq' | 'data'>(state.exportSettings.activeTab)

  // WAV Convolution Options initialized from persisted store
  const [sampleRate, setSampleRate] = createSignal<number>(state.exportSettings.sampleRate)
  const [bitDepth, setBitDepth] = createSignal<BitDepth>(state.exportSettings.bitDepth)
  const [taps, setTaps] = createSignal<number>(state.exportSettings.taps)
  const [phaseMode, setPhaseMode] = createSignal<'minimum' | 'linear'>(state.exportSettings.phaseMode)
  const [channelMode, setChannelMode] = createSignal<ChannelMode>(state.exportSettings.channelMode)
  const [normalizePeak, setNormalizePeak] = createSignal<boolean>(state.exportSettings.normalizePeak)
  const [isGeneratingWav, setIsGeneratingWav] = createSignal(false)

  // Status message
  const [statusMsg, setStatusMsg] = createSignal<string | null>(null)

  // Preamp calculation helpers
  const [manualPreamp, setManualPreamp] = createSignal<number>(0)

  const eqPeakGain = () => {
    const eq = equalizationCurve()
    if (!eq || eq.length === 0) return 0
    let m = -Infinity
    for (const g of eq) if (g > m) m = g
    return Number.isFinite(m) ? Math.max(0, Math.round(m * 10) / 10) : 0
  }

  const antiClipPreamp = () => {
    const peak = eqPeakGain()
    return peak > 0 ? Math.round(-(peak + 0.2) * 10) / 10 : -0.2
  }

  const effectivePreamp = () => {
    const base = normalizePeak() ? antiClipPreamp() : 0
    return Math.round((base + manualPreamp()) * 10) / 10
  }

  const activeCurve = () => state.curves.find(c => c.id === state.activeReferenceCurveId)
  const baseFilename = () => {
    const c = activeCurve()
    return c ? cleanExportFilename(c.name) : 'AutoEq'
  }

  const activeTargetName = () => {
    if (state.selectedTargetId === 'custom' && state.customTarget) {
      return state.customTarget.name
    }
    const t = BUILT_IN_TARGETS.find(target => target.id === state.selectedTargetId)
    return t ? t.name : null
  }

  const defaultWavFilename = () => {
    return generateDetailedWavFilename({
      baseName: activeCurve()?.name || 'AutoEq',
      targetName: activeTargetName(),
      sampleRate: sampleRate(),
      bitDepth: bitDepth(),
      phaseMode: phaseMode(),
      taps: taps(),
      channelMode: channelMode(),
      preampDb: effectivePreamp()
    })
  }

  const [customFilename, setCustomFilename] = createSignal<string>('')
  const currentWavFilename = () => customFilename().trim() || defaultWavFilename()

  function handleExportWav() {
    setIsGeneratingWav(true)
    setStatusMsg('Calculando respuesta al impulso de convolución...')

    setTimeout(() => {
      try {
        const eqData = equalizationCurve()
        const irOptions: ImpulseResponseOptions = {
          fs: sampleRate(),
          taps: taps(),
          phase: phaseMode(),
          normalize: normalizePeak(),
          preamp: manualPreamp()
        }

        const impulseSamples = generateImpulseResponse(STANDARD_FREQUENCIES, eqData, irOptions)

        const wavBytes = encodeWav(impulseSamples, {
          sampleRate: sampleRate(),
          bitDepth: bitDepth(),
          channels: channelMode()
        })

        const rawName = currentWavFilename()
        const fname = rawName.toLowerCase().endsWith('.wav') ? rawName : `${rawName}.wav`
        downloadWavFile(wavBytes, fname)

        setStatusMsg(`✓ Archivo WAV descargado exitosamente (${fname})`)
        setTimeout(() => setStatusMsg(null), 4000)
      } catch (err) {
        alert(`Error al generar archivo WAV: ${(err as Error).message}`)
      } finally {
        setIsGeneratingWav(false)
      }
    }, 50)
  }

  function handleExportEqApo() {
    const config = generateEqualizerApoConfig(state.peqFilters, STANDARD_FREQUENCIES)
    const fname = `${baseFilename()}_EqualizerAPO_Config.txt`
    downloadTextFile(config, fname)
  }

  const [copiedGraphicEq, setCopiedGraphicEq] = createSignal(false)

  function handleCopyGraphicEq() {
    const eq = equalizationCurve()
    if (!eq || eq.length === 0) return
    const str = generateGraphicEqString(STANDARD_FREQUENCIES, eq, true, 0)
    navigator.clipboard.writeText(str)
    setCopiedGraphicEq(true)
    setTimeout(() => setCopiedGraphicEq(false), 2000)
  }

  function handleExportGraphicEq() {
    const eq = equalizationCurve()
    const str = generateGraphicEqString(STANDARD_FREQUENCIES, eq, true, 0)
    const fname = `${baseFilename()}_GraphicEQ.txt`
    downloadTextFile(str, fname)
  }

  function handleExportCsv() {
    const curve = activeCurve()
    if (!curve) return

    const cols = [
      { name: 'raw', values: curve.rawGains },
      { name: 'smoothed', values: curve.smoothedGains },
      { name: 'target', values: targetCurve() },
      { name: 'equalization', values: equalizationCurve() },
      { name: 'equalized_result', values: equalizedResultCurve() }
    ]

    const csvContent = generateCsv(STANDARD_FREQUENCIES, cols)
    downloadTextFile(csvContent, `${baseFilename()}_FrequencyResponse.csv`, 'text/csv;charset=utf-8')
  }

  function handleExportRew() {
    const curve = activeCurve()
    if (!curve) return
    const content = generateRewText(STANDARD_FREQUENCIES, curve.smoothedGains, curve.name)
    downloadTextFile(content, `${baseFilename()}_REW.txt`)
  }

  return (
    <Show when={state.isExportModalOpen}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-4 select-none">
        <div class="w-full max-w-2xl max-h-[92dvh] bg-[var(--bg-modal)] border border-[var(--border-default)] rounded-xl shadow-2xl overflow-hidden flex flex-col text-xs transition-colors">
          {/* Header */}
          <div class="flex items-center justify-between px-3.5 sm:px-5 py-3 sm:py-3.5 border-b border-[var(--border-default)] bg-[var(--bg-panel)] shrink-0">
            <div class="flex items-center gap-2 min-w-0">
              <FileAudio size={16} class="text-[var(--accent-blue)] shrink-0" />
              <h2 class="text-xs sm:text-sm font-bold text-[var(--text-pure)] uppercase tracking-wide truncate">
                Exportar Configuración y Filtros
              </h2>
            </div>
            <button
              onClick={() => frActions.closeExportModal()}
              class="p-1 text-[var(--text-muted)] hover:text-[var(--text-pure)] rounded transition-colors shrink-0 cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          {/* Navigation Tabs */}
          <div class="flex border-b border-[var(--border-default)] bg-[var(--bg-panel)] px-3 sm:px-5 pt-2 gap-3 sm:gap-4 overflow-x-auto no-scrollbar shrink-0">
            <button
              onClick={() => {
                setActiveTab('wav')
                frActions.setExportSetting('activeTab', 'wav')
              }}
              class={`pb-2.5 font-bold transition-all border-b-2 flex items-center gap-1.5 sm:gap-2 shrink-0 whitespace-nowrap cursor-pointer ${
                activeTab() === 'wav'
                  ? 'border-[var(--accent-blue)] text-[var(--accent-blue-badge-text)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-pure)]'
              }`}
            >
              <FileAudio size={13} />
              <span>Convolución WAV (.wav)</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('eqapo')
                frActions.setExportSetting('activeTab', 'eqapo')
              }}
              class={`pb-2.5 font-bold transition-all border-b-2 flex items-center gap-1.5 sm:gap-2 shrink-0 whitespace-nowrap cursor-pointer ${
                activeTab() === 'eqapo'
                  ? 'border-[var(--accent-blue)] text-[var(--accent-blue-badge-text)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-pure)]'
              }`}
            >
              <Sliders size={13} />
              <span>EqualizerAPO (PEQ)</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('graphiceq')
                frActions.setExportSetting('activeTab', 'graphiceq')
              }}
              class={`pb-2.5 font-bold transition-all border-b-2 flex items-center gap-1.5 sm:gap-2 shrink-0 whitespace-nowrap cursor-pointer ${
                activeTab() === 'graphiceq'
                  ? 'border-[var(--accent-blue)] text-[var(--accent-blue-badge-text)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-pure)]'
              }`}
            >
              <FileText size={13} />
              <span>GraphicEQ / Wavelet</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('data')
                frActions.setExportSetting('activeTab', 'data')
              }}
              class={`pb-2.5 font-bold transition-all border-b-2 flex items-center gap-1.5 sm:gap-2 shrink-0 whitespace-nowrap cursor-pointer ${
                activeTab() === 'data'
                  ? 'border-[var(--accent-blue)] text-[var(--accent-blue-badge-text)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-pure)]'
              }`}
            >
              <FileText size={13} />
              <span>Datos CSV / REW</span>
            </button>
          </div>

          {/* Tab Content */}
          <div class="p-3.5 sm:p-6 flex flex-col gap-4 flex-1 overflow-y-auto bg-[var(--bg-panel)]">
            {/* WAV Tab */}
            <Show when={activeTab() === 'wav'}>
              <div class="flex flex-col gap-4">
                <div class="p-3 bg-[var(--bg-surface)] rounded-lg border border-[var(--border-default)] text-[var(--text-secondary)] leading-relaxed">
                  Genera una <strong class="text-[var(--text-pure)]">Respuesta al Impulso (Impulse Response .wav)</strong> para motores de convolución como Roon, CamillaDSP, EasyEffects, Viper4Android, convolver VSTs o EqualizerAPO.
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  {/* Bit Depth */}
                  <div class="flex flex-col gap-1.5">
                    <label class="font-bold text-[var(--text-pure)]">Profundidad de Bits:</label>
                    <select
                      class="bg-[var(--bg-input)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded-lg p-2 font-mono outline-none focus:border-[var(--accent-blue)]"
                      value={bitDepth()}
                      onChange={(e) => {
                        const val = parseInt(e.currentTarget.value) as BitDepth
                        setBitDepth(val)
                        frActions.setExportSetting('bitDepth', val)
                      }}
                    >
                      <option value="16">16-bit PCM (Estándar CD)</option>
                      <option value="24">24-bit PCM (Estudio de Alta Definición)</option>
                      <option value="32">32-bit Float IEEE (Máxima Dinámica Roon/CamillaDSP)</option>
                    </select>
                  </div>

                  {/* Sample Rate */}
                  <div class="flex flex-col gap-1.5">
                    <label class="font-bold text-[var(--text-pure)]">Frecuencia de Muestreo (Fs):</label>
                    <select
                      class="bg-[var(--bg-input)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded-lg p-2 font-mono outline-none focus:border-[var(--accent-blue)]"
                      value={sampleRate()}
                      onChange={(e) => {
                        const val = parseInt(e.currentTarget.value)
                        setSampleRate(val)
                        frActions.setExportSetting('sampleRate', val)
                      }}
                    >
                      <option value="44100">44.1 kHz (CD Audio)</option>
                      <option value="48000">48.0 kHz (Estándar Video & Studio)</option>
                      <option value="88200">88.2 kHz (High-Res 2x)</option>
                      <option value="96000">96.0 kHz (High-Res Studio)</option>
                      <option value="192000">192.0 kHz (Ultra High-Res)</option>
                    </select>
                  </div>

                  {/* Frequency Precision / Taps */}
                  <div class="flex flex-col gap-1.5">
                    <label class="font-bold text-[var(--text-pure)]">Precisión por Frecuencia (Taps / FFT):</label>
                    <select
                      class="bg-[var(--bg-input)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded-lg p-2 font-mono outline-none focus:border-[var(--accent-blue)]"
                      value={taps()}
                      onChange={(e) => {
                        const val = parseInt(e.currentTarget.value)
                        setTaps(val)
                        frActions.setExportSetting('taps', val)
                      }}
                    >
                      <option value="4096">4096 Taps (~11.7 Hz resolución)</option>
                      <option value="8192">8192 Taps (~5.8 Hz resolución)</option>
                      <option value="16384">16384 Taps (~2.9 Hz resolución - Recomendado)</option>
                      <option value="32768">32768 Taps (~1.4 Hz resolución subgraves)</option>
                      <option value="65536">65536 Taps (~0.7 Hz precisión quirúrgica)</option>
                    </select>
                  </div>

                  {/* Phase Mode */}
                  <div class="flex flex-col gap-1.5">
                    <label class="font-bold text-[var(--text-pure)]">Modo de Fase:</label>
                    <select
                      class="bg-[var(--bg-input)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded-lg p-2 font-mono outline-none focus:border-[var(--accent-blue)]"
                      value={phaseMode()}
                      onChange={(e) => {
                        const val = e.currentTarget.value as 'minimum' | 'linear'
                        setPhaseMode(val)
                        frActions.setExportSetting('phaseMode', val)
                      }}
                    >
                      <option value="minimum">Fase Mínima (Sin Pre-ringing, baja latencia)</option>
                      <option value="linear">Fase Lineal (Simétrico, retardo constante)</option>
                    </select>
                  </div>

                  {/* Channels */}
                  <div class="flex flex-col gap-1.5">
                    <label class="font-bold text-[var(--text-pure)]">Canales:</label>
                    <select
                      class="bg-[var(--bg-input)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded-lg p-2 font-mono outline-none focus:border-[var(--accent-blue)]"
                      value={channelMode()}
                      onChange={(e) => {
                        const val = e.currentTarget.value as ChannelMode
                        setChannelMode(val)
                        frActions.setExportSetting('channelMode', val)
                      }}
                    >
                      <option value="stereo">Estéreo (Dual-Mono L+R)</option>
                      <option value="mono">Mono (1 Canal)</option>
                    </select>
                  </div>
                </div>

                {/* Preamp & Anti-clipping Control */}
                <div class="p-3.5 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-default)] flex flex-col gap-3">
                  <div class="flex items-center justify-between flex-wrap gap-2">
                    <span class="font-bold text-xs text-[var(--text-pure)]">
                      Preamplificación y Control Anti-Clipping:
                    </span>
                    <div class="flex items-center gap-1.5 font-mono text-[11px]">
                      <span class="text-[var(--text-muted)]">Pico EQ requerido:</span>
                      <span class="font-bold text-[var(--text-pure)]">+{eqPeakGain()} dB</span>
                    </div>
                  </div>

                  {/* Normalize Peak checkbox */}
                  <div class="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-contrast)]">
                    <div class="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        id="norm-peak"
                        checked={normalizePeak()}
                        onChange={(e) => {
                          const val = e.currentTarget.checked
                          setNormalizePeak(val)
                          frActions.setExportSetting('normalizePeak', val)
                        }}
                        class="accent-[var(--accent-blue)] w-4 h-4 cursor-pointer"
                      />
                      <label for="norm-peak" class="cursor-pointer flex flex-col">
                        <span class="font-bold text-xs text-[var(--text-pure)]">
                          Normalizar ganancia a -0.2 dBFS (Anti-clipping)
                        </span>
                        <span class="text-[10px] text-[var(--text-muted)]">
                          Aplica preamp automático de {antiClipPreamp()} dB para que el filtro nunca supere 0 dBFS en EqualizerAPO o Roon
                        </span>
                      </label>
                    </div>
                    <span class="font-mono text-xs font-bold px-2 py-0.5 rounded bg-[var(--accent-blue-badge-bg)] text-[var(--accent-blue)] border border-[var(--accent-blue-badge-border)] shrink-0">
                      {antiClipPreamp()} dB
                    </span>
                  </div>

                  {/* Manual Preamp Offset */}
                  <div class="flex items-center justify-between gap-3 text-xs pt-1 border-t border-[var(--border-contrast)]/40">
                    <span class="text-[var(--text-muted)]">Ajuste fino de Preamp adicional:</span>
                    <div class="flex items-center gap-1.5 font-mono">
                      <input
                        type="number"
                        step="0.5"
                        min="-30"
                        max="10"
                        value={manualPreamp()}
                        onInput={(e) => setManualPreamp(parseFloat(e.currentTarget.value) || 0)}
                        class="w-20 px-2 py-1 bg-[var(--bg-panel)] border border-[var(--border-contrast)] rounded text-right font-bold text-[var(--text-pure)] outline-none"
                      />
                      <span class="text-[var(--text-muted)]">dB</span>
                    </div>
                  </div>

                  <div class="flex items-center justify-between pt-1 text-[11px] font-mono">
                    <span class="text-[var(--text-muted)]">Preamp total en archivo WAV:</span>
                    <span class={`font-bold ${effectivePreamp() < -0.1 ? 'text-[#00FF88]' : 'text-[#FF0000]'}`}>
                      {effectivePreamp()} dB {effectivePreamp() >= 0 ? '(⚠️ ¡Riesgo de saturación/clipping!)' : '(✓ Seguro - Sin clipping)'}
                    </span>
                  </div>
                </div>

                {/* Custom File Name Input */}
                <div class="flex flex-col gap-1.5 p-3.5 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-default)]">
                  <div class="flex items-center justify-between">
                    <label class="font-bold text-xs text-[var(--text-pure)]">Nombre del Archivo WAV:</label>
                    <button
                      type="button"
                      onClick={() => setCustomFilename('')}
                      class="text-[10px] text-[var(--accent-blue)] hover:underline cursor-pointer"
                      title="Restablecer al nombre limpio sugerido"
                    >
                      Restablecer nombre sugerido
                    </button>
                  </div>
                  <div class="flex items-center gap-2 bg-[var(--bg-panel)] border border-[var(--border-contrast)] rounded-lg px-3 py-2 font-mono text-xs">
                    <input
                      type="text"
                      value={customFilename() || defaultWavFilename()}
                      onInput={(e) => setCustomFilename(e.currentTarget.value)}
                      placeholder="Nombre del archivo..."
                      class="flex-1 min-w-0 bg-transparent text-[var(--text-pure)] outline-none"
                    />
                    <span class="text-[var(--text-muted)] font-bold shrink-0">.wav</span>
                  </div>
                  <span class="text-[10px] text-[var(--text-muted)] truncate">
                    Se guardará como: <code class="text-[var(--text-pure)] font-bold">{currentWavFilename().toLowerCase().endsWith('.wav') ? currentWavFilename() : `${currentWavFilename()}.wav`}</code>
                  </span>
                </div>

                {statusMsg() && (
                  <div class="p-2.5 bg-[var(--accent-blue-badge-bg)] border border-[var(--accent-blue-badge-border)] text-[var(--accent-blue-badge-text)] rounded-lg font-mono text-[11px]">
                    {statusMsg()}
                  </div>
                )}

                <button
                  onClick={handleExportWav}
                  disabled={isGeneratingWav()}
                  class="mt-2 flex items-center justify-center gap-2 py-3 bg-[var(--accent-blue)] hover:opacity-90 text-[#ffffff] rounded-lg font-bold text-sm transition-all shadow-[0_0_15px_rgba(0,85,255,0.4)] disabled:opacity-50"
                >
                  <Download size={16} />
                  <span>{isGeneratingWav() ? 'Procesando Convolución...' : 'Descargar Filtro de Convolución (.wav)'}</span>
                </button>
              </div>
            </Show>

            {/* EqualizerAPO Tab */}
            <Show when={activeTab() === 'eqapo'}>
              <div class="flex flex-col gap-3">
                <div class="p-3 bg-[var(--bg-surface)] rounded-lg border border-[var(--border-default)] text-[var(--text-secondary)]">
                  Exporta la configuración paramétrica con ganancia de preamplificación calculada para el archivo <code class="text-[var(--text-pure)]">config.txt</code> de EqualizerAPO / Peace GUI.
                </div>
                <pre class="p-3 bg-[var(--bg-input)] border border-[var(--border-default)] rounded-lg text-[#00aa55] dark:text-[#00FF88] font-mono text-[11px] overflow-x-auto max-h-48">
                  {generateEqualizerApoConfig(state.peqFilters, STANDARD_FREQUENCIES)}
                </pre>
                <button
                  onClick={handleExportEqApo}
                  class="flex items-center justify-center gap-2 py-2.5 bg-[var(--accent-blue)] hover:opacity-90 text-[#ffffff] rounded-lg font-bold transition-all shadow-md"
                >
                  <Download size={14} />
                  <span>Descargar config.txt</span>
                </button>
              </div>
            </Show>

            {/* GraphicEQ Tab */}
            <Show when={activeTab() === 'graphiceq'}>
              <div class="flex flex-col gap-3">
                <div class="p-3 bg-[var(--bg-surface)] rounded-lg border border-[var(--border-default)] text-[var(--text-secondary)] text-xs leading-relaxed">
                  Formato estándar de <strong class="text-[var(--text-pure)]">127 frecuencias</strong> (de 20 Hz a 19,871 Hz). Cumple rigurosamente el tope de frecuencia y la cuadrícula exacta requerida por la aplicación Android <strong class="text-[var(--text-pure)]">Wavelet</strong> y el módulo GraphicEQ de <strong class="text-[var(--text-pure)]">EqualizerAPO</strong>.
                </div>
                <div class="p-3 bg-[var(--bg-input)] border border-[var(--border-default)] rounded-lg text-[var(--text-main)] font-mono text-[11px] overflow-x-auto max-h-32 select-all whitespace-pre-wrap break-all">
                  {generateGraphicEqString(STANDARD_FREQUENCIES, equalizationCurve(), true, 0)}
                </div>
                <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <button
                    onClick={handleCopyGraphicEq}
                    class="flex-1 flex items-center justify-center gap-2 py-2.5 bg-[var(--bg-surface)] hover:bg-[var(--border-contrast)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded-lg font-semibold transition-all shadow-sm cursor-pointer"
                    title="Copiar texto GraphicEQ al portapapeles"
                  >
                    {copiedGraphicEq() ? <Check size={14} class="text-[#00FF88]" /> : <Copy size={14} />}
                    <span>{copiedGraphicEq() ? '¡Copiado!' : 'Copiar GraphicEQ (Wavelet)'}</span>
                  </button>
                  <button
                    onClick={handleExportGraphicEq}
                    class="flex-1 flex items-center justify-center gap-2 py-2.5 bg-[var(--accent-blue)] hover:opacity-90 text-[#ffffff] rounded-lg font-bold transition-all shadow-md cursor-pointer"
                    title="Descargar archivo GraphicEQ.txt compatible con Wavelet y Equalizer APO"
                  >
                    <Download size={14} />
                    <span>Descargar GraphicEQ.txt</span>
                  </button>
                </div>
              </div>
            </Show>

            {/* Data Tab */}
            <Show when={activeTab() === 'data'}>
              <div class="flex flex-col gap-4">
                <div class="p-3 bg-[var(--bg-surface)] rounded-lg border border-[var(--border-default)] text-[var(--text-secondary)]">
                  Descarga los datos numéricos tabulados de la curva actual para usarlos en Excel, Python, MATLAB o Room EQ Wizard (REW).
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={handleExportCsv}
                    class="flex items-center justify-center gap-2 py-2.5 bg-[var(--bg-surface)] hover:bg-[var(--border-contrast)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded-lg font-semibold transition-all"
                  >
                    <Download size={14} />
                    <span>Descargar CSV Completo</span>
                  </button>
                  <button
                    onClick={handleExportRew}
                    class="flex items-center justify-center gap-2 py-2.5 bg-[var(--bg-surface)] hover:bg-[var(--border-contrast)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded-lg font-semibold transition-all"
                  >
                    <Download size={14} />
                    <span>Descargar Formato REW (.txt)</span>
                  </button>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  )
}
