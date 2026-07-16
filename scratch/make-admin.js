// scratch/make-admin.js
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
  const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/usuarios?email=eq.frankantoniopiato@gmail.com`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    },
    body: JSON.stringify({
      es_admin: true
    })
  });
  
  if (!response.ok) {
    console.error("HTTP Error:", response.status, await response.text());
  } else {
    const data = await response.json();
    console.log("Updated User:", data);
  }
}

run();
