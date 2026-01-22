// ... (garder les imports et config twilio/openai)

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const from = formData.get('From') as string;
    const body = formData.get('Body')?.toString().trim() || "";
    const mediaUrl = formData.get('MediaUrl0') as string;

    // 1. Vérification utilisateur (Supabase)
    const { data: user } = await supabase.from('profiles').select('*').eq('whatsapp_number', from).single();
    if (!user) {
        await sendWhatsApp(from, "❌ Compte non reconnu.");
        return NextResponse.json({ success: false });
    }

    // 2. Gestion du "OUI" (Publication)
    if (body.toUpperCase() === 'OUI') {
        // ... (ton code de publication actuel)
        return NextResponse.json({ success: true });
    }

    // 3. SI IMAGE REÇUE : On la télécharge et on l'envoie à l'IA
    if (mediaUrl) {
      await sendWhatsApp(from, "🤖 Analyse de l'image en cours...");

      // --- NOUVEAU : Téléchargement de l'image pour OpenAI ---
      const responseMedia = await fetch(mediaUrl, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        },
      });
      const buffer = await responseMedia.arrayBuffer();
      const base64Image = Buffer.from(buffer).toString('base64');
      const contentType = responseMedia.headers.get('content-type') || 'image/jpeg';
      // -------------------------------------------------------

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `Rédige un post Instagram vendeur. Ton : ${user.brand_tone}` },
              {
                type: "image_url",
                image_url: { url: `data:${contentType};base64,${base64Image}` }, // Envoi en Base64
              },
            ],
          },
        ],
      });

      const aiText = response.choices[0].message.content || "";

      await supabase.from('draft_posts').insert([{ user_id: user.id, image_url: mediaUrl, caption: aiText }]);
      await sendWhatsApp(from, `✨ *PROPOSITION :*\n\n"${aiText}"\n\n✅ Répondez *OUI* pour publier.`);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Erreur Webhook:", err);
    return NextResponse.json({ error: "Erreur" }, { status: 500 });
  }
}