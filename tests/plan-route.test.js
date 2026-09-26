const { test } = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/plan-route');
const input = () => ({ origin:'Jersey City, NJ',destination:'Nashville, TN',dogName:'Conan',lifeStage:'puppy',breakCadenceMinutes:150,maxDetourMinutes:10,preferences:{largeGrass:true,lowDogTraffic:true,restrooms:true,minimalDetours:true,fencedSpace:false,goodLighting:false,avoidDedicatedReliefAreas:true} });
const route = seconds => ({duration:`${seconds}s`,distanceMeters:1200000,polyline:{encodedPolyline:'encoded-route'}});
async function invoke(body=input(), response={routes:[route(46800)]}, status=200, options={}) {
  const oldFetch=global.fetch, oldKey=process.env.GOOGLE_MAPS_API_KEY;
  let called=false, sent;
  if(options.missingKey) delete process.env.GOOGLE_MAPS_API_KEY;
  else process.env.GOOGLE_MAPS_API_KEY='test-only-placeholder';
  global.fetch=async(url,init)=>{
    called=true;sent={url,...init};
    if(options.reject) throw new Error('private provider diagnostic');
    return {ok:status>=200&&status<300,status,json:async()=>{if(options.invalidJson) throw new Error('private provider body');return response}};
  };
  const res={headers:{},setHeader(k,v){this.headers[k]=v},status(s){this.statusCode=s;return this},json(b){this.body=b;return this}};
  try {await handler({method:options.method||'POST',headers:{'content-type':options.contentType||'application/json'},body},res);}
  finally {global.fetch=oldFetch;if(oldKey===undefined) delete process.env.GOOGLE_MAPS_API_KEY;else process.env.GOOGLE_MAPS_API_KEY=oldKey;}
  assert.ok(!JSON.stringify(res.body).includes('test-only-placeholder'));
  assert.ok(!JSON.stringify(res.body).includes('private provider'));
  return {...res,called,sent};
}
test('normalizes route, targets and Phase 1 gaps; sends only route inputs',async()=>{
  const r=await invoke();assert.equal(r.statusCode,200);
  assert.deepEqual(r.body.breakTargetsMinutes,[150,300,450,600,750]);
  assert.deepEqual(r.body.recommendations,r.body.breakTargetsMinutes.map(targetMinutes=>({targetMinutes,stop:null})));
  assert.deepEqual(r.body.route,{durationMinutes:780,distanceMeters:1200000,encodedPolyline:'encoded-route',provider:'google',trafficAware:false});
  assert.deepEqual(JSON.parse(r.sent.body),{origin:{address:'Jersey City, NJ'},destination:{address:'Nashville, TN'},travelMode:'DRIVE',routingPreference:'TRAFFIC_UNAWARE'});
  assert.equal(r.sent.headers['X-Goog-FieldMask'],'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline');
});
test('short route, exact arrival boundary, fractional duration and first valid route',async()=>{
  for(const seconds of [1200,9000]){const r=await invoke(input(),{routes:[route(seconds)]});assert.deepEqual(r.body.breakTargetsMinutes,[]);assert.deepEqual(r.body.recommendations,[]);}
  const r=await invoke(input(),{routes:[null,route(18000.5)]});assert.deepEqual(r.body.breakTargetsMinutes,[150,300]);
});
test('validates every required field before calling provider',async()=>{
  for(const key of Object.keys(input())){const b=input();delete b[key];const r=await invoke(b);assert.equal(r.body.error.code,'INVALID_INPUT');assert.equal(r.called,false);}
  for(const key of Object.keys(input().preferences)){const b=input();delete b.preferences[key];assert.equal((await invoke(b)).body.error.code,'INVALID_INPUT');}
  for(const b of [null,[], '{broken', {...input(),origin:' '},{...input(),lifeStage:'Puppy'},{...input(),breakCadenceMinutes:0},{...input(),breakCadenceMinutes:Infinity},{...input(),breakCadenceMinutes:'150'},{...input(),maxDetourMinutes:-1},{...input(),dogName:1},{...input(),preferences:{...input().preferences,largeGrass:'true'}}]) assert.equal((await invoke(b)).body.error.code,'INVALID_INPUT');
  assert.equal((await invoke(input(),{},200,{contentType:'text/plain'})).statusCode,400);
  const r=await invoke(input(),{},200,{method:'GET'});assert.equal(r.statusCode,405);assert.equal(r.headers.Allow,'POST');
});
test('sanitizes missing credentials, provider failures, invalid JSON and unusable routes',async()=>{
  for(const options of [{missingKey:true},{reject:true},{invalidJson:true}]) assert.equal((await invoke(input(),{},200,options)).body.error.code,'PROVIDER_ERROR');
  for(const response of [null,{error:{message:'private provider diagnostic'}},{routes:null},{routes:[{}]},{routes:[route(-1)]},{routes:[{...route(600),distanceMeters:null}]},{unexpected:true}]) assert.equal((await invoke(input(),response)).body.error.code,'PROVIDER_ERROR');
  for(const status of [400,403,500]) assert.equal((await invoke(input(),{error:'private provider diagnostic'},status)).body.error.code,'PROVIDER_ERROR');
  assert.equal((await invoke(input(),{},429)).body.error.code,'RATE_LIMITED');
  for(const response of [{},{routes:[]}]) assert.equal((await invoke(input(),response)).body.error.code,'ROUTE_NOT_FOUND');
});
