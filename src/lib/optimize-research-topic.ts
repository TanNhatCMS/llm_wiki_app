import { streamChat } from "./llm-client"
import type { LlmConfig } from "@/stores/wiki-store"

import { getPrompts } from "@/i18n/prompts"

export interface OptimizedTopic {
  topic: string
  searchQueries: string[]
}

/**
 * Use LLM to generate a context-aware research topic and search queries
 * based on the knowledge gap and the wiki's purpose/overview.
 */
export async function optimizeResearchTopic(
  llmConfig: LlmConfig,
  gapTitle: string,
  gapDescription: string,
  gapType: string,
  overview: string,
  purpose: string,
): Promise<OptimizedTopic> {
  const prompts = getPrompts()
  const prompt = prompts.optimizeResearchPrompt(gapType, gapTitle, gapDescription, overview, purpose)

  let result = ""

  await streamChat(
    llmConfig,
    [{ role: "user", content: prompt }],
    {
      onToken: (token) => { result += token },
      onDone: () => {},
      onError: () => {},
    },
  )

  // Parse response
  const topicMatch = result.match(/^TOPIC:\s*(.+)$/m)
  const queryMatches = [...result.matchAll(/^QUERY:\s*(.+)$/gm)]

  const topic = topicMatch?.[1]?.trim() ?? gapTitle
  const searchQueries = queryMatches
    .slice(0, 3)
    .map((m) => m[1].trim())
    .filter((q) => q.length > 0)

  return {
    topic,
    searchQueries: searchQueries.length > 0 ? searchQueries : [topic],
  }
}
