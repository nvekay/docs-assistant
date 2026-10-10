import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { AnthropicProvider } from './anthropic.provider';
import { FakeLlmProvider } from './fake.provider';
import { KeywordEmbeddingProvider } from './keyword-embeddings';
import { EMBEDDING_PROVIDER, LLM_PROVIDER, LlmProvider } from './llm.types';

/** Claude in production; the keyless fake model for local development and tests */
export function createLlmProvider(config: AppConfig): LlmProvider {
  if (config.LLM_PROVIDER === 'anthropic') {
    return new AnthropicProvider({
      apiKey: config.ANTHROPIC_API_KEY!, // config validation guarantees it is set
      model: config.ANTHROPIC_MODEL,
      effort: config.ANTHROPIC_EFFORT,
      maxTokens: config.LLM_MAX_TOKENS,
      fallback: config.ANTHROPIC_FALLBACK,
      workspaceId: config.ANTHROPIC_WORKSPACE_ID,
    });
  }
  return new FakeLlmProvider(config.FAKE_LLM_DELAY_MS);
}

@Global()
@Module({
  providers: [
    { provide: LLM_PROVIDER, inject: [APP_CONFIG], useFactory: createLlmProvider },
    { provide: EMBEDDING_PROVIDER, useFactory: () => new KeywordEmbeddingProvider() },
  ],
  exports: [LLM_PROVIDER, EMBEDDING_PROVIDER],
})
export class LlmModule {}
