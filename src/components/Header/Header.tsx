import { createSignal, onMount, onCleanup, For, Show } from 'solid-js'
import { state, frActions } from '../../store/frStore'
import { audioPreview, type PreviewSource } from '../../lib/audio/audioPreview'
import { micAnalyzer } from '../../lib/audio/micCapture'
import {
  Activity,
  Mic,
  Download,
  Play,
  Pause,
  Volume2,
  Sun,
  Moon,
  Music,
  AudioWaveform,
  Link2,
  Link2Off,
  PanelLeft,
  SlidersHorizontal
} from 'lucide-solid'

const SOURCE_OPTIONS: { id: PreviewSource; label: string; title: string }[] = [
  { id: 'track', label: 'Música', title: 'Reproducir pista de audio' },
  { id: 'white', label: 'Blanco', title: 'Ruido blanco (energía igual por Hz)' },
  { id: 'pink', label: 'Rosa', title: 'Ruido rosa (energía igual por octava, -3 dB/oct)' }
]

export interface HeaderProps {
  isSidebarOpen?: boolean
  onToggleSidebar?: () => void
}

export function Header(props: HeaderProps) {
  const [isPlaying, setIsPlaying] = createSignal(false)
  const [isBypassed, setIsBypassed] = createSignal(false)
  const [source, setSource] = createSignal<PreviewSource>(audioPreview.getSource())
  const [leftVolume, setLeftVolume] = createSignal(audioPreview.getLeftVolume())
  const [rightVolume, setRightVolume] = createSignal(audioPreview.getRightVolume())
  const [linkedChannels, setLinkedChannels] = createSignal(false)
  const [trackName, setTrackName] = createSignal('Pista de Prueba (Sintetizada)')
  const [isMobileAudioOpen, setIsMobileAudioOpen] = createSignal(false)
  let audioInputRef!: HTMLInputElement

  onMount(() => {
    audioPreview.setCallback((playing, bypassed, src) => {
      setIsPlaying(playing)
      setIsBypassed(bypassed)
      setSource(src)
    })
    const unsubscribeVol = audioPreview.onVolumeChange((l, r) => {
      setLeftVolume(l)
      setRightVolume(r)
    })
    onCleanup(() => {
      unsubscribeVol()
    })
  })

  function handleLeftVolume(v: number) {
    setLeftVolume(v)
    if (linkedChannels()) {
      setRightVolume(v)
      audioPreview.setChannelVolumes(v, v)
      micAnalyzer.setChannelVolumes(v, v)
    } else {
      audioPreview.setLeftVolume(v)
      micAnalyzer.setLeftVolume(v)
    }
  }

  function handleRightVolume(v: number) {
    setRightVolume(v)
    if (linkedChannels()) {
      setLeftVolume(v)
      audioPreview.setChannelVolumes(v, v)
      micAnalyzer.setChannelVolumes(v, v)
    } else {
      audioPreview.setRightVolume(v)
      micAnalyzer.setRightVolume(v)
    }
  }

  function togglePlay() {
    if (isPlaying()) {
      audioPreview.pause()
    } else {
      audioPreview.play()
    }
  }

  const displayName = () => {
    if (source() === 'white') return 'Ruido Blanco'
    if (source() === 'pink') return 'Ruido Rosa'
    return trackName()
  }

  async function handleAudioUpload(file: File | null) {
    if (!file) return
    try {
      const name = await audioPreview.loadAudioFile(file)
      setTrackName(name)
      audioPreview.play()
    } catch (err) {
      alert(`Error al cargar pista de audio: ${(err as Error).message}`)
    }
  }

  return (
    <header class="bg-[var(--bg-panel)] border-b border-[var(--border-default)] flex flex-col select-none transition-colors shrink-0 z-30">
      <input
        type="file"
        ref={audioInputRef}
        accept="audio/*"
        class="hidden"
        onChange={(e) => handleAudioUpload(e.currentTarget.files?.[0] || null)}
      />

      {/* Primary Top Bar */}
      <div class="h-12 sm:h-14 px-2 sm:px-4 flex items-center justify-between gap-1.5 sm:gap-3">
        {/* Left: Mobile Drawer Trigger + Brand / Logo */}
        <div class="flex items-center gap-1.5 sm:gap-3 min-w-0">
          {/* Mobile & Tablet Sidebar Drawer Toggle (< lg) */}
          <button
            type="button"
            onClick={() => props.onToggleSidebar?.()}
            class={`lg:hidden flex items-center gap-1 px-2 py-1.5 rounded-lg border text-xs font-bold transition-all active:scale-95 cursor-pointer shrink-0 ${
              props.isSidebarOpen
                ? 'bg-[var(--accent-blue)] text-white border-[var(--accent-blue)]'
                : 'bg-[var(--bg-surface)] text-[var(--text-main)] border-[var(--border-default)] hover:border-[var(--accent-blue)]'
            }`}
            title="Abrir panel de curvas y archivos"
            aria-label="Abrir panel de curvas"
          >
            <PanelLeft size={15} class={props.isSidebarOpen ? 'text-white' : 'text-[var(--accent-blue)]'} />
            <span class="hidden sm:inline text-[11px]">Curvas</span>
            <span class="px-1.5 py-0.2 text-[10px] font-mono bg-[var(--accent-blue-badge-bg)] text-[var(--accent-blue-badge-text)] border border-[var(--accent-blue-badge-border)] rounded-full font-bold">
              {state.curves.length}
            </span>
          </button>

          <div class="flex items-center gap-2 min-w-0">
            <div class="w-7 h-7 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-contrast)] flex items-center justify-center shadow-[0_0_12px_rgba(0,85,255,0.2)] shrink-0">
              <Activity size={17} class="text-[var(--accent-blue)]" />
            </div>
            <div class="flex flex-col min-w-0">
              <div class="flex items-center gap-1 sm:gap-1.5 font-black text-xs sm:text-sm tracking-wider sm:tracking-widest text-[var(--text-pure)] truncate">
                <span>BETTER</span>
                <span class="text-[var(--accent-blue)]">AUTOEQ</span>
              </div>
              <span class="hidden md:block text-[9px] text-[var(--text-muted)] tracking-wider uppercase font-mono truncate">
                Frequency Response Analyzer & Convolver
              </span>
            </div>
          </div>
        </div>

        {/* Desktop (xl+) Inline Real-time Audio Preview Audition Station */}
        <div class="hidden xl:flex items-center gap-3 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg px-3 py-1.5 shadow-inner">
          <div class="flex items-center gap-2">
            {/* Play/Pause Button */}
            <button
              onClick={togglePlay}
              class={`w-7 h-7 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                isPlaying()
                  ? 'bg-[var(--accent-blue)] text-[#ffffff] shadow-[0_0_12px_rgba(0,85,255,0.4)]'
                  : 'bg-[var(--text-main)] text-[var(--bg-app)] hover:opacity-90'
              }`}
              title={isPlaying() ? 'Pausar audio' : 'Reproducir audio de prueba'}
            >
              {isPlaying() ? <Pause size={13} /> : <Play size={13} class="ml-0.5" />}
            </button>

            {/* Track name & upload trigger */}
            <div class="flex flex-col max-w-[150px]">
              <span class="text-[11px] font-semibold text-[var(--text-main)] truncate" title={displayName()}>
                {displayName()}
              </span>
              <button
                onClick={() => audioInputRef.click()}
                class="text-[9px] text-[var(--text-muted)] hover:text-[var(--accent-blue)] transition-colors text-left cursor-pointer"
              >
                + Subir audio (MP3/WAV)
              </button>
            </div>
          </div>

          {/* Source selector: music track / white noise / pink noise */}
          <div class="flex items-center rounded-md border border-[var(--border-default)] bg-[var(--bg-panel)] p-0.5">
            <For each={SOURCE_OPTIONS}>
              {(opt) => (
                <button
                  onClick={() => audioPreview.setSource(opt.id)}
                  class={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold transition-colors cursor-pointer ${
                    source() === opt.id
                      ? 'bg-[var(--accent-blue)] text-[#ffffff]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-pure)]'
                  }`}
                  title={opt.title}
                >
                  {opt.id === 'track'
                    ? <Music size={11} />
                    : <AudioWaveform size={11} class={opt.id === 'pink' && source() !== 'pink' ? 'text-[#FF77C8]' : ''} />}
                  <span>{opt.label}</span>
                </button>
              )}
            </For>
          </div>

          {/* Left & Right Output Channel Volumes */}
          <div class="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[var(--bg-panel)] border border-[var(--border-default)]">
            <div class="flex flex-col gap-1">
              {/* Left Channel */}
              <div class="flex items-center gap-1.5" title={`Volumen Canal Izquierdo (Left): ${Math.round(leftVolume() * 100)}%`}>
                <button
                  type="button"
                  onClick={() => handleLeftVolume(leftVolume() > 0 ? 0 : 0.8)}
                  class={`text-[9px] font-mono font-bold w-3.5 text-center rounded transition-colors cursor-pointer ${
                    leftVolume() === 0
                      ? 'text-[#FF4444]'
                      : 'text-[var(--accent-blue)] hover:text-[var(--text-pure)]'
                  }`}
                  title={leftVolume() === 0 ? 'Activar canal L' : 'Silenciar canal L'}
                >
                  L
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={leftVolume()}
                  onInput={(e) => handleLeftVolume(parseFloat(e.currentTarget.value))}
                  class="w-16 h-1 bg-[var(--border-contrast)] rounded appearance-none cursor-pointer accent-[var(--accent-blue)]"
                />
                <span class="text-[9px] font-mono text-[var(--text-muted)] w-7 text-right">
                  {Math.round(leftVolume() * 100)}%
                </span>
              </div>

              {/* Right Channel */}
              <div class="flex items-center gap-1.5" title={`Volumen Canal Derecho (Right): ${Math.round(rightVolume() * 100)}%`}>
                <button
                  type="button"
                  onClick={() => handleRightVolume(rightVolume() > 0 ? 0 : 0.8)}
                  class={`text-[9px] font-mono font-bold w-3.5 text-center rounded transition-colors cursor-pointer ${
                    rightVolume() === 0
                      ? 'text-[#FF4444]'
                      : 'text-[#00FF88] hover:text-[var(--text-pure)]'
                  }`}
                  title={rightVolume() === 0 ? 'Activar canal R' : 'Silenciar canal R'}
                >
                  R
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={rightVolume()}
                  onInput={(e) => handleRightVolume(parseFloat(e.currentTarget.value))}
                  class="w-16 h-1 bg-[var(--border-contrast)] rounded appearance-none cursor-pointer accent-[#00FF88]"
                />
                <span class="text-[9px] font-mono text-[var(--text-muted)] w-7 text-right">
                  {Math.round(rightVolume() * 100)}%
                </span>
              </div>
            </div>

            {/* Link / Unlink L & R Channels */}
            <button
              type="button"
              onClick={() => setLinkedChannels(!linkedChannels())}
              class={`p-1 rounded transition-colors cursor-pointer ${
                linkedChannels()
                  ? 'bg-[var(--accent-blue-badge-bg)] text-[var(--accent-blue)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-pure)]'
              }`}
              title={linkedChannels() ? 'Canales L y R enlazados (clic para separar)' : 'Enlazar volumen de canales L y R'}
            >
              {linkedChannels() ? <Link2 size={11} /> : <Link2Off size={11} />}
            </button>
          </div>

          {/* EQ Bypass / Active Switch */}
          <button
            onClick={() => audioPreview.toggleBypass()}
            class={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold border transition-all cursor-pointer ${
              !isBypassed()
                ? 'bg-[var(--accent-blue-badge-bg)] text-[var(--accent-blue-badge-text)] border-[var(--accent-blue-badge-border)]'
                : 'bg-[var(--bg-panel)] text-[var(--text-muted)] border-[var(--border-default)] hover:text-[var(--text-main)]'
            }`}
            title="Alternar ecualización en tiempo real (Bypass A/B)"
          >
            <Volume2 size={12} />
            <span>{isBypassed() ? 'EQ BYPASS' : 'EQ ACTIVO'}</span>
          </button>
        </div>

        {/* Right: Compact Audio Controls (< xl) + Main Action Buttons + Theme Toggle */}
        <div class="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Compact Audio Preview Pill for Mobile / Tablet / Small Laptop (< xl) */}
          <div class="flex xl:hidden items-center gap-1 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg p-1">
            <button
              type="button"
              onClick={togglePlay}
              class={`w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center transition-all active:scale-95 cursor-pointer ${
                isPlaying()
                  ? 'bg-[var(--accent-blue)] text-[#ffffff] shadow-[0_0_10px_rgba(0,85,255,0.4)]'
                  : 'bg-[var(--text-main)] text-[var(--bg-app)]'
              }`}
              title={isPlaying() ? 'Pausar audio' : 'Reproducir audio de prueba'}
            >
              {isPlaying() ? <Pause size={12} /> : <Play size={12} class="ml-0.5" />}
            </button>

            <button
              type="button"
              onClick={() => audioPreview.toggleBypass()}
              class={`flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded text-[10px] font-bold border transition-all active:scale-95 cursor-pointer ${
                !isBypassed()
                  ? 'bg-[var(--accent-blue-badge-bg)] text-[var(--accent-blue-badge-text)] border-[var(--accent-blue-badge-border)]'
                  : 'bg-[var(--bg-panel)] text-[var(--text-muted)] border-[var(--border-default)]'
              }`}
              title="Alternar ecualización en tiempo real (Bypass A/B)"
            >
              <Volume2 size={11} />
              <span class="hidden sm:inline">{isBypassed() ? 'BYPASS' : 'EQ ON'}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsMobileAudioOpen(!isMobileAudioOpen())}
              class={`p-1 sm:px-1.5 sm:py-1 rounded text-[10px] font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                isMobileAudioOpen()
                  ? 'bg-[var(--accent-blue)] text-white'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-pure)]'
              }`}
              title="Abrir controles de audio, pistas y volumen por canal"
            >
              <SlidersHorizontal size={12} />
            </button>
          </div>

          {/* Theme Toggle (Light / Dark) */}
          <button
            onClick={() => frActions.toggleTheme()}
            class="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--border-contrast)] active:scale-95 text-[var(--text-main)] border border-[var(--border-default)] transition-all cursor-pointer"
            title={state.theme === 'dark' ? 'Cambiar a Modo Claro' : 'Cambiar a Modo Oscuro'}
          >
            {state.theme === 'dark' ? (
              <Sun size={15} class="text-[#FFAA00]" />
            ) : (
              <Moon size={15} class="text-[var(--accent-blue)]" />
            )}
          </button>

          <button
            onClick={() => frActions.openMicModal()}
            class="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-[var(--bg-surface)] hover:bg-[var(--border-contrast)] active:scale-95 text-[var(--text-main)] border border-[var(--border-default)] hover:border-[var(--accent-blue)] rounded-lg text-xs font-semibold transition-all group cursor-pointer"
            title="Medición Acústica con Micrófono RTA"
          >
            <Mic size={14} class="text-[var(--accent-blue)] group-hover:scale-110 transition-transform" />
            <span class="hidden md:inline">Micrófono RTA</span>
            <span class="hidden sm:inline md:hidden">RTA</span>
          </button>

          <button
            onClick={() => frActions.openExportModal()}
            class="flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 bg-[var(--accent-blue)] hover:opacity-90 active:scale-95 text-[#ffffff] rounded-lg text-xs font-bold transition-all shadow-[0_0_12px_rgba(0,85,255,0.35)] cursor-pointer"
            title="Exportar configuración y filtros"
          >
            <Download size={14} />
            <span class="hidden sm:inline">Exportar</span>
          </button>
        </div>
      </div>

      {/* Expandable Audio Audition Station for Mobile, Tablet & Compact Laptops (< xl) */}
      <Show when={isMobileAudioOpen()}>
        <div class="xl:hidden px-2.5 sm:px-4 py-2 bg-[var(--bg-surface)] border-t border-[var(--border-default)] flex flex-wrap items-center justify-between gap-2 text-xs">
          {/* Track info & Upload */}
          <div class="flex items-center gap-2 min-w-0">
            <span class="text-[11px] font-semibold text-[var(--text-main)] truncate max-w-[160px] sm:max-w-[220px]" title={displayName()}>
              {displayName()}
            </span>
            <button
              type="button"
              onClick={() => audioInputRef.click()}
              class="px-2 py-0.5 rounded bg-[var(--bg-panel)] border border-[var(--border-contrast)] text-[10px] text-[var(--accent-blue)] font-semibold shrink-0 cursor-pointer"
            >
              + Subir audio
            </button>
          </div>

          {/* Source selector */}
          <div class="flex items-center rounded-md border border-[var(--border-default)] bg-[var(--bg-panel)] p-0.5">
            <For each={SOURCE_OPTIONS}>
              {(opt) => (
                <button
                  type="button"
                  onClick={() => audioPreview.setSource(opt.id)}
                  class={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold transition-colors cursor-pointer ${
                    source() === opt.id
                      ? 'bg-[var(--accent-blue)] text-[#ffffff]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-pure)]'
                  }`}
                  title={opt.title}
                >
                  {opt.id === 'track'
                    ? <Music size={11} />
                    : <AudioWaveform size={11} class={opt.id === 'pink' && source() !== 'pink' ? 'text-[#FF77C8]' : ''} />}
                  <span>{opt.label}</span>
                </button>
              )}
            </For>
          </div>

          {/* L & R Volume Sliders + Link */}
          <div class="flex items-center gap-2 px-2.5 py-1 rounded-md bg-[var(--bg-panel)] border border-[var(--border-default)] w-full sm:w-auto justify-between sm:justify-start">
            <div class="flex items-center gap-1.5 flex-1 sm:flex-initial">
              <button
                type="button"
                onClick={() => handleLeftVolume(leftVolume() > 0 ? 0 : 0.8)}
                class={`text-[10px] font-mono font-bold w-4 text-center rounded cursor-pointer ${
                  leftVolume() === 0 ? 'text-[#FF4444]' : 'text-[var(--accent-blue)]'
                }`}
              >
                L
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={leftVolume()}
                onInput={(e) => handleLeftVolume(parseFloat(e.currentTarget.value))}
                class="flex-1 sm:w-20 h-1 bg-[var(--border-contrast)] rounded appearance-none cursor-pointer accent-[var(--accent-blue)]"
              />
              <span class="text-[9px] font-mono text-[var(--text-muted)] w-7 text-right">
                {Math.round(leftVolume() * 100)}%
              </span>
            </div>

            <div class="flex items-center gap-1.5 flex-1 sm:flex-initial">
              <button
                type="button"
                onClick={() => handleRightVolume(rightVolume() > 0 ? 0 : 0.8)}
                class={`text-[10px] font-mono font-bold w-4 text-center rounded cursor-pointer ${
                  rightVolume() === 0 ? 'text-[#FF4444]' : 'text-[#00FF88]'
                }`}
              >
                R
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={rightVolume()}
                onInput={(e) => handleRightVolume(parseFloat(e.currentTarget.value))}
                class="flex-1 sm:w-20 h-1 bg-[var(--border-contrast)] rounded appearance-none cursor-pointer accent-[#00FF88]"
              />
              <span class="text-[9px] font-mono text-[var(--text-muted)] w-7 text-right">
                {Math.round(rightVolume() * 100)}%
              </span>
            </div>

            <button
              type="button"
              onClick={() => setLinkedChannels(!linkedChannels())}
              class={`p-1 rounded transition-colors cursor-pointer ${
                linkedChannels()
                  ? 'bg-[var(--accent-blue-badge-bg)] text-[var(--accent-blue)]'
                  : 'text-[var(--text-muted)]'
              }`}
              title={linkedChannels() ? 'Canales L y R enlazados' : 'Enlazar L y R'}
            >
              {linkedChannels() ? <Link2 size={12} /> : <Link2Off size={12} />}
            </button>
          </div>
        </div>
      </Show>
    </header>
  )
}
