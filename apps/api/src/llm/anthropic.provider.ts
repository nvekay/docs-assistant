import Anthropic from '@anthropic-ai/sdk';
import { ChatRequestOptions, Completion, CompletionOptions, LlmProvider, LlmStreamEvent } from './llm.types';

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  effort: Effort;
  maxTokens: number;
  /** Retry on a fallback model when the requested one declines for policy reasons (beta) */
  fallback: boolean;
  /** Needed only for keys that are not scoped to a workspace (the API then asks which one to bill) */
  workspaceId?: string;
}

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(private readonly options: AnthropicProviderOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      defaultHeaders: options.workspaceId ? { 'anthropic-workspace-id': options.workspaceId } : undefined,
    });
  }

  async complete({ system, messages, maxTokens, signal }: CompletionOptions): Promise<Completion> {
    const message = await this.client.messages.create(
      {
        model: this.options.model,
        max_tokens: maxTokens,
        system,
        messages,
        // Short utility calls (query rewriting) need no deliberation
        output_config: { effort: 'low' },
      },
      { signal },
    );
    return {
      text: message.content.map((block) => (block.type === 'text' ? block.text : '')).join(''),
      usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
      model: message.model,
    };
  }

  async *streamChat({ system, messages, signal }: ChatRequestOptions): AsyncIterable<LlmStreamEvent> {
    const params = {
      model: this.options.model,
      max_tokens: this.options.maxTokens,
      system,
      messages,
      // Thinking is adaptive on current Claude models; effort sets how much it thinks (and so the cost)
      output_config: { effort: this.options.effort },
    };
    const stream = this.options.fallback
      ? this.client.beta.messages.stream(
          { ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
          { signal },
        )
      : this.client.messages.stream(params, { signal });

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
