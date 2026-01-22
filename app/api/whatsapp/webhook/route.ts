import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import OpenAI from 'openai';
import { supabase } from '@/lib/supabase';
import { v2 as cloudinary } from 'cloudinary';

// --- INITIALISATION DES CLIENTS ET CONFIGURATION ---
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export async function POST(req: NextRequest) {
  console.log("--- NOUVEL EVENEMENT WEBHOOK ---");
  
  try {
    // 1. EXTRACTION COMPLÈTE DES DONNÉES TWILIO
    const formData = await req.formData();
    const from = formData.get('From') as string;
    const body = formData.get('Body')?.toString().trim() || "";
    const mediaUrl = formData.get('MediaUrl0') as string;
    const messageSid = formData.get('MessageSid') as string;

    console.log(`Message de: ${from} | Contenu: ${body} | Media: ${mediaUrl ? 'Oui' : 'Non'}`);

    // 2. LOGIQUE DE LIAISON DE COMPTE (SESSION INVITÉ -> WHATSAPP)
    if (body.toLowerCase().startsWith("lier mon compte")) {
      const userId = body.split(" ").pop();
      console.log(`Tentative de liaison pour l'ID: ${userId}`);
      
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ whatsapp_number: from })
        .eq('id', userId);

      if (updateError) {
        console.error("Erreur lors de la liaison:", updateError);
        await sendWhatsApp(from, "❌ Désolé, je n'ai pas pu lier votre compte. Vérifiez l'ID sur le site.");
        return NextResponse.json({ success: false });
      }

      await sendWhatsApp(from, "✅ Félicitations ! Votre compte est lié. Je suis désormais votre assistant marketing personnel. Envoyez-moi une photo pour commencer !");
      return NextResponse.json({ success: true });
    }

    // 3. VÉRIFICATION DE L'UTILISATEUR DANS LA BASE
    const { data: user, error: userError } = await supabase
      .from('profiles')
      .select('*')
      .eq('whatsapp_number', from)
      .single();

    if (userError || !user) {
      console.log("Utilisateur non reconnu:", from);
      await sendWhatsApp(from, "🤖 Bonjour ! Je ne reconnais pas ce numéro. Pour m'utiliser, rendez-vous sur https://pictopost.vercel.app et cliquez sur 'Lier WhatsApp'.");
      return NextResponse.json({ success: false });
    }

    // 4. LOGIQUE D'IA INTERACTIVE (MODIFICATION DU TEXTE)
    // Si l'utilisateur envoie du texte sans image et que ce n'est pas "OUI"
    if (body && !mediaUrl && body.toUpperCase() !== 'OUI') {
      console.log("L'utilisateur demande une modification...");
      
      const { data: lastDraft } = await supabase
        .from('draft_posts')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (lastDraft) {
        await sendWhatsApp(from, "🔄 Je retravaille le post selon vos instructions...");
        
        const aiResponse = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: "Tu es un expert en réseaux sociaux. Tu as déjà rédigé ce post : " + lastDraft.caption },
            { role: "user", content: "L'utilisateur veut ces changements : " + body + ". Réécris le post en restant vendeur." }
          ]
        });

        const newCaption = aiResponse.choices[0].message.content || "";
        
        await supabase.from('draft_posts').update({ caption: newCaption }).eq('id', lastDraft.id);
        await sendWhatsApp(from, `✨ Voici la version modifiée :\n\n"${newCaption}"\n\n✅ Répondez OUI pour valider ou demandez une autre modif !`);
        return NextResponse.json({ success: true });
      }
    }

    // 5. GESTION DE LA VALIDATION (PUBLICATION)
    if (body.toUpperCase() === 'OUI') {
      const { data: draft, error: draftError } = await supabase
        .from('draft_posts')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'draft')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (draftError || !draft) {
        await sendWhatsApp(from, "❓ Je n'ai pas de post en attente. Envoyez-moi une photo d'abord !");
        return NextResponse.json({ success: false });
      }

      await sendWhatsApp(from, "🚀 Envoi sur vos réseaux sociaux en cours...");
      
      // Simuler l'appel API Instagram/Facebook ici
      await supabase.from('draft_posts').update({ status: 'published' }).eq('id', draft.id);
      
      await sendWhatsApp(from, "✅ C'est en ligne ! Votre communauté va adorer.");
      return NextResponse.json({ success: true });
    }

    // 6. TRAITEMENT DE LA PHOTO (RETREIVE -> CLOUDINARY LOGO -> OPENAI)
    if (mediaUrl) {
      // A. Vérification des crédits
      if (user.credits_remaining <= 0 && !user.is_pro) {
        await sendWhatsApp(from, "⚠️ Vous avez épuisé vos crédits gratuits. Pour continuer à briller sur les réseaux, passez à l'offre Pro sur le site !");
        return NextResponse.json({ success: false });
      }

      await sendWhatsApp(from, "🎨 Je prépare votre post (retouche + logo)...");

      // B. Téléchargement sécurisé de l'image Twilio
      const responseMedia = await fetch(mediaUrl, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        },
      });
      const buffer = await responseMedia.arrayBuffer();
      const base64Image = `data:${responseMedia.headers.get('content-type')};base64,${Buffer.from(buffer).toString('base64')}`;

      // C. Configuration de la retouche Cloudinary avec Logo
      const transformations: any[] = [
        { effect: "improve:outdoor" },
        { quality: "auto" }
      ];

      // INCUSTATION DU LOGO SI PRÉSENT
      if (user.logo_url) {
        // On récupère l'ID public du logo dans Cloudinary
        const logoPublicId = user.logo_url.split('/').pop()?.split('.')[0];
        if (logoPublicId) {
          transformations.push({ 
            overlay: logoPublicId, 
            gravity: "south_east", 
            width: 150, 
            x: 25, 
            y: 25,
            opacity: 90 
          });
        }
      }

      const cloudinaryRes = await cloudinary.uploader.upload(base64Image, {
        folder: 'pictopost_final',
        transformation: transformations
      });

      // D. Analyse Vision et Rédaction par l'IA
      const visionRes = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `Rédige un post Instagram très vendeur pour ce commerce : ${user.business_name || 'mon client'}. Ville : ${user.business_city || ''}. Ton : ${user.brand_tone || 'Pro'}.` },
              { type: "image_url", image_url: { url: base64Image } } // On analyse l'originale pour plus de détails
            ],
          },
        ],
      });

      const caption = visionRes.choices[0].message.content || "";

      // E. Sauvegarde et Décrémentation
      await supabase.from('draft_posts').insert([{
        user_id: user.id,
        image_url: cloudinaryRes.secure_url,
        caption: caption,
        status: 'draft'
      }]);

      await supabase.rpc('decrement_credits', { user_id: user.id });

      // F. Réponse finale avec l'image retouchée
      await twilioClient.messages.create({
        from: 'whatsapp:+14155238886', // Numéro Sandbox
        to: from,
        body: `✨ *PROPOSITION :*\n\n"${caption}"\n\n✅ Répondez *OUI* pour publier ou dites-moi ce qu'il faut changer !`,
        mediaUrl: [cloudinaryRes.secure_url]
      });

      console.log("Post généré et envoyé avec succès.");
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("ERREUR CRITIQUE WEBHOOK:", error);
    // Optionnel : Envoyer un message d'erreur à l'utilisateur
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// FONCTION UTILITAIRE D'ENVOI
async function sendWhatsApp(to: string, body: string) {
  try {
    return await twilioClient.messages.create({
      from: 'whatsapp:+14155238886',
      to: to,
      body: body,
    });
  } catch (e) {
    console.error("Erreur envoi WhatsApp:", e);
  }
}