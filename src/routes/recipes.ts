import { Router } from "express"
import { requireAuth } from "../middleware/auth"
import { z } from "zod"
import { generateRecipe, generateRecipeImage } from "../lib/ai"
import { Recipe, User } from "../models"
import { MEAL_TYPES } from "../types"
import crypto from "node:crypto"

const router = Router()
const DAILY_GEN_LIMIT = process.env.DAILY_GEN_LIMIT ? parseInt(process.env.DAILY_GEN_LIMIT) : 3

const generateSchema = z.object({ ingredients: z.string().min(1), mealTypeId: z.string().min(1), isAlternative: z.boolean().optional() })

router.post("/generate-recipe", requireAuth, async (req, res) => {
  const parsed = generateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" })
  const authUser = (req as any).user
  try {
    const user = await User.findById(authUser.id)
    if (!user) return res.status(401).json({ error: "Unauthorized" })
    const today = new Date(); today.setHours(0,0,0,0)
    const isSameDay = user.dailyGenDate && user.dailyGenDate.getTime() === today.getTime()
    if (!isSameDay) {
      user.dailyGenDate = today
      user.dailyGenCount = 0
    }
    if ((user.dailyGenCount || 0) >= DAILY_GEN_LIMIT) {
      const remaining = 0
      return res.status(429).json({ error: `Günlük öneri limitine ulaşıldı (${DAILY_GEN_LIMIT})`, remaining })
    }
    user.dailyGenCount = (user.dailyGenCount || 0) + 1
    await user.save()
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Rate limit check failed" })
  }

  if (process.env.DISABLE_AI === "true") {
    const mealType = MEAL_TYPES.find(m => m.id === parsed.data.mealTypeId)
    const typeLabel = mealType ? mealType.title : "Yemek"
    const recipe = {
      id: crypto.randomUUID(),
      title: "Pratik Tavuklu Bulgur",
      description: "Evdeki temel malzemelerle kısa sürede hazırlanan, taneli bulgur ve sotelenmiş tavukla lezzetli bir ana yemek.",
      ingredients: [
        "Tavuk göğsü (300g)",
        "Bulgur (1 su bardağı)",
        "Soğan (1 adet)",
        "Domates salçası (1 yemek kaşığı)",
        "Zeytinyağı (2 yemek kaşığı)",
        "Tuz, karabiber",
        "İsteğe bağlı: pul biber"
      ],
      steps: [
        "Soğanı küçük doğrayın, zeytinyağında 2-3 dakika soteleyin.",
        "Küçük doğranmış tavukları ekleyip rengi dönene kadar pişirin.",
        "Salçayı ekleyip kısa süre kavurun, tuz ve karabiberle tatlandırın.",
        "Bulguru ekleyin, karıştırın ve üzerini 1 parmak geçecek kadar sıcak su ekleyin.",
        "Kısık ateşte suyunu çekene kadar pişirin, 5 dakika dinlendirin ve servis edin."
      ],
      mealType: typeLabel,
      imageUrl: "https://images.unsplash.com/photo-1550547660-d9450f859349?w=1200&q=80&auto=format&fit=crop",
      createdAt: Date.now()
    }
    return res.json(recipe)
  }

  try {
    const recipe = await generateRecipe(parsed.data.ingredients, parsed.data.mealTypeId, parsed.data.isAlternative || false)
    const imageUrl = await generateRecipeImage(recipe.title, recipe.description)
    res.json({ ...recipe, imageUrl })
  } catch (e: any) {
    const msg = typeof e?.message === 'string' && e.message.length > 0 ? e.message : "Recipe generation failed"
    res.status(500).json({ error: msg })
  }
})

router.post("/save-recipe", requireAuth, async (req, res) => {
  const user = (req as any).user
  const data = req.body as { id: string; title: string; description: string; ingredients: string[]; steps: string[]; mealType: string; imageUrl?: string }
  if (!data?.id || !data.title) return res.status(400).json({ error: "Invalid recipe" })
  try {
    const existing = await Recipe.findOne({ userId: user.id, externalId: data.id })
    if (existing) {
      return res.json({ ok: true, recipeId: String(existing._id) })
    }
    try {
      const saved = await Recipe.create({ userId: user.id, externalId: data.id, title: data.title, description: data.description, ingredients: data.ingredients, steps: data.steps, mealType: data.mealType, imageUrl: data.imageUrl || undefined })
      return res.json({ ok: true, recipeId: String(saved._id) })
    } catch (e: any) {
      if (e?.code === 11000) {
        const again = await Recipe.findOne({ userId: user.id, externalId: data.id })
        return res.json({ ok: true, recipeId: String(again?._id || '') })
      }
      return res.status(500).json({ error: e?.message || "Save failed" })
    }
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Save failed" })
  }
})

router.get("/my-recipes", requireAuth, async (req, res) => {
  const user = (req as any).user
  try {
    const limitParam = req.query.limit as string | undefined
    const skipParam = req.query.skip as string | undefined
    const hasPaging = typeof limitParam !== "undefined"
    if (hasPaging) {
      const limit = Math.min(Math.max(parseInt(limitParam || "5"), 1), 50)
      const skip = Math.max(parseInt(skipParam || "0"), 0)
      const items = await Recipe.find({ userId: user.id }).sort({ createdAt: -1 }).skip(skip).limit(limit)
      const total = await Recipe.countDocuments({ userId: user.id })
      const out = items.map((i) => ({
        _id: String(i._id),
        title: i.title,
        description: i.description,
        createdAt: i.createdAt,
        imageUrl: i.imageUrl || undefined,
      }))
      const hasMore = skip + items.length < total
      return res.json({ items: out, hasMore, total })
    }
    const items = await Recipe.find({ userId: user.id }).sort({ createdAt: -1 })
    const out = items.map((i) => ({
      _id: String(i._id),
      title: i.title,
      description: i.description,
      createdAt: i.createdAt,
      imageUrl: i.imageUrl || undefined,
    }))
    res.json(out)
  } catch {
    res.status(500).json({ error: "Fetch failed" })
  }
})

router.get("/recipe/:id", requireAuth, async (req, res) => {
  const user = (req as any).user
  const id = req.params.id
  try {
    const item = await Recipe.findOne({ _id: id, userId: user.id })
    if (!item) return res.status(404).json({ error: "Not found" })
    const obj = item.toObject()
    res.json(obj)
  } catch {
    res.status(500).json({ error: "Fetch failed" })
  }
})

router.delete("/recipe/:id", requireAuth, async (req, res) => {
  const user = (req as any).user
  const id = req.params.id
  try {
    const result = await Recipe.deleteOne({ _id: id, userId: user.id })
    if (result.deletedCount === 0) return res.status(404).json({ error: "Not found" })
    res.json({ ok: true })
  } catch {
    res.status(500).json({ error: "Delete failed" })
  }
})

export default router