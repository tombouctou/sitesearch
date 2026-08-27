#!/usr/bin/env node
/* The words the search and the palette say about themselves, in every language
 * they claim to speak.
 *
 *     node check-say.js
 *
 * Both files carry a table with a column per language, and the reader is
 * handed one column whole. What can go wrong with that is not the sort of
 * thing a page shows you: it shows an English reader one Russian line among
 * fifteen English ones, or the word `undefined` where a count should be, and
 * only on the branch that produced it — an index that failed to load, a query
 * with no answer, a word mended into another. Nobody walks all of those.
 *
 * So the columns are compared with each other instead of with a page:
 *
 *   1. the same keys in every column, and the same kind under each — a phrase
 *      is a string, anything that counts or that puts a word inside a sentence
 *      is a function;
 *   2. every function returns a non-empty string when called;
 *   3. no phrase in another language left standing as the Russian one — the
 *      column is copied to be filled in, and a line copied and not filled in
 *      is the ordinary way this breaks;
 *   4. every `say_.x` and `.say.x` in the source names a key the table holds,
 *      and every key the table holds is named somewhere — a typo shows as
 *      `undefined` to a reader, a leftover key shows to nobody;
 *   5. no phrase written at the call site: a string of two Cyrillic letters or
 *      more outside the table is a line somebody typed where they stood, and
 *      it will be Russian on an English page for as long as it lives there.
 *
 * The fifth needs the source read as JavaScript rather than as text — the fold
 * tables are full of single Cyrillic letters and the comments are full of
 * Russian words — so the file is cut into strings, comments and the rest
 * below. That is the whole of the parsing done here: enough to know whether a
 * quotation mark opens a phrase or sits inside a comment about one.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CYR = /[Ѐ-ӿ]/;

/* --- reading the source ---------------------------------------------------
 *
 * A `/` begins a comment, a regular expression or a division, and which one
 * depends on what came before it: after a value — a name, a number, a closing
 * bracket — it divides; anywhere else it starts something. Both files are
 * written by hand and neither divides by anything, but the rule is cheap and
 * saves the reader of this file from wondering.
 */
function scan(src) {
	const strings = [];         // { at, text }
	const bare = [];            // code with strings and comments blanked out
	let i = 0, prev = '';
	while (i < src.length) {
		const c = src[i];
		if (c === '/' && src[i + 1] === '/') {
			while (i < src.length && src[i] !== '\n') { bare.push(' '); i++; }
			continue;
		}
		if (c === '/' && src[i + 1] === '*') {
			const end = src.indexOf('*/', i + 2);
			const stop = end === -1 ? src.length : end + 2;
			while (i < stop) { bare.push(src[i] === '\n' ? '\n' : ' '); i++; }
			continue;
		}
		if (c === '/' && !/[\w$)\]]/.test(prev)) {
			// A regular expression: its own escapes and character classes, in
			// which a `/` is a letter like any other.
			let j = i + 1, cls = false;
			while (j < src.length) {
				if (src[j] === '\\') { j += 2; continue; }
				if (src[j] === '[') cls = true;
				else if (src[j] === ']') cls = false;
				else if (src[j] === '/' && !cls) break;
				else if (src[j] === '\n') break;
				j++;
			}
			while (i <= j && i < src.length) { bare.push(' '); i++; }
			prev = 'r';
			continue;
		}
		if (c === '"' || c === "'" || c === '`') {
			let j = i + 1, text = '';
			while (j < src.length && src[j] !== c) {
				if (src[j] === '\\') { text += src[j + 1] || ''; j += 2; continue; }
				text += src[j];
				j++;
			}
			strings.push({ at: i, text: text });
			while (i <= j && i < src.length) { bare.push(src[i] === '\n' ? '\n' : ' '); i++; }
			prev = 's';
			continue;
		}
		bare.push(c);
		if (!/\s/.test(c)) prev = c;
		i++;
	}
	return { strings: strings, bare: bare.join('') };
}

// Where the table stands, so that what is inside it can be told from what is
// outside. Braces are counted in the blanked-out code, where a `{` inside a
// phrase is no longer a brace.
function tableSpan(bare) {
	const at = bare.indexOf('var SAY = {');
	if (at === -1) return null;
	let depth = 0, i = bare.indexOf('{', at);
	for (; i < bare.length; i++) {
		if (bare[i] === '{') depth++;
		else if (bare[i] === '}' && --depth === 0) return { from: at, to: i };
	}
	return null;
}

/* --- the checks ---------------------------------------------------------- */

const problems = [];

function fault(file, what) {
	problems.push(file + ': ' + what);
}

function check(file, table) {
	const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
	const read = scan(src);
	const span = tableSpan(read.bare);
	if (!span) { fault(file, 'таблицы SAY в файле нет'); return; }

	const langs = Object.keys(table);
	if (langs.indexOf('ru') === -1) { fault(file, 'нет столбца ru — с ним сличаются остальные'); return; }
	const keys = Object.keys(table.ru).sort();

	langs.forEach((lang) => {
		const col = table[lang];
		const mine = Object.keys(col).sort();
		mine.filter((k) => keys.indexOf(k) === -1)
			.forEach((k) => fault(file, lang + '.' + k + ': такого ключа нет в ru'));
		keys.filter((k) => mine.indexOf(k) === -1)
			.forEach((k) => fault(file, lang + '.' + k + ': ключ есть в ru, здесь нет'));

		keys.filter((k) => col[k] !== undefined).forEach((k) => {
			if (typeof col[k] !== typeof table.ru[k]) {
				fault(file, lang + '.' + k + ': ' + typeof col[k] + ', а в ru ' + typeof table.ru[k]);
				return;
			}
			if (typeof col[k] === 'function') {
				// Called with both a number and a word: a phrase takes one or
				// the other, and neither should leave it empty.
				const got = [col[k](3), col[k]('слово')];
				got.forEach((s) => {
					if (typeof s !== 'string' || !s.trim()) {
						fault(file, lang + '.' + k + ': вернула не строку');
					}
				});
				return;
			}
			if (lang !== 'ru' && CYR.test(table.ru[k]) && col[k] === table.ru[k]) {
				fault(file, lang + '.' + k + ': осталась русской — «' + col[k] + '»');
			}
		});
	});

	// The call sites, taken from the code with the table cut out of it.
	const code = read.bare.slice(0, span.from) + read.bare.slice(span.to + 1);
	const used = {};
	const call = /(?:say_|\.say)\.([A-Za-z][A-Za-z0-9]*)/g;
	let m;
	while ((m = call.exec(code)) !== null) {
		used[m[1]] = true;
		if (keys.indexOf(m[1]) === -1) fault(file, 'сказано say.' + m[1] + ', а такого ключа нет');
	}
	keys.filter((k) => !used[k]).forEach((k) => fault(file, k + ': в таблице есть, а не говорится нигде'));

	// A phrase written where it is said instead of in the table. One Cyrillic
	// letter is the fold's business — «ж», «дж» — and stays out of this.
	read.strings
		.filter((s) => s.at < span.from || s.at > span.to)
		.filter((s) => CYR.test(s.text) && s.text.replace(/[^Ѐ-ӿ]/g, '').length > 1)
		.forEach((s) => fault(file, 'фраза мимо таблицы — «' + s.text + '»'));
}

check('search.js', require(path.join(__dirname, 'search.js')).say);
check('palette.js', require(path.join(__dirname, 'palette.js')).say);

problems.forEach((p) => console.log(p));
console.log('');
if (problems.length) {
	console.log('расхождений: ' + problems.length);
	process.exit(1);
}
console.log('оба файла говорят на всех языках, которые называют');
