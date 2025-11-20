import "dotenv/config"
import express from "express"
import cors from "cors"
import auth from "./routes/auth"
import recipes from "./routes/recipes"
import { connectMongo } from "./db"

const app = express()
app.use(cors())
app.use(express.json({ limit: "2mb" }))

app.get("/api/health", (_req, res) => res.json({ ok: true }))
app.use("/api/auth", auth)
app.use("/api", recipes)

const port = process.env.PORT ? parseInt(process.env.PORT) : 4000
app.listen(port, () => {})
connectMongo().catch((e) => { console.error("MongoDB connection failed:", e?.message || e) })