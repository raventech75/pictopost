import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import OpenAI from 'openai';
import { supabase } from '@/lib/supabase';
import { v2 as cloudinary } from 'cloudinary';

// Configuration des clients
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const from = formData.get('From') as string;
    const body = formData.get('Body')?.toString().trim() || "";
    const mediaUrl = formData.get('MediaUrl0') as string;

    // --- 1. LIAISON AUTOMATIQUE DE COMPTE ---
    if (body.startsWith("Lier mon compte")) {
      const userId = body.split(" ").pop();
      const { error } = await supabase
        .from('profiles')
        .update({ whatsapp_number: from })
        .eq('id', userId);
        
      if (error) throw error;

      await sendWhatsApp(from, "✅ Compte Pictopost lié avec succès ! Vous pouvez désormais m'envoyer vos photos directement ici pour créer vos posts.");
      return NextResponse.json({ success: true });
    }

    // --- 2. RÉCUPÉRATION DU PROFIL ---
    const { data: user, error: userError } = await supabase
      .from('profiles')
      .select('*')
      .eq('whatsapp_number', from)
      .single();

    if (userError || !user) {
      await sendWhatsApp(from, "❌ Votre numéro n'est pas reconnu. Rendez-vous sur https://pictopost.vercel.app pour lier votre WhatsApp.");
      return NextResponse.json({ success: false });
    }

    // --- 3. GESTION DU "OUI" (PUBLICATION) ---
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
        await sendWhatsApp(from, "🚀 C'est en ligne ! Votre post a été publié sur vos réseaux sociaux.");
        await supabase.from('draft_posts').update({ status: 'published' }).eq('id', draft.id);
      } else {
        await sendWhatsApp(from, "Aïe, je n'ai trouvé aucun post en attente de publication.");
      }
      return NextResponse.json({ success: true });
    }

    // --- 4. TRAITEMENT PHOTO (CLOUDINARY + IA) ---
    if (mediaUrl) {
      // Vérification crédits
      if (user.credits_remaining <= 0 && !user.is_pro) {
        await sendWhatsApp(from, "⚠️ Vous n'avez plus de crédits. Rechargez sur le site pour continuer à utiliser l'assistant.");
        return NextResponse.json({ success: false });
      }

      await sendWhatsApp(from, "🎨 Analyse et embellissement de votre image en cours...");

      // A. Téléchargement depuis Twilio (Base64)
      const responseMedia = await fetch(mediaUrl, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        },
      });
      const buffer = await responseMedia.arrayBuffer();
      const base64Image = `data:${responseMedia.headers.get('content-type')};base64,${Buffer.from(buffer).toString('base64')}`;

      // B. Retouche via Cloudinary
      const cloudinaryResponse = await cloudinary.uploader.upload(base64Image, {
        folder: 'pictopost_whatsapp',
        transformation: [
          { effect: "improve:outdoor" },
          { quality: "auto" }
        ]
      });
      
      const finalImageUrl = cloudinaryResponse.secure_url;

      // C. Rédaction IA (GPT-4o pour la vision)
      const aiResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `Rédige un post Instagram vendeur pour cette image. Commerce: ${user.business_name || 'Expert'}. Ton: ${user.brand_tone || 'Standard'}` },
              { type: "image_url", image_url: { url: base64Image } },
            ],
          },
        ],
      });

      const aiText = aiResponse.choices[0].message.content || "";

      // D. Sauvegarde Draft & Décrémentation crédits
      await supabase.from('draft_posts').insert([
        { user_id: user.id, image_url: finalImageUrl, caption: aiText }
      ]);
      await supabase.rpc('decrement_credits', { user_id: user.id });

      // E. Envoi de la proposition visuelle
      await twilioClient.messages.create({
        from: 'whatsapp:+14155238886', // Numéro Sandbox standard (à tester)
        to: from,
        body: `✨ *PROPOSITION DE POST :*\n\n"${aiText}"\n\n✅ Répondez *OUI* pour publier maintenant.`,
        mediaUrl: [finalImageUrl]
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ message: "OK" });
  } catch (error: any) {
    console.error("Erreur Webhook:", error);
    return NextResponse.json({ error: "Erreur" }, { status: 500 });
  }
}

// Fonctions utilitaires
async function sendWhatsApp(to: string, body: string) {
  return twilioClient.messages.create({
    from: 'whatsapp:+14155238886',
    to: to,
    body: body,
  });
}