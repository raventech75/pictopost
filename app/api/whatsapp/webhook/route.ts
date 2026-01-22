import { NextRequest, NextResponse } from 'next/server';
import Twilio from 'twilio';
import OpenAI from 'openai';

const twilioClient = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    // 1. Récupérer les données envoyées par Twilio (Format x-www-form-urlencoded)
    const formData = await req.formData();
    const from = formData.get('From') as string; // Numéro du client
    const mediaUrl = formData.get('MediaUrl0') as string; // URL de l'image
    const bodyText = formData.get('Body') as string; // Texte optionnel envoyé

    if (!mediaUrl) {
      await sendWhatsApp(from, "Bonjour ! Envoyez-moi une photo de votre produit ou de votre boutique pour que je prépare un post. 📸");
      return NextResponse.json({ message: 'No media' });
    }

    // 2. Envoyer l'image à l'IA pour générer le contenu
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Tu es un community manager expert. Analyse cette image et rédige un post Instagram captivant avec des hashtags locaux. Sois chaleureux et professionnel." },
            { type: "image_url", image_url: { url: mediaUrl } },
          ],
        },
      ],
    });

    const aiContent = response.choices[0].message.content || "Désolé, je n'ai pas pu générer de texte.";

    // 3. Renvoyer la proposition au client sur WhatsApp
    await sendWhatsApp(from, `✨ Voici une proposition pour votre post :\n\n"${aiContent}"\n\nRépondez "OUI" pour le publier sur Pictopost !`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Erreur Webhook:', error);
    return NextResponse.json({ error: 'Internal Error' }, { status: 500 });
  }
}

async function sendWhatsApp(to: string, body: string) {
  return twilioClient.messages.create({
    from: process.env.TWILIO_PHONE_NUMBER,
    to: to,
    body: body,
  });
}