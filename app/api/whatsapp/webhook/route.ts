import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js'; // On utilise createClient directement
import { v2 as cloudinary } from 'cloudinary';

// --- CONFIGURATION CLIENTS ---
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- SUPABASE ADMIN (Pour contourner les blocages RLS) ---
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Assure-toi d'avoir cette clé dans .env.local
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

    // 1. LIAISON DE COMPTE + RESET ONBOARDING
    if (body.toLowerCase().startsWith("lier mon compte")) {
      const userId = body.split(" ").pop();
      
      // On force le mode Admin pour être sûr que ça s'écrit
      const { error } = await supabaseAdmin
        .from('profiles')
        .update({ 
          whatsapp_number: from,
          onboarding_step: 'ask_name', // On initialise le questionnaire
          business_name: null,         // On nettoie pour éviter les conflits
          business_activity: null
        })
        .eq('id', userId);

      if (error) {
        console.error("Erreur Liaison:", error);
        await sendWhatsApp(from, "❌ Erreur technique. Vérifiez votre ID.");
        return NextResponse.json({ success: false });
      }

      await sendWhatsApp(from, `👋 Bienvenue ! Pour commencer, j'ai besoin de 3 infos.\n\n1️⃣ Quel est le **Nom de votre commerce** ?`);
      return NextResponse.json({ success: true });
    }

    // 1bis. COMMANDE DE SECOURS "RESET"
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

    // 3. MACHINE À ÉTATS (ONBOARDING)
    // On utilise des "else if" stricts pour éviter que le code ne saute d'une étape à l'autre trop vite
    if (user.onboarding_step && user.onboarding_step !== 'completed' && !mediaUrl) {
      
      // QUESTION 1 : NOM -> ACTIVITÉ
      if (user.onboarding_step === 'ask_name') {
        const { error } = await supabaseAdmin.from('profiles').update({ 
          business_name: body, 
          onboarding_step: 'ask_activity' 
        }).eq('id', user.id);

        if (error) console.error("Erreur Update Name:", error);
        
        await sendWhatsApp(from, `✅ Noté "${body}".\n\n2️⃣ Quelle est votre **Activité précise** ?\n(ex: Restaurant Italien, Fleuriste, Garage...)`);
        return NextResponse.json({ success: true });
      }

      // QUESTION 2 : ACTIVITÉ -> VILLE
      else if (user.onboarding_step === 'ask_activity') {
        const { error } = await supabaseAdmin.from('profiles').update({ 
          business_activity: body, 
          onboarding_step: 'ask_city' 
        }).eq('id', user.id);

        if (error) console.error("Erreur Update Activity:", error);

        await sendWhatsApp(from, `✅ C'est noté.\n\n3️⃣ Dans quelle **Ville** êtes-vous ?`);
        return NextResponse.json({ success: true });
      }

      // QUESTION 3 : VILLE -> FIN
      else if (user.onboarding_step === 'ask_city') {
        const { error } = await supabaseAdmin.from('profiles').update({ 
          business_city: body, 
          onboarding_step: 'completed' 
        }).eq('id', user.id);

        if (error) console.error("Erreur Update City:", error);

        await sendWhatsApp(from, `🎉 Parfait ! Je suis configuré pour un **${user.business_activity}** à **${body}**.\n\n📸 Envoyez-moi une photo (plat, produit, équipe...) pour tester !`);
        return NextResponse.json({ success: true });
      }
    }

    // 4. IA INTERACTIVE (Modifs)
    if (body && !mediaUrl && body.toUpperCase() !== 'OUI') {
      const { data: lastDraft } = await supabaseAdmin.from('draft_posts').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).single();
      if (lastDraft) {
        await sendWhatsApp(from, "🔄 Je modifie...");
        const aiRes = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: `CM pour ${user.business_name} (${user.business_activity}). Post précédent : ${lastDraft.caption}` },
            { role: "user", content: "Modif : " + body }
          ]
        });
        const newCaption = aiRes.choices[0].message.content || "";
        await supabaseAdmin.from('draft_posts').update({ caption: newCaption }).eq('id', lastDraft.id);
        await sendWhatsApp(from, `✨ Nouvelle version :\n\n"${newCaption}"\n\n✅ Répondez OUI.`);
        return NextResponse.json({ success: true });
      }
    }

    // 5. VALIDATION
    if (body.toUpperCase() === 'OUI') {
      const { data: draft } = await supabaseAdmin.from('draft_posts').select('*').eq('user_id', user.id).eq('status', 'draft').order('created_at', { ascending: false }).limit(1).single();
      if (draft) {
        await sendWhatsApp(from, "🚀 Publication en cours...");
        await supabaseAdmin.from('draft_posts').update({ status: 'published' }).eq('id', draft.id);
        await sendWhatsApp(from, `✅ Publié !\n(Solde : ${user.credits_remaining})`);
      }
      return NextResponse.json({ success: true });
    }

    // 6. PHOTO + CONTEXTE
    if (mediaUrl) {
      if (user.credits_remaining <= 0 && !user.is_pro) {
        await sendWhatsApp(from, "⚠️ Crédits épuisés.");
        return NextResponse.json({ success: false });
      }

      // Check si onboarding fini
      if (user.onboarding_step && user.onboarding_step !== 'completed') {
        await sendWhatsApp(from, "⚠️ Finissez de répondre aux questions d'abord !");
        return NextResponse.json({ success: false });
      }

      await sendWhatsApp(from, "🎨 Analyse en cours...");

      const responseMedia = await fetch(mediaUrl, { headers: { Authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}` } });
      const buffer = await responseMedia.arrayBuffer();
      const base64Image = `data:${responseMedia.headers.get('content-type')};base64,${Buffer.from(buffer).toString('base64')}`;

      const transformations: any[] = [{ effect: "improve:outdoor" }, { quality: "auto" }];
      if (user.logo_url) {
        const logoId = user.logo_url.split('/').pop()?.split('.')[0];
        transformations.push({ overlay: logoId, gravity: "south_east", width: 150, x: 25, y: 25 });
      }

      const cloudRes = await cloudinary.uploader.upload(base64Image, { folder: 'wa', transformation: transformations });

      // PROMPT CONTEXTUEL
      const visionRes = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{
            role: "user",
            content: [
              { type: "text", text: `Tu es CM pour "${user.business_name}" (${user.business_activity}) à ${user.business_city}. Rédige un post Instagram pour cette photo. Adapte le vocabulaire au métier.` },
              { type: "image_url", image_url: { url: base64Image } }
            ],
        }],
      });

      const caption = visionRes.choices[0].message.content || "";
      await supabaseAdmin.from('draft_posts').insert([{ user_id: user.id, image_url: cloudRes.secure_url, caption, status: 'draft' }]);
      await supabaseAdmin.rpc('decrement_credits', { user_id: user.id });
      
      const { data: updated } = await supabaseAdmin.from('profiles').select('credits_remaining').eq('id', user.id).single();

      await twilioClient.messages.create({
        from: 'whatsapp:+14155238886',
        to: from,
        body: `✨ *PROPOSITION (${user.business_activity}) :*\n\n"${caption}"\n\n✅ Répondez OUI.\n📉 Solde : ${updated?.credits_remaining}`,
        mediaUrl: [cloudRes.secure_url]
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("ERREUR:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

async function sendWhatsApp(to: string, body: string) {
  try { await twilioClient.messages.create({ from: 'whatsapp:+14155238886', to, body }); } catch (e) { console.error(e); }
}