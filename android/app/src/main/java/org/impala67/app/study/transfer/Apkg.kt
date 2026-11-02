package org.impala67.app.study.transfer

import android.database.sqlite.SQLiteDatabase
import androidx.core.text.HtmlCompat
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.time.Instant
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream
import kotlin.math.max
import kotlin.math.roundToLong

/** Karte für den .apkg-Export samt Lernstand (neu/gelernt, Fälligkeit, Intervall, Fehler). */
data class ApkgCard(val card: PlainCard, val isNew: Boolean, val due: Instant?, val stability: Double, val lapses: Int, val suspended: Boolean)

/**
 * Anki-Paket (web/extras.js `exportApkg` / `importApkgFile`): `collection.anki2` (SQLite, Schema 11)
 * plus leeres Medien-Manifest als ZIP. Medien werden nicht übernommen.
 */
object Apkg {
    private val SCHEMA = listOf(
        "CREATE TABLE col (id integer primary key, crt integer, mod integer, scm integer, ver integer, dty integer, usn integer, ls integer, conf text, models text, decks text, dconf text, tags text)",
        "CREATE TABLE notes (id integer primary key, guid text, mid integer, mod integer, usn integer, tags text, flds text, sfld text, csum integer, flags integer, data text)",
        "CREATE TABLE cards (id integer primary key, nid integer, did integer, ord integer, mod integer, usn integer, type integer, queue integer, due integer, ivl integer, factor integer, reps integer, lapses integer, left integer, odue integer, odid integer, flags integer, data text)",
        "CREATE TABLE revlog (id integer primary key, cid integer, usn integer, ease integer, ivl integer, lastIvl integer, factor integer, time integer, type integer)",
        "CREATE TABLE graves (usn integer, oid integer, type integer)",
    )

