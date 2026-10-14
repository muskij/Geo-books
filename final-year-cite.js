// Reference formatter for the Final Year project coach. Pure functions, no network and no AI, so the
// output can be trusted to contain only what the student typed. Italics are marked with *asterisks*.
// Formats follow APA 7th and the common Harvard (Cite Them Right) layout. Schools differ, so the UI tells
// students to check their department's guide.

export const STYLES = { apa: 'APA 7th', harvard: 'Harvard' };

const LEVELS = [
  { value: 'undergraduate', label: 'Undergraduate project', apa: 'undergraduate project', harvard: 'Undergraduate project' },
  { value: 'masters', label: 'Master’s thesis', apa: 'master’s thesis', harvard: 'Master’s thesis' },
  { value: 'phd', label: 'PhD thesis', apa: 'doctoral dissertation', harvard: 'PhD thesis' },
];

const A = { key: 'authors', label: 'Author(s), one per line', kind: 'area', placeholder: 'Surname, Firstname', required: true };
const ORG = { key: 'org', label: 'The author is an organisation', kind: 'check' };
const YEAR = { key: 'year', label: 'Year', kind: 'text', placeholder: '2024', required: true };
const TITLE = (label) => ({ key: 'title', label: label || 'Title', kind: 'text', required: true });

export const TYPES = {
  journal: { label: 'Journal article', fields: [A, ORG, YEAR, TITLE('Article title'),
    { key: 'journal', label: 'Journal name', kind: 'text', required: true },
    { key: 'volume', label: 'Volume', kind: 'text', placeholder: '12' },
    { key: 'issue', label: 'Issue', kind: 'text', placeholder: '3' },
    { key: 'pages', label: 'Pages', kind: 'text', placeholder: '207-217' },
    { key: 'link', label: 'DOI or link (optional)', kind: 'text', placeholder: '10.1037/ppm0000185' }] },
  book: { label: 'Book', fields: [A, ORG, YEAR, TITLE('Book title'),
    { key: 'edition', label: 'Edition (optional)', kind: 'text', placeholder: '2nd' },
    { key: 'publisher', label: 'Publisher', kind: 'text', required: true },
    { key: 'place', label: 'Place of publication (Harvard only)', kind: 'text', placeholder: 'Lagos' }] },
  web: { label: 'Website or online page', fields: [A, ORG, YEAR, TITLE('Page title'),
    { key: 'monthday', label: 'Month and day (optional, APA)', kind: 'text', placeholder: 'March 5' },
    { key: 'site', label: 'Website name (optional)', kind: 'text' },
    { key: 'link', label: 'Web address', kind: 'text', required: true, placeholder: 'https://' },
    { key: 'accessed', label: 'Date you read it (Harvard)', kind: 'text', placeholder: '12 October 2026' }] },
  thesis: { label: 'Thesis or project', fields: [A, ORG, YEAR, TITLE('Title'),
    { key: 'level', label: 'Level', kind: 'select', options: LEVELS.map((l) => ({ value: l.value, label: l.label })) },
    { key: 'university', label: 'University', kind: 'text', required: true }] },
  report: { label: 'Report or official publication', fields: [A, ORG, YEAR, TITLE('Report title'),
    { key: 'publisher', label: 'Publisher (if different from the author)', kind: 'text' },
    { key: 'place', label: 'Place of publication (Harvard only)', kind: 'text' },
    { key: 'link', label: 'Web address (optional)', kind: 'text' },
    { key: 'accessed', label: 'Date you read it (Harvard, if online)', kind: 'text' }] },
};

