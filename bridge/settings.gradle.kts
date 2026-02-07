enableFeaturePreview("TYPESAFE_PROJECT_ACCESSORS")

pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
        google()
        maven(url = "https://jogamp.org/deployment/maven")
        maven(url = "https://www.jitpack.io")
    }
}

dependencyResolutionManagement {
    versionCatalogs {
        create("android") {
            from(files("gradle/android.versions.toml"))
        }
    }
    repositories {
        mavenCentral()
        google()
        maven("https://maven.pkg.jetbrains.space/public/p/compose/dev")
        maven("https://jogamp.org/deployment/maven")
        maven(url = "https://www.jitpack.io")
    }
}

rootProject.name = "tachibridge"
include("app")

include("AndroidCompat")
include("AndroidCompat:Config")
