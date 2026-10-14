# English Vocab word frequency data license

`en-wordfreq-30k.json` is distributed under the Creative Commons
Attribution-ShareAlike 4.0 International License:
https://creativecommons.org/licenses/by-sa/4.0/

The data is adapted from `wordfreq` by Robyn Speer:
https://github.com/rspeer/wordfreq

Source version: `wordfreq` 3.1.1.

The built `main.mjs` embeds a copy of this list; that embedded copy is covered by
this license as well (the rest of `main.mjs` is MIT licensed code).

Changes made by English Vocab:

- kept only words matching `^[a-z]+(?:'[a-z]+)*$`;
- preserved the upstream order after filtering;
- took the first 30,000 filtered English words;
- stored only that ordered word list, without frequencies.

The `wordfreq` package code is Apache licensed, and its included data files may
be redistributed under CC BY-SA 4.0. `wordfreq` includes data extracted from
Google Books Ngrams (http://books.google.com/ngrams) and Google Books Syntactic
Ngrams; Google asks that users acknowledge Google Books Ngram Viewer as the
source and include the Ngrams link.

`wordfreq` also includes data derived from Creative Commons licensed sources:
OpenSubtitles / OPUS OpenSubtitles, the Leeds Internet Corpus, Wikipedia, and
ParaCrawl. OpenSubtitles data should be attributed to OpenSubtitles.

`wordfreq` includes data from SUBTLEX word lists created by Marc Brysbaert and
coauthors. Robyn Speer records permission to distribute those word lists in
`wordfreq`; derived code or data must credit the SUBTLEX authors and make clear
that SUBTLEX is freely available data.
