import { TokenUsage } from './llm.types';

/** Cost in USD for one request, given prices per million tokens */
export function calculateCostUsd(usage: TokenUsage, pricePerMTok: { input: number; output: number }): number {
  const cost = (usage.inputTokens * pricePerMTok.input + usage.outputTokens * pricePerMTok.output) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000; // matches numeric(12, 6) in the usage table
}
