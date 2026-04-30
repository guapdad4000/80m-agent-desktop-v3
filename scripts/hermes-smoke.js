#!/usr/bin/env node

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const HERMES_HOME = path.join(os.homedir(), ".hermes");
const ENV_FILE = path.join(HERMES_HOME, ".env");
const CONFIG_FILE = path.join(HERMES_HOME, "config.yaml");
const API_URL = process.env.HERMES_API_URL || "http://127.0.0.1:8642";
const RUN_CHAT = process.argv.includes("--chat");

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) env[key] = value;
  }
  return env;
}

function readModelConfig() {
  const fallback = { provider: "unknown", model: "MiniMax-M2.7" };
  if (!fs.existsSync(CONFIG_FILE)) return fallback;
  const text = fs.readFileSync(CONFIG_FILE, "utf8");
  const provider = text.match(/^\s*provider:[ \t]*["']?([^"'\n#]+)/m)?.[1];
  const model = text.match(
    /^\s*(?:default|model):[ \t]*["']?([^"'\n#]+)/m,
  )?.[1];
  return {
    provider: provider?.trim() || fallback.provider,
    model: model?.trim() || fallback.model,
  };
}

function request(method, pathname, body, headers = {}) {
  const url = new URL(pathname, API_URL);
  const payload = body ? JSON.stringify(body) : "";
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method,
        timeout: 30000,
        headers: {
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {}),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode, data }));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("request timed out"));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const env = readEnvFile(ENV_FILE);
  const modelConfig = readModelConfig();
  const auth = env.API_SERVER_KEY
    ? { Authorization: `Bearer ${env.API_SERVER_KEY}` }
    : {};

  const checks = [];
  checks.push({
    name: "Hermes home",
    ok: fs.existsSync(HERMES_HOME),
    detail: HERMES_HOME,
  });
  checks.push({
    name: "Config file",
    ok: fs.existsSync(CONFIG_FILE),
    detail: CONFIG_FILE,
  });
  checks.push({
    name: "API server key",
    ok: Boolean(env.API_SERVER_KEY),
    detail: env.API_SERVER_KEY ? "present" : "missing",
  });
  checks.push({
    name: "Model config",
    ok: Boolean(modelConfig.model),
    detail: `${modelConfig.provider} / ${modelConfig.model}`,
  });

  try {
    const health = await request("GET", "/health", null, auth);
    checks.push({
      name: "Gateway health",
      ok: health.status === 200,
      detail: `HTTP ${health.status}`,
    });
  } catch (error) {
    checks.push({
      name: "Gateway health",
      ok: false,
      detail: error.message,
    });
  }

  if (RUN_CHAT) {
    try {
      const response = await request(
        "POST",
        "/v1/chat/completions",
        {
          model: modelConfig.model,
          messages: [
            {
              role: "user",
              content: "Reply with exactly: smoke-ok",
            },
          ],
          stream: false,
        },
        auth,
      );
      let content = response.data;
      try {
        const parsed = JSON.parse(response.data);
        content = parsed.choices?.[0]?.message?.content || response.data;
      } catch {
        // keep raw body
      }
      checks.push({
        name: "Chat completion",
        ok: response.status === 200 && /smoke-ok/i.test(content),
        detail: `HTTP ${response.status}`,
      });
    } catch (error) {
      checks.push({
        name: "Chat completion",
        ok: false,
        detail: error.message,
      });
    }
  }

  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  }

  if (checks.some((check) => !check.ok)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
