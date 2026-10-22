#!/usr/bin/env node

/**
 * Automates waiting for GitHub Actions GHCR build and redeploying to Portainer Stack 58
 */

import { execSync } from 'node:child_process';
import https from 'node:https';

const PORTAINER_URL = process.env.PORTAINER_URL || "https://port-ajaxocs.002529.xyz";
const PORTAINER_API_KEY = process.env.PORTAINER_API_KEY || "ptr_UZNNBO9lBhbwN9sY1SP+AbReKb/cTlO8VWDObrtLM8I=";
const ENDPOINT_ID = 3;
const STACK_ID = 58;
const RUN_ID = process.argv[2] || "39727777472";

function requestPortainer(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${PORTAINER_URL}${urlPath}`);
    const req = https.request(url, {
      method,
      headers: {
        "X-API-Key": PORTAINER_API_KEY,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      rejectUnauthorized: false
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (e) {
          resolve(data);
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

async function checkGhRun() {
  try {
    const out = execSync(`gh run view ${RUN_ID} --json status,conclusion`, { encoding: 'utf-8' });
    return JSON.parse(out);
  } catch (err) {
    return { status: "unknown", error: err.message };
  }
}

async function main() {
  console.log(`⏳ Monitoring GitHub Actions Build #${RUN_ID}...`);
  const startTime = Date.now();
  const maxWaitMs = 35 * 60 * 1000;

  while (Date.now() - startTime < maxWaitMs) {
    const { status, conclusion } = await checkGhRun();
    const elapsedSec = Math.round((Date.now() - startTime) / 1000);
    console.log(`[+${elapsedSec}s] Status: ${status} | Conclusion: ${conclusion || 'in_progress'}`);

    if (status === "completed") {
      if (conclusion === "success") {
        console.log(`\n🎉 GitHub Actions Build Succeeded! Image published to GHCR.`);
        break;
      } else {
        console.error(`\n❌ GitHub Actions Build Failed: ${conclusion}`);
        process.exit(1);
      }
    }

    await new Promise(r => setTimeout(r, 15000));
  }

  console.log(`\n🚀 Redeploying Stack ${STACK_ID} on Portainer with latest GHCR image...`);

  // 1. Pull latest image on Portainer host
  console.log("📥 Pulling latest image from GHCR onto Portainer host...");
  await requestPortainer("POST", `/api/endpoints/${ENDPOINT_ID}/docker/images/create?fromImage=ghcr.io/jack101a/amul-protein-tracker:latest`);

  // 2. Locate existing container
  const containers = await requestPortainer("GET", `/api/endpoints/${ENDPOINT_ID}/docker/containers/json?all=1`);
  const existing = containers.find(c => c.Names && c.Names.some(n => n.includes("amul_protein_tracker")));

  if (existing) {
    console.log(`🛑 Stopping and removing old container ${existing.Id.slice(0, 12)}...`);
    try {
      await requestPortainer("POST", `/api/endpoints/${ENDPOINT_ID}/docker/containers/${existing.Id}/stop`);
    } catch {}
    try {
      await requestPortainer("DELETE", `/api/endpoints/${ENDPOINT_ID}/docker/containers/${existing.Id}`);
    } catch {}
  }

  // 3. Trigger Git redeploy of Stack 58
  console.log(`📡 Triggering Stack ${STACK_ID} Git redeploy...`);
  await requestPortainer("POST", `/api/stacks/${STACK_ID}/git/redeploy?endpointId=${ENDPOINT_ID}`, {
    prune: true,
    pullImage: true
  });

  console.log("✅ Redeployment triggered. Waiting 12s for container to spin up...");
  await new Promise(r => setTimeout(r, 12000));

  // 4. Verify new container
  const afterContainers = await requestPortainer("GET", `/api/endpoints/${ENDPOINT_ID}/docker/containers/json?all=1`);
  const newContainer = afterContainers.find(c => c.Names && c.Names.some(n => n.includes("amul_protein_tracker")));

  if (newContainer) {
    console.log(`\n✅ Container Active: ${newContainer.Names[0]} [ID: ${newContainer.Id.slice(0, 12)}]`);
    console.log(`📦 Status: ${newContainer.Status} (${newContainer.State})`);

    const top = await requestPortainer("GET", `/api/endpoints/${ENDPOINT_ID}/docker/containers/${newContainer.Id}/top`);
    console.log("\n📋 Active Processes inside container:");
    if (top.Processes) {
      top.Processes.forEach(p => console.log(`   - PID ${p[1]}: ${p[7]}`));
    }
  } else {
    console.warn("⚠️ Container not found after redeploy. Check Portainer logs.");
  }

  console.log("\n🎯 Finished successfully!");
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
