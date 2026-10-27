import { For, Show } from 'solid-js';
import { Popover } from './Popover';
import { Check, Palette, Eye } from 'lucide-solid';

export interface ColorPickerPopoverProps {
  color: string;
  onChange: (newColor: string) => void;
  title?: string;
  align?: 'left' | 'right';
  size?: 'sm' | 'md';
  showPipette?: boolean;
}

// Convert any color format (oklab, rgb, hex with/without alpha) to standard 6-digit hex for <input type="color">
export function colorToHex(color: string): string {
  if (!color) return '#4b83db';
  const c = color.trim().toLowerCase();

  if (c.startsWith('#')) {
    let hex = c.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex.split('').map(x => x + x).join('');
    }
    if (hex.length >= 6) return '#' + hex.slice(0, 6);
  }

  if (c.startsWith('rgb')) {
    const match = c.match(/\d+/g);
    if (match && match.length >= 3) {
      const r = Math.min(255, parseInt(match[0])).toString(16).padStart(2, '0');
      const g = Math.min(255, parseInt(match[1])).toString(16).padStart(2, '0');
      const b = Math.min(255, parseInt(match[2])).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
    }
  }

  if (c.includes('oklab') || c.includes('oklch')) {
    if (c.includes('-0.136') || c.includes('250')) return '#4b83db'; // Cobalt
    if (c.includes('-0.100') || c.includes('245')) return '#76a3e5'; // Sky
    if (c.includes('-0.056') || c.includes('240')) return '#a7c3ef'; // Ice
    if (c.includes('-0.120') || c.includes('185')) return '#3ec9a7'; // Mint
    if (c.includes('0.135') || c.includes('75')) return '#e5a84b';  // Amber
    if (c.includes('0.169') || c.includes('20')) return '#e05d6d';  // Coral
  }

  if (c === 'white') return '#ffffff';
  if (c === 'black') return '#000000';

  return '#4b83db';
}

/**
 * Parses any color string and extracts the base 6-digit hex along with its alpha value (0 to 1)
 */
export function extractColorAndAlpha(color: string): { baseHex: string; alpha: number } {
  if (!color) return { baseHex: '#4b83db', alpha: 1 };
  const c = color.trim().toLowerCase();

  // 1. Hex format (#RGB, #RGBA, #RRGGBB, #RRGGBBAA)
  if (c.startsWith('#')) {
    let hex = c.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex.split('').map(x => x + x).join('');
    }
    if (hex.length >= 8) {
      const base = '#' + hex.slice(0, 6);
      const a = parseInt(hex.slice(6, 8), 16) / 255;
      return { baseHex: base, alpha: Math.round(a * 100) / 100 };
    }
    if (hex.length >= 6) {
      return { baseHex: '#' + hex.slice(0, 6), alpha: 1 };
    }
  }

  // 2. RGBA / RGB format
  if (c.startsWith('rgb')) {
    const match = c.match(/[\d.]+/g);
    if (match && match.length >= 3) {
      const r = Math.min(255, parseInt(match[0])).toString(16).padStart(2, '0');
      const g = Math.min(255, parseInt(match[1])).toString(16).padStart(2, '0');
      const b = Math.min(255, parseInt(match[2])).toString(16).padStart(2, '0');
      const a = match[3] !== undefined ? Math.max(0, Math.min(1, parseFloat(match[3]))) : 1;
      return { baseHex: `#${r}${g}${b}`, alpha: Math.round(a * 100) / 100 };
    }
  }

  // 3. Fallback (e.g. oklab, named colors)
  const hex = colorToHex(c);
  return { baseHex: hex, alpha: 1 };
}

/**
 * Combines a base 6-digit hex string with an alpha fraction (0 to 1) into a standard CSS hex string
 */
export function buildColorWithAlpha(baseHex6: string, alpha: number): string {
  const cleanHex = baseHex6.startsWith('#') ? baseHex6 : `#${baseHex6}`;
  const hex6 = cleanHex.slice(0, 7).toLowerCase();
  const clampedAlpha = Math.max(0.02, Math.min(1, alpha));
  if (clampedAlpha >= 0.995) {
    return hex6;
  }
  const alphaHex = Math.round(clampedAlpha * 255).toString(16).padStart(2, '0').toLowerCase();
  return `${hex6}${alphaHex}`;
}

