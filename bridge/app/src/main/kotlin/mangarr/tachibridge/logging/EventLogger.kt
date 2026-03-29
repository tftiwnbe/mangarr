package mangarr.tachibridge.logging

import io.github.oshai.kotlinlogging.KLogger
import io.github.oshai.kotlinlogging.KotlinLogging
import org.slf4j.MDC

class LogContext internal constructor(
    private val fields: Map<String, String>,
) {
    companion object {
        val Empty = LogContext(emptyMap())

        fun of(vararg entries: Pair<String, Any?>): LogContext = Empty.with(*entries)
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
                next[normalizedKey] = value.toString()
            }
        }

        return LogContext(next)
    }

    fun <T> use(block: () -> T): T {
        val handles = fields.map { (key, value) -> MDC.putCloseable(key, value) }
        try {
            return block()
        } finally {
            handles.asReversed().forEach { it.close() }
        }
    }
}

class EventLogger private constructor(
    private val logger: KLogger,
    private val baseContext: LogContext,
) {
    companion object {
        fun named(name: String, vararg context: Pair<String, Any?>): EventLogger =
            EventLogger(KotlinLogging.logger(name), LogContext.of(*context))
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
        baseContext.with("event" to event, *context).use {
            when (level) {
                Level.DEBUG ->
                    if (error == null) {
                        logger.debug { message }
                    } else {
                        logger.debug(error) { message }
                    }

                Level.INFO ->
                    if (error == null) {
                        logger.info { message }
                    } else {
                        logger.info(error) { message }
                    }

                Level.WARN ->
                    if (error == null) {
                        logger.warn { message }
                    } else {
                        logger.warn(error) { message }
                    }

                Level.ERROR ->
                    if (error == null) {
                        logger.error { message }
                    } else {
                        logger.error(error) { message }
                    }
            }
        }
    }
}

private enum class Level {
    DEBUG,
    INFO,
    WARN,
    ERROR,
}
