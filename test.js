// node test.js — checks CSV parsing and matching against a tiny fake SCImago export.
const assert = require('assert');
const { buildIndex, match, seekerQuartile } = require('./sjr.js');

const csv = '﻿Rank;Sourceid;Title;Type;Issn;SJR;SJR Best Quartile;Categories\r\n' +
  '1;21100;"Machine Learning and Knowledge Extraction";journal;"25044990";"1,548";Q1;"AI (Q1); CS (Q2)"\r\n' +
  '2;12345;"Machine Learning";journal;"08856125, 15730565";"1,200";Q2;"AI (Q2)"\r\n' +
  '3;99;"Nature";journal;"00280836";"18,5";Q1;"Multi (Q1)"\r\n' +
  '4;77;"Science & Engineering Ethics";journal;"13533452";"0,8";Q3;"x"\r\n' +
  '5;55;"Some Proceedings";conference and proceedings;"";"";-;"x"\r\n' +
  '6;66;"Neural Networks";journal;"";"";Q1;"x"\r\n' +
  '7;88;"Journal of the American Statistical Association";journal;"";"";Q2;"x"\r\n' +
  '8;44;"Journal of Ophthalmic and Vision Research";journal;"20082010";"";Q3;"x"\r\n';
const idx = buildIndex(csv);
const q = text => match(idx, text).map(m => [text.slice(0, m.end), m.j.q]);

assert.deepStrictEqual(q('Machine Learning and Knowledge Extraction 8 (4), 111'),
  [['Machine Learning and Knowledge Extraction', 'Q1']]);                   // longest title wins
assert.deepStrictEqual(q('advances in machine learning.'), []);             // lowercase prose
assert.deepStrictEqual(q('published in Machine learning.'), [['published in Machine learning', 'Q2']]);
assert.deepStrictEqual(q('the nature of things'), []);                       // single word: case-sensitive
assert.deepStrictEqual(q('Nature, 2024'), []);                              // single word inside a sentence/date
assert.deepStrictEqual(q(' Nature. '), [[' Nature', 'Q1']]);                 // single word as the whole node
assert.deepStrictEqual(q('Science and Engineering Ethics'), [['Science and Engineering Ethics', 'Q3']]);
assert.deepStrictEqual(q('International Conference on Machine Learning (ICML)'), []); // part of a longer name
assert.deepStrictEqual(q('Machine Learning Workshop'), []);
assert.deepStrictEqual(q('ISSN 1573-0565'), [['ISSN 1573-0565', 'Q2']]);
assert.deepStrictEqual(q('data from 2008-2010 show'), []);                // year range, not an ISSN
assert.deepStrictEqual(q('2008-2010'), [['2008-2010', 'Q3']]);              // ISSN on its own (RG journal link)
assert.deepStrictEqual(q('eISSN 1234-5678, 2008-2010'), [['eISSN 1234-5678, 2008-2010', 'Q3']]);
assert.deepStrictEqual(q('Some Proceedings'), [['Some Proceedings', 'NR']]);
// IEEE-style abbreviations
assert.deepStrictEqual(q('models,” Neural Netw., vol. 192'), [['models,” Neural Netw.', 'Q1']]);
assert.deepStrictEqual(q('J. Amer. Statist. Assoc., vol. 75'), [['J. Amer. Statist. Assoc.', 'Q2']]);
assert.deepStrictEqual(q('S. Holm, J. Shi and N. Ne'), []);               // author initials
assert.deepStrictEqual(q('neural netw. stuff'), []);                         // needs capitals
assert.deepStrictEqual(match(idx, 'see Neural Netw. 5')[0].start, 4);
assert.strictEqual(idx.titles.get('nature').sjr, '18,5');
assert.deepStrictEqual(match(idx, 'Nature').map(m => m.one), [true]);         // content.js needs <i>/<cite>/heading
assert.deepStrictEqual(match(idx, 'Machine Learning').map(m => m.one), [false]);
assert.deepStrictEqual(match(idx, 'ISSN 0028-0836').map(m => !!m.one), [false]);
// journalseeker.com backup
assert.deepStrictEqual(seekerQuartile('{"name": "Review Of Socionetwork Strategies", "issn": "2523-3173", "quartile": "Q4"}'),
  { q: 'Q4', title: 'Review Of Socionetwork Strategies' });
assert.strictEqual(seekerQuartile('{"name": "Qwerty Zzz Journal", "quartile": ""}'), null);  // unknown journal
console.log('ok');
