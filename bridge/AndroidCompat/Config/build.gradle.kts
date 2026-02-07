plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.ktlint)
    alias(android.plugins.kotlin.serialization)
}

dependencies {
    // Shared
    implementation(android.bundles.shared)
    testImplementation(android.bundles.sharedTest)
}
