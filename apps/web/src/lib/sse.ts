/**
 * Reads a Server-Sent Events body from fetch() and yields each `data:` payload as JSON.
 * EventSource can't be used because POST /chat sends the question in the request body.
 */
export async function* readSseEvents<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const reader = body.getReader();
  // stream: true keeps a multi-byte character split across network chunks intact
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      // Events are separated by a blank line; a network chunk may hold several or half of one
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = raw
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (data) yield JSON.parse(data) as T;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
