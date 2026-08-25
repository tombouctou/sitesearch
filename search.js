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
				var before = i > 0 ? s.charAt(i - 1).toLowerCase() : '';
				piece = (!before || VOWEL.test(before)) ? (c === 'я' ? 'ya' : 'yu') : CYRILLIC[c];
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

	function plural(n, one, few, many) {
		var a = n % 100, b = n % 10;
		if (a > 10 && a < 20) return many;
		if (b === 1) return one;
		if (b >= 2 && b <= 4) return few;
		return many;
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
				section: spec.section || p.section || null,
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

		/* Reading stops before the end more often than not, so there has to be
		   a way to ask for the rest. The control sits outside the list: it is
		   not a result, and a list of results is no place to say so. */
		var more = document.createElement('p');
		more.className = 'more';
		more.hidden = true;
		var button = document.createElement('button');
		button.type = 'button';
		button.textContent = 'Показать ещё';
		button.addEventListener('click', function () {
			reach += 3 * REACH;
			allowed += 2 * READ;
			render(input.value);
		});
		more.appendChild(button);
		if (results.parentNode) results.parentNode.insertBefore(more, results.nextSibling);

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
					section: src.spec.section || p.section || null,
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

		// Every loaded document, in the order results should appear: by section,
		// then as the builder listed the pages inside it.
		function documents() {
			var docs = [];
			var seq = 0;
			sources.forEach(function (src) {
				(src.docs || []).forEach(function (doc) {
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
			el.where.textContent = doc.section || 'Страница';
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
		function collect(ts, edge) {
			results.textContent = '';
			var found = 0, shown = 0, done = false;

			documents().forEach(function (doc) {
				if (done) return;
				var upto = edge && edge.doc === doc ? edge.at : Infinity;

				// A page whose name matches is itself a result — otherwise
				// searching «индрии» finds nothing on a chapter that keeps
				// the word in its heading alone.
				if (matches(foldedTitle(doc), ts)) {
					found++;
					if (shown < LIMIT) { shown++; pageResult(doc, ts); }
				}

				doc.blocks.forEach(function (b, i) {
					if (i >= upto) return;
					// Section headings count as part of the paragraph's text for
					// matching, but the snippet still comes from the paragraph.
					if (!matches(folded(b), ts)) return;
					found++;
					if (shown >= LIMIT) return;
					shown++;
					blockResult(doc, b, ts);
				});

				if (upto !== Infinity) done = true;
			});

			return { found: found, shown: shown };
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
			return words(q).map(function (t) {
				var min = Math.max(4, Math.ceil(t.length * KEEP));
				for (var len = t.length - 1; len >= min; len--) {
					var s = t.slice(0, len);
					if (occurs(s)) return [s];
				}
				return [t];
			});
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
			var widened = false;
			// Empty most likely means a form the exact rule cannot reach. While
			// an index is still on its way — or a chunk of text is — "empty"
			// only means "not here yet", and there is no cause to hurry.
			if (!r.found && !loading && !busy && !left.length) {
				var wts = widen(q);
				var wleft = pending(wts);
				var wide = collect(wts, wleft[0]);
				if (wide.found || wleft.length) {
					r = wide; left = wleft; widened = wide.found > 0;
				}
			}
			var found = r.found, shown = r.shown;

			var say = found
				? found + ' ' + plural(found, 'совпадение', 'совпадения', 'совпадений')
				: (loading || busy ? '' : (left.length ? 'Пока ничего не нашлось.' : 'Ничего не нашлось.'));
			if (found > shown) say += ', показаны первые ' + shown;
			if (widened) say += (say ? ' · ' : '') + 'точной формы в тексте нет, это однокоренные слова';
			// Until some index has arrived there is nothing to search; once part
			// of it is in hand, its results are shown while the rest loads.
			if (loading) say += (say ? ' · ' : '') + (ready ? 'ищу дальше…' : 'Загружаю указатель…');
			else if (busy) say += (say ? ' · ' : '') + 'читаю дальше…';
			// Reading stopped short of the end on purpose, and saying so is the
			// price of stopping: a count that looks final and is not would be
			// worse than no count.
			else if (left.length) say += (say ? ' · ' : '') + 'прочитано не всё';
			if (broken.length) {
				say += (say ? ' · ' : '') + 'не удалось загрузить указатель' +
					(broken[0].spec.section ? ' (' + broken[0].spec.section + ')' : '');
			}
			var holes = sources.reduce(function (n, src) { return n + (src.holes || 0); }, 0);
			if (holes) say += (say ? ' · ' : '') + 'часть текста не загрузилась (' + holes + ')';
			status.textContent = say;

			/* Reading stops for good once the list is full: the hundredth
			   result is the last one anybody will be shown, and chunks read
			   past it would buy nothing but a larger number in the line above.
			   The number is short, and says so. */
			if (left.length && shown < LIMIT && shown < reach && taken < allowed) advance(left);
			else more.hidden = !left.length || shown >= LIMIT;
		}

		var timer;
		input.addEventListener('input', function () {
			clearTimeout(timer);
			timer = setTimeout(function () {
				var q = input.value;
				render(q);
				var url = q.trim()
					? location.pathname + '?q=' + encodeURIComponent(q.trim())
					: location.pathname;
				history.replaceState(null, '', url);
			}, 120);
		});

		var initial = new URLSearchParams(location.search).get('q');
		if (initial && !input.value) input.value = initial;

		// Whatever is not deferred is fetched now, so that the first query
		// answers instantly; the rest waits until there is a query at all.
		sources.forEach(function (src) { if (!src.spec.defer) load(src); });

		if (input.value) render(input.value);
	}

	/* The fold is handed out because the builder needs the very same one. A
	   two-tier map is a list of the words of the site as this file folds them,
	   and a query is looked up in it folded the same way; two copies of the
	   table would agree until the day somebody edited one of them, and the map
	   would then quietly stop naming the chunks it should (node/two-tier.js).
	   Hence one copy, in the file the browser loads anyway. */
	global.SiteSearch = { mount: mount, fold: norm };
})(typeof globalThis !== 'undefined' ? globalThis : window);

// Node reads this file for the fold alone; nothing above touches the document
// until `mount` is called.
if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.SiteSearch;
