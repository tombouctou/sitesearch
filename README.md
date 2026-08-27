# sitesearch

Search a static site entirely in the browser: no server, no indexing service,
no dependencies. One index file reaches the reader, and after that the search
fetches nothing at all.

What every site does the same way lives here — the engine and the builders.
What each site does its own way — sections, their order, what counts as a page —
stays with the site.

| file                        | what it does                                            |
|-----------------------------|---------------------------------------------------------|
| `search.js`                 | the engine, dropped into a search page                  |
| `palette.js`                | jump to a section by ⌘K, dropped into every page        |
| `status.js`                 | reports the state of the indexes a site is serving      |
| `check-fold.js`             | the two folds must agree: search.js against palette.js  |
| `check-prepare.js`          | what `prepare` promises about the front door of a section |
| `check-say.js`              | the words both files say, in every language they claim   |
| `FORMAT.md`                 | the index contract: the border between builder and engine |
| `node/html.js`              | builder for an HTML tree: a page into pieces of text    |
| `node/write.js`             | writes an index, pre-compressed copy and all            |
| `node/two-tier.js`          | splits a built index into a map and chunks of text      |
| `jekyll/search-index.json`  | builder for Jekyll: the index is built by Jekyll itself |

## Attaching it

As a submodule, not a copy: that way the version which went to production is
recorded in git rather than in whenever someone last ran a sync script.

```sh
git submodule add https://github.com/tombouctou/sitesearch.git sitesearch
```

In a fresh clone, `git submodule update --init`. The host fetches the submodule
on its own: GitHub Pages and Vercel both do so for a public repository over
https (neither does over ssh).

A search page hands the engine three nodes and names the indexes to search:

```html
<input id="q" type="search" />
<p id="status"></p>
<ul id="results"></ul>

<script src="/sitesearch/search.js"></script>
<script>
SiteSearch.mount({
    input: 'q', status: 'status', results: 'results',
    sources: [{ url: '/search-index.json', precompressed: true }],
});
</script>
```

Looks are the site's business: the engine appends an `<li>` holding `.where`
and `.snippet`, and highlights what it found with `<mark>`. How that reads is
for the site's stylesheet to say.

### `mount()`

| field          | what it does                                                             |
|----------------|--------------------------------------------------------------------------|
| `input`        | the search box: an id or the node itself                                 |
| `status`       | node for the status line                                                 |
| `results`      | node for the list of results                                             |
| `sources`      | indexes to start from; the rest arrive through their `shards`            |
| `showSection`  | `false` — don't repeat the section over every result (search inside one book) |
| `repeats`      | `4` — drop a paragraph standing word for word on four pages or more      |
| `lang`         | which language the reader is in; taken from the page's own `lang` unless given |
| `address`      | `false` — leave the page's address alone: the search is not the page's own |
| `more`         | `false` — no "показать ещё" control; the host has nowhere to put one     |
| `onRender`     | called after every draw, for a host holding its own handles on the rows  |

`mount` hands back `{ render, input, more }`. A page's own search ignores it and
keeps working off the field; a host that is not a page — the palette's dropdown —
drives `render` itself, so that nothing is searched until it says so.

`repeats` is for indexes whose builder does not cut page furniture away:
Jekyll has neither regular expressions nor a way to count repeats. Where the
builder does cut it, the rule would only walk the index for nothing, so it is
off by default.

## Jumping to a section

The search answers "where is that written about". The palette answers "take me
there", and for that it has to be on every page rather than on one:

```html
<script src="/sitesearch/palette.js"
        data-index="/nav-index.json"
        data-search="/search/"
        data-search-index="/search-index.json"
        data-search-precompressed="true"
        data-mount=".corner-tools" defer></script>
```

⌘K on macOS, Ctrl-K elsewhere, and "/" as a second shortcut for whoever has
neither. Esc closes, the arrows walk the list, Enter goes. Focus returns to
wherever the palette was opened from.

| attribute          | what it does                                                        |
|--------------------|---------------------------------------------------------------------|
| `data-index`       | the index to read — the only setting without a default              |
| `data-mount`       | selector for where the button goes; hangs in the corner if not found |
| `data-search`      | the full-text search page, named when the palette comes up empty    |
| `data-search-index` | the full index: a query the names miss goes to the text instead     |
| `data-search-precompressed` | `"true"` — a `.br` sits beside it                           |
| `data-engine`      | where search.js lives; defaults to next door to palette.js          |
| `data-placeholder` | what stands in the empty box                                        |
| `data-label`       | what the button is called, in its hint and to a screen reader       |

