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
    const formData = await req.formData();
    const from = formData.get('From') as string;
    const body = formData.get('Body')?.toString().trim() || "";
    const mediaUrl = formData.get('MediaUrl0') as string;

    console.log(`Message de: ${from} | Contenu: ${body} | Media: ${mediaUrl ? 'Oui' : 'Non'}`);

    // =================================================================================
    // 1. LIAISON DE COMPTE (DÉCLENCHE L'ONBOARDING)
    // =================================================================================
    if (body.toLowerCase().startsWith("lier mon compte")) {
      const userId = body.split(" ").pop();
      
      // On lie le numéro ET on met le statut d'onboarding à 'ask_name' pour forcer les questions
      const { data: updatedUser, error: updateError } = await supabase
        .from('profiles')
        .update({ 
          whatsapp_number: from,
          onboarding_step: 'ask_name' // <--- DÉBUT DU QUESTIONNAIRE
        })
        .eq('id', userId)
        .select()
        .single();

      if (updateError) {
        await sendWhatsApp(from, "❌ Erreur de liaison. Vérifiez l'ID.");
        return NextResponse.json({ success: false });
      }

      await sendWhatsApp(from, `👋 Bienvenue chez Pictopost !\n\nAvant de commencer, j'ai besoin de mieux vous connaître pour rédiger des posts parfaits.\n\n1️⃣ Quel est le **Nom de votre commerce** ?`);
      return NextResponse.json({ success: true });
    }

    // =================================================================================
    // 2. RÉCUPÉRATION DU PROFIL
    // =================================================================================
    const { data: user, error: userError } = await supabase
      .from('profiles')
      .select('*')
      .eq('whatsapp_number', from)
      .single();

    if (userError || !user) {
      await sendWhatsApp(from, "🤖 Bonjour ! Numéro inconnu. Liez votre compte sur le site d'abord.");
      return NextResponse.json({ success: false });
    }

    // =================================================================================
    // 3. LOGIQUE D'ONBOARDING (QUESTIONS / RÉPONSES)
    // =================================================================================
    if (user.onboarding_step && user.onboarding_step !== 'completed' && !mediaUrl) {
      
      // ÉTAPE 1 : ON ATTEND LE NOM
      if (user.onboarding_step === 'ask_name') {
        await supabase.from('profiles').update({ 
          business_name: body, 
          onboarding_step: 'ask_activity' 
        }).eq('id', user.id);
        
        await sendWhatsApp(from, `✅ Noté "${body}".\n\n2️⃣ Quelle est votre **Activité précise** ?\n(ex: Photographe de mariage, Boulangerie bio, Garage auto...)`);
        return NextResponse.json({ success: true });
      }

      // ÉTAPE 2 : ON ATTEND L'ACTIVITÉ (CRUCIAL POUR TON EXEMPLE DU MARIÉ)
      if (user.onboarding_step === 'ask_activity') {
        await supabase.from('profiles').update({ 
          business_activity: body, 
          onboarding_step: 'ask_city' 
        }).eq('id', user.id);
        
        await sendWhatsApp(from, `✅ C'est noté.\n\n3️⃣ Dans quelle **Ville** êtes-vous situé ?`);
        return NextResponse.json({ success: true });
      }

      // ÉTAPE 3 : ON ATTEND LA VILLE
      if (user.onboarding_step === 'ask_city') {
        await supabase.from('profiles').update({ 
          business_city: body, 
          onboarding_step: 'completed' // <--- FIN DU QUESTIONNAIRE
        }).eq('id', user.id);
        
        await sendWhatsApp(from, `🎉 Configuration terminée !\n\nJe suis prêt. Envoyez-moi une photo (ex: un marié, un produit...) et je rédigerai le post parfait pour un **${user.business_activity}**.`);
        return NextResponse.json({ success: true });
      }
    }

    // =================================================================================
    // 4. LOGIQUE D'IA INTERACTIVE (MODIFICATION DU TEXTE)
    // =================================================================================
    if (body && !mediaUrl && body.toUpperCase() !== 'OUI') {
      const { data: lastDraft } = await supabase
        .from('draft_posts')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (lastDraft) {
        await sendWhatsApp(from, "🔄 Je modifie selon vos retours...");
        const aiResponse = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: `Tu es CM pour ${user.business_name} (${user.business_activity}). Post précédent : ${lastDraft.caption}` },
            { role: "user", content: "Modif demandée : " + body }
          ]
        });

        const newCaption = aiResponse.choices[0].message.content || "";
        await supabase.from('draft_posts').update({ caption: newCaption }).eq('id', lastDraft.id);
        await sendWhatsApp(from, `✨ Version modifiée :\n\n"${newCaption}"\n\n✅ Répondez OUI pour valider.`);
        return NextResponse.json({ success: true });
      }
    }

    // =================================================================================
    // 5. VALIDATION (PUBLICATION)
    // =================================================================================
    if (body.toUpperCase() === 'OUI') {
      const { data: draft } = await supabase.from('draft_posts').select('*').eq('user_id', user.id).eq('status', 'draft').order('created_at', { ascending: false }).limit(1).single();

      if (draft) {
        await sendWhatsApp(from, "🚀 Publication en cours...");
        await supabase.from('draft_posts').update({ status: 'published' }).eq('id', draft.id);
        await sendWhatsApp(from, `✅ C'est en ligne ! (Solde : ${user.credits_remaining})`);
      }
      return NextResponse.json({ success: true });
    }

    // =================================================================================
    // 6. TRAITEMENT DE LA PHOTO (AVEC LE NOUVEAU CONTEXTE MÉTIER)
    // =================================================================================
    if (mediaUrl) {
      if (user.credits_remaining <= 0 && !user.is_pro) {
        await sendWhatsApp(from, "⚠️ Crédits épuisés. Rechargez sur le site !");
        return NextResponse.json({ success: false });
      }

      // Si l'onboarding n'est pas fini, on rappelle à l'ordre
      if (user.onboarding_step && user.onboarding_step !== 'completed') {
        await sendWhatsApp(from, "⚠️ Répondez d'abord à la question posée ci-dessus pour que je puisse travailler !");
        return NextResponse.json({ success: false });
      }

      await sendWhatsApp(from, "🎨 Analyse contextuelle de l'image...");

      const responseMedia = await fetch(mediaUrl, {
        headers: { Authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}` },
      });
      const buffer = await responseMedia.arrayBuffer();
      const base64Image = `data:${responseMedia.headers.get('content-type')};base64,${Buffer.from(buffer).toString('base64')}`;

      // Transformations Cloudinary (Logo, etc.)
      const transformations: any[] = [{ effect: "improve:outdoor" }, { quality: "auto" }];
      if (user.logo_url) {
        const logoId = user.logo_url.split('/').pop()?.split('.')[0];
        if (logoId) transformations.push({ overlay: logoId, gravity: "south_east", width: 150, x: 25, y: 25, opacity: 90 });
      }

      const cloudinaryRes = await cloudinary.uploader.upload(base64Image, {
        folder: 'pictopost_final',
        transformation: transformations
      });

      // --- LE PROMPT QUI CHANGE TOUT ---
      // On injecte l'activité précise (ex: "Costumier") pour guider l'IA
      const visionRes = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { 
                type: "text", 
                text: `Tu es le Community Manager de "${user.business_name}", une activité de "${user.business_activity}" située à ${user.business_city}.
                
                Tâche : Rédige un post Instagram engageant pour cette photo.
                
                IMPORTANT : 
                - Analyse l'image en fonction du métier "${user.business_activity}".
                - Si c'est un marié et que je suis "Vendeur de costumes", parle de l'élégance, du tissu, de la coupe.
                - Si c'est un marié et que je suis "Photographe", parle de l'émotion, de la lumière, du moment capturé.
                - Ton : ${user.brand_tone || 'Professionnel et chaleureux'}.
                - N'invente pas de fausses promotions.`
              },
              { type: "image_url", image_url: { url: base64Image } } 
            ],
          },
        ],
      });

      const caption = visionRes.choices[0].message.content || "";

      await supabase.from('draft_posts').insert([{ user_id: user.id, image_url: cloudinaryRes.secure_url, caption: caption, status: 'draft' }]);
      await supabase.rpc('decrement_credits', { user_id: user.id });

      const { data: updated } = await supabase.from('profiles').select('credits_remaining').eq('id', user.id).single();

      await twilioClient.messages.create({
        from: 'whatsapp:+14155238886',
        to: from,
        body: `✨ *PROPOSITION (${user.business_activity}) :*\n\n"${caption}"\n\n✅ Répondez OUI ou demandez une modif.\n📉 Solde : ${updated?.credits_remaining}`,
        mediaUrl: [cloudinaryRes.secure_url]
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("ERREUR WEBHOOK:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function sendWhatsApp(to: string, body: string) {
  try { await twilioClient.messages.create({ from: 'whatsapp:+14155238886', to, body }); } catch (e) { console.error(e); }
}