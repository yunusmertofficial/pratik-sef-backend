import { GoogleGenAI, Type, Modality } from "@google/genai"
import crypto from "node:crypto"
import { Recipe, MEAL_TYPES, TextMode, TextResult } from "../types"

const apiKey = process.env.API_KEY
const ai = new GoogleGenAI({ apiKey: apiKey || "MISSING_KEY" })

const ensureApiKey = () => {
  if (!apiKey || apiKey === "MISSING_KEY") {
    throw new Error("API_KEY missing or invalid")
  }
}

export const generateRecipe = async (ingredients: string, mealTypeId: string, isAlternative: boolean = false): Promise<Recipe> => {
  ensureApiKey()
  const mealType = MEAL_TYPES.find(m => m.id === mealTypeId)
  const typeLabel = mealType ? mealType.title : "Yemek"
  const typeDesc = mealType ? mealType.description : ""

  const prompt = `You are an expert Turkish Chef (Usta), deeply knowledgeable in traditional Anatolian/Ottoman cuisine as well as modern Turkish gastronomy.

INPUT INGREDIENTS: ${ingredients}
SELECTED CATEGORY: ${typeLabel} (${typeDesc})

GUIDELINES FOR TURKISH CHEF:
1. PRIORITY: TRADITIONAL MATCH (Geleneksel Önceliği): Before being creative, check if the input ingredients strongly match a classic/traditional Turkish dish (Yöresel Yemek). If the ingredients clearly point to a known classic (e.g., Eggplant+Minced Meat -> Karnıyarık, Lentils+Bulgur -> Ezogelin), YOU MUST SUGGEST THAT CLASSIC DISH FIRST. Do not invent a new name if a cultural classic fits perfectly.
2. Palate Compatibility: The recipe MUST appeal to Turkish taste buds. Prioritize flavor profiles involving tomato paste (salça), roasting, stewing, or olive oil (zeytinyağlı) techniques if appropriate.
3. Ingredient Accessibility: Prioritize ingredients commonly found in Turkish kitchens and markets. Assume basic pantry items (salça, onion, garlic, olive oil, flour, spices) are available.
4. Language: Output must be in fluent, warm, and professional Turkish.

CONSTRAINTS:
- The recipe MUST strictly fit the '${typeLabel}' category.
- If category is 'Hızlı Çözüm', the total preparation and cooking time MUST be under 30 minutes.
${isAlternative ? "- RE-ROLL INSTRUCTION: The user did not like the previous suggestion. Create a COMPLETELY DIFFERENT recipe. Change the cooking method or the main flavor profile. Do not suggest the same dish again." : ""}

Output JSON only.`

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          ingredients: { type: Type.ARRAY, items: { type: Type.STRING } },
          steps: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["title", "description", "ingredients", "steps"]
      }
    }
  })

  const text = (response as any).text
  if (!text || text.trim().length === 0) throw new Error("Model returned empty response")
  let baseRecipe: any
  try {
    baseRecipe = JSON.parse(text)
  } catch {
    throw new Error("Model returned non-JSON output")
  }
  return { ...baseRecipe, id: crypto.randomUUID(), mealType: typeLabel, createdAt: Date.now() }
}

export const generateRecipeImage = async (recipeTitle: string, recipeDesc: string): Promise<string> => {
  const prompt = `delicious professional food photography of ${recipeTitle}, described as: ${recipeDesc}, 4k, highly detailed, studio lighting, appetizing, culinary magazine style, rustic wooden table`
  const safePrompt = encodeURIComponent(prompt)
  const seed = Math.floor(Math.random() * 100000)
  const url = `https://image.pollinations.ai/prompt/${safePrompt}?width=1200&height=900&seed=${seed}`
  return url
}

export const processTextWizard = async (text: string, mode: TextMode): Promise<TextResult> => {
  let prompt = ""
  let tools: any[] | undefined
  if (mode === TextMode.REWRITE) prompt = `Lütfen aşağıdaki metni daha profesyonel, akıcı ve net bir şekilde yeniden yaz. Anlamı koru ancak dil bilgisi ve anlatımı iyileştir.\n\nMetin: ${text}`
  if (mode === TextMode.BRAINSTORM) prompt = `Aşağıdaki konuyla ilgili yaratıcı fikirler üret. Yenilikçi ve uygulanabilir 5-10 madde sırala.\n\nKonu: ${text}`
  if (mode === TextMode.RESEARCH) { prompt = `Aşağıdaki konuyu araştır ve kapsamlı bir özet sun. Güvenilir kaynaklardan bilgi topla.\n\nKonu: ${text}`; tools = [{ googleSearch: {} }] }

  const response = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt, config: { tools } })
  const chunks = (response as any).candidates?.[0]?.groundingMetadata?.groundingChunks
  const sources: { title: string; uri: string }[] = []
  if (chunks) {
    chunks.forEach((chunk: any) => { if (chunk.web) sources.push({ title: chunk.web.title, uri: chunk.web.uri }) })
  }
  return { content: (response as any).text || "Bir sonuç üretilemedi.", sources: sources.length > 0 ? sources : undefined }
}