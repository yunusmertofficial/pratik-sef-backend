import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { z } from "zod";
import { generateRecipe, generateRecipeImage } from "../lib/ai";
import { Recipe, User } from "../models";
import { MEAL_TYPES } from "../types";
import crypto from "node:crypto";

const router = Router();
const DAILY_GEN_LIMIT = process.env.DAILY_GEN_LIMIT
  ? parseInt(process.env.DAILY_GEN_LIMIT)
  : 3;

// Geçici cache: Yeni oluşturulan tarifleri tutmak için (payload sorunlarını önlemek için)
interface CachedRecipe {
  data: any;
  userId: string;
  expiresAt: number;
}
const recipeCache = new Map<string, CachedRecipe>();

// Cache temizleme: 1 saat sonra otomatik sil
setInterval(() => {
  const now = Date.now();
  for (const [id, cached] of recipeCache.entries()) {
    if (cached.expiresAt < now) {
      recipeCache.delete(id);
    }
  }
}, 60000); // Her 1 dakikada bir kontrol et

const generateSchema = z.object({
  ingredients: z.string().min(1),
  mealTypeId: z.string().min(1),
  isAlternative: z.boolean().optional(),
});

router.post("/generate-recipe", requireAuth, async (req, res) => {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
  const authUser = (req as any).user;
  try {
    const user = await User.findById(authUser.id);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isSameDay =
      user.dailyGenDate && user.dailyGenDate.getTime() === today.getTime();
    if (!isSameDay) {
      user.dailyGenDate = today;
      user.dailyGenCount = 0;
    }
    if ((user.dailyGenCount || 0) >= DAILY_GEN_LIMIT) {
      const remaining = 0;
      return res.status(429).json({
        error: `Günlük öneri limitine ulaşıldı (${DAILY_GEN_LIMIT})`,
        remaining,
      });
    }
    user.dailyGenCount = (user.dailyGenCount || 0) + 1;
    await user.save();
  } catch (e: any) {
    return res
      .status(500)
      .json({ error: e?.message || "Rate limit check failed" });
  }

  if (process.env.DISABLE_AI === "true") {
    const mealType = MEAL_TYPES.find((m) => m.id === parsed.data.mealTypeId);
    const typeLabel = mealType ? mealType.title : "Yemek";
    const recipe = {
      id: crypto.randomUUID(),
      title: "Pratik Tavuklu Bulgur",
      description:
        "Evdeki temel malzemelerle kısa sürede hazırlanan, taneli bulgur ve sotelenmiş tavukla lezzetli bir ana yemek.",
      ingredients: [
        "Tavuk göğsü (300g)",
        "Bulgur (1 su bardağı)",
        "Soğan (1 adet)",
        "Domates salçası (1 yemek kaşığı)",
        "Zeytinyağı (2 yemek kaşığı)",
        "Tuz, karabiber",
        "İsteğe bağlı: pul biber",
      ],
      steps: [
        "Soğanı küçük doğrayın, zeytinyağında 2-3 dakika soteleyin.",
        "Küçük doğranmış tavukları ekleyip rengi dönene kadar pişirin.",
        "Salçayı ekleyip kısa süre kavurun, tuz ve karabiberle tatlandırın.",
        "Bulguru ekleyin, karıştırın ve üzerini 1 parmak geçecek kadar sıcak su ekleyin.",
        "Kısık ateşte suyunu çekene kadar pişirin, 5 dakika dinlendirin ve servis edin.",
      ],
      mealType: typeLabel,
      imageUrl:
        "https://images.unsplash.com/photo-1550547660-d9450f859349?w=1200&q=80&auto=format&fit=crop",
      createdAt: Date.now(),
    };
    return res.json(recipe);
  }

  try {
    const recipe = await generateRecipe(
      parsed.data.ingredients,
      parsed.data.mealTypeId,
      parsed.data.isAlternative || false
    );

    // Resim oluşturmayı dene, hata verirse bile tarifi döndür
    let imageUrl: string | undefined;
    try {
      imageUrl = await generateRecipeImage(recipe.title, recipe.description);
      console.log(
        "✅ [SERVER] Resim URL oluşturuldu:",
        imageUrl?.substring(0, 100)
      );
    } catch (imgError: any) {
      console.error(
        "❌ [SERVER] Resim oluşturma hatası:",
        imgError?.message || imgError
      );
      // Hata durumunda basit bir fallback URL oluştur
      const fallbackTitle = recipe.title
        .replace(/[^\w\s-]/g, "")
        .trim()
        .substring(0, 20);
      const fallbackPrompt = encodeURIComponent(
        `delicious ${fallbackTitle} food`
      );
      const seed = Math.floor(Math.random() * 100000);
      imageUrl = `https://image.pollinations.ai/prompt/${fallbackPrompt}?width=1200&height=900&seed=${seed}&enhance=true`;
      console.log(
        "🔄 [SERVER] Fallback URL oluşturuldu:",
        imageUrl.substring(0, 100)
      );
    }

    // imageUrl her zaman olmalı
    if (!imageUrl) {
      console.warn(
        "⚠️ [SERVER] imageUrl hala undefined, basit URL oluşturuluyor"
      );
      const simplePrompt = encodeURIComponent("delicious food photography");
      const seed = Math.floor(Math.random() * 100000);
      imageUrl = `https://image.pollinations.ai/prompt/${simplePrompt}?width=1200&height=900&seed=${seed}&enhance=true`;
    }

    console.log("📤 [SERVER] Tarif gönderiliyor, imageUrl var mı:", !!imageUrl);
    const recipeData = { ...recipe, imageUrl };

    // Cache'e kaydet (1 saat geçerli)
    const authUser = (req as any).user;
    recipeCache.set(recipe.id, {
      data: recipeData,
      userId: authUser.id,
      expiresAt: Date.now() + 60 * 60 * 1000, // 1 saat
    });

    res.json(recipeData);
  } catch (e: any) {
    const msg =
      typeof e?.message === "string" && e.message.length > 0
        ? e.message
        : "Recipe generation failed";
    res.status(500).json({ error: msg });
  }
});

