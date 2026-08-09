---
type: learning
title: Asymmetric embeddings, and why retrieval silently gets worse
date: 2026-08-08
tags: [ai, embeddings, retrieval]
---

# Asymmetric embeddings, and why retrieval silently gets worse

## The concept

An embedding turns text into a vector — a point in a space of several
hundred dimensions — so that "close together" means "similar in meaning".
Search then becomes geometry: embed the question, find the nearest
stored points, return what they came from.

The part that is not obvious: modern embedding models are **asymmetric**.
They deliberately project a stored passage and a question about it into
_different_ regions, because a question rarely resembles its own answer.
"How do I reset a password?" shares almost no words with the paragraph
explaining it. A model trained to place them together has to be told
which side it is embedding — that is what a task type is:

- `RETRIEVAL_DOCUMENT` — this is something to store and later find
- `RETRIEVAL_QUERY` — this is somebody asking

Same model, same text, different vector.

A second rule follows. A vector is a coordinate in a space defined by
`(provider, model)`. Vectors from two different models are not
comparable, even when they have the same width.

## Why it matters

Both mistakes — embedding queries as documents, and comparing across
models — fail **silently**. Cosine similarity still returns a number
between -1 and 1. Nothing throws. The search still returns its nearest
neighbours; they are simply the wrong ones.

So the bug never presents as a bug. It presents as "the AI search isn't
very good", which gets attributed to the model, and gets fixed by
switching models, which does not help because the defect is in how the
vectors were made. Teams live with degraded retrieval for months.

This is why `EmbeddedVector` in `packages/ai/src/embeddings.ts` carries
its provider, model and task type alongside the numbers, and why
`isComparable()` checks provider and model but deliberately **ignores**
task type — a query vector is _meant_ to be compared against document
vectors. That asymmetry is the feature.

It is also why changing `JARVIS_EMBEDDING_GEMINI` invalidates every
stored vector. Nothing will error. The index simply stops being right.

## Common mistakes

- **Embedding both sides identically.** The default when task type is
  optional and nobody read the documentation.
- **Storing bare vectors.** Without the model that produced them, a
  stored vector cannot be safely reused after an upgrade, and
  re-embedding a corpus to recover that information is expensive.
- **Returning 0 for incomparable vectors.** Zero is a real score meaning
  "unrelated" — a caller ranking by score cannot distinguish it from a
  genuine answer. Returning null forces the caller to handle the case.
- **Embedding raw source code.** Code embeds mostly to its own
  boilerplate; a reader searching "where do we enforce budgets" is
  matching intent. `extractRepository` embeds a synthesised descriptor —
  path, purpose, exported names — for exactly this reason.
- **Chunking too large.** A whole document as one vector averages every
  topic in it into a point near nothing.

## Further reading

- Google, _Task types for Gemini embeddings_ — the enum and when each applies.
- Karpukhin et al., _Dense Passage Retrieval_ (2020) — the paper that
  established separate question and passage encoders.
- Reimers & Gurevych, _Sentence-BERT_ (2019) — why a naive sentence
  embedding is a poor retrieval key.
