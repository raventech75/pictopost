import { headers } from "next/headers";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

// On utilise la SERVICE KEY pour avoir le droit d'écrire dans la base sans être connecté
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  const body = await req.text();
  const signature = (await headers()).get("stripe-signature") as string;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err: any) {
    console.error(`Webhook Error: ${err.message}`);
    return new NextResponse(`Webhook Error: ${err.message}`, { status: 400 });
  }

  // Si le paiement est réussi
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    
    // On récupère les infos qu'on avait cachées dans les métadonnées
    const userId = session.metadata?.userId;
    const creditsToAdd = parseInt(session.metadata?.creditsToAdd || "0");

    if (userId && creditsToAdd > 0) {
      console.log(`💰 Paiement validé pour ${userId}. Ajout de ${creditsToAdd} crédits.`);
      
      // 1. On récupère les crédits actuels
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("credits_remaining")
        .eq("id", userId)
        .single();

      if (profile) {
        const newBalance = (profile.credits_remaining || 0) + creditsToAdd;
        
        // 2. On met à jour
        await supabaseAdmin
          .from("profiles")
          .update({ credits_remaining: newBalance })
          .eq("id", userId);
          
        console.log(`✅ Solde mis à jour : ${newBalance}`);
      }
    }
  }

  return NextResponse.json({ received: true });
}