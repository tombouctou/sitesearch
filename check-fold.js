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

let bad = 0;
for (const w of WORDS) {
	const a = search.fold(w), b = palette.fold(w);
	if (a !== b) {
		console.log('   ✗ %s → search.js «%s», palette.js «%s»', w, a, b);
		bad++;
	}
}

console.log('Свёртка: сошлось %d из %d', WORDS.length - bad, WORDS.length);
process.exit(bad ? 1 : 0);
