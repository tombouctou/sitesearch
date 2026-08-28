/* Jump to a section of the site: ⌘K on macOS, Ctrl-K everywhere else.
 *
 * Type «Тантралока» and land on the page. This is not the search: the search
 * answers "where is that written about" and lives on one page of its own,
 * while the palette answers "take me there" and lives on every page. Once a
 * site has a dozen sections, going from the middle of one to another costs
 * three clicks through the breadcrumbs.
 *
 * A page attaches it with one tag and names the index to read:
 *
 *     <script src="/sitesearch/palette.js" data-index="/nav-index.json" defer></script>
 *
 * or, when the settings are easier to write in JavaScript,
 *
 *     SitePalette.mount({ index: '/nav-index.json', mount: '.corner-tools' });
 *
 * The index is a small one — page names and addresses, nothing else. The
 * search index is the wrong file for this: a map of every word of the site is
 * tens of kilobytes at best, and it would travel to every reader on every page
 * for the sake of a list of section names. `pages` of FORMAT.md without
 * `blocks` is exactly what is wanted, and a builder that already writes the
 * search index can project one out of it for a rounding error.
 *
 * The button is not decoration. A keyboard shortcut nobody knows about might
 * as well not exist, and on a telephone there is no keyboard at all.
 *
 * Colours come from custom properties with dark defaults; a site with a light
 * theme redefines them in its own stylesheet (see `styles`). Node may require
 * this file for `fold`, `prepare` and `pick`: nothing touches the document
 * until `mount` is called.
 */
