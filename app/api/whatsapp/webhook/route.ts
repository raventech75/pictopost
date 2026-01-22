import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import OpenAI from 'openai';
import { supabase } from '@/lib/supabase';
import { v2 as cloudinary } from 'cloudinary';

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const from = formData.get('From') as string;
    const body = formData.get('Body')?.toString().trim() || "";
    const mediaUrl = formData.get('MediaUrl0') as string;

    // --- 1. LIAISON AUTOMATIQUE ---
    if (body.startsWith("Lier mon compte")) {
      const userId = body.split(" ").pop();
      await supabase.from('profiles').update({ whatsapp_number: from }).eq('id', userId);
      await sendWhatsApp(from, "✅ Compte Pictopost lié ! Vous pouvez m'envoyer une photo pour votre prochain post.");
      return NextResponse.json({ success: true });
    }

    // --- 2. RÉCUPÉRATION UTILISATEUR ---
    const { data: user } = await supabase.from('profiles').select('*').eq('whatsapp_number', from).single();
    if (!user) {
      await sendWhatsApp(from, "❌ Je ne reconnais pas ce numéro. Liez votre compte sur le site.");
      return NextResponse.json({ success: false });
    }

    // --- 3. GESTION DU "OUI" (PUBLICATION) ---
    if (body.toUpperCase() === 'OUI') {
      const { data: draft } = await supabase.from('draft_posts').select('*').eq('user_id', user.id).eq('status', 'pending').order('created_at', { ascending: false }).limit(1).single();
      if (draft) {
        await sendWhatsApp(from, "🚀 Publication en cours...");
        await supabase.from('draft_posts').update({ status: 'published' }).eq('id', draft.id);
        await sendWhatsApp(from, "✅ C'est en ligne !");
      }
      return NextResponse.json({ success: true });
    }

    // --- 4. TRAITEMENT PHOTO (CRÉDITS + CLOUDINARY + IA) ---
    if (mediaUrl) {
      if (user.credits_remaining <= 0) {
        await sendWhatsApp(from, "⚠️ Crédits épuisés. Rendez-vous sur Pictopost pour en rajouter.");
        return NextResponse.json({ success: false });
      }

      await sendWhatsApp(from, "🎨 Retouche de l'image en cours...");

      // Download Twilio Image -> Base64
      const responseMedia = await fetch(mediaUrl, {
        headers: { Authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}` },
      });
      const buffer = await responseMedia.arrayBuffer();
      const b64 = `data:${responseMedia.headers.get('content-type')};base64,${Buffer.from(buffer).toString('base64')}`;

      // Cloudinary Clean-up
      const cloudRes = await cloudinary.uploader.upload(b64, {
        folder: 'whatsapp_uploads',
        transformation: [{ effect: "improve:outdoor" }, { quality: "auto" }]
      });

      // OpenAI Caption (On utilise GPT-4o ici car c'est plus précis pour l'image)
      const ai = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: [{ type: "text", text: `Rédige un post Instagram vendeur pour cette image. Ton : ${user.brand_tone || 'Standard'}` }, { type: "image_url", image_url: { url: b64 } }] }]
      });

      const caption = ai.choices[0].message.content || "";

      // Save Draft & Décrémenter crédit
      await supabase.from('draft_posts').insert([{ user_id: user.id, image_url: cloudRes.secure_url, caption }]);
      await supabase.from('profiles').update({ credits_remaining: user.credits_remaining - 1 }).eq('id', user.id);

      // Reply with Image
      await twilioClient.messages.create({
        from: 'whatsapp:+14155238886', // NUMÉRO DUR COMME DEMANDÉ
        to: from,
        body: `✨ PROPOSITION :\n\n"${caption}"\n\n✅ Répondez OUI pour publier.`,
        mediaUrl: [cloudRes.secure_url]
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}

async function sendWhatsApp(to: string, body: string) {
  return twilioClient.messages.create({ from: 'whatsapp:+14155238886', to, body });
}