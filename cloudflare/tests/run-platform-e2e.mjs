const base = process.env.BASE_URL || "http://127.0.0.1:8787";
const pin = process.env.E2E_PIN || "111111";
let pass=0,fail=0,total=0;

async function req(name, method, path, {token="", body, expected=200, passenger=false}={}) {
  total++;
  const headers={"content-type":"application/json"};
  if(token) headers.authorization="Bearer "+token;
  if(passenger) headers["x-passenger-id"]="e2e-passenger";
  const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text(); let data={}; try{data=JSON.parse(text)}catch{}
  if(r.status!==expected){fail++;console.error(`FAIL | ${name} | got ${r.status} expected ${expected}`,text);throw new Error(name+" failed")}
  pass++; console.log(`PASS | ${name} | ${r.status}`);
  return data;
}
async function login(role,name){
  const d=await req("login "+role,"POST","/api/auth/login",{body:{role,name,pin},expected:200});
  return d.token;
}
async function expectDenied(name,token,path){await req(name,"GET",path,{token,expected:403})}

const SUPER=await login("superadmin","E2E Super Admin");
const OP=await login("operator_admin","E2E Operator Admin");
const DRV=await login("driver","E2E Driver");
const COND=await login("conductor","E2E Conductor");

await req("health","GET","/api/health");
await req("superadmin dashboard","GET","/api/superadmin/dashboard",{token:SUPER});
await req("superadmin operators","GET","/api/superadmin/operators",{token:SUPER});
await req("superadmin routes","GET","/api/superadmin/routes",{token:SUPER});
await req("superadmin users","GET","/api/superadmin/users",{token:SUPER});
await req("superadmin taxis","GET","/api/superadmin/taxis",{token:SUPER});
await req("superadmin trips","GET","/api/superadmin/trips",{token:SUPER});
await req("superadmin audit","GET","/api/superadmin/audit",{token:SUPER});
await req("superadmin incidents","GET","/api/superadmin/incidents",{token:SUPER});
await req("superadmin health","GET","/api/superadmin/health",{token:SUPER});

await expectDenied("operator admin denied superadmin",OP,"/api/superadmin/dashboard");
await expectDenied("conductor denied operator admin",COND,"/api/operator/overview");
await expectDenied("driver denied conductor",DRV,"/api/conductor/stats?operatorId=e2e-operator");
await req("unauthenticated denied","GET","/api/superadmin/dashboard",{expected:401});

const createdOp=await req("superadmin creates second operator","POST","/api/superadmin/operator/create",{token:SUPER,body:{name:"E2E Second Operator",registrationNumber:"E2E-OP-002"}});
const op2=createdOp.operator.id;
const createdRoute=await req("superadmin creates collection route","POST","/api/superadmin/route/create",{token:SUPER,body:{origin:"Village A",destination:"Rustenburg",serviceMode:"COLLECTION"}});
const collectionRoute=createdRoute.route.id;
await req("superadmin authorizes second operator","POST","/api/superadmin/operator/authorize-route",{token:SUPER,body:{operatorId:op2,routeId:collectionRoute}});
const admin2=await req("superadmin provisions operator admin","POST","/api/superadmin/operator-admin/create",{token:SUPER,body:{operatorId:op2,name:"E2E Second Admin",phone:"0110000009"}});
if(!admin2.user.id) throw new Error("admin provisioning did not return user");

await req("operator overview","GET","/api/operator/overview",{token:OP});
const taxi2=await req("operator creates taxi","POST","/api/operator/taxi/create",{token:OP,body:{operatorId:"e2e-operator",vehicleRegistrationNumber:"E2E-TAXI-002",capacity:15}});
const driver2=await req("operator creates driver","POST","/api/operator/members/create",{token:OP,body:{name:"E2E Driver 2",role:"driver",phone:"0110000002"}});
await req("operator creates conductor","POST","/api/operator/members/create",{token:OP,body:{name:"E2E Conductor 2",role:"conductor",phone:"0110000003"}});
await req("operator route points","GET","/api/operator/route-points?routeId=e2e-route",{token:OP});
await req("operator adds pickup point","POST","/api/operator/route-points",{token:OP,body:{routeId:"e2e-route",name:"Village B",pointType:"PICKUP",sequence:3,address:"Village B"}});
await req("operator assigns driver","POST","/api/operator/taxi/assign-driver",{token:OP,body:{operatorId:"e2e-operator",taxiId:taxi2.taxi.id,driverId:driver2.user.id}});
await req("operator authorizes taxi","POST","/api/operator/taxi/authorize-route",{token:OP,body:{operatorId:"e2e-operator",taxiId:taxi2.taxi.id,routeId:"e2e-route"}});

const cond2=await req("conductor session","GET","/api/conductor/session",{token:COND});
const opened=await req("conductor opens daily line","POST","/api/conductor/line/open",{token:COND,body:{operatorId:"e2e-operator",routeId:"e2e-route"}});
const lineId=opened.line.id;
await req("conductor taxi pool","GET","/api/conductor/taxis?operatorId=e2e-operator&routeId=e2e-route",{token:COND});
await req("conductor adds first taxi","POST","/api/conductor/line/add",{token:COND,body:{lineSessionId:lineId,taxiId:"e2e-taxi"}});
await req("conductor adds second taxi","POST","/api/conductor/line/add",{token:COND,body:{lineSessionId:lineId,taxiId:taxi2.taxi.id}});
await req("conductor reorder line","POST","/api/conductor/line/reorder",{token:COND,body:{lineSessionId:lineId,taxiIds:["e2e-taxi",taxi2.taxi.id]}});
await req("conductor demand view","GET","/api/conductor/demand?operatorId=e2e-operator&routeId=e2e-route",{token:COND});
await req("conductor stats","GET","/api/conductor/stats?operatorId=e2e-operator",{token:COND});
await req("conductor summon route demand","POST","/api/conductor/summon",{token:COND,body:{operatorId:"e2e-operator",routeId:"e2e-route",requestType:"ROUTE_DEMAND",passengerCount:4}});

