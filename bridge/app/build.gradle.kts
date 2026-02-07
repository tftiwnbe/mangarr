plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.buildConfig)
    alias(libs.plugins.shadowjar)

    application

    alias(libs.plugins.protobuf)
    alias(libs.plugins.serialization)
}

dependencies {
    implementation(libs.bundles.kotlin)
    implementation(libs.bundles.logging)
    implementation(libs.bundles.grpc)
    implementation(libs.bundles.network)
    implementation(libs.bundles.tachiyomi)
    implementation(libs.bundles.apk)
    implementation(libs.bundles.serialization)

    implementation(libs.koin)

    // AndroidCompat
    implementation(projects.androidCompat)
    implementation(projects.androidCompat.config)
}

protobuf {
    protoc {
        artifact =
            libs.protoc
                .asProvider()
                .get()
                .toString()
    }
    plugins {
        create("grpc") {
            artifact =
                libs.protoc.gen.grpc.java
                    .get()
                    .toString()
        }
        create("grpckt") {
            artifact = libs.protoc.gen.grpc.kotlin
                .get()
                .toString() + ":jdk8@jar"
        }
    }
    generateProtoTasks {
        all().forEach {
            it.plugins {
                create("grpc")
                create("grpckt")
            }
            it.builtins { create("kotlin") }
        }
    }
}

sourceSets {
    main {
        kotlin {
            srcDir("build/generated/src/main/kotlin")
            exclude("eu/kanade/tachiyomi/source/local/**")
        }
        // proto {
        //     srcDir("src/main/proto")
        // }
    }
}

application {
    applicationDefaultJvmArgs =
        listOf(
            "-Djunrar.extractor.thread-keep-alive-seconds=30",
        )
    mainClass.set("mangarr.tachibridge.MainKt")
}

buildConfig {
    className("BuildConfig")
    packageName("mangarr.tachibridge.generated")

    useKotlinOutput()

    fun quoteWrap(obj: Any): String = """"$obj""""

    buildConfigField("String", "NAME", quoteWrap(rootProject.name))
    buildConfigField("String", "VERSION", quoteWrap(project.version))
}

tasks {
    shadowJar {
        archiveClassifier.set("")
        archiveBaseName.set(rootProject.name)
        duplicatesStrategy = DuplicatesStrategy.EXCLUDE
        destinationDirectory.set(File("$rootDir/app/build"))
        isZip64 = true
        manifest { attributes["Main-Class"] = "mangarr.tachibridge.MainKt" }
        exclude("META-INF/*.SF", "META-INF/*.DSA", "META-INF/*.RSA")
    }

    // Copy proto files for main backend
    // register<Copy>("copyProto") {
    //     from("src/main/proto")
    //     into("python/proto")
    //     include("*.proto")
    // }

    // Make copyProto part of build
    // build {
    //     dependsOn("copyProto")
    // }
}
