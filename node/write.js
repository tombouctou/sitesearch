// Writing an index to disk.
//
// Written twice: as it stands, and pre-compressed. Compressing once at build
// time is cheaper than on every request — a host compresses on the fly at a
// fast level, whereas brotli -q 11 makes the same data markedly smaller.
// Serving the ".br" to a browser as JSON is the host's job (on Vercel, through
// headers in vercel.json); the search page asks for the compressed copy only
// when the source is marked `precompressed`, and falls back to the plain file
// if that fails.
//
// Where there is nowhere to put the file — GitHub Pages compresses on its own —
// the compressed copy is not wanted: `brotli: false`.

const fs = require('fs');
const zlib = require('zlib');

function writeIndex(file, data, opts = {}) {
	const json = JSON.stringify(data);
	fs.writeFileSync(file, json);

	if (opts.brotli === false) return json.length;

	fs.writeFileSync(file + '.br', zlib.brotliCompressSync(Buffer.from(json, 'utf8'), {
		params: {
			[zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
			[zlib.constants.BROTLI_PARAM_SIZE_HINT]: Buffer.byteLength(json),
		},
	}));
	return json.length;
}

module.exports = { writeIndex };
