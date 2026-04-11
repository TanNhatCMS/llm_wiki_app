import { streamText, type CoreMessage } from "ai"
import type { LlmConfig } from "@/stores/wiki-store"
import { getProviderModel } from "./llm-providers"
import { tools } from "./tools"

export type { CoreMessage as ChatMessage } from "ai"

export interface StreamCallbacks {
  onToken: (token: string) => void
  onToolCall?: (toolName: string, args: any) => void
  onToolResult?: (toolName: string, result: any) => void
  onDone: () => void
  onError: (error: Error) => void
}

export async function streamChat(
  config: LlmConfig,
  messages: CoreMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const { onToken, onDone, onError } = callbacks
  const model = getProviderModel(config)

  // System prompt might be merged into messages by AI SDK,
  // but if we are passing `system`, AI SDK accepts it on `streamText`
  // Here we just pass whatever we have directly into messages.
  let systemParam: string | undefined = undefined
  const filteredMessages: CoreMessage[] = []

  for (const m of messages) {
    if (m.role === "system" && typeof m.content === "string") {
      // Typically AI SDK prefers `system: ...` parameter in streamText
      // for some models like Anthropic. We extract the first system message.
      if (!systemParam) {
        systemParam = m.content
      } else {
        systemParam += `\n\n${m.content}`
      }
    } else {
      filteredMessages.push(m)
    }
  }

  // Create a combined signal for 15-minute timeout
  const timeoutMs = 15 * 60 * 1000
  let combinedSignal = signal
  let timeoutController: AbortController | undefined

  if (typeof AbortSignal.timeout === "function") {
    timeoutController = new AbortController()
    const timeoutId = setTimeout(() => timeoutController?.abort(), timeoutMs)

    if (signal) {
      signal.addEventListener("abort", () => {
        clearTimeout(timeoutId)
        timeoutController?.abort()
      })
    }
    combinedSignal = timeoutController.signal
  }

  try {
    const { fullStream } = streamText({
      model,
      system: systemParam,
      messages: filteredMessages,
      abortSignal: combinedSignal,
      tools,
      maxSteps: 5,
    })

    for await (const part of fullStream) {
      if (signal?.aborted) break

      switch (part.type) {
        case "text-delta":
          onToken(part.textDelta)
          break
        case "tool-call":
          callbacks.onToolCall?.(part.toolName, part.args)
          break
        case "tool-result":
          callbacks.onToolResult?.(part.toolName, part.result)
          break
        case "error":
          onError(part.error instanceof Error ? part.error : new Error(String(part.error)))
          break
      }
    }

    onDone()
  } catch (err: unknown) {
    if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
      onDone()
      return
    }
    // Handle WebKit or Fetch exceptions
    if (err instanceof Error && err.message === "Load failed") {
      onError(new Error("Connection lost or CORS prevented streaming. Try again."))
      return
    }
    onError(err instanceof Error ? err : new Error(String(err)))
  }
}
