// check-new-models.js — runs in GitHub Actions daily
// Scrapes ollama.com/library, compares with known-models.json, opens an issue if new models appear
const https = require("https");
const fs = require("fs");
const path = require("path");

const KNOWN_FILE = path.join(__dirname, "..", "known-models.json");

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const opts = { headers: { "User-Agent": "PrivateAI-ModelBot/1.0 (github-actions)" } };
    https.get(url, opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchUrl(res.headers.location));
      }
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function parseModelIds(html) {
  // Strategy 1: Next.js __NEXT_DATA__ JSON embed
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (match) {
    try {
      const data = JSON.parse(match[1]);
      const pp = data?.props?.pageProps;
      const arr = pp?.models ?? pp?.data ?? pp?.results;
      if (Array.isArray(arr) && arr.length > 0) {
        return arr.map((m) => (m.name || m.id || "").trim()).filter(Boolean);
      }
    } catch {}
  }
  // Strategy 2: anchor href regex
  const ids = [];
  const re = /href="\/library\/([a-z0-9._-]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

async function main() {
  console.log("Fetching https://ollama.com/library ...");
  const html = await fetchUrl("https://ollama.com/library");
  const current = parseModelIds(html);
  console.log(`Found ${current.length} models on Ollama library`);

  // Load baseline
  let known = [];
  let isFirstRun = false;
  if (fs.existsSync(KNOWN_FILE)) {
    known = JSON.parse(fs.readFileSync(KNOWN_FILE, "utf8"));
  } else {
    isFirstRun = true;
    console.log("First run — establishing baseline, no issue will be created.");
  }

  // Always write the updated list back
  fs.writeFileSync(KNOWN_FILE, JSON.stringify(current, null, 2));
  console.log("Updated known-models.json");

  if (isFirstRun) {
    console.log("Baseline set. Future runs will detect new models.");
    return;
  }

  const newModels = current.filter((id) => !known.includes(id));
  if (newModels.length === 0) {
    console.log("No new models detected.");
    return;
  }

  console.log(`NEW MODELS DETECTED: ${newModels.join(", ")}`);

  // Write to GITHUB_OUTPUT so the workflow can read it
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    const body = newModels.map((id) => `- \`${id}\` — https://ollama.com/library/${id}`).join("\n");
    fs.appendFileSync(githubOutput, `new_models<<EOF\n${body}\nEOF\n`);
  }
}

main().catch((e) => {
  console.error("Script failed:", e);
  process.exit(1);
});