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

	/* Diacritics are folded on both sides: the searcher types "rangapuja"
	   where the text has "raṅgapūjā". NFD splits a letter into a base and a
	   mark, and the mark is thrown away. The length of the string does not
	   change — the highlighting of matches rests on that — because every
	   composed sign yields exactly one base. */
	function norm(s) {
		return s.toLowerCase()
			.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
			.replace(/ё/g, 'е');
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
	   ends in «ах» and would be cut back to «стр». */
	var SOFT = /[аеиоуыэюяьий]$/;
	var PLURAL = /[a-z]{4,}s$/;

	function ladder(t) {
		var v = [t];
		// In English one "s" serves the same purpose.
		if (PLURAL.test(t)) { v.push(t.slice(0, -1)); return v; }
		var s = t;
		for (var i = 0; i < 2 && s.length > 3 && SOFT.test(s); i++) {
			s = s.slice(0, -1);
			v.push(s);
		}
		return v;
	}

	function words(q) {
		return norm(q).split(/\s+/).filter(function (t) { return t.length > 0; });
	}

	function terms(q) {
		return words(q).map(ladder);
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

	// Build the snippet as text nodes + <mark>, never as HTML.
	function snippet(text, ts) {
		var hay = norm(text);
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
			var space = text.indexOf(' ', start);
			if (space !== -1 && space - start < 20) start = space + 1;
		}
		var end = Math.min(text.length, start + WINDOW);
		// And at the right edge too: a word caught on the window's boundary
		// would otherwise be highlighted as a stub — «джх» for «джханы».
		while (end < text.length && LETTER.test(hay.charAt(end))) end++;

		var cursor = start;
		if (start > 0) frag.appendChild(document.createTextNode('…'));

		spans.forEach(function (s) {
			if (s[1] <= cursor || s[0] >= end) return;
			if (s[0] > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, s[0])));
			// Two words of the query can cover one word of the text; the second
			// then begins before the first has ended, and what is already
			// written must not be written again.
			var m = document.createElement('mark');
			m.textContent = text.slice(Math.max(s[0], cursor), Math.min(s[1], end));
			frag.appendChild(m);
			cursor = Math.min(s[1], end);
		});

		if (cursor < end) frag.appendChild(document.createTextNode(text.slice(cursor, end)));
		if (end < text.length) frag.appendChild(document.createTextNode('…'));
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

		function load(src) {
			if (src.started) return;
			src.started = true;
			index(src.spec)
				.then(function (data) {
					var docs = documentsOf(data, src.spec);
					src.docs = repeats > 1 ? dropRepeated(docs, repeats) : docs;
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
		function collect(ts) {
			results.textContent = '';
			var found = 0, shown = 0;

			documents().forEach(function (doc) {
				// A page whose name matches is itself a result — otherwise
				// searching «индрии» finds nothing on a chapter that keeps
				// the word in its heading alone.
				if (matches(foldedTitle(doc), ts)) {
					found++;
					if (shown < LIMIT) { shown++; pageResult(doc, ts); }
				}

				doc.blocks.forEach(function (b) {
					// Section headings count as part of the paragraph's text for
					// matching, but the snippet still comes from the paragraph.
					if (!matches(folded(b), ts)) return;
					found++;
					if (shown >= LIMIT) return;
					shown++;
					blockResult(doc, b, ts);
				});
			});

			return { found: found, shown: shown };
		}

		// Does such a beginning of a word occur anywhere at all.
		function occurs(t) {
			return documents().some(function (doc) {
				if (occurrence(foldedTitle(doc), t, 0) !== -1) return true;
				return doc.blocks.some(function (b) { return occurrence(folded(b), t, 0) !== -1; });
			});
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

			if (!searching) {
				status.textContent = '';
				return;
			}

			var r = collect(terms(q));
			var widened = false;
			// Empty most likely means a form the exact rule cannot reach. While
			// an index is still on its way, "empty" only means "not here yet",
			// and there is no cause to hurry.
			if (!r.found && !loading) {
				var wide = collect(widen(q));
				if (wide.found) { r = wide; widened = true; }
			}
			var found = r.found, shown = r.shown;

			var say = found
				? found + ' ' + plural(found, 'совпадение', 'совпадения', 'совпадений')
				: (loading ? '' : 'Ничего не нашлось.');
			if (found > shown) say += ', показаны первые ' + shown;
			if (widened) say += (say ? ' · ' : '') + 'точной формы в тексте нет, это однокоренные слова';
			// Until some index has arrived there is nothing to search; once part
			// of it is in hand, its results are shown while the rest loads.
			if (loading) say += (say ? ' · ' : '') + (ready ? 'ищу дальше…' : 'Загружаю указатель…');
			if (broken.length) {
				say += (say ? ' · ' : '') + 'не удалось загрузить указатель' +
					(broken[0].spec.section ? ' (' + broken[0].spec.section + ')' : '');
			}
			status.textContent = say;
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

	global.SiteSearch = { mount: mount };
})(window);