`SitePalette.mount({ index: … })` is the same thing said in JavaScript, for a
site that has somewhere to say it.

### Its index is not the search index

The palette rides on every page, and the search index cannot: a map of every
word of a site is tens of kilobytes at best. What the palette needs is `pages`
of FORMAT.md **without** `blocks` — an address, a name, a section, an order —
and a builder that already writes the search index can project that out of it
for a rounding error. On the smaller of the two sites this serves, 61 pages
come to 6 KB against 92 KB, and after compression 1.5 KB against 18 KB.

Whether the pages of a site's own shards belong in it is the site's call. They
did on both of these: a book kept out of the palette is the largest section of
the site invisible to it.

One field is the palette's own, and optional: `fallback`. A builder that walks a
site matches each page against a list of sections and has to put the unmatched
ones somewhere — a name the author chose, holding pages nobody assigned. Set
`fallback: true` on those pages and the palette stops treating the shallowest of
them as the section's front door. The name stays searchable; it is the
membership that was never chosen, not the name. Say nothing and nothing changes,
so an index built before this existed still works.

```json
{ "url": "/search/", "title": "Поиск", "section": "Институт", "fallback": true }
```

### When the names do not have it

A name index answers a question about names, and a reader does not know that is
the question they are being asked. «камень» is the name of nothing on one of
these sites and the name of a book listed on one of its pages.

So `data-search-index` lets a query that matched no name go on to the text of
the site, in the same dropdown, without leaving the page. The heavy index is
fetched at that moment and not before — a reader who finds what they came for by
name never pays for it, which is the whole reason the two indexes are separate.
The searching is search.js's; the palette only hands over the query and takes
the rows back under its own keyboard, so that arrows and Enter go on working and
Enter lands on the paragraph's own anchor.

Say nothing and the palette does what it did: names the search page and stops.

### Looks

Colours come from custom properties, dark by default; a site with a light theme
redefines them on `#nav-palette, #nav-open`:

```css
#nav-palette, #nav-open {
    --p-bg: var(--bg); --p-fg: var(--fg);
    --p-line: var(--border); --p-sel: rgba(128, 128, 160, .28);
    --p-mark: var(--link); --p-veil: rgba(0, 0, 0, .55);
}
```

The palette's own stylesheet goes in as the first thing in `<head>`, so that a
site's rules win every tie — including the ones about where `#nav-open` sits
when it is left hanging in the corner.

### Two folds, one repository

`palette.js` carries its own copy of the fold rather than calling
`SiteSearch.fold`: that one sits inside a 49 KB search engine, and hauling it
to every page for the sake of forty lines is not a trade worth making. A copy
diverges silently — «натья» stops finding `nāṭya` and nobody notices — so
`check-fold.js` runs both over one set of words and requires them to agree
character for character.

That check is the reason the palette lives here at all. A site that copied it
into itself would need the same check in a third place, comparing across
repositories, and would get it wrong.

```sh
node check-fold.js
```

## Building an index

The builders take different input; the output is the one described in
`FORMAT.md`.

### An HTML tree (Node)

`node/html.js` cuts a page into pieces on block-level tags without trying to
build a tree. Static-site pages are written by hand over years, `<p>` and `<li>`
in them are routinely left unclosed, and a real parser either chokes on that or
repairs the markup its own way.

```js
const { body, blocks } = require('./sitesearch/node/html.js');
const { writeIndex } = require('./sitesearch/node/write.js');

const inner = body(html, [/<a class="ph"[^>]*>[\s\S]*?<\/a>/g]);
writeIndex('search-index.json', { pages: [{ url, title, blocks: blocks(inner) }] });
```

The second argument to `body()` is the site's own furniture: the "#" beside
every paragraph, the footer, the tag list. There is nothing here that could
tell it apart from the text, and guessing is not called for.

### Jekyll pages (Liquid)

`jekyll/search-index.json` comes with the submodule and asks to sit at the site
root itself (`permalink`), so nothing needs wiring up. Jekyll builds the index,
which means it cannot drift from the text and needs neither npm, nor an action,
nor remembering to rebuild.

Sections and their order go in `_data/sitesearch.yml`:

```yaml
default:
  title: Institute
  order: 99
sections:
  art:   { title: Art,          order: 1 }
  dance: { title: Natya Shastra, order: 2 }
```

The key is the first segment of the address — or the second, where the first is
the page's own language: a translation at `/en/dance/ns-ch5` belongs to the
same section as the page it was translated from, a book not having changed what
part of the site it is in by being read in another language. Only a segment
that matches the page's `lang` is skipped, so a section that one day gets
called `en` is still found.

