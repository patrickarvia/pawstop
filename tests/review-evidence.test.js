const {test}=require('node:test');
const assert=require('node:assert/strict');
const {qualifyingReviewTexts,reviewSignals,inferFromReviewConsensus,MAX_REVIEW_LENGTH}=require('../lib/review-evidence');
const now=Date.parse('2026-10-04T12:00:00Z');
const review=(text,extra={})=>({originalText:{text,languageCode:'en'},publishTime:'2026-09-01T12:00:00Z',...extra});
const pair=(text)=>[review(text),review(`${text}. A second visit.`)];
const infer=(reviews)=>inferFromReviewConsensus(reviews,now);
const unknown={value:null,confidence:'unknown'};
for(const phrase of ['dogs allowed','dogs are allowed','dog friendly','dog-friendly','dogs welcome','pets allowed','pets welcome','leashed dogs allowed','dogs permitted']){
  test(`explicit dog permission: ${phrase}`,()=>{
    assert.deepEqual(infer(pair(phrase)).dogsAllowed,{value:true,confidence:'inferred',evidence:'Recent Google Maps reviews consistently indicate that dogs are allowed.'});
  });
}
for(const phrase of ['no dogs','dogs not allowed',"dogs aren't allowed",'dogs are not allowed','dogs prohibited','pets prohibited','no pets','pets not allowed','not dog friendly','not dog-friendly']){
  test(`explicit dog denial: ${phrase}`,()=>{
    assert.deepEqual(infer(pair(phrase)).dogsAllowed,{value:false,confidence:'inferred',evidence:'Recent Google Maps reviews consistently indicate that dogs are not allowed.'});
  });
}
test('single reviews, duplicate bodies/identities, vague mentions, and conflicts cannot establish permission',()=>{
  for(const reviews of [[review('dogs allowed')],[review('no dogs')],[review('dogs allowed'),review('dogs allowed')],pair('saw a dog; brought my dog; people walking dogs'),[...pair('dogs welcome'),review('no dogs')],pair('not very dog friendly'),pair('never dogs allowed')]) assert.deepEqual(infer(reviews).dogsAllowed,unknown);
  assert.deepEqual(infer(pair('dogs allowed').map(r=>({...r,name:'same-review'}))).dogsAllowed,unknown);
  assert.deepEqual(infer(pair('dogs allowed').map(r=>({...r,authorAttribution:{uri:'same-author'}}))).dogsAllowed,unknown);
  assert.deepEqual(infer(pair('dogs allowed. But no dogs on the trail.')).dogsAllowed,unknown);
});
test('eligibility requires bounded English text and a strict recent timestamp',()=>{
  for(const bad of [null,{},[],review(''),review('  '),review('dogs allowed',{originalText:{text:'dogs allowed',languageCode:'fr'}}),review('dogs allowed',{originalText:{text:'dogs allowed'}}),review('dogs allowed',{originalText:{text:5,languageCode:'en'}}),review('dogs allowed',{publishTime:'bad'}),review('dogs allowed',{publishTime:'2026-02-30T12:00:00Z'}),review('dogs allowed',{publishTime:'2023-10-04T11:59:59Z'}),review('dogs allowed',{publishTime:'2026-10-04T12:00:01Z'}),review('dogs allowed',{publishTime:'2026-10-04'}),review('dogs allowed',{publishTime:'2026-10-04T25:00:00Z'}),review('dogs allowed',{originalText:{text:'x'.repeat(MAX_REVIEW_LENGTH+1),languageCode:'en'}}),review('dogs allowed\u0000')]){
    assert.deepEqual(qualifyingReviewTexts([bad],now),[]);
    assert.deepEqual(infer([review('dogs allowed'),bad]).dogsAllowed,unknown);
  }
  assert.equal(qualifyingReviewTexts([review('dogs allowed',{publishTime:'2023-10-04T12:00:00Z',originalText:{text:'dogs allowed',languageCode:'en-US'}})],now).length,1);
  assert.deepEqual(infer([review('unrelated'),review('unrelated 2'),review('unrelated 3'),review('unrelated 4'),review('dogs allowed'),review('dogs welcome')]).dogsAllowed,unknown);
  assert.deepEqual(qualifyingReviewTexts({},now),[]);
  assert.equal(qualifyingReviewTexts(pair('dogs allowed'),NaN).length,0);
});
for(const [key,positive,negative,value] of [
  ['largeGrass','large grassy area','no grass',true],['largeGrass','large grass area','entirely paved',true],['largeGrass','big grassy area','no grassy area',true],['largeGrass','lots of grass','no open field',true],['largeGrass','open grassy field','no grass',true],['largeGrass','large field','no grass',true],['largeGrass','open field','no grass',true],['largeGrass','huge lawn','no grass',true],['largeGrass','large lawn','no grass',true],
  ['fenced','fenced','not fenced',true],['fenced','fully fenced','unfenced',true],['fenced','fenced-in','no fence',true],['fenced','enclosed by fence','open with no fencing',true],['fenced','secure fenced area','not fully fenced',true],
  ['lighting','well lit','poorly lit',true],['lighting','well-lit','not well lit',true],['lighting','good lighting','dark at night',true],['lighting','lighting at night','no lighting',true],['lighting','lights at night','no lights',true],
  ['dogTraffic','few dogs','lots of dogs','low'],['dogTraffic','hardly any dogs','many dogs','low'],['dogTraffic','rarely see dogs','always lots of dogs','low'],['dogTraffic','low dog traffic','busy with dogs','low'],['dogTraffic','not many dogs','crowded with dogs','low'],['dogTraffic','few dogs','high dog traffic','low']
]){
  test(`${key}: consensus for ${positive} / ${negative}`,()=>{
    assert.equal(infer(pair(positive))[key].value,value);assert.equal(infer(pair(positive))[key].confidence,'inferred');
    assert.equal(infer(pair(negative))[key].value,key==='dogTraffic'?'high':false);
    assert.deepEqual(infer([...pair(positive),review(negative)])[key],unknown);
    assert.deepEqual(infer([review(positive)])[key],unknown);
  });
}
test('generic descriptions and negated positives remain unknown',()=>{
  for(const [key,text] of [['largeGrass','grass park lawn'],['largeGrass','not a large grassy area'],['fenced','without a fence'],['lighting','visited at night'],['lighting','not very well lit'],['dogTraffic','quiet crowded busy empty'],['dogTraffic','not lots of dogs']]) assert.deepEqual(infer(pair(text))[key],unknown);
});
for(const phrase of ['dog park','dedicated dog area','off-leash dog area','dog run','fenced dog area']){
  test(`dedicated area inference is positive only: ${phrase}`,()=>{
    assert.equal(infer(pair(phrase)).dedicatedDogArea.value,true);
    assert.deepEqual(infer(pair(`no ${phrase}`)).dedicatedDogArea,unknown);
    assert.deepEqual(infer([...pair(phrase),review(`no ${phrase}`)]).dedicatedDogArea,unknown);
  });
}
test('signals are bounded booleans and never include review fragments',()=>{
  const signals=reviewSignals('dogs allowed. no dogs. not fenced. not many dogs.');
  assert.deepEqual(signals.dogsAllowed,{positive:true,negative:true});
  assert.deepEqual(signals.fenced,{positive:false,negative:true});
  assert.deepEqual(signals.dogTraffic,{positive:true,negative:false});
  const result=infer(pair('dogs allowed. secret-review-fragment'));
  assert.ok(!JSON.stringify(result).includes('secret-review-fragment'));
});

