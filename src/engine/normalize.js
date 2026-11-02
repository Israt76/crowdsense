// Text normalization for messy live chat.
// Deterministic, dependency-free. Keeps punctuation that carries meaning
// ("?" for questions, "," and "." as negation-scope breakers, ">" for comparisons).

const EMOTES = new Set([
  'pog', 'pogchamp', 'poggers', 'pogu', 'kekw', 'lul', 'lulw', 'omegalul', 'pepehands',
  'monkas', 'pepega', 'kappa', 'pogo', 'ez', 'sadge', 'copium', 'hypers', 'catjam',
  'peeposhy', 'pepelaugh', 'biblethump', 'residentsleeper', 'kreygasm', 'wutface', 'notlikethis',
]);

const CONTRACTIONS = [
  [/\bdon'?t\b/g, 'dont'], [/\bdo not\b/g, 'dont'], [/\bdoesn'?t\b/g, 'dont'], [/\bdoes not\b/g, 'dont'],
  [/\bcan'?t\b/g, 'cant'], [/\bcannot\b/g, 'cant'], [/\bwon'?t\b/g, 'wont'], [/\bwill not\b/g, 'wont'],
  [/\bshouldn'?t\b/g, 'shouldnt'], [/\bshould not\b/g, 'shouldnt'], [/\bisn'?t\b/g, 'isnt'], [/\bis not\b/g, 'isnt'],
  [/\bi'?m\b/g, 'im'], [/\bi am\b/g, 'im'], [/\blet'?s\b/g, 'lets'], [/\bwhat'?s\b/g, 'whats'],
  [/\bit'?s\b/g, 'its'], [/\bthat'?s\b/g, 'thats'], [/\bwhere'?s\b/g, 'wheres'], [/\bhow'?s\b/g, 'hows'],
  [/\bnever ever\b/g, 'never'],
];

const EMOJI_RE = /\p{Extended_Pictographic}/gu;

/**
 * Normalize a raw chat message.
 * @returns {{raw:string, text:string, tokens:string[], words:string[], isQuestion:boolean,
 *            emoteCount:number, emojiCount:number, shout:boolean}}
 */
export function normalize(raw) {
  const original = String(raw ?? '');
  const letters = original.replace(/[^A-Za-z]/g, '');
  const shout = letters.length >= 2 && letters === letters.toUpperCase();
  const emojiCount = (original.match(EMOJI_RE) || []).length;

  let t = original.toLowerCase();
  t = t.replace(/https?:\/\/\S+/g, ' ');
  t = t.replace(/@\w+/g, ' ');
  t = t.replace(EMOJI_RE, ' ');
  t = t.replace(/[’‘`]/g, "'");
  t = t.replace(/([a-z])\1{2,}/g, '$1');
  t = t.replace(/([!?.,])\1+/g, '$1');
  for (const [re, rep] of CONTRACTIONS) t = t.replace(re, rep);
  t = t.replace(/'/g, '');
  t = t.replace(/->|=>/g, ' > ');

  const isQuestion = /\?/.test(t);
  const tokens = (t.match(/[a-z0-9]+|[?,.>;]/g) || []);
  const words = tokens.filter((x) => /^[a-z0-9]+$/.test(x));
  const emoteCount = words.filter((w) => EMOTES.has(w)).length;
  return { raw: original, text: words.join(' '), tokens, words, isQuestion, emoteCount, emojiCount, shout };
}

export const STOPWORDS = new Set(
  ('a an the to of and or but in on at for with is are was be been it its this that these those i im me my we us our ' +
    'you your u ur he she they them their so just pls plz please lol lmao xd ok okay yeah ya yes no chat guys bro dude ' +
    'man like really very much do does did go take pick choose way route path one should would could will can just ' +
    'now then there here what why how who where when which all any some more most also too as if than from by ' +
    'gonna wanna its hes shes lets get got has have had not dont never actually nah yo hey hi hello')
    .split(/\s+/),
);

export function isEmote(word) {
  return EMOTES.has(word);
}

export function stem(w) {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}
