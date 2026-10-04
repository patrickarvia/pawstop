const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
// Minimal DOM harness exercises the real event handlers without dependencies or live requests.
function browser(fetch){
  const elements=new Map();
  function element(id){if(!elements.has(id)){const classes=new Set(['route','urgent','planError'].includes(id)?['hidden']:[]);elements.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,dataset:{},setAttribute(){},classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,on){if(on??!classes.has(x))classes.add(x);else classes.delete(x)}}});}return elements.get(id);}
  const chips=['grass','traffic','restrooms','detour','fenced','lighting'].map(pref=>({...element('chip'+pref),dataset:{pref}}));
  chips.slice(0,4).forEach(chip=>chip.classList.add('active'));
  const pills=['15','30','60'].map(window=>({...element('pill'+window),dataset:{window}}));
  const alternatives=['best','fastest','grass','restrooms'].map(alt=>({...element(alt),dataset:{alt}}));
  for(const [id,value] of Object.entries({from:'New York, NY',to:'Boston, MA',dog:'Conan',age:'Puppy',break:'2.5',detour:'10'}))element(id).value=value;
  element('avoidRelief').checked=true;
  let navigation;
  const context=vm.createContext({document:{getElementById:element,querySelectorAll:s=>s==='.chip'?chips:s==='.time-pill'?pills:s==='[data-alt]'?alternatives:[]},window:{open:url=>navigation=url},fetch,AbortSignal,scrollTo(){}});
  vm.runInContext(fs.readFileSync(require.resolve('../app.js'),'utf8'),context);
  return {element,pills,alternatives,chips,read:expression=>vm.runInContext(expression,context),navigation:()=>navigation};
}
test('planner awaits real route, renders gaps only, and urgent demo still works',async()=>{
  let resolve,sent;const pending=new Promise(r=>resolve=r);
  const b=browser(async(url,init)=>{assert.equal(url,'/api/plan-route');sent=JSON.parse(init.body);await pending;return {ok:true,json:async()=>({route:{durationMinutes:310,distanceMeters:350000},breakTargetsMinutes:[150,300],recommendations:[{targetMinutes:150,stop:null},{targetMinutes:300,stop:null}]})}});
  const done=b.element('planBtn').onclick();assert.equal(b.element('planBtn').disabled,true);assert.equal(b.element('route').classList.contains('hidden'),true);
  resolve();await done;
  assert.equal(sent.destination,'Boston, MA');assert.equal(sent.lifeStage,'puppy');
  assert.match(b.element('routeMetrics').textContent,/5h 10m.*217 miles/);
  assert.match(b.element('stops').innerHTML,/PLANNED BREAK 2/);assert.doesNotMatch(b.element('stops').innerHTML,/Hess|Chicago|Navigate|MATCH/);
  b.element('needStop').onclick();assert.equal(b.element('urgent').classList.contains('hidden'),false);assert.match(b.element('urgentTitle').textContent,/Demo/);
  for(const button of [...b.pills,...b.alternatives]){button.onclick();assert.ok(b.element('urgentName').textContent);assert.match(b.element('urgentStatus').textContent,/demo estimate/);}
  b.element('navBtn').onclick();assert.match(b.navigation(),/^https:\/\/www.google.com\/maps\/dir/);
  b.element('urgentBack').onclick();assert.equal(b.element('route').classList.contains('hidden'),false);
  b.element('backBtn').onclick();assert.equal(b.element('planner').classList.contains('hidden'),false);
});
test('short route has no targets; failures are friendly and allow retry',async()=>{
  const b=browser(async()=>({ok:true,json:async()=>({route:{durationMinutes:20,distanceMeters:20000},breakTargetsMinutes:[],recommendations:[]})}));await b.element('planBtn').onclick();assert.match(b.element('stops').innerHTML,/No planned breaks/);
  for(const fetch of [async()=>{throw Error('private detail')},async()=>({ok:false,json:async()=>({error:{code:'INVALID_INPUT',message:'private detail'}})}),async()=>({ok:true,json:async()=>null})]){
    const b=browser(fetch);await b.element('planBtn').onclick();assert.equal(b.element('planBtn').disabled,false);assert.equal(b.element('planner').classList.contains('hidden'),false);assert.ok(b.element('planError').textContent);assert.doesNotMatch(b.element('planError').textContent,/private detail/);
  }
});

