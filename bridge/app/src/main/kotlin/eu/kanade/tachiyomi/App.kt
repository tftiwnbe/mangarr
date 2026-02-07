package eu.kanade.tachiyomi

import android.app.Application
import android.content.Context
import eu.kanade.tachiyomi.AppModule
import uy.kohesive.injekt.Injekt

@kotlinx.serialization.ExperimentalSerializationApi
open class App : Application() {
    override fun onCreate() {
        super.onCreate()

        Injekt.importModule(AppModule(this))
    }
}
