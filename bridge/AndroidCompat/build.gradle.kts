plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.ktlint)
    alias(android.plugins.kotlin.serialization)
}

dependencies {
    // Shared
    implementation(android.bundles.shared)
    testImplementation(android.bundles.sharedTest)

    // Android stub library packaged locally to avoid network downloads
    implementation(files("$rootDir/app/lib/android.jar"))

    // XML
    compileOnly(android.xmlpull)

    // Config API
    implementation(projects.androidCompat.config)

    // APK sig verifier
    compileOnly(android.apksig)

    // AndroidX annotations
    compileOnly(android.android.annotations)

    // substitute for duktape-android/quickjs
    // implementation(android.bundles.polyglot)
    implementation(android.javet)

    // Kotlin wrapper around Java Preferences, makes certain things easier
    implementation(android.bundles.settings)

    // Android version of SimpleDateFormat
    implementation(android.icu4j)

    // OpenJDK lacks native JPEG encoder and native WEBP decoder
    implementation(android.bundles.twelvemonkeys)
    implementation(android.imageio.webp)
}
