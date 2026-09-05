function json(x,s=200){return new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json"}})}
export async function onRequestPost({request,env}){
 try{
  const {orderID}=await request.json(); if(!orderID)return json({error:"Missing orderID"},400);
  const base=env.PAYPAL_MODE==="live"?"https://api-m.paypal.com":"https://api-m.sandbox.paypal.com";
  const auth=Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const tok=await fetch(base+"/v1/oauth2/token",{method:"POST",headers:{Authorization:"Basic "+auth,"Content-Type":"application/x-www-form-urlencoded"},body:"grant_type=client_credentials"});
  const td=await tok.json(); if(!tok.ok)return json({error:"PayPal authentication failed."},500);
  const cap=await fetch(base+`/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`,{method:"POST",headers:{Authorization:"Bearer "+td.access_token,"Content-Type":"application/json"}});
  const cd=await cap.json(); if(!cap.ok)return json({error:"Capture failed."},400);
  const status=cd.status||cd.purchase_units?.[0]?.payments?.captures?.[0]?.status;
  if(status!=="COMPLETED")return json({error:"Payment was not completed."},400);
  let meta={}; try{meta=JSON.parse(cd.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id||cd.purchase_units?.[0]?.custom_id||"{}")}catch{}
  const pu=cd.purchase_units?.[0]; const custom=pu?.payments?.captures?.[0]?.custom_id;
  if(custom)try{meta=JSON.parse(custom)}catch{}
  if(!meta.name||!meta.url||!meta.amount)return json({error:"Payment completed but listing data is missing. Contact support."},500);
  await env.DB.prepare("INSERT INTO deals(name,url,description,amount,status,paypal_order_id) VALUES(?,?,?,?,?,?)").bind(meta.name,meta.url,meta.description,Number(meta.amount),"paid",orderID).run();
  return json({ok:true});
 }catch(e){return json({error:"Could not complete listing."},500)}
}