test('independent planner demo reads current form without a request and returns to planner',()=>{
  let requests=0;
  const b=browser(async()=>{requests++;throw Error('No provider available')});
  b.element('dog').value='  Luna  ';b.element('age').value='Senior';
  b.element('detour').value='5';b.element('avoidRelief').checked=false;
  b.chips.forEach(chip=>chip.classList.toggle('active',chip.dataset.pref==='fenced'));
  b.element('plannerDemo').onclick();
  assert.equal(requests,0);assert.equal(b.element('planner').classList.contains('hidden'),true);
  assert.equal(b.element('urgent').classList.contains('hidden'),false);
  assert.equal(b.element('route').classList.contains('hidden'),true);
  assert.equal(b.element('urgentTitle').textContent,'Demo stop ahead for Luna');
  assert.deepEqual(JSON.parse(b.read('JSON.stringify({dogName,lifeStage,maxDetour,avoidRelief,preferences})')),
    {dogName:'Luna',lifeStage:'Senior',maxDetour:5,avoidRelief:false,preferences:{grass:false,traffic:false,restrooms:false,detour:false,fenced:true,lighting:false}});
  b.element('urgentBack').onclick();
  assert.equal(b.element('planner').classList.contains('hidden'),false);
  assert.equal(b.element('urgent').classList.contains('hidden'),true);
  assert.equal(b.element('route').classList.contains('hidden'),true);
  assert.equal(requests,0);
});
test('planner demo remains accessible after route failure without retrying the provider',async()=>{
  let requests=0;const b=browser(async()=>{requests++;throw Error('Provider unavailable')});
  await b.element('planBtn').onclick();b.element('plannerDemo').onclick();
  assert.equal(requests,1);assert.equal(b.element('urgent').classList.contains('hidden'),false);
  b.element('urgentBack').onclick();assert.equal(b.element('planner').classList.contains('hidden'),false);
});

test('NO_STOP_CANDIDATES uses the friendly allowlisted message and allows retry', async () => {
  const b = browser(async () => ({ ok: false, json: async () => ({ error: { code: 'NO_STOP_CANDIDATES', message: 'private provider text' } }) }));
  await b.element('planBtn').onclick();
  assert.equal(b.element('planError').textContent, "We couldn't find a suitable Pawstop along this route.");
  assert.equal(b.element('planBtn').disabled, false);
});

