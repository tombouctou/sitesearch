// HTML into the pieces of text an index is made of.
//
// No dependencies and no tree parsing: static-site pages are written by hand
// over years, <p> and <li> in them are routinely left unclosed, and a real
// parser either chokes on that or repairs the markup its own way. Here the text
// is simply cut into pieces on block-level tags, which is enough for a search.
//
// What counts as a piece: a paragraph, a list item, a table row. A heading is
// not a piece but a label on what follows it, and the anchor a link reaches it
// by.

const ENTITIES = {
	nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
	mdash: '—', ndash: '–', laquo: '«', raquo: '»', hellip: '…',
	ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', deg: '°', times: '×',
	rarr: '→', larr: '←', middot: '·', copy: '©', frac12: '½',
};

function decode(s) {
	return s
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
		.replace(/&([a-z0-9]+);/gi, (m, name) => {
			const key = name.toLowerCase();
			return key in ENTITIES ? ENTITIES[key] : m;
		});
}

function clean(s) {
	return decode(s).replace(/\s+/g, ' ').trim();
}

// A fragment of markup into bare text. For headings and anywhere else there is
// nothing to cut up.
function text(html) {
	return clean(html.replace(/<[^>]*>/g, ' '));
}

// Tags that end whatever piece was being collected. No closing tag is waited
// for: see the unclosed <p> above — a piece ends at the next block-level tag,
// whichever way that tag happens to face.
const BREAKS = /^(p|li|ul|ol|dl|dt|dd|div|table|tr|br|hr|h[1-6]|blockquote|pre|form|section|article|nav|footer)$/;

// A table row is one entry. A glossary keeps a term, its Pali, its Sanskrit and
// its gloss in separate cells, and a cell on its own ("dhamma") is a result
// nobody can read. Cells are therefore joined rather than split.
const CELLS = /^(td|th)$/;

const HEADING = /^h([1-6])$/;

// A page's body in pieces: the text of one paragraph or list item, the section
// heading above it, and the nearest anchor a link can reach it by.
function blocks(html) {
	const out = [];
	let buf = '';
	let anchor = null;        // in effect for the piece being collected
	let nextAnchor = null;    // seen since the last flush, applies to what follows
	let section = null;
	let heading = 0;          // heading level being collected, 0 if none

	function flush() {
		const t = clean(buf).replace(/(\s*·\s*)+/g, ' · ').replace(/^ ?· | ?· ?$/g, '').trim();
		buf = '';
		if (heading) {
			// A heading names the section that follows and gives it an anchor.
			if (t) section = t;
			anchor = nextAnchor !== null ? nextAnchor : anchor;
			heading = 0;
			return;
		}
		if (t.length > 1) out.push({ anchor, section, text: t });
		if (nextAnchor !== null) { anchor = nextAnchor; nextAnchor = null; }
	}

	const tag = /<\/?([a-z][a-z0-9]*)\b([^>]*)>/gi;
	let at = 0, m;
	while ((m = tag.exec(html)) !== null) {
		buf += html.slice(at, m.index);
		at = tag.lastIndex;

		const name = m[1].toLowerCase();
		const attrs = m[2] || '';
		const closing = m[0][1] === '/';

		// Any id, and the old-style <a name="...">, is somewhere to link to.
		const id = attrs.match(/\bid\s*=\s*"([^"]+)"/i) || (name === 'a' && attrs.match(/\bname\s*=\s*"([^"]+)"/i));
		if (id && !closing) nextAnchor = id[1];

		const h = name.match(HEADING);
		if (h && !closing) { flush(); heading = +h[1]; if (id) nextAnchor = id[1]; continue; }
		if (h && closing) { flush(); continue; }
		if (CELLS.test(name)) { buf += ' · '; continue; }
		if (BREAKS.test(name)) flush();
	}
	buf += html.slice(at);
	flush();

	return out;
}

// Everything between <body> and </body>, minus what the reader is never shown.
// A site's own furniture — the "#" beside every paragraph, the footer, the tag
// list — differs from site to site, so the builder passes its patterns in:
// there is nothing here that could tell it apart from the text, and guessing is
// not called for.
function body(html, strip = []) {
	let s = html
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, '');
	for (const re of strip) s = s.replace(re, ' ');

	const open = s.match(/<body\b[^>]*>/i);
	if (open) s = s.slice(open.index + open[0].length);
	const close = s.search(/<\/body>/i);
	return close === -1 ? s : s.slice(0, close);
}

module.exports = { decode, clean, text, body, blocks };
