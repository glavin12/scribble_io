import { useRef, useEffect, useState, useCallback } from 'react'

const COLORS = ['#000000','#e74c3c','#e67e22','#f1c40f','#2ecc71','#1abc9c','#3498db','#9b59b6','#ffffff']
const SIZES  = [3, 6, 12, 20]

// drawLine is a plain function, not a component const — no hoisting issue
function drawLine(ctx, x1, y1, x2, y2, c, w) {
  ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
}

export default function Canvas({ isDrawer, onDraw, onClear, remoteStrokes }) {
  const canvasRef  = useRef(null)
  const drawing    = useRef(false)
  const lastPt     = useRef(null)
  // Keep color/size in refs too so event handlers never go stale without
  // causing canvas-clearing re-renders
  const colorRef   = useRef('#000000')
  const sizeRef    = useRef(6)
  const [color, setColor] = useState('#000000')
  const [size,  setSize]  = useState(6)

  // Sync refs whenever the user changes tool
  useEffect(() => { colorRef.current = color }, [color])
  useEffect(() => { sizeRef.current  = size  }, [size])

  // Fix: set canvas size once on mount via ref, not via JSX attribute.
  // Setting width/height as JSX props causes React to write the DOM attribute
  // on every reconcile, which clears canvas contents.
  useEffect(() => {
    const canvas = canvasRef.current
    canvas.width  = 700
    canvas.height = 500
  }, []) // empty deps = runs once

  // processedRef tracks how many strokes we've already drawn.
  // useEffect only processes remoteStrokes[processedRef.current..end].
  // This handles React 18 batching: if 5 strokes arrive between frames,
  // remoteStrokes grows by 5 in one commit — we draw all 5, not just the last.
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
        // Dropped begin — recover by treating first move as a begin point
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
    // Scale mouse coords to canvas logical size (CSS may scale the element)
    const scaleX = canvasRef.current.width  / r.width
    const scaleY = canvasRef.current.height / r.height
    const t = e.touches ? e.touches[0] : e
    return { x: (t.clientX - r.left) * scaleX, y: (t.clientY - r.top) * scaleY }
  }

  // Stable handlers — use refs for color/size so deps never change
  const onDown = useCallback((e) => {
    if (!isDrawer) return
    e.preventDefault()
    drawing.current = true
    const { x, y } = pt(e)
    lastPt.current  = { x, y, color: colorRef.current, size: sizeRef.current }
    onDraw({ type: 'begin', x, y, color: colorRef.current, size: sizeRef.current })
  }, [isDrawer, onDraw]) // color/size accessed via ref — no longer deps

  const onMove = useCallback((e) => {
    if (!isDrawer || !drawing.current || !lastPt.current) return
    e.preventDefault()
    const { x, y } = pt(e)
    const ctx = canvasRef.current.getContext('2d')
    drawLine(ctx, lastPt.current.x, lastPt.current.y, x, y, lastPt.current.color, lastPt.current.size)
    onDraw({ type: 'move', x, y, color: colorRef.current, size: sizeRef.current })
    lastPt.current = { ...lastPt.current, x, y }
  }, [isDrawer, onDraw])

  const onUp = useCallback(() => { drawing.current = false }, [])

  const handleClear = () => {
    const ctx = canvasRef.current.getContext('2d')
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
    onClear()
  }

  return (
    <div className="canvas-panel">
      <div className="canvas-wrap">
        {/* No width/height JSX props — set once via useEffect above */}
        <canvas
          ref={canvasRef}
          style={{ maxWidth: '100%', maxHeight: '100%' }}
          onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
          onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
        />
      </div>

      {isDrawer && (
        <div className="canvas-tools">
          {COLORS.map(c => (
            <div
              key={c} className={`color-swatch${color === c ? ' active' : ''}`}
              style={{ background: c, outline: c === '#ffffff' ? '1px solid #555' : 'none' }}
              onClick={() => setColor(c)}
            />
          ))}
          <div className="tool-sep" />
          {SIZES.map(s => (
            <button key={s} className={`size-btn${size === s ? ' active' : ''}`} onClick={() => setSize(s)}>
              {s}
            </button>
          ))}
          <div className="tool-sep" />
          <button className="btn btn-sm btn-danger" onClick={handleClear}>Clear</button>
        </div>
      )}
    </div>
  )
}
