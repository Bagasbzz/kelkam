import { llmsText } from "@/lib/seo/site";

/** /llms.txt: ringkasan fitur untuk asisten AI (ChatGPT, Claude, Perplexity, Gemini). */
export const dynamic = "force-static";

export function GET() {
  return new Response(llmsText(), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
