# The index: a contract

An index is one static JSON file. A builder writes it, the engine reads it, and
nothing else passes between them. The engine does not know what the index was
built from, and the builder does not know how results are laid out. What follows
is that border.

```json
{
  "pages": [
    {
      "url": "/links/math/",
      "title": "Mathematics",
      "also": "Math",
      "section": "Links",
      "order": 1,
      "blocks": [
        { "text": "A paragraph as it stands, in bare text.", "anchor": "p7", "section": "Derivatives" },
        "A paragraph with no anchor and no heading above it."
      ]
    }
  ],
  "shards": [
    { "url": "/b/mctb2/search-index.json", "section": "The book", "order": 6, "defer": true }
  ]
}
```

## A page

| field     | required | what it is                                                       |
|-----------|----------|------------------------------------------------------------------|
| `url`     | yes      | the address the site serves it at                                |
| `title`   | yes      | the name shown in the line above a result                        |
| `also`    | no       | a second name, searched equally but never shown                  |
| `section` | no       | the part of the site; a source may name it for the whole batch   |
| `order`   | no       | order in the results; pages sharing an `order` keep their listed order |
| `blocks`  | yes      | the pieces of text on it                                         |

A page is a result in its own right: if the query matches its name it appears,
even when no paragraph matched. Otherwise a word living only in a chapter
heading is never found at all.

`also` is for where the short name and the full one are different strings: a
table of contents shortens "3. Concentration: the second training" to
"3. Concentration", and both have to be searchable.

## A block

A paragraph, a list item, a table row, a verse — whatever the builder took to be
a unit of text.

| field     | required | what it is                                                    |
|-----------|----------|---------------------------------------------------------------|
| `text`    | yes      | bare text: no markup, no entities                             |
| `anchor`  | no       | the anchor on the page a link should reach (no "#")            |
| `section` | no       | the heading above this piece; searched along with the text     |

A block with neither an anchor nor a heading is written as a plain string:
`"A paragraph as it stands."` That means the same as
`{"text": "A paragraph as it stands."}` — shorter in the file, and simpler in a
Liquid template where every brace costs something.

**The text must be bare.** No `<b>`, no `**`, no `&amp;`: whatever lands in
`text` is shown to the reader as it stands and searched as it stands. Stripping
markup is the job of the builder, which holds the whole page; an engine that
takes to stripping it has thereby learnt what the index was built from, and
there is no contract left.

## Neighbouring indexes

`shards` names other indexes to be searched alongside this one. Each is
described by the same fields as a source in `mount()`: `url`, and optionally
`section`, `order`, `defer`, `precompressed`.

This is how the builder decides what the site is made of, rather than every
search page restating it: a page names one index and the rest follows.

`defer` holds off loading until the first query — a megabyte of book has no
business travelling to someone who is only passing through.

`precompressed` says a `<url>.br` sits next to it, and the engine will ask for
that first. The host must then serve such a file with `content-encoding: br`;
should it stop, the engine falls back to the plain file on its own. Where a
compressed copy cannot be put, the flag must be absent — otherwise every index
costs a needless 404.

## The same index in two tiers

Everything above is one file holding the text of the site, and while that text
fits in a few hundred kilobytes it beats any split: it arrives once, and the
search then fetches nothing at all, ever.

Past that size it stops paying. A reader who types one word downloads every word
there is in order to be shown ten paragraphs. `node/two-tier.js` then converts
the index above — unchanged, the builder need know nothing of this — into a
**map** and the **chunks of text** behind it. The map keeps the same name and
address; the chunks go into a directory beside it.

```json
{
  "tier": 2,
  "text": "search-index-text/",
  "chunk": 32,
  "pages": [
    { "url": "/links/math/", "title": "Mathematics", "also": "Math",
      "section": "Links", "order": 1, "blocks": 74 }
  ],
  "words": "0abacus\n1bacus\n0derivative\na s",
  "postings": "0,3,1\n7\n0,1",
  "shards": []
}
```

| field      | what it is                                                          |
|------------|---------------------------------------------------------------------|
| `tier`     | `2`, and that is what tells the engine which contract it is reading  |
| `text`     | where the chunks live, relative to the map's own address             |
| `chunk`    | how many blocks travel together                                      |
| `pages`    | as above, except that `blocks` is a **count**, not the blocks        |
| `words`    | every word in the text, sorted, front-coded                          |
| `postings` | for each word, the chunks holding it                                 |

A page is otherwise described exactly as above, and `shards` means what it meant.

**`words`** is one string, words separated by `\n`, each written as the number of
letters it shares with the word before it — one base-36 digit, so at most 35 —
and then the rest of itself. `"0abacus\n1bacus"` is `abacus`, `abbacus`.

**`postings`** is one string, one line per word in the same order, each line the
chunk numbers holding that word: ascending, as gaps, in base 36, comma
separated. `"0,3,1"` is chunks 0, 3 and 4.

**Chunk numbers are stored nowhere.** They run through the pages in order, `chunk`
blocks at a time, and both sides count them the same way; page 0 with 74 blocks
and a chunk of 32 owns chunks 0, 1 and 2, and page 1 begins at 3. Chunk 5 is
fetched from `<text>5.json`, and holds an array of blocks in the shape described
above — the very array that stood in the flat index.

A page's own **name is not in `words`**. It is already in the map, so a query
matching a name is answered without fetching anything.

### What the map is, and is not

The map says where a word *may* be. It never says what matched. A chunk it names
is fetched and then searched by the same code that searches a flat index, so:

- a chunk that turns out to hold nothing costs one request and no correctness;
- a query is never answered from the map alone, and the engine can therefore
  match by rules the map knows nothing about;
- the builder may drop, merge or reword nothing — the text in the chunks is the
  text the flat index held.

What the map must never do is *miss*. Every block that could match must be in a
chunk the map names for that query. That is why `words` holds whole words rather
than stems or truncations: the engine matches at the start of a word, so a query
term is a prefix, and a prefix search over a sorted vocabulary answers exactly.
