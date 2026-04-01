# Bridge Direct Convex JVM Gate

Date: 2026-03-11

Status: historical (failed, superseded)

## Current Architecture Note

This document records a failed feasibility gate for the native Kotlin Convex client.
It is kept for audit trail only.

Current runtime architecture is:

- browser/web -> Convex (reactive queries + mutations),
- web server -> bridge HTTP control/data routes (internal),
- bridge -> Convex via HTTP OpenAPI client with service authentication.

An earlier orchestration design is no longer the active runtime.

## Goal

Verify whether the official Convex Kotlin client can be used directly from the current
`bridge/` runtime, which is a plain Kotlin/JVM server.

This gate was required before finalizing the direct `bridge -> Convex`
architecture used today.

## Inputs

- Bridge runtime: Kotlin/JVM (`bridge/app`)
- Official client docs: <https://docs.convex.dev/client/android>
- Documented dependency:
  `implementation("dev.convex:android-convexmobile:0.8.0@aar")`

## Probe

A scratch Gradle project was created outside the repo and compiled with the repository
Gradle wrapper. The probe attempted to:

1. add the official Convex Kotlin dependency exactly as documented,
2. compile a minimal JVM `main()` that imports `dev.convex.android.ConvexClient`,
3. confirm whether the dependency can be consumed by a standard JVM target.

Reproduction command:

```bash
tmpdir=$(mktemp -d)
mkdir -p "$tmpdir/src/main/kotlin"

cat > "$tmpdir/settings.gradle.kts" <<'EOF'
rootProject.name = "convex-jvm-probe"
EOF

cat > "$tmpdir/build.gradle.kts" <<'EOF'
plugins {
  kotlin("jvm") version "2.2.21"
  kotlin("plugin.serialization") version "2.2.21"
}

repositories {
  mavenCentral()
  google()
}

dependencies {
  implementation("dev.convex:android-convexmobile:0.8.0@aar") {
    isTransitive = true
  }
  implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
}

kotlin {
  jvmToolchain(21)
}
EOF

cat > "$tmpdir/src/main/kotlin/Main.kt" <<'EOF'
import dev.convex.android.ConvexClient

fun main() {
  val client = ConvexClient("http://127.0.0.1:3210")
  println(client)
}
EOF

./bridge/gradlew -p "$tmpdir" compileKotlin --stacktrace
```

## Result

Compilation failed during dependency resolution:

```text
Could not resolve dev.convex:android-convexmobile:0.8.0.
No matching variant of dev.convex:android-convexmobile:0.8.0 was found.
... attribute 'org.jetbrains.kotlin.platform.type' with value 'androidJvm'
... the consumer needed ... 'jvm'
```

## Decision

The gate is a no-go for the current migration plan.

The official Convex Kotlin client documented for Android cannot be consumed directly by
the current plain JVM bridge module without changing the runtime model or introducing a
non-approved fallback.

The original no-go conclusion for a native Kotlin Convex client remains valid for this
probe. The project proceeded with the approved HTTP-based bridge-to-Convex integration
instead.