A section may carry its name in other languages under `named`, and then a page
is put in the section under the name that page is written in:

```yaml
sections:
  ksh: { title: Кашмирский шиваизм, named: { en: Kashmir Shaivism }, order: 4 }
```

The name stands over every result and in every line of the palette, so without
this it is the one word on an English page that the reader it was shown to
cannot read. It is also what finds the section: the palette searches the names
of sections along with the names of pages. A page leaves the index with
`search: false` in its front matter (that is how the search page itself stays
out); a single block leaves with the class `nosearch`.

A page that has a twin in another language says which one it is in — `lang: en`
in its front matter — and is then offered only to a reader standing on a page in
that language, as `<html lang>` declares it. A page that says nothing is offered
to everybody. Without this a site that publishes a translation answers every
query twice, in two languages, and the only way out is to keep the translation
out of the index — which is to say, unfindable.

The same file may name indexes Jekyll did not build, and they are passed to the
engine as its `shards`:

```yaml
shards:
  - url: /ship/search-index.json
    section: Marchaj's book
    order: 9
    defer: true
```

That is for the part of a site Jekyll cannot reach: a text living outside the
repository, a page whose content sits in a JavaScript literal. Such an index is
made beforehand by whatever suits it and lies ready as a file. Naming it here
rather than on the search page keeps what a site is made of in one place — the
search page asks for one index and is given the rest.

The rest of the submodule is no use to the site, and Jekyll should not know
about it:

```yaml
exclude:
  - sitesearch/README.md
  - sitesearch/FORMAT.md
  - sitesearch/check-fold.js
  - sitesearch/check-prepare.js
  - sitesearch/check-say.js
  - sitesearch/node/
```

## When one file is too much

The index is the text of the site, and while it is a few hundred kilobytes that
is the right shape: it arrives once, and every keystroke after that is free.
Past that it inverts — a reader who types one word downloads every word there is
in order to be shown ten paragraphs.

`node/two-tier.js` splits a **built** index into a map of words and the chunks of
text behind it (FORMAT.md). Nothing upstream changes: the builder writes the
same file it wrote before, and this runs over the finished site.

```sh
node node/two-tier.js _site /search-index.json --repeats 4
```

It rewrites the index in place as a map, writes the text into
`search-index-text/` beside it, and follows the index's own `shards` so that one
command converts the whole site. `--repeats 4` drops paragraphs standing word
for word on four pages or more — furniture the engine can also drop, except that
in two tiers it would have to be counted before any text had arrived, which is
exactly when there is none. `--chunk 32` is how many blocks travel together;
`--brotli 1` writes a compressed copy of every file, for a host that can serve
one.

The search page changes not at all: the map has the same address the index had,
and the engine recognises it by `"tier": 2`.

What it cost, measured on the larger of the two sites this serves — 138 pages,
11 865 paragraphs, three indexes:

| | one file | two tiers |
|---|---|---|
| opening the search page | 1 129 KB | 265 KB |
| and then one query | 0 | ~50 KB |
| fourteen different queries | 0 | ~280 KB more |
| requests | 3 | 3 + a few per query |

The map is most of what is left, and most of the map is the vocabulary: 39 580
words, front-coded, about four bytes each. Truncating those words to five
letters would have taken another 130 KB off, and was not done — `widen()` asks
the vocabulary whether a stem occurs at all, and a truncated vocabulary can only
guess. VS-21 measured what that promise above the results is worth; it is not
worth 130 KB.

Results are read for in the order they will be shown, and reading stops at
twenty of them. Whoever wants more asks — the engine puts a "показать ещё" button
after the list, and never shows a result it has read past a paragraph it has
not: a list that fills a gap from three pages further on is not the order of the
site, it is the order the network answered in.

## What state the indexes are in

`status.js` is a second page, for the site's own eyes: it fetches the same
indexes the search fetches and says what came back — size over the wire and
unpacked, pages, paragraphs, how many carry an anchor, how the pages divide
into sections, the largest of them, and what in the text does not look like
text: a surviving tag, an entity, a markdown link, a paragraph repeated across
pages, a page with no text at all.

```html
<div id="report"></div>
<script src="/sitesearch/status.js"></script>
<script>
SiteSearchStatus.mount({
    into: 'report',
    sources: [{ url: '/search-index.json', precompressed: true }],
});
</script>
```

It counts what the site serves rather than what a builder once printed: a page
reporting the build reports the build, and the question is what readers get.
`shards` are followed, so naming one source shows the whole set.

At the top stands a list of the indexes, each a link to its own section: one
index runs to a screenful, and an index named in another's `shards` is not
visible from the top of the page at all. The anchor is made from the address
(`#i-dance-search-index-json`), so it survives a reload and can be sent to
somebody.

