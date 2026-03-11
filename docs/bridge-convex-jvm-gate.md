# Bridge Direct Convex JVM Gate

Date: 2026-03-11

Status: failed

## Goal

Verify whether the official Convex Kotlin client can be used directly from the current
`bridge/` runtime, which is a plain Kotlin/JVM server.

This gate was required before removing the Node `worker/` service and migrating bridge
to a direct `bridge -> Convex` architecture.

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

Per the cutover plan assumptions:

- do not proceed with worker removal,
- do not proceed with direct bridge-to-Convex migration,
- do not introduce an HTTP fallback or token broker in place of the failed gate.

The existing `worker -> bridge -> Convex` architecture remains the active path until a
new migration plan is approved.
