import { readFile, writeFile, listDirectory } from "@/commands/fs"
import { streamChat } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"
import { useWikiStore } from "@/stores/wiki-store"
import { useChatStore } from "@/stores/chat-store"
import { useActivityStore } from "@/stores/activity-store"
import { useReviewStore, type ReviewItem } from "@/stores/review-store"
import { getFileName, normalizePath } from "@/lib/path-utils"
import { checkIngestCache, saveIngestCache } from "@/lib/ingest-cache"
import { getPrompts } from "@/i18n/prompts"

const FILE_BLOCK_REGEX = /---FILE:\s*([^\n-]+?)\s*---\n([\s\S]*?)---END FILE---/g

export const LANGUAGE_RULE = "## Language Rule\n- ALWAYS match the language of the source document. If the source is in Chinese, write in Chinese. If in English, write in English. Wiki page titles, content, and descriptions should all be in the same language as the source material."

/**
 * Auto-ingest: reads source → LLM analyzes → LLM writes wiki pages, all in one go.
 * Used when importing new files.
 */
export async function autoIngest(
  projectPath: string,
  sourcePath: string,
  llmConfig: LlmConfig,
  signal?: AbortSignal,
): Promise<string[]> {
  const pp = normalizePath(projectPath)
  const sp = normalizePath(sourcePath)
  const activity = useActivityStore.getState()
  const fileName = getFileName(sp)
  const activityId = activity.addItem({
    type: "ingest",
    title: fileName,
    status: "running",
    detail: "Reading source...",
    filesWritten: [],
  })

  const [sourceContent, schema, purpose, index, overview] = await Promise.all([
    tryReadFile(sp),
    tryReadFile(`${pp}/schema.md`),
    tryReadFile(`${pp}/purpose.md`),
    tryReadFile(`${pp}/wiki/index.md`),
    tryReadFile(`${pp}/wiki/overview.md`),
  ])

  // ── Cache check: skip re-ingest if source content hasn't changed ──
  const cachedFiles = await checkIngestCache(pp, fileName, sourceContent)
  if (cachedFiles !== null) {
    activity.updateItem(activityId, {
      status: "done",
      detail: `Skipped (unchanged) — ${cachedFiles.length} files from previous ingest`,
      filesWritten: cachedFiles,
    })
    return cachedFiles
  }

  const truncatedContent = sourceContent.length > 50000
    ? sourceContent.slice(0, 50000) + "\n\n[...truncated...]"
    : sourceContent

  // ── Step 1: Analysis ──────────────────────────────────────────
  // LLM reads the source and produces a structured analysis:
  // key entities, concepts, main arguments, connections to existing wiki, contradictions
  activity.updateItem(activityId, { detail: "Step 1/2: Analyzing source..." })

  const prompts = getPrompts()
  let analysis = ""

  await streamChat(
    llmConfig,
    [
      { role: "system", content: prompts.buildAnalysisPrompt(purpose, index, LANGUAGE_RULE) },
      { role: "user", content: `Analyze this source document:\n\n**File:** ${fileName}\n\n---\n\n${truncatedContent}` },
    ],
    {
      onToken: (token) => { analysis += token },
      onDone: () => {},
      onError: (err) => {
        activity.updateItem(activityId, { status: "error", detail: `Analysis failed: ${err.message}` })
      },
    },
    signal,
  )

  if (useActivityStore.getState().items.find((i) => i.id === activityId)?.status === "error") {
    return []
  }

  // ── Step 2: Generation ────────────────────────────────────────
  // LLM takes the analysis as context and produces wiki files + review items
  activity.updateItem(activityId, { detail: "Step 2/2: Generating wiki pages..." })

  let generation = ""

  await streamChat(
    llmConfig,
    [
      { role: "system", content: prompts.buildGenerationPrompt(schema, purpose, index, fileName, overview, LANGUAGE_RULE) },
      {
        role: "user",
        content: [
          `Based on the following analysis of **${fileName}**, generate the wiki files.`,
          "",
          "## Source Analysis",
          "",
          analysis,
          "",
          "## Original Source Content",
          "",
          truncatedContent,
        ].join("\n"),
      },
    ],
    {
      onToken: (token) => { generation += token },
      onDone: () => {},
      onError: (err) => {
        activity.updateItem(activityId, { status: "error", detail: `Generation failed: ${err.message}` })
      },
    },
    signal,
  )

  if (useActivityStore.getState().items.find((i) => i.id === activityId)?.status === "error") {
    return []
  }

  // ── Step 3: Write files ───────────────────────────────────────
  activity.updateItem(activityId, { detail: "Writing files..." })
  const writtenPaths = await writeFileBlocks(pp, generation)

  // Ensure source summary page exists (LLM may not have generated it correctly)
  const sourceBaseName = fileName.replace(/\.[^.]+$/, "")
  const sourceSummaryPath = `wiki/sources/${sourceBaseName}.md`
  const sourceSummaryFullPath = `${pp}/${sourceSummaryPath}`
  const hasSourceSummary = writtenPaths.some((p) => p.startsWith("wiki/sources/"))

  if (!hasSourceSummary) {
    const date = new Date().toISOString().slice(0, 10)
    const fallbackContent = [
      "---",
      `type: source`,
      `title: "Source: ${fileName}"`,
      `created: ${date}`,
      `updated: ${date}`,
      `sources: ["${fileName}"]`,
      `tags: []`,
      `related: []`,
      "---",
      "",
      `# Source: ${fileName}`,
      "",
      analysis ? analysis.slice(0, 3000) : "(Analysis not available)",
      "",
    ].join("\n")
    try {
      await writeFile(sourceSummaryFullPath, fallbackContent)
      writtenPaths.push(sourceSummaryPath)
    } catch {
      // non-critical
    }
  }

  if (writtenPaths.length > 0) {
    try {
      const tree = await listDirectory(pp)
      useWikiStore.getState().setFileTree(tree)
      useWikiStore.getState().bumpDataVersion()
    } catch {
      // ignore
    }
  }

  // ── Step 4: Parse review items ────────────────────────────────
  const reviewItems = parseReviewBlocks(generation, sp)
  if (reviewItems.length > 0) {
    useReviewStore.getState().addItems(reviewItems)
  }

  // ── Step 5: Save to cache ───────────────────────────────────
  if (writtenPaths.length > 0) {
    await saveIngestCache(pp, fileName, sourceContent, writtenPaths)
  }

  const detail = writtenPaths.length > 0
    ? `${writtenPaths.length} files written${reviewItems.length > 0 ? `, ${reviewItems.length} review item(s)` : ""}`
    : "No files generated"

  activity.updateItem(activityId, {
    status: writtenPaths.length > 0 ? "done" : "error",
    detail,
    filesWritten: writtenPaths,
  })

  return writtenPaths
}

