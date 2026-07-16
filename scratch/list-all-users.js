// scratch/list-all-users.js
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// Read env manual
const envPath = path.join(__dirname, "../.env.local");
const envContent = fs.readFileSync(envPath, "utf-8");
const env = {};
envContent.split("\n").forEach(line => {
  const parts = line.split("=");
  if (parts.length >= 2) {
    env[parts[0].trim()] = parts.slice(1).join("=").trim();
  }
});

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const { data, error } = await supabase
    .from("usuarios")
    .select("id, nombre, email, es_admin");
  
  if (error) {
    console.error("Error:", error);
  } else {
    console.log("Users:", data);
  }
}

run();
