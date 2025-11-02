// keepalive.js
import { Redis } from "@upstash/redis";

/**
 * Behavior:
 * - Ping Upstash Redis (uses UPSTASH_REDIS_REST_URL & UPSTASH_REDIS_REST_TOKEN)
 * - Optionally ping a public HTTP endpoint (RENDER_PING_URL) if provided
 * - Trigger a repository dispatch to keep this repo/workflow active
 *
 * Environment variables expected:
 * - UPSTASH_REDIS_REST_URL
 * - UPSTASH_REDIS_REST_TOKEN
 * - (optional) RENDER_PING_URL  -> e.g. https://your-render-app.onrender.com/health
 * - (optional but recommended) GITHUB_TOKEN -> should be set to ${{ secrets.GITHUB_TOKEN }} in workflow env
 * - (optional) GITHUB_REPOSITORY -> owner/repo (usually available automatically in Actions environment)
 */

const nowIso = () => new Date().toISOString();

async function pingUpstash() {
  try {
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });

    const now = nowIso();
    await redis.set("keepalive", now);
    console.log(`✅ Upstash pinged at ${now}`);
    return { ok: true };
  } catch (err) {
    console.error("❌ Error pinging Upstash:", err?.message ?? err);
    // return failure but DO NOT exit non-zero; we still want to attempt self-dispatch
    return { ok: false, error: err };
  }
}

async function pingRender() {
  const url = process.env.RENDER_PING_URL;
  if (!url) {
    console.log("ℹ️ No RENDER_PING_URL configured — skipping Render ping.");
    return { skipped: true };
  }
  try {
    const res = await fetch(url, { method: "GET" });
    const code = res.status;
    console.log(`✅ Render ping ${url} -> HTTP ${code}`);
    return { ok: code >= 200 && code < 400, status: code };
  } catch (err) {
    console.error("❌ Error pinging Render:", err?.message ?? err);
    return { ok: false, error: err };
  }
}

async function triggerSelfDispatch() {
  // token for GitHub API (recommended to set in workflow env as GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }})
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY; // usually present in Actions runner: owner/repo

  if (!token) {
    console.warn("⚠️ GITHUB_TOKEN not found in environment. Self-dispatch skipped.");
    console.warn("If you want self-keepalive, add GITHUB_TOKEN to workflow env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}");
    return { skipped: true };
  }
  if (!repo) {
    console.warn("⚠️ GITHUB_REPOSITORY not found. Self-dispatch skipped.");
    return { skipped: true };
  }

  const url = `https://api.github.com/repos/${repo}/dispatches`;
  const body = { event_type: "keepalive" };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "keepalive-script",
      },
      body: JSON.stringify(body),
    });

    if (res.status === 204) {
      console.log(`✅ Self-dispatch triggered for ${repo} (204 No Content)`);
      return { ok: true };
    } else {
      // GitHub returns 204 for successful dispatch
      const text = await res.text().catch(() => "");
      console.warn(`⚠️ Self-dispatch returned ${res.status}. Response: ${text}`);
      return { ok: false, status: res.status, text };
    }
  } catch (err) {
    console.error("❌ Error triggering self-dispatch:", err?.message ?? err);
    return { ok: false, error: err };
  }
}

async function main() {
  console.log(`🔔 keepalive run at ${nowIso()}`);

  // 1) Upstash
  const upstashResult = await pingUpstash();

  // 2) Optional Render ping
  const renderResult = await pingRender();

  // 3) Trigger self-dispatch to prevent GitHub disabling scheduled workflow after inactivity
  const selfResult = await triggerSelfDispatch();

  // Determine overall exit behavior:
  // - We do NOT exit non-zero on Upstash or self-dispatch failure to avoid GitHub marking the scheduled run as failed.
  // - If you prefer strict failures, change behavior below.
  if (!upstashResult.ok) {
    console.warn("⚠️ Upstash ping failed. Logs above show details.");
  }
  if (selfResult.skipped) {
    console.warn("⚠️ Self-dispatch was skipped (token/repo missing). Add GITHUB_TOKEN to workflow env to enable it.");
  } else if (!selfResult.ok) {
    console.warn("⚠️ Self-dispatch may have failed. See logs.");
  }

  console.log("🔚 keepalive finished.");
  // exit code 0 so workflow run is counted as successful (so schedule continues). If you want strict failure, change to non-zero.
  process.exit(0);
}

main();