An index in two tiers is put back together whole first — every chunk fetched,
several hundred requests and a megabyte or so. A reader fetches a handful; this
page is not a reader, and what it is for is precisely the text it would
otherwise never see.

## What the engine does with a query

- Folds case, "ё" and diacritics: `samadhi` finds `samādhi`, `srngara` finds
  `śṛṅgāra`. NFD splits a letter into a base and a mark and the mark is thrown
  away.
- Folds Cyrillic into Latin by the ordinary Russian rendering of Sanskrit, so
  that one word written two ways is one word: `śaktipāta`, `saktipata` and
  «шактипата» all fold to `saktipata`, and «нритта» meets `nṛtta` at `nritta`.
  The direction is not a matter of taste — «ш» is always `ś`, whereas `s` may be
  «с», «ш» or «щ», and only one of the two directions is a function. The price
  is paid in the same coin: after this «ш» and «с» are one letter, so a Russian
  query ending in either finds a few words it did not before.
- The fold therefore no longer keeps the length of the string, and the
  highlighting no longer rests on that: the window and the matches are worked
  out on the folded text and carried back through a map of where each letter
  came from. What is shown is always the text as it stands — searching in
  Cyrillic for a word written in IAST highlights the IAST.
- A match begins where a word begins. Without this, the Russian for "fear"
  finds the middle of the word for "detachment", and on a book of two hundred
  and forty results a hundred were rubbish.
- A Russian ending is cut off — but no more than two trailing vowels or a soft
  sign, and never below three letters. The opposite case takes care of itself:
  a query matches a longer word in the text because the beginning agrees.
- If the exact form is nowhere to be found, the word is cut a letter at a time
  and stops at the first stem that does occur in the text — but never below 60%
  of the word. The status line says plainly that what is shown shares a root
  rather than the form asked for, and that claim is what the share protects: a
  fixed floor of four letters cut a twelve-letter word in half and called
  whatever it landed on a relative. The 60% was measured over both sites'
  indexes against a stemmer, not chosen by eye.
- Where that stem reaches exactly one word of the site, the status line names
  it instead — as the text spells it, not as the engine folds it: «показано по
  «Parātrīśikāvivaraṇa»». Naming the word beats calling it a relative, and it
  is said only where it is exactly true; a stem that fans out to a dozen words
  is still reported as words of the same root.
- A word the site does not hold at all, no beginning of which it holds either,
  is read as a misspelling: the nearest word by edit distance is searched for
  instead, and named the same way. One letter for an ordinary word, two for a
  word of eight letters or more — and two only where the first two letters
  still agree, «касинового» being that far from «малинового» without being the
  same word in any sense. Nothing is offered under four letters: too little
  word to be wrong about. A tie goes to the word more of the text holds —
  `mandla` is one letter from both `mandala` and `manda`, and the first stands
  in twenty-three chunks of text against five, while alphabetical order would
  answer `manda` and mean nothing by it.
- A misspelling is looked for even when the stem did find something, so long as
  the stem fanned out — a word one letter away is not a guess, a stem that
  reached a dozen words is — and then at one letter only.
- The list of words to measure against costs nothing to keep: a two-tier index
  is a map of exactly that, and a flat one has all its text in hand anyway.
  Over the 84 686 words of ispacex.github.io, building the list and measuring
  every one of them against the query takes 7 ms, and happens only on a query
  that found nothing.
- Several words: what is found has all of them. Only a word the site does not
  hold is ever mended — in a query of several, the others are the ones that
  are right.
- The query lives in the address (`?q=`), so a link to a result set can be
  shared.

## What language it says it in

The reader's language — the same one by which the results themselves are
chosen, read off `<html lang>` unless `mount` is told otherwise. It picks a
column in the table each file keeps: `SAY` in `search.js` for the status line
("3 matches", "Nothing found"), `SAY` in `palette.js` for the palette's own
lines, its button and its empty box.

Adding a language is adding a column and nothing else — no call site below the
table names one. A language the table does not hold falls back to Russian,
which is what every page got before there was a table.

Everything that counts, or that puts a word inside a sentence, goes in as a
function, because both are the language's own business: Russian has three
plural forms and English two.

`check-say.js` holds the columns to each other — the same keys in each, the
same kind under each, nothing left standing in Russian in a column that is not,
nothing said that the table does not hold, and no phrase written at the call
site where it will stay Russian for as long as it lives there.

```sh
node check-say.js
```

Apart from these, nothing in the engine is language-bound except the Russian
ending rules, which do no harm to other languages.