router.post("/save-recipe", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const data = req.body as {
    id?: string;
    title: string;
    description: string;
    ingredients: string[];
    steps: string[];
    mealType: string;
    imageUrl?: string;
  };

  // Title zorunlu
  if (!data?.title) {
    return res.status(400).json({ error: "Invalid recipe: title is required" });
  }

  // Description, ingredients, steps, mealType kontrolü
  if (
    !data.description ||
    !Array.isArray(data.ingredients) ||
    !Array.isArray(data.steps) ||
    !data.mealType
  ) {
    return res
      .status(400)
      .json({ error: "Invalid recipe: missing required fields" });
  }

  // ID yoksa otomatik oluştur
  const externalId = data.id || crypto.randomUUID();

  try {
    const existing = await Recipe.findOne({ userId: user.id, externalId });
    if (existing) {
      return res.json({ ok: true, recipeId: String(existing._id) });
    }
    try {
      const saved = await Recipe.create({
        userId: user.id,
        externalId,
        title: data.title,
        description: data.description,
        ingredients: data.ingredients,
        steps: data.steps,
        mealType: data.mealType,
        imageUrl: data.imageUrl || undefined,
      });
      return res.json({ ok: true, recipeId: String(saved._id) });
    } catch (e: any) {
      if (e?.code === 11000) {
        const again = await Recipe.findOne({ userId: user.id, externalId });
        return res.json({ ok: true, recipeId: String(again?._id || "") });
      }
      return res.status(500).json({ error: e?.message || "Save failed" });
    }
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Save failed" });
  }
});

router.get("/my-recipes", requireAuth, async (req, res) => {
  const user = (req as any).user;
  try {
    const limitParam = req.query.limit as string | undefined;
    const skipParam = req.query.skip as string | undefined;
    const hasPaging = typeof limitParam !== "undefined";
    if (hasPaging) {
      const limit = Math.min(Math.max(parseInt(limitParam || "5"), 1), 50);
      const skip = Math.max(parseInt(skipParam || "0"), 0);
      const items = await Recipe.find({ userId: user.id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);
      const total = await Recipe.countDocuments({ userId: user.id });
      const out = items.map((i) => ({
        _id: String(i._id),
        title: i.title,
        description: i.description,
        createdAt: i.createdAt,
        imageUrl: i.imageUrl || undefined,
      }));
      const hasMore = skip + items.length < total;
      return res.json({ items: out, hasMore, total });
    }
    const items = await Recipe.find({ userId: user.id }).sort({
      createdAt: -1,
    });
    const out = items.map((i) => ({
      _id: String(i._id),
      title: i.title,
      description: i.description,
      createdAt: i.createdAt,
      imageUrl: i.imageUrl || undefined,
    }));
    res.json(out);
  } catch {
    res.status(500).json({ error: "Fetch failed" });
  }
});

router.get("/recipe/:id", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const id = req.params.id;
  try {
    // Önce cache'de kontrol et (yeni oluşturulan tarifler için)
    const cached = recipeCache.get(id);
    if (cached && cached.userId === user.id && cached.expiresAt > Date.now()) {
      console.log("✅ [SERVER] Tarif cache'den döndürüldü:", id);
      return res.json(cached.data);
    }

    // Cache'de yoksa veritabanından çek
    const item = await Recipe.findOne({ _id: id, userId: user.id });
    if (!item) {
      // Veritabanında da yoksa, externalId ile dene
      const byExternalId = await Recipe.findOne({
        externalId: id,
        userId: user.id,
      });
      if (byExternalId) {
        const obj = byExternalId.toObject();
        return res.json(obj);
      }
      return res.status(404).json({ error: "Not found" });
    }
    const obj = item.toObject();
    res.json(obj);
  } catch {
    res.status(500).json({ error: "Fetch failed" });
  }
});

router.delete("/recipe/:id", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const id = req.params.id;
  try {
    const result = await Recipe.deleteOne({ _id: id, userId: user.id });
    if (result.deletedCount === 0)
      return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Delete failed" });
  }
});

export default router;
