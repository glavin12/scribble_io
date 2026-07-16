import { useRef, useEffect, useCallback } from 'react'

// drawLine is a plain function — no hoisting issue
function drawLine(ctx, x1, y1, x2, y2, c, w) {
  ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
}

/**
 * Pure drawing surface — no toolbar.
 * Props:
 *   isDrawer     – can this user draw?
 *   onDraw       – callback(stroke) when user draws
 *   remoteStrokes – array of incoming strokes to replay
 *   color        – current brush color (string)
 *   size         – current brush size (number)
 *   tool         – 'pencil' | 'eraser' (optional, default 'pencil')
 */
export default function Canvas({ isDrawer, onDraw, remoteStrokes, color = '#000000', size = 6, tool = 'pencil' }) {
  const canvasRef  = useRef(null)
  const drawing    = useRef(false)
  const lastPt     = useRef(null)
  // Keep color/size/tool in refs so event handlers never go stale
  const colorRef   = useRef(color)
  const sizeRef    = useRef(size)
  const toolRef    = useRef(tool)

  useEffect(() => { colorRef.current = color }, [color])
  useEffect(() => { sizeRef.current  = size  }, [size])
  useEffect(() => { toolRef.current  = tool  }, [tool])

  // Set canvas size once on mount via ResizeObserver
  useEffect(() => {
    const canvas = canvasRef.current
    const resize = () => {
      const rect = canvas.parentElement.getBoundingClientRect()
      canvas.width  = Math.floor(rect.width)
      canvas.height = Math.floor(rect.height)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas.parentElement)
    return () => ro.disconnect()
  }, [])

  // processedRef tracks how many strokes we've already drawn.
  const processedRef = useRef(0)

  useEffect(() => {
    if (!canvasRef.current) return
    // remoteStrokes reset to [] on new round — clear canvas and reset counter
    if (remoteStrokes.length === 0) {
      const ctx = canvasRef.current.getContext('2d')
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
      lastPt.current  = null
      processedRef.current = 0
      return
    }
    const ctx = canvasRef.current.getContext('2d')
    for (let i = processedRef.current; i < remoteStrokes.length; i++) {
      const s = remoteStrokes[i]
      if (s.type === 'clear') {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
        lastPt.current = null
      } else if (s.type === 'begin') {
        lastPt.current = { x: s.x, y: s.y, color: s.color, size: s.size }
      } else if (s.type === 'move' && !lastPt.current) {
        lastPt.current = { x: s.x, y: s.y, color: s.color || '#000000', size: s.size || 6 }
      } else if (s.type === 'move' && lastPt.current) {
        drawLine(ctx, lastPt.current.x, lastPt.current.y, s.x, s.y, s.color || lastPt.current.color, s.size || lastPt.current.size)
        lastPt.current = { ...lastPt.current, x: s.x, y: s.y }
      }
    }
    processedRef.current = remoteStrokes.length
  }, [remoteStrokes])


  const pt = (e) => {
    const r = canvasRef.current.getBoundingClientRect()
    const scaleX = canvasRef.current.width  / r.width
    const scaleY = canvasRef.current.height / r.height
    const t = e.touches ? e.touches[0] : e
    return { x: (t.clientX - r.left) * scaleX, y: (t.clientY - r.top) * scaleY }
  }

  // Resolve the actual color based on tool (eraser = white)
  const getDrawColor = () => toolRef.current === 'eraser' ? '#ffffff' : colorRef.current

  const onDown = useCallback((e) => {
    if (!isDrawer) return
    e.preventDefault()
    drawing.current = true
    const { x, y } = pt(e)
    const drawColor = getDrawColor()
    lastPt.current  = { x, y, color: drawColor, size: sizeRef.current }
    onDraw({ type: 'begin', x, y, color: drawColor, size: sizeRef.current })
  }, [isDrawer, onDraw])

  const onMove = useCallback((e) => {
    if (!isDrawer || !drawing.current || !lastPt.current) return
    e.preventDefault()
    const { x, y } = pt(e)
    const drawColor = getDrawColor()
    const ctx = canvasRef.current.getContext('2d')
    drawLine(ctx, lastPt.current.x, lastPt.current.y, x, y, drawColor, sizeRef.current)
    onDraw({ type: 'move', x, y, color: drawColor, size: sizeRef.current })
    lastPt.current = { ...lastPt.current, x, y }
  }, [isDrawer, onDraw])

  const onUp = useCallback(() => { drawing.current = false }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width: '100%', height: '100%' }}
      onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
      onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
    />
  )
}