const clean = (s) => String(s == null ? '' : s).replace(/[*\u0000]/g, '').replace(/\s+/g, ' ').trim();
const lines = (s) => String(s == null ? '' : s).split(/\r?\n/).map(clean).filter(Boolean);
const dash = (s) => clean(s).replace(/(\d)\s*[-–—]\s*(\d)/g, '$1–$2');
const endDot = (s) => (/[.?!]$/.test(s) ? s : s + '.');
const ordinal = (s) => { const v = clean(s).replace(/\s*(edn?\.?|edition)$/i, ''); if (!v) return ''; if (/^\d+$/.test(v)) { const n = Number(v); const k = n % 100; const suf = k >= 11 && k <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'); return n + suf; } return v; };
const link = (v) => { const x = clean(v).replace(/^doi:\s*/i, ''); return /^10\.\d{4,9}\/\S+$/.test(x) ? 'https://doi.org/' + x : x; };
const tidy = (s) => s.replace(/ \. \. \. /g, '\u0001').replace(/\s+/g, ' ').replace(/\s+([,.;])/g, '$1').replace(/\.{2,}/g, '.').replace(/,\./g, '.').replace(/\u0001/g, ' . . . ').trim();

// One author line -> {sur, ini:{apa, harvard}} or {org}
function person(line, org) {
  if (org) return { org: line };
  let sur; let given;
  if (line.includes(',')) { const i = line.indexOf(','); sur = line.slice(0, i).trim(); given = line.slice(i + 1).trim(); } else {
    const t = line.split(' ');
    if (t.length === 1) return { org: line };
    sur = t[t.length - 1]; given = t.slice(0, -1).join(' ');
  }
  const tokens = given.replace(/\./g, ' ').split(/\s+/).filter(Boolean);
  const parts = tokens.map((tok) => tok.split('-').filter(Boolean).map((p) => p[0].toUpperCase() + '.').join('-'));
  return { sur, ini: { apa: parts.join(' '), harvard: parts.join('') } };
}

function apaAuthors(list) {
  const f = list.map((p) => (p.org ? p.org : p.ini.apa ? `${p.sur}, ${p.ini.apa}` : p.sur));
  if (f.length === 1) return f[0];
  if (f.length <= 20) return f.slice(0, -1).join(', ') + ', & ' + f[f.length - 1];
  return f.slice(0, 19).join(', ') + ', . . . ' + f[f.length - 1];
}
function harvardAuthors(list) {
  const f = list.map((p) => (p.org ? p.org : p.ini.harvard ? `${p.sur}, ${p.ini.harvard}` : p.sur));
  if (f.length === 1) return f[0];
  return f.slice(0, -1).join(', ') + ' and ' + f[f.length - 1];
}

// -> { text: "reference with *italic* marks", missing: [field labels the student left empty] }
export function formatCitation(style, type, input) {
  const spec = TYPES[type];
  if (!spec || !STYLES[style]) return { text: '', missing: [] };
  const v = input || {};
  const missing = spec.fields.filter((f) => f.required && !(f.kind === 'area' ? lines(v[f.key]).length : clean(v[f.key]))).map((f) => f.label.replace(/, one per line$/, ''));
  const list = lines(v.authors).map((l) => person(l, !!v.org));
  const title = clean(v.title); const year = clean(v.year) || 'n.d.';
  if (!list.length && !title) return { text: '', missing };
  const apa = style === 'apa';
  const au = list.length ? (apa ? apaAuthors(list) : harvardAuthors(list)) : '';
  const head = apa ? `${au ? endDot(au) + ' ' : ''}(${year}${type === 'web' && clean(v.monthday) ? ', ' + clean(v.monthday) : ''}).` : `${au ? au + ' ' : ''}(${year})`;
  const volume = clean(v.volume); const issue = clean(v.issue); const pages = dash(v.pages);
  const url = link(v.link);
  let out = '';

  if (type === 'journal') {
    const j = clean(v.journal);
    if (apa) out = `${head} ${title ? endDot(title) : ''} ${j ? `*${j}${volume ? ', ' + volume : ''}*` : ''}${issue ? `(${issue})` : ''}${pages ? ', ' + pages : ''}.${url ? ' ' + url : ''}`;
    else out = `${head} ${title ? `'${title}',` : ''} ${j ? `*${j}*` : ''}${volume ? ', ' + volume : ''}${issue ? `(${issue})` : ''}${pages ? ', ' + (pages.includes('–') ? 'pp. ' : 'p. ') + pages : ''}.${url ? ' Available at: ' + url + '.' : ''}`;
  } else if (type === 'book') {
    const ed = ordinal(v.edition); const pub = clean(v.publisher); const place = clean(v.place);
    if (apa) out = `${head} *${title}*${ed ? ` (${ed} ed.)` : ''}. ${pub ? endDot(pub) : ''}`;
    else out = `${head} *${title}*. ${ed ? ed + ' edn. ' : ''}${place ? place + ': ' : ''}${pub ? endDot(pub) : ''}`;
  } else if (type === 'web') {
    const site = clean(v.site); const acc = clean(v.accessed);
    if (apa) out = `${head} *${title}*. ${site && site !== au.replace(/\.$/, '') ? endDot(site) + ' ' : ''}${url}`;
    else out = `${head} *${title}*. ${url ? 'Available at: ' + url : ''}${acc ? ` (Accessed: ${acc})` : ''}.`;
  } else if (type === 'thesis') {
    const lv = LEVELS.find((l) => l.value === v.level) || LEVELS[0]; const uni = clean(v.university);
    if (apa) out = `${head} *${title}* [Unpublished ${lv.apa}]. ${uni ? endDot(uni) : ''}`;
    else out = `${head} *${title}*. ${lv.harvard}. ${uni ? endDot(uni) : ''}`;
  } else if (type === 'report') {
    const pub = clean(v.publisher); const place = clean(v.place); const acc = clean(v.accessed);
    if (apa) out = `${head} *${title}*. ${pub && pub !== au.replace(/\.$/, '') ? endDot(pub) + ' ' : ''}${url}`;
    else out = `${head} *${title}*. ${place ? place + ': ' : ''}${pub ? endDot(pub) : ''}${url ? ` Available at: ${url}${acc ? ` (Accessed: ${acc})` : ''}.` : ''}`;
  }
  return { text: tidy(out), missing };
}

export const plain = (text) => String(text || '').replace(/\*/g, '');
export const sortRefs = (refs) => [...refs].sort((a, b) => plain(a).toLowerCase().localeCompare(plain(b).toLowerCase()));
