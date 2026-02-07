set -e

# Configuration
JAR_FILE="${JAR_FILE:-app/build/libs/tachibridge-2.0.0.jar}"
PORT="${PORT:-50051}"
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
LOG_DIR="./logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/bridge-$(date +%Y%m%d-%H%M%S).log"

echo "Starting Extension Bridge gRPC Server..."
echo "Port: $PORT"
echo "Max Heap: $MAX_HEAP"
echo "Log: $LOG_FILE"

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
exec java -jar "$JAR_FILE" "$PORT" 2>&1 | tee "$LOG_FILE"
