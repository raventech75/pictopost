import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js'; 
import { v2 as cloudinary } from 'cloudinary';

// --- CONFIGURATION ---
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// REMPLACE PAR TON URL DE WEBHOOK MAKE (SCENARIO MULTI-POST)
const MAKE_WEBHOOK_URL = "https://hook.eu2.make.com/yv6c3wse4gk9mhdrfmp5w00xlp12abbg"; 

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
  try {
    const formData = await req.formData();
    const from = formData.get('From') as string;
    const body = formData.get('Body')?.toString().trim() || "";
    const mediaUrl = formData.get('MediaUrl0') as string;

    // 1. GESTION DU "RESET" (Pour tes tests)
    if (body.toUpperCase() === 'RESET') {
      const { data: u } = await supabaseAdmin.from('profiles').select('id').eq('whatsapp_number', from).single();
      if (u) {
        await supabaseAdmin.from('profiles').update({ onboarding_step: 'ask_name', business_name: null }).eq('id', u.id);
        await sendWhatsApp(from, "🔄 Reset effectué.\n\n1️⃣ Quel est le **Nom de votre commerce** ?");
        return NextResponse.json({ success: true });
      }
    }

    // 2. RECUPERATION USER
    const { data: user, error: userError } = await supabaseAdmin.from('profiles').select('*').eq('whatsapp_number', from).single();

    // 3. LIAISON DE COMPTE (Si inconnu)
    if ((userError || !user) && body.toLowerCase().startsWith("lier mon compte")) {
      const userId = body.split(" ").pop();
      const { error } = await supabaseAdmin.from('profiles').update({ whatsapp_number: from, onboarding_step: 'ask_name' }).eq('id', userId);
      if (error) { await sendWhatsApp(from, "❌ Erreur ID."); return NextResponse.json({ success: false }); }
      await sendWhatsApp(from, `👋 Bienvenue ! Configurons l'assistant.\n\n1️⃣ Quel est le **Nom de votre commerce** ?`);
      return NextResponse.json({ success: true });
    }
    
    if (!user) {
      await sendWhatsApp(from, "🤖 Compte inconnu. Allez sur le site pour lier votre WhatsApp.");
      return NextResponse.json({ success: false });
    }

    // 4. ONBOARDING (Si pas fini)
    if (user.onboarding_step && user.onboarding_step !== 'completed' && !mediaUrl) {
      if (user.onboarding_step === 'ask_name') {
        await supabaseAdmin.from('profiles').update({ business_name: body, onboarding_step: 'ask_activity' }).eq('id', user.id);
        await sendWhatsApp(from, `✅ Noté.\n\n2️⃣ Quelle est votre **Activité** ? (ex: Pizzeria, Coiffeur...)`);
      }
      else if (user.onboarding_step === 'ask_activity') {
        await supabaseAdmin.from('profiles').update({ business_activity: body, onboarding_step: 'ask_city' }).eq('id', user.id);
        await sendWhatsApp(from, `✅ Ok.\n\n3️⃣ Quelle **Ville** ?`);
      }
      else if (user.onboarding_step === 'ask_city') {
        await supabaseAdmin.from('profiles').update({ business_city: body, onboarding_step: 'completed' }).eq('id', user.id);
        await sendWhatsApp(from, `🎉 Configuration terminée !\n\n📸 **Envoyez-moi maintenant une photo** pour générer votre premier post.`);
      }
      return NextResponse.json({ success: true });
    }

    // 5. MODIF TEXTE (Si texte sans photo et pas "OUI")
    if (body && !mediaUrl && body.toUpperCase() !== 'OUI') {
      const { data: last } = await supabaseAdmin.from('draft_posts').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).single();
      if (last) {
        await sendWhatsApp(from, "🔄 Je corrige...");
        const ai = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [{ role: "system", content: "Expert CM. Change ce texte: " + last.caption }, { role: "user", content: "Instruction: " + body }]
        });
        const txt = ai.choices[0].message.content || "";
        await supabaseAdmin.from('draft_posts').update({ caption: txt }).eq('id', last.id);
        await sendWhatsApp(from, `✨ Nouveau texte :\n\n"${txt}"\n\n✅ Répondez **OUI** pour publier sur vos réseaux.`);
        return NextResponse.json({ success: true });
      }
    }

    // =================================================================================
    // 6. LE CLIENT DIT "OUI" -> ENVOI VERS TOUS LES RÉSEAUX (VIA MAKE)
    // =================================================================================
    if (body.toUpperCase() === 'OUI') {
      const { data: draft } = await supabaseAdmin.from('draft_posts').select('*').eq('user_id', user.id).eq('status', 'draft').order('created_at', { ascending: false }).limit(1).single();
      
      if (draft) {
        // On vérifie s'il a connecté au moins un réseau
        if (!user.instagram_access_token && !user.facebook_access_token) {
          await sendWhatsApp(from, "⚠️ Vous n'avez connecté aucun réseau (Insta/FB) sur le site web.\nConnectez-vous sur le site d'abord !");
          return NextResponse.json({ success: false });
        }

        await sendWhatsApp(from, "🚀 Diffusion automatique sur vos réseaux connectés...");

        // ON ENVOIE TOUT A MAKE.COM
        try {
          await fetch(MAKE_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              // Le contenu
              image_url: draft.image_url,
              caption: draft.caption,
              // Les identifiants clients (Make triera ce qui est vide ou rempli)
              ig_id: user.instagram_business_id, 
              ig_token: user.instagram_access_token,
              fb_page_id: user.facebook_page_id,
              fb_token: user.facebook_access_token,
              // google_token: user.google_token (à venir)
            })
          });

          await supabaseAdmin.from('draft_posts').update({ status: 'published' }).eq('id', draft.id);
          await sendWhatsApp(from, `✅ **POSTÉ !**\n\nVotre publication est en ligne.\n(Solde : ${user.credits_remaining})`);
          
        } catch (e) {
          console.error(e);
          await sendWhatsApp(from, "❌ Erreur de connexion Make.");
        }
      } else {
        await sendWhatsApp(from, "❌ Aucun post prêt. Envoyez une photo d'abord.");
      }
      return NextResponse.json({ success: true });
    }

    // =================================================================================
    // 7. TRAITEMENT PHOTO -> GÉNÉRATION
    // =================================================================================
    if (mediaUrl) {
      if (user.credits_remaining <= 0 && !user.is_pro) {
        await sendWhatsApp(from, "⚠️ Crédits épuisés. Rechargez sur le site.");
        return NextResponse.json({ success: false });
      }
      
      if (user.onboarding_step !== 'completed') {
        await sendWhatsApp(from, "⚠️ Répondez aux questions d'abord.");
        return NextResponse.json({ success: false });
      }

      await sendWhatsApp(from, "🎨 Création de votre post...");

      const resMedia = await fetch(mediaUrl, { headers: { Authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}` } });
      const buff = await resMedia.arrayBuffer();
      const b64 = `data:${resMedia.headers.get('content-type')};base64,${Buffer.from(buff).toString('base64')}`;

      // Cloudinary + Logo
      const trans: any[] = [{ quality: "auto" }];
      if (user.logo_url) {
         try {
           const lid = user.logo_url.split('/').pop()?.split('.')[0];
           trans.push({ overlay: lid, gravity: "south_east", width: 150, x: 20, y: 20 });
         } catch(e) {}
      }
      
      let cloudRes;
      try {
        cloudRes = await cloudinary.uploader.upload(b64, { folder: 'final_pub', transformation: trans });
      } catch (e) {
        await sendWhatsApp(from, "❌ Erreur image. Essayez une autre.");
        return NextResponse.json({ success: false });
      }

      // IA
      const ai = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: [
          { type: "text", text: `Rédige un post pour réseaux sociaux. 
            Commerce: ${user.business_name} (${user.business_activity}). 
            Ville: ${user.business_city}. 
            Ton: ${user.brand_tone || 'Pro'}.
            Rédige un texte unique qui passe bien sur Instagram et Facebook.` },
          { type: "image_url", image_url: { url: b64 } }
        ]}]
      });
      const cap = ai.choices[0].message.content || "";

      // Décompte
      const newCredits = user.credits_remaining - 1;
      await supabaseAdmin.from('profiles').update({ credits_remaining: newCredits }).eq('id', user.id);
      
      await supabaseAdmin.from('draft_posts').insert([{ user_id: user.id, image_url: cloudRes.secure_url, caption: cap, status: 'draft' }]);

      await twilioClient.messages.create({
        from: 'whatsapp:+14155238886',
        to: from,
        body: `✨ *PROPOSITION :*\n\n"${cap}"\n\n✅ Répondez **OUI** pour publier automatiquement sur vos réseaux connectés.\n📉 Solde : ${newCredits}`,
        mediaUrl: [cloudRes.secure_url]
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

async function sendWhatsApp(to: string, body: string) {
  try { await twilioClient.messages.create({ from: 'whatsapp:+14155238886', to, body }); } catch (e) { console.error(e); }
}