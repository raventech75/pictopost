import { NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: Request) {
  try {
    const { priceId, userId, creditsAmount } = await req.json();

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "payment",
      success_url: `${process.env.NEXT_PUBLIC_URL}?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_URL}?canceled=true`,
      // C'EST ICI QUE TOUT SE JOUE : On attache l'ID user et le montant de crédits à la transaction
      metadata: {
        userId: userId,
        creditsToAdd: creditsAmount.toString(),
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}