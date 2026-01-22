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

    // 1. Vérification utilisateur
    const { data: user } = await supabase.from('profiles').select('*').eq('whatsapp_number', from).single();
    if (!user) {
      await sendWhatsApp(from, "❌ Numéro non reconnu sur Pictopost.");
      return NextResponse.json({ success: false });
    }

    // 2. Gestion de la validation "OUI" (PUBLICATION)
    if (body.toUpperCase() === 'OUI') {
      // On récupère le dernier brouillon en attente
      const { data: draft } = await supabase
        .from('draft_posts')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (draft) {
        await sendWhatsApp(from, "🚀 Je publie l'image retouchée et le texte sur vos réseaux...");
        
        // --- ZONE DE PUBLICATION ---
        // C'est ICI que tu mettras ton appel à l'API Instagram/Facebook plus tard.
        // Tu as accès à : draft.image_url (l'URL Cloudinary propre) et draft.caption (le texte)
        console.log("PUBLIER CECI :", draft.image_url, draft.caption);
        // ---------------------------

        // On marque comme publié dans la DB
        await supabase.from('draft_posts').update({ status: 'published' }).eq('id', draft.id);
        await sendWhatsApp(from, "✅ C'est en ligne ! Retrouvez votre post sur votre fil.");
      } else {
        await sendWhatsApp(from, "Aucun post en attente.");
      }
      return NextResponse.json({ success: true });
    }

    // 3. Traitement de l'image (NETTOYAGE + RÉDACTION)
    if (mediaUrl) {
      await sendWhatsApp(from, "🎨 J'ai reçu l'image ! Je la nettoie, je l'embellis et je rédige le texte. Un instant...");

      // A. Téléchargement depuis Twilio
      const responseMedia = await fetch(mediaUrl, {
        headers: { Authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}` },
      });
      const buffer = await responseMedia.arrayBuffer();
      const base64Image = `data:${responseMedia.headers.get('content-type')};base64,${Buffer.from(buffer).toString('base64')}`;

      // B. MAGIE CLOUDINARY : Nettoyage et upload
      // On applique une amélioration auto et une suppression de fond si besoin
      const cloudinaryResponse = await cloudinary.uploader.upload(base64Image, {
        folder: 'pictopost_uploads',
        // Tu peux ajouter 'e_background_removal' si tu veux détourer l'objet
        transformation: [{ effect: "improve:outdoor" }, { quality: "auto" }, { fetch_format: "auto" }]
      });
      
      const finalImageUrl = cloudinaryResponse.secure_url; // L'URL permanente et propre

      // C. Rédaction IA avec l'image propre (Optionnel : on peut envoyer l'originale à GPT si on préfère)
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `Rédige un post Instagram vendeur pour cette image. Ton : ${user.brand_tone || 'chaleureux'}. Utilise des emojis.` },
              { type: "image_url", image_url: { url: base64Image } }, // On montre l'originale à GPT pour qu'il comprenne le contexte
            ],
          },
        ],
      });

      const aiText = response.choices[0].message.content || "";

      // D. Sauvegarde dans Supabase (Image propre + Texte)
      await supabase.from('draft_posts').insert([
        { user_id: user.id, image_url: finalImageUrl, caption: aiText }
      ]);

      // E. Envoi de la proposition (On renvoie l'image propre pour validation)
      await sendMediaWhatsApp(from, finalImageUrl, `✨ *PROPOSITION :*\n\n"${aiText}"\n\n✅ Répondez *OUI* pour publier cette image et ce texte.`);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Erreur Webhook:", err);
    return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
  }
}

// Fonction utilitaire pour envoyer des messages texte
async function sendWhatsApp(to: string, body: string) {
  // NOTE : Remets process.env.TWILIO_PHONE_NUMBER une fois tes variables Vercel corrigées.
  return twilioClient.messages.create({ from: 'whatsapp:+14155238886', to, body });
}

// NOUVELLE fonction utilitaire pour envoyer une IMAGE sur WhatsApp
async function sendMediaWhatsApp(to: string, mediaUrl: string, body: string) {
  // NOTE : Remets process.env.TWILIO_PHONE_NUMBER une fois tes variables Vercel corrigées.
  return twilioClient.messages.create({
    from: 'whatsapp:+14155238886',
    to: to,
    body: body,
    mediaUrl: [mediaUrl] // C'est ça qui affiche l'image dans WhatsApp
  });
}