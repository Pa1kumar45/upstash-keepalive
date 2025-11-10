import { Redis } from "@upstash/redis";

// Load from environment variables set in GitHub Actions
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function keepAlive() {
  try {
    const now = new Date().toISOString();
    await redis.set("keepalive", now);
    console.log("✅ Database pinged at", now);
  } catch (err) {
    console.error("❌ Error pinging database:", err);
    process.exit(1);
  }
}

keepAlive();
