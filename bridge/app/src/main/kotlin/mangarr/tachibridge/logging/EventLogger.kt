package mangarr.tachibridge.logging

import java.nio.file.Path
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import net.logstash.logback.marker.Markers
import org.slf4j.Logger
import org.slf4j.LoggerFactory
import org.slf4j.MDC

class LogContext internal constructor(
    private val fields: Map<String, Any?>,
) {
    companion object {
        private val threadLocal = ThreadLocal.withInitial { emptyList<Map<String, Any?>>() }

        val Empty = LogContext(emptyMap())

        fun of(vararg entries: Pair<String, Any?>): LogContext = Empty.with(*entries)

        fun current(): Map<String, Any?> =
            threadLocal.get().fold(emptyMap()) { acc, fields -> acc + fields }
    }

    fun with(vararg entries: Pair<String, Any?>): LogContext {
        if (entries.isEmpty()) {
            return this
        }

        val next = fields.toMutableMap()
        for ((key, value) in entries) {
            val normalizedKey = key.trim()
            if (normalizedKey.isEmpty()) {
                continue
            }

            if (value == null) {
                next.remove(normalizedKey)
            } else {
                next[normalizedKey] = normalizeLogValue(value)
            }
        }

        return LogContext(next)
    }

    fun <T> use(block: () -> T): T {
        val previous = threadLocal.get()
        threadLocal.set(previous + listOf(fields))
        val handles =
            fields.mapNotNull { (key, value) ->
                value?.let { MDC.putCloseable(key, stringifyMdcValue(it)) }
            }
        try {
            return block()
        } finally {
            handles.asReversed().forEach { it.close() }
            threadLocal.set(previous)
        }
    }

    internal fun values(): Map<String, Any?> = fields
}

class EventLogger private constructor(
    private val logger: Logger,
    private val baseContext: LogContext,
) {
    companion object {
        fun named(name: String, vararg context: Pair<String, Any?>): EventLogger =
            EventLogger(LoggerFactory.getLogger(name), LogContext.of(*context))
    }

    fun withContext(vararg context: Pair<String, Any?>): EventLogger =
        EventLogger(logger, baseContext.with(*context))

    fun <T> inContext(vararg context: Pair<String, Any?>, block: () -> T): T =
        baseContext.with(*context).use(block)

    fun info(event: String, message: String, vararg context: Pair<String, Any?>) {
        emit(Level.INFO, event, message, null, context)
    }

    fun debug(event: String, message: String, vararg context: Pair<String, Any?>) {
        emit(Level.DEBUG, event, message, null, context)
    }

    fun warn(event: String, message: String, vararg context: Pair<String, Any?>) {
        emit(Level.WARN, event, message, null, context)
    }

    fun error(
        event: String,
        message: String,
        error: Throwable? = null,
        vararg context: Pair<String, Any?>,
    ) {
        emit(Level.ERROR, event, message, error, context)
    }

    private fun emit(
        level: Level,
        event: String,
        message: String,
        error: Throwable?,
        context: Array<out Pair<String, Any?>>,
    ) {
        val fields = LinkedHashMap(LogContext.current())
        fields.putAll(baseContext.with("event" to event, *context).values())
        val marker = Markers.appendEntries(fields)
        when (level) {
            Level.DEBUG ->
                if (error == null) {
                    logger.debug(marker, message)
                } else {
                    logger.debug(marker, message, error)
                }

            Level.INFO ->
                if (error == null) {
                    logger.info(marker, message)
                } else {
                    logger.info(marker, message, error)
                }

            Level.WARN ->
                if (error == null) {
                    logger.warn(marker, message)
                } else {
                    logger.warn(marker, message, error)
                }

            Level.ERROR ->
                if (error == null) {
                    logger.error(marker, message)
                } else {
                    logger.error(marker, message, error)
                }
        }
    }
}

internal fun normalizeLogValue(value: Any?): Any? =
    when (value) {
        null -> null
        is String, is Number, is Boolean -> value
        is Path -> value.toString()
        is Enum<*> -> value.name
        is JsonObject ->
            value.entries.associate { (key, item) ->
                key to normalizeLogValue(item)
            }
        is JsonArray -> value.map(::normalizeLogValue)
        is JsonPrimitive -> normalizeJsonPrimitive(value)
        is JsonNull -> null
        is Map<*, *> ->
            value.entries.associate { (key, item) ->
                key.toString() to normalizeLogValue(item)
            }
        is Iterable<*> -> value.map(::normalizeLogValue)
        is Array<*> -> value.map(::normalizeLogValue)
        else -> value.toString()
    }

private fun normalizeJsonPrimitive(value: JsonPrimitive): Any? {
    if (value.isString) {
        return value.content
    }
    val content = value.content
    when {
        content.equals("true", ignoreCase = true) -> return true
        content.equals("false", ignoreCase = true) -> return false
        content.toLongOrNull() != null -> return content.toLong()
        content.toDoubleOrNull() != null -> return content.toDouble()
        else -> return content
    }
}

private fun stringifyMdcValue(value: Any): String =
    when (value) {
        is String -> value
        else -> value.toString()
    }

private enum class Level {
    DEBUG,
    INFO,
    WARN,
    ERROR,
}
