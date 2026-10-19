/* Typing a symbol that is not on the keyboard, into a search box.
 *
 *     <script src="/sitesearch/search.js"></script>
 *     <script src="/sitesearch/symbols.js"></script>
 *
 * and `SiteSearch.mount` puts it on its own field; any other field takes it
 * with `SiteSymbols.attach(input)`.
 *
 * The search folds `\mu`, `μ` and `\[Mu]` to one spelling before it compares
 * anything (search.js, "formulas"), so the text is found whichever of them it
 * was written in. This is the other half of the same question, on the reader's
 * side: a search that finds what nobody can type is a search for people who
 * keep a character map open in another tab.
 *
 * It is pm's helper (SymbolInput, symbolPalette) brought to a page with no
 * framework, and it decides the same things the same way:
 *
 * - **What opens it** is a `\` followed by at least one letter, at the caret —
 *   the way the symbol is written in TeX, which is what anybody searching a
 *   site of formulas already knows. No hotkey: a combination is taken from
 *   whatever the browser or the site already does with it. A bare `\` opens
 *   nothing, and `\\l` is an escaped backslash.
 * - **What goes in** is the glyph, always: `λ`, not `\lambda`. The box is a
 *   query and not a document, the fold finds the same text by either, and of
 *   the two only one is also what the reader is looking at.
 * - **The catalogue** is the fold's own table, `SiteSearch.symbols`, read from
 *   it rather than copied: a symbol this helper could write and the fold had
 *   never heard of would be one the reader can type and then not find.
 * - **A grid as well as a list.** A list you can only query by name answers
 *   people who already know the name; the reader who wants φ and does not know
 *   TeX calls it `\varphi` opens the grid (the Σ beside the box) and looks.
 *   One cell per glyph, the aliases named under it, and the arrows move in two
 *   directions and clamp rather than wrap — a grid that wrapped would answer ↓
 *   on the last row by jumping to the top left, nowhere near where the reader
 *   was pointing.
 * - **What this reader types most** comes first, among names that match
 *   equally well, and heads the grid in a row of its own. It is counted in
 *   this browser and nowhere else; a browser that will not keep it gets the
 *   catalogue order, which is no loss.
 *
 * Arrows walk the list, Enter or Tab takes the symbol, Esc closes the list and
 * keeps it closed while the caret stays in that `\name`. The edit goes in as
 * typing does, so Cmd-Z takes the whole symbol back in one step.
 */
