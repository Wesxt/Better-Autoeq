import { createSignal, onMount, onCleanup, createEffect, Show, Index } from 'solid-js';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import {
  state,
  targetCurve,
  equalizationCurve,
  equalizedResultCurve,
  activeEqualizationCurve,
  frActions
} from '../../store/frStore';
import type { SmoothingType } from '../../lib/autoeq/smoothing';
import { STANDARD_FREQUENCIES } from '../../lib/autoeq/constants';
import { normalizeAt1kHz, calculateAlignmentOffset } from '../../lib/autoeq/targets';
import { RotateCcw, Spline } from 'lucide-solid';
import { FpsMeter } from '../../lib/chart/fpsMeter';
import { ColorPickerPopover } from '../Common/ColorPickerPopover';

export function FrequencyPlot() {
  let chartContainerRef!: HTMLDivElement;
  let uplotInstance: uPlot | null = null;

  // Crosshair hover coordinates - persistent so info is always showing smoothly
  const defaultIdx = STANDARD_FREQUENCIES.indexOf(1000) !== -1 ? STANDARD_FREQUENCIES.indexOf(1000) : Math.floor(STANDARD_FREQUENCIES.length / 2);
  let currentIdx = defaultIdx;
  let zoomMin = 20;
  let zoomMax = 20000;
  const [hoverFreq, setHoverFreq] = createSignal<number>(STANDARD_FREQUENCIES[defaultIdx] || 1000);
  const [hoverValues, setHoverValues] = createSignal<{ name: string; color: string; val: number; }[]>([]);
  const [chartFps, setChartFps] = createSignal<number>(0);
  const fpsMeter = new FpsMeter((fps) => setChartFps(fps), 250);

  function getCurveColor(s: uPlot.Series, sIdx: number): string {
    const isLight = state.theme === 'light';

    // 1. Direct cached stroke from uPlot instance if available
    if (typeof (s as any)._stroke === 'string' && (s as any)._stroke) {
      return (s as any)._stroke;
    }

    // 2. Evaluated stroke function
    if (typeof s.stroke === 'function') {
      try {
        const c = (s.stroke as any)(uplotInstance, sIdx);
        if (typeof c === 'string' && c) return c;
      } catch { }
    }

    // 3. String stroke
    if (typeof s.stroke === 'string' && s.stroke) {
      return s.stroke;
    }

    // 4. Fallback directly to user measurement curve color from store
    if (sIdx >= 1 && sIdx <= state.curves.length) {
      const curve = state.curves[sIdx - 1];
      if (curve) {
        if (isLight && (curve.color.toLowerCase() === '#ffffff' || curve.color.toLowerCase() === '#fff')) {
          return '#181818';
        }
        if (isLight && (curve.color.includes('-0.136') || curve.color.includes('250'))) {
          return '#4D8EEB';
        }
        return curve.color;
      }
    }

    // 5. Fallback for built-in overlay series
    if (s.label === 'Target Curve') return state.overlayColors.target || (isLight ? '#000000' : '#ffffff');
    if (s.label === 'AutoEq Curve') return state.overlayColors.autoeq || (isLight ? '#4D8EEB' : '#4B83DB');
    if (s.label === 'Equalized Result') return state.overlayColors.equalized || (isLight ? '#008844' : '#00ff88');
    if (typeof s.label === 'string' && s.label.includes('Delta')) return state.overlayColors.delta || '#FF0000';

    return isLight ? '#4D8EEB' : '#4B83DB';
  }

  function updateReadout(idx: number) {
    if (idx < 0 || idx >= STANDARD_FREQUENCIES.length) return;
    const f = STANDARD_FREQUENCIES[idx];
    currentIdx = idx;
    setHoverFreq(f);

    if (!uplotInstance) return;

    const vals: { name: string; color: string; val: number; }[] = [];
    uplotInstance.series.forEach((s, sIdx) => {
      if (sIdx === 0 || !s.show) return;
      const v = uplotInstance!.data[sIdx]?.[idx];
      if (v !== null && v !== undefined) {
        const strokeColor = getCurveColor(s, sIdx);
        const labelStr = typeof s.label === 'string' ? s.label : `Series ${sIdx}`;
        vals.push({
          name: labelStr,
          color: strokeColor,
          val: v
        });
      }
    });
    setHoverValues(vals);
  }

  // Toggle overlay curves & visualization modes connected to persisted store
  const showTarget = () => state.plotSettings.showTarget;
  const setShowTarget = (val: boolean) => frActions.setPlotSetting('showTarget', val);
  const showEqCurve = () => state.plotSettings.showEqCurve;
  const setShowEqCurve = (val: boolean) => frActions.setPlotSetting('showEqCurve', val);
  const showEqualized = () => state.plotSettings.showEqualized;
  const setShowEqualized = (val: boolean) => frActions.setPlotSetting('showEqualized', val);
  const showGradient = () => state.plotSettings.showGradient;
  const setShowGradient = (val: boolean) => frActions.setPlotSetting('showGradient', val);
  const useSpline = () => state.plotSettings.useSpline;
  const setUseSpline = (val: boolean) => frActions.setPlotSetting('useSpline', val);

  // Audio frequency axis splits: standard 1, 2, 3, 5, 7 progression across decades
  const xSplits = [20, 30, 50, 70, 100, 200, 300, 500, 700, 1000, 2000, 3000, 5000, 7000, 10000, 20000];

  function formatFreq(val: number): string {
    if (val == null) return '';
    if (val >= 1000) {
      return (val / 1000).toFixed(val % 1000 === 0 ? 0 : 1) + 'k';
    }
    return Math.round(val).toString();
  }

  function parseColorToRgba(color: string, alpha: number): string {
    if (!color) return `rgba(0, 85, 255, ${alpha})`;
    if (color.startsWith('#')) {
      let hex = color.slice(1);
      if (hex.length === 3 || hex.length === 4) hex = hex.split('').map(c => c + c).join('');
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

  function getPlotData(): uPlot.AlignedData {
    const xVals = STANDARD_FREQUENCIES;
    const data: (number | null)[][] = [xVals];

    // 1. Measurement curves from state
    state.curves.forEach((curve) => {
      if (!curve.visible) {
        data.push(new Array(xVals.length).fill(null));
        return;
      }
      let gains = curve.smoothedGains.map(g => g + curve.offsetDb);
      if (state.normalizeAt1k) {
        gains = normalizeAt1kHz(xVals, gains, 0);
      }
      data.push(gains);
    });

    // 2. Target curve
    if (showTarget() && targetCurve().length > 0) {
      let tGains = [...targetCurve()];
      if (state.normalizeAt1k) {
        tGains = normalizeAt1kHz(xVals, tGains, 0);
      } else {
        // Offset target to match active curve's level centered in midrange
        const activeCurve = state.curves.find(c => c.id === state.activeReferenceCurveId);
        if (activeCurve) {
          const offset = calculateAlignmentOffset(xVals, activeCurve.smoothedGains, tGains);
          tGains = tGains.map(g => g + offset);
        }
      }
      data.push(tGains);
    } else {
      data.push(new Array(xVals.length).fill(null));
    }

    // 3. Equalization curve (active EQ method: PEQ, FIR, GraphicEQ, or Ideal)
    const activeEq = activeEqualizationCurve();
    if (showEqCurve() && activeEq.length > 0) {
      data.push([...activeEq]);
    } else {
      data.push(new Array(xVals.length).fill(null));
    }

    // 4. Equalized result curve
    if (showEqualized() && equalizedResultCurve().length > 0) {
      let eqResult = [...equalizedResultCurve()];
      if (state.normalizeAt1k) {
        eqResult = normalizeAt1kHz(xVals, eqResult, 0);
      }
      data.push(eqResult);
    } else {
      data.push(new Array(xVals.length).fill(null));
    }

    // 5. Delta Curve (A - B) if enabled
    if (state.showDelta && state.curves.length >= 2) {
      const curveA = state.curves.find(c => c.id === state.activeReferenceCurveId);
      const curveB = state.curves.find(c => c.id === state.deltaSecondaryCurveId) || state.curves[1];
      if (curveA && curveB) {
        const delta = xVals.map((_, i) => {
          return Math.round((curveA.smoothedGains[i] - curveB.smoothedGains[i]) * 100) / 100;
        });
        data.push(delta);
      } else {
        data.push(new Array(xVals.length).fill(null));
      }
    } else {
      data.push(new Array(xVals.length).fill(null));
    }

    return data as uPlot.AlignedData;
  }

  const splineFactory = uPlot.paths.spline ? uPlot.paths.spline() : undefined;
  const getSplinePath = () => {
    if (!useSpline() || !splineFactory) return undefined;
    return (u: uPlot, seriesIdx: number, idx0: number, idx1: number) => {
      const dataY = u.data[seriesIdx];
      if (!dataY || dataY.length === 0) return null;
      let nonNullCount = 0;
      for (let i = idx0; i <= idx1; i++) {
        if (dataY[i] != null) {
          nonNullCount++;
          if (nonNullCount >= 2) break;
        }
      }
      if (nonNullCount < 2) return null;
      return splineFactory(u, seriesIdx, idx0, idx1);
    };
  };

  function makeGradientFill(color: string, intensity = 1): uPlot.Series.Fill | undefined {
    if (!showGradient()) return undefined;
    const isLight = state.theme === 'light';
    return (u) => {
      const ctx = u.ctx;
      const top = u.bbox.top;
      const bottom = u.bbox.top + u.bbox.height;
      const grad = ctx.createLinearGradient(0, top, 0, bottom);
      grad.addColorStop(0, parseColorToRgba(color, (isLight ? 0.22 : 0.28) * intensity));
      grad.addColorStop(0.5, parseColorToRgba(color, (isLight ? 0.14 : 0.18) * intensity));
      grad.addColorStop(1, parseColorToRgba(color, (isLight ? 0.05 : 0.08) * intensity));
      return grad;
    };
  }

  function getSeriesOptions(): uPlot.Series[] {
    const isLight = state.theme === 'light';
    const series: uPlot.Series[] = [
      {
        label: 'Frequency',
        value: (_u, val) => (val !== null ? `${Math.round(val)} Hz` : '--')
      }
    ];

    // 1. Measurement curves
    state.curves.forEach((curve) => {
      const isRef = curve.id === state.activeReferenceCurveId;
      // In light mode, pure white curves adapt to dark gray for clear contrast
      let strokeColor = curve.color;
      if (isLight && (strokeColor.toLowerCase() === '#ffffff' || strokeColor.toLowerCase() === '#fff')) {
        strokeColor = '#181818';
      }
      if (isLight && (strokeColor.includes('-0.136') || strokeColor.includes('250'))) {
        strokeColor = '#4D8EEB';
      }

      const fillVal = makeGradientFill(strokeColor, isRef ? 1 : 0.7);

      series.push({
        label: curve.name,
        show: curve.visible,
        stroke: strokeColor,
        width: isRef ? 2.2 : 1.6,
        fill: fillVal,
        fillTo: (u) => u.scales.y?.min ?? -10,
        pxAlign: 0,
        cap: 'round',
        paths: getSplinePath(),
        points: { show: false },
        value: (_u, val) => (val !== null ? `${val.toFixed(1)} dB` : '--')
      });
    });

    // 2. Target curve
    const targetStroke = state.overlayColors.target || (isLight ? '#000000' : '#ffffff');
    series.push({
      label: 'Target Curve',
      show: showTarget(),
      stroke: targetStroke,
      width: 2,
      dash: [5, 4],
      fill: makeGradientFill(targetStroke, 0.5),
      fillTo: (u) => u.scales.y?.min ?? -10,
      pxAlign: 0,
      cap: 'round',
      paths: getSplinePath(),
      points: { show: false },
      value: (_u, val) => (val !== null ? `${val.toFixed(1)} dB` : '--')
    });

    // 3. Equalization curve
    const autoeqStroke = state.overlayColors.autoeq || (isLight ? '#4D8EEB' : '#4B83DB');
    const methodNames: Record<string, string> = {
      peq: 'AutoEq (PEQ)',
      fir: 'AutoEq (FIR Convolución)',
      graphiceq: 'AutoEq (Gráfico)',
      ideal: 'AutoEq (Inversión Ideal)'
    };
    series.push({
      label: methodNames[state.selectedEqMethod] || 'AutoEq Curve',
      show: showEqCurve(),
      stroke: autoeqStroke,
      width: 2.2,
      fill: makeGradientFill(autoeqStroke, 0.8),
      fillTo: (u) => u.scales.y?.min ?? -10,
      pxAlign: 0,
      cap: 'round',
      paths: getSplinePath(),
      points: { show: false },
      value: (_u, val) => (val !== null ? `${val.toFixed(1)} dB` : '--')
    });

    // 4. Equalized result curve
    const eqResultStroke = state.overlayColors.equalized || (isLight ? '#008844' : '#00ff88');
    series.push({
      label: 'Equalized Result',
      show: showEqualized(),
      stroke: eqResultStroke,
      width: 5,
      fill: makeGradientFill(eqResultStroke, 0.8),
      fillTo: (u) => u.scales.y?.min ?? -10,
      pxAlign: 0,
      cap: 'round',
      paths: getSplinePath(),
      points: { show: false },
      value: (_u, val) => (val !== null ? `${val.toFixed(1)} dB` : '--')
    });

    // 5. Delta Curve
    const deltaStroke = state.overlayColors.delta || '#FF0000';
    const deltaFillVal = state.showDelta ? makeGradientFill(deltaStroke, 0.8) : undefined;

    series.push({
      label: 'Delta (Diff)',
      show: state.showDelta,
      stroke: deltaStroke,
      width: 2.0,
      fill: deltaFillVal,
      fillTo: 0,
      pxAlign: 0,
      cap: 'round',
      paths: getSplinePath(),
      points: { show: false },
      value: (_u, val) => (val !== null ? `${val.toFixed(1)} dB` : '--')
    });

    return series;
  }

  function initChart() {
    if (!chartContainerRef) return;

    const rect = chartContainerRef.getBoundingClientRect();
    const width = Math.max(260, rect.width || 800);
    const height = Math.max(170, rect.height || 450);
    const isCompact = width < 520;

    const isLight = state.theme === 'light';
    const axisColor = isLight ? '#2E2F33' : '#E8E8E6';
    const gridColor = isLight ? '#EAEAE8' : '#222326';
    const tickColor = isLight ? '#BEBEB8' : '#3C3E45';

    const opts: uPlot.Options = {
      width,
      height,
      padding: isCompact ? [6, 10, 4, 4] : [8, 16, 8, 14], // [top, right, bottom, left]
      pxAlign: 0, // CRITICAL: disables integer pixel rounding Math.round(), enabling subpixel antialiasing and eliminating jagged 'dientes de sierra'
      cursor: {
        drag: { x: true, y: false, setScale: true }, // Zoom ONLY on the frequency X axis
        points: { size: 6, width: 2 }
      },
      legend: {
        show: false // We use our own high-contrast custom readout bar
      },
      scales: {
        x: {
          distr: 3, // Logarithmic
          log: 10,
          min: 20,
          max: 20000
        },
        y: {
          auto: true,
          range: (_u, min, max) => {
            const pad = 5;
            return [Math.floor((min - pad) / 5) * 5, Math.ceil((max + pad) / 5) * 5];
          }
        }
      },
      axes: [
        {
          scale: 'x',
          space: isCompact ? 20 : 25,
          splits: xSplits,
          filter: (self, splits) => {
            const w = self.bbox?.width || self.width || 800;
            if (w < 380) {
              return splits.map(v => ([20, 50, 100, 500, 1000, 5000, 20000].includes(v) ? v : null));
            }
            if (w < 580) {
              return splits.map(v => ([20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].includes(v) ? v : null));
            }
            return splits;
          },
          values: (_u, splits) => splits.map(v => formatFreq(v)),
          stroke: axisColor,
          grid: {
            stroke: gridColor,
            width: 1
          },
          ticks: {
            stroke: tickColor,
            width: 1
          }
        },
        {
          scale: 'y',
          space: isCompact ? 26 : 35,
          size: isCompact ? 42 : 55,
          stroke: axisColor,
          values: (_u, splits) => splits.map(v => isCompact ? `${Math.round(v)}` : `${Math.round(v)} dB`),
          grid: {
            stroke: gridColor,
            width: 1
          },
          ticks: {
            stroke: tickColor,
            width: 1
          }
        }
      ],
      series: getSeriesOptions(),
      hooks: {
        drawClear: [
          (u) => {
            u.ctx.imageSmoothingEnabled = true;
            u.ctx.imageSmoothingQuality = 'high';
            u.ctx.lineCap = 'round';
            u.ctx.lineJoin = 'round';
          }
        ],
        draw: [
          () => {
            fpsMeter.tick();
          }
        ],
        setScale: [
          (u, key) => {
            if (key === 'x') {
              const min = u.scales.x?.min;
              const max = u.scales.x?.max;
              if (min !== undefined && max !== undefined) {
                zoomMin = min;
                zoomMax = max;
              }
            }
          }
        ],
        setCursor: [
          (u) => {
            fpsMeter.tick();
            const idx = u.cursor.idx;
            if (idx !== null && idx !== undefined && idx >= 0 && idx < STANDARD_FREQUENCIES.length) {
              updateReadout(idx);
            }
          }
        ]
      }
    };

    const savedMin = zoomMin;
    const savedMax = zoomMax;

    if (uplotInstance) {
      uplotInstance.destroy();
    }

    uplotInstance = new uPlot(opts, getPlotData(), chartContainerRef);
    if (savedMin > 20 || savedMax < 20000) {
      uplotInstance.setScale('x', { min: savedMin, max: savedMax });
    }
    updateReadout(currentIdx);

    // Double-click container to reset zoom
    chartContainerRef.ondblclick = () => {
      resetZoom();
    };
  }

  function resetZoom() {
    zoomMin = 20;
    zoomMax = 20000;
    if (!uplotInstance) return;
    uplotInstance.setScale('x', { min: 20, max: 20000 });
  }

  onMount(() => {
    initChart();

    const resizeObserver = new ResizeObserver((entries) => {
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

    // Mouse wheel zoom centered strictly on the frequency X axis
    const handleWheel = (e: WheelEvent) => {
      if (!uplotInstance) return;
      e.preventDefault();

      const currentMin = uplotInstance.scales.x?.min ?? 20;
      const currentMax = uplotInstance.scales.x?.max ?? 20000;
      const logMin = Math.log10(Math.max(20, currentMin));
      const logMax = Math.log10(Math.min(20000, currentMax));
      const logSpan = logMax - logMin;

      const overEl = uplotInstance.over;
      const rect = overEl.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      const clampedRelX = Math.max(0, Math.min(1, relX));
      const logCursor = logMin + clampedRelX * logSpan;

      const zoomFactor = e.deltaY < 0 ? 0.82 : (1 / 0.82);
      const minPossibleSpan = 0.08; // Min frequency window
      const maxPossibleSpan = Math.log10(20000) - Math.log10(20); // Full 20Hz - 20kHz
      const newSpan = Math.max(minPossibleSpan, Math.min(maxPossibleSpan, logSpan * zoomFactor));

      let newLogMin = logCursor - clampedRelX * newSpan;
      let newLogMax = logCursor + (1 - clampedRelX) * newSpan;

      const fullLogMin = Math.log10(20);
      const fullLogMax = Math.log10(20000);

      if (newLogMin < fullLogMin) {
        newLogMin = fullLogMin;
        newLogMax = Math.min(fullLogMax, newLogMin + newSpan);
      }
      if (newLogMax > fullLogMax) {
        newLogMax = fullLogMax;
        newLogMin = Math.max(fullLogMin, newLogMax - newSpan);
      }

      uplotInstance.setScale('x', {
        min: Math.pow(10, newLogMin),
        max: Math.pow(10, newLogMax)
      });
    };

    chartContainerRef.addEventListener('wheel', handleWheel, { passive: false });

    // Capacitive / Touch Screen Gestures:
    // - 1 finger touch/drag: move crosshair & update live frequency/dB readout
    // - 2 finger pinch & drag: logarithmic zoom in/out + horizontal pan across 20Hz - 20kHz
    // - 1 finger double-tap: reset zoom to full 20Hz - 20kHz
    let pinchStartDist = 0;
    let pinchStartLogMin = Math.log10(20);
    let pinchStartLogMax = Math.log10(20000);
    let pinchAnchorLogFreq = Math.log10(1000);
    let wasPinching = false;
    let touchStartX = 0;
    let touchStartY = 0;
    let touchMoved = false;
    let lastTapTime = 0;
    let lastTapX = 0;
    let lastTapY = 0;

    const updateCursorFromTouch = (touch: Touch) => {
      if (!uplotInstance) return;
      const rect = uplotInstance.over.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const left = Math.max(0, Math.min(rect.width, touch.clientX - rect.left));
      const top = Math.max(0, Math.min(rect.height, touch.clientY - rect.top));
      uplotInstance.setCursor({ left, top });
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (!uplotInstance) return;
      if (e.touches.length === 2) {
        e.preventDefault();
        wasPinching = true;
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        pinchStartDist = Math.max(12, Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY));
        const currentMin = uplotInstance.scales.x?.min ?? 20;
        const currentMax = uplotInstance.scales.x?.max ?? 20000;
        pinchStartLogMin = Math.log10(Math.max(20, currentMin));
        pinchStartLogMax = Math.log10(Math.min(20000, currentMax));
        const logSpan = pinchStartLogMax - pinchStartLogMin;

        const rect = uplotInstance.over.getBoundingClientRect();
        const centerX = (t0.clientX + t1.clientX) / 2;
        const relCenter = Math.max(0, Math.min(1, (centerX - rect.left) / Math.max(1, rect.width)));
        pinchAnchorLogFreq = pinchStartLogMin + relCenter * logSpan;
      } else if (e.touches.length === 1) {
        wasPinching = false;
        touchMoved = false;
        const t = e.touches[0];
        touchStartX = t.clientX;
        touchStartY = t.clientY;
        updateCursorFromTouch(t);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!uplotInstance) return;
      if (e.touches.length === 2) {
        e.preventDefault();
        wasPinching = true;
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dist = Math.max(12, Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY));
        const scaleFactor = pinchStartDist / dist;
        const startSpan = pinchStartLogMax - pinchStartLogMin;
        const minPossibleSpan = 0.08;
        const maxPossibleSpan = Math.log10(20000) - Math.log10(20);
        const newSpan = Math.max(minPossibleSpan, Math.min(maxPossibleSpan, startSpan * scaleFactor));

        const rect = uplotInstance.over.getBoundingClientRect();
        const centerX = (t0.clientX + t1.clientX) / 2;
        const relCenterNow = Math.max(0, Math.min(1, (centerX - rect.left) / Math.max(1, rect.width)));

        let newLogMin = pinchAnchorLogFreq - relCenterNow * newSpan;
        let newLogMax = newLogMin + newSpan;

        const fullLogMin = Math.log10(20);
        const fullLogMax = Math.log10(20000);
        if (newLogMin < fullLogMin) {
          newLogMin = fullLogMin;
          newLogMax = Math.min(fullLogMax, newLogMin + newSpan);
        }
        if (newLogMax > fullLogMax) {
          newLogMax = fullLogMax;
          newLogMin = Math.max(fullLogMin, newLogMax - newSpan);
        }

        uplotInstance.setScale('x', {
          min: Math.pow(10, newLogMin),
          max: Math.pow(10, newLogMax)
        });
      } else if (e.touches.length === 1 && !wasPinching) {
        const t = e.touches[0];
        const dx = t.clientX - touchStartX;
        const dy = t.clientY - touchStartY;
        if (Math.hypot(dx, dy) > 8) {
          touchMoved = true;
        }
        if (Math.abs(dx) >= Math.abs(dy) * 0.6) {
          e.preventDefault();
        }
        updateCursorFromTouch(t);
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        if (!wasPinching && !touchMoved && e.changedTouches.length === 1) {
          const now = Date.now();
          const t = e.changedTouches[0];
          if (now - lastTapTime < 320 && Math.hypot(t.clientX - lastTapX, t.clientY - lastTapY) < 36) {
            e.preventDefault();
            resetZoom();
            lastTapTime = 0;
          } else {
            lastTapTime = now;
            lastTapX = t.clientX;
            lastTapY = t.clientY;
          }
        }
        wasPinching = false;
      }
    };

    chartContainerRef.addEventListener('touchstart', handleTouchStart, { passive: false });
    chartContainerRef.addEventListener('touchmove', handleTouchMove, { passive: false });
    chartContainerRef.addEventListener('touchend', handleTouchEnd, { passive: false });

    onCleanup(() => {
      fpsMeter.destroy();
      resizeObserver.disconnect();
      chartContainerRef.removeEventListener('wheel', handleWheel);
      chartContainerRef.removeEventListener('touchstart', handleTouchStart);
      chartContainerRef.removeEventListener('touchmove', handleTouchMove);
      chartContainerRef.removeEventListener('touchend', handleTouchEnd);
      if (uplotInstance) {
        uplotInstance.destroy();
        uplotInstance = null;
      }
    });
  });

  let lastTheme = state.theme;
  let lastRefCurveId = state.activeReferenceCurveId;
  let lastSpline = useSpline();
  let lastGrad = showGradient();
  let lastVisualSig = state.curves.map(c => `${c.id}:${c.visible}:${c.color}`).join('|');
  let lastOverlaySig = `${state.overlayColors.target}:${state.overlayColors.autoeq}:${state.overlayColors.equalized}:${state.overlayColors.delta}`;
  let lastMethod = state.selectedEqMethod;

  // Reactively update chart data and series when store or signals change
  createEffect(() => {
    // Track dependencies reactively
    const currentTheme = state.theme;
    const currentRefCurveId = state.activeReferenceCurveId;
    const currentSpline = useSpline();
    const currentGrad = showGradient();
    const currentMethod = state.selectedEqMethod;
    const curveVisualSig = state.curves.map(c => `${c.id}:${c.visible}:${c.color}`).join('|');
    const overlayVisualSig = `${state.overlayColors.target}:${state.overlayColors.autoeq}:${state.overlayColors.equalized}:${state.overlayColors.delta}`;

    // Deep-track curve properties so changes to smoothing, gains or offsets reactively trigger update
    state.curves.forEach((c) => {
      void c.smoothedGains;
      void c.offsetDb;
      void c.visible;
      void c.color;
      void c.smoothing;
    });
    void state.curves.length;
    void state.globalSmoothing;
    void state.normalizeAt1k;
    void state.showDelta;
    void state.deltaSecondaryCurveId;
    void state.overlayColors.target;
    void state.overlayColors.autoeq;
    void state.overlayColors.equalized;
    void state.overlayColors.delta;
    void state.selectedEqMethod;
    void showTarget();
    void showEqCurve();
    void showEqualized();
    void showGradient();
    void targetCurve();
    void equalizationCurve();
    void activeEqualizationCurve();
    void equalizedResultCurve();

    if (!uplotInstance) return;

    const themeChanged = currentTheme !== lastTheme;
    lastTheme = currentTheme;

    const refChanged = currentRefCurveId !== lastRefCurveId;
    lastRefCurveId = currentRefCurveId;

    const splineChanged = currentSpline !== lastSpline;
    lastSpline = currentSpline;

    const gradChanged = currentGrad !== lastGrad;
    lastGrad = currentGrad;

    const methodChanged = currentMethod !== lastMethod;
    lastMethod = currentMethod;

    const visualSigChanged = curveVisualSig !== lastVisualSig;
    lastVisualSig = curveVisualSig;

    const overlayChanged = overlayVisualSig !== lastOverlaySig;
    lastOverlaySig = overlayVisualSig;

    // Rebuild series options if curve list structure changed, theme changed, active reference changed, spline toggled, gradient toggled, method changed, or visibility/color changed
    const currentSeriesLen = uplotInstance.series.length;
    const expectedSeriesLen = 1 + state.curves.length + 4; // base + curves + (target, autoeq, res, delta)

    if (themeChanged || refChanged || splineChanged || gradChanged || methodChanged || visualSigChanged || overlayChanged || currentSeriesLen !== expectedSeriesLen) {
      initChart();
    } else {
      // Fast path: update data directly into canvas without re-allocating DOM while preserving X zoom
      const savedMin = zoomMin;
      const savedMax = zoomMax;
      uplotInstance.batch(() => {
        uplotInstance!.setData(getPlotData());
        if (savedMin > 20 || savedMax < 20000) {
          uplotInstance!.setScale('x', { min: savedMin, max: savedMax });
        }
      });
      updateReadout(currentIdx);
    }
  });

  return (
    <div class="flex flex-col h-full bg-[var(--chart-bg)] border border-[var(--border-default)] rounded-lg overflow-hidden select-none transition-colors">
      {/* Top Controls & Crosshair Readout Bar */}
      <div class="flex flex-col xl:flex-row xl:items-center justify-between px-2.5 sm:px-3.5 py-1.5 sm:py-2 bg-[var(--bg-panel)] border-b border-[var(--border-default)] text-xs gap-1.5 xl:gap-3">
        {/* Live Cursor Readout - Always showing without abrupt popping */}
        <div class="flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar min-w-0 flex-1 py-0.5">
          <span class="px-2 sm:px-2.5 py-0.5 sm:py-1 bg-[var(--bg-surface)] text-[var(--text-main)] font-mono font-bold rounded border border-[var(--border-contrast)] shrink-0 shadow-2xs text-[11px] sm:text-xs">
            {formatFreq(hoverFreq() || 1000)}Hz
          </span>
          <div class="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <Index each={hoverValues()}>
              {(item) => {
                const matchedCurve = () => state.curves.find(c => c.name === item().name);

                return (
                  <span class="flex flex-row sm:flex-col items-center gap-1.5 sm:gap-0.5 font-mono px-2 py-0.5 sm:py-1 bg-[var(--bg-card)] rounded border border-[var(--border-default)] shrink-0 shadow-2xs transition-colors">
                    <Show
                      when={matchedCurve()}
                      fallback={<span class="w-2.5 h-2.5 rounded-full shrink-0 shadow-xs" style={{ 'background-color': item().color }} />}
                    >
                      {(curve) => (
                        <ColorPickerPopover
                          color={curve().color}
                          onChange={(c) => frActions.setCurveColor(curve().id, c)}
                          title={`Color: ${curve().name}`}
                          size="sm"
                        />
                      )}
                    </Show>
                    <span class="text-[var(--text-muted)] truncate max-w-[90px] sm:max-w-[140px] text-[10px]" title={item().name}>{item().name}</span>
                    <span class="text-[var(--text-main)] font-bold text-[11px] sm:text-xs shrink-0">{item().val.toFixed(1)} dB</span>
                  </span>
                );
              }}
            </Index>
          </div>
        </div>

        {/* Action Controls & Overlays with Color Pickers */}
        <div class="flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar py-0.5 shrink-0">
          {/* Target Toggle & Color */}
          <div
            class={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium border transition-colors shrink-0 whitespace-nowrap ${showTarget()
              ? 'bg-[var(--bg-surface)] text-[var(--text-main)] border-[var(--border-contrast)]'
              : 'bg-transparent text-[var(--text-dim)] border-[var(--border-default)]'
              }`}
          >
            <ColorPickerPopover
              color={state.overlayColors.target || (state.theme === 'light' ? '#000000' : '#ffffff')}
              onChange={(c) => frActions.setOverlayColor('target', c)}
              title="Color de Curva Target"
              size="sm"
            />
            <button
              type="button"
              onClick={() => setShowTarget(!showTarget())}
              class="flex items-center gap-1.5 focus:outline-none cursor-pointer"
              title="Mostrar u ocultar curva objetivo (Target)"
            >
              <span>Target</span>
            </button>
          </div>

          {/* AutoEq Curve Toggle & Color */}
          <div
            class={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium border transition-colors shrink-0 whitespace-nowrap ${showEqCurve()
              ? 'bg-[var(--accent-blue-badge-bg)] text-[var(--accent-blue-badge-text)] border-[var(--accent-blue-badge-border)]'
              : 'bg-transparent text-[var(--text-dim)] border-[var(--border-default)]'
              }`}
          >
            <ColorPickerPopover
              color={state.overlayColors.autoeq || (state.theme === 'light' ? '#4D8EEB' : '#4B83DB')}
              onChange={(c) => frActions.setOverlayColor('autoeq', c)}
              title="Color de Curva AutoEq"
              size="sm"
            />
            <button
              type="button"
              onClick={() => setShowEqCurve(!showEqCurve())}
              class="flex items-center gap-1.5 focus:outline-none cursor-pointer"
              title="Mostrar u ocultar curva de compensación AutoEq"
            >
              <span>AutoEq</span>
            </button>
          </div>

          {/* Equalized Result Toggle & Color */}
          <div
            class={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium border transition-colors shrink-0 whitespace-nowrap ${showEqualized()
              ? 'bg-[#002b18] text-[#00ff88] border-[#00cc66]'
              : 'bg-transparent text-[var(--text-dim)] border-[var(--border-default)]'
              }`}
          >
            <ColorPickerPopover
              color={state.overlayColors.equalized || '#00ff88'}
              onChange={(c) => frActions.setOverlayColor('equalized', c)}
              title="Color Resultado EQ"
              size="sm"
            />
            <button
              type="button"
              onClick={() => setShowEqualized(!showEqualized())}
              class="flex items-center gap-1.5 focus:outline-none cursor-pointer"
              title="Mostrar u ocultar resultado con ecualización aplicada"
            >
              <span>Resultado EQ</span>
            </button>
          </div>

          {/* Gradient Area Toggle */}
          <button
            onClick={() => setShowGradient(!showGradient())}
            class={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded text-xs font-medium border transition-colors cursor-pointer shrink-0 whitespace-nowrap ${showGradient()
              ? 'bg-[var(--accent-blue-badge-bg)] text-[var(--accent-blue-badge-text)] border-[var(--accent-blue-badge-border)]'
              : 'bg-transparent text-[var(--text-dim)] border-[var(--border-default)]'
              }`}
            title="Alternar gradiente visual para identificar y resaltar la curva activa"
          >
            <span class="w-2.5 h-2.5 rounded-sm bg-gradient-to-b from-[var(--accent-blue)] via-[var(--accent-blue)]/40 to-transparent border border-[var(--accent-blue)] shadow-xs" />
            Gradiente
          </button>

          {/* Spline Smoothing Toggle */}
          <button
            onClick={() => setUseSpline(!useSpline())}
            class={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded text-xs font-medium border transition-colors cursor-pointer shrink-0 whitespace-nowrap ${useSpline()
              ? 'bg-[var(--accent-blue-badge-bg)] text-[var(--accent-blue-badge-text)] border-[var(--accent-blue-badge-border)]'
              : 'bg-transparent text-[var(--text-dim)] border-[var(--border-default)]'
              }`}
            title="Alternar interpolación visual Spline Cúbica (curvas suaves sin quiebres poligonales)"
          >
            <Spline size={13} class={useSpline() ? 'text-[var(--accent-blue)]' : 'text-[var(--text-dim)]'} />
            Spline
          </button>

          {/* Fractional Octave Smoothing Dropdown */}
          <div class="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-contrast)] text-xs shrink-0 whitespace-nowrap">
            <span class="text-[10px] text-[var(--text-muted)] font-medium">Suavizado:</span>
            <select
              class="bg-transparent text-[var(--text-main)] font-semibold text-xs outline-none cursor-pointer"
              value={state.globalSmoothing}
              onChange={(e) => frActions.setGlobalSmoothing(e.currentTarget.value as SmoothingType)}
              title="Ajustar suavizado psicoacústico fraccional de octava para todas las curvas"
            >
              <option value="none" class="bg-[var(--bg-panel)] text-[var(--text-main)]">Raw</option>
              <option value="1/48" class="bg-[var(--bg-panel)] text-[var(--text-main)]">1/48 oct</option>
              <option value="1/24" class="bg-[var(--bg-panel)] text-[var(--text-main)]">1/24 oct</option>
              <option value="1/12" class="bg-[var(--bg-panel)] text-[var(--text-main)]">1/12 oct</option>
              <option value="1/6" class="bg-[var(--bg-panel)] text-[var(--text-main)]">1/6 oct</option>
              <option value="1/3" class="bg-[var(--bg-panel)] text-[var(--text-main)]">1/3 oct</option>
              <option value="1/1" class="bg-[var(--bg-panel)] text-[var(--text-main)]">1/1 oct</option>
            </select>
          </div>

          {/* Normalize at 1kHz button */}
          <button
            onClick={() => frActions.toggleNormalizeAt1k()}
            class={`px-2 sm:px-2.5 py-1 rounded text-xs font-medium border transition-colors shrink-0 whitespace-nowrap cursor-pointer ${state.normalizeAt1k
              ? 'bg-[var(--accent-blue)] text-[#ffffff] border-[var(--accent-blue)]'
              : 'bg-[var(--bg-surface)] text-[var(--text-main)] border-[var(--border-contrast)] hover:border-[var(--accent-blue)]'
              }`}
            title="Alinear todas las curvas a 0 dB en 1 kHz"
          >
            Norm @ 1kHz
          </button>

          {/* Reset Zoom Button */}
          <button
            onClick={resetZoom}
            class="p-1.5 bg-[var(--bg-surface)] text-[var(--text-main)] hover:bg-[var(--border-contrast)] active:scale-95 rounded border border-[var(--border-contrast)] transition-all shrink-0 cursor-pointer"
            title="Restablecer zoom a 20Hz - 20kHz (Doble clic o doble toque)"
          >
            <RotateCcw size={13} />
          </button>
        </div>
      </div>

      {/* Main uPlot Canvas Container */}
      <div
        class="relative flex-1 w-full min-h-[180px] sm:min-h-[220px] lg:min-h-[250px] pl-1 sm:pl-3 touch-none transition-colors"
        style={{
          "background-color": state.theme === 'light'
            ? '#FFFFFF'
            : '#000000'
        }}
        ref={chartContainerRef}
      >
        {/* Subtle grid watermark & Real-time FPS Badge */}
        <div class="absolute bottom-2 right-2 sm:bottom-3 sm:right-4 flex items-center gap-1.5 sm:gap-2 pointer-events-none select-none font-mono text-[9px] sm:text-[10px] bg-[var(--bg-panel)]/85 backdrop-blur-xs px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-md border border-[var(--border-default)] shadow-xs transition-colors">
          <span
            class="w-1.5 h-1.5 rounded-full transition-colors duration-200"
            style={{
              'background-color': chartFps() > 0
                ? (chartFps() >= 50 ? '#00FF88' : chartFps() >= 30 ? '#FFAA00' : '#FF0000')
                : '#666666'
            }}
          />
          <span class="text-[var(--text-main)] font-bold">
            {chartFps() > 0 ? `${chartFps().toFixed(1)} FPS` : 'En reposo'}
          </span>
          <span class="hidden sm:inline text-[var(--text-dim)]">• uPlot Canvas</span>
        </div>
      </div>
    </div>
  );
}
