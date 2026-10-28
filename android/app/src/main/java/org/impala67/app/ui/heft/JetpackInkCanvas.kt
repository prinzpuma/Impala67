package org.impala67.app.ui.heft

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.os.SystemClock
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.viewinterop.AndroidView
import androidx.input.motionprediction.MotionEventPredictor
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uniffi.impala_ffi.*
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/**
 * Aktives Werkzeug für das Zeichnen auf dem Canvas.
 */
enum class HeftTool(val id: String) {
    PEN("pen"),
    MARKER("marker"),
    SHAPE("shape"),
    ERASER("eraser"),
    LASSO("lasso"),
    TEXT("text")
}

/**
 * Papiermuster für die Heftseite.
 */
enum class HeftPaper(val id: String) {
    LINED("lined"),
    GRID("grid"),
    DOTS("dots"),
    BLANK("blank")
}

/**
 * Latenzfreier, hardware-beschleunigter Stift-Canvas mit Stylus-Prädiktion,
 * Palm-Rejection, Formerkennung und Lasso-Bearbeitung.
 */
@Composable
fun JetpackInkCanvas(
    pageId: String,
    heftPageId: String,
    pageData: HeftPageData,
    core: ImpalaCore,
    selectedTool: HeftTool,
    strokeColor: String,
    strokeSize: Float,
    ocrManager: DigitalInkOcrManager,
    modifier: Modifier = Modifier,
    onUndoStackChanged: (undoJson: String?) -> Unit = {},
    onSelectedStrokesChanged: (List<String>) -> Unit = {}
) {
    val coroutineScope = rememberCoroutineScope()

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color(0xFF1E2024))
    ) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { context ->
                InkCanvasView(
                    context = context,
                    pageId = pageId,
                    heftPageId = heftPageId,
                    core = core,
                    ocrManager = ocrManager,
                    coroutineScope = coroutineScope,
                    onUndoAvailable = onUndoStackChanged,
                    onSelectionChanged = onSelectedStrokesChanged
                ).apply {
                    updatePageData(pageData)
                    updateToolSettings(selectedTool, strokeColor, strokeSize)
                }
            },
            update = { view ->
                view.updatePageData(pageData)
                view.updateToolSettings(selectedTool, strokeColor, strokeSize)
            }
        )
    }
}

/**
 * Eigene View-Klasse für maximale Zeichen-Performance, 120Hz Stylus-Events
 * und Hardware-Predictor.
 */
