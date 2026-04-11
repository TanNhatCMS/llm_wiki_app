import type { SearchApiConfig } from "@/stores/wiki-store"

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
  source: string
}

export async function webSearch(
  query: string,
  config: SearchApiConfig,
  maxResults: number = 10,
): Promise<WebSearchResult[]> {
  if (config.provider === "none" || (config.provider !== "duckduckgo" && !config.apiKey)) {
    throw new Error("Web search not configured. Add an API key in Settings or choose a free provider.")
  }

  switch (config.provider) {
    case "tavily":
      return tavilySearch(query, config.apiKey || "", maxResults)
    case "duckduckgo":
      return duckduckgoSearch(query, maxResults)
    default:
      throw new Error(`Unknown search provider: ${config.provider}`)
  }
}

async function tavilySearch(
  query: string,
  apiKey: string,
  maxResults: number,
): Promise<WebSearchResult[]> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      search_depth: "advanced",
      include_answer: false,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(`Tavily search failed (${response.status}): ${errorText}`)
  }

  const data = await response.json()

  return (data.results ?? []).map((r: { title: string; url: string; content: string }) => ({
    title: r.title ?? "Untitled",
    url: r.url ?? "",
    snippet: r.content ?? "",
    source: new URL(r.url).hostname.replace("www.", ""),
  }))
}

async function duckduckgoSearch(
  query: string,
  maxResults: number,
): Promise<WebSearchResult[]> {
  const response = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ q: query }).toString(),
  })

  if (!response.ok) {
    throw new Error(`DuckDuckGo search failed (${response.status})`)
  }

  const html = await response.text()

  const parser = new DOMParser()
  const doc = parser.parseFromString(html, "text/html")

  const results: WebSearchResult[] = []
  const elements = doc.querySelectorAll('.result')

  for (const el of elements) {
    if (results.length >= maxResults) break

    const titleEl = el.querySelector('.result__title a.result__url') as HTMLAnchorElement
    const snippetEl = el.querySelector('.result__snippet') as HTMLElement

    if (titleEl && snippetEl) {
      let url = titleEl.getAttribute('href') || ''
      if (url.startsWith('//')) {
        url = 'https:' + url
        try {
          const urlObj = new URL(url)
          const uddg = urlObj.searchParams.get('uddg')
          if (uddg) url = decodeURIComponent(uddg)
        } catch (e) {
          // ignore parsing error
        }
      }

      results.push({
        title: titleEl.textContent?.trim() || "Untitled",
        url: url,
        snippet: snippetEl.textContent?.trim() || "",
        source: url ? new URL(url).hostname.replace("www.", "") : "duckduckgo",
      })
    }
  }

  return results
}
