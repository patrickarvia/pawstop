const { test } = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/plan-route');
const input = () => ({ origin:'Jersey City, NJ',destination:'Nashville, TN',dogName:'Conan',lifeStage:'puppy',breakCadenceMinutes:150,maxDetourMinutes:10,preferences:{largeGrass:true,lowDogTraffic:true,restrooms:true,minimalDetours:true,fencedSpace:false,goodLighting:false,avoidDedicatedReliefAreas:true} });
const route = seconds => ({duration:`${seconds}s`,distanceMeters:1200000,polyline:{encodedPolyline:'encoded-route'}});
async function invoke(body=input(), response={routes:[route(46800)]}, status=200, options={}) {
  const oldFetch=global.fetch, oldKey=process.env.GOOGLE_MAPS_API_KEY;
  let called=false, sent;
  const searches=[];
  if(options.missingKey) delete process.env.GOOGLE_MAPS_API_KEY;
  else process.env.GOOGLE_MAPS_API_KEY='test-only-placeholder';
  global.fetch=async(url,init)=>{
    if(url==='https://places.googleapis.com/v1/places:searchText'){
      searches.push(JSON.parse(init.body));
      if(options.placesReject) throw new Error('private provider diagnostic');
      const status=options.placesStatus||200;
      return {ok:status===200,status,json:async()=>options.placesBody??{places:[]}};
    }
    called=true;sent={url,...init};
    if(options.reject) throw new Error('private provider diagnostic');
    return {ok:status>=200&&status<300,status,json:async()=>{if(options.invalidJson) throw new Error('private provider body');return response}};
  };
  const res={headers:{},setHeader(k,v){this.headers[k]=v},status(s){this.statusCode=s;return this},json(b){this.body=b;return this}};
  try {await handler({method:options.method||'POST',headers:{'content-type':options.contentType||'application/json'},body},res);}
  finally {global.fetch=oldFetch;if(oldKey===undefined) delete process.env.GOOGLE_MAPS_API_KEY;else process.env.GOOGLE_MAPS_API_KEY=oldKey;}
  assert.ok(!JSON.stringify(res.body).includes('test-only-placeholder'));
  assert.ok(!JSON.stringify(res.body).includes('private provider'));
  return {...res,called,sent,searches};
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

test('discovery uses the computed polyline without exposing candidates or diagnostics',async()=>{
  const r=await invoke(input(),{routes:[{...route(46800),polyline:{encodedPolyline:'new-route'}}]},200,
    {placesBody:{places:[{id:'candidate',displayName:{text:'Private candidate'},location:{latitude:40,longitude:-74}}]}});
  assert.equal(r.searches.length,4);
  assert.deepEqual(r.searches.map(s=>s.textQuery),['park','recreation area','picnic area','rest area']);
  assert.ok(r.searches.every(s=>s.searchAlongRouteParameters.polyline.encodedPolyline==='new-route'));
  assert.deepEqual(Object.keys(r.body),['route','breakTargetsMinutes','recommendations']);
  assert.ok(r.body.recommendations.every(r=>r.stop===null));
  assert.ok(!JSON.stringify(r.body).includes('Private candidate'));
});
test('Places failures are sanitized; zero-target routes skip discovery',async()=>{
  for(const options of [{placesStatus:403},{placesReject:true},{placesBody:{places:null}},{placesBody:{error:'private provider diagnostic'}}]){
    const r=await invoke(input(),undefined,200,options);assert.equal(r.statusCode,502);assert.equal(r.body.error.code,'PROVIDER_ERROR');
  }
  const limited=await invoke(input(),undefined,200,{placesStatus:429});assert.equal(limited.statusCode,429);assert.equal(limited.body.error.code,'RATE_LIMITED');
  const short=await invoke(input(),{routes:[route(1200)]},200,{placesStatus:403});
  assert.equal(short.statusCode,200);assert.deepEqual(short.searches,[]);assert.deepEqual(short.body.recommendations,[]);
  const empty=await invoke(input(),undefined,200,{placesBody:{}});assert.equal(empty.statusCode,200);assert.ok(empty.body.recommendations.every(r=>r.stop===null));
});

async function captureDiscoveryLog(environment, run) {
  const oldEnvironment=process.env.VERCEL_ENV, oldLog=console.log;
  const logs=[];
  if(environment===undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV=environment;
  console.log=(...args)=>logs.push(args);
  try { await run(logs); }
  finally {
    console.log=oldLog;
    if(oldEnvironment===undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV=oldEnvironment;
  }
}
test('discovery logs counts-only lines outside production without changing responses',async()=>{
  const options={placesBody:{places:[{id:'private-id',displayName:{text:'Private name'},formattedAddress:'Private address',location:{latitude:40,longitude:-74}},null]}};
  let productionBody;
  await captureDiscoveryLog('production',async logs=>{
    const result=await invoke(input(),undefined,200,options);
    assert.equal(result.statusCode,200);assert.equal(result.searches.length,4);
    assert.deepEqual(logs,[]);productionBody=result.body;
  });
  for(const environment of ['preview','development',undefined]){
    await captureDiscoveryLog(environment,async logs=>{
      const result=await invoke(input(),undefined,200,options);
      assert.deepEqual(result.body,productionBody);
      assert.deepEqual(logs,[['Phase2A discovery: received=8 candidates=1 duplicates=3 rejected=4'], ['Phase2B routing: candidates=1 routed=0 missing=1 inconsistent=0']]);
    });
  }
});
test('zero-target routes and failed discovery emit no discovery log',async()=>{
  await captureDiscoveryLog('preview',async logs=>{
    const short=await invoke(input(),{routes:[route(1200)]});
    assert.equal(short.statusCode,200);assert.deepEqual(short.searches,[]);assert.deepEqual(logs,[]);
    const failed=await invoke(input(),undefined,200,{placesReject:true});
    assert.equal(failed.statusCode,502);assert.deepEqual(logs,[]);
  });
});

test('real baseline feeds routing diagnostics while raw summaries and candidates stay private', async () => {
  const places = ['routed', 'missing', 'inconsistent'].map(id => ({ id, displayName: { text: 'Private name' }, location: { latitude: 40, longitude: -74 } }));
  const options = { placesBody: { places, routingSummaries: [
    { legs: [{ duration: '662.5s' }, { duration: '12000s' }], directionsUri: 'private-provider-url' },
    {}, { legs: [{ duration: '600s' }, { duration: '600s' }] }
  ] } };
  await captureDiscoveryLog('preview', async logs => {
    const result = await invoke(input(), { routes: [route(12000)] }, 200, options);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(logs, [
      ['Phase2A discovery: received=12 candidates=3 duplicates=9 rejected=0'],
      ['Phase2B routing: candidates=3 routed=1 missing=1 inconsistent=1 tripMin=11.0 tripMax=11.0 detourMin=11.0 detourMax=11.0']
    ]);
    assert.deepEqual(Object.keys(result.body), ['route', 'breakTargetsMinutes', 'recommendations']);
    assert.deepEqual(result.body.recommendations, [{ targetMinutes: 150, stop: null }]);
    for (const forbidden of ['routingSummaries', 'legs', 'candidate', 'Private name', 'private-provider-url', 'diagnostics', 'tripMinutes', 'detourMinutes']) assert.ok(!JSON.stringify(result.body).includes(forbidden));
  });
});

test('NODE_ENV production without Vercel environment emits no diagnostics', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await captureDiscoveryLog(undefined, async logs => {
      assert.equal((await invoke()).statusCode, 200);
      assert.deepEqual(logs, []);
    });
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
