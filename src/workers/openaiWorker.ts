import { config } from "../config.js";

export async function runOpenAI(
  prompt: string,
  model = "gpt-6-luna",
  systemPrompt?: string
): Promise<string> {
  const apiKey = config.openai.apiKey;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY가 .env에 설정되지 않았습니다. OpenAI API를 사용하려면 키를 입력해주세요."
    );
  }

  const baseUrl = (config.openai.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");

  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API request failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as any;
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI API로부터 유효한 응답 텍스트를 받지 못했습니다.");
  }

  return content.trim();
}
