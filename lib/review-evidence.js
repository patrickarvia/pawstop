// Supplemental review evidence is transient and never projected or logged.
const MAX_REVIEWS = 5;
const MAX_REVIEW_LENGTH = 5000;
const UNKNOWN = () => ({ value: null, confidence: 'unknown' });
const RULES = {
  dogsAllowed: {
    positive: [/\b(?:dogs?|pets?) (?:are )?(?:allowed|welcome|permitted)\b/g, /\bdog[ -]friendly\b/g],
    negative: [/\bno (?:dogs?|pets?)\b/g, /\b(?:dogs?|pets?) (?:(?:are )?(?:not allowed|not permitted|not welcome|prohibited)|aren't allowed)\b/g, /\b(?:not|never) dog[ -]friendly\b/g],
    yes: 'Recent Google Maps reviews consistently indicate that dogs are allowed.',
    no: 'Recent Google Maps reviews consistently indicate that dogs are not allowed.'
  },
  largeGrass: {
    positive: [/\b(?:large|big) grass(?:y)? area\b/g, /\blots of grass\b/g, /\b(?:open grassy|large|open) field\b/g, /\b(?:huge|large) lawn\b/g],
    negative: [/\bno grass(?:y area)?\b/g, /\bentirely paved\b/g, /\bno open field\b/g],
    yes: 'Recent Google Maps reviews consistently describe substantial grassy or open-field space.',
    no: 'Recent Google Maps reviews consistently describe a lack of grassy or open-field space.'
  },
  fenced: {
    positive: [/\b(?:fully |secure )?fenced(?:[ -]in)?(?: area)?\b/g, /\benclosed by (?:a )?fence\b/g],
    negative: [/\b(?:not (?:fully )?fenced|no fenc(?:e|ing)|unfenced)\b/g],
    yes: 'Recent Google Maps reviews consistently describe fencing.',
    no: 'Recent Google Maps reviews consistently indicate that the area is not fenced.'
  },
  lighting: {
    positive: [/\bwell[ -]lit\b/g, /\bgood lighting\b/g, /\b(?:lighting|lights) at night\b/g],
    negative: [/\b(?:poorly[ -]lit|not well[ -]lit|dark at night|no lighting|no lights)\b/g],
    yes: 'Recent Google Maps reviews consistently describe lighting.',
    no: 'Recent Google Maps reviews consistently describe insufficient lighting.'
  },
  dogTraffic: {
    positive: [/\b(?:few dogs|hardly any dogs|rarely see dogs|low dog traffic|not many dogs)\b/g],
    negative: [/\b(?:lots of dogs|many dogs|busy with dogs|crowded with dogs|high dog traffic)\b/g],
    yes: 'Recent Google Maps reviews consistently describe low dog traffic.',
    no: 'Recent Google Maps reviews consistently describe high dog traffic.'
  },
  dedicatedDogArea: {
    positive: [/\b(?:dog park|dedicated dog area|off[ -]leash dog area|dog run|fenced dog area)\b/g],
    negative: [/\b(?:no|not a|not an) (?:dog park|dedicated dog area|off[ -]leash dog area|dog run|fenced dog area)\b/g],
    yes: 'Recent Google Maps reviews consistently describe a dedicated dog area.'
  }
};

function publishMillis(value) {
  if (typeof value !== 'string' || value.length > 40) return NaN;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) return NaN;
  const [,year,month,day,hour,minute,second,zone] = parts;
  if (+year < 1970 || +month < 1 || +month > 12 || +day < 1
    || +day > new Date(Date.UTC(+year, +month, 0)).getUTCDate()
    || +hour > 23 || +minute > 59 || +second > 59
    || (zone !== 'Z' && (+zone.slice(1,3) > 23 || +zone.slice(4) > 59))) return NaN;
  return Date.parse(value);
}
function recencyCutoff(now) {
  const cutoff = new Date(now);
  const day = cutoff.getUTCDate();
  cutoff.setUTCDate(1);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 3);
  cutoff.setUTCDate(Math.min(day, new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)).getUTCDate()));
  return cutoff.getTime();
}
function qualifyingReviewTexts(reviews, now = Date.now()) {
  if (!Array.isArray(reviews) || !Number.isFinite(now)) return [];
  const texts = [], seenText = new Set(), seenIdentity = new Map();
  const cutoff = recencyCutoff(now);
  for (const review of reviews.slice(0, MAX_REVIEWS)) {
    const text = review?.text?.text;
    const language = review?.text?.languageCode;
    if (typeof text !== 'string' || text.length > MAX_REVIEW_LENGTH || !text.trim()
      || typeof language !== 'string' || !/^en(?:-[a-z]{2})?$/i.test(language)
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) continue;
    const published = publishMillis(review.publishTime);
    if (!Number.isFinite(published) || published < cutoff || published > now) continue;
    const normalized = text.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();
    // Duplicate review bodies or known reviewer/review identities cannot form consensus.
    const identities = [review.name, review.authorAttribution?.uri].filter(value => typeof value === 'string' && value.length > 0 && value.length <= 2048);
    if (seenText.has(normalized)) continue;
    seenText.add(normalized);
    const prior = identities.find(identity => seenIdentity.has(identity));
    if (prior) {
      // Repeated identity cannot vote twice, but its conflicting text still vetoes consensus.
      const index = seenIdentity.get(prior);
      texts[index] += `. ${normalized}`;
      identities.forEach(identity => seenIdentity.set(identity, index));
    } else {
      identities.forEach(identity => seenIdentity.set(identity, texts.length));
      texts.push(normalized);
    }
  }
  return texts;
}
function matches(text, patterns) {
  return patterns.flatMap(pattern => [...text.matchAll(new RegExp(pattern.source, 'g'))]);
}
function unnegated(text, match) {
  const prefix = text.slice(Math.max(0, match.index - 50), match.index);
  // Suppress negated positive wording rather than accidentally crediting its substring.
  const clause = text.slice(text.lastIndexOf('.', match.index - 1) + 1).split(/[.!]/)[0];
  if (clause.includes('?') || /\b(?:if|whether|wish|hope|perhaps|maybe|might|could|would)\b/.test(prefix)) return false;
  return !/\b(?:not|no|no longer|never|without|isn't|aren't|wasn't|weren't|is not|are not|was not|were not)\s+(?:(?:a|an|any|very|really|particularly|fully|at all)\s+)*$/.test(prefix);
}
function reviewSignals(text) {
  return Object.fromEntries(Object.entries(RULES).map(([key, rule]) => {
    // Low dog traffic phrases can contain the high phrase “many dogs”.
    const firstPatterns = key === 'dogTraffic' ? rule.positive : rule.negative;
    const firstMatches = matches(text, firstPatterns).filter(match => unnegated(text, match));
    let remaining = text;
    for (const match of [...firstMatches].sort((a,b) => b.index - a.index)) {
      remaining = remaining.slice(0, match.index) + ' '.repeat(match[0].length) + remaining.slice(match.index + match[0].length);
    }
    const secondPatterns = key === 'dogTraffic' ? rule.negative : rule.positive;
    const second = matches(remaining, secondPatterns).some(match => unnegated(remaining, match));
    return [key, key === 'dogTraffic' ? { positive: firstMatches.length > 0, negative: second }
      : { positive: second, negative: firstMatches.length > 0 }];
  }));
}
function inferFromReviewConsensus(reviews, now = Date.now()) {
  const signals = qualifyingReviewTexts(reviews, now).map(reviewSignals);
  return Object.fromEntries(Object.entries(RULES).map(([key, rule]) => {
    const positive = signals.filter(signal => signal[key].positive).length;
    const negative = signals.filter(signal => signal[key].negative).length;
    const yes = positive >= 2 && negative === 0;
    const no = negative >= 2 && positive === 0 && key !== 'dedicatedDogArea';
    if (!yes && !no) return [key, UNKNOWN()];
    return [key, { value: key === 'dogTraffic' ? yes ? 'low' : 'high' : yes,
      confidence: 'inferred', evidence: yes ? rule.yes : rule.no }];
  }));
}
module.exports = { qualifyingReviewTexts, reviewSignals, inferFromReviewConsensus, MAX_REVIEWS, MAX_REVIEW_LENGTH };