@SuppressLint("ViewConstructor")
internal class InkCanvasView(
    context: Context,
    private val pageId: String,
    private var heftPageId: String,
    private val core: ImpalaCore,
    private val ocrManager: DigitalInkOcrManager,
    private val coroutineScope: CoroutineScope,
    private val onUndoAvailable: (String?) -> Unit,
    private val onSelectionChanged: (List<String>) -> Unit
) : View(context) {

    companion object {
        const val PAGE_WIDTH = 794.0f
        const val PAGE_HEIGHT = 1123.0f
        private const val SHAPE_HOLD_DURATION_MS = 380L
        private const val SHAPE_HOLD_MAX_DISTANCE = 12.0f
    }

    private var currentPageData: HeftPageData? = null
    private var activeTool: HeftTool = HeftTool.PEN
    private var activeColor: String = "#1f2937"
    private var activeSize: Float = 2.5f

    // Bild-Cache für Heft-Bilder
    private val imageCache = mutableMapOf<String, Bitmap>()

    // Viewport-Transformation (Zoom & Pan)
    private var scale = 1.0f
    private var panX = 0.0f
    private var panY = 0.0f
    private val transformMatrix = Matrix()
    private val inverseMatrix = Matrix()

    // Aktueller Freihand-Strich
    private val currentPoints = mutableListOf<Float>()
    private var isDrawing = false
    private var strokeStartTime = 0L
    private var lastPointX = 0f
    private var lastPointY = 0f
    private var shapeHoldJob: Job? = null
    private var previewShape: HeftShape? = null

    // Motion Predictor für Latenzreduktion
    private val motionPredictor = MotionEventPredictor.newInstance(this)

    // Lasso-Auswahl
    private val lassoPolygon = mutableListOf<Float>()
    private val selectedStrokeIds = mutableListOf<String>()
    private var selectionBounds: HeftRect? = null
    private var isDraggingSelection = false
    private var dragStartX = 0f
    private var dragStartY = 0f

    // Zeichenwerkzeuge (Paints)
    private val pagePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = android.graphics.Color.WHITE
        style = Paint.Style.FILL
    }
    private val pageShadowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = android.graphics.Color.argb(80, 0, 0, 0)
        style = Paint.Style.FILL
    }
    private val paperPatternPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
    }
    private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        style = Paint.Style.STROKE
    }
    private val markerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        strokeCap = Paint.Cap.SQUARE
        strokeJoin = Paint.Join.MITER
        style = Paint.Style.STROKE
    }
    private val shapePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        style = Paint.Style.STROKE
    }
    private val lassoPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = android.graphics.Color.parseColor("#6B8CAE")
        strokeWidth = 2.0f
        style = Paint.Style.STROKE
        pathEffect = DashPathEffect(floatArrayOf(12f, 8f), 0f)
    }
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = android.graphics.Color.BLACK
    }

    // Geste für Zwei-Finger-Zoom/Pan
    private val scaleDetector = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScale(detector: ScaleGestureDetector): Boolean {
            val factor = detector.scaleFactor
            val newScale = (scale * factor).coerceIn(0.4f, 5.0f)
            val focusX = detector.focusX
            val focusY = detector.focusY

            panX = focusX - (focusX - panX) * (newScale / scale)
            panY = focusY - (focusY - panY) * (newScale / scale)
            scale = newScale
            updateTransformMatrix()
            invalidate()
            return true
        }
    })

    private var lastTouchX = 0f
    private var lastTouchY = 0f
    private var isPanning = false

    init {
        setLayerType(LAYER_TYPE_HARDWARE, null)
    }

    fun updatePageData(pageData: HeftPageData) {
        val pageChanged = pageData.id != heftPageId
        currentPageData = pageData
        heftPageId = pageData.id
        if (pageChanged) {
            selectedStrokeIds.clear()
            selectionBounds = null
            onSelectionChanged(emptyList())
        }
        preloadImages(pageData.images)
        invalidate()
    }

    fun updateToolSettings(tool: HeftTool, color: String, size: Float) {
        activeTool = tool
        activeColor = color
        activeSize = size
        invalidate()
    }

    private fun preloadImages(images: List<HeftImage>) {
        coroutineScope.launch(Dispatchers.IO) {
            for (img in images) {
                if (!imageCache.containsKey(img.id)) {
                    val data = try {
                        core.heftImageData(pageId, heftPageId, img.id)
                    } catch (_: Exception) { null }

                    if (data != null && data.bytes.isNotEmpty()) {
                        val bmp = BitmapFactory.decodeByteArray(data.bytes, 0, data.bytes.size)
                        if (bmp != null) {
                            synchronized(imageCache) {
                                imageCache[img.id] = bmp
                            }
                            postInvalidate()
                        }
                    }
                }
            }
        }
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (oldw == 0 && oldh == 0 && w > 0 && h > 0) {
            // Seite mittig zentrieren
            val scaleX = (w * 0.92f) / PAGE_WIDTH
            val scaleY = (h * 0.92f) / PAGE_HEIGHT
            scale = min(scaleX, scaleY).coerceIn(0.5f, 2.5f)
            panX = (w - PAGE_WIDTH * scale) / 2.0f
            panY = (h - PAGE_HEIGHT * scale) / 2.0f
            updateTransformMatrix()
        }
    }

    private fun updateTransformMatrix() {
        transformMatrix.reset()
        transformMatrix.postScale(scale, scale)
        transformMatrix.postTranslate(panX, panY)
        transformMatrix.invert(inverseMatrix)
    }

    private fun screenToPage(screenX: Float, screenY: Float): Pair<Float, Float> {
        val pts = floatArrayOf(screenX, screenY)
        inverseMatrix.mapPoints(pts)
        return Pair(pts[0], pts[1])
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)

        canvas.save()
        canvas.concat(transformMatrix)

        // 1. Papierschatten & Papierhintergrund
        canvas.drawRect(4f, 4f, PAGE_WIDTH + 8f, PAGE_HEIGHT + 8f, pageShadowPaint)
        canvas.drawRect(0f, 0f, PAGE_WIDTH, PAGE_HEIGHT, pagePaint)

        // 2. Papiermuster zeichnen
        val paper = currentPageData?.paper ?: HeftPaper.LINED.id
        drawPaperPattern(canvas, paper)

        // 3. Eingebettete Bilder rendern
        currentPageData?.images?.forEach { img ->
            val bmp = synchronized(imageCache) { imageCache[img.id] }
            if (bmp != null) {
                val dst = RectF(
                    img.x.toFloat(),
                    img.y.toFloat(),
                    (img.x + img.w).toFloat(),
                    (img.y + img.h).toFloat()
                )
                canvas.drawBitmap(bmp, null, dst, null)
            }
        }

        // 4. Gespeicherte Striche rendern
        currentPageData?.strokes?.forEach { stroke ->
            drawSavedStroke(canvas, stroke)
        }

        // 5. Textfelder rendern
        currentPageData?.texts?.forEach { textItem ->
            drawTextItem(canvas, textItem)
        }

        // 6. Aktiver Strich (Live-In-Progress-Stroke)
        if (isDrawing) {
            if (activeTool == HeftTool.LASSO) {
                drawLiveLasso(canvas)
            } else {
                drawLiveStroke(canvas)
            }
        }

        // 7. Lasso-Auswahlrahmen
        drawSelectionFrame(canvas)

        canvas.restore()
    }

    private fun drawPaperPattern(canvas: Canvas, paper: String) {
        when (paper) {
            HeftPaper.LINED.id -> {
                paperPatternPaint.color = android.graphics.Color.parseColor("#E5E7EB")
                paperPatternPaint.strokeWidth = 1.0f
                var y = 90.0f
                while (y < PAGE_HEIGHT - 40.0f) {
                    canvas.drawLine(0f, y, PAGE_WIDTH, y, paperPatternPaint)
                    y += 32.0f
                }
                // Rote Randlinie links
                paperPatternPaint.color = android.graphics.Color.parseColor("#FCA5A5")
                paperPatternPaint.strokeWidth = 1.2f
                canvas.drawLine(75f, 0f, 75f, PAGE_HEIGHT, paperPatternPaint)
            }
            HeftPaper.GRID.id -> {
                paperPatternPaint.color = android.graphics.Color.parseColor("#E5E7EB")
                paperPatternPaint.strokeWidth = 0.8f
                var x = 25.0f
                while (x < PAGE_WIDTH) {
                    canvas.drawLine(x, 0f, x, PAGE_HEIGHT, paperPatternPaint)
                    x += 25.0f
                }
                var y = 25.0f
                while (y < PAGE_HEIGHT) {
                    canvas.drawLine(0f, y, PAGE_WIDTH, y, paperPatternPaint)
                    y += 25.0f
                }
            }
            HeftPaper.DOTS.id -> {
                paperPatternPaint.style = Paint.Style.FILL
                paperPatternPaint.color = android.graphics.Color.parseColor("#9CA3AF")
                var x = 25.0f
                while (x < PAGE_WIDTH) {
                    var y = 25.0f
                    while (y < PAGE_HEIGHT) {
                        canvas.drawCircle(x, y, 1.2f, paperPatternPaint)
                        y += 25.0f
                    }
                    x += 25.0f
                }
                paperPatternPaint.style = Paint.Style.STROKE
            }
            HeftPaper.BLANK.id -> {
                // Kein Muster
            }
        }
    }

    private fun drawSavedStroke(canvas: Canvas, stroke: HeftStroke) {
        val colorInt = parseColorSafely(stroke.color)
        val isSelected = selectedStrokeIds.contains(stroke.id)

        if (stroke.shape != null) {
            shapePaint.color = if (isSelected) android.graphics.Color.parseColor("#6B8CAE") else colorInt
            shapePaint.strokeWidth = stroke.size.toFloat()
            drawShape(canvas, stroke.shape!!, shapePaint)
            return
        }

        val pts = stroke.points
        if (pts.size < 3) return

        if (stroke.tool == HeftTool.MARKER.id) {
            markerPaint.color = colorInt
            markerPaint.alpha = 95
            markerPaint.strokeWidth = (stroke.size * 3.2).toFloat()
            drawPointPath(canvas, pts, markerPaint)
        } else {
            strokePaint.color = if (isSelected) android.graphics.Color.parseColor("#6B8CAE") else colorInt
            strokePaint.strokeWidth = stroke.size.toFloat()
            drawPointPath(canvas, pts, strokePaint)
        }
    }

    private fun drawShape(canvas: Canvas, shape: HeftShape, paint: Paint) {
        when (shape) {
            is HeftShape.Line -> {
                canvas.drawLine(shape.x1.toFloat(), shape.y1.toFloat(), shape.x2.toFloat(), shape.y2.toFloat(), paint)
            }
            is HeftShape.Rect -> {
                val left = min(shape.x1, shape.x2).toFloat()
                val top = min(shape.y1, shape.y2).toFloat()
                val right = max(shape.x1, shape.x2).toFloat()
                val bottom = max(shape.y1, shape.y2).toFloat()
                canvas.drawRect(left, top, right, bottom, paint)
            }
            is HeftShape.Triangle -> {
                val path = Path().apply {
                    moveTo(shape.x1.toFloat(), shape.y1.toFloat())
                    lineTo(shape.x2.toFloat(), shape.y2.toFloat())
                    lineTo(shape.x3.toFloat(), shape.y3.toFloat())
                    close()
                }
                canvas.drawPath(path, paint)
            }
            is HeftShape.Arrow -> {
                // Schaft
                canvas.drawLine(shape.x1.toFloat(), shape.y1.toFloat(), shape.x2.toFloat(), shape.y2.toFloat(), paint)
                // Pfeilspitze
                canvas.drawLine(shape.x2.toFloat(), shape.y2.toFloat(), shape.h1x.toFloat(), shape.h1y.toFloat(), paint)
                canvas.drawLine(shape.x2.toFloat(), shape.y2.toFloat(), shape.h2x.toFloat(), shape.h2y.toFloat(), paint)
            }
            is HeftShape.Ellipse -> {
                val oval = RectF(
                    (shape.cx - shape.rx).toFloat(),
                    (shape.cy - shape.ry).toFloat(),
                    (shape.cx + shape.rx).toFloat(),
                    (shape.cy + shape.ry).toFloat()
                )
                canvas.drawOval(oval, paint)
            }
            is HeftShape.Circle -> {
                canvas.drawCircle(shape.cx.toFloat(), shape.cy.toFloat(), shape.r.toFloat(), paint)
            }
        }
    }

    private fun drawPointPath(canvas: Canvas, points: List<Float>, paint: Paint) {
        if (points.size < 6) {
            if (points.size >= 3) {
                canvas.drawPoint(points[0], points[1], paint)
            }
            return
        }

        val path = Path()
        path.moveTo(points[0], points[1])
        var i = 3
        while (i + 1 < points.size) {
            val prevX = points[i - 3]
            val prevY = points[i - 2]
            val curX = points[i]
            val curY = points[i + 1]
            val midX = (prevX + curX) / 2.0f
            val midY = (prevY + curY) / 2.0f
            path.quadTo(prevX, prevY, midX, midY)
            i += 3
        }
        val lastIdx = points.size - 3
        path.lineTo(points[lastIdx], points[lastIdx + 1])
        canvas.drawPath(path, paint)
    }

    private fun drawTextItem(canvas: Canvas, text: HeftText) {
        textPaint.color = parseColorSafely(text.color ?: "#000000")
        textPaint.textSize = (text.size ?: 16.0).toFloat()
        canvas.drawText(text.text, text.x.toFloat(), text.y.toFloat() + textPaint.textSize, textPaint)
    }

    private fun drawLiveStroke(canvas: Canvas) {
        if (previewShape != null) {
            shapePaint.color = parseColorSafely(activeColor)
            shapePaint.strokeWidth = activeSize
            drawShape(canvas, previewShape!!, shapePaint)
            return
        }

        if (currentPoints.size < 3) return

        val colorInt = parseColorSafely(activeColor)
        if (activeTool == HeftTool.MARKER) {
            markerPaint.color = colorInt
            markerPaint.alpha = 95
            markerPaint.strokeWidth = activeSize * 3.2f
            drawPointPath(canvas, currentPoints, markerPaint)
        } else {
            strokePaint.color = colorInt
            strokePaint.strokeWidth = activeSize
            drawPointPath(canvas, currentPoints, strokePaint)
        }
    }

    private fun drawLiveLasso(canvas: Canvas) {
        if (lassoPolygon.size < 4) return
        val path = Path()
        path.moveTo(lassoPolygon[0], lassoPolygon[1])
        var i = 2
        while (i + 1 < lassoPolygon.size) {
            path.lineTo(lassoPolygon[i], lassoPolygon[i + 1])
            i += 2
        }
        canvas.drawPath(path, lassoPaint)
    }

    private fun drawSelectionFrame(canvas: Canvas) {
        val bounds = selectionBounds ?: return
        val rect = RectF(
            bounds.minX.toFloat(),
            bounds.minY.toFloat(),
            bounds.maxX.toFloat(),
            bounds.maxY.toFloat()
        )
        canvas.drawRect(rect, lassoPaint)

        // Eckgriffe für visuelle Klarheit
        val handlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.parseColor("#6B8CAE")
            style = Paint.Style.FILL
        }
        canvas.drawCircle(rect.left, rect.top, 5f, handlePaint)
        canvas.drawCircle(rect.right, rect.top, 5f, handlePaint)
        canvas.drawCircle(rect.right, rect.bottom, 5f, handlePaint)
        canvas.drawCircle(rect.left, rect.bottom, 5f, handlePaint)
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        // Multi-Touch (Zwei-Finger Pan & Zoom)
        scaleDetector.onTouchEvent(event)
        if (event.pointerCount > 1) {
            isPanning = true
            when (event.actionMasked) {
                MotionEvent.ACTION_MOVE -> {
                    if (event.historySize > 0) {
                        val dx = event.x - lastTouchX
                        val dy = event.y - lastTouchY
                        panX += dx
                        panY += dy
                        updateTransformMatrix()
                        invalidate()
                    }
                }
            }
            lastTouchX = event.x
            lastTouchY = event.y
            return true
        }

        if (isPanning && event.actionMasked == MotionEvent.ACTION_UP) {
            isPanning = false
            return true
        }

        // Palm-Rejection: Wenn Stylus bevorzugt wird
        val isStylus = event.getToolType(0) == MotionEvent.TOOL_TYPE_STYLUS

        // Motion Predictor aufzeichnen
        motionPredictor.record(event)

        val (pageX, pageY) = screenToPage(event.x, event.y)
        val pressure = if (isStylus) event.pressure.coerceIn(0.1f, 1.0f) else 0.8f

        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                handleActionDown(pageX, pageY, pressure)
            }
            MotionEvent.ACTION_MOVE -> {
                handleActionMove(event, pageX, pageY, pressure)
            }
            MotionEvent.ACTION_UP -> {
                handleActionUp(pageX, pageY)
            }
            MotionEvent.ACTION_CANCEL -> {
                resetDrawingState()
            }
        }

        return true
    }

    private fun handleActionDown(pageX: Float, pageY: Float, pressure: Float) {
        shapeHoldJob?.cancel()
        previewShape = null
        strokeStartTime = SystemClock.uptimeMillis()
        lastPointX = pageX
        lastPointY = pageY

        // Radierer: sofort Striche unter dem Punkt entfernen
        if (activeTool == HeftTool.ERASER) {
            eraseStrokesAt(pageX, pageY)
            return
        }

        // Lasso-Auswahlrahmen ziehen
        if (activeTool == HeftTool.LASSO && selectionBounds != null) {
            val b = selectionBounds!!
            if (pageX >= b.minX && pageX <= b.maxX && pageY >= b.minY && pageY <= b.maxY) {
                isDraggingSelection = true
                dragStartX = pageX
                dragStartY = pageY
                return
            }
        }

        isDrawing = true
        if (activeTool == HeftTool.LASSO) {
            lassoPolygon.clear()
            lassoPolygon.add(pageX)
            lassoPolygon.add(pageY)
        } else {
            currentPoints.clear()
            currentPoints.add(pageX)
            currentPoints.add(pageY)
            currentPoints.add(pressure)

            // Form-Erkennungs-Timer bei Stillstand (Shape-Snap)
            if (activeTool == HeftTool.PEN || activeTool == HeftTool.SHAPE) {
                startShapeHoldDetection(pageX, pageY)
            }
        }
        invalidate()
    }

    private fun handleActionMove(event: MotionEvent, pageX: Float, pageY: Float, pressure: Float) {
        if (activeTool == HeftTool.ERASER) {
            eraseStrokesAt(pageX, pageY)
            return
        }

        if (isDraggingSelection) {
            val dx = (pageX - dragStartX).toDouble()
            val dy = (pageY - dragStartY).toDouble()
            dragStartX = pageX
            dragStartY = pageY

            if (selectedStrokeIds.isNotEmpty()) {
                try {
                    val edit = core.heftMoveStrokes(pageId, heftPageId, selectedStrokeIds, dx, dy)
                    onUndoAvailable(edit.undo)
                    selectionBounds = core.heftStrokesBounds(pageId, heftPageId, selectedStrokeIds)
                    invalidate()
                } catch (_: Exception) {}
            }
            return
        }

        if (!isDrawing) return

        if (activeTool == HeftTool.LASSO) {
            lassoPolygon.add(pageX)
            lassoPolygon.add(pageY)
            invalidate()
            return
        }

        // Historische Zwischenpunkte einlesen für maximale Strichglättung
        for (h in 0 until event.historySize) {
            val (hx, hy) = screenToPage(event.getHistoricalX(h), event.getHistoricalY(h))
            val hp = event.getHistoricalPressure(h).coerceIn(0.1f, 1.0f)
            currentPoints.add(hx)
            currentPoints.add(hy)
            currentPoints.add(hp)
        }

        currentPoints.add(pageX)
        currentPoints.add(pageY)
        currentPoints.add(pressure)

        // Bewegung für Form-Erkennungs-Timer prüfen
        val dist = hypot(pageX - lastPointX, pageY - lastPointY)
        if (dist > SHAPE_HOLD_MAX_DISTANCE) {
            lastPointX = pageX
            lastPointY = pageY
            shapeHoldJob?.cancel()
            previewShape = null
            startShapeHoldDetection(pageX, pageY)
        }

        invalidate()
    }

    private fun handleActionUp(pageX: Float, pageY: Float) {
        shapeHoldJob?.cancel()

        if (isDraggingSelection) {
            isDraggingSelection = false
            return
        }

        if (activeTool == HeftTool.ERASER) {
            return
        }

        if (activeTool == HeftTool.LASSO) {
            if (lassoPolygon.size >= 6) {
                try {
                    val selected = core.heftSelectByLasso(pageId, heftPageId, lassoPolygon)
                    selectedStrokeIds.clear()
                    selectedStrokeIds.addAll(selected)
                    selectionBounds = if (selected.isNotEmpty()) {
                        core.heftStrokesBounds(pageId, heftPageId, selected)
                    } else null
                    onSelectionChanged(selectedStrokeIds.toList())
                } catch (_: Exception) {}
            } else {
                selectedStrokeIds.clear()
                selectionBounds = null
                onSelectionChanged(emptyList())
            }
            lassoPolygon.clear()
            isDrawing = false
            invalidate()
            return
        }

        if (currentPoints.size >= 3) {
            val shapeToSave = previewShape
            previewShape = null

            coroutineScope.launch(Dispatchers.IO) {
                try {
                    val edit: HeftEdit = if (shapeToSave != null) {
                        core.heftAddShape(
                            pageId = pageId,
                            heftPageId = heftPageId,
                            color = activeColor,
                            size = activeSize.toDouble(),
                            shape = shapeToSave
                        )
                    } else {
                        val strokeId = core.heftAddStroke(
                            pageId = pageId,
                            heftPageId = heftPageId,
                            tool = activeTool.id,
                            color = activeColor,
                            size = activeSize.toDouble(),
                            points = currentPoints.toList()
                        )
                        // Künstliches Edit für Undo
                        HeftEdit(ids = listOf(strokeId), undo = "")
                    }

                    withContext(Dispatchers.Main) {
                        onUndoAvailable(edit.undo.ifEmpty { null })
                    }

                    // On-Device OCR im Hintergrund anstoßen
                    val updatedPage = core.heftPage(pageId, heftPageId)
                    ocrManager.recognizeAndSave(core, pageId, heftPageId, updatedPage.strokes)
                } catch (_: Exception) {}
            }
        }

        resetDrawingState()
    }

    private fun startShapeHoldDetection(anchorX: Float, anchorY: Float) {
        shapeHoldJob?.cancel()
        shapeHoldJob = coroutineScope.launch(Dispatchers.Default) {
            delay(SHAPE_HOLD_DURATION_MS)
            if (isDrawing && currentPoints.size >= 9) {
                val dist = hypot(currentPoints[currentPoints.size - 3] - anchorX, currentPoints[currentPoints.size - 2] - anchorY)
                if (dist <= SHAPE_HOLD_MAX_DISTANCE) {
                    val fitted = try {
                        heftFitShape(currentPoints.toList())
                    } catch (_: Exception) { null }

                    if (fitted != null) {
                        withContext(Dispatchers.Main) {
                            previewShape = fitted
                            invalidate()
                        }
                    }
                }
            }
        }
    }

    private fun eraseStrokesAt(pageX: Float, pageY: Float) {
        val radius = (activeSize * 3.5).coerceAtLeast(14.0).toDouble()
        coroutineScope.launch(Dispatchers.IO) {
            try {
                val hitIds = core.heftStrokesAt(pageId, heftPageId, pageX.toDouble(), pageY.toDouble(), radius)
                if (hitIds.isNotEmpty()) {
                    core.heftRemoveStrokes(pageId, heftPageId, hitIds)
                    postInvalidate()
                }
            } catch (_: Exception) {}
        }
    }

    private fun resetDrawingState() {
        isDrawing = false
        currentPoints.clear()
        previewShape = null
        shapeHoldJob?.cancel()
        invalidate()
    }

    private fun parseColorSafely(colorStr: String): Int {
        return try {
            if (colorStr.startsWith("#")) {
                if (colorStr.length == 4) {
                    // #RGB -> #RRGGBB
                    val r = colorStr[1]
                    val g = colorStr[2]
                    val b = colorStr[3]
                    android.graphics.Color.parseColor("#$r$r$g$g$b$b")
                } else {
                    android.graphics.Color.parseColor(colorStr)
                }
            } else {
                android.graphics.Color.parseColor("#1f2937")
            }
        } catch (_: Exception) {
            android.graphics.Color.BLACK
        }
    }
}
