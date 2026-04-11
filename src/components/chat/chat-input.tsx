import { useRef, useState, useCallback } from "react"
import { Send, Square } from "lucide-react"
import { Button } from "@/components/ui/button"

interface ChatInputProps {
  onSend: (text: string) => void
  onStop: () => void
  isStreaming: boolean
  placeholder?: string
}

export function ChatInput({ onSend, onStop, isStreaming, placeholder }: ChatInputProps) {
  const [value, setValue] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value)
    const ta = e.target
    ta.style.height = "auto"
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`
  }, [])

  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || isStreaming) return
    onSend(trimmed)
    setValue("")
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
  }, [value, isStreaming, onSend])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  return (
    <div className="relative border-t bg-background/50 backdrop-blur-md px-4 py-4 sm:px-6">
      <div className="mx-auto max-w-3xl relative flex items-end gap-2 rounded-xl border bg-background/80 shadow-sm focus-within:ring-1 focus-within:ring-primary/30 transition-shadow">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? "Ask anything... (Shift + Enter for new line)"}
          disabled={isStreaming}
          rows={1}
          className="flex-1 resize-none bg-transparent px-4 py-3 text-sm placeholder:text-muted-foreground/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          style={{ maxHeight: "200px", overflowY: "auto" }}
        />
        <div className="flex items-center p-2">
          {isStreaming ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={onStop}
              className="h-8 w-8 rounded-lg text-destructive hover:bg-destructive/10 hover:text-destructive"
              title="Stop generation"
            >
              <Square className="h-4 w-4 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!value.trim()}
              className="h-8 w-8 rounded-lg disabled:opacity-30"
              title="Send message"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      <p className="mt-2 text-center text-[10px] text-muted-foreground/50">
        AI can make mistakes. Verify important information.
      </p>
    </div>
  )
}