function normalizedStop(overrides={}){
  return {id:'real-1',name:'Riverside Meadow',primaryType:'recreation_area',address:'12 River Road',
    route:{tripMinutes:144.4,detourMinutes:6.2,targetMinutes:150,deltaMinutes:-5.6,timingLabel:'Close to planned break'},
    pawstop:{matchScore:82,plannedFitScore:79.5,why:['Reported restrooms available.','Inferred: open grass.']},
    attributes:{restrooms:{value:true,confidence:'confirmed'},parking:{value:true,confidence:'confirmed'},largeGrass:{value:true,confidence:'inferred'},dogsAllowed:{value:null,confidence:'unknown'},fenced:{value:false,confidence:'confirmed'},lighting:{value:true,confidence:'unknown'},dogTraffic:{value:'low',confidence:'inferred'},dedicatedDogArea:{value:null,confidence:'unknown'}},
    navigation:{googleMapsUrl:'https://maps.google.com/?cid=123&mode=driving'},provenance:{provider:'google',placeId:'private-place-id'},...overrides};
}
async function planned(recommendations){
  const b=browser(async()=>({ok:true,json:async()=>({route:{durationMinutes:500,distanceMeters:700000},breakTargetsMinutes:recommendations.map(r=>r.targetMinutes),recommendations})}));
  await b.element('planBtn').onclick();return b;
}
test('normalized recommendation renders identity, product match, real timing, and backend explanations',async()=>{
  const stop=normalizedStop();const before=JSON.stringify(stop);
  const b=await planned([{targetMinutes:150,stop}]);const html=b.element('stops').innerHTML;
  for(const text of ['PLANNED BREAK 1 · 2h 30m','Riverside Meadow','Recreation area','12 River Road','82% MATCH','2h 24m from start','+6 min detour','Close to planned break','Reported restrooms available.','Inferred: open grass.','Restrooms','Parking','Large grass · inferred','Low dog traffic · inferred','Dog access not yet confirmed']) assert.ok(html.includes(text),text);
  assert.ok(html.includes('href="https://maps.google.com/?cid=123&amp;mode=driving" target="_blank" rel="noopener"'));
  assert.doesNotMatch(html,/79\.5|private-place-id|Lighting|No restrooms|dog-friendly|Hess/);
  assert.equal(JSON.stringify(stop),before);
  assert.equal(b.element('routeFrom').textContent,'New York, NY');assert.equal(b.element('routeTo').textContent,'Boston, MA');
  assert.equal(b.element('dogName').textContent,'Conan');assert.equal(b.element('profile').textContent,'Puppy');
  assert.equal(b.element('breakPlan').textContent,'Every 2h 30m');assert.equal(b.element('maxDetour').textContent,'10 min');
});
test('optional fields and null navigation are omitted safely; zero detour and confirmed dog access are explicit',async()=>{
  const stop=normalizedStop({primaryType:null,address:null,navigation:null});
  stop.route.detourMinutes=.2;stop.attributes.dogsAllowed={value:true,confidence:'confirmed'};
  const html=(await planned([{targetMinutes:150,stop}])).element('stops').innerHTML;
  assert.match(html,/No estimated route detour/);assert.match(html,/Navigation link unavailable/);
  assert.match(html,/Dogs allowed/);assert.match(html,/Dog access confirmed/);
  assert.doesNotMatch(html,/href=|Recreation area|12 River Road/);
});
test('inferred dog permission stays labeled and partial coverage preserves API itinerary order',async()=>{
  const first=normalizedStop();first.attributes.dogsAllowed={value:true,confidence:'inferred'};
  const last=normalizedStop({id:'real-2',name:'Later Park'});last.route={tripMinutes:460,detourMinutes:14,targetMinutes:450,deltaMinutes:10,timingLabel:'Returned timing label'};
  const html=(await planned([{targetMinutes:150,stop:first},{targetMinutes:300,stop:null},{targetMinutes:450,stop:last}])).element('stops').innerHTML;
  assert.match(html,/Dogs allowed · inferred/);assert.match(html,/Dog access inferred · not yet confirmed/);
  assert.match(html,/PLANNED BREAK 2 · 5h 0m/);assert.match(html,/No suitable PawStop found/);
  assert.match(html,/current evidence and planning threshold/);assert.match(html,/Returned timing label/);
  assert.match(html,/\+14 min detour/);assert.ok(html.indexOf('Riverside Meadow')<html.indexOf('No suitable PawStop'));assert.ok(html.indexOf('No suitable PawStop')<html.indexOf('Later Park'));
  assert.doesNotMatch(html,/provider failure|Stop location not yet available/);
});
test('public strings are escaped instead of interpreted as markup',async()=>{
  const stop=normalizedStop({name:'<img onerror="bad">',address:'A & B'});stop.pawstop.why=['<script>bad</script>'];
  const html=(await planned([{targetMinutes:150,stop}])).element('stops').innerHTML;
  assert.match(html,/&lt;img/);assert.match(html,/A &amp; B/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<img|<script/);
});
test('route preferences are passed through unchanged and all normalized errors remain sanitized',async()=>{
  let request;const b=browser(async(_,init)=>{request=JSON.parse(init.body);return {ok:true,json:async()=>({route:{durationMinutes:20,distanceMeters:20000},breakTargetsMinutes:[],recommendations:[]})}});
  b.chips[0].onclick();b.element('detour').value='4';b.element('avoidRelief').checked=false;
  await b.element('planBtn').onclick();assert.equal(request.preferences.largeGrass,false);assert.equal(request.preferences.restrooms,true);assert.equal(request.preferences.avoidDedicatedReliefAreas,false);assert.equal(request.maxDetourMinutes,4);
  for(const code of ['INVALID_INPUT','NO_STOP_CANDIDATES','ROUTE_NOT_FOUND','PROVIDER_ERROR','RATE_LIMITED']){
    const e=browser(async()=>({ok:false,json:async()=>({error:{code,message:'secret'}})}));await e.element('planBtn').onclick();
    assert.equal(e.element('planError').textContent,e.read(`routeErrors.${code}`));assert.equal(e.element('planBtn').disabled,false);assert.equal(e.element('planStatus').textContent,'');
  }
});
test('missing recommendation contract is a sanitized error, never reconstructed stops',async()=>{
  const b=browser(async()=>({ok:true,json:async()=>({route:{durationMinutes:200,distanceMeters:20000},breakTargetsMinutes:[150]})}));await b.element('planBtn').onclick();
  assert.equal(b.element('planError').textContent,b.read('routeErrors.PROVIDER_ERROR'));assert.equal(b.element('route').classList.contains('hidden'),true);
});

