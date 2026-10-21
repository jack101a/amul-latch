#!/usr/bin/env bash
# ==============================================================================
# Container Resource Monitor & Analyzer (Bash Edition)
# ==============================================================================
set -euo pipefail

PORTAINER_URL="${PORTAINER_URL:-https://port-ajaxocs.002529.xyz}"
PORTAINER_API_KEY="${PORTAINER_API_KEY:-ptr_UZNNBO9lBhbwN9sY1SP+AbReKb/cTlO8VWDObrtLM8I=}"
ENDPOINT_ID="${ENDPOINT_ID:-3}"
CONTAINER_NAME="${CONTAINER_NAME:-amul_protein_tracker}"
INTERVAL="${1:-2}"

echo "🔍 Finding container '$CONTAINER_NAME' on Portainer Endpoint $ENDPOINT_ID..."

CONTAINER_INFO=$(curl -k -s -H "X-API-Key: $PORTAINER_API_KEY" \
  "$PORTAINER_URL/api/endpoints/$ENDPOINT_ID/docker/containers/json?all=1" | \
  jq -r --arg name "$CONTAINER_NAME" '.[] | select(.Names[] | contains($name)) | "\(.Id) \(.Names[0]) \(.Image)"' | head -n 1)

if [ -z "$CONTAINER_INFO" ]; then
  echo "❌ Container matching '$CONTAINER_NAME' not found!"
  exit 1
fi

CONTAINER_ID=$(echo "$CONTAINER_INFO" | awk '{print $1}')
CONTAINER_DISPLAY_NAME=$(echo "$CONTAINER_INFO" | awk '{print $2}')
CONTAINER_IMAGE=$(echo "$CONTAINER_INFO" | awk '{print $3}')

echo "✅ Container: $CONTAINER_DISPLAY_NAME ($CONTAINER_ID)"
echo "📦 Image:     $CONTAINER_IMAGE"
echo "⏱️  Sampling every ${INTERVAL}s. Press Ctrl+C to stop."
echo ""

printf "%-10s %-14s %-10s %-16s %-10s %-10s %-10s\n" "TIME" "ACTIVE RAM" "LIMIT" "USAGE %" "CPU %" "RESTARTS" "STATUS"
echo "----------------------------------------------------------------------------------"

PREV_CPU=0
PREV_SYS=0

trap 'echo -e "\n🛑 Monitoring stopped."; exit 0' SIGINT SIGTERM

while true; do
  TIMESTAMP=$(date +'%H:%M:%S')

  STATS_JSON=$(curl -k -s -H "X-API-Key: $PORTAINER_API_KEY" \
    "$PORTAINER_URL/api/endpoints/$ENDPOINT_ID/docker/containers/$CONTAINER_ID/stats?stream=false")

  INSPECT_JSON=$(curl -k -s -H "X-API-Key: $PORTAINER_API_KEY" \
    "$PORTAINER_URL/api/endpoints/$ENDPOINT_ID/docker/containers/$CONTAINER_ID/json")

  RAW_USAGE=$(echo "$STATS_JSON" | jq -r '.memory_stats.usage // 0')
  LIMIT=$(echo "$STATS_JSON" | jq -r '.memory_stats.limit // 104857600')
  CACHE=$(echo "$STATS_JSON" | jq -r '(.memory_stats.stats.inactive_file // .memory_stats.stats.file // 0)')
  ACTIVE_MEM=$(( RAW_USAGE > CACHE ? RAW_USAGE - CACHE : RAW_USAGE ))

  ACTIVE_MB=$(awk "BEGIN {printf \"%.2f\", $ACTIVE_MEM / 1048576}")
  LIMIT_MB=$(awk "BEGIN {printf \"%.0f\", $LIMIT / 1048576}")
  PCT=$(awk "BEGIN {printf \"%.1f\", ($ACTIVE_MEM / $LIMIT) * 100}")

  CURR_CPU=$(echo "$STATS_JSON" | jq -r '.cpu_stats.cpu_usage.total_usage // 0')
  CURR_SYS=$(echo "$STATS_JSON" | jq -r '.cpu_stats.system_cpu_usage // 0')
  ONLINE_CPUS=$(echo "$STATS_JSON" | jq -r '.cpu_stats.online_cpus // 1')

  CPU_PCT="0.0"
  if [ "$PREV_SYS" -gt 0 ] && [ "$CURR_SYS" -gt "$PREV_SYS" ]; then
    CPU_DELTA=$(( CURR_CPU - PREV_CPU ))
    SYS_DELTA=$(( CURR_SYS - PREV_SYS ))
    CPU_PCT=$(awk "BEGIN {printf \"%.1f\", ($CPU_DELTA / $SYS_DELTA) * $ONLINE_CPUS * 100}")
  fi
  PREV_CPU=$CURR_CPU
  PREV_SYS=$CURR_SYS

  RESTARTS=$(echo "$INSPECT_JSON" | jq -r '.RestartCount // 0')
  OOM_KILLED=$(echo "$INSPECT_JSON" | jq -r '.State.OOMKilled // false')
  RUNNING=$(echo "$INSPECT_JSON" | jq -r '.State.Running // false')

  STATUS="🟢 OK"
  if [ "$RUNNING" != "true" ]; then
    STATUS="🔴 STOPPED"
  elif [ "$OOM_KILLED" = "true" ]; then
    STATUS="💀 OOM"
  elif (( $(echo "$PCT >= 90.0" | bc -l) )); then
    STATUS="🚨 HIGH"
  elif (( $(echo "$PCT >= 80.0" | bc -l) )); then
    STATUS="🟡 ELEV"
  fi

  printf "%-10s %-14s %-10s %-16s %-10s %-10s %-10s\n" \
    "$TIMESTAMP" "${ACTIVE_MB} MB" "${LIMIT_MB} MB" "${PCT}%" "${CPU_PCT}%" "$RESTARTS" "$STATUS"

  sleep "$INTERVAL"
done
