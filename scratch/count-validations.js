// scratch/count-validations.js
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "../.env.local");
const envContent = fs.readFileSync(envPath, "utf-8");
const env = {};
envContent.split("\n").forEach(line => {
  const parts = line.split("=");
  if (parts.length >= 2) {
    env[parts[0].trim()] = parts.slice(1).join("=").trim();
  }
});

async function run() {
  const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/validaciones?select=usuario_id`;
  const response = await fetch(url, {
    headers: {
      "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  
  if (!response.ok) {
    console.error("HTTP Error:", response.status, await response.text());
  } else {
    const data = await response.json();
    const counts = {};
    data.forEach(v => {
      counts[v.usuario_id] = (counts[v.usuario_id] || 0) + 1;
    });
    console.log("Validations counts per user:", counts);
  }
}

run();