(function (global) {
	'use strict';

	var SHOWN = 12;

	/* --- folding the writing systems -------------------------------------
	 *
	 * The same fold as the search engine's (search.js): case, "ё" and
	 * diacritics come off, and Cyrillic crosses to Latin. On a site about
	 * Sanskrit one word is written both ways — `śaktipāta` in one chapter,
	 * «шактипата» in the next — and to the reader that is one word. The long
	 * account of why the table looks like this is in search.js, above the same
	 * table; the rules and their order are the ones described there.
	 *
	 * Why a copy rather than a call to SiteSearch.fold: there it sits inside a
	 * 49 KB search engine, and hauling that to every page for the sake of
	 * forty lines is not a trade worth making. A copy diverges silently, so
	 * check-fold.js runs both over one set of words and requires them to agree
	 * character for character. Both copies live in this repository, which is
	 * what makes that check possible at all.
	 */
	var CYRILLIC = {
		'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e',
		'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
		'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
		'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'c', 'ш': 's', 'щ': 's', 'ъ': '',
		'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'u', 'я': 'a'
	};
	var VOWEL = /[аеёиоуыэюя]/;
	var GLIDED = /[яюеёи]/;
	var MARK = /[̀-ͯ]/g;
	var VOCALIC = { 'ṛ': 'ri', 'ṝ': 'ri', 'Ṛ': 'ri', 'Ṝ': 'ri' };

	function fold(s) {
		var out = '', n = s.length;
		for (var i = 0; i < n; i++) {
			var c = s.charAt(i).toLowerCase(), took = 1, piece;
			if (VOCALIC[c] !== undefined) piece = VOCALIC[c];
			else if (c === 'д' && s.charAt(i + 1).toLowerCase() === 'ж') { piece = 'j'; took = 2; }
			else if (c === 'ь' || c === 'ъ') piece = GLIDED.test(s.charAt(i + 1).toLowerCase()) ? 'y' : '';
			else if (c === 'я' || c === 'ю') {
				var before = i > 0 ? s.charAt(i - 1).toLowerCase() : '';
				var after = CYRILLIC[before] !== undefined && !VOWEL.test(before);
				piece = after ? CYRILLIC[c] : (c === 'я' ? 'ya' : 'yu');
			}
			else if (CYRILLIC[c] !== undefined) piece = CYRILLIC[c];
			else piece = c.normalize('NFD').replace(MARK, '');
			out += piece;
			i += took - 1;
		}
		return out;
	}

	/* --- picking and ordering --------------------------------------------
	 *
	 * The palette searches names, not text, and so can afford what the search
	 * cannot: to sort by how well the beginning of a name met what was typed.
	 * Somebody typing "тант" wants «Тантралока» and «Тантрасара» first, not
	 * the page that has the word in the middle of its heading.
	 *
	 * The grades, best to worst: exact, the name starts with what was typed, a
	 * word of the name starts with it, it occurs inside the name, it was found
	 * in the address or the name of the section.
	 *
	 * On a tie the section that stands higher on the front page goes first,
	 * and after it the page nearer the root. The last matters more than it
	 * looks: where a section and a glossary both begin with the same word,
	 * without that rule the reader typing it landed in the glossary rather
	 * than in the section itself. Whoever names a section wants the section;
	 * the pages inside it he will name more precisely.
	 */
	function against(t, q) {
		if (t === q) return 0;
		if (t.indexOf(q) === 0) return 1;
		if (t.indexOf(' ' + q) !== -1 || t.indexOf('—' + q) !== -1) return 2;
		if (t.indexOf(q) !== -1) return 3;
		return -1;
	}

	/* The landing page of a section is matched against the name of the section
	   too, not only against its own title. Otherwise somebody typing the name
	   of a section landed not on it but on some page inside it whose title
	   happens to begin with that word, while the section's own page — named
	   after the book it holds rather than after itself — never came up at all.
	   The landing page **is** the section, whatever it calls itself; this does
	   not extend to the pages inside it, where the name of the section is
	   common to all of them and the grade would come out the same for every
	   one. */
	function rank(page, q) {
		var r = against(page.fold, q);
		if (page.home) {
			var h = against(page.home, q);
			if (h >= 0 && (r < 0 || h < r)) r = h;
		}
		if (r >= 0) return r;
		return page.tail.indexOf(q) !== -1 ? 4 : -1;
	}

	/* Several words: all of them must be found, and the grade is the worst of
	   them — a line is as good as the most awkward word sat in it. */
	function score(page, words) {
		var worst = 0;
		for (var i = 0; i < words.length; i++) {
			var r = rank(page, words[i]);
			if (r < 0) return -1;
			if (r > worst) worst = r;
		}
		return worst;
	}

	// The last tie-break is the name, in natural order: otherwise the chapters
	// of a book come out 8, 21, 31, 6, 3 — in whatever order the builder
	// happened to walk them. `numeric` is what puts "chapter 2" before
	// "chapter 10" rather than after it.
	var byName = new Intl.Collator('ru', { numeric: true }).compare;

	function pick(pages, query) {
		var words = fold(query).split(/\s+/).filter(function (w) { return w.length > 0; });
		if (!words.length) return [];
		var out = [];
		for (var i = 0; i < pages.length; i++) {
			var s = score(pages[i], words);
			if (s >= 0) out.push({ page: pages[i], s: s, i: i });
		}
		out.sort(function (a, b) {
			return a.s - b.s
				|| a.page.order - b.page.order
				|| a.page.depth - b.page.depth
				|| byName(a.page.title, b.page.title);
		});
		return out.slice(0, SHOWN).map(function (x) { return x.page; });
	}

	/* Everything `pick` needs, worked out once when the index arrives. Handed
	   out because a site's own checks want to try queries against the very
	   list the reader will be searching, and deriving it a second time by hand
	   is one more copy to drift.
	 *
	 * The landing page of a section is the shallowest page in it. Taking the
	 * top level of the address instead would be simpler and is wrong as soon
	 * as a section lives deeper than that — a book at `/b/mctb2/` is as much a
	 * section as `/links/` is. Where several pages tie for shallowest, they
	 * all count: a section with two front doors has two.
	 *
	 * Except where the section is a leftover. A builder walking a site matches
	 * each page against a list of sections and has to put the unmatched ones
	 * somewhere; that somewhere is a name the author did choose ("Институт",
	 * "Home") holding pages nobody assigned. The name is a real name and stays
	 * searchable — this is not about the name. The membership is an accident,
	 * and calling the shallowest accident a front door is a guess. Today it
	 * lands on `/` and looks right; the day `/` moves or drops out of the
	 * index, the door to the section becomes whatever happened to be next —
	 * the search page, say. So a page says `fallback` when its section is that
	 * bucket, and a bucket has no door. */
	/* A language, cut to what two of them can be compared by: `<html lang>` is
	   a full tag — "en-US" — and an index may carry either form. Both ends are
	   cut in one place, so neither has to know which form the other uses. The
	   engine cuts its own the same way, for the same reason. */
	function tongue(s) {
		return (s || '').slice(0, 2).toLowerCase() || null;
	}

	/* --- what the palette says about itself --------------------------------
	 *
	 * In the language the reader is reading in — the same `lang` by which the
	 * names in the list were chosen. A palette that offers English pages and
	 * calls them «Разделы» has translated the half nobody sees.
	 *
	 * A language the table does not hold falls back to Russian: that is what
	 * every page got before there was a table. Adding a language is adding a
	 * column, and nothing else — no call site below names one.
	 *
	 * `label` and `placeholder` are here as defaults only. A site that knows
	 * what it holds says something better than either («например: Тантралока,
	 * словарь, паруса») and hands it in by attribute, in its own language.
	 */
	var SAY = {
		ru: {
			list: 'Разделы',
			onward: function (where) { return ' Полный поиск по тексту — на ' + where; },
			none: 'Ничего не нашлось.',
			coming: 'Указатель ещё едет…',
			start: 'Начните вводить название раздела или страницы.',
			toText: 'Ничего не нашлось по названиям. Ищу по тексту…',
			broken: 'Указатель не загрузился.',
			tip: function (label, combo) { return label + ' — ' + combo + ' или /'; },
			label: 'Быстрый переход по разделам',
			placeholder: 'Куда идём? Название раздела или страницы'
		},
		en: {
			list: 'Sections',
			onward: function (where) { return ' Full search of the text is at ' + where; },
			none: 'Nothing found.',
			coming: 'The index is still on its way…',
			start: 'Start typing the name of a section or a page.',
			toText: 'No name matches that. Looking through the text…',
			broken: 'The index would not load.',
			tip: function (label, combo) { return label + ' — ' + combo + ' or /'; },
			label: 'Jump to a section',
			placeholder: 'Where to? The name of a section or a page'
		},
		uk: {
			list: 'Розділи',
			onward: function (where) { return ' Повний пошук за текстом — на ' + where; },
			none: 'Нічого не знайшлося.',
			coming: 'Покажчик ще їде…',
			start: 'Почніть вводити назву розділу або сторінки.',
			toText: 'Жодна назва не збігається. Шукаю в тексті…',
			broken: 'Покажчик не завантажився.',
			tip: function (label, combo) { return label + ' — ' + combo + ' або /'; },
			label: 'Перехід до розділу',
			placeholder: 'Куди йдемо? Назва розділу або сторінки'
		}
	};

	function prepare(list, lang) {
		/* A site whose pages come in two languages lists both, and the reader
		   wants the one they are reading in — the other would be the same page
		   under a name they cannot type. A page that names no language belongs
		   to everybody: a book with no translation is better reached in the
		   language it was written in than not reachable at all. Say no language
		   and nothing is filtered, which is what an older index gets. */
		lang = tongue(lang);
		if (lang) {
			list = list.filter(function (p) { return !p.lang || tongue(p.lang) === lang; });
		}
		var shallowest = {};
		var pages = list.map(function (p) {
			var deep = p.url.split('/').filter(Boolean).length;
			if (p.section && !p.fallback && (shallowest[p.section] === undefined || deep < shallowest[p.section])) {
				shallowest[p.section] = deep;
			}
			return {
				url: p.url, title: p.title, section: p.section, order: p.order || 0,
				// Set by the builder when it put this page in a section by
				// default rather than by the list. Absent index, absent field —
				// nothing changes for a site that does not say.
				fallback: !!p.fallback,
				fold: fold(p.title),
				// How deep the page sits: "/ksh/ta/" is two segments,
				// "/ksh/ta/glossary/" is three.
				depth: deep,
				// The tail is what finds a page in the second instance: its
				// address and the name of its section. "моне" finds /art/monet/,
				// which has no title of its own at all.
				tail: fold(p.url + ' ' + (p.section || ''))
			};
		});
		pages.forEach(function (p) {
			p.home = p.section && !p.fallback && p.depth === shallowest[p.section] ? fold(p.section) : null;
		});
		return pages;
	}

	/* --- highlighting -----------------------------------------------------
	 *
	 * The fold does not keep the length of the string («ш» is one letter and
	 * `s` is one too, but «ю» becomes two), so a place in the folded text
	 * cannot be turned back into a place in the title directly. Fold the title
	 * letter by letter and remember where each piece came from — the same
	 * trick the search uses.
	 */
	function foldMap(s) {
		var out = '', map = [], n = s.length;
		for (var i = 0; i < n; i++) {
			var piece = fold(s.charAt(i));
			// The pair «дж» and the soft sign depend on their neighbours and
			// cannot be folded letter by letter. For highlighting it makes no
			// difference: the place is the same either way.
			out += piece;
			for (var k = 0; k < piece.length; k++) map.push(i);
		}
		map.push(n);
		return { text: out, map: map };
	}

	function mark(title, words) {
		var fm = foldMap(title), spans = [];
		words.forEach(function (w) {
			var at = fm.text.indexOf(w);
			if (at !== -1) spans.push([fm.map[at], fm.map[at + w.length]]);
		});
		if (!spans.length) return document.createTextNode(title);
		spans.sort(function (a, b) { return a[0] - b[0]; });
		var frag = document.createDocumentFragment(), pos = 0;
		spans.forEach(function (s) {
			if (s[0] < pos) return;
			frag.appendChild(document.createTextNode(title.slice(pos, s[0])));
			var b = document.createElement('mark');
			b.appendChild(document.createTextNode(title.slice(s[0], s[1])));
			frag.appendChild(b);
			pos = s[1];
		});
		frag.appendChild(document.createTextNode(title.slice(pos)));
		return frag;
	}

	/* --- the index -------------------------------------------------------- */

	var conf = null, pages = null, loading = null;

	function load() {
		if (pages) return Promise.resolve(pages);
		if (loading) return loading;
		loading = fetch(conf.index).then(function (r) {
			if (!r.ok) throw new Error(r.status);
			return r.json();
		}).then(function (data) {
			pages = prepare(data.pages || [], conf.lang);
			return pages;
		}).catch(function () {
			loading = null;
			return null;
		});
		return loading;
	}

	/* --- the palette itself ------------------------------------------------ */

	var box, input, list, note_, trigger = null, items = [], at = -1, opener = null;

	/* Defaults live in custom properties so that a site can hand the palette
	   its own colours without having to out-specify anything: the dark values
	   below are what a site gets for saying nothing.
	 *
	 * The stylesheet goes in as the first thing in <head>, before the site's
	 * own, so that the site's rules win every tie. Appending it at the end —
	 * the obvious thing, and what this did first — quietly made the defaults
	 * unbeatable by an ordinary `#nav-palette { --p-bg: … }` in a stylesheet
	 * the page had loaded long before. */
	function styles() {
		var css = [
			'#nav-palette,#nav-open{--p-bg:#1a1d24;--p-fg:#e6e6e6;',
			'--p-line:rgba(128,128,128,.4);--p-sel:rgba(128,128,160,.28);',
			'--p-mark:#8be9fd;--p-veil:rgba(0,0,0,.55)}',
			'#nav-palette{position:fixed;inset:0;z-index:9999;display:none;',
			'background:var(--p-veil);padding:8vh 1rem 1rem}',
			'#nav-palette.on{display:block}',
			'#nav-box{max-width:34rem;margin:0 auto;background:var(--p-bg);color:var(--p-fg);',
			'border:1px solid var(--p-line);border-radius:.5rem;overflow:hidden;',
			'box-shadow:0 1.5rem 3rem rgba(0,0,0,.5)}',
			'#nav-q{width:100%;box-sizing:border-box;border:0;border-bottom:1px solid var(--p-line);',
			'background:transparent;color:inherit;font:inherit;font-size:1.05rem;padding:.7em .9em;outline:none}',
			'#nav-list{list-style:none;margin:0;padding:.25rem;max-height:52vh;overflow-y:auto}',
			'#nav-list li{padding:.4em .65em;border-radius:.35rem;cursor:pointer;display:flex;',
			'gap:.6em;align-items:baseline}',
			'#nav-list li[aria-selected="true"]{background:var(--p-sel)}',
			'#nav-list .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'#nav-list .s{font-size:.8em;opacity:.55;white-space:nowrap}',
			'#nav-list mark{background:transparent;color:var(--p-mark);font-weight:600}',
			/* Rows drawn by search.js, when a query fell through to the text:
			   a trail saying where it comes from, and the words found under it.
			   Two lines, not two columns — a paragraph does not fit on one. */
			'#nav-list.text li{display:block}',
			'#nav-list.text .where{font-size:.8em;opacity:.6;margin:0 0 .15em}',
			'#nav-list.text .snippet{margin:0;font-size:.9em;line-height:1.4;',
			'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
			'#nav-list.text a{color:inherit;text-decoration:none}',
			'#nav-note{padding:.5em .9em;font-size:.85em;opacity:.6;margin:0}',
			'#nav-open{background:none;color:inherit;border:1px solid var(--p-line);',
			'border-radius:999px;cursor:pointer;font:inherit;font-size:.8rem;line-height:1;',
			'padding:.4em .7em;opacity:.6}',
			'#nav-open:hover,#nav-open:focus{opacity:1}',
			'#nav-open kbd{font:inherit;opacity:.75}',
			/* The hint is the palette's own rather than a `title`: the system
			   one surfaces after a second, and on a touch screen never. */
			'#nav-open{position:relative}',
			'#nav-open::after{content:attr(data-tip);position:absolute;right:0;top:110%;',
			'white-space:nowrap;background:var(--p-bg);color:var(--p-fg);',
			'border:1px solid var(--p-line);border-radius:.35rem;padding:.35em .6em;',
			'font-size:.75rem;opacity:0;pointer-events:none;transition:opacity .12s;z-index:10}',
			'#nav-open:hover::after,#nav-open:focus::after{opacity:1}',
			/* No place was named to put the button, or nothing answered to the
			   name: it hangs in the corner of the window instead, so that "on
			   every page" stays a promise rather than a hope. */
			'#nav-open.float{position:fixed;top:.6rem;right:.6rem;z-index:9998;',
			'background:var(--p-bg);color:var(--p-fg)}',
			'@media (max-width:640px){#nav-open::after{display:none}}',
			'@media print{#nav-open,#nav-palette{display:none!important}}'
		].join('');
		var el = document.createElement('style');
		el.appendChild(document.createTextNode(css));
		document.head.insertBefore(el, document.head.firstChild);
	}

	function build() {
		box = document.createElement('div');
		box.id = 'nav-palette';
		box.setAttribute('role', 'dialog');
		box.setAttribute('aria-modal', 'true');
		box.setAttribute('aria-label', conf.label);
		box.innerHTML =
			'<div id="nav-box">' +
			'<input id="nav-q" type="search" autocomplete="off" spellcheck="false" ' +
			'role="combobox" aria-expanded="true" aria-controls="nav-list" />' +
			'<ul id="nav-list" role="listbox"></ul>' +
			'<p id="nav-note"></p></div>';
		document.body.appendChild(box);
		input = box.querySelector('#nav-q');
		list = box.querySelector('#nav-list');
		note_ = box.querySelector('#nav-note');
		list.setAttribute('aria-label', conf.say.list);
		input.placeholder = conf.placeholder;

		box.addEventListener('mousedown', function (e) {
			if (e.target === box) close();
		});
		input.addEventListener('input', function () { render(input.value); });
		input.addEventListener('keydown', keys);
		list.addEventListener('mousedown', function (e) {
			var li = e.target.closest('li');
			if (li && li.dataset.url) { e.preventDefault(); go(li.dataset.url); }
		});
	}

	function note(text) {
		note_.textContent = text;
		note_.style.display = text ? '' : 'none';
	}

	// Where to send somebody the palette could not help: named only if the
	// site has such a page at all.
	function elsewhere(lead) {
		return conf.search ? lead + conf.say.onward(conf.search) : lead;
	}

	/* --- through to the text of the site -----------------------------------
	 *
	 * The palette holds the names of pages and nothing else, and that is the
	 * bargain it was built on: two kilobytes on every page instead of ninety.
	 * But a query the names cannot match is not the same as a query the site
	 * cannot answer. «камень» is the name of nothing here and the name of a
	 * book listed on one of the pages.
	 *
	 * So instead of handing the reader their question back with directions,
	 * the question goes on to the full search, in the same list, without
	 * leaving the page. The heavy index is fetched at that moment and not
	 * before: a reader who finds what they came for by name never pays for it,
	 * which is the whole reason the two indexes are separate.
	 *
	 * Searching is search.js's job and stays there. What happens here is only
	 * the handover: load it once, hold a field of its own for it to read the
	 * query from, and take the rows it draws back under the palette's own
	 * keyboard.
	 */
	var engine = null, engineTried = false, feed = null, mode = null;

	function bringEngine() {
		if (engineTried) return;
		engineTried = true;
		if (global.SiteSearch) { startEngine(); return; }
		if (!conf.engine) { engine = false; return; }
		var s = document.createElement('script');
		s.src = conf.engine;
		s.onload = function () {
			if (global.SiteSearch) { startEngine(); if (mode === 'text') ask(input.value.trim()); }
			else { engine = false; note(elsewhere(conf.say.none)); }
		};
		s.onerror = function () { engine = false; note(elsewhere(conf.say.none)); };
		document.head.appendChild(s);
	}

	function startEngine() {
		// A field of its own, outside the document: search.js reads the query
		// from it when a chunk of text lands and the answer has to be redrawn.
		// Handing it the palette's own field instead would set it searching on
		// every keystroke, and the heavy index would be fetched by anybody who
		// so much as opened the palette.
		feed = document.createElement('input');
		engine = global.SiteSearch.mount({
			input: feed,
			status: note_,
			results: list,
			sources: [{ url: conf.searchIndex, precompressed: conf.searchPrecompressed }],
			address: false,     // this is somebody else's page
			more: false,        // the list scrolls; there is nowhere to put a button
			onRender: adopt
		});
	}

	/* The rows are search.js's, the keyboard is the palette's. Each row is
	   given what `select` and `go` need — an id, a role, an address taken from
	   the link inside it — and the reader's place in the list is kept across
	   redraws, so that text arriving in the background does not throw them
	   back to the top mid-choice. */
	function adopt() {
		var was = at;
		items = [];
		at = -1;
		var rows = list.children;
		for (var i = 0; i < rows.length; i++) {
			var a = rows[i].querySelector('a[href]');
			if (!a) continue;
			rows[i].id = 'nav-i' + items.length;
			rows[i].setAttribute('role', 'option');
			rows[i].dataset.url = a.getAttribute('href');
			items.push(rows[i]);
		}
		if (items.length) select(was > 0 && was < items.length ? was : 0);
		else if (conf.search) {
			// The text did not have it either. search.js says so in its own
			// words; the way onward is the palette's to add, and it is the same
			// way it would have offered had it never looked. Safe to append on
			// every draw: the line is written afresh each time, just above.
			note_.textContent = elsewhere(note_.textContent || conf.say.none);
		}
		// An empty line of its own is still a line, and it shows as a gap.
		note_.style.display = note_.textContent ? '' : 'none';
	}

	function ask(q) {
		if (!engine) return;
		feed.value = q;
		engine.render(q);
	}

	function render(query) {
		list.textContent = '';
		items = [];
		at = -1;
		var q = query.trim();
		if (!pages) { mode = null; list.className = ''; note(conf.say.coming); return; }
		if (!q) { mode = null; list.className = ''; note(conf.say.start); return; }
		var found = pick(pages, q);
		if (!found.length) {
			if (!conf.searchIndex) { mode = null; list.className = ''; note(elsewhere(conf.say.none)); return; }
			// The list is laid out differently for text: a name is one line,
			// a paragraph is a trail with the words found under it.
			mode = 'text';
			list.className = 'text';
			if (engine === null) { note(conf.say.toText); bringEngine(); return; }
			if (engine === false) { note(elsewhere(conf.say.none)); return; }
			ask(q);
			return;
		}
		mode = 'names';
		list.className = '';
		note('');
		var words = fold(q).split(/\s+/).filter(function (w) { return w.length > 0; });
		found.forEach(function (p, i) {
			var li = document.createElement('li');
			li.id = 'nav-i' + i;
			li.setAttribute('role', 'option');
			li.dataset.url = p.url;
			var t = document.createElement('span');
			t.className = 't';
			t.appendChild(mark(p.title, words));
			var s = document.createElement('span');
			s.className = 's';
			s.textContent = p.section || '';
			li.appendChild(t);
			li.appendChild(s);
			list.appendChild(li);
			items.push(li);
		});
		select(0);
	}

	function select(i) {
		if (!items.length) return;
		if (at >= 0 && items[at]) items[at].setAttribute('aria-selected', 'false');
		at = (i + items.length) % items.length;
		items[at].setAttribute('aria-selected', 'true');
		input.setAttribute('aria-activedescendant', items[at].id);
		var li = items[at], top = li.offsetTop, bottom = top + li.offsetHeight;
		if (top < list.scrollTop) list.scrollTop = top;
		else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
	}

	function keys(e) {
		if (e.key === 'ArrowDown') { e.preventDefault(); select(at + 1); }
		else if (e.key === 'ArrowUp') { e.preventDefault(); select(at - 1); }
		else if (e.key === 'Enter') {
			e.preventDefault();
			if (items[at]) go(items[at].dataset.url);
		}
		else if (e.key === 'Escape') { e.preventDefault(); close(); }
		else if (e.key === 'Tab') e.preventDefault();   // focus stays in the palette
	}

	function go(url) {
		close();
		location.href = url;
	}

	function open() {
		if (!box) build();
		opener = document.activeElement;
		box.classList.add('on');
		input.value = '';
		render('');
		input.focus();
		load().then(function (ok) {
			if (!box.classList.contains('on')) return;
			if (!ok) { note(elsewhere(conf.say.broken)); return; }
			render(input.value);
		});
	}

	function close() {
		if (!box) return;
		box.classList.remove('on');
		// Focus is taken out of the palette without fail: once it is closed the
		// palette is hidden, and focus left inside it is focus nowhere. It goes
		// back where the palette was opened from — but it may have been opened
		// from `body` (a mouse click does not focus the button, and the
		// shortcut is caught on the document), and then the place for it is the
		// button, which is the door to the palette.
		if (input) input.blur();
		var back = opener && opener.focus && opener !== document.body ? opener : trigger;
		if (back && back.focus) back.focus();
		opener = null;
	}

	function isOpen() {
		return box && box.classList.contains('on');
	}

	/* --- the shortcut -----------------------------------------------------
	 *
	 * ⌘K on macOS, Ctrl-K on everything else. In Firefox Ctrl-K focuses the
	 * browser's search bar and in Chrome the address bar; preventDefault takes
	 * both off.
	 *
	 * The second shortcut is "/", as many sites have it: it costs nothing. But
	 * only while the reader is not writing — inside a field "/" is a slash.
	 */
	function typing(el) {
		if (!el) return false;
		var tag = el.tagName;
		return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
	}

	function shortcut(e) {
		if (isOpen()) return;
		if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
			e.preventDefault();
			open();
			return;
		}
		if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target)) {
			e.preventDefault();
			open();
		}
	}

	/* --- the button --------------------------------------------------------
	 *
	 * `mount` names where it goes; failing that it hangs in the corner of the
	 * window. Either way it is the same palette the shortcut opens: not
	 * everybody reads hints, and not everybody has a keyboard.
	 */
	function button() {
		var mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
		var combo = mac ? '⌘K' : 'Ctrl K';
		var b = document.createElement('button');
		b.id = 'nav-open';
		b.type = 'button';
		b.setAttribute('aria-label', conf.label);
		b.setAttribute('data-tip', conf.say.tip(conf.label, combo));
		b.appendChild(document.createTextNode('⌕ '));
		var k = document.createElement('kbd');
		k.appendChild(document.createTextNode(combo));
		b.appendChild(k);
		b.addEventListener('click', open);

		var host = conf.mount ? document.querySelector(conf.mount) : null;
		if (host) {
			host.appendChild(b);
		} else {
			b.className = 'float';
			document.body.appendChild(b);
		}
		trigger = b;
	}

	function run() {
		styles();
		button();
		document.addEventListener('keydown', shortcut);
		// The index is fetched when the browser is idle: by the first keypress
		// it is already here, and loading the page was not held up for it.
		var idle = window.requestIdleCallback || function (f) { setTimeout(f, 1200); };
		idle(function () { load(); });
	}

	/* `index` is the only setting without a default. `mount` is a selector for
	   where the button goes, `search` the address of the full-text search page
	   to point at when the palette comes up empty.
	 *
	 * `searchIndex` is what turns that dead end into an answer: given it, a
	 * query the names could not match is put to the text of the site instead,
	 * right here in the same list. It is a separate setting rather than
	 * something derived, because the whole point of the palette's own index is
	 * that it is not this one — this one is the heavy file, and it is fetched
	 * only when a reader has actually asked for something the names do not
	 * hold. `searchPrecompressed` says a `.br` sits beside it; `engine` is
	 * where search.js lives, and defaults to next door to this file. */
	function mount(opts) {
		if (conf) return;                       // one palette to a page
		// The page already declares its language, for the browser and for
		// search engines. Reading it here rather than asking a site to repeat
		// it keeps the two from falling out of step. It is read before `conf`
		// is built because two of the settings default to words in it.
		var lang = tongue(opts.lang !== undefined ? opts.lang
			: document.documentElement.getAttribute('lang'));
		var say_ = SAY[lang] || SAY.ru;
		conf = {
			index: opts.index,
			mount: opts.mount || null,
			search: opts.search || null,
			searchIndex: opts.searchIndex || null,
			searchPrecompressed: !!opts.searchPrecompressed,
			engine: opts.engine || null,
			lang: lang,
			say: say_,
			label: opts.label || say_.label,
			placeholder: opts.placeholder || say_.placeholder
		};
		// The document has to be built before the button has anywhere to go,
		// and a deferred script runs before DOMContentLoaded rather than after
		// it. `load` is the belt to that braces: a script attached later still
		// starts, instead of waiting for an event that has already been and
		// gone.
		var started = false;
		function once() {
			if (started) return;
			started = true;
			run();
		}
		if (document.readyState === 'complete') once();
		else {
			document.addEventListener('DOMContentLoaded', once);
			window.addEventListener('load', once);
		}
	}

	global.SitePalette = {
		mount: mount, open: open, fold: fold, prepare: prepare, pick: pick,
		say: SAY
	};

	// Attached with a tag and configured by its attributes — the whole of the
	// setup for a site that has no JavaScript of its own to put it in.
	if (typeof document !== 'undefined' && document.currentScript) {
		var d = document.currentScript.dataset;
		// Where this very file came from, so that its neighbour can be found
		// without the site having to say twice where the pair lives.
		var here = document.currentScript.src;
		if (d.index) {
			mount({
				index: d.index, mount: d.mount, search: d.search,
				searchIndex: d.searchIndex,
				searchPrecompressed: d.searchPrecompressed === 'true',
				engine: d.engine || (here ? here.replace(/[^/]*$/, 'search.js') : null),
				label: d.label, placeholder: d.placeholder
			});
		}
	}
})(typeof globalThis !== 'undefined' ? globalThis : window);

// Node reads this file for the fold and the picking; nothing above touches the
// document until `mount` is called.
if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.SitePalette;
