import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import OpenAI from 'openai';
import { supabase } from '@/lib/supabase'; // Importe ton client Supabase

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const from = formData.get('From') as string; 
    const body = formData.get('Body')?.toString().trim() || "";
    const mediaUrl = formData.get('MediaUrl0') as string;

    // 1. Chercher l'utilisateur par son numéro WhatsApp
    const { data: user, error: userError } = await supabase
      .from('profiles')
      .select('*')
      .eq('whatsapp_number', from)
      .single();

    if (!user || userError) {
      await sendWhatsApp(from, "❌ Numéro non reconnu. Pour tester, ajoutez manuellement votre numéro dans la table 'profiles' sur Supabase.");
      return NextResponse.json({ success: false });
    }

    // 2. Si l'utilisateur répond "OUI"
    if (body.toUpperCase() === 'OUI') {
      const { data: draft } = await supabase
        .from('draft_posts')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (draft) {
        await sendWhatsApp(from, "🚀 Publication en cours sur vos réseaux...");
        // Ici tu appelles ta fonction de publication réelle
        await supabase.from('draft_posts').update({ status: 'published' }).eq('id', draft.id);
        await sendWhatsApp(from, "✅ C'est en ligne !");
      } else {
        await sendWhatsApp(from, "Aïe, je n'ai trouvé aucun post en attente.");
      }
      return NextResponse.json({ success: true });
    }

    // 3. Si l'utilisateur envoie une photo
    if (mediaUrl) {
      await sendWhatsApp(from, "🤖 Analyse de l'image en cours...");

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `Rédige un post Instagram vendeur. Ton à utiliser : ${user.brand_tone}` },
              { type: "image_url", image_url: { url: mediaUrl } },
            ],
          },
        ],
      });

      const aiText = response.choices[0].message.content || "";

      // SAUVEGARDE DANS SUPABASE
      await supabase.from('draft_posts').insert([
        { user_id: user.id, image_url: mediaUrl, caption: aiText }
      ]);

      await sendWhatsApp(from, `✨ *PROPOSITION :*\n\n"${aiText}"\n\n✅ Répondez *OUI* pour publier.`);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ message: "OK" });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Erreur" }, { status: 500 });
  }
}

async function sendWhatsApp(to: string, body: string) {
  return twilioClient.messages.create({
    from: process.env.TWILIO_PHONE_NUMBER,
    to: to,
    body: body,
  });
}