async function writeFileBlocks(projectPath: string, text: string): Promise<string[]> {
  const writtenPaths: string[] = []
  const matches = text.matchAll(FILE_BLOCK_REGEX)

  for (const match of matches) {
    const relativePath = match[1].trim()
    const content = match[2]
    if (!relativePath) continue

    const fullPath = `${projectPath}/${relativePath}`
    try {
      if (relativePath === "wiki/log.md" || relativePath.endsWith("/log.md")) {
        const existing = await tryReadFile(fullPath)
        const appended = existing ? `${existing}\n\n${content.trim()}` : content.trim()
        await writeFile(fullPath, appended)
      } else {
        await writeFile(fullPath, content)
      }
      writtenPaths.push(relativePath)
    } catch (err) {
      console.error(`Failed to write ${fullPath}:`, err)
    }
  }

  return writtenPaths
}

const REVIEW_BLOCK_REGEX = /---REVIEW:\s*(\w[\w-]*)\s*\|\s*(.+?)\s*---\n([\s\S]*?)---END REVIEW---/g

function parseReviewBlocks(
  text: string,
  sourcePath: string,
): Omit<ReviewItem, "id" | "resolved" | "createdAt">[] {
  const items: Omit<ReviewItem, "id" | "resolved" | "createdAt">[] = []
  const matches = text.matchAll(REVIEW_BLOCK_REGEX)

  for (const match of matches) {
    const rawType = match[1].trim().toLowerCase()
    const title = match[2].trim()
    const body = match[3].trim()

    const type = (
      ["contradiction", "duplicate", "missing-page", "suggestion"].includes(rawType)
        ? rawType
        : "confirm"
    ) as ReviewItem["type"]

    // Parse OPTIONS line
    const optionsMatch = body.match(/^OPTIONS:\s*(.+)$/m)
    const options = optionsMatch
      ? optionsMatch[1].split("|").map((o) => {
          const label = o.trim()
          return { label, action: label }
        })
      : [
          { label: "Approve", action: "Approve" },
          { label: "Skip", action: "Skip" },
        ]

    // Parse PAGES line
    const pagesMatch = body.match(/^PAGES:\s*(.+)$/m)
    const affectedPages = pagesMatch
      ? pagesMatch[1].split(",").map((p) => p.trim())
      : undefined

    // Parse SEARCH line (optimized search queries for Deep Research)
    const searchMatch = body.match(/^SEARCH:\s*(.+)$/m)
    const searchQueries = searchMatch
      ? searchMatch[1].split("|").map((q) => q.trim()).filter((q) => q.length > 0)
      : undefined

    // Description is the body minus OPTIONS, PAGES, and SEARCH lines
    const description = body
      .replace(/^OPTIONS:.*$/m, "")
      .replace(/^PAGES:.*$/m, "")
      .replace(/^SEARCH:.*$/m, "")
      .trim()

    items.push({
      type,
      title,
      description,
      sourcePath,
      affectedPages,
      searchQueries,
      options,
    })
  }

  return items
}



