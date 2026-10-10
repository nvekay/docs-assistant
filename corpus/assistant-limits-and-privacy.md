# Usage limits and privacy

The Docs Assistant is a public demo, so it has limits that keep the cost of the language model under control.

## Rate limit

Each visitor can ask up to 10 questions per minute. If you ask more, the assistant replies with "Too many questions in a short time" and tells you how many seconds to wait. The limit uses a sliding window: as soon as your oldest question is more than a minute old, you can ask again.

## Daily limit

Each visitor has a daily budget of 200,000 tokens. A token is a piece of a word; one question with its answer usually uses between 1,000 and 4,000 tokens, because the documentation fragments are sent along with the question. There is also a shared daily budget for the whole demo. When you reach the daily limit, or the shared budget is used up, the assistant stops answering until 00:00 UTC, when budgets reset.

## Cost tracking

For every answer the assistant records the number of input and output tokens and the cost in US dollars. The administrator sees daily totals in the admin panel. The token count and cost of each answer are also shown under the answer in the chat.

## What is stored

You do not need an account to use the chat. The browser receives a cookie with a random identifier, which links your conversations and limits together. Questions and answers are stored in the database so a conversation can be continued after a page reload. Nothing else about you is collected.

## Stopping an answer

Pressing Stop, or closing the tab, cancels the request to the language model immediately, so no tokens are spent on an answer nobody reads.
