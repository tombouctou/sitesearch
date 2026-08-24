/* Поиск по статическому сайту, целиком в браузере.
 *
 * Страница даёт полю ввода, строке состояния и списку находок их узлы и
 * перечисляет указатели, по которым искать:
 *
 *     SiteSearch.mount({
 *         input: 'q', status: 'status', results: 'results',
 *         sources: [{ url: '/search-index.json' }],
 *     });
 *
 * Указатель — статический JSON, собранный заранее; его договор описан в
 * FORMAT.md и одинаков для всех сборщиков. Откуда взялся текст — из дерева
 * HTML, из страниц Jekyll, из чего-то третьего, — здесь неизвестно и не
 * нужно: страница, её имя, куски текста на ней.
 *
 * Указатель может назвать в своём `shards` другие указатели, которые надо
 * искать вместе с ним, — так состав сайта задаёт сборщик, а не переписывает
 * каждая страница поиска. Источник с `defer` не запрашивается, пока никто не
 * ищет: мегабайт книги незачем везти тому, кто зашёл мимоходом.
 *
 * Порядок находок — `order` источника и страницы, а внутри страницы порядок
 * блоков. Релевантность здесь не считается: на сайте такого размера порядок
 * полок полезнее догадки о том, какой абзац лучше.
 */
