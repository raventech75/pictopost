import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import OpenAI from 'openai';
import { supabase } from '@/lib/supabase';

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const from = formData.get('From') as string;
    const body = formData.get('Body')?.toString().trim() || "";
    const mediaUrl = formData.get('MediaUrl0') as string;

    // 1. Vérification utilisateur dans Supabase
    const { data: user, error: userError } = await supabase
      .from('profiles')
      .select('*')
      .eq('whatsapp_number', from)
      .single();

    if (!user || userError) {
      await sendWhatsApp(from, "❌ Numéro non reconnu. Vérifiez votre profil sur Pictopost.");
      return NextResponse.json({ success: false });
    }

    // 2. Gestion de la validation "OUI"
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
        await sendWhatsApp(from, "🚀 Publication en cours...");
        // Mettre ici ton appel API Instagram réel plus tard
        await supabase.from('draft_posts').update({ status: 'published' }).eq('id', draft.id);
        await sendWhatsApp(from, "✅ Post publié avec succès !");
      } else {
        await sendWhatsApp(from, "Aucun post en attente de validation.");
      }
      return NextResponse.json({ success: true });
    }

    // 3. Traitement de l'image (Base64 pour OpenAI)
    if (mediaUrl) {
      await sendWhatsApp(from, "🤖 Analyse de l'image par l'IA...");

      // Téléchargement sécurisé de l'image via Twilio
      const responseMedia = await fetch(mediaUrl, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        },
      });
      
      const buffer = await responseMedia.arrayBuffer();
      const base64Image = Buffer.from(buffer).toString('base64');
      const contentType = responseMedia.headers.get('content-type') || 'image/jpeg';

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `Rédige un post Instagram vendeur. Style : ${user.brand_tone || 'chaleureux'}` },
              {
                type: "image_url",
                image_url: { url: `data:${contentType};base64,${base64Image}` },
              },
            ],
          },
        ],
      });

      const aiText = response.choices[0].message.content || "";

      // Sauvegarde du brouillon
      await supabase.from('draft_posts').insert([
        { user_id: user.id, image_url: mediaUrl, caption: aiText }
      ]);

      await sendWhatsApp(from, `✨ *PROPOSITION :*\n\n"${aiText}"\n\n✅ Répondez *OUI* pour publier.`);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Erreur Webhook:", err);
    return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
  }
}

async function sendWhatsApp(to: string, body: string) {
  return twilioClient.messages.create({
    from: process.env.TWILIO_PHONE_NUMBER,
    to: to,
    body: body,
  });
}