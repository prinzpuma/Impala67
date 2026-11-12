package org.impala67.app.heft

import android.os.SystemClock
import java.util.concurrent.atomic.AtomicLong

/**
 * Merkt sich, wann zuletzt im Heft mit dem Stift gearbeitet wurde (wie `heft:is-writing` der PWA):
 * Cloudflare-Sync und Hintergrund-OCR warten, solange geschrieben wird, statt die Kern-Sperre
 * mitten im Strich zu belegen.
 */
object HeftActivity {
    private val lastWriteMs = AtomicLong(-1L)

    fun noteWrite() {
        lastWriteMs.set(SystemClock.uptimeMillis())
    }

    /** Ob in den letzten [withinMs] Millisekunden im Heft geschrieben wurde. */
    fun isWriting(withinMs: Long): Boolean {
        val last = lastWriteMs.get()
        return last >= 0L && SystemClock.uptimeMillis() - last < withinMs
    }
}
