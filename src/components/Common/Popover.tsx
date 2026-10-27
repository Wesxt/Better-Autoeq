import { createSignal, createEffect, onCleanup, onMount, Show, type JSX } from 'solid-js'
import { X } from 'lucide-solid'

export interface PopoverProps {
  id?: string | number
  className?: string
  class?: string
  mode?: 'auto' | 'manual' | 'hint'
  width?: number | string
  height?: number | string
  isOpen?: boolean
  anchor?: HTMLElement | null
  btnCloser?: boolean
  btnOpener?: boolean
  defaultEvents?: boolean
  onOpen?: () => void
  onClose?: () => void
  trigger?:
    | JSX.Element
    | ((props: {
        ref: (el: HTMLElement) => void
        isOpen: () => boolean
        toggle: () => void
        open: () => void
        close: () => void
      }) => JSX.Element)
  children: JSX.Element | ((props: { close: () => void; isOpen: () => boolean }) => JSX.Element)
}

/**
 * Componente declarativo Popover basado en la API nativa de Popover (HTML5 Popover API)
 * Incorpora posicionamiento dinámico, auto-flip vertical, seguimiento rAF,
 * y soporte unificado para interacción tanto por hover (tipo tooltip) como persistente con btnCloser.
 */
export function Popover(props: PopoverProps) {
  let triggerEl: HTMLElement | null = null
  let popoverEl: HTMLElement | null = null
  let animationFrameId: number | null = null
  let idTimeoutForSlowHidePopover: any = null

  const [internalOpen, setInternalOpen] = createSignal(false)

  const mode = () => props.mode || 'auto'
  const isControlled = () => typeof props.isOpen === 'boolean'
  const isOpen = () => (isControlled() ? props.isOpen! : internalOpen())
  const hasDefaultEvents = () => props.defaultEvents ?? (mode() !== 'manual' && !props.btnCloser)

  // Detener el bucle de seguimiento de animación
  const stopTracking = () => {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }
  }

  // Algoritmo de posicionamiento acotado al viewport
  const updatePosition = (
    w: number,
    h: number,
    pop: HTMLElement,
    target: HTMLElement
  ) => {
    if (!target || !pop) return

    const rect = target.getBoundingClientRect()
    const margin = 8
    const gap = 8

    let popoverWidth = w > 0 ? w : pop.offsetWidth
    let popoverHeight = h > 0 ? h : pop.offsetHeight

    if (popoverWidth === 0) popoverWidth = pop.scrollWidth || 300
    if (popoverHeight === 0) popoverHeight = pop.scrollHeight || 150

    const maxViewportWidth = window.innerWidth - margin * 2
    const effectiveWidth = Math.min(popoverWidth, maxViewportWidth)

    // --- Posicionamiento Horizontal ---
    let left = rect.left

    // Si se sale a la derecha del viewport
    if (left + effectiveWidth > window.innerWidth - margin) {
      const altLeft = rect.right - effectiveWidth
      if (altLeft >= margin) {
        left = altLeft
      } else {
        left = margin
      }
    }

    // Ajuste límites horizontales
    left = Math.max(margin, Math.min(left, window.innerWidth - margin - effectiveWidth))
    const maxWidth = Math.max(50, Math.min(effectiveWidth, window.innerWidth - margin - left))

    // --- Posicionamiento Vertical ---
    const spaceBelow = window.innerHeight - rect.bottom - margin - gap
    const spaceAbove = rect.top - margin - gap

    let top: number
    let availableHeight: number

    if (popoverHeight <= spaceBelow || spaceBelow >= spaceAbove) {
      // Mostrar abajo si cabe o si hay más espacio abajo
      top = rect.bottom + gap
      availableHeight = Math.max(40, spaceBelow)
    } else {
      // Mostrar arriba si no cabe abajo y hay más espacio arriba
      top = rect.top - Math.min(popoverHeight, spaceAbove) - gap
      availableHeight = Math.max(40, spaceAbove)
    }

    // Ajuste límites verticales dentro del viewport
    const minTop = margin
    const maxTop = window.innerHeight - margin - Math.min(popoverHeight, availableHeight)
    top = Math.max(minTop, Math.min(top, maxTop))

    Object.assign(pop.style, {
      position: 'fixed',
      top: `${top}px`,
      left: `${left}px`,
      zIndex: '9999',
      maxWidth: `${maxWidth}px`,
      width: w > 0 ? `${w}px` : 'auto',
      maxHeight: `${availableHeight}px`,
      overflowY: 'auto'
    })
  }

  // Bucle de seguimiento dinámico con requestAnimationFrame
  const startTracking = (
    w: number | string | undefined,
    h: number | string | undefined,
    pop: HTMLElement,
    target: HTMLElement
  ) => {
    stopTracking()

    let resultWidth = typeof w === 'number' ? w : 0
    let resultHeight = typeof h === 'number' ? h : 0

    if (typeof w === 'string' && w) {
      pop.style.userSelect = 'none'
      pop.style.opacity = '0'
      const wasOpen = pop.matches?.(':popover-open')
      if (!wasOpen && pop.showPopover) pop.showPopover()
      pop.style.width = w
      resultWidth = pop.offsetWidth
      if (!wasOpen && pop.hidePopover) pop.hidePopover()
      pop.style.userSelect = ''
      pop.style.opacity = ''
    }

    if (typeof h === 'string' && h) {
      pop.style.userSelect = 'none'
      pop.style.opacity = '0'
      const wasOpen = pop.matches?.(':popover-open')
      if (!wasOpen && pop.showPopover) pop.showPopover()
      pop.style.height = h
      resultHeight = pop.offsetHeight
      if (!wasOpen && pop.hidePopover) pop.hidePopover()
      pop.style.userSelect = ''
      pop.style.opacity = ''
    }

    const track = () => {
      if (!pop.matches?.(':popover-open')) {
        stopTracking()
        return
      }
      const currentWidth = resultWidth > 0 ? resultWidth : pop.offsetWidth
      const currentHeight = resultHeight > 0 ? resultHeight : pop.offsetHeight

      updatePosition(currentWidth, currentHeight, pop, target)
      animationFrameId = requestAnimationFrame(track)
    }

    const measureAndTrack = () => {
      const curW = pop.offsetWidth
      const curH = pop.offsetHeight
      if (curW === 0 || curH === 0) {
        animationFrameId = requestAnimationFrame(measureAndTrack)
        return
      }
      updatePosition(curW, curH, pop, target)
      track()
    }

    if (resultWidth === 0 || resultHeight === 0) {
      measureAndTrack()
    } else {
      track()
    }
  }

  const getTarget = (): HTMLElement | null => props.anchor || triggerEl

  const open = () => {
    if (!popoverEl) return
    const target = getTarget()
    if (!target) return

    try {
      if (!popoverEl.matches?.(':popover-open')) {
        popoverEl.showPopover()
      }
    } catch {
      popoverEl.style.display = 'block'
    }
    setInternalOpen(true)
    props.onOpen?.()
    startTracking(props.width, props.height, popoverEl, target)
  }

  const close = () => {
    if (!popoverEl) return
    cancelHide()
    try {
      if (popoverEl.matches?.(':popover-open')) {
        popoverEl.hidePopover()
      }
    } catch {
      popoverEl.style.display = 'none'
    }
    setInternalOpen(false)
    stopTracking()
    props.onClose?.()
  }

  const toggle = () => {
    if (isOpen()) {
      close()
    } else {
      open()
    }
  }

  // Cancela cualquier timeout pendiente de cierre
  const cancelHide = () => {
    if (idTimeoutForSlowHidePopover) {
      clearTimeout(idTimeoutForSlowHidePopover)
      idTimeoutForSlowHidePopover = null
    }
  }

  // Muestra el popover inmediatamente y cancela timeout
  const showPopoverDelayed = () => {
    cancelHide()
    open()
  }

  // Oculta con timeout de 100ms salvo que btnCloser esté activado
  const hidePopoverDelayed = () => {
    // Si ya tiene activado btnCloser, NO debe cerrarse cuando el mouse no esté encima
    if (props.btnCloser) return

    cancelHide()
    idTimeoutForSlowHidePopover = setTimeout(() => {
      close()
      idTimeoutForSlowHidePopover = null
    }, 100)
  }

  // Modo controlado: sincronizar con props.isOpen si es provisto externamente
  createEffect(() => {
    if (typeof props.isOpen === 'boolean') {
      if (props.isOpen && !internalOpen()) {
        open()
      } else if (!props.isOpen && internalOpen()) {
        close()
      }
    }
  })

  onMount(() => {
    if (!popoverEl) return

    // Sincronizar eventos nativos del Popover (incluyendo light-dismiss al hacer click afuera)
    const handleToggle = (e: Event) => {
      const toggleEvent = e as any
      if (toggleEvent.newState === 'open') {
        setInternalOpen(true)
        const target = getTarget()
        if (target) {
          startTracking(props.width, props.height, popoverEl!, target)
        }
      } else {
        setInternalOpen(false)
        stopTracking()
        props.onClose?.()
      }
    }

    popoverEl.addEventListener('toggle', handleToggle)

    // Listeners del propio elemento popover para el hover y foco (solo mouse/pen, ignorar touch capacitivo)
    const onPopoverPointerOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      cancelHide()
    }
    const onPopoverPointerOut = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      hidePopoverDelayed()
    }
    const onPopoverFocus = () => showPopoverDelayed()
    const onPopoverBlur = () => hidePopoverDelayed()

    if (hasDefaultEvents()) {
      popoverEl.addEventListener('pointerover', onPopoverPointerOver)
      popoverEl.addEventListener('pointerout', onPopoverPointerOut)
      popoverEl.addEventListener('focus', onPopoverFocus)
      popoverEl.addEventListener('blur', onPopoverBlur)
    }

    // Cerrar al hacer click/touch afuera (incluso en mode="manual")
    const handleDocumentPointerDown = (e: PointerEvent) => {
      if (!isOpen()) return
      const target = e.target as Node
      const anchorEl = getTarget()
      if (
        popoverEl &&
        !popoverEl.contains(target) &&
        (!anchorEl || !anchorEl.contains(target)) &&
        (!triggerEl || !triggerEl.contains(target))
      ) {
        close()
      }
    }

    document.addEventListener('pointerdown', handleDocumentPointerDown)

    onCleanup(() => {
      cancelHide()
      popoverEl?.removeEventListener('toggle', handleToggle)
      if (hasDefaultEvents()) {
        popoverEl?.removeEventListener('pointerover', onPopoverPointerOver)
        popoverEl?.removeEventListener('pointerout', onPopoverPointerOut)
        popoverEl?.removeEventListener('focus', onPopoverFocus)
        popoverEl?.removeEventListener('blur', onPopoverBlur)
      }
      document.removeEventListener('pointerdown', handleDocumentPointerDown)
      stopTracking()
      if (popoverEl && popoverEl.matches?.(':popover-open')) {
        try {
          popoverEl.hidePopover()
        } catch {}
      }
    })
  })

  // Event handlers para conectar al trigger (ignorar eventos hover emulados en pantallas capacitivas)
  const handleTriggerPointerOver = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return
    if (hasDefaultEvents()) showPopoverDelayed()
  }
  const handleTriggerPointerOut = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return
    if (hasDefaultEvents()) hidePopoverDelayed()
  }
  const handleTriggerFocus = () => {
    if (hasDefaultEvents()) showPopoverDelayed()
  }
  const handleTriggerBlur = () => {
    if (hasDefaultEvents()) hidePopoverDelayed()
  }

  return (
    <>
      {/* Elemento disparador declarativo */}
      {typeof props.trigger === 'function' ? (
        props.trigger({
          ref: (el) => {
            if (!el) return
            triggerEl = el
            if (hasDefaultEvents()) {
              el.addEventListener('pointerover', handleTriggerPointerOver)
              el.addEventListener('pointerout', handleTriggerPointerOut)
              el.addEventListener('focus', handleTriggerFocus)
              el.addEventListener('blur', handleTriggerBlur)
            }
          },
          isOpen,
          toggle,
          open,
          close
        })
      ) : props.trigger ? (
        <span
          ref={(el) => {
            triggerEl = el
          }}
          onClick={toggle}
          onPointerOver={handleTriggerPointerOver}
          onPointerOut={handleTriggerPointerOut}
          onFocus={handleTriggerFocus}
          onBlur={handleTriggerBlur}
          class="inline-flex cursor-pointer"
        >
          {props.trigger}
        </span>
      ) : props.btnOpener ? (
        <button
          ref={(el) => {
            triggerEl = el
          }}
          type="button"
          class={`btnOpenPopover ${props.className ? `open-${props.className}` : ''}`}
          onClick={toggle}
          onPointerOver={handleTriggerPointerOver}
          onPointerOut={handleTriggerPointerOut}
          onFocus={handleTriggerFocus}
          onBlur={handleTriggerBlur}
        >
          Abrir
        </button>
      ) : null}

      {/* Elemento popover nativo */}
      <div
        ref={(el) => {
          popoverEl = el
        }}
        id={props.id !== undefined ? String(props.id) : undefined}
        // @ts-ignore - atributo popover nativo
        popover={mode()}
        class={`Popover ${props.class || props.className || ''}`}
      >
        <Show when={props.btnCloser}>
          <button
            type="button"
            class="closePopover"
            onClick={(e) => {
              e.stopPropagation()
              close()
            }}
            title="Cerrar"
          >
            <X size={14} />
          </button>
        </Show>
        <div class={`contentContainer ${props.className ? `content-${props.className}` : ''}`}>
          {typeof props.children === 'function' ? props.children({ close, isOpen }) : props.children}
        </div>
      </div>
    </>
  )
}
