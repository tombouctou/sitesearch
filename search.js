/* Search a static site, entirely in the browser.
 *
 * A page hands over the nodes for the search box, the status line and the list
 * of results, and names the indexes to search:
 *
 *     SiteSearch.mount({
 *         input: 'q', status: 'status', results: 'results',
 *         sources: [{ url: '/search-index.json' }],
 *     });
 *
 * An index is static JSON, built beforehand; its contract is in FORMAT.md and
 * is the same for every builder. Where the text came from — an HTML tree,
 * Jekyll pages, something else again — is unknown here and not wanted: a page,
 * its name, the pieces of text on it.
 *
 * An index may name further indexes in its own `shards`, to be searched
 * alongside it — so the builder decides what the site is made of rather than
 * every search page restating it. A source marked `defer` is not fetched until
 * somebody searches: a megabyte of book has no business travelling to someone
 * who is only passing through.
 *
 * Results come in the order given by the `order` of the source and the page,
 * and within a page by the order of its blocks. Nothing here scores relevance:
 * on a site this size the order of the shelves is more useful than a guess at
 * which paragraph is the best one.
 */
(function (global) {
	'use strict';

	/* Case, "ё" and diacritics are folded on both sides: the searcher types
	   "rangapuja" where the text has "raṅgapūjā". NFD splits a letter into a
	   base and a mark, and the mark is thrown away.

	   The same fold also carries Cyrillic across to Latin, because on a site
	   about Sanskrit one word is written both ways — `śaktipāta` in one
	   chapter, «шактипата» in the next — and to the reader that is one word.
	   Cyrillic goes to Latin rather than the other way about because only this
	   direction is a function: «ш» is always `ś`, but `s` may be «с», «ш» or
	   «щ», and a fold that has to guess is not a fold.

	   The table is the ordinary Russian rendering of Sanskrit — «ш»→ś, «щ»→ṣ,
	   «ч»→c, «дж»→j — after which the diacritics are thrown away on both
	   sides, so both spellings meet at the same bare letters. Three of the
	   rules need to look around them:

	   * «дж» is one sound, j, and the pair is read before the «д» alone;
	   * «ь» (and «ъ») before a soft vowel is the glide y — «натья» is `nāṭya`
	     — and silent everywhere else;
	   * «я» and «ю» carry that same glide themselves at the start of a word
	     and after a vowel («яма» → `yama`), but after a consonant they only
	     soften it, and the vowel is bare: «джняна» → `jñāna`.

	   Russian writes the vowel ṛ as «ри», so ṛ folds to "ri" and the two meet
	   there: «нритта» and `nṛtta` both become "nritta".

	   The fold therefore no longer keeps the length of the string, and the
	   highlighting of matches cannot rest on that any more; `foldMap` hands
	   back, along with the folded text, where each of its letters came from.

	   Anything that is neither Latin nor Cyrillic — Devanagari, digits,
	   punctuation — passes through untouched. */
	var CYRILLIC = {
		'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e',
		'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
		'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
		'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'c', 'ш': 's', 'щ': 's', 'ъ': '',
		'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'u', 'я': 'a'
	};
	var VOWEL = /[аеёиоуыэюя]/;   // after one of these «я» and «ю» keep the glide
	var GLIDED = /[яюеёи]/;       // after «ь» one of these makes the glide sound
	var MARK = /[̀-ͯ]/g;
	var VOCALIC = { 'ṛ': 'ri', 'ṝ': 'ri', 'Ṛ': 'ri', 'Ṝ': 'ri' };

	/* The folded text, and for every letter of it the place in the original it
	   was folded from — one more entry at the end for the end of the string.
	   Only the highlighting needs the second half, so the map is built on
	   request: it costs an array as long as the text, and the text of a site
	   is folded whole on the first query. */
	function foldMap(s, want) {
		var out = '', map = want ? [] : null, n = s.length;
		for (var i = 0; i < n; i++) {
			var c = s.charAt(i).toLowerCase(), took = 1, piece;
			if (VOCALIC[c] !== undefined) piece = VOCALIC[c];
			else if (c === 'д' && s.charAt(i + 1).toLowerCase() === 'ж') { piece = 'j'; took = 2; }
			else if (c === 'ь' || c === 'ъ') piece = GLIDED.test(s.charAt(i + 1).toLowerCase()) ? 'y' : '';
			else if (c === 'я' || c === 'ю') {
				// The glide is dropped only after a Cyrillic consonant. A space
				// or a hyphen before the letter means a word begins there, and
				// a word begins with the glide: «кальпа юга» is `yuga`, not
				// "uga". Testing for the start of the string instead — which is
				// what this did — left every Russian word beginning in «я» or
				// «ю» indexed without it, findable by no query at all.
				var before = i > 0 ? s.charAt(i - 1).toLowerCase() : '';
				var after = CYRILLIC[before] !== undefined && !VOWEL.test(before);
				piece = after ? CYRILLIC[c] : (c === 'я' ? 'ya' : 'yu');
			}
			else if (CYRILLIC[c] !== undefined) piece = CYRILLIC[c];
			else piece = c.normalize('NFD').replace(MARK, '');
			out += piece;
			if (map) for (var k = 0; k < piece.length; k++) map.push(i);
			i += took - 1;
		}
		if (!map) return out;
		map.push(n);
		return { text: out, map: map };
	}

	function norm(s) {
		return foldMap(s, false);
	}

	/* A match begins where a word begins. Otherwise «страх» (fear) is
	   shortened to a stem that also sits inside «от·стра·нение»
	   (detachment) — on the text of a book that was a hundred paragraphs of
	   rubbish out of two hundred and forty. */
	var LETTER = /[a-zа-я0-9]/;

	function occurrence(haystack, t, from) {
		var at = haystack.indexOf(t, from);
		while (at !== -1) {
			if (at === 0 || !LETTER.test(haystack.charAt(at - 1))) return at;
			at = haystack.indexOf(t, at + 1);
		}
		return -1;
	}

	/* Russian changes its endings, and «тело» has to find «тела». Half the
	   work is done by matching from the start of a word: when the text has more
	   letters than the query there is nothing to do — «джхана» already finds
	   «джханами». What is left is the opposite case, the spare letters being in
	   the query, and in Russian that means a trailing vowel or a soft sign:
	   «тело» must lose its «о». Hence a short ladder — the word, then up to two
	   endings cut off, but never below three letters.

	   Cutting deeper is exactly what this engine used to do (four letters off
	   any word), and exactly why «страх» (fear) used to find «страдание»
	   (suffering). It also shows why a list of endings will not serve: «страх»
	   ends in «ах» and would be cut back to «стр».

	   The rungs are cut off the folded word, so the vowels here are the Latin
	   ones the fold leaves behind: «ю» arrives as "u", «я» as "a", and «ь» has
	   already gone. Which ladder to climb is decided by the word as it was
	   typed, not as it was folded — after the fold every Russian word looks
	   like a Latin one, and the English rule would then cut «голос» down to
	   "golo". */
	var SOFT = /[aeiouy]$/;
	var PLURAL = /[a-z]{4,}s$/;

	/* Cyrillic writes the vowel ṛ as «ри» and the fold follows it there, so
	   `nṛtta` and «нритта» meet at "nritta". Somebody who strips the diacritics
	   by hand writes neither, but "nrtta" — so a query is offered that spelling
	   too, an "i" put back after every "r" that has no vowel of its own. This
	   is one extra candidate, tried after the word as it was typed: an exact
	   match always wins. */
	function vocalic(t) {
		var v = t.replace(/r(?![aeiou])/g, 'ri');
		return v === t ? null : v;
	}

	function rungs(t) {
		var v = [t];
		var s = t;
		for (var i = 0; i < 2 && s.length > 3 && SOFT.test(s); i++) {
			s = s.slice(0, -1);
			v.push(s);
		}
		return v;
	}

	function ladder(t, cyrillic) {
		// In English one "s" serves the purpose of the Russian endings.
		var v = !cyrillic && PLURAL.test(t) ? [t, t.slice(0, -1)] : rungs(t);
		var also = vocalic(t);
		if (also) v = v.concat(rungs(also));
		return v;
	}

	var CYR_WORD = /[а-яё]/i;

	function raw(q) {
		return q.normalize('NFC').split(/\s+/).filter(function (t) { return t.length > 0; });
	}

	function words(q) {
		return raw(q).map(norm).filter(function (t) { return t.length > 0; });
	}

	function terms(q) {
		return raw(q).map(function (w) {
			return ladder(norm(w), CYR_WORD.test(w));
		}).filter(function (v) { return v[0].length > 0; });
	}

	// The longest candidate actually present, or null if none is.
	function present(haystack, variants) {
		for (var i = 0; i < variants.length; i++) {
			if (occurrence(haystack, variants[i], 0) !== -1) return variants[i];
		}
		return null;
	}

	function matches(haystack, ts) {
		return ts.every(function (variants) { return present(haystack, variants) !== null; });
	}

	// Positions of every term occurrence, so all of them get highlighted. The
	// match is only the beginning of the word, but the whole word is what the
	// eye is looking for: «тело» highlights «тела», not «тел»а.
	function hits(haystack, ts) {
		var out = [];
		ts.forEach(function (variants) {
			var t = present(haystack, variants);
			if (!t) return;
			var from = 0, at;
			while ((at = occurrence(haystack, t, from)) !== -1) {
				var end = at + t.length;
				while (end < haystack.length && LETTER.test(haystack.charAt(end))) end++;
				out.push([at, end]);
				from = end;
			}
		});
		return out.sort(function (a, b) { return a[0] - b[0]; });
	}

	/* How many letters have to change to turn one word into the other, given
	   up as soon as it is plain the answer is over `max`. The bound is what
	   makes this affordable across a whole site: words whose lengths differ by
	   more than `max` are thrown out before any work at all, and of the matrix
	   only a band of 2·max+1 cells around the diagonal can ever hold a
	   distance that small. A row whose every cell is already over the bound
	   ends it — row minima never fall as the matrix is filled. */
	function edits(a, b, max) {
		if (Math.abs(a.length - b.length) > max) return max + 1;
		var prev = [], cur = [], i, j;
		for (j = 0; j <= b.length; j++) prev[j] = j;
		for (i = 1; i <= a.length; i++) {
			var lo = Math.max(1, i - max), hi = Math.min(b.length, i + max);
			var least = cur[0] = i;
			for (j = 1; j < lo; j++) cur[j] = max + 1;
			for (j = lo; j <= hi; j++) {
				var same = a.charAt(i - 1) === b.charAt(j - 1);
				cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (same ? 0 : 1));
				if (cur[j] < least) least = cur[j];
			}
			for (j = hi + 1; j <= b.length; j++) cur[j] = max + 1;
			if (least > max) return max + 1;
			var swap = prev; prev = cur; cur = swap;
		}
		return prev[b.length];
	}

	/* A word as the text itself writes it, looked up by the folded beginning
	   of it. Everything the engine knows a word by is folded — "saktipata" —
	   and that spelling stands nowhere on the site: one chapter writes
	   `śaktipāta` and the next «шактипата». So when the results have to be
	   named by the word they were found by, the word is taken back out of the
	   very text they came from, whole: `hits` runs a match on to the end of
	   its word, and the map carries the edges home. */
	function form(text, t) {
		var f = foldMap(text, true);
		var spans = hits(f.text, [[t]]);
		if (!spans.length) return null;
		// The paragraph may hold the word alone and hold it inside a longer
		// one — `śaktipāta` and `śaktipātataḥ` — and the shorter is the one
		// that was asked about. Where the text has nothing but the longer, the
		// longer is what it says, and it is named as it stands: half a word,
		// cut at the length of the query, would be a spelling of nobody's.
		var pick = spans[0];
		for (var i = 0; i < spans.length; i++) {
			if (f.text.slice(spans[i][0], spans[i][1]) === t) { pick = spans[i]; break; }
		}
		return text.slice(f.map[pick[0]], f.map[pick[1]]);
	}

	// Words as the two-tier builder counts them (node/two-tier.js), for a flat
	// index that carries no list of its own.
	var WORDS = /[a-zа-я0-9]+/g;

	function tally(into, text) {
		var m;
		WORDS.lastIndex = 0;
		while ((m = WORDS.exec(text))) into[m[0]] = (into[m[0]] || 0) + 1;
	}

	/* Build the snippet as text nodes + <mark>, never as HTML.

	   The window and the matches inside it are worked out on the folded text
	   and only then carried back to the original, because the two no longer
	   agree letter for letter: «шактипата» is nine letters and folds to nine,
	   but «натья» is five and folds to six. What is shown has to be the text
	   as it stands — a reader searching in Cyrillic for a word written in IAST
	   must see the IAST — so every edge is folded-side arithmetic first and
	   `map` afterwards. */
	function snippet(text, ts) {
		var f = foldMap(text, true), hay = f.text;
		var spans = hits(hay, ts);
		var frag = document.createDocumentFragment();
		if (!spans.length) {
			// The term matched the section heading rather than the paragraph
			// itself, so just show the opening, cut on a word boundary.
			if (text.length <= 220) {
				frag.appendChild(document.createTextNode(text));
				return frag;
			}
			var cut = text.lastIndexOf(' ', 220);
			frag.appendChild(document.createTextNode(text.slice(0, cut > 0 ? cut : 220) + '…'));
			return frag;
		}

		var WINDOW = 240;
		var start = Math.max(0, spans[0][0] - 60);
		// Don't cut a word in half at the left edge.
		if (start > 0) {
			var space = hay.indexOf(' ', start);
			if (space !== -1 && space - start < 20) start = space + 1;
		}
		var end = Math.min(hay.length, start + WINDOW);
		// And at the right edge too: a word caught on the window's boundary
		// would otherwise be highlighted as a stub — «джх» for «джханы».
		while (end < hay.length && LETTER.test(hay.charAt(end))) end++;

		var head = f.map[start], tail = f.map[end];
		var cursor = head;
		if (start > 0) frag.appendChild(document.createTextNode('…'));

		spans.forEach(function (s) {
			var from = f.map[s[0]], to = f.map[s[1]];
			if (to <= cursor || from >= tail) return;
			if (from > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, from)));
			// Two words of the query can cover one word of the text; the second
			// then begins before the first has ended, and what is already
			// written must not be written again.
			var m = document.createElement('mark');
			m.textContent = text.slice(Math.max(from, cursor), Math.min(to, tail));
			frag.appendChild(m);
			cursor = Math.min(to, tail);
		});

		if (cursor < tail) frag.appendChild(document.createTextNode(text.slice(cursor, tail)));
		if (end < hay.length) frag.appendChild(document.createTextNode('…'));
		return frag;
	}

	/* --- what the search says about itself ---------------------------------
	 *
	 * The reader is told how the search went in the language they are reading
	 * in — the same `lang` by which the results themselves were chosen. A page
	 * whose text is English and whose status line reads «Ничего не нашлось»
	 * is half a translation, and the half that shows is the half nobody did.
	 *
	 * A language the table does not hold falls back to Russian. That is what
	 * every page got when there was no table at all, and a site that has been
	 * reading these words for a year should not find them changed by the
	 * arrival of a column meant for somebody else. A third language is a third
	 * column here and nothing else: no call site names a language.
	 *
	 * Everything that counts goes in as a function, because counting is the
	 * language's own business — Russian has three plural forms, English two —
	 * and so does everything that puts a word inside a sentence.
	 */
	function plural(n, one, few, many) {
		var a = n % 100, b = n % 10;
		if (a > 10 && a < 20) return many;
		if (b === 1) return one;
		if (b >= 2 && b <= 4) return few;
		return many;
	}

	var SAY = {
		ru: {
			more: 'Показать ещё',
			page: 'Страница',
			hits: function (n) {
				return n + ' ' + plural(n, 'совпадение', 'совпадения', 'совпадений');
			},
			none: 'Ничего не нашлось.',
			notYet: 'Пока ничего не нашлось.',
			firstOf: function (n) { return ', показаны первые ' + n; },
			instead: function (w) {
				return 'такого слова в тексте нет, показано по «' + w + '»';
			},
			kin: 'точной формы в тексте нет, это однокоренные слова',
			loading: 'Загружаю указатель…',
			searching: 'ищу дальше…',
			reading: 'читаю дальше…',
			unread: 'прочитано не всё',
			broken: function (where) {
				return 'не удалось загрузить указатель' + (where ? ' (' + where + ')' : '');
			},
			holes: function (n) { return 'часть текста не загрузилась (' + n + ')'; }
		},
		en: {
			more: 'Show more',
			page: 'Page',
			hits: function (n) { return n + (n === 1 ? ' match' : ' matches'); },
			none: 'Nothing found.',
			notYet: 'Nothing found yet.',
			firstOf: function (n) { return ', first ' + n + ' shown'; },
			instead: function (w) {
				return 'no such word in the text, showing “' + w + '”';
			},
			kin: 'that exact form is not in the text, these share its root',
			loading: 'Fetching the index…',
			searching: 'still looking…',
			reading: 'still reading…',
			unread: 'not all of it read',
			broken: function (where) {
				return 'an index would not load' + (where ? ' (' + where + ')' : '');
			},
			holes: function (n) { return 'some of the text did not load (' + n + ')'; }
		},
		uk: {
			more: 'Показати ще',
			page: 'Сторінка',
			hits: function (n) {
				return n + ' ' + plural(n, 'збіг', 'збіги', 'збігів');
			},
			none: 'Нічого не знайшлося.',
			notYet: 'Поки нічого не знайшлося.',
			firstOf: function (n) { return ', показано перші ' + n; },
			instead: function (w) {
				return 'такого слова в тексті немає, показано за «' + w + '»';
			},
			kin: 'точної форми в тексті немає, це спільнокореневі слова',
			loading: 'Завантажую покажчик…',
			searching: 'шукаю далі…',
			reading: 'читаю далі…',
			unread: 'прочитано не все',
			broken: function (where) {
				return 'не вдалося завантажити покажчик' + (where ? ' (' + where + ')' : '');
			},
			holes: function (n) { return 'частина тексту не завантажилася (' + n + ')'; }
		}
	};

	/* A language, cut down to what two of them can be compared by. The reader's
	   arrives from <html lang>, where it is a full tag — "en-US", "ru-RU" — and
	   a page's arrives from whatever the builder was handed; "en-US" and "en"
	   are one language and must not fail to match over a region nobody meant to
	   speak of. Both ends are cut here, so neither builder nor page has to
	   remember which form the other uses. */
	function tongue(s) {
		return (s || '').slice(0, 2).toLowerCase() || null;
	}

	/* The unit of an index is a page: its address, its name, and the pieces of
	   text on it. A block with neither an anchor nor a heading above it may be
	   written as a plain string — shorter, and a Liquid template is spared a
	   thicket of braces. Beyond that the engine knows nothing of the source: an
	   HTML tree, Jekyll pages and anything else arrive here alike.

	   A source may name `section` and `order` for the whole batch at once —
	   that is how a book's search page labels all its chapters "Chapter"
	   without touching the index. Order still belongs to the page where the
	   page knows it: sections are listed in the builder, and there is nothing
	   here to argue with that. */
	function documentsOf(data, spec) {
		return (data.pages || []).map(function (p) {
			return {
				url: p.url,
				title: p.title,
				// The second name is searched equally with the first: a table of
				// contents shortens "3. Concentration: the second training".
				also: p.also || null,
				// Which language the page is written in, where a site keeps the
				// same page in several. Absent means "everybody's".
				lang: tongue(p.lang),
				section: called(spec) || p.section || null,
				order: typeof p.order === 'number' ? p.order : (spec.order || 0),
				blocks: (p.blocks || [])
					.map(function (b) { return typeof b === 'string' ? { text: b } : b; })
					.filter(function (b) { return b && b.text; }),
			};
		});
	}

	/* --- Two tiers ---------------------------------------------------------

	   Past a few hundred kilobytes the flat index stops paying for itself: a
	   reader who types one word downloads the whole site in order to be shown
	   ten paragraphs. A builder may then split it (node/two-tier.js) into a map
	   of words and the text behind it, and what arrives here first is the map
	   alone — a page's address and name, and for every word the chunks of text
	   that hold it.

	   The map is a filter and never an answer. A chunk it names is fetched and
	   then searched by the same `matches` that searches a flat index, so a
	   chunk that turns out to hold nothing costs one request and nothing else.
	   Results are decided by the text, here as there; the map only says where
	   not to look. */

	// Sorted words, each written as how much it shares with the one before it
	// and then the rest of itself.
	function decodeWords(s) {
		if (!s) return [];
		var raw = s.split('\n'), out = new Array(raw.length), prev = '';
		for (var i = 0; i < raw.length; i++) {
			prev = prev.slice(0, parseInt(raw[i].charAt(0), 36)) + raw[i].slice(1);
			out[i] = prev;
		}
		return out;
	}

	// The first word that is not less than t.
	function lowerBound(words, t) {
		var lo = 0, hi = words.length;
		while (lo < hi) {
			var mid = (lo + hi) >> 1;
			if (words[mid] < t) lo = mid + 1; else hi = mid;
		}
		return lo;
	}

	function startsWith(s, t) {
		return s.lastIndexOf(t, 0) === 0;
	}

	/* A paragraph standing word for word on many pages is a section's
	   furniture rather than its content: the "how to read these pages" aside,
	   the same table of contents again. In the results it drowns out the real
	   matches, repeating itself once for every page it stands on.

	   A builder holding the whole page cuts furniture away itself, by the
	   markup (see node/html.js). A Liquid builder has no means to: no regular
	   expressions there, and certainly no counting of repeats. The counting is
	   then left to the engine — `repeats: 4` drops a block met on four pages or
	   more. Below four it must not go: two or three identical paragraphs happen
	   in real text. The rule is off by default: where the builder cut the
	   furniture away, walking the index again serves nothing. */
	function dropRepeated(docs, threshold) {
		var n = Object.create(null);
		docs.forEach(function (doc) {
			var here = Object.create(null);
			doc.blocks.forEach(function (b) {
				if (b.text.length < 60 || here[b.text]) return;
				here[b.text] = 1;
				n[b.text] = (n[b.text] || 0) + 1;
			});
		});
		// A short block was never counted, so it has no tally — and it is kept.
		// Comparing an absent tally against the threshold reads false and
		// throws the block away: that is how this rule quietly ate every
		// paragraph under sixty characters on the site it was written for.
		docs.forEach(function (doc) {
			doc.blocks = doc.blocks.filter(function (b) { return (n[b.text] || 0) < threshold; });
		});
		return docs;
	}

	// A search that would print a thousand paragraphs prints the first
	// hundred and says so; nobody scrolls past that, and building the rest
	// costs a visible pause.
	var LIMIT = 100;

	function mount(opts) {
		var input = typeof opts.input === 'string' ? document.getElementById(opts.input) : opts.input;
		var status = typeof opts.status === 'string' ? document.getElementById(opts.status) : opts.status;
		var results = typeof opts.results === 'string' ? document.getElementById(opts.results) : opts.results;
		var showSection = opts.showSection !== false;
		var repeats = opts.repeats || 0;

		/* A search that is the page's own owns the address bar: the query
		   belongs in it, so that a result can be linked to and a reload comes
		   back to the same search. A search mounted inside something else —
		   the palette's dropdown, say — owns nothing of the sort: it sits on
		   somebody else's page, and rewriting that page's address as the
		   reader types would be a small theft. Hence `address: false`, which
		   also stops it from reading a `?q=` meant for the page proper. */
		var address = opts.address !== false;

		/* Which language the reader is reading in. Taken from the page itself
		   unless told otherwise, so that a site with translated pages needs to
		   say nothing at all: the page already declares its language, for the
		   browser and for search engines, and declaring it a second time is
		   one more thing to fall out of step. */
		var lang = tongue(opts.lang !== undefined ? opts.lang
			: document.documentElement.getAttribute('lang'));

		// The words this search says about itself, in that same language.
		// Picked once: a page does not change language under the reader.
		var say_ = SAY[lang] || SAY.ru;

		/* What a source calls the part of the site it holds. Its pages name
		   their own language and can therefore name their own section in it;
		   a source cannot, being one file serving every reader alike. So a
		   site that publishes in two languages writes the name in both, and
		   `section` stays the name for everybody else — including a reader
		   whose language nobody wrote down. */
		function called(spec) {
			return (spec.named && spec.named[lang]) || spec.section || null;
		}

		/* Reading stops before the end more often than not, so there has to be
		   a way to ask for the rest. The control sits outside the list: it is
		   not a result, and a list of results is no place to say so.
		 *
		 * It is built either way, because `render` speaks to it; `more: false`
		 * only keeps it out of the page, for a host that has no room for it. */
		var more = document.createElement('p');
		more.className = 'more';
		more.hidden = true;
		var button = document.createElement('button');
		button.type = 'button';
		button.textContent = say_.more;
		button.addEventListener('click', function () {
			reach += 3 * REACH;
			allowed += 2 * READ;
			render(input.value);
		});
		more.appendChild(button);
		if (opts.more !== false && results.parentNode) results.parentNode.insertBefore(more, results.nextSibling);

		var sources = [];

		function add(spec) {
			if (!spec || !spec.url) return;
			if (sources.some(function (s) { return s.spec.url === spec.url; })) return;
			sources.push({ spec: spec, docs: null, started: false, failed: false });
		}

		opts.sources.forEach(add);

		function json(url) {
			return fetch(url).then(function (r) {
				if (!r.ok) throw new Error(r.status);
				return r.json();
			});
		}

		/* The same index may sit next to itself, compressed beforehand: the
		   same data at a fraction of the weight of on-the-fly compression. The
		   source is then marked `precompressed`, and the ".br" is asked for
		   first.

		   The host must serve it with content-encoding: br (on Vercel, through
		   vercel.json). Falling back to the plain file is not belt and braces:
		   the header is the host's to set, and should it ever stop, the browser
		   would hand us raw brotli bytes, r.json() would trip over them, and
		   the search has to keep working rather than fall silent.

		   Where there is no compressed copy — GitHub Pages compresses on its
		   own and there is nowhere to put one — asking for it is pointless: a
		   wasted request and a 404 in the console for every index. */
		function index(spec) {
			if (!spec.precompressed) return json(spec.url);
			return json(spec.url + '.br').catch(function () { return json(spec.url); });
		}

		/* A two-tier source keeps its documents like any other, except that a
		   document's blocks arrive later and out of order: `blocks` is a sparse
		   array, and everything that walks it walks only what has come. Chunk
		   numbers are stored nowhere — they run through the pages in order, so
		   many blocks to a chunk — and are counted back here exactly as the
		   builder counted them out. */
		function spread(src, data) {
			var size = data.chunk || 32;
			var words = decodeWords(data.words);
			var lists = data.postings ? data.postings.split('\n') : [];
			var owner = [];   // chunk number -> the document it belongs to
			var start = [];   // chunk number -> the block it begins at
			var here = 0;

			var docs = (data.pages || []).map(function (p) {
				var n = p.blocks || 0;
				var doc = {
					url: p.url,
					title: p.title,
					also: p.also || null,
					lang: tongue(p.lang),
					section: called(src.spec) || p.section || null,
					order: typeof p.order === 'number' ? p.order : (src.spec.order || 0),
					blocks: new Array(n),
				};
				for (var at = 0; at < n; at += size) { start[here] = at; owner[here++] = doc; }
				return doc;
			});

			// Chunks holding a word that begins with t; null if no word does.
			src.postingsFor = function (t) {
				var at = lowerBound(words, t);
				if (at >= words.length || !startsWith(words[at], t)) return null;
				var seen = Object.create(null);
				for (; at < words.length && startsWith(words[at], t); at++) {
					var d = lists[at].split(','), id = 0;
					for (var i = 0; i < d.length; i++) { id += parseInt(d[i], 36); seen[id] = 1; }
				}
				return Object.keys(seen).map(Number).sort(function (a, b) { return a - b; });
			};

			// The map is also the list of every word on these pages, which is
			// what a mistyped query has to be measured against. How much text
			// holds a word is the length of its postings list — counted in
			// place, since cutting the list up would build an array per word
			// to learn one number.
			src.words = words;
			src.weight = function (i) {
				var l = lists[i] || '', n = 1;
				for (var k = 0; k < l.length; k++) if (l.charAt(k) === ',') n++;
				return n;
			};

			/* The ladder of endings is a chain of prefixes — «тело», «тел» —
			   and a block matches when any rung of it occurs. The shortest rung
			   therefore names every chunk the longer ones could, and asking for
			   it alone is not an approximation but the whole answer.

			   A word may bring a second chain along — "nrtta" beside "nritta" —
			   and the two are not prefixes of one another, so both are asked
			   for and the answers put together. Asking for every rung rather
			   than the shortest of each chain would give the same set: a
			   shorter rung names everything the longer one does. */
			function anyOf(variants) {
				var out = null;
				for (var i = 0; i < variants.length; i++) {
					var set = src.postingsFor(variants[i]);
					if (!set) continue;
					if (out === null) { out = set.slice(); continue; }
					for (var k = 0; k < set.length; k++) out.push(set[k]);
				}
				if (out === null) return null;
				var seen = Object.create(null);
				return out.filter(function (id) {
					if (seen[id]) return false;
					seen[id] = 1;
					return true;
				}).sort(function (a, b) { return a - b; });
			}

			src.candidates = function (ts) {
				var out = null;
				for (var i = 0; i < ts.length; i++) {
					var set = anyOf(ts[i]);
					if (!set) return [];
					if (out === null) { out = set; continue; }
					var keep = Object.create(null);
					for (var k = 0; k < set.length; k++) keep[set[k]] = 1;
					out = out.filter(function (id) { return keep[id]; });
					if (!out.length) return out;
				}
				return out || [];
			};

			src.owner = function (id) { return owner[id]; };
			src.at = function (id) { return start[id]; };
			src.chunks = owner.length;
			src.got = Object.create(null);
			src.reading = 0;

			var dir = src.spec.url.replace(/[^/]*$/, '') + (data.text || '');
			src.read = function (id) {
				if (src.got[id]) return Promise.resolve();
				src.got[id] = true;
				src.reading++;
				return index({ url: dir + id + '.json', precompressed: src.spec.precompressed })
					.then(function (blocks) {
						var doc = owner[id], at = start[id];
						(blocks || []).forEach(function (b, i) {
							var block = typeof b === 'string' ? { text: b } : b;
							if (block && block.text) doc.blocks[at + i] = block;
						});
					})
					// A chunk that will not load leaves a hole in one page, and
					// a hole is invisible: the results are simply short. Naming
					// each one would drown the list, so they are counted and the
					// status line says there are some. Without that a site whose
					// text failed to deploy would answer "nothing found" and
					// look like a site with nothing to find.
					.catch(function () { src.holes = (src.holes || 0) + 1; })
					.then(function () { src.reading--; });
			};

			return docs;
		}

		function load(src) {
			if (src.started) return;
			src.started = true;
			index(src.spec)
				.then(function (data) {
					var docs = data.tier === 2 ? spread(src, data) : documentsOf(data, src.spec);
					// Furniture repeated across pages is cut by the two-tier
					// builder before it is ever sent; counting it here would
					// need the very text that has not arrived.
					src.docs = repeats > 1 && data.tier !== 2 ? dropRepeated(docs, repeats) : docs;
					// An index may name further indexes to search alongside it.
					(data.shards || []).forEach(add);
					sources.forEach(function (s) { if (!s.spec.defer) load(s); });
					render(input.value);
				})
				.catch(function () {
					src.failed = true;
					render(input.value);
				});
		}

		/* A site that keeps its pages in more than one language keeps the same
		   page twice, and the reader wants one of them: the one they are
		   reading in. Searching both would answer every query twice over, in
		   two languages, which is worse than answering it once in the wrong
		   one.
		 *
		 * A document that names no language is shown to everybody, and that is
		 * the case that matters most — a book with no translation is better
		 * read in the language it was written in than not found at all. It is
		 * also what keeps this from disturbing an index built before the field
		 * existed, or a site that has one language and never says so. */
		function spoken(doc) {
			return !lang || !doc.lang || doc.lang === lang;
		}

		// Every loaded document, in the order results should appear: by section,
		// then as the builder listed the pages inside it.
		function documents() {
			var docs = [];
			var seq = 0;
			sources.forEach(function (src) {
				(src.docs || []).forEach(function (doc) {
					if (!spoken(doc)) return;
					docs.push({ doc: doc, order: doc.order || 0, seq: seq++ });
				});
			});
			return docs
				.sort(function (a, b) { return a.order - b.order || a.seq - b.seq; })
				.map(function (d) { return d.doc; });
		}

		// One result: a line saying where it comes from, and the text found.
		function item() {
			var li = document.createElement('li');
			var where = document.createElement('div');
			where.className = 'where';
			var p = document.createElement('p');
			p.className = 'snippet';
			li.appendChild(where);
			li.appendChild(p);
			results.appendChild(li);
			return { where: where, snippet: p };
		}

		// A found page: its name is the result, so the trail above it only has
		// to say which part of the site it belongs to.
		function pageResult(doc, ts) {
			var el = item();
			el.where.textContent = doc.section || say_.page;
			var a = document.createElement('a');
			a.href = doc.url;
			a.appendChild(snippet(doc.title, ts));
			el.snippet.appendChild(a);
		}

		// A found paragraph: the trail carries the link, down to the anchor.
		function blockResult(doc, block, ts) {
			var el = item();
			var a = document.createElement('a');
			a.href = doc.url + (block.anchor ? '#' + block.anchor : '');
			// A section's own front page is named after it: "Links → Links" is
			// one Links too many.
			var named = showSection && doc.section && doc.section !== doc.title;
			a.textContent = (named ? doc.section + ' → ' : '') + doc.title;
			el.where.appendChild(a);
			if (block.section) el.where.appendChild(document.createTextNode(' → ' + block.section));
			el.snippet.appendChild(snippet(block.text, ts));
		}

		/* The folded text is computed once per block and kept: it does not
		   change, and running NFD over half a megabyte on every keystroke is
		   work for nothing. The section heading is joined to the paragraph
		   right here: it has to be searched too, while what is shown is still
		   the paragraph. */
		function folded(b) {
			if (b.fold === undefined) b.fold = norm((b.section || '') + ' ' + b.text);
			return b.fold;
		}

		function foldedTitle(doc) {
			if (doc.fold === undefined) doc.fold = norm(doc.title + ' ' + (doc.also || ''));
			return doc.fold;
		}

		// Fills the list and reports how much was found. Called a second time
		// with a widened query when the first pass comes back empty.
		/* `edge` is the first piece of text this query wants and has not got.
		   The walk stops there and shows nothing beyond it, even where a later
		   chunk happens to be in hand from an earlier query: results stand in
		   the order of the site, and a list that skips a paragraph it has not
		   read yet and fills the gap from three pages further on is not that
		   order — it is the order the network answered in. */
		/* `first` holds the opening results' text, kept for the line above the
		   list: where the search ran on something other than what was typed,
		   that line names the word it ran on, and the word is read back out of
		   the text rather than printed as the engine folds it. A few, not one,
		   because the word stands plainer in some paragraphs than in others. */
		var NAMED = 8;

		function collect(ts, edge) {
			results.textContent = '';
			var found = 0, shown = 0, done = false, first = [];

			documents().forEach(function (doc) {
				if (done) return;
				var upto = edge && edge.doc === doc ? edge.at : Infinity;

				// A page whose name matches is itself a result — otherwise
				// searching «индрии» finds nothing on a chapter that keeps
				// the word in its heading alone.
				if (matches(foldedTitle(doc), ts)) {
					found++;
					if (shown < LIMIT) {
						shown++;
						if (first.length < NAMED) first.push(doc.title);
						pageResult(doc, ts);
					}
				}

				doc.blocks.forEach(function (b, i) {
					if (i >= upto) return;
					// Section headings count as part of the paragraph's text for
					// matching, but the snippet still comes from the paragraph.
					if (!matches(folded(b), ts)) return;
					found++;
					if (shown >= LIMIT) return;
					shown++;
					if (first.length < NAMED) first.push(b.text);
					blockResult(doc, b, ts);
				});

				if (upto !== Infinity) done = true;
			});

			return { found: found, shown: shown, first: first };
		}

		// Does such a beginning of a word occur anywhere at all. A two-tier
		// source answers from its map without reading a line of text, which is
		// the whole reason the rule below can still be afforded.
		function occurs(t) {
			return sources.some(function (src) {
				if (src.postingsFor && src.postingsFor(t)) return true;
				return (src.docs || []).some(function (doc) {
					if (occurrence(foldedTitle(doc), t, 0) !== -1) return true;
					return !src.postingsFor && doc.blocks.some(function (b) {
						return occurrence(folded(b), t, 0) !== -1;
					});
				});
			});
		}

		/* The chunks a query needs and has not got, in the order their results
		   will stand in: the top of the page is read for first, because that is
		   what the reader is shown first. */
		function pending(ts) {
			var rank = 0;
			documents().forEach(function (doc) { doc.rank = rank++; });
			var out = [];
			sources.forEach(function (src) {
				if (!src.candidates) return;
				src.candidates(ts).forEach(function (id) {
					if (!src.got[id]) out.push({ src: src, id: id, rank: src.owner(id).rank, doc: src.owner(id), at: src.at(id) });
				});
			});
			return out.sort(function (a, b) { return a.rank - b.rank || a.id - b.id; });
		}

		function reading() {
			return sources.some(function (src) { return src.reading > 0; });
		}

		/* How far to read before pausing. A common word sits in a hundred
		   chunks; reading every one of them to print a hundred paragraphs
		   nobody scrolls to would cost more than the single file this replaced.
		   So: enough to fill the screen, and whoever wants the rest asks. The
		   second number guards the opposite case — two words that share a page
		   but never a paragraph name chunk after chunk and match in none of
		   them, and without a bound that query reads the site. */
		var REACH = 20;
		var READ = 40;
		var AT_ONCE = 6;

		var asked = null;
		var reach = REACH, allowed = READ, taken = 0;

		function advance(left) {
			var take = left.slice(0, Math.min(AT_ONCE, allowed - taken));
			if (!take.length) return;
			taken += take.length;
			Promise.all(take.map(function (c) { return c.src.read(c.id); }))
				.then(function () { render(input.value); });
		}

		/* The fallback rule: the exact pass found nothing, which means a form
		   was typed that the text does not hold («страхами», «касинового»). The
		   word is cut a letter at a time and stops at the first stem that does
		   occur: «страхами» gets as far as «страха» and no further, so «стра» —
		   and with it «страдание» and «страница» — is never needed.

		   How far the cutting may go has to be a share of the word, not a
		   number of letters. A fixed floor of four was the same floor for a
		   word of five letters and a word of twelve, and on the long ones it
		   was a licence to cut the word in half: «остойчивость» reached «осто»
		   and offered «осторожнее» as a word of the same root, which it is not.

		   The share is 60%, chosen by measuring on the two sites' own indexes
		   rather than by eye. Judged against a stemmer, the rule below finds a
		   word of the same root for two thirds of the queries the exact pass
		   fails on, and nine paragraphs in ten that it shows really do hold
		   one; the old floor answered more often but lied about a third of the
		   time. Cutting deeper buys little and costs the promise printed above
		   the results. */
		var KEEP = 0.6;

		function widen(q) {
			var cut = null, n = 0;
			var ts = words(q).map(function (t) {
				var min = Math.max(4, Math.ceil(t.length * KEEP));
				for (var len = t.length - 1; len >= min; len--) {
					var s = t.slice(0, len);
					if (occurs(s)) { cut = { from: t, to: s }; n++; return [s]; }
				}
				return [t];
			});
			// Which word the results were shown by can only be said when one
			// word was shortened. With two, the line would have to name a pair
			// and then say which stood for which.
			return { ts: ts, cut: n === 1 ? cut : null };
		}

		/* Every word the site holds, and how much of the text holds each.

		   A two-tier source knows this already: its map is that list, and it
		   arrives whole with the first query, whether or not a line of text
		   behind it is ever read. A flat source has no such list, but it has
		   the text — all of it, from the moment it loads — so the words are
		   counted straight out of the folded blocks, which were folded anyway.

		   Built when first asked for and kept, because the only thing that
		   ever asks is a query that found nothing; and thrown away when
		   another index arrives, since it now knows words it did not. */
		var lexicon = null, lexiconOf = -1;

		function lexis() {
			var loaded = sources.filter(function (s) { return s.docs; });
			if (lexicon && lexiconOf === loaded.length) return lexicon;
			var weight = Object.create(null);
			loaded.forEach(function (src) {
				if (src.words) {
					src.words.forEach(function (w, i) {
						weight[w] = (weight[w] || 0) + src.weight(i);
					});
					return;
				}
				src.docs.forEach(function (doc) {
					tally(weight, foldedTitle(doc));
					doc.blocks.forEach(function (b) { if (b) tally(weight, folded(b)); });
				});
			});
			lexiconOf = loaded.length;
			lexicon = { words: Object.keys(weight), weight: weight };
			return lexicon;
		}

		/* One letter may be wrong in an ordinary word, two in a long one.
		   The bound cannot be flat: at distance two a word of five letters has
		   half the site for a neighbour and the answer would be a coin toss,
		   while `paratrisikavirana` is two letters away from the one word it
		   was meant to be and from nothing else whatsoever. Under four letters
		   nothing is offered at all — there is not enough word to be wrong
		   about. */
		function allowance(len) {
			return len >= 8 ? 2 : (len >= 4 ? 1 : 0);
		}

		/* The nearest word of the site, or null if none is near enough. A tie
		   goes to the word more of the text holds: `mandla` is one letter from
		   both `mandala` and `manda`, and the first stands in twenty-three
		   chunks against five. Order in the list would answer `manda` and mean
		   nothing by it — the list is alphabetical, and the alphabet knows
		   nothing about this site. */
		function nearest(spellings, max) {
			if (!max) return null;
			var lex = lexis(), best = null, near = max + 1, held = -1;
			for (var i = 0; i < lex.words.length; i++) {
				var w = lex.words[i], d = max + 1;
				for (var k = 0; k < spellings.length; k++) {
					var t = spellings[k];
					if (Math.abs(w.length - t.length) > max) continue;
					var e = edits(t, w, max);
					// `edits` answers max + 1 for "further than that", and so
					// does the distance so far when nothing has been measured
					// yet: both have to be shut out, or the first word looked
					// at is taken however far away it is.
					if (e > max || e >= d) continue;
					// Two letters wrong at the front is not a slip of the hand
					// but a different word: «касинового» is that far from
					// «малинового» and «остойчивость» from «устойчивость», and
					// neither pair has anything to do with the other. One
					// letter may fall anywhere — "joga" is somebody spelling
					// `yoga` as their own language would.
					if (e > 1 && w.slice(0, 2) !== t.slice(0, 2)) continue;
					d = e;
				}
				// Nothing measured up: `d` is still the "further than that"
				// answer, and so is `near` until a word has been found. Both
				// have to be shut out here as well, or a word nothing matched
				// walks straight through.
				if (d > max || d > near) continue;
				var weight = lex.weight[w];
				if (d < near || weight > held) { best = w; near = d; held = weight; }
			}
			return best;
		}

		// The one word of the site that begins so, or null if several do: the
		// results then hold them all, and naming a favourite among them would
		// say something untrue about the rest.
		function only(t) {
			var lex = lexis(), found = null;
			for (var i = 0; i < lex.words.length; i++) {
				if (!startsWith(lex.words[i], t)) continue;
				if (found) return null;
				found = lex.words[i];
			}
			return found;
		}

		/* Neither the word nor any beginning of it stands anywhere on the
		   site, which leaves the likeliest thing of all: it was typed wrong.

		   Only a word the site does not hold is replaced. In a query of
		   several words the others are the ones that are right, and mending
		   them would answer a question nobody asked. */
		function correct(q, cap) {
			var ls = terms(q), ws = words(q), out = [], cut = null;
			for (var i = 0; i < ws.length; i++) {
				if (occurs(ws[i])) { out.push(ls[i]); continue; }
				/* Measured from both spellings a query may have. Somebody who
				   strips the diacritics by hand writes "srngara", the site
				   writes `sringara`, and between those two nothing is
				   misspelt at all — but two letters lie between them, and a
				   misspelling of the first would then be measured from a
				   word the site has never heard of. The endings of the ladder
				   are not used: correcting a word already cut short would be
				   guessing twice over. */
				var also = vocalic(ws[i]);
				var near = nearest(also ? [ws[i], also] : [ws[i]],
					Math.min(allowance(ws[i].length), cap));
				if (!near) return null;
				out.push([near]);
				cut = { from: ws[i], to: near };
			}
			return cut ? { ts: out, cut: cut } : null;
		}

		// What the line above the results will say the search was shown by:
		// the word as the text writes it, and nothing at all where there is no
		// single word to name.
		function shownBy(cut, word, texts) {
			if (!word) return null;
			// The first paragraph shown may hold the word only inside a longer
			// one, while the second holds it plain: «śaktipātataḥ» in the
			// stanza, `śaktipāta` in the sentence under it. So a handful of
			// them are looked at, and the word itself wins wherever it stands.
			var seen = null;
			for (var i = 0; texts && i < texts.length; i++) {
				var got = form(texts[i], word);
				if (!got) continue;
				if (norm(got) === word) { seen = got; break; }
				if (seen === null) seen = got;
			}
			return { from: cut.from, to: seen || word };
		}

		// One go at a set of terms: what it found, what it still has to read,
		// and whether it is worth anything at all.
		function attempt(ts) {
			var left = pending(ts);
			var r = collect(ts, left[0]);
			return { r: r, left: left, worked: r.found > 0 || left.length > 0 };
		}

		function render(q) {
			results.textContent = '';
			var searching = words(q).length > 0 && q.trim().length >= 2;

			if (searching) sources.forEach(load);

			var loading = sources.some(function (s) { return s.started && !s.docs && !s.failed; });
			var ready = sources.some(function (s) { return s.docs; });
			var broken = sources.filter(function (s) { return s.failed; });
			var busy = reading();

			more.hidden = true;
			if (!searching) {
				status.textContent = '';
				return;
			}

			// A new query is read for afresh; the same query being redrawn as
			// chunks arrive keeps the reading it has already paid for.
			if (q !== asked) { asked = q; reach = REACH; allowed = READ; taken = 0; }

			var ts = terms(q);
			var left = pending(ts);
			var r = collect(ts, left[0]);
			var widened = false, said = null;
			// Empty most likely means a form the exact rule cannot reach. While
			// an index is still on its way — or a chunk of text is — "empty"
			// only means "not here yet", and there is no cause to hurry.
			if (!r.found && !loading && !busy && !left.length) {
				var wide = widen(q);
				var a = attempt(wide.ts);
				// A beginning that reaches one word of the site is not a guess
				// at all: every result is that word, and it can be named.
				var one = a.worked && a.r.found && wide.cut ? only(wide.cut.to) : null;
				/* Whereas a beginning that fans out to a dozen words has
				   picked a stem and hoped; a word one letter from what was
				   typed has not. So a misspelling is looked for even when
				   widening did find something — but then at one letter only.
				   Two letters is a wide enough net to catch a word that merely
				   rhymes («касинового» → «малинового»), and it is allowed only
				   where the site holds nothing of the sort at all.

				   While chunks of text are still on their way for the widened
				   query, "found nothing" is not yet true of it, and there is
				   nothing to overrule. */
				var fix = one || (a.worked && !a.r.found) ? null : correct(q, a.worked ? 1 : 2);
				var b = fix ? attempt(fix.ts) : null;
				if (b && b.worked) {
					r = b.r; left = b.left;
					if (b.r.found) said = shownBy(fix.cut, fix.cut.to, b.r.first);
				} else if (a.worked) {
					// The correction was tried and came to nothing, and the
					// list on the page is its empty one: put the widened
					// results back.
					if (b) a = attempt(wide.ts);
					r = a.r; left = a.left; widened = a.r.found > 0;
					if (one) said = shownBy(wide.cut, one, a.r.first);
				}
			}
			var found = r.found, shown = r.shown;

			var say = found
				? say_.hits(found)
				: (loading || busy ? '' : (left.length ? say_.notYet : say_.none));
			if (found > shown) say += say_.firstOf(shown);
			// Naming the word beats calling it a relative: the reader is told
			// the spelling that is actually on the site, and can see at a
			// glance whether it is the word they meant.
			if (said) say += (say ? ' · ' : '') + say_.instead(said.to);
			else if (widened) say += (say ? ' · ' : '') + say_.kin;
			// Until some index has arrived there is nothing to search; once part
			// of it is in hand, its results are shown while the rest loads.
			if (loading) say += (say ? ' · ' : '') + (ready ? say_.searching : say_.loading);
			else if (busy) say += (say ? ' · ' : '') + say_.reading;
			// Reading stopped short of the end on purpose, and saying so is the
			// price of stopping: a count that looks final and is not would be
			// worse than no count.
			else if (left.length) say += (say ? ' · ' : '') + say_.unread;
			if (broken.length) say += (say ? ' · ' : '') + say_.broken(called(broken[0].spec));
			var holes = sources.reduce(function (n, src) { return n + (src.holes || 0); }, 0);
			if (holes) say += (say ? ' · ' : '') + say_.holes(holes);
			status.textContent = say;

			/* Reading stops for good once the list is full: the hundredth
			   result is the last one anybody will be shown, and chunks read
			   past it would buy nothing but a larger number in the line above.
			   The number is short, and says so. */
			if (left.length && shown < LIMIT && shown < reach && taken < allowed) advance(left);
			else more.hidden = !left.length || shown >= LIMIT;

			/* Results arrive in waves — the index, then each chunk of text —
			   and every wave rebuilds the list. A host that puts its own
			   handles on what is in there (keyboard selection, say) has to be
			   told each time, or it would be holding elements that no longer
			   exist. */
			if (opts.onRender) opts.onRender();
		}

		var timer;
		input.addEventListener('input', function () {
			clearTimeout(timer);
			timer = setTimeout(function () {
				var q = input.value;
				render(q);
				if (!address) return;
				var url = q.trim()
					? location.pathname + '?q=' + encodeURIComponent(q.trim())
					: location.pathname;
				history.replaceState(null, '', url);
			}, 120);
		});

		if (address) {
			var initial = new URLSearchParams(location.search).get('q');
			if (initial && !input.value) input.value = initial;
		}

		// Whatever is not deferred is fetched now, so that the first query
		// answers instantly; the rest waits until there is a query at all.
		sources.forEach(function (src) { if (!src.spec.defer) load(src); });

		if (input.value) render(input.value);

		/* Handed back so that a host which is not a page can drive the search
		   itself — asking for a query when it decides there is one, rather than
		   waiting on an `input` event it never sends. The page's own search
		   ignores this and keeps working off the field, as it always has. */
		return { render: render, input: input, more: more };
	}

	/* The fold is handed out because the builder needs the very same one. A
	   two-tier map is a list of the words of the site as this file folds them,
	   and a query is looked up in it folded the same way; two copies of the
	   table would agree until the day somebody edited one of them, and the map
	   would then quietly stop naming the chunks it should (node/two-tier.js).
	   Hence one copy, in the file the browser loads anyway. */
	global.SiteSearch = { mount: mount, fold: norm, say: SAY };
})(typeof globalThis !== 'undefined' ? globalThis : window);

// Node reads this file for the fold alone; nothing above touches the document
// until `mount` is called.
if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.SiteSearch;
