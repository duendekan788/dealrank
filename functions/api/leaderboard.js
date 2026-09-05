export async function onRequestGet({env}) {
 try {
  const {results}=await env.DB.prepare("SELECT id,name,url,description,amount,created_at FROM deals WHERE status='paid' ORDER BY amount DESC, created_at ASC LIMIT 100").all();
  return Response.json(results||[]);
 } catch(e){ return Response.json({error:"Database not configured."},{status:500}); }
}
