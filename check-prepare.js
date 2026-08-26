#!/usr/bin/env node
/* What `prepare` promises about the front door of a section.
 *
 *     node check-prepare.js
 *
 * `pick` ranks a page higher when it is the landing page of its section, so
 * that typing a section's name lands on the section rather than on some page
 * inside it. Which page counts as the landing page is decided here, and the
 * rule has been wrong twice already:
 *
 *   1. "the page one level down from the root" — right for a site whose
 *      sections all sit at the top, wrong the moment one does not. A book at
 *      `/b/mctb2/` is as much a section as `/links/` is, and typing its name
 *      used to land on an arbitrary chapter.
 *   2. "the shallowest page in the section" — right for a section somebody
 *      declared, a guess for the bucket a builder puts unmatched pages in.
 *
 * Neither was caught by a site's own fixture, because a site's fixture only
 * knows the arrangement that site happens to have. Hence this: the cases are
 * written out by hand, including the ones no site has today.
 */
'use strict';

const path = require('path');
const { prepare } = require(path.join(__dirname, 'palette.js'));

function doors(list) {
	return prepare(list).filter((p) => p.home).map((p) => p.url).sort();
}

const cases = [];

function is(name, got, want) {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	cases.push({ name, ok, got, want });
}

// Раздел на первом уровне: дверь — его собственная заглавная.
is('раздел на первом уровне', doors([
	{ url: '/links/', title: 'Links', section: 'Links' },
	{ url: '/links/math/', title: 'Math', section: 'Links' },
]), ['/links/']);

// Раздел глубже первого уровня: правило «первый уровень» ошибалось здесь.
is('раздел глубже первого уровня', doors([
	{ url: '/b/mctb2/', title: 'Осознание основ учения Будды', section: 'Книга' },
	{ url: '/b/mctb2/p3-kasina/', title: '29. Практика касин', section: 'Книга' },
	{ url: '/b/mctb2/glossary/', title: 'Словарь терминов', section: 'Книга' },
]), ['/b/mctb2/']);

// Ничья: у раздела две страницы одной глубины — значит две двери, и это
// намеренно. Раздел с двумя входами имеет два входа.
is('ничья даёт две двери', doors([
	{ url: '/art/', title: 'Искусство', section: 'Искусство' },
	{ url: '/pics/', title: 'Картины', section: 'Искусство' },
	{ url: '/art/monet/', title: 'Моне', section: 'Искусство' },
]), ['/art/', '/pics/']);

// Остаток: состав раздела никто не выбирал, и двери у него нет. Сегодня самой
// мелкой оказалась бы `/`, и выглядело бы это верно — ровно поэтому случай и
// записан: он ломается не тогда, когда его заводят, а когда `/` уедет.
is('остаточный раздел двери не получает', doors([
	{ url: '/', title: 'Главная', section: 'Институт', fallback: true },
	{ url: '/search/', title: 'Поиск', section: 'Институт', fallback: true },
]), []);

// И ломается он именно так: без `/` дверью «Института» стала бы страница
// поиска — страница, которая разделом не является ни в каком смысле.
is('остаток без корня — тоже без двери', doors([
	{ url: '/search/', title: 'Поиск', section: 'Институт', fallback: true },
]), []);

// Признак необязателен: указатель, который о нём не знает, ведёт себя как
// прежде. Иначе поправка ломала бы сайт, не успевший пересобраться.
is('без признака всё по-старому', doors([
	{ url: '/links/', title: 'Links', section: 'Links' },
	{ url: '/links/math/', title: 'Math', section: 'Links' },
]), ['/links/']);

// Остаток не мешает настоящему разделу: они считаются порознь.
is('остаток и настоящий раздел рядом', doors([
	{ url: '/', title: 'Главная', section: 'Институт', fallback: true },
	{ url: '/dance/', title: 'Натьяшастра', section: 'Натьяшастра' },
	{ url: '/dance/ch1/', title: 'Глава 1', section: 'Натьяшастра' },
]), ['/dance/']);

let bad = 0;
for (const c of cases) {
	if (!c.ok) {
		bad++;
		console.log('   ✗ %s: получилось %s, ожидалось %s', c.name, JSON.stringify(c.got), JSON.stringify(c.want));
	}
}
console.log('Двери разделов: сошлось %d из %d', cases.length - bad, cases.length);
process.exit(bad ? 1 : 0);
