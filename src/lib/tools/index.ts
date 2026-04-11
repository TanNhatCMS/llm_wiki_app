import { tool } from "ai"
import { z } from "zod"
import { listDirectory, readFile, writeFile } from "@/commands/fs"
import { webSearch } from "@/lib/web-search"
import { useWikiStore, type SearchApiConfig } from "@/stores/wiki-store"
import { normalizePath } from "@/lib/path-utils"

/**
 * Get the current project path from the store.
 */
function getProjectPath(): string {
  const project = useWikiStore.getState().project
  if (!project) throw new Error("No wiki project open")
  return normalizePath(project.path)
}

/**
 * Helper to flatten file tree names.
 */
function flattenFilePaths(nodes: any[], base: string = "wiki"): string[] {
  const paths: string[] = []
  for (const node of nodes) {
    const relativePath = `${base}/${node.name}`
    if (node.is_dir) {
      if (node.children) {
        paths.push(...flattenFilePaths(node.children, relativePath))
      }
    } else {
      paths.push(relativePath)
    }
  }
  return paths
}

export const tools = {
  list_wiki_pages: tool({
    description: "List all pages currently in the wiki to see what information is available.",
    parameters: z.object({}),
    execute: async () => {
      const pp = getProjectPath()
      try {
        const tree = await listDirectory(`${pp}/wiki`)
        const paths = flattenFilePaths(tree)
        return { pages: paths }
      } catch (err) {
        return { error: `Failed to list wiki pages: ${String(err)}` }
      }
    },
  }),

  read_wiki_page: tool({
    description: "Read the full content of a specific wiki page.",
    parameters: z.object({
      path: z.string().description("The relative path to the wiki page (e.g., 'wiki/entities/ai.md')"),
    }),
    execute: async ({ path }) => {
      const pp = getProjectPath()
      try {
        const fullPath = path.startsWith(pp) ? path : `${pp}/${path}`
        const content = await readFile(fullPath)
        return { content }
      } catch (err) {
        return { error: `Failed to read page ${path}: ${String(err)}` }
      }
    },
  }),

  write_wiki_page: tool({
    description: "Create or update a wiki page with new information.",
    parameters: z.object({
      path: z.string().description("The relative path to the wiki page (e.g., 'wiki/entities/new-page.md')"),
      content: z.string().description("The full markdown content for the page, including YAML frontmatter."),
    }),
    execute: async ({ path, content }) => {
      const pp = getProjectPath()
      try {
        const fullPath = path.startsWith(pp) ? path : `${pp}/${path}`
        await writeFile(fullPath, content)
        // Refresh the file tree in the store
        const tree = await listDirectory(pp)
        useWikiStore.getState().setFileTree(tree)
        useWikiStore.getState().bumpDataVersion()
        return { success: true, path }
      } catch (err) {
        return { error: `Failed to write page ${path}: ${String(err)}` }
      }
    },
  }),

  web_search: tool({
    description: "Search the web for up-to-date information on a topic.",
    parameters: z.object({
      query: z.string().description("The search query"),
    }),
    execute: async ({ query }) => {
      const searchConfig = useWikiStore.getState().searchApiConfig
      try {
        const results = await webSearch(query, searchConfig, 5)
        return { results }
      } catch (err) {
        return { error: `Web search failed: ${String(err)}` }
      }
    },
  }),
}
