import { OpenAI } from "openai";
import { NextResponse } from "next/server";

// ON ENLÈVE LA DÉCLARATION GLOBALE ICI (C'est elle qui faisait planter le build)

export async function POST(req: Request) {
  try {
    // ON LA DÉPLACE ICI (À l'intérieur de la fonction)
    // Comme ça, Vercel ne vérifiera la clé que quand quelqu'un utilise l'app.
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const body = await req.json();
    const { imageBase64, city, tone, businessName } = body;

    if (!imageBase64) {
      return NextResponse.json({ error: "Aucune image fournie" }, { status: 400 });
    }

    const contextCity = city ? `Ville : ${city}` : "";
    const contextName = businessName ? `Nom du Commerce : ${businessName}` : "Nom générique (ex: Votre expert)";
    const contextTone = tone ? `Ton : ${tone}` : "Ton : Standard";

    const systemPrompt = `
      Tu es le meilleur Community Manager de France.
      CONTEXTE : ${contextName}. ${contextCity}. ${contextTone}.

      RÈGLES TIKTOK (CRUCIAL) :
      - Ne sois PAS trop court. Utilise la structure "Liste à puces".
      - Structure : Hook + Ligne vide + 3 avantages (emojis) + Question de fin.
      
      RÈGLES INSTAGRAM :
      - Storytelling immersif. Sauts de ligne.
      
      RÈGLES FACEBOOK :
      - Ton "Quartier / Communauté". Rassurant.

      JSON ATTENDU :
      {
        "tiktok": { "hook": "...", "caption": "...", "hashtags": "..." },
        "instagram": { "title": "...", "caption": "...", "hashtags": "..." },
        "facebook": { "title": "...", "caption": "..." }
      }
    `;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: "Génère les posts." },
            { type: "image_url", image_url: { url: imageBase64 } },
          ],
        },
      ],
      temperature: 0.8,
    });

    const content = response.choices[0].message.content;
    const jsonContent = JSON.parse(content || "{}");

    return NextResponse.json(jsonContent);

  } catch (error) {
    console.error("Erreur API:", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}