(function (global) {
	'use strict';

	var SAY = {
		ru: {
			grid: 'Символы',
			hint: 'Символ: наберите \\ и имя, например \\mu',
			frequent: 'Чаще всего',
		},
		en: {
			grid: 'Symbols',
			hint: 'A symbol: type \\ and its name, e.g. \\mu',
			frequent: 'Most used',
		},
		uk: {
			grid: 'Символи',
			hint: 'Символ: наберіть \\ та назву, наприклад \\mu',
			frequent: 'Найчастіше',
		},
	};

	var LIMIT = 8;
	var COLUMNS = 8;
	var KEPT = 'sitesearch.symbols';

	function catalogue(entries) {
		return (entries || (global.SiteSearch && global.SiteSearch.symbols) || [])
			.map(function (e) { return { name: e[0], char: e[1] }; });
	}

	/* The `\name` the caret sits at the end of: where its `\` is, and what was
	   typed after it — or null. */
	function token(text, caret) {
		var i = caret;
		while (i > 0 && /[A-Za-z]/.test(text.charAt(i - 1))) i--;
		var start = i - 1;
		if (start < 0 || text.charAt(start) !== '\\' || i === caret) return null;
		if (start > 0 && text.charAt(start - 1) === '\\') return null;
		return { start: start, end: caret, query: text.slice(i, caret) };
	}

	/* The entries a name asks for, best first: typed in full, then the names it
	   begins, then the same ignoring case — which is how `\OMEGA` still reaches
	   Ω, and how `\lam` puts `lambda` above `Lambda` without hiding it. Within
	   a tier what this reader uses most goes first, but never over a better
	   match: `\le` stays first for whoever types `\leq` more. */
	function matching(query, entries, usage) {
		var lower = query.toLowerCase();
		function rank(name) {
			if (name === query) return 0;
			if (name.lastIndexOf(query, 0) === 0) return 1;
			if (name.toLowerCase() === lower) return 2;
			if (name.toLowerCase().lastIndexOf(lower, 0) === 0) return 3;
			return -1;
		}
		return entries
			.map(function (e, order) { return { e: e, order: order, rank: rank(e.name) }; })
			.filter(function (r) { return r.rank >= 0; })
			.sort(function (a, b) {
				return a.rank - b.rank || (usage[b.e.char] || 0) - (usage[a.e.char] || 0) || a.order - b.order;
			})
			.slice(0, LIMIT)
			.map(function (r) { return r.e; });
	}

	// One cell per glyph, every name that reaches it kept on it.
	function cells(entries) {
		var by = Object.create(null), out = [];
		entries.forEach(function (e) {
			if (!by[e.char]) { by[e.char] = { char: e.char, names: [] }; out.push(by[e.char]); }
			by[e.char].names.push(e.name);
		});
		return out;
	}

	/* Where an arrow takes the grid's cursor, over rows that need not be full
	   (the row of the most used is as long as the reader has made it). A
	   column is kept where the row below has one, and the last cell taken
	   where it does not, or the tail of the catalogue is out of the arrow's
	   reach. */
	function move(index, key, rows) {
		var length = rows.reduce(function (a, b) { return a + b; }, 0);
		if (!length) return null;
		var at = Math.max(0, Math.min(length - 1, index));
		var row = 0, start = 0;
		while (row < rows.length - 1 && at >= start + rows[row]) start += rows[row++];
		var column = at - start;
		switch (key) {
			case 'ArrowRight': return Math.min(length - 1, at + 1);
			case 'ArrowLeft': return Math.max(0, at - 1);
			case 'ArrowDown':
				if (row === rows.length - 1) return length - 1;
				return start + rows[row] + Math.min(column, rows[row + 1] - 1);
			case 'ArrowUp':
				if (row === 0) return 0;
				return start - rows[row - 1] + Math.min(column, rows[row - 1] - 1);
			case 'Home': return 0;
			case 'End': return length - 1;
			default: return null;
		}
	}

	function usageRead() {
		try { return JSON.parse(global.localStorage.getItem(KEPT)) || {}; } catch (e) { return {}; }
	}

	function usageNote(usage, char) {
		usage[char] = (usage[char] || 0) + 1;
		try { global.localStorage.setItem(KEPT, JSON.stringify(usage)); } catch (e) { /* kept for this page only */ }
	}

	var STYLE = '' +
		'.sym-list,.sym-grid{position:fixed;z-index:2147483000;margin:0;padding:4px;list-style:none;' +
		'background:var(--sym-bg,Canvas);color:var(--sym-fg,CanvasText);' +
		'border:1px solid var(--sym-line,GrayText);border-radius:6px;' +
		'box-shadow:0 6px 24px rgba(0,0,0,.18);font:inherit;font-size:15px;max-width:calc(100vw - 16px);box-sizing:border-box}' +
		'.sym-list[hidden],.sym-grid[hidden]{display:none}' +
		'.sym-list li{display:flex;gap:12px;align-items:baseline;padding:4px 10px;border-radius:4px;cursor:pointer}' +
		'.sym-list li[aria-selected=true],.sym-grid button[aria-selected=true]{background:var(--sym-sel,Highlight);color:var(--sym-sel-fg,HighlightText)}' +
		'.sym-list .sym-char{min-width:1.4em;text-align:center;font-size:1.15em}' +
		'.sym-list .sym-name{font-family:ui-monospace,monospace;font-size:.85em;opacity:.8}' +
		'.sym-grid{display:grid;grid-template-columns:repeat(' + COLUMNS + ',2.2em);gap:2px}' +
		'.sym-grid button{all:unset;box-sizing:border-box;height:2.2em;text-align:center;line-height:2.2em;border-radius:4px;cursor:pointer;font-size:1.1em}' +
		'.sym-grid .sym-caption{grid-column:1/-1;font-family:ui-monospace,monospace;font-size:.8em;opacity:.8;padding:4px 2px 0;min-height:1.4em}' +
		'.sym-grid .sym-gap{grid-column:1/-1;height:0;border-top:1px solid var(--sym-line,GrayText);opacity:.4;margin:2px 0}' +
		'.sym-open{font:inherit;cursor:pointer;padding:0 .5em;margin-left:4px}';

	function styled() {
		if (document.getElementById('sym-style')) return;
		var st = document.createElement('style');
		st.id = 'sym-style';
		st.textContent = STYLE;
		document.head.insertBefore(st, document.head.firstChild);
	}

	var seq = 0;

	function attach(input, opts) {
		opts = opts || {};
		if (typeof input === 'string') input = document.getElementById(input);
		if (!input || input.symbols) return input && input.symbols;
		var lang = ((opts.lang !== undefined ? opts.lang : document.documentElement.getAttribute('lang')) || '').slice(0, 2).toLowerCase();
		var say_ = SAY[lang] || SAY.en;
		var entries = catalogue(opts.entries);
		if (!entries.length) return null;
		var usage = usageRead();
		styled();

		var id = 'sym-' + (++seq);
		var list = document.createElement('ul');
		list.className = 'sym-list';
		list.id = id;
		list.setAttribute('role', 'listbox');
		list.hidden = true;
		document.body.appendChild(list);

		input.setAttribute('aria-autocomplete', 'list');
		input.setAttribute('aria-controls', id);
		if (!input.title) input.title = say_.hint;

		var hits = [], active = 0, dismissed = null, tok = null;

		// Under the field where there is room, over it where there is not —
		// on a phone the keyboard takes the bottom half of the screen.
		function place(el) {
			var r = input.getBoundingClientRect();
			el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8)) + 'px';
			var below = window.innerHeight - r.bottom;
			if (below < el.offsetHeight + 8 && r.top > below) el.style.top = (r.top - el.offsetHeight - 4) + 'px';
			else el.style.top = (r.bottom + 4) + 'px';
		}

		function close() {
			list.hidden = true;
			input.removeAttribute('aria-activedescendant');
			input.setAttribute('aria-expanded', 'false');
		}

		function draw() {
			list.textContent = '';
			hits.forEach(function (e, i) {
				var li = document.createElement('li');
				li.id = id + '-' + i;
				li.setAttribute('role', 'option');
				li.setAttribute('aria-selected', i === active ? 'true' : 'false');
				var c = document.createElement('span');
				c.className = 'sym-char';
				c.textContent = e.char;
				var n = document.createElement('span');
				n.className = 'sym-name';
				n.textContent = '\\' + e.name;
				li.appendChild(c);
				li.appendChild(n);
				// mousedown, not click: a click would take the focus, and the
				// caret with it, before the symbol had anywhere to go.
				li.addEventListener('mousedown', function (ev) { ev.preventDefault(); pick(e); });
				list.appendChild(li);
			});
			list.hidden = false;
			input.setAttribute('aria-expanded', 'true');
			input.setAttribute('aria-activedescendant', id + '-' + active);
			place(list);
		}

		function update() {
			tok = input.selectionStart === input.selectionEnd ? token(input.value, input.selectionStart) : null;
			if (!tok || dismissed === tok.start) { if (!tok) dismissed = null; hits = []; close(); return; }
			hits = matching(tok.query, entries, usage);
			active = Math.min(active, Math.max(0, hits.length - 1));
			if (hits.length) draw(); else close();
		}

		/* Typed in, so that the browser keeps one undo step for it and the
		   field's own `input` listeners — the search — hear of it as they hear
		   of a key. `execCommand` is deprecated and still the one thing that
		   does both; where it is gone, the value is set and the event sent. */
		function put(start, end, piece) {
			input.focus();
			input.setSelectionRange(start, end);
			var done = false;
			try { done = document.execCommand('insertText', false, piece); } catch (e) { done = false; }
			if (!done) {
				input.setRangeText(piece, start, end, 'end');
				input.dispatchEvent(new Event('input', { bubbles: true }));
			}
		}

		function pick(e) {
			if (!tok) return;
			usageNote(usage, e.char);
			var t = tok;
			tok = null; hits = []; close();
			put(t.start, t.end, e.char);
		}

		input.addEventListener('input', function () { active = 0; update(); });
		input.addEventListener('click', update);
		input.addEventListener('keyup', function (ev) {
			if (/^(ArrowLeft|ArrowRight|Home|End)$/.test(ev.key)) update();
		});
		input.addEventListener('blur', function () { setTimeout(close, 0); });
		input.addEventListener('keydown', function (ev) {
			if (list.hidden || !hits.length) return;
			if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
				active = (active + (ev.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length;
				draw();
			} else if (ev.key === 'Enter' || ev.key === 'Tab') {
				pick(hits[active]);
			} else if (ev.key === 'Escape') {
				dismissed = tok && tok.start;
				close();
			} else return;
			// The list had the key: the palette's own arrows and Enter, a
			// form's submit, the dialog's Esc must not have it as well.
			ev.preventDefault();
			ev.stopImmediatePropagation();
		}, true);
		window.addEventListener('resize', function () { if (!list.hidden) place(list); });
		window.addEventListener('scroll', function () { if (!list.hidden) place(list); }, true);

		// --- the grid ---

		var grid = null, opener = null;
		if (opts.grid !== false) {
			opener = document.createElement('button');
			opener.type = 'button';
			opener.className = 'sym-open';
			opener.textContent = 'Σ';
			opener.title = say_.grid;
			opener.setAttribute('aria-label', say_.grid);
			opener.setAttribute('aria-haspopup', 'grid');
			input.parentNode.insertBefore(opener, input.nextSibling);
			// The caret is where the symbol will go, and opening the grid must
			// not take it away.
			opener.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
			opener.addEventListener('click', function () { grid && !grid.hidden ? shut() : open(); });
		}

		var at = 0, shown = [], rows = [], caret = 0;

		function open() {
			if (!grid) {
				grid = document.createElement('div');
				grid.className = 'sym-grid';
				grid.setAttribute('role', 'grid');
				grid.setAttribute('aria-label', say_.grid);
				grid.tabIndex = -1;
				grid.addEventListener('keydown', gridKey);
				grid.addEventListener('focusout', function (ev) {
					if (!grid.contains(ev.relatedTarget) && ev.relatedTarget !== opener) shut(true);
				});
				document.body.appendChild(grid);
			}
			caret = input.selectionStart || input.value.length;
			var all = cells(entries);
			var frequent = all.filter(function (c) { return usage[c.char]; })
				.sort(function (a, b) { return usage[b.char] - usage[a.char]; })
				.slice(0, COLUMNS);
			shown = frequent.concat(all);
			rows = [];
			if (frequent.length) rows.push(frequent.length);
			for (var left = all.length; left > 0; left -= COLUMNS) rows.push(Math.min(COLUMNS, left));
			grid.textContent = '';
			if (frequent.length) {
				var head = document.createElement('div');
				head.className = 'sym-caption';
				head.textContent = say_.frequent;
				grid.appendChild(head);
			}
			shown.forEach(function (c, i) {
				if (i === frequent.length && frequent.length) {
					var gap = document.createElement('div');
					gap.className = 'sym-gap';
					grid.appendChild(gap);
				}
				var b = document.createElement('button');
				b.type = 'button';
				b.tabIndex = -1;
				b.textContent = c.char;
				b.setAttribute('role', 'gridcell');
				b.setAttribute('aria-label', c.names.map(function (n) { return '\\' + n; }).join(' '));
				b.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
				b.addEventListener('click', function () { take(i); });
				b.addEventListener('mouseenter', function () { focusCell(i); });
				grid.appendChild(b);
			});
			var caption = document.createElement('div');
			caption.className = 'sym-caption';
			grid.appendChild(caption);
			grid.hidden = false;
			opener.setAttribute('aria-expanded', 'true');
			place(grid);
			focusCell(0);
		}

		function focusCell(i) {
			at = i;
			var buttons = grid.querySelectorAll('button');
			for (var k = 0; k < buttons.length; k++) buttons[k].setAttribute('aria-selected', k === i ? 'true' : 'false');
			buttons[i].focus();
			grid.lastChild.textContent = shown[i].names.map(function (n) { return '\\' + n; }).join(' · ');
		}

		function take(i) {
			var c = shown[i];
			usageNote(usage, c.char);
			shut();
			var end = input.selectionEnd === input.selectionStart ? caret : input.selectionEnd;
			put(caret, Math.max(caret, end), c.char);
		}

		function shut(stay) {
			if (!grid || grid.hidden) return;
			grid.hidden = true;
			opener.setAttribute('aria-expanded', 'false');
			if (!stay) input.focus();
		}

		function gridKey(ev) {
			var to = move(at, ev.key, rows);
			if (to !== null) focusCell(to);
			else if (ev.key === 'Enter' || ev.key === ' ') take(at);
			else if (ev.key === 'Escape') shut();
			else return;
			ev.preventDefault();
			ev.stopPropagation();
		}

		var handle = { close: close, open: open, shut: shut };
		input.symbols = handle;
		return handle;
	}

	global.SiteSymbols = { attach: attach, token: token, matching: matching, move: move, say: SAY };
})(typeof globalThis !== 'undefined' ? globalThis : window);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.SiteSymbols;
