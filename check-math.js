#!/usr/bin/env node
/* What the search promises about formulas.
 *
 *     node check-math.js
 *
 * One formula is written many ways — `\omega_g`, `ω_g`, `\omega_{g}`, with
 * spaces and without, as TeX and as Mathematica's `\[Omega]` — and the promise
 * is that any of them typed finds any of them written. A fold breaks quietly:
 * a command dropped from the table, a rule applied in the text and not in the
 * query, and a search that worked last month answers nothing, on one spelling
 * only, which nobody tries. So the spellings are written out here, each with
 * what it must find and what it must not.
 *
 * The second half is the map's half. A two-tier map may say a chunk holds a
 * word that it does not; it may never fail to name one that does (FORMAT.md).
 * Every pair below that matches is therefore also run through the vocabulary
 * the builder writes, and the words the engine would ask the map for must all
 * be in it.
 */
'use strict';

const path = require('path');
const S = require(path.join(__dirname, 'search.js'));

// [text, query, should it be found]
const CASES = [
	// One symbol, four spellings (pm's PM-479, the case this began from).
	['$\\omega_g$', 'ω_g', true],
	['$\\omega_{g}$', '\\omega_g', true],
	['ω_{g}', '$\\omega_{g}$', true],
	['the weight ω_g of a group', '\\omega_{g}', true],
	['$\\omega_{gk}$', 'ω_g', true],          // a beginning, as words are
	['$\\omega_{gk}$', 'ω_{gk}', true],
	['$\\omega_g k$', 'ω_{gk}', true],        // spaces mean nothing in a formula

	// A process, typed the ways a physicist types it.
	['$e^+ e^- \\to \\mu^+ \\mu^-$', 'e+e- → μ+μ-', true],
	['$e^+ e^- \\to \\mu^+ \\mu^-$', 'e+ e- -> mu+ mu-', true],
	['$e^+ e^- \\to \\mu^+ \\mu^-$', '$e^+e^-\\to\\mu^+\\mu^-$', true],
	['\\(e^+ e^- \\to \\mu^+ \\mu^-\\)', 'e+e-→μ+μ-', true],
	['$e^+ e^- \\to \\mu^+ \\mu^-$', 'e+e- → τ+τ-', false],
	['$e^+ e^- \\to \\gamma \\gamma$', 'e+e- → μ+μ-', false],

	// Mathematica's names, in code.
	['GA[\\[Mu]] . GA[\\[Nu]]', 'GA[μ]', true],
	['DiracTrace[GA[\\[Mu], \\[Nu]]]', '\\mu', true],
	['FV[p, \\[CapitalGamma]]', 'Γ', true],
	['a -> b', 'a → b', true],

	// Accents stay in the text and leave the squeezed formula.
	['$\\bar{\\gamma}^{\\mu } \\bar{\\gamma}^{\\nu}$', 'γ^μγ^ν', true],
	['$\\bar{\\gamma}^{\\mu }$', '\\bar{γ}', true],
	['$\\gamma^{\\mu }$', '\\bar{γ}', true],     // and looked through by the query too
	['$\\overline{p}^{\\mu } \\bar{g}^{\\mu \\nu}$', 'g^{μν}', true],

	// Constructions are looked through, not read.
	['$\\frac{3 \\alpha ^2 e_Q^2}{4 s}$', 'α^2', true],
	['$\\left(t^2+u^2\\right)$', '(t^2+u^2)', true],
	['$\\text{e}^2 N$', 'e^2N', true],
	['$m_e^2$', 'm_e^2', true],
	['$\\alpha_s$', 'alpha_s', true],         // a bare name, in a query only
	['$\\sum_i x_i$', 'σ', false],            // ∑ is not σ, case folded or not
	['a ≠ b', '≠', true],
	['a = b', '≠', false],
	['$x^2$', 'x²', true],
	['$p_1$', 'p₁', true],

	// Prose stays prose.
	['the omega release', 'omeg', true],      // a name in the text is not folded
	['$\\omega$ release', 'omega', true],     // …but a name typed is a glyph too
	['prose s u', 'su', false],
	['Klein-Gordon equation', 'klein-gordon', true],
	['Passarino-Veltman reduction', 'Passarino-Veltman', true],
	['по-японски', 'по-японски', true],
	['$5 and $10', '$5', true],               // money is not a formula
	['it costs $5 and $10 now', 'and', true],
	['ω g in prose', 'ωg', true],            // a run of symbols is a formula
	['omega g in prose', 'ωg', false],
	['GA[\\[Mu], \\[Nu]]', 'GA[μ]', false],      // GA[μ, …] is not GA[μ]
	['GA[\\[Mu], \\[Nu]]', 'GA[μ,ν]', true],
	['Contract[FV[p, μ] FV[q, μ]]', 'FV[p, μ]', true],  // code is found as it is written

	// A number, however its digits are grouped: by a space, a no-break or
	// thin one, TeX's \, in a formula — or not at all.
	['all 1 202 candidates', '1202', true],
	['all 1202 candidates', '1 202', true],
	['all 1\u00a0202 candidates', '1 202', true],
	['SmallGroup(512, \\(10\\,494\\,201\\le i\\))', '10 494 201', true],
	['SmallGroup(512, \\(10\\,494\\,201\\le i\\))', '10494201', true],
	['the index 10\u2009494\u2009201', '10494201', true],
	['$M=55\\,986$ columns', '55 986', true],
	['in 2026 202 groups', '2026202', false],     // four digits are not a group
	['orders 149,150 and 151', '149150', false],  // a comma is a list
];

let bad = 0;
for (const [text, q, want] of CASES) {
	const got = S.answers(text, q);
	if (got !== want) {
		console.log('   ✗ «%s» %s «%s»', q, want ? 'должно найти' : 'не должно находить', text);
		bad++;
	}
}

/* The map never misses. What the engine asks a map for a query is the words
   of each term — runs of letters and digits, glyphs, and for a formula
   squeezed the `$`-pairs of its neighbours — and for a pair that matches, at least one variant of every
   term must have all its words (as beginnings) in the text's vocabulary. */
function asked(q) {
	const RUN = /[a-z0-9]+/g, GLYPH = /[\u0370-\u03ff\u2100-\u214f\u2190-\u23ff\u27c0-\u27ff\u2900-\u2aff±×÷¬†‡…√∞ħ]/g;
	return S.parse(q).map((term) => term.variants.map((v) => {
		if (typeof v === 'string') return [...v.match(RUN) || [], ...v.match(GLYPH) || []];
		return v.s.length === 1 ? (/^[a-z0-9+=<>|-]$/.test(v.s) ? [] : [v.s]) : [...v.s].slice(1).map((c, i) => '$' + v.s[i] + c);
	}));
}

let missed = 0;
for (const [text, q] of CASES) {
	if (!S.answers(text, q)) continue;
	const words = S.vocabulary(text);
	const has = (k) => words.some((w) => w.startsWith(k));
	const ok = asked(q).every((variants) => variants.some((keys) => keys.every(has)));
	if (!ok) {
		console.log('   ✗ карта не назовёт «%s» для «%s»: %s', text, q, words.join(' '));
		missed++;
	}
}

console.log('Формулы: сошлось %d из %d; карта промахнулась %d раз', CASES.length - bad, CASES.length, missed);
process.exit(bad || missed ? 1 : 0);
