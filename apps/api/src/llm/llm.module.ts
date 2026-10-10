import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { AnthropicProvider } from './anthropic.provider';
import { FakeEmbeddingProvider, FakeLlmProvider } from './fake.provider';
import { EMBEDDING_PROVIDER, EmbeddingProvider, LLM_PROVIDER, LlmProvider } from './llm.types';
import { OpenAiEmbeddingProvider, OpenAiProvider } from './openai.provider';

/** Picks the chat model from LLM_PROVIDER; config validation guarantees the needed keys exist */
export function createLlmProvider(config: AppConfig): LlmProvider {
  switch (config.LLM_PROVIDER) {
    case 'anthropic':
      return new AnthropicProvider({
        apiKey: config.ANTHROPIC_API_KEY!,
        model: config.ANTHROPIC_MODEL,
        effort: config.ANTHROPIC_EFFORT,
        maxTokens: config.LLM_MAX_TOKENS,
      });
    case 'openai':
      return new OpenAiProvider({
        apiKey: config.OPENAI_API_KEY!,
        model: config.OPENAI_CHAT_MODEL!,
        maxTokens: config.LLM_MAX_TOKENS,
      });
    case 'fake':
      return new FakeLlmProvider(config.FAKE_LLM_DELAY_MS);
  }
}

export function createEmbeddingProvider(config: AppConfig): EmbeddingProvider {
  return config.EMBEDDING_PROVIDER === 'openai'
    ? new OpenAiEmbeddingProvider({ apiKey: config.OPENAI_API_KEY!, model: config.OPENAI_EMBEDDING_MODEL })
    : new FakeEmbeddingProvider();
}

@Global()
@Module({
  providers: [
    { provide: LLM_PROVIDER, inject: [APP_CONFIG], useFactory: createLlmProvider },
    { provide: EMBEDDING_PROVIDER, inject: [APP_CONFIG], useFactory: createEmbeddingProvider },
  ],
  exports: [LLM_PROVIDER, EMBEDDING_PROVIDER],
})
export class LlmModule {}