(function (global) {
	'use strict';

	/* Диакритику сворачиваем с обеих сторон: ищущий наберёт «rangapuja»,
	   а в тексте стоит «raṅgapūjā». NFD разбивает букву на основу и
	   знак, знак выбрасываем. Длина строки при этом не меняется —
	   на ней держится подсветка совпадений, — потому что каждый
	   составной знак даёт ровно одну основу. */
	function norm(s) {
		return s.toLowerCase()
			.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
			.replace(/ё/g, 'е');
	}

	/* Совпадение начинается там, где начинается слово. Иначе «страх»
	   укорачивается до «стра» и вытаскивает «от·стра·нение» — на тексте книги
	   это было сто лишних абзацев из двухсот сорока. */
	var LETTER = /[a-zа-я0-9]/;

	function occurrence(haystack, t, from) {
		var at = haystack.indexOf(t, from);
		while (at !== -1) {
			if (at === 0 || !LETTER.test(haystack.charAt(at - 1))) return at;
			at = haystack.indexOf(t, at + 1);
		}
		return -1;
	}

	/* Русский меняет окончания, и «тело» обязано находить «тела». Половину
	   работы делает само совпадение с начала слова: когда в тексте букв
	   больше, чем в запросе, искать нечего — «джхана» и так найдёт
	   «джханами». Остаётся обратный случай, когда лишние буквы в запросе, а
	   в русском это конечная гласная или мягкий знак: «тело» должно потерять
	   «о». Отсюда короткая лесенка — слово, затем до двух срезанных
	   окончаний, но не короче трёх букв.

	   Резать глубже — ровно то, что движок делал раньше (четыре буквы с
	   любого слова), и ровно то, из-за чего «страх» находил «страдание».
	   Заодно видно, почему не годится и список окончаний: «страх»
	   заканчивается на «ах» и был бы обрезан до «стр». */
	var SOFT = /[аеиоуыэюяьий]$/;
	var PLURAL = /[a-z]{4,}s$/;

	function ladder(t) {
		var v = [t];
		// В английском той же цели хватает одного «s».
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
		// И на правом краю тоже: слово, попавшее на границу окна, иначе
		// подсвечивается огрызком — «джх» вместо «джханы».
		while (end < text.length && LETTER.test(hay.charAt(end))) end++;

		var cursor = start;
		if (start > 0) frag.appendChild(document.createTextNode('…'));

		spans.forEach(function (s) {
			if (s[1] <= cursor || s[0] >= end) return;
			if (s[0] > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, s[0])));
			// Два слова запроса могут накрыть одно слово текста; тогда второе
			// начинается раньше, чем кончилось первое, и повторять уже
			// выведенное нельзя.
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

	/* Единица указателя — страница: адрес, имя и куски текста на ней. Блок,
	   у которого нет ни якоря, ни заголовка над ним, можно писать просто
	   строкой — так короче, и сборщику на Liquid не приходится городить
	   скобки. Всё остальное движок про источник не знает: дерево HTML,
	   страницы Jekyll и что угодно ещё приходят сюда одинаковыми.

	   `section` и `order` источник может назвать за всю пачку сразу — так
	   страница поиска по книге подписывает все её главы «Глава», не трогая
	   указатель. Порядок при этом остаётся за страницей, когда она его знает:
	   разделы перечислены в сборщике, и спорить с ним неоткуда. */
	function documentsOf(data, spec) {
		return (data.pages || []).map(function (p) {
			return {
				url: p.url,
				title: p.title,
				// Второе имя ищется наравне с первым: оглавление сокращает
				// «3. Концентрация: второе упражнение» до «3. Концентрация».
				also: p.also || null,
				section: spec.section || p.section || null,
				order: typeof p.order === 'number' ? p.order : (spec.order || 0),
				blocks: (p.blocks || [])
					.map(function (b) { return typeof b === 'string' ? { text: b } : b; })
					.filter(function (b) { return b && b.text; }),
			};
		});
	}

	/* Абзац, стоящий слово в слово на многих страницах, — это обвязка раздела,
	   а не его содержание: врезка «как читать эти страницы», одно и то же
	   оглавление. В выдаче он забивает настоящие попадания, повторяясь
	   столько раз, на скольких страницах стоит.

	   Сборщик, который держит страницу целиком, срезает обвязку сам, по
	   разметке (см. node/html.js). Сборщику на Liquid нечем: регулярных
	   выражений там нет, а повторов он и подавно не считает. Тогда счёт
	   поручается движку — `repeats: 4` выбросит блок, встреченный на четырёх
	   страницах и более. Ниже четырёх опускать нельзя: два-три одинаковых
	   абзаца вполне бывают и в настоящем тексте. По умолчанию правило
	   выключено: где обвязку снял сборщик, лишний проход по указателю ни к
	   чему. */
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
		docs.forEach(function (doc) {
			doc.blocks = doc.blocks.filter(function (b) { return n[b.text] < threshold; });
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

		/* Рядом с указателем может лежать он же, сжатый заранее: те же данные
		   втрое легче, чем сжатые на лету. Тогда источник помечен
		   `precompressed`, и мы просим сначала «.br».

		   Хостинг при этом обязан отдавать его с content-encoding: br (на
		   Vercel это делается в vercel.json). Возврат к обычному файлу — не
		   перестраховка: заголовок ставит хостинг, и если он однажды
		   перестанет, браузер отдаст нам сырые байты brotli, r.json()
		   споткнётся, и поиск обязан продолжить работать, а не онеметь.

		   Там, где сжатой копии нет — GitHub Pages жмёт сам и положить её
		   рядом некуда, — просить её незачем: это лишний запрос и лишний 404
		   в консоли на каждый указатель. */
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

		/* Свёрнутый текст считается один раз на блок и запоминается: он не
		   меняется, а гонять NFD по полумегабайту на каждое нажатие клавиши —
		   работа впустую. Заголовок раздела складывается с абзацем здесь же:
		   искать надо и по нему, а показывать всё равно абзац. */
		function folded(b) {
			if (b.fold === undefined) b.fold = norm((b.section || '') + ' ' + b.text);
			return b.fold;
		}

		function foldedTitle(doc) {
			if (doc.fold === undefined) doc.fold = norm(doc.title + ' ' + (doc.also || ''));
			return doc.fold;
		}

		// Наполняет список и говорит, сколько нашлось. Вызывается второй раз с
		// расширенным запросом, когда первый проход пуст.
		function collect(ts) {
			results.textContent = '';
			var found = 0, shown = 0;

			documents().forEach(function (doc) {
				// A page whose name matches is itself a result — otherwise
				// searching "индрии" finds nothing on a chapter that keeps
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

		// Встречается ли такое начало слова хоть где-нибудь.
		function occurs(t) {
			return documents().some(function (doc) {
				if (occurrence(foldedTitle(doc), t, 0) !== -1) return true;
				return doc.blocks.some(function (b) { return occurrence(folded(b), t, 0) !== -1; });
			});
		}

		/* Запасное правило: точное не нашло ничего — значит, набрали форму,
		   которой в тексте нет («страхами», «касинового»). Отрезаем от слова
		   по букве и останавливаемся на первой, которая вообще встречается:
		   «страхами» доходит до «страха» и дальше не идёт, так что «стра» —
		   а с ним «страдание» и «страница» — не понадобится. Отрезать вслепую
		   до заранее выбранной длины и значило бы вернуть ту самую ошибку,
		   ради которой всё затевалось. */
		function widen(q) {
			return words(q).map(function (t) {
				for (var len = t.length - 1; len >= 4; len--) {
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
			// Пусто — скорее всего набрали форму, до которой точное правило не
			// достаёт. Пока указатель ещё едет, «пусто» означает всего лишь
			// «ещё не приехало», и торопиться незачем.
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
			// Пока не пришёл ни один указатель, искать нечем; когда часть уже
			// на руках, находки показаны, а остальное подгружается.
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
