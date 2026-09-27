const { test } = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/plan-route');
const input = () => ({ origin:'Jersey City, NJ',destination:'Nashville, TN',dogName:'Conan',lifeStage:'puppy',breakCadenceMinutes:150,maxDetourMinutes:10,preferences:{largeGrass:true,lowDogTraffic:true,restrooms:true,minimalDetours:true,fencedSpace:false,goodLighting:false,avoidDedicatedReliefAreas:true} });
const route = seconds => ({duration:`${seconds}s`,distanceMeters:1200000,polyline:{encodedPolyline:'encoded-route'}});
const selectable = seconds => ({ placesBody: {
  places: [{ id: 'real-stop', displayName: { text: 'Real stop' }, location: { latitude: 40, longitude: -74 } }],
  routingSummaries: [{ legs: [{ duration: '9000s' }, { duration: `${seconds - 9000 + 300}s` }] }]
} });
async function invoke(body=input(), response={routes:[route(46800)]}, status=200, options={}) {
  const oldFetch=global.fetch, oldKey=process.env.GOOGLE_MAPS_API_KEY;
  let called=false, sent;
  const searches=[], details=[];
  if(options.missingKey) delete process.env.GOOGLE_MAPS_API_KEY;
  else process.env.GOOGLE_MAPS_API_KEY='test-only-placeholder';
  global.fetch=async(url,init)=>{
    if(url==='https://places.googleapis.com/v1/places:searchText'){
      searches.push(JSON.parse(init.body));
      if(options.placesReject) throw new Error('private provider diagnostic');
      const status=options.placesStatus||200;
      return {ok:status===200,status,json:async()=>options.placesBody??{places:[]}};
    }
    if(url.startsWith('https://places.googleapis.com/v1/places/')){
      details.push({url,...init});
      assert.equal(init.signal,sent.signal);
      if(options.detailsReject) throw new Error('private provider diagnostic');
      const detailStatus=options.detailsStatus||200;
      return {ok:detailStatus===200,status:detailStatus,json:async()=>options.detailsBody??{id:decodeURIComponent(url.split('/').at(-1))}};
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
  return {...res,called,sent,searches,details};
}
test('normalizes route and targets with real selection and partial gaps; sends only route inputs',async()=>{
  const r=await invoke(input(),undefined,200,selectable(46800));assert.equal(r.statusCode,200);
  assert.deepEqual(r.body.breakTargetsMinutes,[150,300,450,600,750]);
  assert.equal(r.body.recommendations[0].stop.name,'Real stop');
  assert.deepEqual(r.body.recommendations.slice(1),r.body.breakTargetsMinutes.slice(1).map(targetMinutes=>({targetMinutes,stop:null})));
  assert.deepEqual(r.body.recommendations.map(r=>r.targetMinutes),r.body.breakTargetsMinutes);
  assert.deepEqual(r.body.route,{durationMinutes:780,distanceMeters:1200000,encodedPolyline:'encoded-route',provider:'google',trafficAware:false});
  assert.deepEqual(JSON.parse(r.sent.body),{origin:{address:'Jersey City, NJ'},destination:{address:'Nashville, TN'},travelMode:'DRIVE',routingPreference:'TRAFFIC_UNAWARE'});
  assert.equal(r.sent.headers['X-Goog-FieldMask'],'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline');
});
test('short route, exact arrival boundary, fractional duration and first valid route',async()=>{
  for(const seconds of [1200,9000]){const r=await invoke(input(),{routes:[route(seconds)]});assert.deepEqual(r.body.breakTargetsMinutes,[]);assert.deepEqual(r.body.recommendations,[]);}
  const r=await invoke(input(),{routes:[null,route(18000.5)]},200,selectable(18000.5));assert.deepEqual(r.body.breakTargetsMinutes,[150,300]);
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
  assert.equal(r.statusCode,422);assert.equal(r.body.error.code,'NO_STOP_CANDIDATES');
  assert.ok(!JSON.stringify(r.body).includes('Private candidate'));
});
test('Places failures are sanitized; zero-target routes skip discovery',async()=>{
  for(const options of [{placesStatus:403},{placesReject:true},{placesBody:{places:null}},{placesBody:{error:'private provider diagnostic'}}]){
    const r=await invoke(input(),undefined,200,options);assert.equal(r.statusCode,502);assert.equal(r.body.error.code,'PROVIDER_ERROR');
  }
  const limited=await invoke(input(),undefined,200,{placesStatus:429});assert.equal(limited.statusCode,429);assert.equal(limited.body.error.code,'RATE_LIMITED');
  const short=await invoke(input(),{routes:[route(1200)]},200,{placesStatus:403});
  assert.equal(short.statusCode,200);assert.deepEqual(short.searches,[]);assert.deepEqual(short.details,[]);assert.deepEqual(short.body.recommendations,[]);
  const empty=await invoke(input(),undefined,200,{placesBody:{}});assert.equal(empty.statusCode,422);assert.equal(empty.body.error.code,'NO_STOP_CANDIDATES');
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
    assert.equal(result.statusCode,422);assert.equal(result.searches.length,4);
    assert.deepEqual(logs,[]);productionBody=result.body;
  });
  for(const environment of ['preview','development',undefined]){
    await captureDiscoveryLog(environment,async logs=>{
      const result=await invoke(input(),undefined,200,options);
      assert.deepEqual(result.body,productionBody);
      assert.deepEqual(logs,[['Phase2A discovery: received=8 candidates=1 duplicates=3 rejected=4'], ['Phase2B routing: candidates=1 routed=0 missing=1 inconsistent=0'], ['Phase2C matching: targets=5 routed=0 pairs=0 coveredTargets=0 gaps=5 overDetour=0 close=0 early=0 late=0'], ['Phase2D enrichment: selected=0 requested=0 enriched=0 unchanged=0 dogsKnown=0 restroomsKnown=0 parkingKnown=0 dedicatedKnown=0 navKnown=0'], ['Phase2E selection: targets=5 scored=0 eligible=0 dogExcluded=0 selected=0 gaps=5 reusedSkipped=0 chronologySkipped=0 overDetourSelected=0 unknownDogAccessSelected=0']]);
    });
  }
});
test('zero-target routes and failed discovery emit no discovery log',async()=>{
  await captureDiscoveryLog('preview',async logs=>{
    const short=await invoke(input(),{routes:[route(1200)]});
    assert.equal(short.statusCode,200);assert.deepEqual(short.searches,[]);assert.deepEqual(short.details,[]);assert.deepEqual(logs,[]);
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
    assert.equal(result.statusCode, 422);
    assert.deepEqual(logs, [
      ['Phase2A discovery: received=12 candidates=3 duplicates=9 rejected=0'],
      ['Phase2B routing: candidates=3 routed=1 missing=1 inconsistent=1 tripMin=11.0 tripMax=11.0 detourMin=11.0 detourMax=11.0'],
      ['Phase2C matching: targets=1 routed=1 pairs=0 coveredTargets=0 gaps=1 overDetour=0 close=0 early=0 late=0'],
      ['Phase2D enrichment: selected=0 requested=0 enriched=0 unchanged=0 dogsKnown=0 restroomsKnown=0 parkingKnown=0 dedicatedKnown=0 navKnown=0'],
      ['Phase2E selection: targets=1 scored=0 eligible=0 dogExcluded=0 selected=0 gaps=1 reusedSkipped=0 chronologySkipped=0 overDetourSelected=0 unknownDogAccessSelected=0']
    ]);
    assert.deepEqual(result.body, { error: { code: 'NO_STOP_CANDIDATES', message: "We couldn't find a suitable Pawstop along this route." } });
    for (const forbidden of ['routingSummaries', 'legs', 'candidate', 'Private name', 'private-provider-url', 'diagnostics', 'tripMinutes', 'detourMinutes']) assert.ok(!JSON.stringify(result.body).includes(forbidden));
  });
});

