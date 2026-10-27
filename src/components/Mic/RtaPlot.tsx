import { createSignal, onCleanup, createEffect, onMount, Show } from 'solid-js';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { Activity, Mic, Palette, Sliders } from 'lucide-solid';
import { FpsMeter } from '../../lib/chart/fpsMeter';
import { ColorPickerPopover } from '../Common/ColorPickerPopover';
import { state, frActions } from '../../store/frStore';
import { micAnalyzer } from '../../lib/audio/micCapture';

export interface RtaPlotHandle {
  updateData: (freqs: number[], dbs: number[], maxHoldDbs?: number[], averageDbs?: number[], tfDbs?: number[]) => void;
  clear: () => void;
}

export interface RtaPlotProps {
  isRecording: boolean;
  livePeakDb: number;
  theme: string;
  captureMode?: 'instant' | 'peak' | 'average';
  ref?: (handle: RtaPlotHandle) => void;
}

export function RtaPlot(props: RtaPlotProps) {
  let chartContainerRef!: HTMLDivElement;
  let uplotInstance: uPlot | null = null;
  let resizeObserver: ResizeObserver | null = null;

  // Interactive crosshair readout
  const [hoverFreq, setHoverFreq] = createSignal<number>(1000);
  const [hoverDb, setHoverDb] = createSignal<number | null>(null);
  const [hoverMaxDb, setHoverMaxDb] = createSignal<number | null>(null);
  const [hoverAvgDb, setHoverAvgDb] = createSignal<number | null>(null);
  const [hoverTfDb, setHoverTfDb] = createSignal<number | null>(null);

  // RTA live curve color (customizable & persisted in store)
  const rtaCurveColor = () => state.micSettings.rtaCurveColor;
  const setRtaCurveColor = (color: string) => frActions.setMicSetting('rtaCurveColor', color);
  const currentRtaColor = () => rtaCurveColor() || (props.theme === 'light' ? '#4D8EEB' : '#4B83DB');

  // Max Hold curve color (customizable & persisted in store)
  const maxHoldCurveColor = () => state.micSettings.maxHoldCurveColor;
  const setMaxHoldCurveColor = (color: string) => frActions.setMicSetting('maxHoldCurveColor', color);
  const currentMaxHoldColor = () => maxHoldCurveColor() || '#FFAA00';

  // Average curve color (customizable & persisted in store)
  const averageCurveColor = () => state.micSettings.averageCurveColor;
  const setAverageCurveColor = (color: string) => frActions.setMicSetting('averageCurveColor', color);
  const currentAverageColor = () => averageCurveColor() || '#00FF88';

  // Smoothing configuration (3 optional smoothing layers)
  const rtaUseSpline = () => state.micSettings.rtaUseSpline ?? true;
  const temporalSmoothing = () => state.micSettings.temporalSmoothing ?? true;
  const bandIntegration = () => state.micSettings.bandIntegration ?? true;

  // Real FPS Meter
  const [realFps, setRealFps] = createSignal<number>(0);
  const fpsMeter = new FpsMeter((fps) => setRealFps(fps), 250);

  // Empty dummy baseline for uPlot (20 Hz - 20 kHz at 0 dB)
  function getEmptyPlotData(): uPlot.AlignedData {
    const freqs: number[] = [];
    const dbs: number[] = [];
    const maxDbs: number[] = [];
    const avgDbs: number[] = [];
    const tfDbs: number[] = [];
    const numPoints = 240;
    const logMin = Math.log10(20);
    const logMax = Math.log10(20000);
    const logStep = (logMax - logMin) / (numPoints - 1);
    for (let i = 0; i < numPoints; i++) {
      freqs.push(Math.pow(10, logMin + i * logStep));
      dbs.push(0);
      maxDbs.push(0);
      avgDbs.push(0);
      tfDbs.push(0);
    }
    return [freqs, dbs, maxDbs, avgDbs, tfDbs] as uPlot.AlignedData;
  }

  function parseColorToRgba(color: string, alpha: number): string {
    if (!color) return `rgba(0, 85, 255, ${alpha})`;
    if (color.startsWith('#')) {
      let hex = color.slice(1);
      if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((c) => c + c).join('');
      if (hex.length >= 6) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        let baseAlpha = 1;
        if (hex.length >= 8) {
          baseAlpha = parseInt(hex.slice(6, 8), 16) / 255;
        }
        return `rgba(${r}, ${g}, ${b}, ${(alpha * baseAlpha).toFixed(3)})`;
      }
    }
    if (color.startsWith('rgb')) {
      const match = color.match(/[\d.]+/g);
      if (match && match.length >= 3) {
        const baseAlpha = match[3] !== undefined ? parseFloat(match[3]) : 1;
        return `rgba(${match[0]}, ${match[1]}, ${match[2]}, ${(alpha * baseAlpha).toFixed(3)})`;
      }
    }
    if (color.includes('oklab') || color.includes('oklch')) {
      if (color.includes('-0.136') || color.includes('250')) return `rgba(75, 131, 219, ${alpha})`;
      if (color.includes('-0.100') || color.includes('245')) return `rgba(118, 163, 229, ${alpha})`;
      if (color.includes('-0.056') || color.includes('240')) return `rgba(167, 195, 239, ${alpha})`;
      if (color.includes('-0.120') || color.includes('185')) return `rgba(62, 201, 167, ${alpha})`;
      if (color.includes('0.135') || color.includes('75')) return `rgba(229, 168, 75, ${alpha})`;
      if (color.includes('0.169') || color.includes('20')) return `rgba(224, 93, 109, ${alpha})`;
      // Legacy fallback
      if (color.includes('264')) return `rgba(75, 131, 219, ${alpha})`;
      if (color.includes('281')) return `rgba(118, 163, 229, ${alpha})`;
      if (color.includes('284')) return `rgba(167, 195, 239, ${alpha})`;
    }
    return `rgba(75, 131, 219, ${alpha})`;
  }

  function initRtaPlot() {
    if (!chartContainerRef) return;

    const rect = chartContainerRef.getBoundingClientRect();
    const width = Math.max(250, rect.width || 720);
    const height = Math.max(170, rect.height || 260);
    const isCompact = width < 480;

    const isLight = props.theme === 'light';
    const axisColor = isLight ? '#2E2F33' : '#E8E8E6';
    const gridColor = isLight ? '#EAEAE8' : '#222326';
    const tickColor = isLight ? '#BEBEB8' : '#3C3E45';
    const splineFactory = rtaUseSpline() && uPlot.paths.spline ? uPlot.paths.spline() : undefined;

    const xSplits = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

    const opts: uPlot.Options = {
      width,
      height,
      padding: isCompact ? [12, 8, 0, 6] : [20, 15, 0, 15],
      pxAlign: 0, // Enable subpixel antialiasing
      cursor: {
        drag: { x: false, y: false },
        points: { size: 6, width: 2 }
      },
      legend: {
        show: false
      },
      scales: {
        x: {
          distr: 3, // Logarithmic
          log: 10,
          min: 20,
          max: 20000
        },
        y: {
          auto: false,
          min: 0,
          max: 120
        }
      },
      axes: [
        {
          scale: 'x',
          space: isCompact ? 20 : 25,
          splits: xSplits,
          filter: (self, splits) => {
            const w = self.bbox?.width || width;
            if (w < 420) {
              return splits.map((v) => ([20, 100, 500, 1000, 5000, 20000].includes(v) ? v : null));
            }
            return splits;
          },
          values: (_u, splits) =>
            splits.map((v) => (v == null ? '' : v >= 1000 ? `${v / 1000}k` : `${v}`)),
          stroke: axisColor,
          grid: { stroke: gridColor, width: 1 },
          ticks: { stroke: tickColor, width: 1 }
        },
        {
          scale: 'y',
          space: isCompact ? 24 : 30,
          size: isCompact ? 38 : 52,
          values: (_u, splits) =>
            splits == null ? [] : splits.map((v) => (v == null ? '' : isCompact ? `${Math.round(v)}` : `${Math.round(v)} dB`)),
          stroke: axisColor,
          grid: { stroke: gridColor, width: 1 },
          ticks: { stroke: tickColor, width: 1 }
        }
      ],
      series: [
        {
          label: 'Frecuencia',
          value: (_u, val) => (val !== null ? `${Math.round(val)} Hz` : '--')
        },
        {
          label: 'RTA en Vivo',
          stroke: currentRtaColor(),
          width: 1.8,
          pxAlign: 0,
          cap: 'round',
          paths: splineFactory,
          fill: (u) => {
            const ctx = u.ctx;
            const color = currentRtaColor();
            const top = u.bbox.top;
            const bottom = u.bbox.top + u.bbox.height;
            const grad = ctx.createLinearGradient(0, top, 0, bottom);
            grad.addColorStop(0, parseColorToRgba(color, isLight ? 0.22 : 0.28));
            grad.addColorStop(0.5, parseColorToRgba(color, isLight ? 0.14 : 0.18));
            grad.addColorStop(1, parseColorToRgba(color, isLight ? 0.05 : 0.08));
            return grad;
          },
          fillTo: (u) => u.scales.y?.min ?? 0,
          points: { show: false },
          value: (_u, val) => (val !== null ? `${val.toFixed(1)} dB SPL` : '--')
        },
        {
          label: 'Umbral Máximo',
          stroke: currentMaxHoldColor(),
          width: 1.6,
          pxAlign: 0,
          cap: 'round',
          paths: splineFactory,
          points: { show: false },
          value: (_u, val) => (val !== null ? `${val.toFixed(1)} dB SPL` : '--')
        },
        {
          label: 'Promedio',
          stroke: currentAverageColor(),
          width: 1.6,
          pxAlign: 0,
          cap: 'round',
          paths: splineFactory,
          points: { show: false },
          value: (_u, val) => (val !== null ? `${val.toFixed(1)} dB SPL` : '--')
        },
        {
          label: 'Función de Transferencia',
          stroke: '#9b51e0', // Distinct purple color for Transfer Function
          width: 2.0,
          pxAlign: 0,
          cap: 'round',
          paths: splineFactory,
          points: { show: false },
          value: (_u, val) => (val !== null ? `${val.toFixed(1)} dB (T.F.)` : '--')
        }
      ],
      hooks: {
        drawClear: [
          (u) => {
            u.ctx.imageSmoothingEnabled = true;
            u.ctx.imageSmoothingQuality = 'high';
            u.ctx.lineCap = 'round';
            u.ctx.lineJoin = 'round';
          }
        ],
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            if (idx !== null && idx !== undefined && idx >= 0) {
              const f = u.data[0][idx];
              const db = u.data[1]?.[idx];
              const max = u.data[2]?.[idx];
              const avg = u.data[3]?.[idx];
              const tf = u.data[4]?.[idx];
              if (f !== null && f !== undefined) setHoverFreq(f);
              if (db !== null && db !== undefined) setHoverDb(db);
              if (max !== null && max !== undefined) setHoverMaxDb(max);
              if (avg !== null && avg !== undefined) setHoverAvgDb(avg);
              if (tf !== null && tf !== undefined) setHoverTfDb(tf);
            }
          }
        ],
        draw: [
          () => {
            fpsMeter.tick();
          }
        ]
      }
    };

    const previousData = uplotInstance?.data;
    if (uplotInstance) {
      uplotInstance.destroy();
      uplotInstance = null;
    }
    chartContainerRef.innerHTML = '';
    uplotInstance = new uPlot(opts, previousData || getEmptyPlotData(), chartContainerRef);

    if (resizeObserver) {
      resizeObserver.disconnect();
    }
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (uplotInstance && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          uplotInstance.setSize({
            width: Math.floor(entry.contentRect.width),
            height: Math.floor(entry.contentRect.height)
          });
        }
      }
    });
    resizeObserver.observe(chartContainerRef);
  }

  onMount(() => {
    initRtaPlot();

    // Capacitive / Touch Screen Cursor Tracking on RTA Plot
    const updateCursorFromTouch = (e: TouchEvent) => {
      if (!uplotInstance || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const rect = uplotInstance.over.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const left = Math.max(0, Math.min(rect.width, touch.clientX - rect.left));
      const top = Math.max(0, Math.min(rect.height, touch.clientY - rect.top));
      uplotInstance.setCursor({ left, top });
    };

    const handleTouchStart = (e: TouchEvent) => {
      updateCursorFromTouch(e);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        e.preventDefault();
        updateCursorFromTouch(e);
      }
    };

    chartContainerRef.addEventListener('touchstart', handleTouchStart, { passive: true });
    chartContainerRef.addEventListener('touchmove', handleTouchMove, { passive: false });

    onCleanup(() => {
      chartContainerRef?.removeEventListener('touchstart', handleTouchStart);
      chartContainerRef?.removeEventListener('touchmove', handleTouchMove);
    });

    if (props.ref) {
      props.ref({
        updateData: (freqs: number[], dbs: number[], maxHoldDbs?: number[], averageDbs?: number[], tfDbs?: number[]) => {
          if (uplotInstance && freqs.length > 0 && dbs.length > 0) {
            uplotInstance.setData([
              freqs,
              dbs,
              maxHoldDbs && maxHoldDbs.length > 0 ? maxHoldDbs : dbs,
              averageDbs && averageDbs.length > 0 ? averageDbs : dbs,
              tfDbs && tfDbs.length > 0 ? tfDbs : dbs // Add TF data as 4th series
            ]);
          }
        },
        clear: () => {
          fpsMeter.reset();
          setHoverDb(null);
          setHoverMaxDb(null);
          setHoverAvgDb(null);
          setHoverTfDb(null);
          if (uplotInstance) {
            uplotInstance.setData(getEmptyPlotData());
          }
        }
      });
    }
  });

  // Re-render uPlot on theme toggle
  let lastTheme = props.theme;
  createEffect(() => {
    const currentTheme = props.theme;
    if (chartContainerRef && currentTheme !== lastTheme) {
      lastTheme = currentTheme;
      initRtaPlot();
    }
  });

  onCleanup(() => {
    fpsMeter.destroy();
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (uplotInstance) {
      uplotInstance.destroy();
      uplotInstance = null;
    }
  });

  // Calculate live input level meter percentage (0% at -80 dBFS, 100% at 0 dBFS)
  const meterPercent = () => {
    const db = props.livePeakDb;
    if (!props.isRecording || db <= -80) return 0;
    return Math.max(0, Math.min(100, ((db + 80) / 80) * 100));
  };

  const meterColor = () => {
    const db = props.livePeakDb;
    if (db > -3) return '#FF0000'; // Clipping (Crimson Red)
    if (db > -12) return '#FFAA00'; // Strong signal (Yellow/Orange)
    return currentRtaColor();
  };

  // Reactive listener to update uPlot when RTA, Max Hold, Average curve colors or Spline mode change
  createEffect(() => {
    void currentRtaColor();
    void currentMaxHoldColor();
    void currentAverageColor();
    void rtaUseSpline();
    if (uplotInstance) {
      initRtaPlot();
    }
  });

  // Synchronize temporal smoothing and band integration flags to analyzer
  createEffect(() => {
    micAnalyzer.setTemporalSmoothing(temporalSmoothing());
  });
  createEffect(() => {
    micAnalyzer.setBandIntegration(bandIntegration());
  });

  return (
    <div class="flex flex-col w-full">
      {/* Top Crosshair Readout Bar & Real FPS Counter */}
      <div class="px-3 sm:px-5 py-2 bg-[var(--bg-surface)] border-b border-[var(--border-default)] flex items-center justify-between text-xs font-mono flex-wrap gap-2">
        <div class="flex items-center gap-3 flex-wrap">
          <div class="flex items-center gap-2">
            <span class="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">
              Cursor:
            </span>
            <span class="px-2 py-0.5 bg-[var(--bg-card)] rounded border border-[var(--border-contrast)] font-bold text-[var(--text-pure)] shadow-2xs">
              {Math.round(hoverFreq())} Hz
            </span>
          </div>

          {/* Badges for Instant, Max Hold, and Average with Active Highlight & Color Pickers */}
          <div class="flex items-center gap-1.5 flex-wrap">
            {/* Live / Instantaneous */}
            <span
              class={`px-2 py-0.5 rounded border text-[11px] font-bold transition-all flex items-center gap-1.5 ${props.captureMode === 'instant'
                ? 'bg-[var(--accent-blue-badge-bg)] text-[var(--accent-blue-badge-text)] border-[var(--accent-blue)] shadow-xs ring-1 ring-[var(--accent-blue)]'
                : 'bg-[var(--bg-card)] text-[var(--text-main)] border-[var(--border-contrast)]'
                }`}
              title="Respuesta en ese instante puntual"
            >
              <ColorPickerPopover
                color={currentRtaColor()}
                onChange={(c) => setRtaCurveColor(c)}
                title="Color Curva en Vivo"
                size="sm"
              />
              <span>Instante: {hoverDb() !== null ? `${hoverDb()!.toFixed(1)} dB` : '-- dB'}</span>
            </span>

            {/* Max Hold / Umbral Máximo */}
            <span
              class={`px-2 py-0.5 rounded border text-[11px] font-bold transition-all flex items-center gap-1.5 ${props.captureMode === 'peak'
                ? 'border-current shadow-xs ring-1 ring-current'
                : 'bg-[var(--bg-card)] text-[var(--text-main)] border-[var(--border-contrast)]'
                }`}
              style={
                props.captureMode === 'peak'
                  ? {
                    'border-color': currentMaxHoldColor(),
                    color: currentMaxHoldColor(),
                    'background-color': parseColorToRgba(currentMaxHoldColor(), 0.15)
                  }
                  : {}
              }
              title="Umbral máximo acumulado (Peak Hold)"
            >
              <ColorPickerPopover
                color={currentMaxHoldColor()}
                onChange={(c) => setMaxHoldCurveColor(c)}
                title="Color Umbral Máximo"
                size="sm"
              />
              <span>Máx: {hoverMaxDb() !== null ? `${hoverMaxDb()!.toFixed(1)} dB` : '-- dB'}</span>
            </span>

            {/* Average / Promedio */}
            <span
              class={`px-2 py-0.5 rounded border text-[11px] font-bold transition-all flex items-center gap-1.5 ${props.captureMode === 'average'
                ? 'border-current shadow-xs ring-1 ring-current'
                : 'bg-[var(--bg-card)] text-[var(--text-main)] border-[var(--border-contrast)]'
                }`}
              style={
                props.captureMode === 'average'
                  ? {
                    'border-color': currentAverageColor(),
                    color: currentAverageColor(),
                    'background-color': parseColorToRgba(currentAverageColor(), 0.15)
                  }
                  : {}
              }
              title="Promedio acústico energético acumulado (Leq)"
            >
              <ColorPickerPopover
                color={currentAverageColor()}
                onChange={(c) => setAverageCurveColor(c)}
                title="Color Curva Promedio"
                size="sm"
              />
              <span>Prom: {hoverAvgDb() !== null ? `${hoverAvgDb()!.toFixed(1)} dB` : '-- dB'}</span>
            </span>
            {/* Transfer Function Display */}
            <span
              class="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[var(--text-main)] font-semibold transition-colors"
              title="Medición de la Función de Transferencia"
            >
              <div class="w-2.5 h-2.5 rounded-full" style={{ 'background-color': '#9b51e0' }} />
              <span>TF: {hoverTfDb() !== null ? `${hoverTfDb()!.toFixed(1)} dB` : '-- dB'}</span>
            </span>

            {/* Background Noise Cancellation Status Badge */}
            <Show when={micAnalyzer.noiseCancellationEnabled && micAnalyzer.hasNoiseFloorProfile()}>
              <span
                class="flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#002b18] text-[#00ff88] border border-[#00cc66]/40 font-semibold text-[10px] transition-colors"
                title={`Ruido de fondo ambiental anulado (~${micAnalyzer.getNoiseFloorAverageDb()} dB SPL)`}
              >
                <span class="w-1.5 h-1.5 rounded-full bg-[#00ff88] animate-pulse" />
                <span>Ruido Anulado</span>
              </span>
            </Show>
          </div>

          {/* RTA & Curves Color Selector Controls */}
          <div class="flex items-center gap-2 px-2.5 py-0.5 bg-[var(--bg-card)] rounded-lg border border-[var(--border-contrast)] font-mono text-[10px] shadow-2xs">
            <span class="text-[var(--text-muted)] font-semibold flex items-center gap-1">
              <Palette size={12} class="text-[var(--text-muted)]" />
              <span>Colores:</span>
            </span>

            {/* Live Color */}
            <div class="flex items-center gap-1" title="Color de curva en vivo (Instante)">
              <ColorPickerPopover
                color={currentRtaColor()}
                onChange={(c) => setRtaCurveColor(c)}
                title="Color Curva en Vivo"
                size="sm"
              />
              <span class="text-[var(--text-main)] font-semibold">Live</span>
            </div>

            <span class="text-[var(--border-contrast)]">|</span>

            {/* Max Hold Color */}
            <div class="flex items-center gap-1" title="Color de curva umbral máximo (Peak Hold)">
              <ColorPickerPopover
                color={currentMaxHoldColor()}
                onChange={(c) => setMaxHoldCurveColor(c)}
                title="Color Umbral Máximo"
                size="sm"
              />
              <span class="text-[var(--text-main)] font-semibold">Máx</span>
            </div>

            <span class="text-[var(--border-contrast)]">|</span>

            {/* Average Color */}
            <div class="flex items-center gap-1" title="Color de curva promedio energético (Leq)">
              <ColorPickerPopover
                color={currentAverageColor()}
                onChange={(c) => setAverageCurveColor(c)}
                title="Color Curva Promedio"
                size="sm"
              />
              <span class="text-[var(--text-main)] font-semibold">Prom</span>
            </div>
          </div>

          {/* Suavizados Opcionales (3 Niveles) */}
          <div class="flex items-center gap-1 px-2 py-0.5 bg-[var(--bg-card)] rounded-lg border border-[var(--border-contrast)] font-mono text-[10px] shadow-2xs">
            <span class="text-[var(--text-muted)] font-semibold flex items-center gap-1" title="Configuración de los 3 niveles de suavizado acústico y visual">
              <Sliders size={11} class="text-[var(--text-muted)]" />
              <span>Suavizado:</span>
            </span>

            {/* 1. Spline Visual */}
            <button
              type="button"
              onClick={() => frActions.setMicSetting('rtaUseSpline', !rtaUseSpline())}
              class={`px-1.5 py-0.5 rounded font-bold transition-all cursor-pointer ${
                rtaUseSpline()
                  ? 'bg-[var(--accent-blue-badge-bg)] text-[var(--accent-blue-badge-text)] border border-[var(--accent-blue-badge-border)]'
                  : 'bg-[var(--bg-panel)] text-[var(--text-dim)] border border-[var(--border-contrast)] hover:text-[var(--text-main)]'
              }`}
              title="1. Suavizado Visual Spline: curvas redondeadas Bézier (ON) vs líneas poligonales rectas punto a punto (OFF)"
            >
              Spline {rtaUseSpline() ? 'ON' : 'OFF'}
            </button>

            <span class="text-[var(--border-contrast)]">|</span>

            {/* 2. Suavizado Temporal */}
            <button
              type="button"
              onClick={() => frActions.setMicSetting('temporalSmoothing', !temporalSmoothing())}
              class={`px-1.5 py-0.5 rounded font-bold transition-all cursor-pointer ${
                temporalSmoothing()
                  ? 'bg-[var(--accent-blue-badge-bg)] text-[var(--accent-blue-badge-text)] border border-[var(--accent-blue-badge-border)]'
                  : 'bg-[var(--bg-panel)] text-[var(--text-dim)] border border-[var(--border-contrast)] hover:text-[var(--text-main)]'
              }`}
              title="2. Suavizado Temporal EMA: amortigua el parpadeo de fotogramas (ON) vs respuesta instantánea cruda 1:1 (OFF)"
            >
              Temporal {temporalSmoothing() ? 'ON' : 'OFF'}
            </button>

            <span class="text-[var(--border-contrast)]">|</span>

            {/* 3. Integración de Bandas */}
            <button
              type="button"
              onClick={() => frActions.setMicSetting('bandIntegration', !bandIntegration())}
              class={`px-1.5 py-0.5 rounded font-bold transition-all cursor-pointer ${
                bandIntegration()
                  ? 'bg-[var(--accent-blue-badge-bg)] text-[var(--accent-blue-badge-text)] border border-[var(--accent-blue-badge-border)]'
                  : 'bg-[var(--bg-panel)] text-[var(--text-dim)] border border-[var(--border-contrast)] hover:text-[var(--text-main)]'
              }`}
              title="3. Integración Espectral: energía agrupada en 240 bandas logarítmicas ~1/24 oct (RTA) vs muestreo directo de bins crudos FFT (Raw)"
            >
              Bandas {bandIntegration() ? 'RTA' : 'Raw'}
            </button>
          </div>
        </div>

        {/* Real-time FPS indicator */}
        <div class="flex items-center gap-2 font-mono">
          <span
            class="w-2 h-2 rounded-full transition-colors duration-200"
            style={{
              'background-color': !props.isRecording
                ? '#777777'
                : realFps() >= 50
                  ? '#00FF88'
                  : realFps() >= 30
                    ? '#FFAA00'
                    : '#FF0000'
            }}
          />
          <span class="text-[10px] text-[var(--text-muted)] font-bold">
            {props.isRecording
              ? `${realFps().toFixed(1)} FPS uPlot RTA`
              : 'EN ESPERA (0.0 FPS)'}
          </span>
        </div>
      </div>

      {/* uPlot Chart Canvas Container */}
      <div class="p-2 sm:p-4 bg-[var(--chart-bg)] flex flex-col items-center border-b border-[var(--border-default)]">
        <div class="relative w-full h-max overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--chart-bg)]">
          <div ref={chartContainerRef} class="w-full h-[210px] sm:h-[280px] md:h-[340px] xl:h-[420px] touch-none" />
          <Show when={!props.isRecording}>
            <div class="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[1px] pointer-events-none p-3 text-center">
              <Mic size={28} class="text-[var(--text-dim)] mb-1.5 animate-pulse" />
              <span class="text-xs font-semibold text-[var(--text-main)]">Micrófono en espera</span>
              <span class="text-[10px] text-[var(--text-dim)] mt-0.5">
                Toca o haz clic en "Iniciar Micrófono" para comenzar a medir
              </span>
            </div>
          </Show>
        </div>
      </div>

      {/* Live VU Meter Bar */}
      <div class="px-3 sm:px-5 py-2 sm:py-2.5 bg-[var(--bg-surface)] border-b border-[var(--border-default)] flex flex-wrap items-center justify-between gap-2 sm:gap-4">
        <div class="flex items-center gap-2 shrink-0">
          <Activity
            size={14}
            class={props.isRecording ? 'text-[var(--accent-blue)] animate-pulse' : 'text-[var(--text-dim)]'}
          />
          <span class="text-[11px] font-semibold text-[var(--text-main)]">Nivel de Entrada (VU):</span>
        </div>

        <div class="flex-1 min-w-[160px] max-w-md flex items-center gap-2 sm:gap-3">
          <div class="flex-1 h-3 bg-[var(--bg-panel)] rounded-full border border-[var(--border-contrast)] overflow-hidden p-0.5">
            <div
              class="h-full rounded-full transition-all duration-75"
              style={{
                width: `${meterPercent()}%`,
                'background-color': meterColor()
              }}
            />
          </div>
          <span class="font-mono text-[11px] text-[var(--text-main)] font-bold w-16 text-right shrink-0">
            {props.isRecording && props.livePeakDb > -100
              ? `${Math.round(props.livePeakDb)} dBFS`
              : '-inf dB'}
          </span>
        </div>

        <div class="text-[10px] font-mono px-2 py-0.5 rounded border border-[var(--border-contrast)] bg-[var(--bg-panel)] shrink-0">
          {props.isRecording ? (
            props.livePeakDb > -100 ? (
              <span class="text-[#00FF88] font-bold">SEÑAL ACTIVA</span>
            ) : (
              <span class="text-[var(--text-dim)]">SILENCIO</span>
            )
          ) : (
            <span class="text-[var(--text-dim)]">INACTIVO</span>
          )}
        </div>
      </div>
    </div>
  );
}
