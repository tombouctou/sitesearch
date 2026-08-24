// Запись указателя на диск.
//
// Пишем дважды: как есть и сжатым заранее. Сжать один раз при сборке дешевле,
// чем на каждом запросе: хостинг жмёт на лету быстрым уровнем, brotli -q 11
// даёт тех же данных заметно меньше. Отдавать «.br» браузеру как JSON должен
// хостинг (на Vercel — заголовками в vercel.json); страница поиска просит
// сжатую копию, только если источник помечен `precompressed`, и при неудаче
// возвращается к обычному файлу.
//
// Там, где положить файл рядом некуда — GitHub Pages жмёт сам, — сжатая копия
// не нужна: `brotli: false`.

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