export function ColorPickerPopover(props: ColorPickerPopoverProps) {
  // Curated swatches list combining Studio Cobalt, Crimson, and High-Contrast markers
  const swatches = [
    { name: 'Cobalto Estudio', value: 'oklab(0.62 -0.050 -0.136)' },
    { name: 'Cerúleo Cielo', value: 'oklab(0.72 -0.046 -0.100)' },
    { name: 'Acero Frío', value: 'oklab(0.82 -0.033 -0.056)' },
    { name: 'Blanco Puro', value: '#FFFFFF' },
    { name: 'Gris Neutro', value: '#C5C6C0' },
    { name: 'Menta Acústica', value: 'oklab(0.72 -0.120 -0.010)' },
    { name: 'Verde Esmeralda', value: '#00FF88' },
    { name: 'Ámbar Cálido', value: 'oklab(0.75 0.036 0.135)' },
    { name: 'Carmesí Vivo', value: '#FF0000' },
    { name: 'Carmesí Sangre', value: '#950101' },
    { name: 'Vino Oscuro', value: '#3D0000' },
    { name: 'Coral Suave', value: 'oklab(0.65 0.169 0.062)' }
  ];

  const parsed = () => extractColorAndAlpha(props.color);
  const currentBaseHex = () => parsed().baseHex;
  const currentAlpha = () => parsed().alpha;
  const currentAlphaPct = () => Math.round(currentAlpha() * 100);

  const isCurrentSwatch = (swatchValue: string) => {
    const swatchHex = colorToHex(swatchValue);
    return currentBaseHex().toLowerCase() === swatchHex.toLowerCase();
  };

  const handleSwatchSelect = (swatchValue: string) => {
    const hex = colorToHex(swatchValue);
    props.onChange(buildColorWithAlpha(hex, currentAlpha()));
  };

  const handleBaseHexChange = (hex6: string) => {
    props.onChange(buildColorWithAlpha(hex6, currentAlpha()));
  };

  const handleAlphaChange = (alpha: number) => {
    props.onChange(buildColorWithAlpha(currentBaseHex(), alpha));
  };

  const checkerboardStyle = {
    'background-image': 'repeating-conic-gradient(rgba(128, 128, 128, 0.22) 0% 25%, transparent 0% 50%)',
    'background-size': '8px 8px'
  };

  return (
    <Popover
      mode="manual"
      defaultEvents={false}
      trigger={(triggerProps) => (
        <button
          ref={triggerProps.ref}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            triggerProps.toggle();
          }}
          class={`group relative rounded-full shrink-0 border border-[var(--border-contrast)] transition-all hover:scale-110 active:scale-95 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)] overflow-visible after:content-[''] after:absolute after:-inset-1.5 ${
            props.size === 'sm' ? 'w-3.5 h-3.5 sm:w-3 sm:h-3' : 'w-4 h-4'
          }`}
          style={checkerboardStyle}
          title="Cambiar color y opacidad de curva"
          aria-label="Cambiar color y opacidad de curva"
        >
          <span
            class="absolute inset-0 rounded-full"
            style={{ 'background-color': props.color }}
          />
          <span class="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 bg-white/20 transition-opacity" />
        </button>
      )}
      btnCloser
    >
      {() => (
        <div class="p-3 rounded-lg bg-[var(--bg-modal)] border border-[var(--border-contrast)] flex flex-col gap-2.5 w-64 max-w-[calc(100vw-24px)] select-none shadow-xl">
          {/* Header */}
          <div class="flex items-center justify-between border-b border-[var(--border-default)] pb-1.5 pr-6">
            <span class="text-[11px] font-bold text-[var(--text-pure)] tracking-wide">
              {props.title || 'Color y Opacidad'}
            </span>
          </div>

          {/* Palette Swatches Grid */}
          <div class="grid grid-cols-6 gap-1.5">
            <For each={swatches}>
              {(swatch) => {
                const selected = () => isCurrentSwatch(swatch.value);

                return (
                  <button
                    type="button"
                    onClick={() => handleSwatchSelect(swatch.value)}
                    class={`w-7 h-7 rounded-md border transition-all flex items-center justify-center hover:scale-105 relative cursor-pointer ${
                      selected()
                        ? 'border-[var(--text-pure)] ring-2 ring-[var(--accent-blue)] shadow-xs scale-105'
                        : 'border-[var(--border-default)] hover:border-[var(--border-contrast)]'
                    }`}
                    style={{ 'background-color': swatch.value }}
                    title={`${swatch.name} (manteniendo ${currentAlphaPct()}% de opacidad)`}
                  >
                    <Show when={selected()}>
                      <Check
                        size={13}
                        class={
                          swatch.value.toLowerCase() === '#ffffff' || swatch.value.includes('0.82')
                            ? 'text-black'
                            : 'text-white'
                        }
                      />
                    </Show>
                  </button>
                );
              }}
            </For>
          </div>

          {/* Custom Base Color Picker */}
          <div class="pt-2 border-t border-[var(--border-default)] flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
              <Palette size={13} />
              <span>Color base:</span>
            </div>

            <div class="flex items-center gap-1.5">
              <input
                type="color"
                value={currentBaseHex()}
                onInput={(e) => handleBaseHexChange(e.currentTarget.value)}
                class="w-6 h-6 rounded cursor-pointer border border-[var(--border-contrast)] bg-transparent p-0 outline-none"
                title="Selector libre de color base"
              />
              <span class="font-mono text-[10px] text-[var(--text-main)] uppercase font-semibold">
                {currentBaseHex()}
              </span>
            </div>
          </div>

          {/* Opacity (Alpha) Slider */}
          <div class="pt-1.5 flex flex-col gap-1.5 border-t border-[var(--border-default)]">
            <div class="flex items-center justify-between text-[11px]">
              <div class="flex items-center gap-1.5 text-[var(--text-muted)]">
                <Eye size={12} class="text-[var(--accent-blue)]" />
                <span>Opacidad:</span>
              </div>
              <span class="font-mono text-[11px] font-bold text-[var(--text-pure)]">
                {currentAlphaPct()}%
              </span>
            </div>

            {/* Range slider with checkerboard and gradient track */}
            <div class="relative w-full h-4 rounded flex items-center overflow-hidden border border-[var(--border-contrast)]" style={checkerboardStyle}>
              <div
                class="absolute inset-0 pointer-events-none"
                style={{
                  background: `linear-gradient(to right, transparent, ${currentBaseHex()})`
                }}
              />
              <input
                type="range"
                min="5"
                max="100"
                step="1"
                value={currentAlphaPct()}
                onInput={(e) => handleAlphaChange(parseInt(e.currentTarget.value) / 100)}
                class="relative w-full h-full opacity-80 hover:opacity-100 cursor-pointer appearance-none bg-transparent accent-[var(--accent-blue)] outline-none z-10"
                title={`Opacidad: ${currentAlphaPct()}%`}
              />
            </div>

            {/* Quick Opacity Preset Pills */}
            <div class="flex items-center justify-between gap-1 pt-0.5">
              <For each={[25, 50, 75, 100]}>
                {(pct) => (
                  <button
                    type="button"
                    onClick={() => handleAlphaChange(pct / 100)}
                    class={`flex-1 py-0.5 rounded text-[10px] font-mono font-semibold border transition-all ${
                      currentAlphaPct() === pct
                        ? 'bg-[var(--accent-blue)] text-white border-[var(--accent-blue)]'
                        : 'bg-[var(--bg-surface)] text-[var(--text-muted)] border-[var(--border-contrast)] hover:text-[var(--text-main)] hover:bg-[var(--border-contrast)]'
                    }`}
                  >
                    {pct}%
                  </button>
                )}
              </For>
            </div>
          </div>

          {/* Live Preview Tile & Hex Code */}
          <div class="pt-2 border-t border-[var(--border-default)] flex items-center justify-between">
            <div class="flex items-center gap-2">
              <div
                class="w-6 h-6 rounded border border-[var(--border-contrast)] overflow-hidden relative shadow-inner shrink-0"
                style={checkerboardStyle}
              >
                <div
                  class="absolute inset-0"
                  style={{ 'background-color': props.color }}
                />
              </div>
              <span class="text-[10px] text-[var(--text-muted)]">Vista previa</span>
            </div>

            <span class="font-mono text-[10px] text-[var(--text-main)] uppercase font-bold bg-[var(--bg-surface)] px-1.5 py-0.5 rounded border border-[var(--border-contrast)]">
              {buildColorWithAlpha(currentBaseHex(), currentAlpha())}
            </span>
          </div>
        </div>
      )}
    </Popover>
  );
}
