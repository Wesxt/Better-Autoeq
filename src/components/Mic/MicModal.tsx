import { createSignal, onCleanup, createEffect, Show, For } from 'solid-js';
import { state, frActions } from '../../store/frStore';
import { micAnalyzer } from '../../lib/audio/micCapture';
import { audioPreview } from '../../lib/audio/audioPreview';
import { RtaPlot, type RtaPlotHandle } from './RtaPlot';
import {
  FFT_RESOLUTIONS,
  AVAILABLE_WINDOWS,
  type WindowFunctionType
} from '../../lib/audio/fft';
import {
  Mic,
  MicOff,
  Volume2,
  Radio,
  Check,
  X,
  Camera,
  AlertTriangle,
  Settings2,
  RefreshCw,
  Layers,
  Sliders,
  RotateCcw,
  TrendingUp,
  Zap,
  BarChart2,
  Link2,
  Link2Off,
  VolumeX,
  Trash2,
  Download,
  Combine,
  CheckSquare,
  Square
} from 'lucide-solid';
import { Popover } from '../Common/Popover';
import type { MicCaptureMode, SweepType } from '../../store/frStore';
import { STANDARD_FREQUENCIES } from '../../lib/autoeq/constants';

export interface StagedCapture {
  id: string;
  name: string;
  frequencies: number[];
  rawGains: number[];
  mode: MicCaptureMode;
  color: string;
  timestamp: number;
  selected: boolean;
  imported?: boolean;
}

