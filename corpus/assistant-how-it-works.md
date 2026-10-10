# How the Docs Assistant works

The Docs Assistant answers questions using only the documents an administrator has uploaded. It does not search the internet and it does not use general knowledge to fill gaps.

## From document to searchable chunks

When an administrator uploads a Markdown file, a PDF or a web page address, the document is saved with the status "queued" and a background worker picks it up. The worker extracts the text, splits it into chunks of about 800 tokens with an overlap of 100 tokens between neighbouring chunks, and turns each chunk into an embedding: a list of 1536 numbers that captures its meaning. The chunks and embeddings are stored in PostgreSQL with the pgvector extension. When indexing finishes, the document status changes to "ready".

If indexing fails, for example because a web page cannot be downloaded, the worker retries up to four times with growing pauses of 2, 4 and 8 seconds. After the last attempt the document is marked "failed" and the error is shown in the admin panel.

## How the assistant chooses its sources

For every question, the assistant turns the question into an embedding and looks for the six chunks with the most similar meaning, using cosine similarity. Chunks whose similarity is below a relevance threshold are discarded, so weak matches never reach the model. Short follow-up questions, such as "and on mobile?", are searched together with the previous question so they keep their context.

The remaining chunks are numbered and sent to the language model together with the question and the last few messages of the conversation. The model is instructed to answer only from these fragments and to cite them with their numbers in square brackets.

## Citations

Each number in an answer refers to a documentation fragment. Clicking the number opens the exact text the statement is based on, together with the document title and the similarity score. Only fragments the answer actually cites are shown.

## When the documentation has no answer

If no chunk is relevant enough, the model is told that nothing matched, and it replies that the documentation does not cover the question. This is intentional: an honest "not covered" is better than a confident guess.
