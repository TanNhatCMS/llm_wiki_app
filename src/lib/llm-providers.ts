import { createOpenAI } from "@ai-sdk/openai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOllama } from "ollama-ai-provider"
import { createPerplexity } from "@ai-sdk/perplexity"
import { createVertex } from "@ai-sdk/google-vertex"
import { createDeepSeek } from "@ai-sdk/deepseek"
import { createMistral } from "@ai-sdk/mistral"
import { createGroq } from "@ai-sdk/groq"
import { createXai } from "@ai-sdk/xai"
import { createTogetherAI } from "@ai-sdk/togetherai"
import { createCohere } from "@ai-sdk/cohere"
import { createAlibaba } from "@ai-sdk/alibaba"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"

import type { LanguageModelV1 } from "ai"
import type { LlmConfig } from "@/stores/wiki-store"

// Export native ChatMessage type from AI SDK if needed elsewhere
export type { CoreMessage as ChatMessage } from "ai"

export function getProviderModel(config: LlmConfig): LanguageModelV1 {
  const { provider, apiKey, model, ollamaUrl, customEndpoint } = config

  switch (provider) {
    case "openai": {
      const openai = createOpenAI({
        apiKey: apiKey || "",
        compatibility: "strict",
        fetch: window.fetch,
        // @ts-expect-error some SDKs export this, some do not, but we inject it defensively
        dangerouslyAllowBrowser: true,
      })
      return openai(model || "gpt-4o")
    }

    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey: apiKey || "",
        fetch: window.fetch,
        // @ts-expect-error Some AI SDK providers require this flag to bypass browser check
        dangerouslyAllowBrowser: true,
      })
      return anthropic(model || "claude-3-5-sonnet-latest")
    }

    case "google": {
      const google = createGoogleGenerativeAI({
        apiKey: apiKey || "",
        fetch: window.fetch,
        // @ts-expect-error
        dangerouslyAllowBrowser: true,
      })
      return google(model || "gemini-2.5-flash")
    }

    case "ollama": {
      const ollama = createOllama({
        baseURL: `${ollamaUrl || "http://localhost:11434"}/api`,
      })
      return ollama(model || "llama3")
    }

    case "perplexity": {
      const perplexity = createPerplexity({
        apiKey: apiKey || "",
        fetch: window.fetch,
      })
      return perplexity(model || "sonar")
    }

    case "vertex": {
      const vertex = createVertex({
        fetch: window.fetch,
      })
      return vertex(model || "gemini-1.5-pro")
    }

    case "deepseek": {
      const deepseek = createDeepSeek({
        apiKey: apiKey || "",
        fetch: window.fetch,
      })
      return deepseek(model || "deepseek-chat")
    }

    case "mistral": {
      const mistral = createMistral({
        apiKey: apiKey || "",
        fetch: window.fetch,
      })
      return mistral(model || "mistral-large-latest")
    }

    case "groq": {
      const groq = createGroq({
        apiKey: apiKey || "",
        fetch: window.fetch,
        // @ts-expect-error
        dangerouslyAllowBrowser: true,
      })
      return groq(model || "llama3-70b-8192")
    }

    case "xai": {
      const xai = createXai({
        apiKey: apiKey || "",
        fetch: window.fetch,
      })
      return xai(model || "grok-2-latest")
    }

    case "togetherai": {
      const togetherai = createTogetherAI({
        apiKey: apiKey || "",
        fetch: window.fetch,
      })
      return togetherai(model || "meta-llama/Llama-3-70b-chat-hf")
    }

    case "cohere": {
      const cohere = createCohere({
        apiKey: apiKey || "",
        fetch: window.fetch,
      })
      return cohere(model || "command-r-plus")
    }

    case "alibaba": {
      const alibaba = createAlibaba({
        apiKey: apiKey || "",
        fetch: window.fetch,
      })
      return alibaba(model || "qwen-max")
    }

    case "custom": {
      const customProvider = createOpenAICompatible({
        name: "custom",
        baseURL: customEndpoint ? customEndpoint.replace(/\/v1$/, '') : "http://localhost:8080/v1",
        apiKey: apiKey || "",
        fetch: window.fetch,
      })
      return customProvider(model || "local-model")
    }

    default: {
      const exhaustive: never = provider
      throw new Error(`Unknown provider: ${String(exhaustive)}`)
    }
  }
}
