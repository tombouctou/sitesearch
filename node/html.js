// HTML → куски текста, из которых собирается указатель.
//
// Ни одной зависимости и никакого разбора дерева: страницы статических сайтов
// пишутся руками и годами, <p> и <li> в них сплошь и рядом не закрыты, а
// настоящий парсер на таком либо падает, либо чинит разметку по-своему. Здесь
// текст просто режется на куски по блочным тегам — этого для поиска довольно.
//
// Что считать куском: абзац, пункт списка, строку таблицы. Заголовок над ними
// не кусок, а подпись к тому, что за ним следует, и якорь, по которому туда
// ведёт ссылка.

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

// Фрагмент разметки → голый текст. Для заголовков и прочих мест, где резать
// на куски нечего.
function text(html) {
	return clean(html.replace(/<[^>]*>/g, ' '));
}

// Теги, на которых кончается набранный кусок. Закрывающего тега не ждём: см.
// про незакрытые <p> выше — кусок кончается на следующем блочном теге, в
// какую бы сторону тот ни смотрел.
const BREAKS = /^(p|li|ul|ol|dl|dt|dd|div|table|tr|br|hr|h[1-6]|blockquote|pre|form|section|article|nav|footer)$/;

// Строка таблицы — одна запись. Словарь держит термин, его пали, его санскрит
// и толкование в разных ячейках, и ячейка сама по себе («dhamma») — находка,
// которую невозможно прочесть. Ячейки поэтому склеиваются, а не разделяются.
const CELLS = /^(td|th)$/;

const HEADING = /^h([1-6])$/;

// Тело страницы кусками: текст одного абзаца или пункта, заголовок раздела над
// ним и ближайший якорь, по которому туда ведёт ссылка.
function blocks(html) {
	const out = [];
	let buf = '';
	let anchor = null;        // действует для набираемого куска
	let nextAnchor = null;    // встретился после последнего сброса, годится для следующего
	let section = null;
	let heading = 0;          // уровень набираемого заголовка, 0 — не заголовок

	function flush() {
		const t = clean(buf).replace(/(\s*·\s*)+/g, ' · ').replace(/^ ?· | ?· ?$/g, '').trim();
		buf = '';
		if (heading) {
			// Заголовок называет раздел, который за ним идёт, и даёт ему якорь.
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

		// Любой id, и старый <a name="...">, — это куда сослаться.
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

// Всё между <body> и </body>, без того, что читателю не показывают вовсе.
// Обвязка самого сайта — «#» у каждого абзаца, подвал, список меток —
// у каждого сайта своя, поэтому её образцы передаёт сборщик: здесь нет
// способа отличить её от текста, и гадать не надо.
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
