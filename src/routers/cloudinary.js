import express from "express";
import cloudinary from "../utils/cloudinary.js";

const router = express.Router();

router.get("/themes", async (req, res) => {
  try {
    const result = await cloudinary.api.sub_folders("themes");
    res.json(result.folders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 📌 Получаем фильмы внутри темы
router.get("/themes/:theme", async (req, res) => {
  const { theme } = req.params;
  try {
    const result = await cloudinary.api.sub_folders(`themes/${theme}`);
    res.json(result.folders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 📌 Получаем кадры из фильма
router.get("/themes/:theme/:film", async (req, res) => {
  const { theme, film } = req.params;
  try {
    const result = await cloudinary.api.resources({
      type: "upload",
      prefix: `themes/${theme}/${film}`,
    });
    res.json(result.resources.map((file) => file.secure_url));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