test('NODE_ENV production without Vercel environment emits no diagnostics', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await captureDiscoveryLog(undefined, async logs => {
      assert.equal((await invoke()).statusCode, 422);
      assert.deepEqual(logs, []);
    });
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('Phase 2C uses real routed candidates and user cadence/max detour, with private pools and counts-only logs', async () => {
  const specs = [
    ['close', 100, 5], ['early', 80, 12], ['late', 120, 11],
    ['shared', 150, 12], ['outside', 299, 5]
  ];
  const options = { placesBody: {
    places: specs.map(([id]) => ({ id, displayName: { text: 'Private candidate name' }, formattedAddress: 'Private address', location: { latitude: 40, longitude: -74 } })),
    routingSummaries: specs.map(([, trip, detour]) => ({ legs: [{ duration: `${trip * 60}s` }, { duration: `${(300 + detour - trip) * 60}s` }] }))
  } };
  for (const environment of ['preview', 'development', 'production']) {
    for (const minimalDetours of [true, false]) {
      await captureDiscoveryLog(environment, async logs => {
        const body = input(); body.breakCadenceMinutes = 100;
        body.preferences.minimalDetours = minimalDetours;
        const result = await invoke(body, { routes: [route(18000)] }, 200, options);
        assert.equal(result.statusCode, 200); assert.equal(result.searches.length, 4);
        assert.deepEqual(Object.keys(result.body), ['route','breakTargetsMinutes','recommendations']);
        assert.deepEqual(result.body.breakTargetsMinutes, [100,200]);
        assert.deepEqual(result.body.recommendations.map(r => r.stop.route.tripMinutes), [100,150]);
        const matchingLogs = logs.filter(([line]) => line.startsWith('Phase2C'));
        assert.deepEqual(matchingLogs, environment === 'production' ? [] : [
          ['Phase2C matching: targets=2 routed=5 pairs=5 coveredTargets=2 gaps=0 overDetour=4 close=1 early=2 late=2']
        ]);
        if (environment === 'production') assert.deepEqual(logs, []);
        for (const forbidden of ['pools', 'timingPenalty', 'maxDetourPenalty', 'diagnostics', 'routingSummaries', 'legs']) assert.ok(!JSON.stringify(result.body).includes(forbidden));
      });
    }
  }
  await captureDiscoveryLog('preview', async logs => {
    const body = input(); body.breakCadenceMinutes = 100; body.maxDetourMinutes = 12;
    await invoke(body, { routes: [route(18000)] }, 200, options);
    assert.equal(logs.find(([line])=>line.startsWith('Phase2C'))[0], 'Phase2C matching: targets=2 routed=5 pairs=5 coveredTargets=2 gaps=0 overDetour=0 close=1 early=2 late=2');
  });
});

const enrichmentOptions = () => ({ placesBody: {
  places: [{ id: 'private-place-id', displayName: { text: 'Private dog area' }, primaryType: 'dog_park', location: { latitude: 40, longitude: -74 } }],
  routingSummaries: [{ legs: [{ duration: '9000s' }, { duration: '3300s' }] }]
}, detailsBody: { id: 'private-place-id', allowsDogs: false, restroom: true, parkingOptions: { freeParkingLot: true }, googleMapsUri: 'https://maps.google.com/?cid=123', extraPrivate: 'private provider body' } });

test('Phase 2D diagnostics stay counts only and known dog denial never reaches recommendations', async () => {
  let expected;
  for (const environment of ['preview', 'development', 'production']) {
    await captureDiscoveryLog(environment, async logs => {
      const result = await invoke(input(), { routes: [route(12000)] }, 200, enrichmentOptions());
      assert.equal(result.statusCode, 422); assert.equal(result.details.length, 1);
      assert.equal(result.body.error.code, 'NO_STOP_CANDIDATES');
      if (expected) assert.deepEqual(result.body, expected); else expected = result.body;
      assert.deepEqual(logs.filter(([line]) => line.startsWith('Phase2D')), environment === 'production' ? [] : [
        ['Phase2D enrichment: selected=1 requested=1 enriched=1 unchanged=0 dogsKnown=1 restroomsKnown=1 parkingKnown=1 dedicatedKnown=1 navKnown=1']
      ]);
      if (environment === 'production') assert.deepEqual(logs, []);
      for (const forbidden of ['private-place-id', 'Private dog area', 'attributes', 'googleMaps', 'navigation', 'diagnostics', 'candidate', 'extraPrivate', 'test-only-placeholder']) assert.ok(!JSON.stringify(result.body).includes(forbidden));
      for (const forbidden of ['private-place-id', 'Private dog area', 'googleMaps', '123', 'test-only-placeholder', 'Jersey City', 'Nashville', '150']) assert.ok(!JSON.stringify(logs.filter(([line]) => line.startsWith('Phase2D'))).includes(forbidden));
    });
  }
});

test('Phase 2D unavailable details retain unknown evidence while infrastructure failures stay sanitized', async () => {
  await captureDiscoveryLog('preview', async logs => {
    for (const detailsStatus of [404, 410]) {
      const result = await invoke(input(), { routes: [route(12000)] }, 200, { ...enrichmentOptions(), detailsStatus });
      assert.equal(result.statusCode, 200); assert.equal(result.body.recommendations[0].stop.attributes.dogsAllowed.confidence, 'unknown');
      assert.equal(logs.filter(([line])=>line.startsWith('Phase2D')).at(-1)[0], 'Phase2D enrichment: selected=1 requested=1 enriched=0 unchanged=1 dogsKnown=0 restroomsKnown=0 parkingKnown=0 dedicatedKnown=1 navKnown=0');
    }
    for (const [options, status, code] of [[{ detailsStatus: 429 }, 429, 'RATE_LIMITED'], [{ detailsStatus: 403 }, 502, 'PROVIDER_ERROR'], [{ detailsStatus: 503 }, 502, 'PROVIDER_ERROR'], [{ detailsReject: true }, 502, 'PROVIDER_ERROR']]) {
      logs.length = 0;
      const result = await invoke(input(), { routes: [route(12000)] }, 200, { ...enrichmentOptions(), ...options });
      assert.equal(result.statusCode, status); assert.equal(result.body.error.code, code);
      assert.deepEqual(logs, []);
    }
  });
});

test('Phase 2E exposes normalized enriched stops, partial coverage and counts-only selection diagnostics', async () => {
  for (const environment of ['preview', 'development', 'production']) {
    await captureDiscoveryLog(environment, async logs => {
      const options = enrichmentOptions(); options.detailsBody.allowsDogs = true;
      options.placesBody.routingSummaries[0].legs[1].duration = '9600s';
      const result = await invoke(input(), { routes: [route(18000)] }, 200, options);
      assert.equal(result.statusCode, 200);
      assert.deepEqual(result.body.breakTargetsMinutes, [150]);
      const stop = result.body.recommendations[0].stop;
      assert.equal(stop.name, 'Private dog area');
      assert.equal(stop.attributes.dogsAllowed.value, true); assert.equal(stop.attributes.restrooms.value, true);
      assert.deepEqual(stop.navigation, { googleMapsUrl: 'https://maps.google.com/?cid=123' });
      assert.equal(stop.provenance.placeId, 'private-place-id');
      assert.equal(stop.route.targetMinutes, 150); assert.equal(stop.route.deltaMinutes, 0);
      assert.equal(stop.pawstop.matchScore, 47); assert.equal(stop.pawstop.plannedFitScore, 47);
      assert.ok(stop.pawstop.why.includes('Google Places reports that dogs are allowed.'));
      for (const forbidden of ['allowsDogs','parkingOptions','googleMapsUri','routingSummaries','timingPenalty','maxDetourPenalty','extraPrivate','earned','possible','diagnostics','pools']) assert.ok(!JSON.stringify(result.body).includes(forbidden));
      assert.deepEqual(logs.filter(([line])=>line.startsWith('Phase2E')), environment === 'production' ? [] : [
        ['Phase2E selection: targets=1 scored=1 eligible=1 dogExcluded=0 selected=1 gaps=0 reusedSkipped=0 chronologySkipped=0 overDetourSelected=0 unknownDogAccessSelected=0']
      ]);
      if (environment === 'production') assert.deepEqual(logs, []);
    });
  }
});
