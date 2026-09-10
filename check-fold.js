#!/usr/bin/env node
/* The two folds must agree.
 *
 *     node check-fold.js
 *
 * `search.js` and `palette.js` each carry their own copy of the fold, and on
 * purpose: the palette rides on every page of a site and cannot haul a 49 KB
 * search engine along for the sake of forty lines. What a copy does is diverge
 * silently — «натья» stops finding `nāṭya`, and nobody notices until somebody
 * tries. Here both are run over one set of words and required to agree
 * character for character.
 *
 * This check exists because both copies live in this repository. A site that
 * copied the palette into itself would need a check of its own, in a third
 * place, comparing across repositories — which is the reason the palette lives
 * here rather than there.
 *
 * The words are the ones a fold breaks on: a letter that depends on its
 * neighbour, Cyrillic met with diacritics, «дж» read as one sound.
 *
 * Both folds are checked, not just the one a site happens to use: `plain`
 * exists for sites whose texts are simply Russian, and a copy diverges as
 * quietly there as anywhere else.
 */
'use strict';

const path = require('path');

const search = require(path.join(__dirname, 'search.js'));
const palette = require(path.join(__dirname, 'palette.js'));

const WORDS = [
	'śaktipāta', 'шактипата', 'saktipata', 'Тантралока', 'Tantrāloka',
	'натья', 'nāṭya', 'Natya', 'джняна', 'jñāna', 'нритта', 'nṛtta',
	'кальпа юга', 'яма', 'майя', 'объявление', 'пятая', 'по-японски',
	'Пратьябхиджняхридаям', 'Pratyabhijñāhṛdayam', 'Śivastotrāvalī',
	'Шивастотравали', 'щока', 'цвет', 'Ṣaṭtriṁśattattvasandoha',
	'Kṣemarāja', 'Кшемараджа', 'Осознание основ учения Будды',
	'джханы', 'саматха-джханы', 'Часть 3', 'ヴィッし home page',
];

let bad = 0, ran = 0;
for (const how of ['sanskrit', 'plain']) {
	for (const w of WORDS) {
		ran++;
		const a = search.fold(w, how), b = palette.fold(w, how);
		if (a !== b) {
			console.log('   ✗ [%s] %s → search.js «%s», palette.js «%s»', how, w, a, b);
			bad++;
		}
	}
}

/* The plain fold has one thing to prove of its own: that it leaves the
   alphabet alone. A fold that carried Cyrillic to Latin would put these pairs
   on one string, and the site that asked for `plain` asked precisely so that
   «шаг» would not find «саг». */
const APART = [['шаг', 'саг'], ['щит', 'сит'], ['мял', 'мал'], ['юг', 'уг'], ['ясно', 'асно']];
for (const [a, b] of APART) {
	ran++;
	if (search.fold(a, 'plain') === search.fold(b, 'plain')) {
		console.log('   ✗ [plain] «%s» и «%s» свернулись в одно', a, b);
		bad++;
	}
}
// And that «ё» is still «е»: it is the one letter the plain fold does touch.
ran++;
if (search.fold('ёлка', 'plain') !== search.fold('елка', 'plain')) {
	console.log('   ✗ [plain] «ёлка» и «елка» разошлись');
	bad++;
}

console.log('Свёртка: сошлось %d из %d', ran - bad, ran);
process.exit(bad ? 1 : 0);
