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
