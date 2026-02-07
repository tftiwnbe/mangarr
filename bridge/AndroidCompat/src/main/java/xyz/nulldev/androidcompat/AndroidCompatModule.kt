package xyz.nulldev.androidcompat

import android.content.Context
import org.koin.core.module.Module
import org.koin.dsl.module
import xyz.nulldev.androidcompat.androidimpl.CustomContext
import xyz.nulldev.androidcompat.androidimpl.FakePackageManager
import xyz.nulldev.androidcompat.info.ApplicationInfoImpl
import xyz.nulldev.androidcompat.io.AndroidFiles
import xyz.nulldev.androidcompat.pm.PackageController
import xyz.nulldev.androidcompat.service.ServiceSupport
import xyz.nulldev.ts.config.GlobalConfigManager
import xyz.nulldev.ts.config.ConfigManager

/**
 * AndroidCompatModule
 */

fun androidCompatModule(): Module =
    module {
        single { AndroidFiles() }

        // Bind the ConfigManager used by AndroidCompat components. The actual
        // instance is provided by the `GlobalConfigManager` singleton.
        single<ConfigManager> { GlobalConfigManager }

        single { ApplicationInfoImpl(get()) }

        single { ServiceSupport() }

        single { FakePackageManager() }

        single { PackageController() }

        single { CustomContext() }

        single<Context> { get<CustomContext>() }
        // Provide a default InitBrowserHandler implementation.
        // The KcefWebViewProvider expects an instance of this interface via Koin injection.
        // In the absence of a custom implementation, provide a no‑op stub so that the
        // provider can be constructed without throwing NoDefinitionFoundException.
        single<xyz.nulldev.androidcompat.webkit.KcefWebViewProvider.InitBrowserHandler> {
            object : xyz.nulldev.androidcompat.webkit.KcefWebViewProvider.InitBrowserHandler {
                override fun init(provider: xyz.nulldev.androidcompat.webkit.KcefWebViewProvider) {
                    // Default stub – does nothing.
                }
            }
        }
    }