export function MicModal() {
  let rtaPlotHandle: RtaPlotHandle | null = null;

  // Immediate initialization of persisted calibration file
  const initialCal = state.micSettings.calibrationData;
  if (initialCal && initialCal.frequencies?.length && initialCal.rawGains?.length) {
    micAnalyzer.setCalibration(initialCal.frequencies, initialCal.rawGains);
  }

  const [isRecording, setIsRecording] = createSignal(false);
  const [isPlayingPink, setIsPlayingPink] = createSignal(false);
  const [isPlayingWhite, setIsPlayingWhite] = createSignal(false);
  const [isPlayingSweep, setIsPlayingSweep] = createSignal(false);

  // Left & Right Channel Output Volume Controls
  const [leftVolume, setLeftVolume] = createSignal<number>(audioPreview.getLeftVolume());
  const [rightVolume, setRightVolume] = createSignal<number>(audioPreview.getRightVolume());
  const [linkedChannels, setLinkedChannels] = createSignal<boolean>(false);

  const unsubscribeVol = audioPreview.onVolumeChange((l, r) => {
    setLeftVolume(l);
    setRightVolume(r);
    micAnalyzer.setChannelVolumes(l, r);
  });
  onCleanup(() => {
    unsubscribeVol();
  });

  function updateLeftVolume(v: number) {
    const clamped = Math.max(0, Math.min(1, v));
    setLeftVolume(clamped);
    if (linkedChannels()) {
      setRightVolume(clamped);
      audioPreview.setChannelVolumes(clamped, clamped);
      micAnalyzer.setChannelVolumes(clamped, clamped);
    } else {
      audioPreview.setLeftVolume(clamped);
      micAnalyzer.setLeftVolume(clamped);
    }
  }

  function updateRightVolume(v: number) {
    const clamped = Math.max(0, Math.min(1, v));
    setRightVolume(clamped);
    if (linkedChannels()) {
      setLeftVolume(clamped);
      audioPreview.setChannelVolumes(clamped, clamped);
      micAnalyzer.setChannelVolumes(clamped, clamped);
    } else {
      audioPreview.setRightVolume(clamped);
      micAnalyzer.setRightVolume(clamped);
    }
  }

  function setChannelPreset(left: number, right: number) {
    setLinkedChannels(false);
    setLeftVolume(left);
    setRightVolume(right);
    audioPreview.setChannelVolumes(left, right);
    micAnalyzer.setChannelVolumes(left, right);
  }

  // Sweep configuration signals
  const [sweepType, setSweepType] = createSignal<SweepType>(state.micSettings.sweepType || 'logarithmic');
  const [sweepDuration, setSweepDuration] = createSignal<number>(state.micSettings.sweepDuration || 5);
  const [sweepStartFreq, setSweepStartFreq] = createSignal<number>(state.micSettings.sweepStartFreq || 20);
  const [sweepEndFreq, setSweepEndFreq] = createSignal<number>(state.micSettings.sweepEndFreq || 20000);

  const [calOffset, setCalOffset] = createSignal(state.micSettings.calOffset);
  const [calFileName, setCalFileName] = createSignal<string | null>(
    state.micSettings.calibrationData?.fileName || null
  );
  let calInputRef!: HTMLInputElement;

  const [enableTransferFunction, setEnableTransferFunction] = createSignal(false);

  // Background Noise Floor calibration signals (10s to 30s)
  const [isMeasuringNoise, setIsMeasuringNoise] = createSignal<boolean>(false);
  const [noiseDuration, setNoiseDuration] = createSignal<number>(state.micSettings.noiseProfileDuration || 15);
  const [noiseProgress, setNoiseProgress] = createSignal<{ elapsed: number; total: number; percent: number }>({ elapsed: 0, total: 15, percent: 0 });
  const [hasNoiseProfile, setHasNoiseProfile] = createSignal<boolean>(micAnalyzer.hasNoiseFloorProfile());
  const [noiseAvgDb, setNoiseAvgDb] = createSignal<number | null>(micAnalyzer.getNoiseFloorAverageDb());
  const [noiseCancellationEnabled, setNoiseCancellationEnabled] = createSignal<boolean>(state.micSettings.noiseCancellationEnabled ?? false);

  micAnalyzer.onNoiseFloorProgress = (elapsedSec, totalSec, percent) => {
    setIsMeasuringNoise(true);
    setNoiseProgress({ elapsed: elapsedSec, total: totalSec, percent });
  };

  micAnalyzer.onNoiseFloorComplete = (avgDb) => {
    setIsMeasuringNoise(false);
    setHasNoiseProfile(true);
    setNoiseAvgDb(avgDb);
    setNoiseCancellationEnabled(true);
    micAnalyzer.noiseCancellationEnabled = true;
    frActions.setMicSetting('noiseCancellationEnabled', true);
  };

  async function handleStartNoiseCalibration() {
    if (!isRecording()) {
      await startMic();
    }
    if (isPlayingPink()) {
      micAnalyzer.stopStimulus();
      setIsPlayingPink(false);
    }
    if (isPlayingWhite()) {
      micAnalyzer.stopStimulus();
      setIsPlayingWhite(false);
    }
    if (isPlayingSweep()) {
      micAnalyzer.stopStimulus();
      setIsPlayingSweep(false);
    }
    audioPreview.pause();

    micAnalyzer.startNoiseFloorCalibration(noiseDuration());
    setIsMeasuringNoise(true);
    setNoiseProgress({ elapsed: 0, total: noiseDuration(), percent: 0 });
  }

  function handleCancelNoiseCalibration() {
    micAnalyzer.cancelNoiseFloorCalibration();
    setIsMeasuringNoise(false);
  }

  function handleToggleNoiseCancellation() {
    if (!hasNoiseProfile()) {
      handleStartNoiseCalibration();
      return;
    }
    const next = !noiseCancellationEnabled();
    setNoiseCancellationEnabled(next);
    micAnalyzer.noiseCancellationEnabled = next;
    frActions.setMicSetting('noiseCancellationEnabled', next);
  }

  function handleClearNoiseProfile() {
    micAnalyzer.clearNoiseFloorProfile();
    setHasNoiseProfile(false);
    setNoiseAvgDb(null);
    setNoiseCancellationEnabled(false);
    frActions.setMicSetting('noiseCancellationEnabled', false);
  }

  const [captureSuccess, setCaptureSuccess] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  const [isInsecureOriginError, setIsInsecureOriginError] = createSignal(false);
  const [copiedFlagItem, setCopiedFlagItem] = createSignal<'flag' | 'origin' | null>(null);

  function copyTextHelper(text: string, type: 'flag' | 'origin') {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedFlagItem(type);
    setTimeout(() => setCopiedFlagItem(null), 2000);
  }

  // Capture mode: 'instant' | 'peak' | 'average'
  const [captureMode, setCaptureMode] = createSignal<MicCaptureMode>(
    state.micSettings.captureMode || 'instant'
  );
  const [averageCount, setAverageCount] = createSignal<number>(0);
  const maxHoldColor = () => state.micSettings.maxHoldCurveColor || '#FFAA00';
  const averageColor = () => state.micSettings.averageCurveColor || '#00FF88';

  const [devices, setDevices] = createSignal<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = createSignal<string>(state.micSettings.selectedDeviceId);
  const [livePeakDb, setLivePeakDb] = createSignal<number>(-120);
  const [isRefreshing, setIsRefreshing] = createSignal(false);

  // FFT Parameters initialized from persisted store
  const [fftSize, setFftSize] = createSignal<number>(state.micSettings.fftSize);
  const [compositeFft, setCompositeFft] = createSignal<boolean>(state.micSettings.compositeFft);
  const [windowFunction, setWindowFunction] = createSignal<WindowFunctionType>(state.micSettings.windowFunction);

  async function handleCalUpload(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const { parseFrequencyResponseFile } = await import('../../lib/parser/parseFR');
      const parsed = parseFrequencyResponseFile(text, file.name);
      micAnalyzer.setCalibration(parsed.frequencies, parsed.rawGains);
      setCalFileName(parsed.name);
      frActions.setMicSetting('calibrationData', {
        fileName: parsed.name,
        frequencies: parsed.frequencies,
        rawGains: parsed.rawGains
      });
    } catch (err) {
      alert(`Error al cargar calibración: ${(err as Error).message}`);
    }
  }

  function handleClearCalibration(e: MouseEvent) {
    e.stopPropagation();
    micAnalyzer.clearCalibration();
    setCalFileName(null);
    frActions.setMicSetting('calibrationData', null);
    if (calInputRef) {
      calInputRef.value = '';
    }
  }

  // Handle modal lifecycle & devicechange listener
  createEffect(() => {
    const isOpen = state.isMicModalOpen;
    if (isOpen) {
      loadDevices();
      const onDeviceChange = () => {
        loadDevices();
      };
      navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange);
      onCleanup(() => {
        navigator.mediaDevices?.removeEventListener('devicechange', onDeviceChange);
      });
    } else {
      stopMic();
    }
  });

  // Synchronize dynamic mic settings with analyzer without tearing down device listeners
  createEffect(() => {
    micAnalyzer.setFftSize(fftSize());
  });
  createEffect(() => {
    micAnalyzer.setCompositeFft(compositeFft());
  });
  createEffect(() => {
    micAnalyzer.setWindowFunction(windowFunction());
  });
  createEffect(() => {
    micAnalyzer.calibrationOffset = calOffset();
  });
  createEffect(() => {
    const cal = state.micSettings.calibrationData;
    if (cal && cal.frequencies?.length && cal.rawGains?.length) {
      micAnalyzer.setCalibration(cal.frequencies, cal.rawGains);
      setCalFileName(cal.fileName);
    } else {
      micAnalyzer.clearCalibration();
      setCalFileName(null);
    }
  });
  createEffect(() => {
    micAnalyzer.setTemporalSmoothing(state.micSettings.temporalSmoothing ?? true);
  });
  createEffect(() => {
    micAnalyzer.setBandIntegration(state.micSettings.bandIntegration ?? true);
  });

  // Monitor hardware track disconnection
  micAnalyzer.onTrackEnded = () => {
    setErrorMessage('La grabación se detuvo porque el micrófono fue desconectado o el sistema cerró la pista de audio.');
    stopMic();
  };

  async function loadDevices() {
    try {
      const devList = await micAnalyzer.getAudioDevices();
      setDevices(devList);
      if (devList.length > 0) {
        const exists = devList.some((d) => d.deviceId === selectedDeviceId());
        if (!exists) {
          setSelectedDeviceId(devList[0].deviceId);
        }
      }
    } catch (err) {
      console.warn('Could not enumerate audio devices:', err);
    }
  }

  async function refreshDevices() {
    setIsRefreshing(true);
    try {
      await loadDevices();
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  }

  async function startMic() {
    setErrorMessage(null);
    setIsInsecureOriginError(false);
    try {
      micAnalyzer.calibrationOffset = calOffset();
      micAnalyzer.selectedDeviceId = selectedDeviceId() || null;
      micAnalyzer.setFftSize(fftSize());
      micAnalyzer.setCompositeFft(compositeFft());
      micAnalyzer.setWindowFunction(windowFunction());
      micAnalyzer.setTemporalSmoothing(state.micSettings.temporalSmoothing ?? true);
      micAnalyzer.setBandIntegration(state.micSettings.bandIntegration ?? true);

      micAnalyzer.enableLiveTransferFunction = enableTransferFunction();
      micAnalyzer.noiseCancellationEnabled = noiseCancellationEnabled();
      if (enableTransferFunction()) {
        micAnalyzer.setReferenceAnalyser(audioPreview.referenceAnalyser);
      } else {
        micAnalyzer.setReferenceAnalyser(null);
      }

      await micAnalyzer.start((freqs, dbs, peakDb, maxHoldDbs, avgDbs, avgCount, tfDbs) => {
        setLivePeakDb(peakDb);
        setAverageCount(avgCount);
        if (rtaPlotHandle) {
          rtaPlotHandle.updateData(freqs, dbs, maxHoldDbs, avgDbs, tfDbs);
        }
      });

      setIsRecording(true);
      await loadDevices();
    } catch (err) {
      const e = err as Error;
      let userMsg = `Error al acceder al micrófono: ${e.message}`;
      if (e.name === 'InsecureContextError' || (!window.isSecureContext && !navigator.mediaDevices?.getUserMedia)) {
        setIsInsecureOriginError(true);
        userMsg = e.message;
      } else if (e.name === 'MediaDevicesNotSupportedError') {
        userMsg =
          'Este navegador no permite el acceso al micrófono (getUserMedia no disponible). Si abriste el enlace desde un navegador integrado (Instagram, WhatsApp, etc.), ábrelo en Chrome o Safari.';
      } else if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
        userMsg =
          'Permiso de micrófono denegado por el navegador. Toca el icono de ajustes/candado en la barra de direcciones y permite el acceso al micrófono.';
      } else if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
        userMsg = 'No se encontró ningún micrófono disponible en tu dispositivo.';
      } else if (e.name === 'NotReadableError') {
        userMsg =
          'El micrófono está siendo ocupado por otra aplicación. Cierra las otras apps de audio/llamadas y vuelve a intentar.';
      }
      setErrorMessage(userMsg);
      setIsRecording(false);
    }
  }

  function stopMic() {
    if (isMeasuringNoise()) {
      handleCancelNoiseCalibration();
    }
    micAnalyzer.stop();
    setIsRecording(false);
    setIsPlayingPink(false);
    setIsPlayingWhite(false);
    setIsPlayingSweep(false);
    setLivePeakDb(-120);
    setAverageCount(0);
    if (rtaPlotHandle) {
      rtaPlotHandle.clear();
    }
  }

  function handleResetMaxHold(e?: Event) {
    e?.stopPropagation();
    micAnalyzer.resetMaxHold();
    if (rtaPlotHandle && micAnalyzer.isRunning()) {
      rtaPlotHandle.updateData(
        (micAnalyzer as any).lastLiveFreqs || [],
        (micAnalyzer as any).lastLiveDbs || [],
        micAnalyzer.getMaxHoldDbs(),
        micAnalyzer.getAverageDbs()
      );
    }
  }

  function handleResetAverage(e?: Event) {
    e?.stopPropagation();
    micAnalyzer.resetAverage();
    setAverageCount(0);
    if (rtaPlotHandle && micAnalyzer.isRunning()) {
      rtaPlotHandle.updateData(
        (micAnalyzer as any).lastLiveFreqs || [],
        (micAnalyzer as any).lastLiveDbs || [],
        micAnalyzer.getMaxHoldDbs(),
        micAnalyzer.getAverageDbs()
      );
    }
  }

  async function togglePinkNoise() {
    if (isPlayingPink()) {
      micAnalyzer.stopStimulus();
      setIsPlayingPink(false);
    } else {
      setIsPlayingWhite(false);
      setIsPlayingSweep(false);
      await micAnalyzer.startPinkNoise(1.0);
      setIsPlayingPink(true);
    }
  }

  async function toggleWhiteNoise() {
    if (isPlayingWhite()) {
      micAnalyzer.stopStimulus();
      setIsPlayingWhite(false);
    } else {
      setIsPlayingPink(false);
      setIsPlayingSweep(false);
      await micAnalyzer.startWhiteNoise(1.0);
      setIsPlayingWhite(true);
    }
  }

  async function toggleSweep() {
    if (isPlayingSweep()) {
      micAnalyzer.stopStimulus();
      setIsPlayingSweep(false);
    } else {
      setIsPlayingPink(false);
      setIsPlayingWhite(false);
      setIsPlayingSweep(true);
      await micAnalyzer.playSineSweep(sweepDuration(), 1.0, sweepType(), sweepStartFreq(), sweepEndFreq());
      setIsPlayingSweep(false);
    }
  }

  const [stagedCaptures, setStagedCaptures] = createSignal<StagedCapture[]>([]);
  const [captureNameInput, setCaptureNameInput] = createSignal<string>('');
  const [averageCurveName, setAverageCurveName] = createSignal<string>('');
  const [feedbackMessage, setFeedbackMessage] = createSignal<string | null>(null);

  let feedbackTimeout: any = null;
  function showFeedback(msg: string) {
    setFeedbackMessage(msg);
    if (feedbackTimeout) clearTimeout(feedbackTimeout);
    feedbackTimeout = setTimeout(() => setFeedbackMessage(null), 3500);
  }

  function defaultCaptureName() {
    const num = stagedCaptures().length + 1;
    const modeLabel = captureMode() === 'instant' ? 'Instante' : captureMode() === 'peak' ? 'Peak Hold' : 'Promedio';
    return `Medición ${num} (${modeLabel})`;
  }

  function handleCapture() {
    if (!isRecording()) return;
    try {
      const defaultName = defaultCaptureName();
      const chosenName = captureNameInput().trim() || defaultName;

      const snap = micAnalyzer.captureSnapshot(chosenName, captureMode());

      let curveColor: string;
      if (captureMode() === 'peak') {
        curveColor = state.micSettings.maxHoldCurveColor || '#FFAA00';
      } else if (captureMode() === 'average') {
        curveColor = state.micSettings.averageCurveColor || '#00FF88';
      } else {
        curveColor = state.micSettings.rtaCurveColor || '#00D4FF';
      }

      const newCapture: StagedCapture = {
        id: `cap-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        name: chosenName,
        frequencies: [...snap.frequencies],
        rawGains: [...snap.rawGains],
        mode: captureMode(),
        color: curveColor,
        timestamp: Date.now(),
        selected: true,
        imported: false
      };

      setStagedCaptures((prev) => [...prev, newCapture]);
      setCaptureNameInput('');
      setCaptureSuccess(true);
      setTimeout(() => setCaptureSuccess(false), 2000);
      showFeedback(`Captura agregada a la bandeja: "${chosenName}"`);
    } catch (err) {
      alert(`Error al capturar respuesta: ${(err as Error).message}`);
    }
  }

  function toggleCaptureSelection(id: string) {
    setStagedCaptures((prev) =>
      prev.map((c) => (c.id === id ? { ...c, selected: !c.selected } : c))
    );
  }

  function areAllSelected() {
    const caps = stagedCaptures();
    return caps.length > 0 && caps.every((c) => c.selected);
  }

  function toggleSelectAllCaptures() {
    const target = !areAllSelected();
    setStagedCaptures((prev) => prev.map((c) => ({ ...c, selected: target })));
  }

  function deleteCapture(id: string) {
    setStagedCaptures((prev) => prev.filter((c) => c.id !== id));
  }

  function clearAllCaptures() {
    if (stagedCaptures().length === 0) return;
    if (confirm('¿Deseas eliminar todas las capturas registradas en la bandeja?')) {
      setStagedCaptures([]);
      showFeedback('Bandeja de capturas vaciada');
    }
  }

  function updateCaptureName(id: string, newName: string) {
    const target = stagedCaptures().find((c) => c.id === id);
    if (target) {
      target.name = newName;
    }
  }

  const selectedCaptures = () => stagedCaptures().filter((c) => c.selected);
  const selectedCapturesCount = () => selectedCaptures().length;

  function importSingleCapture(cap: StagedCapture) {
    frActions.addCurve(cap.name, cap.frequencies, cap.rawGains, state.globalSmoothing, cap.color);
    setStagedCaptures((prev) =>
      prev.map((c) => (c.id === cap.id ? { ...c, imported: true } : c))
    );
    showFeedback(`✓ Curva "${cap.name}" importada al Auto EQ`);
  }

  function importSelectedCaptures() {
    const selected = selectedCaptures();
    if (selected.length === 0) return;

    selected.forEach((cap) => {
      frActions.addCurve(cap.name, cap.frequencies, cap.rawGains, state.globalSmoothing, cap.color);
    });

    const selectedIds = new Set(selected.map((c) => c.id));
    setStagedCaptures((prev) =>
      prev.map((c) => (selectedIds.has(c.id) ? { ...c, imported: true } : c))
    );

    showFeedback(`✓ ${selected.length} curva${selected.length === 1 ? '' : 's'} importada${selected.length === 1 ? '' : 's'} al Auto EQ`);
  }

  function importAllCaptures() {
    const all = stagedCaptures();
    if (all.length === 0) return;

    all.forEach((cap) => {
      frActions.addCurve(cap.name, cap.frequencies, cap.rawGains, state.globalSmoothing, cap.color);
    });

    setStagedCaptures((prev) => prev.map((c) => ({ ...c, imported: true })));
    showFeedback(`✓ Se importaron las ${all.length} capturas al Auto EQ`);
  }

  function unifyAndAverageSelected() {
    const selected = selectedCaptures();
    if (selected.length === 0) return;

    const defaultAvgName = `Promedio (${selected.length} mediciones)`;
    const finalName = averageCurveName().trim() || defaultAvgName;

    const numPoints = STANDARD_FREQUENCIES.length;
    const avgGains = new Array<number>(numPoints);

    // Acoustic power (RMS energy) averaging across selected captures
    for (let i = 0; i < numPoints; i++) {
      let sumPower = 0;
      let validCount = 0;
      for (let k = 0; k < selected.length; k++) {
        const db = selected[k].rawGains[i];
        if (Number.isFinite(db)) {
          sumPower += Math.pow(10, db / 10);
          validCount++;
        }
      }
      const meanPower = validCount > 0 ? sumPower / validCount : 0;
      const avgDb = meanPower > 0 ? 10 * Math.log10(meanPower) : 0;
      avgGains[i] = Math.round(avgDb * 10) / 10;
    }

    // Import unified average curve into AutoEQ
    frActions.addCurve(finalName, [...STANDARD_FREQUENCIES], avgGains, state.globalSmoothing, '#00FF88');

    // Mark selected captures as imported
    const selectedIds = new Set(selected.map((c) => c.id));
    setStagedCaptures((prev) =>
      prev.map((c) => (selectedIds.has(c.id) ? { ...c, imported: true } : c))
    );

    setAverageCurveName('');
    showFeedback(`✓ Curva promedio "${finalName}" unificada e importada al Auto EQ`);
  }

  onCleanup(() => {
    stopMic();
  });

  return (
    <Show when={state.isMicModalOpen}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-4 select-none">
        <div class="w-full max-w-[96vw] sm:max-w-[92vw] lg:max-w-5xl xl:max-w-[75vw] bg-[var(--bg-modal)] border border-[var(--border-default)] rounded-xl shadow-2xl overflow-hidden flex flex-col text-xs transition-colors max-h-[95dvh] overflow-y-auto">
          {/* Header */}
          <div class="flex items-center justify-between px-3.5 sm:px-5 py-2.5 sm:py-3.5 border-b border-[var(--border-default)] bg-[var(--bg-panel)] shrink-0 gap-2">
            <div class="flex items-center gap-2 min-w-0">
              <div class="w-7 h-7 rounded-lg bg-[var(--accent-blue-badge-bg)] border border-[var(--accent-blue-badge-border)] flex items-center justify-center shrink-0">
                <Mic size={15} class="text-[var(--accent-blue)]" />
              </div>
              <div class="min-w-0">
                <h2 class="text-xs font-bold text-[var(--text-pure)] uppercase tracking-wide truncate">
                  Medición Acústica con Micrófono (uPlot RTA)
                </h2>
                <p class="hidden sm:block text-[10px] text-[var(--text-muted)] truncate">
                  Analizador en tiempo real con uPlot, FFT multi-resolución y ventanas acústicas
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                stopMic();
                frActions.closeMicModal();
              }}
              class="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-pure)] hover:bg-[var(--border-contrast)] rounded transition-colors cursor-pointer shrink-0"
            >
              <X size={16} />
            </button>
          </div>

          {/* Error Message Alert */}
          <Show when={errorMessage()}>
            <div class="m-3 sm:m-4 p-3 bg-red-950/60 border border-red-500/40 rounded-lg text-red-200 text-xs flex flex-col gap-2.5">
              <div class="flex items-start gap-2.5">
                <AlertTriangle size={16} class="text-red-400 shrink-0 mt-0.5" />
                <div class="flex-1 leading-relaxed">
                  <span class="font-bold">Aviso de Micrófono:</span> {errorMessage()}
                </div>
              </div>

              <Show when={isInsecureOriginError()}>
                <div class="p-2.5 rounded-lg bg-black/40 border border-red-500/30 text-[11px] text-red-100/90 flex flex-col gap-2">
                  <span class="font-bold text-amber-300">
                    ¿Por qué ocurre esto en el teléfono y cómo solucionarlo?
                  </span>
                  <p class="leading-relaxed">
                    Por seguridad, los navegadores móviles desactivan <code class="font-mono text-white">navigator.mediaDevices.getUserMedia</code> cuando accedes por IP de red local con <code class="font-mono text-white">http://</code> en lugar de <code class="font-mono text-white">https://</code> o <code class="font-mono text-white">localhost</code>.
                  </p>
                  <div class="flex flex-col gap-1.5 pt-1">
                    <span class="font-semibold text-white">Solución rápida en Chrome (Android):</span>
                    <div class="flex flex-wrap items-center gap-1.5">
                      <span>1. Abre una pestaña y pega:</span>
                      <code class="px-1.5 py-0.5 rounded bg-black/60 font-mono text-[10px] text-amber-200 break-all">
                        chrome://flags/#unsafely-treat-insecure-origin-as-secure
                      </code>
                      <button
                        type="button"
                        onClick={() => copyTextHelper('chrome://flags/#unsafely-treat-insecure-origin-as-secure', 'flag')}
                        class="px-2 py-0.5 rounded bg-red-900/70 hover:bg-red-800 text-white font-semibold text-[10px] border border-red-400/40 cursor-pointer"
                      >
                        {copiedFlagItem() === 'flag' ? '¡Copiado!' : 'Copiar dirección flag'}
                      </button>
                    </div>
                    <div class="flex flex-wrap items-center gap-1.5">
                      <span>2. Añade esta URL en el cuadro de texto, cámbialo a <strong>Enabled</strong> y reinicia Chrome:</span>
                      <code class="px-1.5 py-0.5 rounded bg-black/60 font-mono text-[10px] text-emerald-300">
                        {typeof window !== 'undefined' ? window.location.origin : ''}
                      </code>
                      <button
                        type="button"
                        onClick={() => copyTextHelper(window.location.origin, 'origin')}
                        class="px-2 py-0.5 rounded bg-red-900/70 hover:bg-red-800 text-white font-semibold text-[10px] border border-red-400/40 cursor-pointer"
                      >
                        {copiedFlagItem() === 'origin' ? '¡Copiado!' : 'Copiar URL actual'}
                      </button>
                    </div>
                  </div>
                </div>
              </Show>
            </div>
          </Show>

          {/* Dedicated RtaPlot Component */}
          <RtaPlot
            isRecording={isRecording()}
            livePeakDb={livePeakDb()}
            theme={state.theme}
            captureMode={captureMode()}
            ref={(handle) => {
              rtaPlotHandle = handle;
            }}
          />

          {/* Active Noise Floor Calibration Banner (Shows when measuring 10s-30s in silence) */}
          <Show when={isMeasuringNoise()}>
            <div class="mx-3 sm:mx-5 my-2 p-3 sm:p-3.5 bg-amber-950/85 border border-amber-500/70 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 text-amber-100 shadow-xl animate-pulse">
              <div class="flex items-center gap-3">
                <div class="w-3.5 h-3.5 rounded-full bg-amber-400 animate-ping shrink-0" />
                <div class="flex flex-col">
                  <div class="flex items-center gap-2">
                    <VolumeX size={15} class="text-amber-400 shrink-0" />
                    <span class="font-bold text-xs text-amber-200">
                      Midiendo promedio de ruido de fondo ambiental ({noiseDuration()}s)...
                    </span>
                  </div>
                  <span class="text-[10px] text-amber-300/80">
                    Por favor mantén absoluto silencio en la sala y no reproduzcas ningún sonido.
                  </span>
                </div>
              </div>

              <div class="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
                <div class="flex-1 sm:w-36 bg-amber-900/60 rounded-full h-2.5 overflow-hidden border border-amber-600/50">
                  <div
                    class="bg-gradient-to-r from-amber-400 to-amber-300 h-full transition-all duration-200 rounded-full"
                    style={{ width: `${noiseProgress().percent}%` }}
                  />
                </div>
                <span class="font-mono text-xs font-bold text-amber-200 w-12 sm:w-14 text-right shrink-0">
                  {noiseProgress().elapsed.toFixed(1)}s
                </span>
                <button
                  type="button"
                  onClick={handleCancelNoiseCalibration}
                  class="px-2.5 py-1 bg-amber-900/80 hover:bg-amber-800 text-amber-200 rounded text-[11px] font-bold border border-amber-600/50 transition-colors cursor-pointer shrink-0"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </Show>

          {/* Controls Panel */}
          <div class="p-3 sm:p-5 bg-[var(--bg-panel)] flex flex-col gap-3 sm:gap-4">
            {/* Primary Action Buttons */}
            <div class="flex items-center justify-between gap-2.5 sm:gap-3 flex-wrap">
              <div class="flex items-center gap-2 flex-wrap">
                {/* Mic Start/Stop */}
                <button
                  onClick={() => (isRecording() ? stopMic() : startMic())}
                  class={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-bold text-xs transition-all shadow-md cursor-pointer ${isRecording()
                    ? 'bg-gradient-to-r from-[#FF0000] to-[#950101] hover:brightness-110 text-[#ffffff] shadow-[0_0_14px_rgba(255,0,0,0.5)] border border-[#FF0000]/50'
                    : 'bg-[var(--accent-blue)] hover:opacity-90 text-[#ffffff] shadow-[0_0_12px_rgba(0,85,255,0.4)]'
                    }`}
                >
                  {isRecording() ? <MicOff size={15} /> : <Mic size={15} />}
                  <span>{isRecording() ? 'Detener Micrófono' : 'Iniciar Micrófono'}</span>
                </button>

                {/* Mic Calibration */}
                <input
                  type="file"
                  ref={calInputRef}
                  accept=".txt,.csv"
                  class="hidden"
                  onChange={handleCalUpload}
                />
                <div class={`flex items-center h-full rounded-lg border transition-colors ${calFileName()
                  ? 'bg-[#002b18] border-[#00cc66]'
                  : 'bg-[var(--bg-surface)] border-[var(--border-contrast)] hover:border-[var(--accent-blue)]'
                  }`}>
                  <button
                    type="button"
                    onClick={() => calInputRef.click()}
                    class={`flex flex-col justify-center px-3 py-1.5 h-full cursor-pointer text-left ${calFileName()
                      ? 'text-[#00ff88]'
                      : 'text-[var(--text-main)]'
                      }`}
                    title={calFileName() ? `Archivo cargado: ${calFileName()}. Clic para cambiar archivo.` : "Cargar archivo de calibración del micrófono (ej. UMIK-1 o EMM-6 en formato TXT)"}
                  >
                    <span class="text-[9px] uppercase font-bold opacity-70">Calibración Mic</span>
                    <span class="text-[10px] truncate max-w-[110px] font-semibold">{calFileName() || 'Ninguna'}</span>
                  </button>
                  <Show when={calFileName()}>
                    <button
                      type="button"
                      onClick={handleClearCalibration}
                      class="px-2 h-full flex items-center justify-center text-[#00ff88] hover:text-red-400 hover:bg-red-950/40 border-l border-[#00cc66]/40 transition-colors cursor-pointer"
                      title="Quitar archivo de calibración actual"
                    >
                      <X size={12} />
                    </button>
                  </Show>
                </div>

                {/* Transfer Function Toggle */}
                <button
                  onClick={() => {
                    const next = !enableTransferFunction();
                    setEnableTransferFunction(next);
                    if (isRecording()) {
                      // Apply immediately without restarting
                      micAnalyzer.enableLiveTransferFunction = next;
                      micAnalyzer.setReferenceAnalyser(next ? audioPreview.referenceAnalyser : null);
                    }
                  }}
                  class={`flex flex-col justify-center px-3 py-1.5 h-full rounded-lg border transition-colors cursor-pointer text-left ${enableTransferFunction()
                    ? 'bg-[#1e102e] border-[#9b51e0] text-[#d6b3ff]'
                    : 'bg-[var(--bg-surface)] border-[var(--border-contrast)] hover:border-[var(--accent-blue)] text-[var(--text-main)]'
                    }`}
                  title="Mide la diferencia exacta entre el audio de entrada (Micro) y la salida (Fuente/Ruido). Inmune a errores de volumen absoluto."
                >
                  <span class="text-[9px] uppercase font-bold opacity-70">Transferencia Live</span>
                  <span class="text-[10px] font-bold">{enableTransferFunction() ? 'Activado' : 'Desactivado'}</span>
                </button>

                {/* Background Noise Floor Profile & Cancellation */}
                <div class="flex items-center rounded-lg border border-[var(--border-contrast)] bg-[var(--bg-surface)] overflow-visible">
                  <button
                    onClick={handleToggleNoiseCancellation}
                    disabled={isMeasuringNoise()}
                    class={`flex flex-col justify-center px-3 py-1.5 h-full rounded-l-lg transition-colors cursor-pointer text-left ${
                      isMeasuringNoise()
                        ? 'bg-amber-950/80 border-amber-500 text-amber-300'
                        : hasNoiseProfile() && noiseCancellationEnabled()
                          ? 'bg-[#002b18] text-[#00ff88]'
                          : hasNoiseProfile()
                            ? 'bg-[var(--bg-surface)] text-[var(--text-main)] hover:bg-[var(--border-contrast)]'
                            : 'bg-[var(--bg-surface)] hover:border-[var(--accent-blue)] text-[var(--text-main)]'
                    }`}
                    title={
                      isMeasuringNoise()
                        ? 'Midiendo ruido de fondo...'
                        : hasNoiseProfile()
                          ? `Anulación de ruido (${noiseAvgDb()} dB SPL): ${noiseCancellationEnabled() ? 'Activada' : 'Desactivada'}`
                          : 'Medir ruido de fondo en silencio durante 10s a 30s para anularlo'
                    }
                  >
                    <div class="flex items-center gap-1">
                      <span class="text-[9px] uppercase font-bold opacity-70">Ruido Fondo</span>
                      <Show when={hasNoiseProfile() && noiseCancellationEnabled()}>
                        <span class="w-1.5 h-1.5 rounded-full bg-[#00ff88] animate-pulse" />
                      </Show>
                    </div>
                    <span class="text-[10px] font-bold truncate max-w-[110px]">
                      {isMeasuringNoise()
                        ? `${noiseProgress().elapsed.toFixed(0)}s / ${noiseProgress().total}s`
                        : hasNoiseProfile()
                          ? (noiseCancellationEnabled() ? `Anulado (${noiseAvgDb()}dB)` : 'Inactivo')
                          : 'Sin Perfil (Medir)'}
                    </span>
                  </button>

                  <Popover
                    id="noise-floor-popover"
                    btnCloser={true}
                    mode="manual"
                    defaultEvents={false}
                    trigger={({ ref, toggle, isOpen }) => (
                      <button
                        ref={ref}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle();
                        }}
                        class={`px-2 py-2.5 rounded-r-lg border-l border-[var(--border-contrast)] transition-all cursor-pointer ${
                          isOpen()
                            ? 'bg-[var(--accent-blue-badge-bg)] text-[var(--accent-blue)]'
                            : 'hover:bg-[var(--border-contrast)] text-[var(--text-muted)] hover:text-[var(--text-pure)]'
                        }`}
                        title="Configurar y medir promedio de ruido de fondo (10s a 30s)"
                      >
                        <Sliders size={13} />
                      </button>
                    )}
                  >
                    {({ close }) => (
                      <div class="w-80 max-w-[calc(100vw-24px)] p-3.5 bg-[var(--bg-card)] border border-[var(--border-default)] rounded-xl shadow-2xl flex flex-col gap-3 text-xs select-none">
                        {/* Header */}
                        <div class="flex items-center justify-between pb-2 border-b border-[var(--border-default)]">
                          <div class="flex items-center gap-2">
                            <VolumeX size={15} class="text-[var(--accent-blue)]" />
                            <span class="font-bold text-[var(--text-pure)]">Anulación de Ruido de Fondo</span>
                          </div>
                        </div>

                        <p class="text-[11px] text-[var(--text-muted)] leading-relaxed">
                          Analiza el promedio acústico en silencio absoluto de 10s a 30s para anularlo por sustracción espectral en las grabaciones siguientes.
                        </p>

                        {/* Status if profile exists */}
                        <Show when={hasNoiseProfile()}>
                          <div class="p-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-contrast)] flex flex-col gap-1.5">
                            <div class="flex items-center justify-between text-[11px]">
                              <span class="text-[var(--text-muted)]">Nivel de ruido medio:</span>
                              <span class="font-mono font-bold text-[#00ff88]">~{noiseAvgDb()} dB SPL</span>
                            </div>
                            <div class="flex items-center justify-between gap-2 pt-1 border-t border-[var(--border-contrast)]/40">
                              <span class="text-[10px] text-[var(--text-muted)]">Anulación activa:</span>
                              <button
                                type="button"
                                onClick={() => {
                                  handleToggleNoiseCancellation();
                                }}
                                class={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors cursor-pointer ${
                                  noiseCancellationEnabled()
                                    ? 'bg-[#002b18] text-[#00ff88] border-[#00cc66]'
                                    : 'bg-[var(--bg-panel)] text-[var(--text-muted)] border-[var(--border-contrast)]'
                                }`}
                              >
                                {noiseCancellationEnabled() ? 'ACTIVADA' : 'DESACTIVADA'}
                              </button>
                            </div>
                          </div>
                        </Show>

                        {/* Duration Selector (10s to 30s) */}
                        <div class="flex flex-col gap-1.5">
                          <div class="flex items-center justify-between">
                            <span class="text-[11px] font-semibold text-[var(--text-muted)]">Tiempo de análisis en silencio:</span>
                            <span class="font-mono font-bold text-[var(--text-pure)]">{noiseDuration()}s</span>
                          </div>
                          <input
                            type="range"
                            min="10"
                            max="30"
                            step="1"
                            value={noiseDuration()}
                            disabled={isMeasuringNoise()}
                            onInput={(e) => {
                              const v = parseInt(e.currentTarget.value);
                              setNoiseDuration(v);
                              frActions.setMicSetting('noiseProfileDuration', v);
                            }}
                            class="w-full h-1.5 bg-[var(--border-contrast)] rounded appearance-none cursor-pointer accent-[var(--accent-blue)]"
                          />
                          <div class="flex items-center justify-between gap-1 pt-0.5">
                            {[10, 15, 20, 25, 30].map((sec) => (
                              <button
                                type="button"
                                disabled={isMeasuringNoise()}
                                onClick={() => {
                                  setNoiseDuration(sec);
                                  frActions.setMicSetting('noiseProfileDuration', sec);
                                }}
                                class={`flex-1 py-0.5 rounded text-[10px] font-mono font-semibold border transition-all cursor-pointer ${
                                  noiseDuration() === sec
                                    ? 'bg-[var(--accent-blue)] text-white border-[var(--accent-blue)] font-bold'
                                    : 'bg-[var(--bg-panel)] text-[var(--text-dim)] border-[var(--border-contrast)] hover:text-[var(--text-main)]'
                                }`}
                              >
                                {sec}s
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Action buttons inside popover */}
                        <div class="flex items-center gap-2 pt-2 border-t border-[var(--border-default)]">
                          <button
                            type="button"
                            onClick={() => {
                              handleStartNoiseCalibration();
                              close();
                            }}
                            disabled={isMeasuringNoise()}
                            class="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-[var(--accent-blue)] hover:opacity-90 text-white rounded font-bold text-[11px] transition-all cursor-pointer shadow-xs disabled:opacity-40"
                          >
                            <VolumeX size={13} />
                            <span>{hasNoiseProfile() ? 'Recalibrar Ruido' : 'Iniciar Calibración'}</span>
                          </button>

                          <Show when={hasNoiseProfile()}>
                            <button
                              type="button"
                              onClick={handleClearNoiseProfile}
                              class="px-2.5 py-1.5 bg-red-950/50 hover:bg-red-900/60 text-red-300 border border-red-500/30 rounded font-semibold text-[11px] transition-colors cursor-pointer"
                              title="Borrar perfil de ruido actual"
                            >
                              <Trash2 size={13} />
                            </button>
                          </Show>
                        </div>
                      </div>
                    )}
                  </Popover>
                </div>
              </div>

              {/* Acoustic Stimuli */}
              <div class="flex items-center gap-1.5 flex-wrap">
                {/* Ruido Rosa */}
                <button
                  onClick={togglePinkNoise}
                  disabled={!isRecording()}
                  class={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-semibold border transition-all cursor-pointer ${isPlayingPink()
                    ? 'bg-[#FFAA00] text-[#000000] border-[#FFAA00] shadow-[0_0_12px_rgba(255,170,0,0.4)]'
                    : 'bg-[var(--bg-surface)] hover:bg-[var(--border-contrast)] text-[var(--text-main)] border border-[var(--border-contrast)] disabled:opacity-40 disabled:cursor-not-allowed'
                    }`}
                  title="Reproduce ruido rosa continuo (-3 dB/octava) para medición acústica por bandas"
                >
                  <Volume2 size={14} />
                  <span>{isPlayingPink() ? 'Detener Rosa' : 'Ruido Rosa'}</span>
                </button>

                {/* Ruido Blanco */}
                <button
                  onClick={toggleWhiteNoise}
                  disabled={!isRecording()}
                  class={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-semibold border transition-all cursor-pointer ${isPlayingWhite()
                    ? 'bg-[#00D4FF] text-[#000000] border-[#00D4FF] shadow-[0_0_12px_rgba(0,212,255,0.4)]'
                    : 'bg-[var(--bg-surface)] hover:bg-[var(--border-contrast)] text-[var(--text-main)] border border-[var(--border-contrast)] disabled:opacity-40 disabled:cursor-not-allowed'
                    }`}
                  title="Reproduce ruido blanco con densidad espectral plana continua (todos los Hz por igual)"
                >
                  <Volume2 size={14} />
                  <span>{isPlayingWhite() ? 'Detener Blanco' : 'Ruido Blanco'}</span>
                </button>

                {/* Barrido Sine Sweep con Configuración Popover */}
                <div class="flex items-center rounded-lg border border-[var(--border-contrast)] bg-[var(--bg-surface)] overflow-visible">
                  {/* Play / Stop Sweep button */}
                  <button
                    onClick={toggleSweep}
                    disabled={!isRecording()}
                    class={`flex items-center gap-1.5 px-3 py-2 rounded-l-lg font-semibold transition-all cursor-pointer ${isPlayingSweep()
                      ? 'bg-[#00FF88] text-[#000000] shadow-[0_0_12px_rgba(0,255,136,0.4)] font-bold'
                      : 'hover:bg-[var(--border-contrast)] text-[var(--text-main)] disabled:opacity-40 disabled:cursor-not-allowed'
                      }`}
                    title={`Reproduce barrido senoidal continuo de ${sweepDuration()}s (${sweepStartFreq()} Hz - ${sweepEndFreq() >= 1000 ? `${(sweepEndFreq() / 1000).toFixed(sweepEndFreq() % 1000 === 0 ? 0 : 1)}k` : sweepEndFreq()} Hz, ${sweepType() === 'logarithmic' ? 'Logarítmico' : 'Lineal'})`}
                  >
                    <Radio size={14} class={isPlayingSweep() ? 'animate-pulse text-[#000000]' : ''} />
                    <span>
                      {isPlayingSweep()
                        ? 'Detener Sweep...'
                        : `Sweep (${sweepDuration()}s ${sweepType() === 'logarithmic' ? 'Log' : 'Lin'})`}
                    </span>
                  </button>

                  {/* Sweep Settings Popover */}
                  <Popover
                    id="sweep-config-popover"
                    btnCloser={true}
                    mode="manual"
                    trigger={({ ref, toggle, isOpen }) => (
                      <button
                        ref={ref}
                        type="button"
                        onClick={toggle}
                        class={`px-2 py-2 rounded-r-lg border-l border-[var(--border-contrast)] transition-all cursor-pointer ${isOpen()
                          ? 'bg-[var(--accent-blue-badge-bg)] text-[var(--accent-blue)]'
                          : 'hover:bg-[var(--border-contrast)] text-[var(--text-muted)] hover:text-[var(--text-pure)]'
                          }`}
                        title="Configurar frecuencias de inicio/fin (hasta 22 kHz), progresión y duración (hasta 30s)"
                      >
                        <Sliders size={13} />
                      </button>
                    )}
                  >
                    {() => (
                      <div class="w-80 max-w-[calc(100vw-24px)] p-3.5 bg-[var(--bg-card)] border border-[var(--border-default)] rounded-xl shadow-2xl flex flex-col gap-3 text-xs select-none">
                        {/* Header */}
                        <div class="flex items-center justify-between pb-2 border-b border-[var(--border-default)]">
                          <div class="flex items-center gap-2">
                            <Radio size={14} class="text-[var(--accent-blue)]" />
                            <span class="font-bold text-[var(--text-pure)]">Configurar Barrido Sweep</span>
                          </div>
                          <span class="text-[10px] font-mono text-[var(--text-muted)]">
                            {sweepStartFreq()} Hz - {sweepEndFreq() >= 1000 ? `${(sweepEndFreq() / 1000).toFixed(sweepEndFreq() % 1000 === 0 ? 0 : 1)}k` : sweepEndFreq()} Hz
                          </span>
                        </div>

                        {/* Tipo de Progresión */}
                        <div class="flex flex-col gap-1.5">
                          <span class="text-[11px] font-semibold text-[var(--text-muted)]">Tipo de Progresión:</span>
                          <div class="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setSweepType('logarithmic');
                                frActions.setMicSetting('sweepType', 'logarithmic');
                              }}
                              class={`flex flex-col items-center justify-center p-2 rounded-lg border text-center transition-all cursor-pointer ${sweepType() === 'logarithmic'
                                ? 'bg-[var(--accent-blue-badge-bg)] border-[var(--accent-blue)] text-[var(--accent-blue-badge-text)] font-bold shadow-xs ring-1 ring-[var(--accent-blue)]'
                                : 'bg-[var(--bg-panel)] border-[var(--border-contrast)] text-[var(--text-main)] hover:bg-[var(--bg-surface)]'
                                }`}
                            >
                              <span class="text-xs font-semibold">Logarítmico</span>
                              <span class="text-[9px] text-[var(--text-muted)]">Acústica estándar</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setSweepType('linear');
                                frActions.setMicSetting('sweepType', 'linear');
                              }}
                              class={`flex flex-col items-center justify-center p-2 rounded-lg border text-center transition-all cursor-pointer ${sweepType() === 'linear'
                                ? 'bg-[var(--accent-blue-badge-bg)] border-[var(--accent-blue)] text-[var(--accent-blue-badge-text)] font-bold shadow-xs ring-1 ring-[var(--accent-blue)]'
                                : 'bg-[var(--bg-panel)] border-[var(--border-contrast)] text-[var(--text-main)] hover:bg-[var(--bg-surface)]'
                                }`}
                            >
                              <span class="text-xs font-semibold">Lineal</span>
                              <span class="text-[9px] text-[var(--text-muted)]">Hz/seg constante</span>
                            </button>
                          </div>
                        </div>

                        {/* Frecuencia Inicial */}
                        <div class="flex flex-col gap-1.5 pt-2 border-t border-[var(--border-default)]">
                          <div class="flex items-center justify-between">
                            <span class="text-[11px] font-semibold text-[var(--text-muted)]">Frecuencia Inicial:</span>
                            <div class="flex items-center gap-1">
                              <input
                                type="number"
                                min="10"
                                max={Math.min(22000, sweepEndFreq() - 10)}
                                step="5"
                                value={sweepStartFreq()}
                                onInput={(e) => {
                                  const val = Math.max(10, Math.min(22000, parseInt(e.currentTarget.value) || 20));
                                  setSweepStartFreq(val);
                                  frActions.setMicSetting('sweepStartFreq', val);
                                }}
                                class="w-20 px-2 py-0.5 bg-[var(--bg-panel)] border border-[var(--border-contrast)] rounded text-right font-mono text-xs font-bold text-[var(--text-pure)] focus:outline-none focus:border-[var(--accent-blue)]"
                              />
                              <span class="text-[10px] text-[var(--text-muted)]">Hz</span>
                            </div>
                          </div>
                          <div class="flex items-center justify-between gap-1">
                            {[10, 20, 50, 100, 200].map((hz) => (
                              <button
                                type="button"
                                onClick={() => {
                                  setSweepStartFreq(hz);
                                  frActions.setMicSetting('sweepStartFreq', hz);
                                }}
                                class={`flex-1 py-0.5 rounded text-[10px] font-mono font-semibold border transition-all cursor-pointer ${sweepStartFreq() === hz
                                  ? 'bg-[var(--accent-blue)] text-white border-[var(--accent-blue)] shadow-2xs font-bold'
                                  : 'bg-[var(--bg-panel)] text-[var(--text-dim)] border-[var(--border-contrast)] hover:text-[var(--text-main)]'
                                  }`}
                              >
                                {hz}Hz
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Frecuencia Final (máx 22 kHz) */}
                        <div class="flex flex-col gap-1.5 pt-2 border-t border-[var(--border-default)]">
                          <div class="flex items-center justify-between">
                            <span class="text-[11px] font-semibold text-[var(--text-muted)]">Frecuencia Final (máx 22 kHz):</span>
                            <div class="flex items-center gap-1">
                              <input
                                type="number"
                                min={Math.max(20, sweepStartFreq() + 10)}
                                max="22000"
                                step="500"
                                value={sweepEndFreq()}
                                onInput={(e) => {
                                  const val = Math.max(20, Math.min(22000, parseInt(e.currentTarget.value) || 20000));
                                  setSweepEndFreq(val);
                                  frActions.setMicSetting('sweepEndFreq', val);
                                }}
                                class="w-20 px-2 py-0.5 bg-[var(--bg-panel)] border border-[var(--border-contrast)] rounded text-right font-mono text-xs font-bold text-[var(--text-pure)] focus:outline-none focus:border-[var(--accent-blue)]"
                              />
                              <span class="text-[10px] text-[var(--text-muted)]">Hz</span>
                            </div>
                          </div>
                          <div class="flex items-center justify-between gap-1">
                            {[
                              { label: '10k', hz: 10000 },
                              { label: '15k', hz: 15000 },
                              { label: '20k', hz: 20000 },
                              { label: '22k', hz: 22000 }
                            ].map((item) => (
                              <button
                                type="button"
                                onClick={() => {
                                  setSweepEndFreq(item.hz);
                                  frActions.setMicSetting('sweepEndFreq', item.hz);
                                }}
                                class={`flex-1 py-0.5 rounded text-[10px] font-mono font-semibold border transition-all cursor-pointer ${sweepEndFreq() === item.hz
                                  ? 'bg-[var(--accent-blue)] text-white border-[var(--accent-blue)] shadow-2xs font-bold'
                                  : 'bg-[var(--bg-panel)] text-[var(--text-dim)] border-[var(--border-contrast)] hover:text-[var(--text-main)]'
                                  }`}
                              >
                                {item.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Duración */}
                        <div class="flex flex-col gap-2 pt-2 border-t border-[var(--border-default)]">
                          <div class="flex items-center justify-between">
                            <span class="text-[11px] font-semibold text-[var(--text-muted)]">Duración del Barrido:</span>
                            <span class="font-mono font-bold text-[var(--text-pure)] text-xs">
                              {sweepDuration()} s
                            </span>
                          </div>

                          <input
                            type="range"
                            min="1"
                            max="30"
                            step="1"
                            value={sweepDuration()}
                            onInput={(e) => {
                              const val = parseInt(e.currentTarget.value);
                              setSweepDuration(val);
                              frActions.setMicSetting('sweepDuration', val);
                            }}
                            class="w-full h-1.5 bg-[var(--border-contrast)] rounded appearance-none cursor-pointer accent-[var(--accent-blue)]"
                          />

                          {/* Quick Presets */}
                          <div class="flex items-center justify-between gap-1 pt-0.5">
                            {[1, 3, 5, 10, 15, 20, 30].map((sec) => (
                              <button
                                type="button"
                                onClick={() => {
                                  setSweepDuration(sec);
                                  frActions.setMicSetting('sweepDuration', sec);
                                }}
                                class={`flex-1 py-0.5 rounded text-[10px] font-mono font-semibold border transition-all cursor-pointer ${sweepDuration() === sec
                                  ? 'bg-[var(--accent-blue)] text-white border-[var(--accent-blue)] shadow-2xs font-bold'
                                  : 'bg-[var(--bg-panel)] text-[var(--text-dim)] border-[var(--border-contrast)] hover:text-[var(--text-main)]'
                                  }`}
                              >
                                {sec}s
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </Popover>
                </div>
              </div>

              {/* Capture Input & Button */}
              <div class="flex items-center gap-1.5 flex-1 min-w-[220px]">
                <input
                  type="text"
                  placeholder={`Nombre de captura (ej: ${defaultCaptureName()})`}
                  value={captureNameInput()}
                  onInput={(e) => setCaptureNameInput(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCapture();
                  }}
                  disabled={!isRecording()}
                  class="flex-1 min-w-0 px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-contrast)] rounded-lg text-xs text-[var(--text-pure)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-blue)] disabled:opacity-40 transition-colors"
                />
                <button
                  onClick={handleCapture}
                  disabled={!isRecording()}
                  class={`flex items-center gap-1.5 px-4 py-2 rounded-lg font-bold transition-all cursor-pointer shrink-0 ${captureSuccess()
                    ? 'bg-[#00FF88] text-[#000000] shadow-[0_0_12px_rgba(0,255,136,0.4)]'
                    : 'bg-[var(--accent-blue)] hover:brightness-110 text-white disabled:opacity-40 disabled:cursor-not-allowed shadow-md'
                    }`}
                  title="Captura y añade a la bandeja de mediciones de la sesión con el nombre especificado"
                >
                  {captureSuccess() ? <Check size={15} /> : <Camera size={15} />}
                  <span>{captureSuccess() ? '¡Guardada!' : 'Capturar'}</span>
                </button>
              </div>
            </div>

            {/* Bandeja de Capturas de la Sesión */}
            <Show
              when={stagedCaptures().length > 0}
              fallback={
                <div class="px-3.5 py-2.5 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-default)] flex items-center justify-between text-xs text-[var(--text-muted)]">
                  <div class="flex items-center gap-2">
                    <Layers size={14} class="text-[var(--accent-blue)] shrink-0" />
                    <span>
                      Bandeja de capturas vacía. Asigna un nombre y presiona <strong class="text-[var(--text-pure)]">Capturar</strong> para acumular mediciones en esta sesión y luego importarlas o unificarlas en promedio.
                    </span>
                  </div>
                </div>
              }
            >
              <div class="p-3.5 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-default)] flex flex-col gap-3">
                {/* Header de la Bandeja */}
                <div class="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-[var(--border-default)]">
                  <div class="flex items-center gap-2">
                    <Layers size={15} class="text-[var(--accent-blue)]" />
                    <span class="text-xs font-bold text-[var(--text-pure)]">
                      Bandeja de Capturas de la Sesión ({stagedCaptures().length})
                    </span>
                    <span class="text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg-panel)] border border-[var(--border-contrast)] text-[var(--text-muted)] font-mono">
                      {selectedCapturesCount()} seleccionada{selectedCapturesCount() === 1 ? '' : 's'}
                    </span>
                  </div>

                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={toggleSelectAllCaptures}
                      class="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[var(--bg-panel)] hover:bg-[var(--border-contrast)] text-[var(--text-main)] border border-[var(--border-contrast)] text-[11px] font-semibold transition-colors cursor-pointer"
                    >
                      {areAllSelected() ? <CheckSquare size={13} class="text-[var(--accent-blue)]" /> : <Square size={13} />}
                      <span>{areAllSelected() ? 'Deseleccionar todas' : 'Seleccionar todas'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={clearAllCaptures}
                      class="flex items-center gap-1 px-2.5 py-1 rounded bg-red-950/40 hover:bg-red-900/60 text-red-300 border border-red-500/30 text-[11px] font-semibold transition-colors cursor-pointer"
                      title="Eliminar todas las capturas de la bandeja"
                    >
                      <Trash2 size={12} />
                      <span>Limpiar lista</span>
                    </button>
                  </div>
                </div>

                {/* Lista de Capturas Realizadas */}
                <div class="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
                  <For each={stagedCaptures()}>
                    {(cap) => (
                      <div
                        class={`flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 sm:gap-2.5 p-2 rounded-lg border transition-all ${
                          cap.selected
                            ? 'bg-[var(--bg-panel)] border-[var(--accent-blue-badge-border)] shadow-2xs'
                            : 'bg-[var(--bg-panel)]/50 border-[var(--border-contrast)] opacity-70'
                        }`}
                      >
                        <div class="flex items-center gap-2 flex-1 min-w-[180px]">
                          {/* Checkbox de selección */}
                          <input
                            type="checkbox"
                            checked={cap.selected}
                            onChange={() => toggleCaptureSelection(cap.id)}
                            class="w-4 h-4 rounded accent-[var(--accent-blue)] cursor-pointer shrink-0"
                            title="Seleccionar/Deseleccionar para importar o promediar"
                          />

                          {/* Indicador de color de la curva */}
                          <span
                            class="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ 'background-color': cap.color }}
                            title="Color asignado"
                          />

                          {/* Badge de modo de captura */}
                          <span class="text-[9px] px-1.5 py-0.5 rounded border font-mono font-semibold shrink-0 bg-[var(--bg-surface)] border-[var(--border-contrast)] text-[var(--text-muted)]">
                            {cap.mode === 'instant' && 'Instante'}
                            {cap.mode === 'peak' && 'Peak Hold'}
                            {cap.mode === 'average' && 'Promedio'}
                          </span>

                          {/* Nombre editable inline */}
                          <input
                            type="text"
                            value={cap.name}
                            onInput={(e) => {
                              cap.name = e.currentTarget.value;
                              updateCaptureName(cap.id, e.currentTarget.value);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.currentTarget.blur();
                              }
                            }}
                            class="flex-1 min-w-0 px-2 py-0.5 bg-[var(--bg-surface)] border border-[var(--border-contrast)] rounded text-xs text-[var(--text-pure)] font-medium focus:outline-none focus:border-[var(--accent-blue)]"
                            title="Haz clic para editar el nombre de esta medición"
                          />

                          {/* Marca de tiempo */}
                          <span class="text-[10px] text-[var(--text-dim)] font-mono shrink-0">
                            {new Date(cap.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>

                          <Show when={cap.imported}>
                            <span class="text-[9px] px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-500/30 font-semibold shrink-0">
                              Importada
                            </span>
                          </Show>
                        </div>

                        {/* Botones de acción individual */}
                        <div class="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => importSingleCapture(cap)}
                            class="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--bg-surface)] hover:bg-[var(--border-contrast)] text-[var(--text-pure)] border border-[var(--border-contrast)] text-[11px] font-semibold transition-colors cursor-pointer"
                            title="Importar únicamente esta curva al Auto EQ"
                          >
                            <Download size={11} class="text-[var(--accent-blue)]" />
                            <span>Importar</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => deleteCapture(cap.id)}
                            class="p-1 rounded text-[var(--text-muted)] hover:text-red-400 hover:bg-red-950/40 transition-colors cursor-pointer"
                            title="Eliminar esta captura de la bandeja"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    )}
                  </For>
                </div>

                {/* Barra de Acciones Globales: Importar seleccionadas o Unificar en promedio */}
                <div class="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-[var(--border-default)]">
                  {/* Nombre para la curva promediada */}
                  <div class="flex items-center gap-2 flex-1 min-w-[240px]">
                    <span class="text-[11px] text-[var(--text-muted)] font-semibold shrink-0">Nombre de Unificación:</span>
                    <input
                      type="text"
                      value={averageCurveName()}
                      onInput={(e) => setAverageCurveName(e.currentTarget.value)}
                      placeholder={`Promedio (${selectedCapturesCount()} mediciones)`}
                      class="flex-1 min-w-0 px-2.5 py-1 bg-[var(--bg-panel)] border border-[var(--border-contrast)] rounded text-xs text-[var(--text-pure)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-blue)]"
                    />
                  </div>

                  <div class="flex items-center gap-2 flex-wrap">
                    {/* Botón: Importar Seleccionadas */}
                    <button
                      type="button"
                      disabled={selectedCapturesCount() === 0}
                      onClick={importSelectedCaptures}
                      class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-panel)] hover:bg-[var(--border-contrast)] text-[var(--text-pure)] border border-[var(--border-contrast)] font-bold text-xs disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer shadow-xs"
                      title="Importa cada una de las capturas seleccionadas como curvas individuales en Auto EQ"
                    >
                      <Download size={13} class="text-[var(--accent-blue)]" />
                      <span>Importar Seleccionadas ({selectedCapturesCount()})</span>
                    </button>

                    {/* Botón: Importar Todas si no todas están seleccionadas */}
                    <Show when={selectedCapturesCount() < stagedCaptures().length}>
                      <button
                        type="button"
                        onClick={importAllCaptures}
                        class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--bg-panel)] hover:bg-[var(--border-contrast)] text-[var(--text-main)] border border-[var(--border-contrast)] font-semibold text-xs transition-all cursor-pointer"
                        title="Importa todas las capturas registradas"
                      >
                        <Download size={13} />
                        <span>Importar Todas ({stagedCaptures().length})</span>
                      </button>
                    </Show>

                    {/* Botón: Unificar en Promedio e Importar */}
                    <button
                      type="button"
                      disabled={selectedCapturesCount() === 0}
                      onClick={unifyAndAverageSelected}
                      class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#00FF88] text-[#000000] hover:brightness-105 font-bold text-xs disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer shadow-[0_0_12px_rgba(0,255,136,0.3)]"
                      title="Calcula el promedio de energía acústica RMS de las capturas seleccionadas y lo importa como una única curva unificada"
                    >
                      <Combine size={13} />
                      <span>Unificar en Promedio ({selectedCapturesCount()})</span>
                    </button>
                  </div>
                </div>

                {/* Mensaje de confirmación / Feedback */}
                <Show when={feedbackMessage()}>
                  <div class="px-3 py-1.5 rounded-lg bg-emerald-950/70 border border-emerald-500/40 text-emerald-200 text-xs flex items-center gap-2">
                    <Check size={14} class="text-emerald-400 shrink-0" />
                    <span>{feedbackMessage()}</span>
                  </div>
                </Show>
              </div>
            </Show>

            {/* Controles de Volumen por Canal (Left / Right) */}
            <div class="p-3 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-default)] flex flex-col gap-2.5">
              <div class="flex items-center justify-between flex-wrap gap-2">
                <div class="flex items-center gap-2">
                  <Volume2 size={14} class="text-[var(--accent-blue)]" />
                  <span class="text-xs font-bold text-[var(--text-pure)]">
                    Volumen de Salida por Canal (Left / Right):
                  </span>
                </div>

                {/* Quick Solo / Stereo / Link Controls */}
                <div class="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setChannelPreset(0.8, 0)}
                    class={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors cursor-pointer ${leftVolume() > 0 && rightVolume() === 0
                      ? 'bg-[var(--accent-blue-badge-bg)] text-[var(--accent-blue-badge-text)] border-[var(--accent-blue)]'
                      : 'bg-[var(--bg-panel)] text-[var(--text-muted)] border-[var(--border-contrast)] hover:text-[var(--text-pure)]'
                      }`}
                    title="Reproducir únicamente por el canal Izquierdo (Solo L)"
                  >
                    Solo L
                  </button>
                  <button
                    type="button"
                    onClick={() => setChannelPreset(0, 0.8)}
                    class={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors cursor-pointer ${rightVolume() > 0 && leftVolume() === 0
                      ? 'bg-[#002b18] text-[#00FF88] border-[#00FF88]'
                      : 'bg-[var(--bg-panel)] text-[var(--text-muted)] border-[var(--border-contrast)] hover:text-[var(--text-pure)]'
                      }`}
                    title="Reproducir únicamente por el canal Derecho (Solo R)"
                  >
                    Solo R
                  </button>
                  <button
                    type="button"
                    onClick={() => setChannelPreset(0.8, 0.8)}
                    class={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors cursor-pointer ${leftVolume() > 0 && rightVolume() > 0 && leftVolume() === rightVolume()
                      ? 'bg-[var(--bg-card)] text-[var(--text-pure)] border-[var(--border-contrast)]'
                      : 'bg-[var(--bg-panel)] text-[var(--text-muted)] border-[var(--border-contrast)] hover:text-[var(--text-pure)]'
                      }`}
                    title="Restablecer ambos canales L y R al 80%"
                  >
                    Estéreo (L+R)
                  </button>
                  <button
                    type="button"
                    onClick={() => setLinkedChannels(!linkedChannels())}
                    class={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border transition-colors cursor-pointer ${linkedChannels()
                      ? 'bg-[var(--accent-blue-badge-bg)] text-[var(--accent-blue-badge-text)] border-[var(--accent-blue)]'
                      : 'bg-[var(--bg-panel)] text-[var(--text-muted)] border-[var(--border-contrast)] hover:text-[var(--text-pure)]'
                      }`}
                    title={linkedChannels() ? 'Canales L y R enlazados' : 'Enlazar volumen L y R'}
                  >
                    {linkedChannels() ? <Link2 size={11} /> : <Link2Off size={11} />}
                    <span>{linkedChannels() ? 'Enlazados' : 'Independientes'}</span>
                  </button>
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Left Channel Slider */}
                <div class="flex items-center gap-2.5 p-2 bg-[var(--bg-panel)] rounded-lg border border-[var(--border-contrast)]">
                  <button
                    type="button"
                    onClick={() => updateLeftVolume(leftVolume() > 0 ? 0 : 0.8)}
                    class={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border transition-colors cursor-pointer shrink-0 ${leftVolume() === 0
                      ? 'bg-red-950/60 text-[#FF4444] border-red-500/40'
                      : 'bg-[var(--accent-blue-badge-bg)] text-[var(--accent-blue-badge-text)] border-[var(--accent-blue-badge-border)]'
                      }`}
                    title={leftVolume() === 0 ? 'Activar Canal Izquierdo (L)' : 'Silenciar Canal Izquierdo (L)'}
                  >
                    LEFT (L)
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={leftVolume()}
                    onInput={(e) => updateLeftVolume(parseFloat(e.currentTarget.value))}
                    class="flex-1 min-w-0 h-1.5 bg-[var(--border-contrast)] rounded appearance-none cursor-pointer accent-[var(--accent-blue)]"
                  />
                  <span class="font-mono text-[var(--text-pure)] font-bold w-10 text-right shrink-0">
                    {Math.round(leftVolume() * 100)}%
                  </span>
                </div>

                {/* Right Channel Slider */}
                <div class="flex items-center gap-2.5 p-2 bg-[var(--bg-panel)] rounded-lg border border-[var(--border-contrast)]">
                  <button
                    type="button"
                    onClick={() => updateRightVolume(rightVolume() > 0 ? 0 : 0.8)}
                    class={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border transition-colors cursor-pointer shrink-0 ${rightVolume() === 0
                      ? 'bg-red-950/60 text-[#FF4444] border-red-500/40'
                      : 'bg-[#002b18] text-[#00FF88] border-[#00cc66]/50'
                      }`}
                    title={rightVolume() === 0 ? 'Activar Canal Derecho (R)' : 'Silenciar Canal Derecho (R)'}
                  >
                    RIGHT (R)
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={rightVolume()}
                    onInput={(e) => updateRightVolume(parseFloat(e.currentTarget.value))}
                    class="flex-1 min-w-0 h-1.5 bg-[var(--border-contrast)] rounded appearance-none cursor-pointer accent-[#00FF88]"
                  />
                  <span class="font-mono text-[var(--text-pure)] font-bold w-10 text-right shrink-0">
                    {Math.round(rightVolume() * 100)}%
                  </span>
                </div>
              </div>
            </div>

            {/* Selector de Respuesta a Capturar (3 modos) */}
            <div class="p-3 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-default)] flex flex-col gap-2.5">
              <div class="flex items-center justify-between flex-wrap gap-2">
                <div class="flex items-center gap-2">
                  <Camera size={14} class="text-[var(--accent-blue)]" />
                  <span class="text-xs font-bold text-[var(--text-pure)]">
                    Respuesta a Capturar:
                  </span>
                  <span class="text-[10px] text-[var(--text-muted)]">
                    Selecciona cuál de las 3 mediciones se agregará como curva
                  </span>
                </div>
                <div class="text-[10px] font-mono text-[var(--text-muted)]">
                  Modo activo:{' '}
                  <span class="font-bold text-[var(--text-pure)]">
                    {captureMode() === 'instant' && 'En ese instante'}
                    {captureMode() === 'peak' && 'Umbral Máximo (Peak Hold)'}
                    {captureMode() === 'average' && `Promedio (${averageCount()} muestras)`}
                  </span>
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                {/* 1. En ese instante */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setCaptureMode('instant');
                    frActions.setMicSetting('captureMode', 'instant');
                  }}
                  class={`p-2.5 rounded-lg border flex flex-col justify-between gap-2.5 cursor-pointer transition-all ${captureMode() === 'instant'
                    ? 'bg-[var(--accent-blue-badge-bg)] border-[var(--accent-blue)] shadow-xs ring-1 ring-[var(--accent-blue)]'
                    : 'bg-[var(--bg-panel)] border-[var(--border-contrast)] hover:border-[var(--text-dim)] hover:bg-[var(--bg-surface)]'
                    }`}
                >
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <Zap
                        size={15}
                        class={captureMode() === 'instant' ? 'text-[var(--accent-blue)]' : 'text-[var(--text-muted)]'}
                      />
                      <span class="font-bold text-xs text-[var(--text-pure)]">En ese instante</span>
                    </div>
                    <div
                      class={`w-4 h-4 rounded-full border flex items-center justify-center ${captureMode() === 'instant'
                        ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)] text-white'
                        : 'border-[var(--border-contrast)] bg-transparent'
                        }`}
                    >
                      {captureMode() === 'instant' && <Check size={10} strokeWidth={3} />}
                    </div>
                  </div>
                  <p class="text-[10px] text-[var(--text-muted)] leading-relaxed">
                    Captura puntual del espectro acústico en el momento exacto del clic.
                  </p>
                  <div class="text-[9px] font-mono text-[var(--text-dim)] pt-1 border-t border-[var(--border-contrast)]/40">
                    Instantánea en tiempo real
                  </div>
                </div>

                {/* 2. Umbral Máximo (con botón de reset) */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setCaptureMode('peak');
                    frActions.setMicSetting('captureMode', 'peak');
                  }}
                  class={`p-2.5 rounded-lg border flex flex-col justify-between gap-2.5 cursor-pointer transition-all ${captureMode() === 'peak'
                    ? 'shadow-xs ring-1'
                    : 'bg-[var(--bg-panel)] border-[var(--border-contrast)] hover:border-[var(--text-dim)] hover:bg-[var(--bg-surface)]'
                    }`}
                  style={
                    captureMode() === 'peak'
                      ? {
                        'border-color': maxHoldColor(),
                        '--tw-ring-color': maxHoldColor(),
                        'background-color': `${maxHoldColor()}18`
                      }
                      : {}
                  }
                >
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <TrendingUp
                        size={15}
                        style={{ color: maxHoldColor() }}
                      />
                      <span class="font-bold text-xs text-[var(--text-pure)]">Umbral Máximo</span>
                    </div>
                    <div
                      class="w-4 h-4 rounded-full border flex items-center justify-center transition-all"
                      style={
                        captureMode() === 'peak'
                          ? {
                            'border-color': maxHoldColor(),
                            'background-color': maxHoldColor(),
                            color: '#000000'
                          }
                          : {
                            'border-color': 'var(--border-contrast)',
                            'background-color': 'transparent'
                          }
                      }
                    >
                      {captureMode() === 'peak' && <Check size={10} strokeWidth={3} />}
                    </div>
                  </div>
                  <p class="text-[10px] text-[var(--text-muted)] leading-relaxed">
                    Registra y mantiene la envolvente de picos máximos por frecuencia.
                  </p>
                  <div class="flex items-center justify-between pt-1 border-t border-[var(--border-contrast)]/40">
                    <span class="text-[9px] font-mono font-semibold" style={{ color: maxHoldColor() }}>
                      Peak Hold
                    </span>
                    <button
                      type="button"
                      onClick={handleResetMaxHold}
                      title="Reiniciar envolvente de umbral máximo a los valores actuales"
                      class="flex items-center gap-1 px-2.5 py-0.5 rounded bg-[var(--bg-surface)] text-[10px] font-bold transition-all cursor-pointer shadow-2xs border"
                      style={{
                        color: maxHoldColor(),
                        'border-color': `${maxHoldColor()}60`
                      }}
                    >
                      <RotateCcw size={11} />
                      <span>Reset</span>
                    </button>
                  </div>
                </div>

                {/* 3. Promedio (con botón de reset) */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setCaptureMode('average');
                    frActions.setMicSetting('captureMode', 'average');
                  }}
                  class={`p-2.5 rounded-lg border flex flex-col justify-between gap-2.5 cursor-pointer transition-all ${captureMode() === 'average'
                    ? 'shadow-xs ring-1'
                    : 'bg-[var(--bg-panel)] border-[var(--border-contrast)] hover:border-[var(--text-dim)] hover:bg-[var(--bg-surface)]'
                    }`}
                  style={
                    captureMode() === 'average'
                      ? {
                        'border-color': averageColor(),
                        '--tw-ring-color': averageColor(),
                        'background-color': `${averageColor()}18`
                      }
                      : {}
                  }
                >
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <BarChart2
                        size={15}
                        style={{ color: averageColor() }}
                      />
                      <span class="font-bold text-xs text-[var(--text-pure)]">Promedio</span>
                    </div>
                    <div
                      class="w-4 h-4 rounded-full border flex items-center justify-center transition-all"
                      style={
                        captureMode() === 'average'
                          ? {
                            'border-color': averageColor(),
                            'background-color': averageColor(),
                            color: '#000000'
                          }
                          : {
                            'border-color': 'var(--border-contrast)',
                            'background-color': 'transparent'
                          }
                      }
                    >
                      {captureMode() === 'average' && <Check size={10} strokeWidth={3} />}
                    </div>
                  </div>
                  <p class="text-[10px] text-[var(--text-muted)] leading-relaxed">
                    Integración continua energética RMS de presión sonora (Leq).
                  </p>
                  <div class="flex items-center justify-between pt-1 border-t border-[var(--border-contrast)]/40">
                    <span class="text-[9px] font-mono font-semibold" style={{ color: averageColor() }}>
                      {averageCount()} pts ({((averageCount() * 16.6) / 1000).toFixed(1)}s)
                    </span>
                    <button
                      type="button"
                      onClick={handleResetAverage}
                      title="Reiniciar contador y acumulador del promedio continuo"
                      class="flex items-center gap-1 px-2.5 py-0.5 rounded bg-[var(--bg-surface)] text-[10px] font-bold transition-all cursor-pointer shadow-2xs border"
                      style={{
                        color: averageColor(),
                        'border-color': `${averageColor()}60`
                      }}
                    >
                      <RotateCcw size={11} />
                      <span>Reset</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Input Device & Calibration Settings */}
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-[var(--border-default)]">
              {/* Device Selector */}
              <div class="flex items-center gap-2 p-2.5 bg-[var(--bg-surface)] rounded-lg border border-[var(--border-default)] min-w-0">
                <Settings2 size={15} class="text-[var(--text-muted)] shrink-0" />
                <span class="text-[var(--text-muted)] font-medium shrink-0">Dispositivo:</span>
                <div class="flex-1 min-w-0 flex items-center gap-1.5">
                  <select
                    class="w-full min-w-0 bg-[var(--bg-panel)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded px-2 py-1 text-xs outline-none cursor-pointer truncate"
                    value={selectedDeviceId()}
                    onChange={async (e) => {
                      const newId = e.currentTarget.value;
                      setSelectedDeviceId(newId);
                      frActions.setMicSetting('selectedDeviceId', newId);
                      if (isRecording()) {
                        await micAnalyzer.switchDevice(newId);
                      }
                    }}
                  >
                    <Show when={devices().length === 0}>
                      <option value="">Micrófono predeterminado del sistema</option>
                    </Show>
                    <For each={devices()}>
                      {(dev, index) => (
                        <option value={dev.deviceId}>
                          {dev.label ||
                            `Micrófono ${index() + 1} (${dev.deviceId ? dev.deviceId.substring(0, 8) + '...' : 'Predeterminado'})`}
                        </option>
                      )}
                    </For>
                  </select>
                  <button
                    type="button"
                    onClick={refreshDevices}
                    class="p-1 text-[var(--text-muted)] hover:text-[var(--text-pure)] hover:bg-[var(--border-contrast)] rounded transition-all shrink-0 cursor-pointer"
                    title="Recargar lista de micrófonos detectados"
                  >
                    <RefreshCw size={13} class={isRefreshing() ? 'animate-spin text-[var(--accent-blue)]' : ''} />
                  </button>
                </div>
              </div>

              {/* Calibration SPL Offset Slider */}
              <div class="flex items-center gap-3 p-2.5 bg-[var(--bg-surface)] rounded-lg border border-[var(--border-default)] min-w-0">
                <span class="text-[var(--text-muted)] font-medium shrink-0">Calibración SPL:</span>
                <input
                  type="range"
                  min="40"
                  max="130"
                  step="1"
                  value={calOffset()}
                  onInput={(e) => {
                    const val = parseInt(e.currentTarget.value);
                    setCalOffset(val);
                    micAnalyzer.calibrationOffset = val;
                    frActions.setMicSetting('calOffset', val);
                  }}
                  class="flex-1 min-w-0 h-1.5 bg-[var(--border-contrast)] rounded appearance-none cursor-pointer accent-[var(--accent-blue)]"
                />
                <span class="font-mono text-[var(--text-main)] font-bold w-16 text-right shrink-0">
                  +{calOffset()} dB
                </span>
              </div>
            </div>

            {/* Advanced FFT & Window Function Settings */}
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-[var(--border-default)]">
              {/* FFT Size / Resolution Selector */}
              <div class="flex flex-col gap-1.5 p-2.5 bg-[var(--bg-surface)] rounded-lg border border-[var(--border-default)] min-w-0">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-1.5">
                    <Sliders size={13} class="text-[var(--text-muted)]" />
                    <span class="text-[var(--text-muted)] font-medium text-[11px]">Resolución FFT:</span>
                  </div>
                  <Show when={compositeFft()}>
                    <span class="text-[9px] px-1.5 py-0.2 bg-[var(--accent-blue-badge-bg)] text-[var(--accent-blue-badge-text)] rounded border border-[var(--accent-blue-badge-border)] font-bold">
                      MTW Auto
                    </span>
                  </Show>
                </div>
                <select
                  disabled={compositeFft()}
                  class={`w-full min-w-0 bg-[var(--bg-panel)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded px-2 py-1 text-xs outline-none cursor-pointer truncate ${compositeFft() ? 'opacity-40 cursor-not-allowed' : ''
                    }`}
                  value={fftSize()}
                  onChange={(e) => {
                    const val = parseInt(e.currentTarget.value);
                    setFftSize(val);
                    micAnalyzer.setFftSize(val);
                    frActions.setMicSetting('fftSize', val);
                  }}
                  title={compositeFft() ? 'La resolución se gestiona automáticamente por bandas en modo MTW' : 'Ajusta el tamaño del búfer FFT'}
                >
                  <For each={FFT_RESOLUTIONS}>
                    {(res) => (
                      <option value={res.size}>
                        {res.size} pts • {res.binWidth48k}
                      </option>
                    )}
                  </For>
                </select>
              </div>

              {/* Multi-FFT Compuesta (MTW) Toggle */}
              <div class="flex flex-col gap-1.5 p-2.5 bg-[var(--bg-surface)] rounded-lg border border-[var(--border-default)] min-w-0">
                <div class="flex items-center gap-1.5">
                  <Layers size={13} class={compositeFft() ? 'text-[var(--accent-blue)]' : 'text-[var(--text-muted)]'} />
                  <span class="text-[var(--text-muted)] font-medium text-[11px]">Multi-FFT Compuesta:</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !compositeFft();
                    setCompositeFft(next);
                    micAnalyzer.setCompositeFft(next);
                    frActions.setMicSetting('compositeFft', next);
                  }}
                  class={`flex-1 flex items-center justify-between px-2 py-1 rounded border text-xs font-semibold transition-all cursor-pointer ${compositeFft()
                    ? 'bg-[var(--accent-blue-badge-bg)] text-[var(--accent-blue-badge-text)] border-[var(--accent-blue-badge-border)] shadow-xs'
                    : 'bg-[var(--bg-panel)] text-[var(--text-dim)] border-[var(--border-contrast)] hover:text-[var(--text-main)]'
                    }`}
                  title="Multi-Time Window (MTW): divide el espectro en 16k en sub-graves (<200Hz), 4k en medios y 1k en agudos (>2.5kHz) con transición suave sin latencia"
                >
                  <span class="truncate">
                    {compositeFft() ? 'Activada (16k / 4k / 1k)' : 'Desactivada (FFT Única)'}
                  </span>
                  <span
                    class="w-2 h-2 rounded-full shrink-0"
                    style={{ 'background-color': compositeFft() ? '#00FF88' : '#777777' }}
                  />
                </button>
              </div>

              {/* Window Function Selector */}
              <div class="flex flex-col gap-1.5 p-2.5 bg-[var(--bg-surface)] rounded-lg border border-[var(--border-default)] min-w-0">
                <div class="flex items-center justify-between">
                  <span class="text-[var(--text-muted)] font-medium text-[11px]">Función de Ventana:</span>
                  <span class="text-[9px] text-[var(--text-dim)] font-mono">
                    {windowFunction() === 'standard' ? 'C++ DSP' : 'Custom'}
                  </span>
                </div>
                <select
                  class="w-full min-w-0 bg-[var(--bg-panel)] text-[var(--text-main)] border border-[var(--border-contrast)] rounded px-2 py-1 text-xs outline-none cursor-pointer truncate"
                  value={windowFunction()}
                  onChange={(e) => {
                    const val = e.currentTarget.value as WindowFunctionType;
                    setWindowFunction(val);
                    micAnalyzer.setWindowFunction(val);
                    frActions.setMicSetting('windowFunction', val);
                  }}
                  title="Ajusta el perfil de apodización matemática para minimizar fuga espectral"
                >
                  <For each={AVAILABLE_WINDOWS}>
                    {(win) => (
                      <option value={win.id} title={win.description}>
                        {win.label}
                      </option>
                    )}
                  </For>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
