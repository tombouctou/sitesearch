// One index into two tiers: a map of words, and the text behind it.
//
// The flat index (FORMAT.md) is the text of the site, and a browser that wants
// to search it downloads all of it. That is the right trade while the text is
// small: it arrives once and the search then costs nothing. Past a few hundred
// kilobytes it stops being right — on a site of three indexes and four and a
// half megabytes of prose, a reader who types one word pays for every word
// there is.
//
// The split is between the two questions a search asks. *Which pages hold this
// word* needs an index of words and nothing else, and it is small. *What does
// the passage look like* needs the passage itself, and that is where the weight
// is — but only for the dozen passages actually shown.
//
// So: a map, static and loaded once, saying which chunk of which page holds a
// word; and the chunks, fetched one at a time as results are shown. The engine
// treats the map as a filter and never as an answer — every match is decided
// against the real text, by the same code that decides it in the flat index.
// A chunk that turns out to hold nothing is a wasted request, never a wrong
// result.
//
//     node node/two-tier.js _site /search-index.json
//
// The entry index is converted in place, and so is every index its `shards`
// name: a builder that already knows what the site is made of should not have
// to say it twice.

const fs = require('fs');
const path = require('path');
const { writeIndex } = require('./write');

// How many blocks travel together. Measured on the two sites this serves:
// smaller chunks make the map bigger (a word's postings name more places) and
// each fetch cheaper, and the curve is flat enough between 16 and 64 that the
// choice is about the worst single fetch rather than the total. Thirty-two
// keeps a chunk of the widest text on either site — a chapter of a book about
// sailing, whose paragraphs run long — under about eight kilobytes.
const CHUNK = 32;

/* The map is a list of words as the engine folds them, and a query is looked
   up in it folded the same way. So the fold is not copied here but taken from
   the engine itself: two tables would agree until one of them was edited, and
   the map would then stop naming chunks it ought to name — a miss, which is
   the one thing the map may never do (FORMAT.md). */
const { fold: norm } = require('../search.js');

// The same word boundary the engine matches on: a query term is found where a
// word begins, so a word is a run of the letters and digits it may begin with.
// After the fold there is no Cyrillic left in the text; the range stays all the
// same, because what the engine tests and what is counted here must be one rule.
const WORD = /[a-zа-я0-9]+/g;

function blocksOf(page) {
	return (page.blocks || [])
		.map((b) => (typeof b === 'string' ? { text: b } : b))
		.filter((b) => b && b.text);
}

/* Furniture — the "how to read these pages" aside standing word for word on
   forty pages — is dropped here rather than in the browser. The engine can drop
   it too (`repeats`), but only after it has been paid for: in two tiers the
   count would also have to be made before a single chunk had arrived, which is
   exactly when the text is not there. Cutting at build time is both cheaper and
   the only order that works. */
function dropRepeated(pages, threshold) {
	const n = Object.create(null);
	for (const page of pages) {
		const here = Object.create(null);
		for (const b of page.blocks) {
			if (b.text.length < 60 || here[b.text]) continue;
			here[b.text] = 1;
			n[b.text] = (n[b.text] || 0) + 1;
		}
	}
	let dropped = 0;
	for (const page of pages) {
		const kept = page.blocks.filter((b) => (n[b.text] || 0) < threshold);
		dropped += page.blocks.length - kept.length;
		page.blocks = kept;
	}
	return dropped;
}

/* Sorted words, each written as the number of letters it shares with the one
   before it plus what is left. Neighbours in a sorted vocabulary share nearly
   everything — "остойчивости", "остойчивость", "остойчивый" — and the shared
   part is written once. Gzip finds much of this by itself; front-coding still
   takes another third off, because it removes the repetition rather than
   pointing at it. The shared length is one base-36 digit, so it stops at 35 —
   longer words simply repeat a little. */
function frontCode(words) {
	let prev = '';
	return words.map((w) => {
		let i = 0;
		const max = Math.min(prev.length, w.length, 35);
		while (i < max && prev[i] === w[i]) i++;
		prev = w;
		return i.toString(36) + w.slice(i);
	}).join('\n');
}

// Ascending chunk numbers as gaps, in base 36: a word met in neighbouring
// chunks costs one character per chunk.
function deltas(list) {
	let last = 0;
	return list.map((x) => { const d = x - last; last = x; return d.toString(36); }).join(',');
}

