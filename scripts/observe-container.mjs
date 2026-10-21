#!/usr/bin/env node

/**
 * ==============================================================================
 * Continuous Container Resource Monitor & Analyzer
 * ==============================================================================
 * Observes Docker container resource usage (RAM, CPU, Cache, Restarts, OOM)
 * continuously via Portainer Docker API or direct Docker engine API.
 *
 * Usage:
 *   node scripts/observe-container.mjs
 *   node scripts/observe-container.mjs --interval=3 --log=stats.csv
 * ==============================================================================
 */

import https from 'node:https';
import fs from 'node:fs';

const PORTAINER_URL = process.env.PORTAINER_URL || "https://port-ajaxocs.002529.xyz";
const PORTAINER_API_KEY = process.env.PORTAINER_API_KEY || "ptr_UZNNBO9lBhbwN9sY1SP+AbReKb/cTlO8VWDObrtLM8I=";
const ENDPOINT_ID = process.env.ENDPOINT_ID || 3;
const CONTAINER_NAME = process.env.CONTAINER_NAME || "amul_protein_tracker";

// Parse CLI flags
const args = process.argv.slice(2);
let intervalSec = 2;
let csvFile = null;
let maxSamples = Infinity;

for (const arg of args) {
  if (arg.startsWith('--interval=')) intervalSec = Math.max(1, parseInt(arg.split('=')[1], 10) || 2);
  if (arg.startsWith('--log=')) csvFile = arg.split('=')[1];
  if (arg.startsWith('--samples=')) maxSamples = parseInt(arg.split('=')[1], 10) || Infinity;
}

