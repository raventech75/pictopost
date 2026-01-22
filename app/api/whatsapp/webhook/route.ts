import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js'; // Utilisation du client Admin
import { v2 as cloudinary } from 'cloudinary';

// --- CONFIGURATION CLIENTS ---
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- SUPABASE ADMIN (Pour contourner les droits RLS et écrire sans session) ---
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export async function POST(req: NextRequest) {
  console.log("--- WEBHOOK TRIGGERED ---");
  
  try {
    const formData = await req.formData();
    const from = formData.get('From') as string;
    const body = formData.get('Body')?.toString().trim() || "";
    const mediaUrl = formData.get('MediaUrl0') as string;

    // 1. LIAISON DE COMPTE (AVEC RESET)
    if (body.toLowerCase().startsWith("lier mon compte")) {
      const userId = body.split(" ").pop();
      
      const { error } = await supabaseAdmin
        .from('profiles')
        .update({ 
          whatsapp_number: from,
          onboarding_step: 'ask_name', 
          business_name: null,         
          business_activity: null
        })
        .eq('id', userId);

      if (error) {
        console.error("Erreur Liaison:", error);
        await sendWhatsApp(from, "❌ Erreur technique. Vérifiez votre ID.");
        return NextResponse.json({ success: false });
      }

      await sendWhatsApp(from, `👋 Bienvenue ! Configurons votre assistant.\n\n1️⃣ Quel est le **Nom de votre commerce** ?`);
      return NextResponse.json({ success: true });
    }

    // 1bis. RESET MANUEL
    if (body.toUpperCase() === 'RESET') {
      const { data: userReset } = await supabaseAdmin.from('profiles').select('id').eq('whatsapp_number', from).single();
      if (userReset) {
        await supabaseAdmin.from('profiles').update({ 
          onboarding_step: 'ask_name',
          business_name: null,
          business_activity: null
        }).eq('id', userReset.id);
        await sendWhatsApp(from, "🔄 Reset effectué.\n\n1️⃣ Quel est le **Nom de votre commerce** ?");
        return NextResponse.json({ success: true });
      }
    }

    // 2. RÉCUPÉRATION UTILISATEUR
    const { data: user, error: userError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('whatsapp_number', from)
      .single();

    if (userError || !user) {
      await sendWhatsApp(from, "🤖 Numéro inconnu. Liez votre compte sur le site.");
      return NextResponse.json({ success: false });
    }

    // 3. ONBOARDING (Machine à états)
    if (user.onboarding_step && user.onboarding_step !== 'completed' && !mediaUrl) {
      if (user.onboarding_step === 'ask_name') {
        await supabaseAdmin.from('profiles').update({ business_name: body, onboarding_step: 'ask_activity' }).eq('id', user.id);
        await sendWhatsApp(from, `✅ Noté "${body}".\n\n2️⃣ Quelle est votre **Activité** ? (ex: Restaurant, Fleuriste...)`);
        return NextResponse.json({ success: true });
      }
      else if (user.onboarding_step === 'ask_activity') {
        await supabaseAdmin.from('profiles').update({ business_activity: body, onboarding_step: 'ask_city' }).eq('id', user.id);
        await sendWhatsApp(from, `✅ C'est noté.\n\n3️⃣ Dans quelle **Ville** êtes-vous ?`);
        return NextResponse.json({ success: true });
      }
      else if (user.onboarding_step === 'ask_city') {
        await supabaseAdmin.from('profiles').update({ business_city: body, onboarding_step: 'completed' }).eq('id', user.id);
        await sendWhatsApp(from, `🎉 Parfait ! Je suis prêt.\n\n📸 Envoyez-moi une photo pour tester !`);
        return NextResponse.json({ success: true });
      }
    }

    // 4. MODIFICATION TEXTE (IA)
    if (body && !mediaUrl && body.toUpperCase() !== 'OUI') {
      const { data: lastDraft } = await supabaseAdmin.from('draft_posts').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).single();
      if (lastDraft) {
        await sendWhatsApp(from, "🔄 Je modifie...");
        const aiRes = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: `CM pour ${user.business_name} (${user.business_activity}). Précédent : ${lastDraft.caption}` },
            { role: "user", content: "Modif : " + body }
          ]
        });
        const newCaption = aiRes.choices[0].message.content || "";
        await supabaseAdmin.from('draft_posts').update({ caption: newCaption }).eq('id', lastDraft.id);
        await sendWhatsApp(from, `✨ Nouvelle version :\n\n"${newCaption}"\n\n✅ Répondez OUI pour recevoir le post final.`);
        return NextResponse.json({ success: true });
      }
    }

    // 5. VALIDATION OUI (LIVRAISON FINALE - PHASE 1)
    if (body.toUpperCase() === 'OUI') {
      const { data: draft } = await supabaseAdmin.from('draft_posts').select('*').eq('user_id', user.id).eq('status', 'draft').order('created_at', { ascending: false }).limit(1).single();
      if (draft) {
        // Validation BDD
        await supabaseAdmin.from('draft_posts').update({ status: 'published' }).eq('id', draft.id);
        
        // 1. Envoi du Texte seul (Facile à copier)
        await sendWhatsApp(from, `📝 *Voici votre texte (Copiez-le) :*\n\n${draft.caption}`);

        // 2. Envoi de l'Image seule (Facile à partager)
        await twilioClient.messages.create({
          from: 'whatsapp:+14155238886',
          to: from,
          body: `📸 *Voici votre image finale !*\n\nCliquez sur l'image > Partager > Instagram.\n(Solde : ${user.credits_remaining})`,
          mediaUrl: [draft.image_url]
        });
      } else {
        await sendWhatsApp(from, "❌ Aucun brouillon en attente.");
      }
      return NextResponse.json({ success: true });
    }

    // 6. TRAITEMENT PHOTO
    if (mediaUrl) {
      if (user.credits_remaining <= 0 && !user.is_pro) {
        await sendWhatsApp(from, "⚠️ Crédits épuisés.");
        return NextResponse.json({ success: false });
      }
      if (user.onboarding_step && user.onboarding_step !== 'completed') {
        await sendWhatsApp(from, "⚠️ Répondez d'abord à la question !");
        return NextResponse.json({ success: false });
      }

      await sendWhatsApp(from, "🎨 Analyse en cours...");

      // Download Image
      const responseMedia = await fetch(mediaUrl, { headers: { Authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}` } });
      const buffer = await responseMedia.arrayBuffer();
      const base64Image = `data:${responseMedia.headers.get('content-type')};base64,${Buffer.from(buffer).toString('base64')}`;

      // --- CORRECTION CLOUDINARY (TRY/CATCH ROBUSTE) ---
      let finalImageUrl = "";
      try {
        const transformations: any[] = [{ effect: "improve:outdoor" }, { quality: "auto" }];
        
        // Tentative d'ajout du logo (avec sécurité)
        if (user.logo_url) {
          try {
            // Extraction plus sure : on suppose que c'est une URL Cloudinary standard
            // Ex: .../upload/v12345/mon_dossier/mon_logo.png -> mon_dossier:mon_logo
            const parts = user.logo_url.split('/');
            const filename = parts.pop().split('.')[0]; // mon_logo
            // On essaie d'utiliser juste le filename, ou on loggue si ça foire
            console.log("Tentative overlay logo:", filename);
            transformations.push({ overlay: filename, gravity: "south_east", width: 150, x: 25, y: 25, opacity: 90 });
          } catch (logoErr) {
            console.error("Erreur config logo (ignorée):", logoErr);
          }
        }

        const cloudRes = await cloudinary.uploader.upload(base64Image, { 
          folder: 'wa', 
          transformation: transformations 
        });
        finalImageUrl = cloudRes.secure_url;

      } catch (cloudError) {
        console.error("ERREUR CRITIQUE CLOUDINARY:", cloudError);
        // Fallback : Si cloudinary plante (SVG error), on utilise l'image de base sans retouche pour ne pas bloquer l'user
        // Note: Dans un vrai cas prod, on uploaderait l'image brute. Ici on stop et on prévient.
        await sendWhatsApp(from, "⚠️ Erreur technique sur l'image (format non supporté). Essayez une autre photo.");
        return NextResponse.json({ success: false });
      }

      // IA GENERATION
      const visionRes = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{
            role: "user",
            content: [
              { type: "text", text: `Tu es CM pour "${user.business_name}" (${user.business_activity}) à ${user.business_city}. Rédige un post Instagram pour cette photo. Adapte le ton : ${user.brand_tone || 'Pro'}.` },
              { type: "image_url", image_url: { url: base64Image } }
            ],
        }],
      });

      const caption = visionRes.choices[0].message.content || "";
      
      // Save & Update Credits
      await supabaseAdmin.from('draft_posts').insert([{ user_id: user.id, image_url: finalImageUrl, caption, status: 'draft' }]);
      await supabaseAdmin.rpc('decrement_credits', { user_id: user.id });
      const { data: updated } = await supabaseAdmin.from('profiles').select('credits_remaining').eq('id', user.id).single();

      await twilioClient.messages.create({
        from: 'whatsapp:+14155238886',
        to: from,
        body: `✨ *PROPOSITION (${user.business_activity}) :*\n\n"${caption}"\n\n✅ Répondez OUI pour recevoir les fichiers.\n📉 Solde : ${updated?.credits_remaining}`,
        mediaUrl: [finalImageUrl]
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("ERREUR GLOBALE:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

async function sendWhatsApp(to: string, body: string) {
  try { await twilioClient.messages.create({ from: 'whatsapp:+14155238886', to, body }); } catch (e) { console.error("Erreur envoi:", e); }
}