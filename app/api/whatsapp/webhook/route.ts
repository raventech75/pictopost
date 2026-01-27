import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js'; 
import { v2 as cloudinary } from 'cloudinary';

// --- CONFIGURATION ---
// On utilise les variables d'environnement pour la sécurité
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Admin Client pour contourner le RLS (Row Level Security) car c'est le serveur qui agit
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
    const from = formData.get('From') as string; // Ex: whatsapp:+33612345678
    const body = formData.get('Body')?.toString().trim() || "";
    const mediaUrl = formData.get('MediaUrl0') as string;

    // 1. GESTION DU "RESET" (Utile pour tes tests ou recommencer l'onboarding)
    if (body.toUpperCase() === 'RESET') {
      const { data: u } = await supabaseAdmin.from('profiles').select('id').eq('whatsapp_number', from).single();
      if (u) {
        await supabaseAdmin.from('profiles').update({ onboarding_step: 'ask_name', business_name: null }).eq('id', u.id);
        await sendWhatsApp(from, "🔄 Reset effectué.\n\n1️⃣ Quel est le **Nom de votre commerce** ?");
        return NextResponse.json({ success: true });
      }
    }

    // 2. RECUPERATION UTILISATEUR
    const { data: user, error: userError } = await supabaseAdmin.from('profiles').select('*').eq('whatsapp_number', from).single();

    // 3. LIAISON DE COMPTE (Si l'utilisateur vient du site avec "Lier mon compte")
    if ((userError || !user) && body.toLowerCase().startsWith("lier mon compte")) {
      const userId = body.split(" ").pop();
      const { error } = await supabaseAdmin.from('profiles').update({ whatsapp_number: from, onboarding_step: 'ask_name' }).eq('id', userId);
      if (error) { await sendWhatsApp(from, "❌ Erreur ID. Vérifiez votre code."); return NextResponse.json({ success: false }); }
      await sendWhatsApp(from, `👋 Bienvenue ! Configurons votre assistant.\n\n1️⃣ Quel est le **Nom de votre commerce** ?`);
      return NextResponse.json({ success: true });
    }
    
    // Si l'utilisateur n'existe pas du tout
    if (!user) {
      await sendWhatsApp(from, "🤖 Compte inconnu. Allez sur https://pictopost.vercel.app pour créer un compte et avoir des crédits.");
      return NextResponse.json({ success: false });
    }

    // 4. ONBOARDING (Si l'utilisateur n'a pas fini de répondre aux questions)
    if (user.onboarding_step && user.onboarding_step !== 'completed' && !mediaUrl) {
      if (user.onboarding_step === 'ask_name') {
        await supabaseAdmin.from('profiles').update({ business_name: body, onboarding_step: 'ask_activity' }).eq('id', user.id);
        await sendWhatsApp(from, `✅ Noté.\n\n2️⃣ Quelle est votre **Activité** ? (ex: Pizzeria, Coiffeur...)`);
      }
      else if (user.onboarding_step === 'ask_activity') {
        await supabaseAdmin.from('profiles').update({ business_activity: body, onboarding_step: 'ask_city' }).eq('id', user.id);
        await sendWhatsApp(from, `✅ C'est noté.\n\n3️⃣ Quelle est votre **Ville** ?`);
      }
      else if (user.onboarding_step === 'ask_city') {
        await supabaseAdmin.from('profiles').update({ business_city: body, onboarding_step: 'completed' }).eq('id', user.id);
        await sendWhatsApp(from, `🎉 Configuration terminée !\n\n📸 **Envoyez-moi maintenant une PHOTO** pour générer votre premier post.`);
      }
      return NextResponse.json({ success: true });
    }

    // 5. MODIFICATION DU TEXTE (L'utilisateur répond par du texte pour corriger l'IA)
    if (body && !mediaUrl && body.toUpperCase() !== 'OUI') {
      const { data: last } = await supabaseAdmin.from('draft_posts').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).single();
      if (last) {
        await sendWhatsApp(from, "🔄 Je corrige le texte...");
        const ai = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: "Tu es un expert Community Manager. Modifie ce texte : " + last.caption }, 
            { role: "user", content: "Instruction de modification : " + body }
          ]
        });
        const txt = ai.choices[0].message.content || "";
        await supabaseAdmin.from('draft_posts').update({ caption: txt }).eq('id', last.id);
        await sendWhatsApp(from, `✨ Nouveau texte :\n\n"${txt}"\n\n✅ Répondez **OUI** pour recevoir votre kit de publication.`);
        return NextResponse.json({ success: true });
      }
    }

    // =================================================================================
    // 6. LE CLIENT DIT "OUI" -> LIVRAISON DU KIT (IMAGE + TEXTE) - OPTION B
    // =================================================================================
    if (body.toUpperCase() === 'OUI') {
      // On récupère le dernier brouillon en attente
      const { data: draft } = await supabaseAdmin
        .from('draft_posts')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'draft') 
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      if (draft) {
        // 1. On marque comme "livré" pour ne pas le renvoyer en boucle
        await supabaseAdmin.from('draft_posts').update({ status: 'delivered' }).eq('id', draft.id);

        await sendWhatsApp(from, "🚀 Préparation de votre kit de publication...");

        // 2. Envoi de l'image finale (HD)
        try {
            await twilioClient.messages.create({
                from: process.env.TWILIO_PHONE_NUMBER,
                to: from,
                body: "1️⃣ Voici votre image (Enregistrez-la dans votre téléphone 👇)",
                mediaUrl: [draft.image_url] 
            });
        } catch (e) {
            console.error("Erreur envoi image finale", e);
            await sendWhatsApp(from, "❌ Oups, petit souci pour envoyer l'image. Elle est disponible dans votre historique.");
        }

        // 3. Envoi du texte SEUL (pour copier facile)
        await sendWhatsApp(from, draft.caption);

        // 4. Instructions finales + Lien Instagram
        await sendWhatsApp(from, 
            "2️⃣ Ci-dessus le texte à copier (Appui long > Copier) 👆\n\n" +
            "3️⃣ Cliquez ici pour ouvrir Instagram : https://www.instagram.com/create/select/\n\n" +
            "✅ Post prêt à publier ! (Crédits restants : " + user.credits_remaining + ")"
        );

      } else {
        await sendWhatsApp(from, "❌ Aucun post en attente. Envoyez une nouvelle photo pour commencer.");
      }
      return NextResponse.json({ success: true });
    }

    // =================================================================================
    // 7. TRAITEMENT PHOTO -> GÉNÉRATION DU POST
    // =================================================================================
    if (mediaUrl) {
      // Vérification crédits
      if (user.credits_remaining <= 0 && !user.is_pro) {
        await sendWhatsApp(from, "🚫 Crédits épuisés. Rechargez sur https://pictopost.vercel.app");
        return NextResponse.json({ success: false });
      }
      
      // Vérification onboarding
      if (user.onboarding_step !== 'completed') {
        await sendWhatsApp(from, "⚠️ Je ne connais pas encore votre commerce. Répondez aux questions d'abord !");
        return NextResponse.json({ success: false });
      }

      await sendWhatsApp(from, "🎨 Je crée votre post... (Analyse + Logo + Rédaction)");

      // Téléchargement de l'image Twilio (Avec Auth pour sécurité)
      const resMedia = await fetch(mediaUrl, { 
        headers: { Authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}` } 
      });
      const buff = await resMedia.arrayBuffer();
      const b64 = `data:${resMedia.headers.get('content-type')};base64,${Buffer.from(buff).toString('base64')}`;

      // Configuration Cloudinary (Overlay Logo)
      const trans: any[] = [{ quality: "auto" }];
      if (user.logo_url) {
         try {
           // On essaie d'extraire l'ID public du logo depuis l'URL
           const lid = user.logo_url.split('/').pop()?.split('.')[0];
           if (lid) {
               trans.push({ overlay: lid, gravity: "south_east", width: 150, x: 20, y: 20 });
           }
         } catch(e) { console.error("Erreur logo overlay", e); }
      }
      
      // Upload Cloudinary
      let cloudRes;
      try {
        cloudRes = await cloudinary.uploader.upload(b64, { folder: 'final_pub', transformation: trans });
      } catch (e) {
        console.error("Erreur Cloudinary", e);
        await sendWhatsApp(from, "❌ Erreur lors du traitement de l'image. Réessayez.");
        return NextResponse.json({ success: false });
      }

      // Génération Texte via OpenAI
      const ai = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: [
          { type: "text", text: `Rédige un post pour réseaux sociaux (Instagram/Facebook).
            Commerce: ${user.business_name} (${user.business_activity}). 
            Ville: ${user.business_city}. 
            Ton: ${user.brand_tone || 'Professionnel et engageant'}.
            Fais court, utilise des emojis, et va droit au but. Pas de phrase d'introduction du type 'Voici une proposition'.` },
          { type: "image_url", image_url: { url: b64 } }
        ]}]
      });
      const cap = ai.choices[0].message.content || "";

      // Débit du crédit
      const newCredits = user.credits_remaining - 1;
      await supabaseAdmin.from('profiles').update({ credits_remaining: newCredits }).eq('id', user.id);
      
      // Sauvegarde du brouillon
      await supabaseAdmin.from('draft_posts').insert([{ 
          user_id: user.id, 
          image_url: cloudRes.secure_url, 
          caption: cap, 
          status: 'draft' 
      }]);

      // Envoi de la proposition (Avec l'image Cloudinary propre)
      await twilioClient.messages.create({
        from: process.env.TWILIO_PHONE_NUMBER,
        to: from,
        body: `✨ *PROPOSITION :*\n\n"${cap}"\n\n✅ Répondez **OUI** pour recevoir l'image et le texte prêts à poster.\n📝 Ou écrivez vos corrections pour que je modifie le texte.`,
        mediaUrl: [cloudRes.secure_url]
      });

      return NextResponse.json({ success: true });
    }

    // Par défaut
    return NextResponse.json({ success: true });

  } catch (err: any) {
    console.error("ERREUR CRITIQUE:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

// Fonction utilitaire pour envoyer du texte simple
async function sendWhatsApp(to: string, body: string) {
  try { 
      await twilioClient.messages.create({ 
          from: process.env.TWILIO_PHONE_NUMBER, 
          to, 
          body 
      }); 
  } catch (e) { console.error("Erreur sendWhatsApp", e); }
}