import i18n from "@/i18n"
import { PromptsEn } from "./en"
import { PromptsVi } from "./vi"

export type AppPrompts = typeof PromptsEn

export function getPrompts(): AppPrompts {
  const lang = i18n.language || "en"
  if (lang.startsWith("vi")) {
    return PromptsVi
  }
  // Default to English
  return PromptsEn
}
