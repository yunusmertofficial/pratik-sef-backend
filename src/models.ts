import mongoose, { Schema, model } from "mongoose"

const UserSchema = new Schema({
  googleId: { type: String, unique: true },
  email: { type: String, required: true, unique: true },
  name: { type: String },
  avatar: { type: String },
  loginCode: { type: String },
  loginCodeExpires: { type: Date },
  deleteCode: { type: String },
  deleteCodeExpires: { type: Date },
  dailyGenCount: { type: Number, default: 0 },
  dailyGenDate: { type: Date },
  createdAt: { type: Date, default: Date.now }
})

const RecipeSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  externalId: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  ingredients: [{ type: String }],
  steps: [{ type: String }],
  mealType: { type: String, required: true },
  imageUrl: { type: String },
  createdAt: { type: Date, default: Date.now }
})

export const User = model("User", UserSchema)
export const Recipe = model("Recipe", RecipeSchema)