/* What state the search indexes are in — for the site's own eyes.
 *
 * A page hands over a node to write into and the same sources the search page
 * names, and gets back what was actually fetched: how large the index is over
 * the wire, how many pages and paragraphs it holds, how it divides into
 * sections, and what looks wrong in it.
 *
 *     SiteSearchStatus.mount({
 *         into: 'report',
 *         sources: [{ url: '/search-index.json', precompressed: true }],
 *     });
 *
 * Everything is counted from the index as served, not from the build: a page
 * that reports what a builder once printed reports the build, and the question
 * here is what the site is actually handing out. Indexes named in `shards` are
 * followed, so the page shows the whole set from one source.
 */
(function (global) {
	'use strict';

	function el(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text !== undefined) n.textContent = text;
		return n;
	}

	function bytes(n) {
		if (n === null || n === undefined) return '—';
		if (n < 1024) return n + ' Б';
		if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' КБ';
		return (n / 1024 / 1024).toFixed(2) + ' МБ';
	}

	function num(n) {
		return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
	}

	function plural(n, one, few, many) {
		var a = Math.abs(n) % 100, b = a % 10;
		if (a > 10 && a < 20) return many;
		if (b > 1 && b < 5) return few;
		if (b === 1) return one;
		return many;
	}

	/* The transfer size is known only to the browser, and only for its own
	   origin: how many bytes travelled and how many arrived after unpacking.
	   Some browsers withhold it (and a request served from cache reports
	   zero), hence the guard — the page says "—" rather than inventing. */
	function wire(url) {
		if (!global.performance || !performance.getEntriesByName) return {};
		var e = performance.getEntriesByName(new URL(url, location.href).href);
		var last = e && e.length ? e[e.length - 1] : null;
		if (!last) return {};
		return {
			transfer: last.transferSize || null,
			encoded: last.encodedBodySize || null,
			decoded: last.decodedBodySize || null,
			ms: Math.round(last.duration),
		};
	}

	/* Fetch one index the way the engine fetches it: where the site keeps a
	   pre-compressed copy, that one is asked for first and the plain file is
	   the fallback. The fallback is worth reporting rather than hiding — a
	   .br served without its content-encoding still leaves the search working
	   and still means the host is misconfigured, and nothing else on the site
	   would ever say so. */
	function fetchIndex(spec) {
		var started = Date.now();
		function get(url) {
			// Never from the cache. The question this page answers is what the
			// site is handing out now, and a cached copy answers what it was
			// handing out at some past hour — which is worse than no answer,
			// because it looks like one.
			return fetch(url, { cache: 'reload' }).then(function (r) {
				if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
				return r.text().then(function (text) {
					var got = {
						url: url,
						status: r.status,
						type: r.headers.get('content-type') || '',
						encoding: r.headers.get('content-encoding') || '',
						text: text,
						ms: Date.now() - started,
					};
					got.data = JSON.parse(text);
					return got;
				});
			});
		}
		function one() {
			if (!spec.precompressed) return get(spec.url);
			return get(spec.url + '.br').catch(function (err) {
				return get(spec.url).then(function (got) {
					// JSON.parse names the offending bytes; they are noise here.
					got.note = 'сжатая копия не подошла (' + String(err.message).split(',')[0] + '), взят обычный файл — ' +
						'поиск работает, но лишний запрос делает каждый читатель';
					return got;
				});
			});
		}

		/* An index in two tiers hands over a map and keeps the text in chunks,
		   and a reader's browser fetches only the chunks it shows. This page is
		   not a reader: its whole business is what the text looks like — the
		   markup that leaked into it, the paragraph repeated on forty pages —
		   and it therefore fetches every chunk and puts the index back together
		   whole. That is a megabyte or so and several hundred requests, which
		   is why nothing links here. */
		return one().then(function (got) {
			if (!got.data || got.data.tier !== 2) return got;
			return chunks(spec, got).then(function () { return got; });
		});
	}

	function chunks(spec, got) {
		var data = got.data;
		var size = data.chunk || 32;
		var dir = spec.url.replace(/[^/]*$/, '') + (data.text || '');
		var jobs = [];
		(data.pages || []).forEach(function (p) {
			var n = p.blocks || 0;
			p.blocks = new Array(n);
			// The chunk's number is where it falls in this very walk: pages in
			// order, so many blocks at a time. The builder counted it out the
			// same way and stored it nowhere.
			for (var at = 0; at < n; at += size) jobs.push({ page: p, at: at, id: jobs.length });
		});
		got.tier = { chunks: jobs.length, size: size, map: new Blob([got.text]).size, text: 0, urls: [] };

		// Eight at a time: a browser will not run four hundred requests at once
		// anyway, and queueing them by hand keeps the failures readable.
		var at = 0;
		function next() {
			if (at >= jobs.length) return Promise.resolve();
			var batch = jobs.slice(at, at + 8);
			at += batch.length;
			return Promise.all(batch.map(function (job) {
				var url = dir + job.id + '.json';
				function take(u) {
					return fetch(u, { cache: 'reload' })
						.then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
						.then(function (text) {
							got.tier.text += new Blob([text]).size;
							got.tier.urls.push(u);
							// Placed where it belongs, not appended: eight
							// requests come back in whatever order they please,
							// and a page whose paragraphs are shuffled would be
							// reported as a page whose paragraphs are shuffled.
							JSON.parse(text).forEach(function (b, i) { job.page.blocks[job.at + i] = b; });
						});
				}
				var go = spec.precompressed ? take(url + '.br').catch(function () { return take(url); }) : take(url);
				return go.catch(function () { got.tier.failed = (got.tier.failed || 0) + 1; });
			})).then(next);
		}
		return next();
	}

	// The blocks of a page, in the one shape the rest of this file expects.
	function blocksOf(page) {
		return (page.blocks || []).map(function (b) {
			return typeof b === 'string' ? { text: b } : b;
		}).filter(function (b) { return b && b.text; });
	}

	/* Reading the index the way the engine reads it, and counting what a
	   person would want to know before trusting the search: how much of the
	   site is in there, how it is cut up, and what in it does not look like
	   text a reader would recognise. */
	function measure(data) {
		var pages = data.pages || [];
		var m = {
			pages: pages.length,
			blocks: 0,
			chars: 0,
			anchored: 0,
			sections: {},
			words: Object.create(null),
			wordCount: 0,
			biggest: [],
			empty: [],
			shards: (data.shards || []).length,
			suspect: { markup: [], entities: [], markdown: [], tiny: [], repeated: [] },
			duplicateUrls: [],
		};
		var seenUrl = Object.create(null);
		var textCount = Object.create(null);

		pages.forEach(function (p) {
			var bs = blocksOf(p);
			var chars = 0;
			if (seenUrl[p.url]) m.duplicateUrls.push(p.url); else seenUrl[p.url] = 1;

			var sec = p.section || '—';
			if (!m.sections[sec]) m.sections[sec] = { pages: 0, blocks: 0, chars: 0, order: p.order };
			m.sections[sec].pages++;

			bs.forEach(function (b) {
				m.blocks++;
				chars += b.text.length;
				if (b.anchor) m.anchored++;
				if (b.text.length < 25) m.suspect.tiny.push({ where: p.url, text: b.text });
				// Text that still carries what the builder was supposed to
				// take off: a tag, an entity, a markdown link.
				if (/<\/?[a-z][^>]*>/i.test(b.text)) m.suspect.markup.push({ where: p.url, text: b.text });
				else if (/&(?:[a-z]+|#\d+);/i.test(b.text)) m.suspect.entities.push({ where: p.url, text: b.text });
				else if (/\]\(|^\s*#{1,6}\s|\*\*/.test(b.text)) m.suspect.markdown.push({ where: p.url, text: b.text });

				if (b.text.length >= 60) textCount[b.text] = (textCount[b.text] || 0) + 1;

				b.text.toLowerCase().split(/[^0-9a-zа-яё]+/).forEach(function (w) {
					if (w.length < 2 || m.words[w]) return;
					m.words[w] = 1;
					m.wordCount++;
				});
			});

			m.chars += chars;
			m.sections[sec].blocks += bs.length;
			m.sections[sec].chars += chars;
			m.biggest.push({ url: p.url, title: p.title, blocks: bs.length, chars: chars });
			if (!bs.length) m.empty.push({ url: p.url, title: p.title });
		});

		// A paragraph standing word for word on several pages is furniture,
		// not text — the engine can be told to drop it with `repeats`.
		Object.keys(textCount).forEach(function (t) {
			if (textCount[t] > 1) m.suspect.repeated.push({ where: textCount[t] + ' ' + plural(textCount[t], 'страница', 'страницы', 'страниц'), text: t, n: textCount[t] });
		});
		m.suspect.repeated.sort(function (a, b) { return b.n - a.n; });
		m.biggest.sort(function (a, b) { return b.chars - a.chars; });
		return m;
	}

	function row(table, cells, head) {
		var tr = el('tr');
		cells.forEach(function (c) {
			var td = el(head ? 'th' : 'td');
			if (c && c.nodeType) td.appendChild(c); else td.textContent = c;
			tr.appendChild(td);
		});
		table.appendChild(tr);
		return tr;
	}

	function table(cls) {
		return el('table', cls);
	}

	function link(url, text) {
		var a = el('a', null, text || url);
		a.href = url;
		return a;
	}

	function facts(m, got, spec) {
		var w = wire(got.url);
		var served = new Blob([got.text]).size;
		var t = table('facts');
		var rows = [
			['адрес', link(got.url)],
			['ответ', got.status + ' ' + (got.type || '') + (got.encoding ? ' · content-encoding: ' + got.encoding : '')],
			['по проводу', bytes(w.transfer !== undefined ? w.transfer : null) + (w.encoded ? ' (тело ' + bytes(w.encoded) + ')' : '')],
			[got.tier ? 'карта разобранной' : 'разобранный', bytes(served)],
			['получен за', got.ms + ' мс'],
			['страниц', num(m.pages) + (m.empty.length ? ' · без текста ' + m.empty.length : '')],
			['абзацев', num(m.blocks) + ' · с якорем ' + num(m.anchored) +
				' (' + (m.blocks ? Math.round(100 * m.anchored / m.blocks) : 0) + '%)'],
			['текста', num(m.chars) + ' знаков · ' + num(m.wordCount) + ' разных слов'],
			['на абзац', m.blocks ? Math.round(m.chars / m.blocks) + ' знаков' : '—'],
			['на страницу', m.pages ? Math.round(m.blocks / m.pages) + ' абзацев' : '—'],
		];
		if (got.tier) {
			var t2 = got.tier;
			rows.splice(4, 0,
				['устройство', 'два яруса: карта и текст кусками по ' + t2.size + ' абзацев'],
				['карта', bytes(t2.map) + ' · читателю этого хватает, чтобы узнать, где искать'],
				['текст', num(t2.chunks) + ' ' + plural(t2.chunks, 'кусок', 'куска', 'кусков') + ' на ' + bytes(t2.text) +
					' · читателю едут единицы, эта страница взяла все' +
					(t2.failed ? ' · не отдалось: ' + t2.failed : '')]);
		}
		if (m.shards) rows.push(['называет указателей', String(m.shards)]);
		if (spec.section) rows.push(['раздел от страницы поиска', spec.section]);
		if (spec.defer) rows.push(['грузится', 'только по запросу']);
		rows.forEach(function (r) { row(t, r); });
		return t;
	}

	function sectionsTable(m) {
		var names = Object.keys(m.sections);
		if (names.length < 2 && names[0] === '—') return null;
		names.sort(function (a, b) {
			return (m.sections[a].order || 0) - (m.sections[b].order || 0) || (a < b ? -1 : 1);
		});
		var t = table('sections');
		row(t, ['раздел', 'порядок', 'страниц', 'абзацев', 'знаков'], true);
		names.forEach(function (n) {
			var s = m.sections[n];
			row(t, [n, s.order === undefined ? '—' : String(s.order), num(s.pages), num(s.blocks), num(s.chars)]);
		});
		return t;
	}

	function biggestTable(m, n) {
		var t = table('biggest');
		row(t, ['страница', 'абзацев', 'знаков'], true);
		m.biggest.slice(0, n).forEach(function (p) {
			row(t, [link(p.url, p.title || p.url), num(p.blocks), num(p.chars)]);
		});
		return t;
	}

	// Only what is worth looking at gets a heading; a clean index says so in
	// one line instead of printing five empty tables.
	function complaints(m) {
		var kinds = [
			['markup', 'осталась разметка', 'В тексте абзаца стоит тег: сборщик его не снял.'],
			['entities', 'остались сущности', 'В тексте стоит &amp; или подобное: строка не расшифрована.'],
			['markdown', 'остался markdown', 'Ссылка вида []() , заголовок или ** в тексте: разметка снята не вся.'],
			['repeated', 'абзац повторяется', 'Один и тот же текст на нескольких страницах — обвязка, а не содержимое. Движку можно указать repeats.'],
			['tiny', 'абзац короче 25 знаков', 'Скорее всего обрывок, а не текст: подпись, номер, одинокая ссылка.'],
		];
		var box = el('div', 'complaints');
		var clean = true;
		kinds.forEach(function (k) {
			var list = m.suspect[k[0]];
			if (!list.length) return;
			clean = false;
			box.appendChild(el('h4', null, k[1] + ' — ' + num(list.length) + ' ' + plural(list.length, 'абзац', 'абзаца', 'абзацев')));
			box.appendChild(el('p', 'why', k[2]));
			var t = table('suspect');
			list.slice(0, 8).forEach(function (s) {
				row(t, [s.where.charAt(0) === '/' ? link(s.where) : s.where, s.text.slice(0, 140) + (s.text.length > 140 ? '…' : '')]);
			});
			box.appendChild(t);
			if (list.length > 8) box.appendChild(el('p', 'why', 'и ещё ' + num(list.length - 8) + '.'));
		});
		if (m.duplicateUrls.length) {
			clean = false;
			box.appendChild(el('h4', null, 'один адрес дважды — ' + m.duplicateUrls.length));
			box.appendChild(el('p', 'why', m.duplicateUrls.slice(0, 8).join(', ')));
		}
		if (m.empty.length) {
			clean = false;
			box.appendChild(el('h4', null, 'страница без текста — ' + m.empty.length));
			box.appendChild(el('p', 'why', 'В указателе есть имя страницы, но ни одного абзаца: найти её можно только по названию.'));
			var t2 = table('suspect');
			m.empty.slice(0, 8).forEach(function (p) { row(t2, [link(p.url, p.title || p.url), '']); });
			box.appendChild(t2);
		}
		if (clean) box.appendChild(el('p', 'why', 'Ничего подозрительного: разметки, сущностей, повторов и пустых страниц нет.'));
		return box;
	}

	// One name for an index, used by its heading and by the contents alike —
	// a list whose wording differs from what it points at is a list you have
	// to read twice.
	function label(spec) {
		return spec.section ? spec.section + ' — ' + spec.url : spec.url;
	}

	// An address makes a stable anchor, and a readable one: the same index
	// keeps the same link from one reload to the next.
	function anchorOf(url) {
		return 'i-' + url.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
	}

	function report(box, spec, got, err) {
		box.appendChild(el('h2', null, label(spec)));
		if (err) {
			box.appendChild(el('p', 'failed', 'не удалось получить: ' + err.message));
			return null;
		}
		if (got.note) box.appendChild(el('p', 'failed', got.note));
		var m = measure(got.data);
		box.appendChild(facts(m, got, spec));
		var st = sectionsTable(m);
		if (st) { box.appendChild(el('h3', null, 'разделы')); box.appendChild(st); }
		box.appendChild(el('h3', null, 'самые большие страницы'));
		box.appendChild(biggestTable(m, 10));
		box.appendChild(el('h3', null, 'на что стоит посмотреть'));
		box.appendChild(complaints(m));
		return { m: m, got: got, spec: spec };
	}

	function totals(into, after, done) {
		if (done.length < 2) return;
		var t = table('facts');
		var pages = 0, blocks = 0, chars = 0, size = 0;
		done.forEach(function (d) {
			pages += d.m.pages; blocks += d.m.blocks; chars += d.m.chars;
			size += new Blob([d.got.text]).size;
		});
		row(t, ['указателей', String(done.length)]);
		row(t, ['страниц', num(pages)]);
		row(t, ['абзацев', num(blocks)]);
		row(t, ['текста', num(chars) + ' знаков']);
		row(t, ['разобранных', bytes(size)]);
		var box = el('section', 'index');
		box.appendChild(el('h2', null, 'всего'));
		box.appendChild(t);
		into.insertBefore(box, after.nextSibling);
	}

	function mount(opts) {
		var into = typeof opts.into === 'string' ? document.getElementById(opts.into) : opts.into;
		if (!into) return;
		into.textContent = '';
		var note = el('p', 'note', 'Считается по указателям, как их отдаёт сайт прямо сейчас, — не по сборке.');
		into.appendChild(note);

		/* The contents. Indexes run to a screenful each — facts, sections, the
		   largest pages, the complaints — and an index named in another's
		   `shards` is not visible from the top of the page at all. The list is
		   filled as the places are claimed, so it stands in the same order as
		   what it points at, and it is there before the first index has
		   arrived. */
		var toc = el('nav', 'toc');
		toc.appendChild(el('h2', null, 'Указатели'));
		var list = el('ul');
		toc.appendChild(list);
		into.appendChild(toc);

		var queue = (opts.sources || []).slice();
		var seen = Object.create(null);
		var done = [];
		var pending = 0;

		function take(spec) {
			if (!spec || !spec.url || seen[spec.url]) return;
			seen[spec.url] = 1;
			pending++;
			// The place for this index is claimed now, before it is fetched:
			// otherwise the indexes line up in the order they happen to
			// arrive, and the page reads differently on every reload.
			var box = el('section', 'index');
			box.id = anchorOf(spec.url);
			into.appendChild(box);
			var item = el('li');
			var jump = el('a', null, label(spec));
			jump.href = '#' + box.id;
			item.appendChild(jump);
			list.appendChild(item);
			fetchIndex(spec).then(function (got) {
				var r = report(box, spec, got, null);
				if (r) {
					done.push(r);
					// An index may name others; the page follows them so that
					// naming one source shows the whole set.
					(got.data.shards || []).forEach(take);
				}
			}).catch(function (err) {
				report(box, spec, null, err);
			}).then(function () {
				if (--pending === 0) { note.textContent += ' Готово.'; totals(into, toc, done); }
			});
		}

		queue.forEach(take);
	}

	global.SiteSearchStatus = { mount: mount };
})(window);
