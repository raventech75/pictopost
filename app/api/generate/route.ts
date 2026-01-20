import { OpenAI } from "openai";
import { NextResponse } from "next/server";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { imageBase64, city, tone, businessName } = body; // Ajout de businessName

    if (!imageBase64) {
      return NextResponse.json({ error: "Aucune image fournie" }, { status: 400 });
    }

    // Contexte enrichi
    const contextCity = city ? `Ville : ${city}` : "";
    const contextName = businessName ? `Nom du Commerce : ${businessName}` : "Nom générique (ex: Votre expert)";
    const contextTone = tone ? `Ton : ${tone}` : "Ton : Standard";

    const systemPrompt = `
      Tu es le meilleur Community Manager de France.
      CONTEXTE : ${contextName}. ${contextCity}. ${contextTone}.

      RÈGLES TIKTOK (CRUCIAL) :
      - Ne sois PAS trop court. Utilise la structure "Liste à puces" pour donner de la valeur.
      - Structure :
        1. Une phrase d'accroche (Hook).
        2. Une ligne vide.
        3. 3 avantages ou détails du produit avec des emojis (ex: "✅ Fait maison", "🚀 Service rapide").
        4. Une question de fin.
      
      RÈGLES INSTAGRAM :
      - Storytelling immersif. Parle des sens (odeur, vue, goût).
      - Utilise des sauts de ligne pour aérer.
      
      RÈGLES FACEBOOK :
      - Ton "Quartier / Communauté". Rassurant et informatif.
      - Mets en avant l'humain derrière le commerce.

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
      temperature: 0.8, // Un peu plus créatif pour éviter les répétitions si on régénère
    });

    const content = response.choices[0].message.content;
    const jsonContent = JSON.parse(content || "{}");
    return NextResponse.json(jsonContent);

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}