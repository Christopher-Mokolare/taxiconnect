const base = process.env.BASE_URL || "http://127.0.0.1:8787";
const pin = process.env.E2E_PIN || "111111";

async function login(role, name) {
  const r = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: {"content-type":"application/json"},
    body: JSON.stringify({role,name,pin})
  });
  if (!r.ok) throw new Error("login failed: "+r.status+" "+await r.text());
  return (await r.json()).token;
}
const token = await login("conductor","E2E Conductor");
const wsUrl = base.replace(/^http/,"ws") + "/ws";
const ws = new WebSocket(wsUrl);
const first = await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error("websocket connect timeout")),5000);
  ws.addEventListener("message",e=>{clearTimeout(timer);resolve(JSON.parse(e.data))},{once:true});
  ws.addEventListener("error",()=>{clearTimeout(timer);reject(new Error("websocket error"))},{once:true});
});
if(first.type!=="connected") throw new Error("expected connected event");

const eventPromise=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error("broadcast timeout")),5000);
  ws.addEventListener("message",e=>{clearTimeout(timer);resolve(JSON.parse(e.data))},{once:true});
});
const r=await fetch(base+"/api/conductor/line/open",{
  method:"POST",
  headers:{"content-type":"application/json",Authorization:"Bearer "+token},
  body:JSON.stringify({operatorId:"e2e-operator",routeId:"e2e-route"})
});
if(!r.ok) throw new Error("line open failed: "+r.status+" "+await r.text());
const event=await eventPromise;
if(!event.type) throw new Error("broadcast event missing type");
ws.close();
console.log("PASS | realtime websocket connect");
console.log("PASS | realtime broadcast | "+event.type);
