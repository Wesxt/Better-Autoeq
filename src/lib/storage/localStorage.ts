import type { SmoothingType } from "../autoeq/smoothing";
import type { TargetCurveDefinition } from "../autoeq/constants";
import type { TargetParameters } from "../autoeq/targets";
import type { BiquadFilterConfig } from "../autoeq/biquad";
import type { BitDepth, ChannelMode } from "../audio/wavEncoder";
import type { WindowFunctionType } from "../audio/fft";

export interface PlotSettings {
  showTarget: boolean;
  showEqCurve: boolean;
  showEqualized: boolean;
  showGradient: boolean;
  useSpline: boolean;
}

export type MicCaptureMode = 'instant' | 'peak' | 'average'
export type SweepType = 'logarithmic' | 'linear'

export interface MicSettings {
  calOffset: number;
  fftSize: number;
  compositeFft: boolean;
  windowFunction: WindowFunctionType;
  rtaCurveColor: string;
  maxHoldCurveColor?: string;
  averageCurveColor?: string;
  selectedDeviceId: string;
  captureMode?: MicCaptureMode;
  sweepType?: SweepType;
  sweepDuration?: number;
  sweepStartFreq?: number;
  sweepEndFreq?: number;
  noiseCancellationEnabled?: boolean;
  noiseProfileDuration?: number;
  calibrationData?: MicCalibrationData | null;
  rtaUseSpline?: boolean;
  temporalSmoothing?: boolean;
  bandIntegration?: boolean;
}

export interface MicCalibrationData {
  fileName: string;
  frequencies: number[];
  rawGains: number[];
}

export interface ExportSettings {
  activeTab: "wav" | "eqapo" | "graphiceq" | "data";
  sampleRate: number;
  bitDepth: BitDepth;
  taps: number;
  phaseMode: "minimum" | "linear";
  channelMode: ChannelMode;
  normalizePeak: boolean;
}

export interface OverlayColors {
  target: string;
  autoeq: string;
  equalized: string;
  delta: string;
}

export type AutoEqMethod = 'peq' | 'fir' | 'graphiceq' | 'ideal';

export interface PersistedConfig {
  version: number;
  theme: "dark" | "light";
  selectedTargetId: string;
  customTarget: TargetCurveDefinition | null;
  targetParams: TargetParameters;
  globalSmoothing: SmoothingType;
  normalizeAt1k: boolean;
  showDelta: boolean;
  deltaSecondaryCurveId: string | null;
  activeReferenceCurveId: string | null;
  maxFiltersCount: number;
  selectedEqMethod?: AutoEqMethod;
  firTaps?: number;
  firPhase?: "minimum" | "linear";
  firSampleRate?: number;
  graphicEqBandsCount?: 10 | 15 | 31 | 127;
  overlayColors: OverlayColors;
  plotSettings: PlotSettings;
  micSettings: MicSettings;
  exportSettings: ExportSettings;
}

export const CONFIG_STORAGE_KEY = "better_autoeq_config_v1";
export const CURVES_STORAGE_KEY = "better_autoeq_curves_v1";
export const PEQ_STORAGE_KEY = "better_autoeq_peq_v1";

export const DEFAULT_PLOT_SETTINGS: PlotSettings = {
  showTarget: true,
  showEqCurve: true,
  showEqualized: true,
  showGradient: true,
  useSpline: false,
};

export const DEFAULT_MIC_SETTINGS: MicSettings = {
  calOffset: 100,
  fftSize: 4096,
  compositeFft: true,
  windowFunction: "hann",
  rtaCurveColor: "",
  maxHoldCurveColor: "#FFAA00",
  averageCurveColor: "#00FF88",
  selectedDeviceId: "",
  captureMode: "instant",
  sweepType: "logarithmic",
  sweepDuration: 5,
  sweepStartFreq: 20,
  sweepEndFreq: 20000,
  noiseCancellationEnabled: false,
  noiseProfileDuration: 15,
  calibrationData: null,
  rtaUseSpline: true,
  temporalSmoothing: true,
  bandIntegration: true,
};

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  activeTab: "wav",
  sampleRate: 48000,
  bitDepth: 24,
  taps: 16384,
  phaseMode: "minimum",
  channelMode: "stereo",
  normalizePeak: true,
};

export const DEFAULT_OVERLAY_COLORS: OverlayColors = {
  target: "",
  autoeq: "oklab(0.62 -0.050 -0.136)",
  equalized: "#00ff88",
  delta: "#FF0000",
};

/**
 * Carga la configuración persistida de LocalStorage de forma segura.
 */
export function loadPersistedConfig(): Partial<PersistedConfig> | null {
  if (typeof localStorage === "undefined") return null;

  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch (err) {
    console.warn("[Better-AutoEq] Error al cargar configuración desde localStorage:", err);
  }
  return null;
}

/**
 * Guarda la configuración general en LocalStorage de forma segura.
 */
export function savePersistedConfig(config: PersistedConfig): boolean {
  if (typeof localStorage === "undefined") return false;

  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
    return true;
  } catch (err) {
    console.warn("[Better-AutoEq] Error al guardar configuración en localStorage:", err);
    return false;
  }
}

/**
 * Carga curvas guardadas en LocalStorage.
 */
export function loadPersistedCurves<T>(): T[] | null {
  if (typeof localStorage === "undefined") return null;

  try {
    const raw = localStorage.getItem(CURVES_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as T[];
    }
  } catch (err) {
    console.warn("[Better-AutoEq] Error al cargar curvas desde localStorage:", err);
  }
  return null;
}

/**
 * Guarda curvas en LocalStorage.
 */
export function savePersistedCurves<T>(curves: T[]): boolean {
  if (typeof localStorage === "undefined") return false;

  try {
    localStorage.setItem(CURVES_STORAGE_KEY, JSON.stringify(curves));
    return true;
  } catch (err) {
    console.warn("[Better-AutoEq] Error al guardar curvas en localStorage:", err);
    return false;
  }
}

/**
 * Carga filtros PEQ guardados.
 */
export function loadPersistedPeq(): BiquadFilterConfig[] | null {
  if (typeof localStorage === "undefined") return null;

  try {
    const raw = localStorage.getItem(PEQ_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as BiquadFilterConfig[];
    }
  } catch (err) {
    console.warn("[Better-AutoEq] Error al cargar PEQ desde localStorage:", err);
  }
  return null;
}

/**
 * Guarda filtros PEQ en LocalStorage.
 */
export function savePersistedPeq(filters: BiquadFilterConfig[]): boolean {
  if (typeof localStorage === "undefined") return false;

  try {
    localStorage.setItem(PEQ_STORAGE_KEY, JSON.stringify(filters));
    return true;
  } catch (err) {
    console.warn("[Better-AutoEq] Error al guardar PEQ en localStorage:", err);
    return false;
  }
}

/**
 * Restablece todas las configuraciones almacenadas.
 */
export function clearAllPersistedData() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(CONFIG_STORAGE_KEY);
    localStorage.removeItem(CURVES_STORAGE_KEY);
    localStorage.removeItem(PEQ_STORAGE_KEY);
    localStorage.removeItem("better_autoeq_theme");
  } catch (err) {
    console.warn("[Better-AutoEq] Error al limpiar localStorage:", err);
  }
}