function requestPortainer(path) {
  return new Promise((resolve, reject) => {
    const url = `${PORTAINER_URL}${path}`;
    const req = https.get(url, {
      headers: { "X-API-Key": PORTAINER_API_KEY },
      rejectUnauthorized: false
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON from ${path}: ${data.slice(0, 100)}`));
        }
      });
    });
    req.on("error", reject);
  });
}

// Find container ID
async function resolveContainer() {
  const containers = await requestPortainer(`/api/endpoints/${ENDPOINT_ID}/docker/containers/json?all=1`);
  const match = containers.find(c => 
    c.Names && c.Names.some(n => n.includes(CONTAINER_NAME))
  );
  if (!match) {
    throw new Error(`Container matching "${CONTAINER_NAME}" not found on Portainer endpoint ${ENDPOINT_ID}`);
  }
  return {
    id: match.Id,
    shortId: match.Id.slice(0, 12),
    name: match.Names[0],
    image: match.Image,
    state: match.State,
    status: match.Status
  };
}

function formatBytes(bytes) {
  if (bytes === 0 || !bytes) return '0.00 MB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function renderBar(percent, width = 15) {
  const clamped = Math.min(100, Math.max(0, percent));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

// Statistics Accumulator
const stats = {
  startTime: new Date(),
  samples: 0,
  peakRealMemBytes: 0,
  minRealMemBytes: Infinity,
  sumRealMemBytes: 0,
  peakRawMemBytes: 0,
  peakCpuPercent: 0,
  sumCpuPercent: 0,
  limitBytes: 0,
  oomKilledDetected: false,
  initialRestarts: 0,
  latestRestarts: 0,
  samplesAbove85Pct: 0,
  samplesAbove95Pct: 0
};

function printSummary() {
  const durationSec = Math.round((new Date() - stats.startTime) / 1000);
  const avgMemBytes = stats.samples > 0 ? stats.sumRealMemBytes / stats.samples : 0;
  const avgCpu = stats.samples > 0 ? (stats.sumCpuPercent / stats.samples).toFixed(2) : "0.00";
  const limitMB = (stats.limitBytes / (1024 * 1024)).toFixed(0);

  console.log("\n" + "=".repeat(78));
  console.log(`📊 RESOURCE USAGE ANALYSIS REPORT — ${CONTAINER_NAME}`);
  console.log("=".repeat(78));
  console.log(`⏱️  Monitoring Duration : ${durationSec} seconds (${stats.samples} samples at ${intervalSec}s intervals)`);
  console.log(`💾 Memory Limit        : ${limitMB} MB`);
  console.log(`📈 Peak Active RAM     : ${formatBytes(stats.peakRealMemBytes)} (${((stats.peakRealMemBytes / stats.limitBytes) * 100).toFixed(1)}% of limit)`);
  console.log(`📉 Min Active RAM      : ${formatBytes(stats.minRealMemBytes === Infinity ? 0 : stats.minRealMemBytes)}`);
  console.log(`⚖️  Average Active RAM  : ${formatBytes(avgMemBytes)} (${((avgMemBytes / stats.limitBytes) * 100).toFixed(1)}% of limit)`);
  console.log(`📦 Peak Total Cgroup   : ${formatBytes(stats.peakRawMemBytes)} (includes page cache)`);
  console.log(`⚡ Peak CPU Usage      : ${stats.peakCpuPercent.toFixed(2)}%`);
  console.log(`⚡ Average CPU Usage   : ${avgCpu}%`);
  console.log(`🔄 Restart Delta       : +${stats.latestRestarts - stats.initialRestarts} restarts during test (Total: ${stats.latestRestarts})`);
  console.log(`🚨 OOM Killed Status   : ${stats.oomKilledDetected ? "YES (OOM-Killed detected!)" : "NO (Never killed by OOM)"}`);
  console.log(`⚠️  Samples > 85% Limit : ${stats.samplesAbove85Pct} (${stats.samples > 0 ? ((stats.samplesAbove85Pct/stats.samples)*100).toFixed(1) : 0}%)`);
  console.log(`🚨 Samples > 95% Limit : ${stats.samplesAbove95Pct} (${stats.samples > 0 ? ((stats.samplesAbove95Pct/stats.samples)*100).toFixed(1) : 0}%)`);
  console.log("-".repeat(78));

  // Health Verdict
  const peakPct = (stats.peakRealMemBytes / stats.limitBytes) * 100;
  if (stats.oomKilledDetected) {
    console.log("❌ VERDICT: CRITICAL — Container encountered OOM-Kills.");
  } else if (peakPct > 95) {
    console.log("⚠️  VERDICT: AT RISK — Container peaks dangerously close to 100MB limit (>95%).");
    console.log("   Recommendation: Add NODE_OPTIONS='--max-old-space-size=48' to force GC earlier,");
    console.log("   or eliminate the npm/wrapper subshell processes so only 1 Node instance runs.");
  } else if (peakPct > 80) {
    console.log("🟡 VERDICT: ACCEPTABLE WITH HIGH PRESSURE — Container stays within limit but has low buffer.");
  } else {
    console.log("✅ VERDICT: EXCELLENT — Container is strictly stable and well under the 100MB limit.");
  }
  console.log("=".repeat(78) + "\n");
}

process.on("SIGINT", () => {
  printSummary();
  process.exit(0);
});

process.on("SIGTERM", () => {
  printSummary();
  process.exit(0);
});

async function main() {
  console.log(`🔍 Connecting to Portainer (${PORTAINER_URL}) Endpoint ${ENDPOINT_ID}...`);
  const container = await resolveContainer();
  console.log(`✅ Located Container: ${container.name} [ID: ${container.shortId}]`);
  console.log(`📦 Image: ${container.image}`);
  console.log(`⚙️  Sampling every ${intervalSec}s | Press Ctrl+C at any time to generate final analysis\n`);

  // Initial container inspect
  const inspectData = await requestPortainer(`/api/endpoints/${ENDPOINT_ID}/docker/containers/${container.id}/json`);
  stats.initialRestarts = inspectData.RestartCount || 0;
  stats.latestRestarts = stats.initialRestarts;
  stats.oomKilledDetected = inspectData.State?.OOMKilled || false;

  if (csvFile) {
    fs.writeFileSync(csvFile, "timestamp,active_mem_mb,cgroup_mem_mb,limit_mb,mem_percent,cpu_percent,restarts,oom_killed\n");
    console.log(`📝 Logging samples to: ${csvFile}\n`);
  }

  // Header row
  console.log(
    "TIME".padEnd(9) +
    "ACTIVE RAM".padEnd(12) +
    "LIMIT".padEnd(10) +
    "MEMORY BAR [%]".padEnd(25) +
    "CPU %".padEnd(10) +
    "RESTARTS".padEnd(10) +
    "STATUS"
  );
  console.log("-".repeat(82));

  let prevCpu = null;

  while (stats.samples < maxSamples) {
    try {
      const [dockerStats, inspect] = await Promise.all([
        requestPortainer(`/api/endpoints/${ENDPOINT_ID}/docker/containers/${container.id}/stats?stream=false`),
        requestPortainer(`/api/endpoints/${ENDPOINT_ID}/docker/containers/${container.id}/json`)
      ]);

      const memUsage = dockerStats.memory_stats?.usage || 0;
      const memLimit = dockerStats.memory_stats?.limit || 104857600; // 100MB default
      stats.limitBytes = memLimit;

      const memStats = dockerStats.memory_stats?.stats || {};
      const fileCache = memStats.inactive_file || memStats.file || 0;
      const realMem = Math.max(0, memUsage - fileCache);

      // CPU %
      let cpuPercent = 0;
      if (prevCpu && dockerStats.cpu_stats && dockerStats.precpu_stats) {
        const cpuDelta = dockerStats.cpu_stats.cpu_usage.total_usage - prevCpu.cpu_usage;
        const sysDelta = dockerStats.cpu_stats.system_cpu_usage - prevCpu.system_cpu;
        const cpus = dockerStats.cpu_stats.online_cpus || 1;
        if (sysDelta > 0 && cpuDelta > 0) {
          cpuPercent = (cpuDelta / sysDelta) * cpus * 100;
        }
      }
      prevCpu = {
        cpu_usage: dockerStats.cpu_stats?.cpu_usage?.total_usage || 0,
        system_cpu: dockerStats.cpu_stats?.system_cpu_usage || 0
      };

      const percent = (realMem / memLimit) * 100;
      const restarts = inspect.RestartCount || 0;
      const oomKilled = inspect.State?.OOMKilled || false;
      const isRunning = inspect.State?.Running || false;

      // Accumulate
      stats.samples++;
      stats.sumRealMemBytes += realMem;
      stats.peakRealMemBytes = Math.max(stats.peakRealMemBytes, realMem);
      stats.minRealMemBytes = Math.min(stats.minRealMemBytes, realMem);
      stats.peakRawMemBytes = Math.max(stats.peakRawMemBytes, memUsage);
      stats.sumCpuPercent += cpuPercent;
      stats.peakCpuPercent = Math.max(stats.peakCpuPercent, cpuPercent);
      stats.latestRestarts = restarts;
      if (oomKilled) stats.oomKilledDetected = true;
      if (percent >= 85) stats.samplesAbove85Pct++;
      if (percent >= 95) stats.samplesAbove95Pct++;

      const now = new Date().toTimeString().split(' ')[0];
      const realMemMB = (realMem / (1024 * 1024)).toFixed(2) + " MB";
      const limitMB = (memLimit / (1024 * 1024)).toFixed(0) + " MB";
      const bar = `[${renderBar(percent, 12)}] ${percent.toFixed(1)}%`;
      const cpuStr = cpuPercent.toFixed(1) + "%";
      
      let statusTag = "🟢 OK";
      if (!isRunning) statusTag = "🔴 STOPPED";
      else if (oomKilled) statusTag = "💀 OOM-KILLED";
      else if (percent >= 90) statusTag = "🚨 HIGH";
      else if (percent >= 80) statusTag = "🟡 ELEVATED";

      console.log(
        now.padEnd(9) +
        realMemMB.padEnd(12) +
        limitMB.padEnd(10) +
        bar.padEnd(25) +
        cpuStr.padEnd(10) +
        String(restarts).padEnd(10) +
        statusTag
      );

      if (csvFile) {
        const line = `${new Date().toISOString()},${(realMem/(1024*1024)).toFixed(2)},${(memUsage/(1024*1024)).toFixed(2)},${(memLimit/(1024*1024)).toFixed(2)},${percent.toFixed(2)},${cpuPercent.toFixed(2)},${restarts},${oomKilled}\n`;
        fs.appendFileSync(csvFile, line);
      }

    } catch (err) {
      console.error(`⚠️  Sample Error: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, intervalSec * 1000));
  }

  printSummary();
}

main().catch(err => {
  console.error("❌ Fatal:", err.message);
  process.exit(1);
});