test('route intro describes real ranking and preserves the dynamic dog name',()=>{
  const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
  assert.match(html,/Break targets planned for <strong id="dogName"><\/strong> around your selected cadence\. PawStop ranks route-aware stops using timing, detour, and available place evidence\./);
  assert.doesNotMatch(html,/Stop locations are coming next/);
});
test('urgent demo CTA follows recommendations in normal flow without sticky positioning',()=>{
  const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
  const css=fs.readFileSync(require.resolve('../style.css'),'utf8');
  assert.ok(html.indexOf('id="stops"')<html.indexOf('id="needStop"'));
  assert.match(html,/<button id="needStop" class="need">/);
  const rules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(match=>match[1].split(',').some(selector=>selector.trim()==='.need'));
  assert.ok(rules.some(rule=>/position:static/.test(rule[2])));
  assert.ok(rules.every(rule=>!/position:\s*(sticky|fixed)|\bbottom:/.test(rule[2])));
  assert.doesNotMatch(css,/#route #stops\{padding-bottom:calc\(80px/);
});
test('backend dog-access caveats remain intact without a duplicate dedicated disclosure',async()=>{
  for(const caveat of ['Dog access is not confirmed.','Dog access not yet confirmed.','Dog permission is unknown.','Dogs allowed: unconfirmed.','Dog access is inferred, not confirmed.']){
    const stop=normalizedStop();stop.pawstop.why=[caveat,'Reported restrooms available.'];
    const html=(await planned([{targetMinutes:150,stop}])).element('stops').innerHTML;
    assert.ok(html.includes(caveat));assert.doesNotMatch(html,/class="dog-access"/);
  }
  const stop=normalizedStop();stop.pawstop.why=['Restroom access is not confirmed.'];
  const html=(await planned([{targetMinutes:150,stop}])).element('stops').innerHTML;
  assert.match(html,/class="dog-access">Dog access not yet confirmed/);
});
test('hyphenated and underscored normalized place types display as spaces without mutation',async()=>{
  for(const [primaryType,label] of [['rest-area','Rest area'],['recreation_area','Recreation area']]){
    const stop=normalizedStop({primaryType});
    const html=(await planned([{targetMinutes:150,stop}])).element('stops').innerHTML;
    assert.ok(html.includes(`<span class="type-badge">${label}</span>`));assert.equal(stop.primaryType,primaryType);
  }
});

test('real cards display only normalized evidence-strength badges alongside match',async()=>{
  for(const [evidenceStrength,label] of [['strong','STRONG EVIDENCE'],['moderate','MODERATE EVIDENCE'],['limited','LIMITED EVIDENCE'],['very_limited','VERY LIMITED EVIDENCE'],[null,null]]){
    const stop=normalizedStop();stop.pawstop={...stop.pawstop,evidenceStrength,evidenceCoverage:40,why:['Dog access is not confirmed.']};
    const html=(await planned([{targetMinutes:150,stop}])).element('stops').innerHTML;
    assert.match(html,/82% MATCH/);
    if(label)assert.ok(html.includes(`<span class="evidence-badge">${label}</span>`));else assert.doesNotMatch(html,/class="evidence-badge"/);
    assert.ok(html.includes('Dog access is not confirmed.'));assert.doesNotMatch(html,/class="dog-access"|40%|confidence percentage|safety confidence/);
  }
});

test('place website is a quiet separate returned verification link without a policy claim',async()=>{
  const stop=normalizedStop({verification:{placeWebsiteUrl:'https://example.org/park?a=1&b=2'}});
  const html=(await planned([{targetMinutes:150,stop}])).element('stops').innerHTML;
  assert.ok(html.includes('href="https://example.org/park?a=1&amp;b=2" target="_blank" rel="noopener">Place website ↗'));
  assert.match(html,/Dog access not yet confirmed/);assert.doesNotMatch(html,/Official policy/);
  const missing=(await planned([{targetMinutes:150,stop:normalizedStop({verification:null})}])).element('stops').innerHTML;
  assert.doesNotMatch(missing,/Place website/);
});
