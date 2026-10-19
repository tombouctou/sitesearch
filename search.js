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
	var WHOLE = /[\u2190-\u2aff]/;   // arrows and operators, left as they stand
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
			// An operator keeps its stroke: NFD would turn `≠` into `=`.
			else if (WHOLE.test(c)) piece = c;
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

	/* --- formulas ----------------------------------------------------------

	   A formula is written four ways and read as one. `\omega_g`, `ω_g`,
	   `\omega_{g}`, `ω_{g}`: a page writes one of them, a reader types
	   another, and a search that compares strings finds one search in four.
	   So both sides are folded to one spelling before anything is compared,
	   the text and the query alike. Folding only the query would fix the half
	   of the cases where the reader happens to type the other spelling, which
	   to the reader is a coin toss.

	   The spelling folded to is the glyph: `\mu` becomes `μ`, `\to` `→`,
	   Mathematica's `\[Mu]` `μ` as well, and `^{μ}` is `^μ`. A glyph is one
	   character, and it is what the reader sees on the page. A bare name is
	   **not** folded in the text: `omega` stays `omega`. A backslash says
	   "this is a symbol" and nothing else is spelled that way, but `eta` is
	   also the end of `beta`, and a text in which every "eta" had turned into
	   η would stop answering the plain word. A bare name typed *as a query*
	   is offered the glyph as well, because that costs the text nothing.

	   This is the fold pm makes for its wiki (MathFold.cs), with the table
	   widened for physics and one rule of its own: inside a formula spaces
	   mean nothing. TeX ignores them — `\bar{\gamma}^{\mu}\bar{\gamma}^{\nu}`
	   and `\bar{\gamma}^{\mu} \bar{\gamma}^{\nu}` are one formula — so a
	   formula in the query is also looked for with its spaces, carets,
	   underscores and braces taken out, against the formulas of the text with
	   theirs taken out. Outside a formula a space still parts two words: `ω g`
	   in prose is two words, and gluing them would answer `ωg` with prose
	   that never said it. That is why the fold has to know where a formula
	   is, which is what its fences say: `$…$` by Pandoc's rules, `$$…$$`,
	   `\(…\)`, `\[…\]`.

	   What the tables hold is also exactly what the symbol helper offers
	   (symbols.js): a symbol the helper could write and the fold had never
	   heard of would be one the reader can type and then not find. */
	var SYMBOLS = [
		['alpha', 'α'], ['beta', 'β'], ['gamma', 'γ'], ['delta', 'δ'],
		['epsilon', 'ε'], ['varepsilon', 'ε'], ['zeta', 'ζ'], ['eta', 'η'],
		['theta', 'θ'], ['vartheta', 'θ'], ['iota', 'ι'], ['kappa', 'κ'],
		['lambda', 'λ'], ['mu', 'μ'], ['nu', 'ν'], ['xi', 'ξ'], ['omicron', 'ο'],
		['pi', 'π'], ['varpi', 'π'], ['rho', 'ρ'], ['varrho', 'ρ'],
		['sigma', 'σ'], ['varsigma', 'σ'], ['tau', 'τ'], ['upsilon', 'υ'],
		['phi', 'φ'], ['varphi', 'φ'], ['chi', 'χ'], ['psi', 'ψ'], ['omega', 'ω'],
		['Gamma', 'Γ'], ['Delta', 'Δ'], ['Theta', 'Θ'], ['Lambda', 'Λ'],
		['Xi', 'Ξ'], ['Pi', 'Π'], ['Sigma', 'Σ'], ['Upsilon', 'Υ'],
		['Phi', 'Φ'], ['Psi', 'Ψ'], ['Omega', 'Ω'],

		// The big operators get glyphs of their own, not the Greek capitals:
		// the fold lowers the case, and Σ would come out as σ.
		['sum', '∑'], ['prod', '∏'], ['int', '∫'], ['oint', '∮'],
		['partial', '∂'], ['nabla', '∇'], ['infty', '∞'], ['sqrt', '√'],
		['hbar', 'ħ'], ['ell', 'ℓ'], ['dagger', '†'],

		// `\cdot` is the dot operator and not the middle dot: html.js parts
		// the cells of a table row with ` · `, and a search for a product
		// would otherwise stop at every row of every table.
		['times', '×'], ['cdot', '⋅'], ['div', '÷'], ['pm', '±'], ['mp', '∓'],
		['leq', '≤'], ['le', '≤'], ['geq', '≥'], ['ge', '≥'],
		['neq', '≠'], ['ne', '≠'], ['approx', '≈'], ['sim', '∼'], ['simeq', '≃'],
		['equiv', '≡'], ['propto', '∝'], ['in', '∈'], ['notin', '∉'],
		['subset', '⊂'], ['subseteq', '⊆'], ['cup', '∪'], ['cap', '∩'],
		['forall', '∀'], ['exists', '∃'], ['land', '∧'], ['wedge', '∧'],
		['lor', '∨'], ['vee', '∨'], ['neg', '¬'], ['otimes', '⊗'], ['oplus', '⊕'],
		['perp', '⊥'], ['parallel', '∥'],
		['to', '→'], ['rightarrow', '→'], ['longrightarrow', '→'],
		['leftarrow', '←'], ['gets', '←'], ['leftrightarrow', '↔'],
		['Rightarrow', '⇒'], ['Leftrightarrow', '⇔'], ['mapsto', '↦'],
		['langle', '⟨'], ['rangle', '⟩'],
		['ldots', '…'], ['dots', '…'], ['cdots', '…'],
	];

	var COMMAND = Object.create(null);
	SYMBOLS.forEach(function (e) { COMMAND[e[0]] = e[1]; });

	/* Mathematica writes the same letters as `\[Mu]`, `\[CapitalGamma]`,
	   `\[CurlyPhi]` — and a page of FeynCalc code is full of `GA[\[Mu]]`. The
	   names are made from the table above rather than written out again. */
	var NAMED = Object.create(null);
	var LETTERS = SYMBOLS.filter(function (e) { return /[\u0370-\u03ff]/.test(e[1]); });
	LETTERS.forEach(function (e) {
		var n = e[0], cap = n.charAt(0).toUpperCase() + n.slice(1);
		if (n.charAt(0) !== n.charAt(0).toLowerCase()) NAMED['Capital' + n] = e[1];
		else if (n.lastIndexOf('var', 0) === 0) NAMED['Curly' + n.charAt(3).toUpperCase() + n.slice(4)] = e[1];
		else NAMED[cap] = e[1];
	});
	NAMED.FinalSigma = 'σ';
	NAMED.Rule = '→'; NAMED.RuleDelayed = '→'; NAMED.Infinity = '∞';
	NAMED.PartialD = '∂'; NAMED.Element = '∈'; NAMED.LessEqual = '≤';
	NAMED.GreaterEqual = '≥'; NAMED.NotEqual = '≠'; NAMED.Times = '×';
	NAMED.Dagger = '†'; NAMED.HBar = 'ħ'; NAMED.Sqrt = '√';

	// The bare names a query may spell a Greek letter with: `alpha_s`.
	var GREEK = Object.create(null);
	LETTERS.forEach(function (e) {
		if (e[0] === e[0].toLowerCase() && e[0].lastIndexOf('var', 0) !== 0) GREEK[e[0]] = e[1];
	});

	/* Commands that say how a formula looks and not what it says: the size
	   of a bracket, a font, a space. `\left(` is a bracket and `\mathrm{d}`
	   a d. They are dropped, and their braces with them further down. */
	var SILENT = Object.create(null);
	('left right big Big bigg Bigg bigl bigr Bigl Bigr biggl biggr Biggl Biggr ' +
		'displaystyle textstyle scriptstyle limits nolimits ' +
		'mathrm mathbf mathit mathsf mathtt boldsymbol bm operatorname ' +
		'text textrm textit textbf textsf texttt textnormal mbox ' +
		'quad qquad medspace thinspace thickspace negthinspace').split(' ')
		.forEach(function (n) { SILENT[n] = 1; });

	/* Accents. `\bar{\gamma}^{\mu}` is FeynCalc's four-dimensional γ^μ and
	   `\gamma^{\mu}` its D-dimensional one, and a reader who types `γ^μ`
	   is asking about both: so an accent stays in the text, where `\bar{γ}`
	   typed finds exactly the barred one, and leaves the formula squeezed. */
	var ACCENT = Object.create(null);
	('bar overline underline hat widehat tilde widetilde vec dot ddot acute grave ' +
		'check breve mathring overrightarrow overleftarrow overleftrightarrow slashed')
		.split(' ').forEach(function (n) { ACCENT[n] = 1; });

	var SUPER = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5',
		'⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-', '⁼': '=',
		'⁽': '(', '⁾': ')', 'ⁿ': 'n', 'ⁱ': 'i' };
	var SUB = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5',
		'₆': '6', '₇': '7', '₈': '8', '₉': '9', '₊': '+', '₋': '-', '₌': '=',
		'₍': '(', '₎': ')', 'ₐ': 'a', 'ₑ': 'e', 'ₒ': 'o', 'ₓ': 'x', 'ₕ': 'h',
		'ₖ': 'k', 'ₗ': 'l', 'ₘ': 'm', 'ₙ': 'n', 'ₚ': 'p', 'ₛ': 's', 'ₜ': 't' };

	// One letter written two ways by Unicode itself.
	var ALIAS = { 'ϵ': 'ε', 'ϑ': 'θ', 'ϕ': 'φ', 'ϖ': 'π', 'ϱ': 'ρ', 'ς': 'σ',
		'µ': 'μ', 'ℏ': 'ħ', '−': '-', '⟶': '→', '⟵': '←', '⋯': '…', '∙': '⋅' };

	/* The characters of formulas: Greek, letterlike symbols, arrows, the
	   mathematical operators. They pass through the fold untouched — NFD
	   would take `≠` apart into `=` and a stroke and then throw the stroke
	   away — and each is a word of its own, so that `μ` is found inside `μν`
	   and a two-tier map can name the chunks holding it. */
	var GLYPH = /[Ͱ-Ͽ℀-⅏←-⏿⟀-⟿⤀-⫿±×÷¬†‡…√∞ħ]/;
	var GLYPHS = new RegExp(GLYPH.source, 'g');

	// Anything at all for the fold below to do: everything else is left alone,
	// which is nearly every paragraph of nearly every site.
	var TEXISH = /[\\$^_{}~¹²³µ⁰-₟−ςϑϕϖϱϵℏ⟵⟶⋯∙]|->/;

	/* Where a formula opens at `i`: how long its opening fence is, where its
	   closing one stands and how long that is — or null.

	   `$` by Pandoc's rules, which are the ones that let money survive: the
	   opening `$` is not followed by a space, the closing one is not preceded
	   by one nor followed by a digit, and `\$` is always a dollar. "$5 and
	   $10" is two amounts. */
	function fenceAt(s, i) {
		var c = s.charAt(i), d = s.charAt(i + 1), end;
		if (c === '\\' && (d === '(' || d === '[')) {
			if (i > 0 && s.charAt(i - 1) === '\\') return null;
			end = s.indexOf(d === '(' ? '\\)' : '\\]', i + 2);
			return end > i + 2 ? { open: 2, end: end, shut: 2 } : null;
		}
		if (c !== '$' || (i > 0 && s.charAt(i - 1) === '\\')) return null;
		if (d === '$') {
			end = s.indexOf('$$', i + 2);
			return end > i + 2 ? { open: 2, end: end, shut: 2 } : null;
		}
		if (!d || /\s/.test(d)) return null;
		for (var j = i + 2; j < s.length; j++) {
			if (s.charAt(j) !== '$' || s.charAt(j - 1) === '\\') continue;
			if (/\s/.test(s.charAt(j - 1))) continue;
			if (/[0-9]/.test(s.charAt(j + 1))) continue;
			return { open: 1, end: j, shut: 1 };
		}
		return null;
	}

	// One symbol at `i`: a command of the table, a Mathematica name, or a
	// single character — what it folds to and where it ends. TeX eats the one
	// space that ends a command's name (`\omega g` is ωg), so this eats it too.
	function symbolAt(s, i) {
		var c = s.charAt(i);
		if (c !== '\\') return c && c !== '{' && c !== '}' ? { piece: c, end: i + 1 } : null;
		if (s.charAt(i + 1) === '[') {
			var m = /^\\\[([A-Za-z]+)\]/.exec(s.slice(i, i + 40));
			return m && NAMED[m[1]] ? { piece: NAMED[m[1]], end: i + m[0].length } : null;
		}
		var j = i + 1;
		while (j < s.length && /[A-Za-z]/.test(s.charAt(j))) j++;
		var g = COMMAND[s.slice(i + 1, j)];
		if (!g) return null;
		return { piece: g, end: s.charAt(j) === ' ' ? j + 1 : j };
	}

	/* TeX, Mathematica's names and Unicode's variants folded to glyphs, with
	   for every character of the result where it came from, which fenced
	   formula it stands in (0 outside any), and whether it is an accent's
	   name. Null where there is nothing to fold. */
	function texFold(s) {
		if (!TEXISH.test(s)) return null;
		var out = [], map = [], inside = [], accents = [], n = s.length;
		var close = -1, shut = 0, formula = 0, number = 0;

		function emit(piece, from, accent) {
			for (var k = 0; k < piece.length; k++) {
				out.push(piece.charAt(k));
				map.push(from);
				inside.push(formula);
				accents.push(accent ? 1 : 0);
			}
		}

		for (var i = 0; i < n;) {
			var c = s.charAt(i), d = s.charAt(i + 1);
			if (close < 0) {
				var f = fenceAt(s, i);
				// A fence is a space: `x$y$` is not the word "xy".
				if (f) { emit(' ', i); formula = ++number; close = f.end; shut = f.shut; i += f.open; continue; }
			} else if (i >= close) {
				formula = 0; emit(' ', i); i = close + shut; close = -1;
				continue;
			}
			// A tilde is TeX's unbreakable space.
			if (formula && c === '~') { emit(' ', i); i++; continue; }
			if (c === '\\') {
				var sym = symbolAt(s, i);
				if (sym) { emit(sym.piece, i); i = sym.end; continue; }
				if (/[A-Za-z]/.test(d)) {
					var j = i + 1;
					while (j < n && /[A-Za-z]/.test(s.charAt(j))) j++;
					var name = s.slice(i + 1, j);
					if (SILENT[name]) {
						// `\left.` is no bracket at all.
						if ((name === 'left' || name === 'right') && s.charAt(j) === '.') j++;
						i = j;
						continue;
					}
					emit(s.slice(i, j), i, ACCENT[name]);
					i = j;
					continue;
				}
				// `\,` and its kind are spaces; `\{` and its kind the character.
				if (/[,;:! ]/.test(d)) { i += 2; continue; }
				if (/[{}$%&_#]/.test(d)) { emit(d, i + 1); i += 2; continue; }
			}
			// `_{g}` is `_g`, and `^{\mu}` is `^μ`. Only a single symbol inside
			// the braces: `_{gk}` and `_gk` are different formulas.
			if ((c === '^' || c === '_') && d === '{') {
				var one = symbolAt(s, i + 2);
				if (one && s.charAt(one.end) === '}') { emit(c, i); emit(one.piece, i + 2); i = one.end + 1; continue; }
			}
			if (SUPER[c]) { emit('^' + SUPER[c], i); i++; continue; }
			if (SUB[c]) { emit('_' + SUB[c], i); i++; continue; }
			if (ALIAS[c]) { emit(ALIAS[c], i); i++; continue; }
			if (c === '-' && d === '>') { emit('→', i); i += 2; continue; }
			emit(c, i);
			i++;
		}
		map.push(n);
		return { text: out.join(''), map: map, inside: inside, accents: accents };
	}

	/* Which words of a run of words are a formula, by the rule a query is read
	   by and a text alike — the one rule, so that whatever a query takes for a
	   formula is looked for where the text has one.

	   A word looks like a piece of a formula when it holds a glyph, a TeX
	   command, a caret, an underscore, a brace, a relation, or a minus that is
	   not a hyphen: `e-` and `e+e-` do, `Klein-Gordon` and «по-японски» do not.
	   A lone letter or digit beside such a word is a symbol of it (`e γ → e γ`).
	   And neighbours run together into one formula, spaces and all — `e+ e- →
	   μ+ μ-` is one, not five words each to be found anywhere.

	   The words come folded, and in as `{ text }`; `fixed` marks one whose say
	   is already had (a formula the reader fenced, which joins nothing). What
	   comes out is the runs, as pairs of indexes, the second past the end. */
	var SIGNED = new RegExp(/[\\^_{}=+<>|]/.source + '|' + GLYPH.source + '|' + /(^|[^a-zа-я0-9])-|-($|[^a-zа-я0-9])/.source);
	var LONE = /^[a-zа-я0-9]$/;

	function runsOf(toks) {
		toks.forEach(function (k) { if (k.math === undefined) k.math = SIGNED.test(k.text); });
		for (var pass = 0; pass < 2; pass++) {
			for (var i = 0; i < toks.length; i++) {
				var it = toks[pass ? toks.length - 1 - i : i];
				var next = toks[pass ? toks.length - 2 - i : i + 1];
				if (!it.math && next && next.math && !next.fixed && LONE.test(it.text)) it.math = true;
			}
		}
		var out = [];
		for (var k = 0; k < toks.length; k++) {
			if (!toks[k].math) continue;
			var from = k;
			while (!toks[k].fixed && toks[k + 1] && toks[k + 1].math && !toks[k + 1].fixed) k++;
			out.push([from, k + 1]);
		}
		return out;
	}

	/* A text as it is searched: folded, and its formulas once more, squeezed
	   — no spaces, carets, underscores, braces or accents — parted from each
	   other by a character no query holds, with where each of their
	   characters stands in the folded text. A formula is what the text fenced,
	   and also, outside the fences, a run of words that looks like one
	   (`runsOf`): `GA[\[Mu]]` in code, `e+e- → μ+μ-` in a sentence. `want`
	   adds the map back to the original, which only a snippet needs. */
	var SQUEEZE = /[\s^_{}]/;
	var TOKEN = /\S+/g;

	function record(s, want) {
		var t = texFold(s), f, text;
		if (t) { f = foldMap(t.text, true); text = f.text; }
		else if (want) { f = foldMap(s, true); text = f.text; }
		else text = norm(s);
		var r = { text: text, sq: null, sqAt: null };
		if (want) r.map = t ? f.map.map(function (k) { return t.map[k]; }) : f.map;

		var fenced = t && t.inside.some(function (x) { return x; });
		if (!fenced && !SIGNED.test(text)) return r;

		// Which formula each character of the folded text is in: a fenced one
		// by its number, a run of words by one past the last of those.
		var id = new Array(text.length), skip = new Array(text.length), j;
		var prose = text;
		for (j = 0; j < text.length; j++) {
			var src = t ? f.map[j] : -1;
			id[j] = src >= 0 ? t.inside[src] : 0;
			skip[j] = src >= 0 && t.accents[src];
		}
		if (fenced) prose = text.replace(/[\s\S]/g, function (c, k) { return id[k] ? ' ' : c; });
		var toks = [], m, base = 1 + (t ? t.inside.reduce(function (a, b) { return Math.max(a, b); }, 0) : 0);
		TOKEN.lastIndex = 0;
		while ((m = TOKEN.exec(prose))) toks.push({ text: m[0], at: m.index });
		runsOf(toks).forEach(function (run, n) {
			var a = toks[run[0]].at, last = toks[run[1] - 1];
			for (var k = a; k < last.at + last.text.length; k++) id[k] = base + n;
		});

		var sq = '', at = [], was = 0;
		for (j = 0; j < text.length; j++) {
			var c = text.charAt(j);
			if (!id[j] || skip[j] || SQUEEZE.test(c)) continue;
			if (id[j] !== was && sq) { sq += '\u0001'; at.push(j); }
			was = id[j];
			sq += c;
			at.push(j);
		}
		if (sq) { r.sq = sq; r.sqAt = at; }
		return r;
	}

	/* The words a two-tier map lists for a piece of text (node/two-tier.js
	   takes them from here, so that the map and the engine cannot disagree).
	   A word is a run of letters and digits, as before, and a glyph is a word
	   of its own. A formula is listed once more as it is matched, squeezed:
	   each pair of neighbours in it, with a `$` in front — `$e+`, `$→μ`. No
	   query word begins with `$`.

	   Pairs and not letters alone, because the letters alone filter nothing
	   on a site of formulas: `e`, `→` and `μ` stand together in a third of
	   FeynCalc's manual, and `e+e- → μ+μ-` read forty chunks of it and gave
	   up. The pairs cost the map of that manual about 55 KB compressed and
	   cost a site without formulas nothing. A formula of one character is
	   not listed: a glyph is a word already, and anything else of one
	   character (`+`) is in too many formulas to be worth a list. */
	var RUN = /[a-zа-я0-9]+/g;

	function vocabulary(s) {
		var r = record(s, false), seen = Object.create(null), m;
		RUN.lastIndex = 0;
		while ((m = RUN.exec(r.text))) seen[m[0]] = 1;
		GLYPHS.lastIndex = 0;
		while ((m = GLYPHS.exec(r.text))) seen[m[0]] = 1;
		for (var i = 0; r.sq && i < r.sq.length; i++) {
			var c = r.sq.charAt(i), d = r.sq.charAt(i + 1);
			if (c === '\u0001') continue;
			if (d && d !== '\u0001') seen['$' + c + d] = 1;
		}
		return Object.keys(seen);
	}

	/* A match begins where a word begins. Otherwise «страх» (fear) is
	   shortened to a stem that also sits inside «от·стра·нение»
	   (detachment) — on the text of a book that was a hundred paragraphs of
	   rubbish out of two hundred and forty. */
	var LETTER = /[a-zа-я0-9]/;

	function occurrence(haystack, t, from) {
		var at = haystack.indexOf(t, from);
		// A term that begins with something other than a letter — `μ`, `→` —
		// begins a word of its own wherever it stands: `μ` is found in `γ^μν`.
		var free = !LETTER.test(t.charAt(0));
		while (at !== -1) {
			if (free || at === 0 || !LETTER.test(haystack.charAt(at - 1))) return at;
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

	/* A query cut into what it asks for, each an array of variants any of
	   which will do. A word is a string, with its ladder of endings as
	   before. A formula is an object, `{ s }`: the formula squeezed, the way
	   the text's formulas are (`record`), and looked for there and nowhere
	   else. What is a formula is what the reader fenced
	   (`$\bar{\gamma}^\mu$`), and otherwise what `runsOf` takes for
	   one — the rule the text is read by. */
	function parse(q) {
		q = q.normalize('NFC');
		var toks = [], plain = '';
		function words_(text) {
			text.split(/\s+/).forEach(function (w) {
				if (w) toks.push({ raw: w, text: record(w, false).text });
			});
		}
		for (var i = 0; i < q.length; i++) {
			var f = fenceAt(q, i);
			if (!f) { plain += q.charAt(i); continue; }
			words_(plain); plain = '';
			var inner = q.slice(i + f.open, f.end).trim();
			if (inner) toks.push({ raw: inner, text: inner, math: true, fixed: true });
			i = f.end + f.shut - 1;
		}
		words_(plain);

		var runs = runsOf(toks), out = [], k = 0;
		runs.push([toks.length, toks.length]);
		runs.forEach(function (run) {
			for (; k < run[0]; k++) {
				var w = toks[k].text, typed = toks[k].raw;
				if (!w) continue;
				var v = ladder(w, CYR_WORD.test(typed));
				if (GREEK[typed.toLowerCase()]) v = v.concat([GREEK[typed.toLowerCase()]]);
				out.push({ word: w, variants: v });
			}
			if (run[0] === run[1]) return;
			var text = toks.slice(run[0], run[1]).map(function (x) { return x.raw; }).join(' ');
			var v_ = formulaVariants(text);
			if (v_.length) out.push({ word: null, variants: v_ });
			k = run[1];
		});
		return out;
	}

	function formulaVariants(text) {
		// Fenced, so that it is squeezed by the very code that squeezes the text.
		function squeezed(t) { return record('\\(' + t + '\\)', false).sq; }
		var sq = squeezed(text);
		if (!sq) return [];
		var v = [{ s: sq }];
		// `alpha_s` is the reader's way of writing `α_s`.
		var greek = squeezed(text.replace(/[A-Za-z]+/g, function (w) { return GREEK[w.toLowerCase()] || w; }));
		if (greek && greek !== sq) v.push({ s: greek });
		return v;
	}

	function words(q) {
		return parse(q).filter(function (t) { return t.word; }).map(function (t) { return t.word; });
	}

	function terms(q) {
		return parse(q).map(function (t) { return t.variants; }).filter(function (v) { return v.length; });
	}

	// Where a variant stands in a searched text, from `from` on: `[at, end)`
	// in the folded text, or null.
	function locate(r, v, from) {
		if (typeof v === 'string') {
			var at = occurrence(r.text, v, from);
			return at === -1 ? null : [at, at + v.length, true];
		}
		if (!r.sq) return null;
		for (var k = r.sq.indexOf(v.s); k !== -1; k = r.sq.indexOf(v.s, k + 1)) {
			if (r.sqAt[k] >= from) return [r.sqAt[k], r.sqAt[k + v.s.length - 1] + 1, false];
		}
		return null;
	}

	// The first variant actually present, or null if none is.
	function present(r, variants) {
		for (var i = 0; i < variants.length; i++) {
			if (locate(r, variants[i], 0)) return variants[i];
		}
		return null;
	}

	function matches(r, ts) {
		return ts.every(function (variants) { return present(r, variants) !== null; });
	}

	// Positions of every term occurrence, so all of them get highlighted. The
	// match is only the beginning of the word, but the whole word is what the
	// eye is looking for: «тело» highlights «тела», not «тел»а. A formula is
	// highlighted as far as it goes and no further.
	function hits(r, ts) {
		var out = [];
		ts.forEach(function (variants) {
			var v = present(r, variants);
			if (!v) return;
			var from = 0, got;
			while ((got = locate(r, v, from))) {
				var end = got[1];
				if (got[2]) while (end < r.text.length && LETTER.test(r.text.charAt(end))) end++;
				out.push([got[0], end]);
				from = Math.max(end, got[0] + 1);
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
		var f = record(text, true);
		var spans = hits(f, [[t]]);
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

	/* The formulas of a text as it stands: where each begins and ends, fences
	   and all, and the TeX inside. */
	function formulasOf(text) {
		var out = [];
		for (var i = 0; i < text.length; i++) {
			var f = fenceAt(text, i);
			if (!f) continue;
			out.push({ from: i, to: f.end + f.shut, tex: text.slice(i + f.open, f.end) });
			i = f.end + f.shut - 1;
		}
		return out;
	}

	/* How a formula is drawn in a result, if the page can draw one at all. A
	   site of formulas has KaTeX or MathJax on its pages already, and the TeX
	   of a result — `\frac{2 \;\text{e}^4 N e_Q^2 \left(t^2+u^2\right)}{s^2}` —
	   is not something to read. The host may hand its own function in; left
	   to itself the engine uses KaTeX where the page has it, and MathJax
	   otherwise, which typesets the list once it is drawn. Inline wherever
	   KaTeX allows it: a result is a line of text, and a displayed formula in
	   it would break the line in two. */
	function drawer(opt) {
		if (opt === false) return null;
		if (typeof opt === 'function') return opt;
		return function (tex) {
			var el = document.createElement('span');
			el.className = 'math';
			if (global.katex && global.katex.render) {
				// `align` and its kind exist in display mode only. What KaTeX
				// cannot draw stays TeX: a red error is worse than the source.
				try {
					global.katex.render(tex, el, { throwOnError: true, displayMode: /\\begin\{/.test(tex) });
					return el;
				} catch (e) { return null; }
			}
			if (global.MathJax && (global.MathJax.typesetPromise || global.MathJax.Hub)) {
				el.textContent = '\\(' + tex + '\\)';
				return el;
			}
			return null;
		};
	}

	// Past this a formula is shown as its TeX, cut like any other text: a
	// result that unfolds into a page of output is no longer a line.
	var DRAWN = 600;

	/* Build the snippet as text nodes + <mark>, never as HTML.

	   The window and the matches inside it are worked out on the folded text
	   and only then carried back to the original, because the two no longer
	   agree letter for letter: «шактипата» is nine letters and folds to nine,
	   but «натья» is five and folds to six. What is shown has to be the text
	   as it stands — a reader searching in Cyrillic for a word written in IAST
	   must see the IAST — so every edge is folded-side arithmetic first and
	   `map` afterwards.

	   A formula is shown whole or not at all — half of a fraction is not a
	   formula — so where the window cuts one it is widened to hold it, and a
	   formula a match falls in is marked as a whole. */
	function snippet(text, ts, math) {
		var f = record(text, true), hay = f.text;
		var spans = hits(f, ts);
		var frag = document.createDocumentFragment();
		var head, tail;
		if (!spans.length) {
			// The term matched the section heading rather than the paragraph
			// itself, so just show the opening, cut on a word boundary.
			head = 0;
			var cut = text.lastIndexOf(' ', 220);
			tail = text.length <= 220 ? text.length : (cut > 0 ? cut : 220);
		} else {
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
			head = f.map[start]; tail = f.map[end];
		}
		var marks = spans.map(function (s) { return [f.map[s[0]], f.map[s[1]]]; });

		var drawn = !math ? [] : formulasOf(text).filter(function (m) {
			if (m.to <= head || m.from >= tail || m.to - m.from > DRAWN) return false;
			head = Math.min(head, m.from);
			tail = Math.max(tail, m.to);
			return true;
		});

		if (head > 0) frag.appendChild(document.createTextNode('…'));
		var cursor = head;

		function plain(upto) {
			marks.forEach(function (s) {
				var from = s[0], to = Math.min(s[1], upto);
				if (to <= cursor || from >= upto) return;
				if (from > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, from)));
				// Two words of the query can cover one word of the text; the
				// second then begins before the first has ended, and what is
				// already written must not be written again.
				var m = document.createElement('mark');
				m.textContent = text.slice(Math.max(from, cursor), to);
				frag.appendChild(m);
				cursor = to;
			});
			if (cursor < upto) frag.appendChild(document.createTextNode(text.slice(cursor, upto)));
			cursor = upto;
		}

		drawn.forEach(function (m) {
			plain(m.from);
			var node = math(m.tex);
			if (!node) { plain(m.to); return; }
			var hit = marks.some(function (s) { return s[0] < m.to && s[1] > m.from; });
			if (hit) {
				var mark = document.createElement('mark');
				mark.appendChild(node);
				node = mark;
			}
			frag.appendChild(node);
			cursor = m.to;
		});
		plain(tail);

		if (tail < text.length) frag.appendChild(document.createTextNode('…'));
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
	/* What a source calls the part of the site it holds. Its pages name their
	   own language and can therefore name their own section in it; a source
	   cannot, being one file serving every reader alike. So a site that
	   publishes in two languages writes the name in both, and `section` stays
	   the name for everybody else — including a reader whose language nobody
	   wrote down.

	   The reader's language comes in as an argument rather than off a variable
	   held above: this stands beside `documentsOf`, outside `mount`, and a flat
	   index is read here before any mount exists to ask. */
	function called(spec, lang) {
		return (spec.named && spec.named[lang]) || spec.section || null;
	}

	function documentsOf(data, spec, lang) {
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
				section: called(spec, lang) || p.section || null,
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
		var math = drawer(opts.math);

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

		/* iCloud Passwords offers "Enable Password AutoFill" over the first
		   text field a page focuses, whatever the field says of itself —
		   `autocomplete="off"`, `type="search"` and the attributes other
		   password managers read (set here too) are not looked at. What it
		   does respect is a field that is read-only at the moment of focus.
		   So the box is, until it is first focused, and writable straight
		   after, or at the first key, whichever comes sooner. Only where
		   there is a mouse — the extension is a desktop one, and a phone does
		   not raise its keyboard for a field that was read-only when tapped.
		   palette.js does the same for its own field. */
		['data-1p-ignore', 'data-lpignore', 'data-bwignore'].forEach(function (a) { input.setAttribute(a, 'true'); });
		input.setAttribute('data-form-type', 'other');
		var fine = global.matchMedia && global.matchMedia('(pointer: fine)').matches;
		if (fine && document.activeElement !== input && !input.readOnly) {
			input.readOnly = true;
			var writable = function () {
				input.readOnly = false;
				input.removeEventListener('keydown', writable);
			};
			input.addEventListener('focus', function once() {
				input.removeEventListener('focus', once);
				setTimeout(writable, 30);
			});
			// A key pressed sooner still lands: the field opens before the key
			// is typed into it.
			input.addEventListener('keydown', writable);
		}

		/* The symbol helper (symbols.js), where the page has loaded it: a site
		   of formulas puts it beside the box, and a site with none does not
		   load the file. `symbols: false` keeps it off a field all the same. */
		if (opts.symbols !== false && global.SiteSymbols) global.SiteSymbols.attach(input, { lang: lang });

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
					section: called(src.spec, lang) || p.section || null,
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

			function union(lists) {
				var seen = Object.create(null), out = [];
				lists.forEach(function (l) {
					for (var k = 0; k < l.length; k++) if (!seen[l[k]]) { seen[l[k]] = 1; out.push(l[k]); }
				});
				return out.sort(function (a, b) { return a - b; });
			}

			function both(a, b) {
				var keep = Object.create(null);
				for (var k = 0; k < b.length; k++) keep[b[k]] = 1;
				return a.filter(function (id) { return keep[id]; });
			}

			// The chunks holding every one of these beginnings of words; ALL
			// where there is nothing to ask the map about.
			var ALL = null;
			function every(keys) {
				var out = ALL;
				for (var i = 0; i < keys.length; i++) {
					var set = src.postingsFor(keys[i]) || [];
					out = out === ALL ? set : both(out, set);
					if (!out.length) return out;
				}
				return out;
			}

			function pieces(t) {
				var out = [], m;
				RUN.lastIndex = 0;
				while ((m = RUN.exec(t))) out.push(m[0]);
				GLYPHS.lastIndex = 0;
				while ((m = GLYPHS.exec(t))) out.push(m[0]);
				return out;
			}

			/* A word is looked up as it stands while it is one word to the map
			   too. One that holds a hyphen or a bracket — `Passarino-Veltman`,
			   `DiracTrace[` — is two words or one and a bracket to the map,
			   which lists runs of letters only, and asking for it whole named
			   no chunk at all: a flat index found it and a two-tier one said
			   "nothing". Its pieces are asked for instead, all of them.

			   A formula is asked for the way it is matched (`locate`): by every
			   pair of neighbours in it squeezed, `$e+`, `$+e`, as the map lists
			   the formulas of the text — or, one glyph long, as the word it is. */
			function chunksOf(v) {
				if (typeof v === 'string') {
					var whole = /^[a-zа-я0-9]+$/.test(v) || GLYPH.test(v) && v.length === 1;
					return whole ? src.postingsFor(v) || [] : every(pieces(v));
				}
				var keys = [];
				if (v.s.length === 1 && GLYPH.test(v.s)) keys.push(v.s);
				for (var i = 0; i + 1 < v.s.length; i++) keys.push('$' + v.s.substr(i, 2));
				return every(keys);
			}

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
				var sets = [];
				for (var i = 0; i < variants.length; i++) {
					var set = chunksOf(variants[i]);
					if (set === ALL) return ALL;
					sets.push(set);
				}
				return union(sets);
			}

			/* A term the map can say nothing about — a formula of nothing but
			   `+` and `-` — narrows nothing, and the others decide; a query of
			   nothing else reads from the top, as far as reading goes. */
			src.candidates = function (ts) {
				var out = ALL;
				for (var i = 0; i < ts.length; i++) {
					var set = anyOf(ts[i]);
					if (set === ALL) continue;
					out = out === ALL ? set : both(out, set);
					if (!out.length) return out;
				}
				if (out !== ALL) return out;
				var every_ = [];
				for (var id = 0; id < owner.length; id++) every_.push(id);
				return every_;
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
					var docs = data.tier === 2 ? spread(src, data) : documentsOf(data, src.spec, lang);
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
			a.appendChild(snippet(doc.title, ts, math));
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
			// A heading may hold a formula — "\(SU(N)\) algebra" — and is
			// drawn the way the text under it is.
			if (block.section) {
				el.where.appendChild(document.createTextNode(' → '));
				el.where.appendChild(snippet(block.section, [], math));
			}
			el.snippet.appendChild(snippet(block.text, ts, math));
		}

		/* The folded text is computed once per block and kept: it does not
		   change, and running NFD over half a megabyte on every keystroke is
		   work for nothing. The section heading is joined to the paragraph
		   right here: it has to be searched too, while what is shown is still
		   the paragraph. */
		function folded(b) {
			if (b.fold === undefined) b.fold = record((b.section || '') + ' ' + b.text, false);
			return b.fold;
		}

		function foldedTitle(doc) {
			if (doc.fold === undefined) doc.fold = record(doc.title + ' ' + (doc.also || ''), false);
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
					if (occurrence(foldedTitle(doc).text, t, 0) !== -1) return true;
					return !src.postingsFor && doc.blocks.some(function (b) {
						return occurrence(folded(b).text, t, 0) !== -1;
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
			// A formula is not cut: it has no endings, only symbols.
			var ts = parse(q).map(function (term) {
				if (!term.word) return term.variants;
				var t = term.word;
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
					tally(weight, foldedTitle(doc).text);
					doc.blocks.forEach(function (b) { if (b) tally(weight, folded(b).text); });
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
			var ps = parse(q), out = [], cut = null;
			var ls = ps.map(function (p) { return p.variants; });
			var ws = ps.map(function (p) { return p.word; });
			for (var i = 0; i < ws.length; i++) {
				// A formula is never mended: a symbol has no misspelling.
				if (!ws[i] || occurs(ws[i])) { out.push(ls[i]); continue; }
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
			// One glyph is a query: `μ` asks for something, `m` does not.
			var searching = parse(q).length > 0 && (q.trim().length >= 2 || GLYPH.test(q));

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
			if (broken.length) say += (say ? ' · ' : '') + say_.broken(called(broken[0].spec, lang));
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
			typeset();
			if (opts.onRender) opts.onRender();
		}

		// MathJax draws formulas after the fact, over what is in the list.
		function typeset() {
			var mj = global.MathJax;
			if (!math || opts.math || global.katex || !mj || !results.querySelector('.math')) return;
			if (mj.typesetPromise) mj.typesetPromise([results]).catch(function () {});
			else if (mj.Hub) mj.Hub.Queue(['Typeset', mj.Hub, results]);
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
	global.SiteSearch = {
		mount: mount, fold: norm, say: SAY,
		// The words a two-tier map lists for a text, and the symbols the
		// helper offers (symbols.js): both are this file's tables.
		vocabulary: vocabulary, symbols: SYMBOLS,
		// For the checks (check-math.js): does this text answer this query.
		answers: function (text, q) { var ts = terms(q); return ts.length > 0 && matches(record(text, false), ts); },
		parse: parse,
	};
})(typeof globalThis !== 'undefined' ? globalThis : window);

// Node reads this file for the fold alone; nothing above touches the document
// until `mount` is called.
if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.SiteSearch;
