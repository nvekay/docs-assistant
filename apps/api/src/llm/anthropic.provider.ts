import Anthropic from '@anthropic-ai/sdk';
import { ChatRequestOptions, LlmProvider, LlmStreamEvent } from './llm.types';

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  effort: Effort;
  maxTokens: number;
}

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(private readonly options: AnthropicProviderOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
  }

  async *streamChat({ system, messages, signal }: ChatRequestOptions): AsyncIterable<LlmStreamEvent> {
    const stream = this.client.beta.messages.stream(
      {
        model: this.options.model,
        max_tokens: this.options.maxTokens,
        system,
        messages,
        // Thinking is adaptive by default on current Claude models; effort sets how much it thinks.
        output_config: { effort: this.options.effort },
        // If a safety classifier declines, the API retries on a suitable fallback model in the same call.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      },
      { signal },
    );

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { type: 'text', text: event.delta.text };
      }
    }

    const message = await stream.finalMessage();
    yield {
      type: 'final',
      model: message.model,
      usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
      stopReason:
        message.stop_reason === 'refusal' ? 'refusal' : message.stop_reason === 'max_tokens' ? 'max_tokens' : 'end',
    };
  }
}
