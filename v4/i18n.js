'use strict';
// All translations are bundled locally. Language preference is session-only.
const STR = TRANSLATIONS;
let LANG = 'ko';
const LANGUAGES = [
  { code: 'ko', name: '한국어' }, { code: 'en', name: 'English' },
  { code: 'zh-Hans', name: '简体中文' }, { code: 'vi', name: 'Tiếng Việt' },
  { code: 'ru', name: 'Русский' }, { code: 'uz', name: 'O‘zbekcha' },
  { code: 'mn', name: 'Монгол' }, { code: 'ja', name: '日本語' },
  { code: 'zh-Hant', name: '繁體中文' }, { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'ms', name: 'Bahasa Melayu' },
];
function t(key, vars = {}) {
  const source = STR[LANG]?.[key] ?? STR.ko[key] ?? key;
  return source.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
}
const PLACE_KEYS = new Map(Object.keys(STR.ko).filter(key => key.startsWith('place.')).map(key => [STR.ko[key], key]));
function localName(raw) { return PLACE_KEYS.has(raw) ? t(PLACE_KEYS.get(raw)) : raw; }
function ro(word) {
  if (LANG !== 'ko') return word;
  const ch = word.trim().slice(-1);
  if (/\d/.test(ch)) return word + ('036'.includes(ch) ? '으로' : '로');
  const code = ch.charCodeAt(0) - 0xAC00;
  const jong = code >= 0 && code < 11172 ? code % 28 : 0;
  return word + (jong === 0 || jong === 8 ? '로' : '으로');
}
let measureContext;
const measuredText = new Map();
function textWidth(text, size, weight = 600) {
  const family = typeof getComputedStyle === 'function' ? getComputedStyle(document.body).fontFamily : 'sans-serif';
  const key = [LANG, family, size, weight, text].join('|');
  if (measuredText.has(key)) return measuredText.get(key);
  if (!measureContext && typeof document !== 'undefined') measureContext = document.createElement('canvas').getContext('2d');
  if (measureContext) measureContext.font = weight + ' ' + size + 'px ' + family;
  const width = measureContext ? measureContext.measureText(String(text)).width : [...String(text)].length * size * .65;
  if (measuredText.size > 4000) measuredText.clear();
  measuredText.set(key, width);
  return width;
}
