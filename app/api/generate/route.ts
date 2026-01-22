import { OpenAI } from "openai";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: Request) {
  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const body = await req.json();
    const { imageBase64, city, tone, businessName, userId } = body;

    if (!imageBase64) {
      return NextResponse.json({ error: "Aucune image fournie" }, { status: 400 });
    }

    // --- SÉCURITÉ CRÉDITS (SAAS) ---
    if (userId) {
        const { data: user } = await supabase.from('profiles').select('credits_remaining').eq('id', userId).single();
        if (!user || user.credits_remaining <= 0) {
            return NextResponse.json({ error: "Plus de crédits disponibles." }, { status: 403 });
        }
    }

    const contextCity = city ? `Ville : ${city}` : "";
    const contextName = businessName ? `Nom du Commerce : ${businessName}` : "Nom générique (ex: Votre expert)";
    const contextTone = tone ? `Ton : ${tone}` : "Ton : Standard";

    // --- TON PROMPT EXPERT AUGMENTÉ ---
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

      RÈGLES GOOGLE BUSINESS (NOUVEAU) :
      - Très informatif, focus sur la ville ${city}. Utilise des mots clés pour le SEO local.

      JSON ATTENDU :
      {
        "tiktok": { "hook": "...", "caption": "...", "hashtags": "..." },
        "instagram": { "title": "...", "caption": "...", "hashtags": "..." },
        "facebook": { "title": "...", "caption": "..." },
        "google": { "caption": "..." }
      }
    `;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: "Génère les contenus." },
            { type: "image_url", image_url: { url: imageBase64 } },
          ],
        },
      ],
      temperature: 0.8,
    });

    const content = response.choices[0].message.content;
    const jsonContent = JSON.parse(content || "{}");

    // --- DÉCRÉMENTATION & HISTORIQUE (SAAS) ---
    if (userId) {
        // Décompte
        await supabase.rpc('decrement_credits', { user_id: userId });
        // Sauvegarde historique
        await supabase.from('draft_posts').insert([{ 
            user_id: userId, 
            image_url: imageBase64, 
            caption: jsonContent.instagram.caption,
            status: 'draft' 
        }]);
    }

    return NextResponse.json(jsonContent);

  } catch (error: any) {
    console.error("Erreur API:", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}