    fun export(cards: List<ApkgCard>, tmp: File): ByteArray {
        tmp.delete()
        val db = SQLiteDatabase.openOrCreateDatabase(tmp, null)
        try {
            SCHEMA.forEach(db::execSQL)
            val nowMs = System.currentTimeMillis()
            val nowSec = nowMs / 1000
            val crt = nowSec - 400 * 86_400
            val mid = 1600000000000L
            val model = JSONObject(
                """{"id":$mid,"name":"Impala67 Basic","type":0,"mod":$nowSec,"usn":-1,"sortf":0,"did":1,
                "tmpls":[{"name":"Karte 1","ord":0,"qfmt":"{{Front}}","afmt":"{{FrontSide}}<hr id=answer>{{Back}}","bqfmt":"","bafmt":"","did":null}],
                "flds":[{"name":"Front","ord":0,"sticky":false,"rtl":false,"font":"Arial","size":20},{"name":"Back","ord":1,"sticky":false,"rtl":false,"font":"Arial","size":20}],
                "css":".card{font-family:arial;font-size:20px;text-align:center;color:black;background-color:white}",
                "latexPre":"","latexPost":"","req":[[0,"any",[0]]]}""",
            )
            fun deck(id: Long, name: String) = JSONObject(
                """{"mod":$nowSec,"usn":-1,"collapsed":false,"desc":"","dyn":0,"conf":1,"extendNew":10,"extendRev":50,
                "newToday":[0,0],"revToday":[0,0],"lrnToday":[0,0],"timeToday":[0,0]}""",
            ).put("id", id).put("name", name)
            val decks = JSONObject().put("1", deck(1, "Default"))
            val deckIds = HashMap<String, Long>()
            cards.map { it.card.deck }.distinct().forEachIndexed { i, name ->
                val id = 1000L + i
                deckIds[name] = id
                decks.put("$id", deck(id, name))
            }
            val dconf = JSONObject(
                """{"1":{"id":1,"name":"Default","replayq":true,"timer":0,"maxTaken":60,"autoplay":true,"mod":0,"usn":-1,
                "lapse":{"delays":[10],"leechAction":0,"leechFails":8,"minInt":1,"mult":0},
                "rev":{"perDay":200,"ease4":1.3,"ivlFct":1,"maxIvl":36500,"bury":false,"minSpace":1,"fuzz":0.05,"hardFactor":1.2},
                "new":{"delays":[1,10],"ints":[1,4,0],"initialFactor":2500,"order":1,"perDay":20,"bury":false,"separate":true}}}""",
            )
            val conf = JSONObject(
                """{"nextPos":1,"estTimes":true,"activeDecks":[1],"sortType":"noteFld","timeLim":0,"sortBackwards":false,
                "addToCur":true,"curDeck":1,"newBury":true,"newSpread":0,"dueCounts":true,"curModel":"$mid","collapseTime":1200}""",
            )
            db.execSQL(
                "INSERT INTO col VALUES (1,?,?,?,11,0,0,0,?,?,?,?,?)",
                arrayOf<Any>(crt, nowSec, nowMs, conf.toString(), JSONObject().put("$mid", model).toString(), decks.toString(), dconf.toString(), "{}"),
            )
            var id = nowMs
            var pos = 1L
            db.beginTransaction()
            try {
                for (c in cards) {
                    id++
                    db.execSQL(
                        "INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                        arrayOf<Any>(id, UUID.randomUUID().toString().take(10), mid, nowSec, -1, "", c.card.front + "\u001f" + c.card.back, c.card.front.take(80), 0, 0, ""),
                    )
                    val dueDays = c.due?.let { max(0L, ((it.toEpochMilli() - crt * 1000) / 86_400_000.0).roundToLong()) } ?: 0L
                    db.execSQL(
                        "INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        arrayOf<Any>(
                            id, id, deckIds[c.card.deck] ?: 1L, 0, nowSec, -1, if (c.isNew) 0 else 2,
                            if (c.suspended) -1 else if (c.isNew) 0 else 2, if (c.isNew) pos++ else dueDays,
                            max(1L, c.stability.roundToLong()), 2500, 0, c.lapses, 0, 0, 0, 0, "",
                        ),
                    )
                }
                db.setTransactionSuccessful()
            } finally {
                db.endTransaction()
            }
        } finally {
            db.close()
        }
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { zip ->
            zip.putNextEntry(ZipEntry("collection.anki2")); zip.write(tmp.readBytes()); zip.closeEntry()
            zip.putNextEntry(ZipEntry("media")); zip.write("{}".toByteArray()); zip.closeEntry()
        }
        tmp.delete()
        return out.toByteArray()
    }

    /** Liest die Notizen eines Pakets; `null`, wenn keine `collection.anki2/anki21` darin liegt (neues zstd-Format). */
    fun import(bytes: ByteArray, tmp: File): List<PlainCard>? {
        var col: ByteArray? = null
        ZipInputStream(bytes.inputStream()).use { zip ->
            var e = zip.nextEntry
            while (e != null) {
                if (e.name == "collection.anki21" || (e.name == "collection.anki2" && col == null)) col = zip.readBytes()
                e = zip.nextEntry
            }
        }
        val data = col ?: return null
        tmp.writeBytes(data)
        val db = SQLiteDatabase.openDatabase(tmp.path, null, SQLiteDatabase.OPEN_READONLY)
        try {
            val deckNames = HashMap<Long, String>()
            runCatching {
                db.rawQuery("SELECT decks FROM col", null).use { cur ->
                    if (cur.moveToFirst()) {
                        val d = JSONObject(cur.getString(0))
                        d.keys().forEach { k -> d.optJSONObject(k)?.let { deckNames[it.optLong("id")] = it.optString("name", "Import").replace("/", "::") } }
                    }
                }
            }
            val out = ArrayList<PlainCard>()
            db.rawQuery("SELECT n.flds, c.did FROM notes n JOIN cards c ON c.nid = n.id AND c.ord = 0", null).use { cur ->
                while (cur.moveToNext()) {
                    val flds = cur.getString(0).split('\u001f')
                    val front = stripHtml(flds.first())
                    if (front.isEmpty()) continue
                    out += PlainCard(front, stripHtml(flds.drop(1).joinToString("\n\n")), deckNames[cur.getLong(1)] ?: "Import")
                }
            }
            return out
        } finally {
            db.close()
            tmp.delete()
        }
    }

    /** HTML der Anki-Felder als Klartext (Zeilenumbrüche bleiben); Bilder laden dabei nicht. */
    private fun stripHtml(s: String): String {
        val html = s.replace(Regex("<br\\s*/?>", RegexOption.IGNORE_CASE), "\n").replace(Regex("</div>\\s*<div>", RegexOption.IGNORE_CASE), "\n")
        return HtmlCompat.fromHtml(html.replace("\n", "<br>"), HtmlCompat.FROM_HTML_MODE_LEGACY).toString().replace(Regex("[￼]"), "").trim()
    }
}