const waiting=await req("passenger rank waiting","POST","/api/passenger/waiting",{passenger:true,body:{routeId:"e2e-route",originPointId:"e2e-origin",destinationPointId:"e2e-destination",requestMode:"RANK",pickupPointId:"e2e-origin",groupSize:2}});
await req("passenger duplicate waiting idempotent","POST","/api/passenger/waiting",{passenger:true,body:{routeId:"e2e-route",originPointId:"e2e-origin",destinationPointId:"e2e-destination",requestMode:"RANK",pickupPointId:"e2e-origin",groupSize:2}});
await req("passenger cancel waiting","POST","/api/passenger/cancel-waiting",{passenger:true,body:{waitingId:waiting.waiting?.id || waiting.waitingId || waiting.id}});
await req("passenger along-route waiting","POST","/api/passenger/waiting",{passenger:true,body:{routeId:"e2e-route",originPointId:"e2e-mid",destinationPointId:"e2e-destination",requestMode:"ALONG_ROUTE",pickupPointId:"e2e-mid",groupSize:1}});
await req("passenger collection waiting","POST","/api/passenger/waiting",{passenger:true,body:{routeId:collectionRoute,originPointId:createdRoute.route.originPointId,destinationPointId:createdRoute.route.destinationPointId,requestMode:"COLLECTION",pickupPointId:createdRoute.route.originPointId,groupSize:1}});
await req("passenger demand","POST","/api/passenger/demand",{passenger:true,body:{routeId:"e2e-route",originPointId:"e2e-origin",destinationPointId:"e2e-destination",requestMode:"RANK",pickupPointId:"e2e-origin",groupSize:2}});
await req("passenger duplicate demand idempotent","POST","/api/passenger/demand",{passenger:true,body:{routeId:"e2e-route",originPointId:"e2e-origin",destinationPointId:"e2e-destination",requestMode:"RANK",pickupPointId:"e2e-origin",groupSize:2}});
await req("passenger same point rejected","POST","/api/passenger/waiting",{passenger:true,expected:400,body:{routeId:"e2e-route",originPointId:"e2e-origin",destinationPointId:"e2e-origin",requestMode:"RANK",pickupPointId:"e2e-origin",groupSize:1}});
await req("passenger cross route point rejected","POST","/api/passenger/waiting",{passenger:true,expected:400,body:{routeId:"e2e-route",originPointId:createdRoute.route.originPointId,destinationPointId:"e2e-destination",requestMode:"RANK",pickupPointId:"e2e-origin",groupSize:1}});

await req("conductor sees passenger demand","GET","/api/conductor/demand?operatorId=e2e-operator&routeId=e2e-route",{token:COND});

await req("driver session","GET","/api/driver/session",{token:DRV});
await req("driver routes","GET","/api/driver/routes",{token:DRV});
await req("driver go live","POST","/api/driver/go-live",{token:DRV,body:{taxiId:"e2e-taxi",routeId:"e2e-route",originPointId:"e2e-origin",destinationPointId:"e2e-destination",passengersOnboard:0}});
await req("driver passenger update","POST","/api/driver/passengers",{token:DRV,body:{taxiId:"e2e-taxi",passengersOnboard:2}});
await req("driver full","POST","/api/driver/passengers",{token:DRV,body:{taxiId:"e2e-taxi",passengersOnboard:15}});
await req("driver departed","POST","/api/driver/status",{token:DRV,body:{taxiId:"e2e-taxi",status:"DEPARTED"}});
await req("driver invalid departed to loading rejected","POST","/api/driver/status",{token:DRV,expected:409,body:{taxiId:"e2e-taxi",status:"LOADING"}});
await req("driver arrived","POST","/api/driver/status",{token:DRV,body:{taxiId:"e2e-taxi",status:"ARRIVED"}});
await req("operator sees completed trip","GET","/api/operator/overview",{token:OP});

await req("conductor removes taxi","POST","/api/conductor/line/remove",{token:COND,body:{lineEntryId:(await req("line read","GET","/api/conductor/line?lineSessionId="+encodeURIComponent(lineId),{token:COND})).line.entries.find(e=>e.taxi_id===taxi2.taxi.id).id}});
await req("superadmin audit after operations","GET","/api/superadmin/audit",{token:SUPER});

const wsUrl=base.replace(/^http/,"ws")+"/ws";
const ws=new WebSocket(wsUrl);
const connected=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error("ws connect timeout")),5000);ws.addEventListener("message",e=>{clearTimeout(t);resolve(JSON.parse(e.data))},{once:true});ws.addEventListener("error",()=>{clearTimeout(t);reject(new Error("ws error"))},{once:true})});
if(connected.type!=="connected") throw new Error("bad ws connected event");
await req("broadcast trigger","POST","/api/conductor/summon",{token:COND,body:{operatorId:"e2e-operator",routeId:"e2e-route",requestType:"ROUTE_DEMAND",passengerCount:1}});
const event=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error("ws broadcast timeout")),5000);ws.addEventListener("message",e=>{clearTimeout(t);resolve(JSON.parse(e.data))},{once:true})});
if(!event.type) throw new Error("broadcast missing type");
console.log("PASS | websocket realtime | "+event.type);pass++;total++;ws.close();

console.log(`TOTAL: ${total}`);
console.log(`PASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if(fail)process.exit(1);
console.log("ALL PLATFORM E2E SCENARIOS PASSED");
