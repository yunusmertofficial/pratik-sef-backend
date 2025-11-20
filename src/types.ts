export type Recipe = {
  id: string
  title: string
  description: string
  ingredients: string[]
  steps: string[]
  mealType: string
  imageUrl?: string
  createdAt: number
}

export const MEAL_TYPES = [
  { id: "breakfast", title: "Kahvaltı", description: "Güne başlangıç için hafif ve besleyici" },
  { id: "main", title: "Ana Yemek", description: "Klasik ana yemek kategorisi" },
  { id: "soup", title: "Çorba", description: "Sıcak veya soğuk çorbalar" },
  { id: "meze", title: "Meze", description: "Paylaşımlık küçük tabaklar" },
  { id: "dessert", title: "Tatlı", description: "Şekerli tatlılar" },
  { id: "salad", title: "Salata", description: "Taze ve sağlıklı" },
  { id: "pastry", title: "Hamur İşi", description: "Börek, poğaça, pide" },
  { id: "olive", title: "Zeytinyağlı", description: "Soğuk servis edilen zeytinyağlılar" },
  { id: "quick", title: "Hızlı Çözüm", description: "30 dakikanın altında hazır" }
]

export enum TextMode {
  REWRITE = "REWRITE",
  BRAINSTORM = "BRAINSTORM",
  RESEARCH = "RESEARCH"
}

export type TextResult = {
  content: string
  sources?: { title: string; uri: string }[]
}