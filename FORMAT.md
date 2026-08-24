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

## What is not here

No inverted index, no positions, no weights. The index is the text of the site
laid out page by page, and matches are found across the whole of it on every
keystroke. While the site's text fits in a few hundred kilobytes of brotli this
is cheap, and one file beats any split: it arrives once, and after that the
search fetches nothing at all.