function split(index, opts = {}) {
	const chunkSize = opts.chunk || CHUNK;
	/* The fields are named one by one rather than copied wholesale: what
	   travels to the browser is what the engine reads, and whatever a builder
	   kept for itself has no business making the journey. The price is that a
	   field added to FORMAT.md has to be added here as well, and `lang` was
	   not — so a site in two languages kept its languages in the flat index
	   and lost them the moment the index grew big enough to be split, which is
	   exactly the size at which nobody reads the file to check. */
	const pages = (index.pages || []).map((p) => ({
		url: p.url, title: p.title, also: p.also || undefined,
		lang: p.lang || undefined,
		section: p.section || undefined, order: p.order,
		blocks: blocksOf(p),
	}));

	const dropped = opts.repeats > 1 ? dropRepeated(pages, opts.repeats) : 0;

	// Chunk numbers are not stored: they run through the pages in order, so
	// many blocks to a chunk, and both sides can count them. Storing them
	// would be storing arithmetic.
	const chunks = [];
	const post = new Map();
	for (let pi = 0; pi < pages.length; pi++) {
		const blocks = pages[pi].blocks;
		for (let from = 0; from < blocks.length; from += chunkSize) {
			const to = Math.min(blocks.length, from + chunkSize);
			const here = new Set();
			for (let i = from; i < to; i++) {
				// The heading above a paragraph is matched together with it,
				// so its words belong to the same chunk.
				const text = norm((blocks[i].section || '') + ' ' + blocks[i].text);
				let m;
				WORD.lastIndex = 0;
				while ((m = WORD.exec(text))) here.add(m[0]);
			}
			const id = chunks.length;
			chunks.push(blocks.slice(from, to));
			for (const w of here) {
				let a = post.get(w);
				if (!a) post.set(w, (a = []));
				a.push(id);
			}
		}
	}

	/* A page's own name is not in the vocabulary. It is already in the map —
	   every page is listed there with its title — so a query that matches a
	   name is answered without fetching anything at all. Putting those words
	   in the postings as well would only buy chunks nobody needs to read. */
	const words = [...post.keys()].sort();

	const map = {
		tier: 2,
		text: opts.text,
		chunk: chunkSize,
		pages: pages.map((p) => ({
			url: p.url, title: p.title, also: p.also, lang: p.lang,
			section: p.section, order: p.order, blocks: p.blocks.length,
		})),
		words: frontCode(words),
		postings: words.map((w) => deltas(post.get(w))).join('\n'),
	};
	if (index.shards) map.shards = index.shards;

	return { map, chunks, dropped, words: words.length };
}

// --- the command line -------------------------------------------------------

// The site's own address for a file under the root, and back again. Indexes
// name each other the way a browser reaches them, with a leading slash.
const toFile = (root, url) => path.join(root, url.replace(/^\//, ''));

function convert(root, url, opts, seen) {
	if (seen.has(url)) return;
	seen.add(url);

	const file = toFile(root, url);
	if (!fs.existsSync(file)) {
		console.error('two-tier: nothing at ' + url + ' (' + file + ') — skipped');
		return;
	}
	const index = JSON.parse(fs.readFileSync(file, 'utf8'));
	if (index.tier === 2) {
		console.error('two-tier: ' + url + ' is already in two tiers — skipped');
		return;
	}

	// The text lives beside the map, under a directory named after it, so that
	// two indexes on one site never write into each other.
	const base = path.basename(url).replace(/\.json$/, '');
	const dir = path.dirname(url) + (path.dirname(url).endsWith('/') ? '' : '/') + base + '-text/';

	const out = split(index, { chunk: opts.chunk, repeats: opts.repeats, text: base + '-text/' });

	fs.mkdirSync(toFile(root, dir), { recursive: true });
	let textBytes = 0;
	out.chunks.forEach((blocks, id) => {
		textBytes += writeIndex(toFile(root, dir + id + '.json'), blocks, { brotli: opts.brotli });
	});
	const mapBytes = writeIndex(file, out.map, { brotli: opts.brotli });

	const kb = (n) => Math.round(n / 1024) + ' KB';
	console.log(url + ': ' + out.map.pages.length + ' pages, ' + out.chunks.length + ' chunks, ' +
		out.words.toLocaleString('en') + ' words' + (out.dropped ? ', furniture dropped: ' + out.dropped : '') +
		'\n    map ' + kb(mapBytes) + ', text ' + kb(textBytes) + ' across ' + out.chunks.length + ' files');

	for (const shard of out.map.shards || []) convert(root, shard.url, opts, seen);
}

if (require.main === module) {
	const args = process.argv.slice(2);
	const flag = (name, dflt) => {
		const i = args.indexOf('--' + name);
		return i === -1 ? dflt : Number(args[i + 1]);
	};
	const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
	const [root, entry] = positional;
	if (!root || !entry) {
		console.error('usage: node node/two-tier.js <site root> <index url> [--chunk 32] [--repeats 4] [--brotli 1]');
		process.exit(2);
	}
	convert(root, entry, {
		chunk: flag('chunk', CHUNK),
		repeats: flag('repeats', 0),
		brotli: flag('brotli', 0) ? undefined : false,
	}, new Set());
}

module.exports = { split };