function getStore() {
  return useChatStore.getState()
}

async function tryReadFile(path: string): Promise<string> {
  try {
    return await readFile(path)
  } catch {
    return ""
  }
}

export async function startIngest(
  projectPath: string,
  sourcePath: string,
  llmConfig: LlmConfig,
  signal?: AbortSignal,
): Promise<void> {
  const pp = normalizePath(projectPath)
  const sp = normalizePath(sourcePath)
  const store = getStore()
  store.setMode("ingest")
  store.setIngestSource(sp)
  store.clearMessages()
  store.setStreaming(false)

  const [sourceContent, schema, purpose, index] = await Promise.all([
    tryReadFile(sp),
    tryReadFile(`${pp}/wiki/schema.md`),
    tryReadFile(`${pp}/wiki/purpose.md`),
    tryReadFile(`${pp}/wiki/index.md`),
  ])

  const fileName = getFileName(sp)

  const prompts = getPrompts()
  const systemPrompt = prompts.ingestSystemPrompt(purpose, schema, index, LANGUAGE_RULE)
  const userMessage = prompts.ingestUserMessage(fileName, sourceContent)

  store.addMessage("user", userMessage)
  store.setStreaming(true)

  let accumulated = ""

  await streamChat(
    llmConfig,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    {
      onToken: (token) => {
        accumulated += token
        getStore().appendStreamToken(token)
      },
      onDone: () => {
        getStore().finalizeStream(accumulated)
      },
      onError: (err) => {
        getStore().finalizeStream(`Error during ingest: ${err.message}`)
      },
    },
    signal,
  )
}

export async function executeIngestWrites(
  projectPath: string,
  llmConfig: LlmConfig,
  userGuidance?: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const pp = normalizePath(projectPath)
  const store = getStore()

  const [schema, index] = await Promise.all([
    tryReadFile(`${pp}/wiki/schema.md`),
    tryReadFile(`${pp}/wiki/index.md`),
  ])

  const conversationHistory = store.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))

  const prompts = getPrompts()
  const writePrompt = prompts.ingestWritePrompt(userGuidance || "", schema, index)

  conversationHistory.push({ role: "user", content: writePrompt })

  store.addMessage("user", writePrompt)
  store.setStreaming(true)

  let accumulated = ""

  const systemPrompt = prompts.ingestWriteSystemPrompt(schema, LANGUAGE_RULE)

  await streamChat(
    llmConfig,
    [{ role: "system", content: systemPrompt }, ...conversationHistory],
    {
      onToken: (token) => {
        accumulated += token
        getStore().appendStreamToken(token)
      },
      onDone: () => {
        getStore().finalizeStream(accumulated)
      },
      onError: (err) => {
        getStore().finalizeStream(`Error generating wiki files: ${err.message}`)
      },
    },
    signal,
  )

  const writtenPaths: string[] = []
  const matches = accumulated.matchAll(FILE_BLOCK_REGEX)

  for (const match of matches) {
    const relativePath = match[1].trim()
    const content = match[2]

    if (!relativePath) continue

    const fullPath = `${pp}/${relativePath}`

    try {
      if (relativePath === "wiki/log.md" || relativePath.endsWith("/log.md")) {
        const existing = await tryReadFile(fullPath)
        const appended = existing
          ? `${existing}\n\n${content.trim()}`
          : content.trim()
        await writeFile(fullPath, appended)
      } else {
        await writeFile(fullPath, content)
      }
      writtenPaths.push(fullPath)
    } catch (err) {
      console.error(`Failed to write ${fullPath}:`, err)
    }
  }

  if (writtenPaths.length > 0) {
    const fileList = writtenPaths.map((p) => `- ${p}`).join("\n")
    getStore().addMessage("system", `Files written to wiki:\n${fileList}`)
  } else {
    getStore().addMessage("system", "No files were written. The LLM response did not contain valid FILE blocks.")
  }

  return writtenPaths
}
