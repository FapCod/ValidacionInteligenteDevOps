const supabaseUrl = 'https://mkmzrpuiyoxctbbnirbp.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rbXpycHVpeW94Y3RiYm5pcmJwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDE1MTM3MywiZXhwIjoyMDk5NzI3MzczfQ.njWofamPy2BwAzeygR1pRLMyUWaA4yzIRa4QFDzp-vM';

async function test() {
  console.log("Fetching validaciones with user JOIN...");
  const url = `${supabaseUrl}/rest/v1/validaciones?select=id,nombre_archivo,resultado_ia,es_valido,created_at,usuario:usuarios(nombre,email)&usuario_id=eq.12fdddb5-941d-4214-88a4-947eb3d4208c`;
  
  const res = await fetch(url, {
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`
    }
  });
  
  const data = await res.json();
  console.log("Status:", res.status);
  console.log("Response:", data);
}

test();
