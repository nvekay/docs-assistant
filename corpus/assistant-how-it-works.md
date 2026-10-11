# How the Docs Assistant works

The Docs Assistant answers questions using only the documents an administrator has uploaded. It does not search the internet and it does not use general knowledge to fill gaps.

## From document to searchable chunks

When an administrator uploads Markdown files, PDFs or a web page address, each document is saved with the status "queued" and a background worker picks it up. The worker extracts the text and splits it by section: every heading starts a new chunk of up to about 300 tokens, and each chunk begins with a line naming the document and the section, such as "Ledgerly: account and security › Reset your password". Each chunk is also turned into an embedding, a list of 1536 numbers computed from the words it contains. The chunks are stored in PostgreSQL, with the pgvector extension for the embeddings and a full-text index for the words. When indexing finishes, the document status changes to "ready".

If indexing fails, for example because a web page cannot be downloaded, the worker retries up to four times with growing pauses of 2, 4 and 8 seconds. After the last attempt the document is marked "failed" and the error is shown in the admin panel.

## How the assistant chooses its sources

For every question, the language model first rewrites it into a standalone English search query: it fills in what a follow-up such as "and on mobile?" refers to, translates questions asked in other languages, and adds synonyms the documentation might use.

The query is then searched in two ways at once across all documents: full-text search, which matches words in any form ("exporting invoices" finds "invoices can be exported"), and embedding similarity. The two result lists are merged, and the eight best chunks are kept, usually from several documents.

The chunks are numbered and sent to the language model together with the question and the last 24 messages of the conversation. The model is instructed to answer only from these fragments and to cite them with their numbers in square brackets.

## Citations

Each number in an answer refers to a documentation fragment. Clicking the number opens the exact text the statement is based on, together with the document, the section and the similarity score. Only fragments the answer actually cites are shown.

## When the documentation has no answer

If none of the fragments answers the question, the model says that the documentation does not cover it. This is intentional: an honest "not covered" is better than a confident guess.