test('questions, hypotheticals and no-longer-positive claims do not create permission',()=>{
  for(const text of ['Are dogs allowed?','I wish dogs allowed here','If dogs allowed I would visit','no longer dog friendly','maybe dog friendly']) assert.deepEqual(infer(pair(text)).dogsAllowed,unknown);
});

test('duplicate known identity cannot hide a conflicting qualifying signal',()=>{
  const entries=[review('dogs allowed',{name:'a'}),review('dogs welcome',{name:'b'}),review('no dogs',{name:'a'})];
  assert.deepEqual(infer(entries).dogsAllowed,unknown);
});
test('36-month calendar cutoff handles leap day deterministically',()=>{
  const leapNow=Date.parse('2024-02-29T12:00:00Z');
  assert.equal(qualifyingReviewTexts([review('dogs allowed',{publishTime:'2021-02-28T12:00:00Z'})],leapNow).length,1);
  assert.equal(qualifyingReviewTexts([review('dogs allowed',{publishTime:'2021-02-28T11:59:59Z'})],leapNow).length,0);
});

test('English original text qualifies regardless of localized text; regional English is accepted',()=>{
  for(const languageCode of ['en','en-US','en-GB']){
    const entries=pair('dogs allowed').map(r=>({...r,originalText:{...r.originalText,languageCode},text:{text:'perros prohibidos',languageCode:'es'}}));
    assert.equal(qualifyingReviewTexts(entries,now).length,2);
    assert.equal(infer(entries).dogsAllowed.value,true);
  }
});
test('localized English translations cannot establish consensus from Spanish originals',()=>{
  const entries=['Se permiten perros.','Los perros son bienvenidos.'].map(text=>review(text,{originalText:{text,languageCode:'es'},text:{text:'Dogs allowed. Large grassy area. Fully fenced.',languageCode:'en'}}));
  assert.deepEqual(qualifyingReviewTexts(entries,now),[]);
  for(const attribute of Object.values(infer(entries))) assert.deepEqual(attribute,unknown);
  assert.deepEqual(infer([review('dogs allowed'),...entries]).dogsAllowed,unknown);
});
test('missing or malformed original text never falls back to localized English',()=>{
  for(const originalText of [undefined,null,{},[],{text:'dogs allowed'}, {text:5,languageCode:'en'}, {text:'',languageCode:'en'}, {text:'dogs allowed',languageCode:'es'}]){
    const entries=[1,2].map(i=>review('ignored',{originalText,text:{text:`dogs allowed. Visit ${i}.`,languageCode:'en'}}));
    assert.deepEqual(qualifyingReviewTexts(entries,now),[]);
    assert.deepEqual(infer(entries).dogsAllowed,unknown);
  }
});
