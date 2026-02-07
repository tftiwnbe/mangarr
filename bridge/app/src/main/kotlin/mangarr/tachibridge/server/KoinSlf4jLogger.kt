package mangarr.tachibridge.server

import io.github.oshai.kotlinlogging.KotlinLogging
import org.koin.core.logger.Level
import org.koin.core.logger.Logger

/**
 * Routes Koin internal logging through SLF4J so it honours the bridge logback configuration.
 */
class KoinSlf4jLogger(
    level: Level = Level.INFO,
) : Logger(level) {
    private val logger = KotlinLogging.logger("org.koin")

    override fun display(
        level: Level,
        msg: String,
    ) {
        when (level) {
            Level.DEBUG -> logger.debug { msg }
            Level.INFO -> logger.info { msg }
            Level.WARNING -> logger.warn { msg }
            Level.ERROR -> logger.error { msg }
            Level.NONE -> Unit
        }
    }
}
