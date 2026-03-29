set -e

# Configuration
JAR_FILE="${JAR_FILE:-app/build/libs/tachibridge-2.0.0.jar}"
PORT="${PORT:-3212}"
MAX_HEAP="${MAX_HEAP:-256m}"
MIN_HEAP="${MIN_HEAP:-128m}"

# JVM Options
JVM_OPTS=(
  "-Xmx${MAX_HEAP}"
  "-Xms${MIN_HEAP}"
  "-XX:+UseG1GC"
  "-XX:MaxGCPauseMillis=100"
  "-XX:+UseStringDeduplication"
  "-XX:+ParallelRefProcEnabled"
)

# Logging
LOG_ROOT="${MANGARR_LOG_ROOT:-./config/logs}"
LOG_DIR="${MANGARR_SYSTEM_LOG_DIR:-${LOG_ROOT}/system}"
BRIDGE_LOG_DIR="${MANGARR_BRIDGE_LOG_DIR:-${LOG_ROOT}/bridge}"
mkdir -p "$LOG_DIR" "$BRIDGE_LOG_DIR"
LOG_FILE="$LOG_DIR/bridge-console-$(date +%Y%m%d-%H%M%S).log"
export MANGARR_BRIDGE_LOG_DIR="$BRIDGE_LOG_DIR"

echo "Starting bridge runtime..."
echo "Port: $PORT"
echo "Max Heap: $MAX_HEAP"
echo "Console Log: $LOG_FILE"
echo "Structured Log Dir: $BRIDGE_LOG_DIR"

# Check if JAR exists
if [ ! -f "$JAR_FILE" ]; then
  echo "Error: JAR file not found: $JAR_FILE"
  echo "Run: ./gradlew jar"
  exit 1
fi

# Check Java version
JAVA_VERSION=$(java -version 2>&1 | head -1 | cut -d'"' -f2 | cut -d'.' -f1)
if [ "$JAVA_VERSION" -lt 17 ]; then
  echo "Error: Java 17+ required, found version $JAVA_VERSION"
  exit 1
fi

# Start server
exec java -jar "$JAR_FILE" --port "$PORT" 2>&1 | tee "$LOG_FILE"
