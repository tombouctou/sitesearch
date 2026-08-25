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
| `status.js`                 | reports the state of the indexes a site is serving      |
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

`repeats` is for indexes whose builder does not cut page furniture away:
Jekyll has neither regular expressions nor a way to count repeats. Where the
builder does cut it, the rule would only walk the index for nothing, so it is
off by default.

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

The key is the first segment of the address. A page leaves the index with
`search: false` in its front matter (that is how the search page itself stays
out); a single block leaves with the class `nosearch`.

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
- Several words: what is found has all of them.
- The query lives in the address (`?q=`), so a link to a result set can be
  shared.

The status line ("3 matches", "Nothing found") is written in Russian in
`search.js`, because both sites using it are Russian. An English-language site
would want those strings pulled out into an option; nothing else in the engine
is language-bound, apart from the Russian ending rules, which do no harm to
other languages.
