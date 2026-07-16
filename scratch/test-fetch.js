const supabaseUrl = 'https://mkmzrpuiyoxctbbnirbp.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rbXpycHVpeW94Y3RiYm5pcmJwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDE1MTM3MywiZXhwIjoyMDk5NzI3MzczfQ.njWofamPy2BwAzeygR1pRLMyUWaA4yzIRa4QFDzp-vM';

async function test() {
  console.log("Fetching usuarios...");
  const resUsers = await fetch(`${supabaseUrl}/rest/v1/usuarios?select=*`, {
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`
    }
  });
  const users = await resUsers.json();
  console.log("Users:", users);

  console.log("Fetching validaciones...");
  const resVals = await fetch(`${supabaseUrl}/rest/v1/validaciones?select=id,usuario_id,nombre_archivo`, {
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`
    }
  });
  const validations = await resVals.json();
  console.log("Validations:", validations);
}

test();
