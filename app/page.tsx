"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useSearchParams } from "next/navigation";

// COMPOSANT FOMO (PREUVE SOCIALE)
const SocialProof = () => {
    const [notification, setNotification] = useState<string | null>(null);
    const messages = [
        "🍕 Une pizzeria à Lyon vient de générer un post TikTok",
        "💇‍♀️ Un salon de coiffure a acheté le Pack Pro",
        "🏠 Une agence immo à Bordeaux a généré 3 posts",
        "💎 Une bijouterie a rejoint Pictopost",
        "🍔 Un fast-food vient de poster sur Instagram",
        "🚀 Thomas a rechargé 30 crédits",
        "📸 Sarah vient d'uploader une photo"
    ];

    useEffect(() => {
        const trigger = () => {
            const randomMsg = messages[Math.floor(Math.random() * messages.length)];
            setNotification(randomMsg);
            setTimeout(() => setNotification(null), 5000); // Disparaît après 5s
        };
        // Apparaît toutes les 15 à 30 secondes
        const interval = setInterval(trigger, Math.random() * 15000 + 15000);
        setTimeout(trigger, 3000); // Premier trigger rapide
        return () => clearInterval(interval);
    }, []);

    if (!notification) return null;

    return (
        <div className="fixed bottom-6 left-6 z-50 bg-slate-900/90 border border-slate-700 p-4 rounded-xl shadow-2xl flex items-center gap-3 animate-slide-up max-w-xs backdrop-blur-md">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <p className="text-xs text-slate-200 font-medium">{notification}</p>
        </div>
    );
};

export default function Home() {
  // ... (Garde tous tes états existants ici : Auth, App, User, Config, UX) ...
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginPhone, setLoginPhone] = useState("");
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [base64Image, setBase64Image] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [profile, setProfile] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [logoUploading, setLogoUploading] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [hours, setHours] = useState("");
  const [tone, setTone] = useState("Standard");
  const [isDragging, setIsDragging] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  
  // Pour gérer le retour Stripe
  const searchParams = useSearchParams();

  const tones = [
    { id: "Standard", label: "🎯 Standard (Efficace)" },
    { id: "Luxe", label: "✨ Luxe & Prestige" },
    { id: "Promo", label: "🔥 Promo & Urgence" },
    { id: "Fun", label: "🤪 Humour & Décalé" },
    { id: "Storytelling", label: "📖 Storytelling" },
    { id: "Educatif", label: "💡 Éducatif / Astuce" },
    { id: "Influenceur", label: "🤳 Style Influenceur" },
  ];

  // --- EFFETS ---
  useEffect(() => {
    const storedPhone = localStorage.getItem("pictopost_phone");
    if (storedPhone) handleLogin(storedPhone, true);
    else setAuthLoading(false);

    // MESSAGE DE SUCCÈS STRIPE
    if (searchParams.get("success")) {
        alert("🎉 Paiement réussi ! Vos crédits ont été ajoutés.");
        // Nettoyer l'URL
        window.history.replaceState({}, document.title, "/");
    }
  }, []);

  // --- FONCTIONS EXISTANTES (Garde sanitizePhone, handleLogin, handleLogout, loadUserProfile, deductCredit, handleLogoUpload, compressImage, processFile, fetchHistory) ---
  // Je remets juste les fonctions modifiées ou clés ici :
  
  const sanitizePhone = (phone: string) => phone.replace(/[^0-9+]/g, '');

  const handleLogin = async (phoneInput: string, isAuto: boolean = false) => {
    const cleanPhone = sanitizePhone(phoneInput);
    if (!cleanPhone || cleanPhone.length < 8) { if(!isAuto) alert("Numéro invalide."); return; }
    if (!isAuto) setAuthLoading(true);
    try {
        const { data: existingUser } = await supabase.from('profiles').select('*').eq('whatsapp_number', cleanPhone).single();
        let userId = existingUser?.id;
        if (!existingUser) {
            const { data: newUser } = await supabase.from('profiles').insert([{ whatsapp_number: cleanPhone, credits_remaining: 5 }]).select().single();
            userId = newUser.id;
        }
        localStorage.setItem("pictopost_phone", cleanPhone);
        await loadUserProfile(userId);
        setIsLoggedIn(true);
    } catch (err: any) {
        console.error("Login Error", err);
        localStorage.removeItem("pictopost_phone");
    } finally { setAuthLoading(false); }
  };
  
  const handleLogout = () => { localStorage.removeItem("pictopost_phone"); setIsLoggedIn(false); setProfile(null); };

  const loadUserProfile = async (uid: string) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).single();
    if (data) {
      setProfile(data);
      if(data.business_name) setBusinessName(data.business_name);
      if(data.business_phone) setBusinessPhone(data.business_phone);
      if(data.business_city) setCity(data.business_city);
      if(data.business_address) setAddress(data.business_address);
      if(data.business_hours) setHours(data.business_hours);
      fetchHistory(data.id);
    }
  };

  const deductCredit = async () => {
    if (!profile) return;
    const newBalance = profile.credits_remaining - 1;
    setProfile({ ...profile, credits_remaining: newBalance });
    await supabase.from('profiles').update({ credits_remaining: newBalance }).eq('id', profile.id);
  };

  const generatePosts = async (b64: string) => {
    if (profile && profile.credits_remaining <= 0) { alert("Crédits épuisés."); setLoading(false); return; }
    setLoading(true);
    try {
      if (profile) await supabase.from('profiles').update({ business_name: businessName, business_phone: businessPhone, business_city: city, business_address: address, business_hours: hours }).eq('id', profile.id);
      const response = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageBase64: b64, city, tone, businessName, businessPhone, address, hours }) });
      if (!response.ok) throw new Error("Erreur IA");
      const data = await response.json();
      setResult(data);
      deductCredit();
      fetchHistory(profile.id);
    } catch (error: any) { alert("Erreur: " + error.message); } finally { setLoading(false); }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]; if (!file || !profile) return; setLogoUploading(true);
      const reader = new FileReader(); reader.readAsDataURL(file);
      reader.onload = async () => { try { const res = await fetch("/api/user/update-logo", { method: "POST", body: JSON.stringify({ userId: profile.id, logoBase64: reader.result }) }); if(res.ok) { const u = await res.json(); setProfile({ ...profile, logo_url: u.logo_url }); } } finally { setLogoUploading(false); } };
  };

  const compressImage = (file: File): Promise<string> => {
      return new Promise((r) => { const reader = new FileReader(); reader.readAsDataURL(file); reader.onload = (e) => { const img = new Image(); img.src = e.target?.result as string; img.onload = () => { const cvs = document.createElement("canvas"); const ctx = cvs.getContext("2d"); const MAX = 800; let w = img.width; let h = img.height; if (w > MAX) { h = h * (MAX/w); w = MAX; } cvs.width = w; cvs.height = h; ctx?.drawImage(img,0,0,w,h); r(cvs.toDataURL("image/jpeg", 0.6)); }; }; });
  };
  
  const processFile = async (file: File) => {
      if (!file || !file.type.startsWith("image/")) return;
      if (profile?.credits_remaining <= 0) { document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" }); return; }
      setImagePreview(URL.createObjectURL(file)); setResult(null); setLoading(true);
      const b64 = await compressImage(file); setBase64Image(b64); generatePosts(b64);
  };
  
  const fetchHistory = async (uid: string) => { const { data } = await supabase.from('draft_posts').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(6); if(data) setHistory(data); };

  // --- FONCTION PAIEMENT STRIPE (REMPLACE WHATSAPP) ---
  const handleStripeCheckout = async (priceId: string, credits: number) => {
    if (!profile) return alert("Erreur: Veuillez vous reconnecter.");
    
    // Feedback visuel immédiat
    const btn = document.activeElement as HTMLButtonElement;
    if(btn) btn.innerHTML = "⏳ Redirection...";

    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
            priceId: priceId, 
            userId: profile.id, 
            creditsAmount: credits 
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url; // Redirection vers Stripe
      } else {
        alert("Erreur lors de la création du paiement.");
      }
    } catch (error) {
      console.error(error);
      alert("Erreur de connexion au serveur de paiement.");
    }
  };

  // --- UTILS ---
  const copyToClipboard = (text: string, id: string) => { navigator.clipboard.writeText(text); setCopiedField(id); setTimeout(() => setCopiedField(null), 2000); };
  useEffect(() => { if (loading) { setProgress(0); const i = setInterval(() => { setProgress((p) => (p >= 90 ? p : p + 10)); }, 500); return () => clearInterval(i); } else { setProgress(100); } }, [loading]);
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files?.[0]; if (f) processFile(f); };
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) processFile(f); };
  
  const CopyBtn = ({ text, id }: { text: string, id: string }) => (<button onClick={() => copyToClipboard(text, id)} className={`flex items-center gap-2 px-3 py-1 rounded-md text-xs font-bold transition-all ${copiedField === id ? "bg-green-500 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"}`}>{copiedField === id ? "Copié !" : "📋 Copier le texte"}</button>);

  // --- RENDER ---
  if (authLoading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-orange-500"></div></div>;

  if (!isLoggedIn) {
    return (
        <main className="min-h-screen font-sans text-white bg-slate-950 flex flex-col items-center justify-center px-4 relative overflow-hidden">
            <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20"></div>
            <div className="relative z-10 max-w-md w-full bg-slate-900/50 backdrop-blur-xl p-8 rounded-3xl border border-slate-800 text-center">
                <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-br from-white via-orange-100 to-orange-400 mb-6">Pictopost</h1>
                <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">📞</div>
                <h2 className="text-2xl font-bold mb-2">Connexion</h2>
                <p className="text-slate-400 text-sm mb-6">Entrez votre numéro WhatsApp pour accéder à vos crédits.</p>
                <input type="tel" placeholder="06 12 34 56 78" value={loginPhone} onChange={(e) => setLoginPhone(e.target.value)} className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl py-4 px-6 text-center text-lg font-bold mb-4 outline-none focus:border-green-500 transition-all" />
                <button onClick={() => handleLogin(loginPhone)} className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-4 rounded-xl text-lg shadow-lg transition-all">🚀 Démarrer</button>
            </div>
        </main>
    );
  }

  return (
    <main className="min-h-screen font-sans text-white bg-slate-950 relative selection:bg-orange-500 selection:text-white pb-20">
      <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none"></div>
      
      {/* NOTIFICATION FOMO */}
      <SocialProof />

      {/* HEADER */}
      <div className="relative z-50 flex flex-col md:flex-row items-center justify-center gap-3 pt-6 px-4">
        <div onClick={() => document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" })} className={`border backdrop-blur-md px-4 py-2 rounded-full flex items-center gap-2 shadow-sm cursor-pointer transition-all ${profile?.credits_remaining <= 0 ? "bg-red-500/20 border-red-500 animate-pulse" : "bg-slate-900/80 border-slate-800"}`}>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{profile?.credits_remaining <= 0 ? "⚠️ RECHARGER" : "Crédits"}</span>
            <span className={`text-sm font-black ${profile?.credits_remaining > 0 ? 'text-orange-500' : 'text-white'}`}>{profile?.credits_remaining}</span>
        </div>
        <button onClick={handleLogout} className="bg-slate-900/80 border border-slate-800 px-3 py-2 rounded-full text-xs text-slate-500 hover:text-white">Déconnexion</button>
      </div>

      <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 relative z-10">
        <div className="text-center mb-10">
          <h1 className="text-6xl md:text-8xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-white via-orange-100 to-orange-400">Pictopost</h1>
        </div>

        {/* ALERTE CRÉDIT */}
        {profile?.credits_remaining <= 0 && !loading && (
            <div className="max-w-xl mx-auto mb-8 bg-red-500/10 border border-red-500/50 p-4 rounded-2xl text-center cursor-pointer" onClick={() => document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" })}>
                <h3 className="text-red-400 font-bold text-sm">🚫 Crédits épuisés. Cliquez ici pour recharger.</h3>
            </div>
        )}

        {/* CONFIG & UPLOAD (Reste identique à V3, je simplifie pour la lisibilité) */}
        {!result && !loading && profile && (
          <div className="max-w-3xl mx-auto mb-10 bg-slate-900/50 backdrop-blur-md p-8 rounded-3xl border border-slate-800 shadow-2xl animate-fade-in-up">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8 text-left">
                <div><label className="text-slate-400 text-xs font-bold mb-2 uppercase block">🏢 Nom du commerce</label><input type="text" placeholder="Ex: Le Braisé d'Or..." value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl py-3 px-4 outline-none focus:border-orange-500" /></div>
                <div><label className="text-slate-400 text-xs font-bold mb-2 uppercase block">☎️ Tél Commerce (Public)</label><input type="text" placeholder="Pour les clients..." value={businessPhone} onChange={(e) => setBusinessPhone(e.target.value)} className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl py-3 px-4 outline-none focus:border-orange-500" /></div>
                <div className="md:col-span-2">
                    <label className="text-slate-400 text-xs font-bold mb-2 uppercase block">✨ Objectif</label>
                    <select value={tone} onChange={(e) => setTone(e.target.value)} className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl py-3 px-4 outline-none focus:border-orange-500 cursor-pointer">
                        {tones.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                </div>
                <div><label className="text-slate-400 text-xs font-bold mb-2 uppercase block">📍 Ville</label><input type="text" placeholder="Ex: Lyon..." value={city} onChange={(e) => setCity(e.target.value)} className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl py-3 px-4 outline-none focus:border-orange-500" /></div>
            </div>

            <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} className={`relative border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer ${isDragging ? "border-orange-500 bg-orange-500/10 scale-105" : "border-slate-700 hover:border-orange-400/50 hover:bg-slate-800/50"}`}>
                <input type="file" accept="image/*" onChange={handleFileInput} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                <div className="flex flex-col items-center gap-4 pointer-events-none">
                    <div className="p-4 rounded-full bg-slate-800 text-4xl shadow-lg">📸</div>
                    <p className="text-lg font-bold">Cliquez ou glissez une photo</p>
                    <p className="text-xs text-slate-500 uppercase tracking-widest font-mono">1 Crédit / Génération</p>
                </div>
            </div>
          </div>
        )}

        {loading && imagePreview && (
           <div className="max-w-xl mx-auto flex flex-col items-center justify-center mt-8 bg-slate-900/50 p-8 rounded-3xl border border-slate-800 animate-fade-in-up">
             <div className="relative mb-6 w-32 h-32"><img src={imagePreview} className="w-full h-full object-cover rounded-xl border-2 border-slate-700 opacity-50" /><div className="absolute inset-0 flex items-center justify-center"><div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-orange-500"></div></div></div>
             <p className="text-orange-400 mt-4 font-mono text-xs uppercase tracking-widest animate-pulse">Création des visuels...</p>
           </div>
        )}

        {/* --- MOCKUPS VISUELS (Identique V3, je condense pour la place) --- */}
        {result && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-10 items-start pb-10 text-left animate-slide-up">
            {/* TIKTOK */}
            <div className="bg-black border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
               <div className="p-4 flex justify-between items-center text-white border-b border-white/10"><span className="font-bold">TikTok</span><div className="flex gap-2"><div className="w-2 h-2 rounded-full bg-red-500"></div><div className="w-2 h-2 rounded-full bg-blue-500"></div></div></div>
               <div className="relative aspect-[9/16] bg-slate-900">
                  <img src={imagePreview!} className="w-full h-full object-cover opacity-90" />
                  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[80%]"><span className="bg-white/90 text-black px-4 py-2 font-black text-xl text-center block rounded-lg shadow-lg rotate-[-2deg]">{result.tiktok.hook}</span></div>
                  <div className="absolute bottom-0 left-0 w-full p-4 bg-gradient-to-t from-black via-black/50 to-transparent"><p className="text-white font-bold text-sm mb-1">@{businessName.replace(/\s/g, '').toLowerCase()}</p><p className="text-xs text-white/90 line-clamp-3">{result.tiktok.caption}</p></div>
               </div>
               <div className="p-4 bg-slate-900 border-t border-slate-800 flex justify-between items-center"><CopyBtn text={`${result.tiktok.hook}\n\n${result.tiktok.caption}`} id="tiktok" /></div>
            </div>
            {/* INSTA */}
            <div className="bg-white text-black rounded-3xl overflow-hidden shadow-2xl border border-slate-700">
               <div className="p-3 flex items-center gap-2 border-b border-gray-100"><div className="w-8 h-8 bg-gray-200 rounded-full overflow-hidden">{profile?.logo_url ? <img src={profile.logo_url} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-gradient-to-tr from-yellow-400 to-purple-600"></div>}</div><div><p className="text-xs font-bold">{businessName || "votre_commerce"}</p></div></div>
               <div className="aspect-square bg-gray-100"><img src={imagePreview!} className="w-full h-full object-cover" /></div>
               <div className="px-3 pb-4 pt-4"><p className="text-xs text-gray-800 leading-relaxed whitespace-pre-line"><span className="font-bold mr-1">{businessName || "user"}</span>{result.instagram.caption}</p><p className="text-[10px] text-blue-800 mt-1">{result.instagram.hashtags}</p></div>
               <div className="p-3 bg-gray-50 border-t border-gray-100 flex justify-end"><CopyBtn text={`${result.instagram.caption}\n\n${result.instagram.hashtags}`} id="insta" /></div>
            </div>
            {/* FB */}
            <div className="bg-[#18191A] text-white border border-slate-700 rounded-3xl overflow-hidden shadow-2xl">
               <div className="p-4 flex gap-3 items-center"><div className="w-10 h-10 bg-slate-700 rounded-full overflow-hidden border border-white/10">{profile?.logo_url ? <img src={profile.logo_url} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-blue-600 flex items-center justify-center font-bold">F</div>}</div><div><h4 className="font-bold text-sm text-white">{businessName || "Votre Page"}</h4></div></div>
               <div className="px-4 pb-2"><p className="text-sm text-gray-200 whitespace-pre-line leading-relaxed">{result.google.caption}</p></div>
               <div className="w-full aspect-video bg-black mt-2"><img src={imagePreview!} className="w-full h-full object-cover" /></div>
               <div className="p-3 bg-black/30 flex justify-end"><CopyBtn text={result.google.caption} id="fb" /></div>
            </div>
          </div>
        )}

        {result && (
            <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 flex gap-4 bg-slate-900/90 backdrop-blur-xl p-2 rounded-full border border-slate-700 shadow-2xl z-50">
                <button onClick={() => { setResult(null); setImagePreview(null); setBase64Image(null); }} className="px-6 py-3 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-all font-bold text-sm flex items-center gap-2"><span>🗑️</span> Nouvelle</button>
                <button onClick={() => generatePosts(base64Image!)} className="px-6 py-3 rounded-full bg-orange-600 hover:bg-orange-500 text-white transition-all font-bold text-sm flex items-center gap-2"><span>🔄</span> Régénérer (1 Crédit)</button>
            </div>
        )}

        {/* --- TARIFS AUTOMATISÉS (STRIPE) --- */}
        <div id="pricing" className="mt-24 mb-20 text-center animate-fade-in-up">
            <h3 className="text-3xl font-black text-white mb-2">Recharger mes crédits 💎</h3>
            <p className="text-slate-400 mb-10">Paiement sécurisé. Activation immédiate.</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
                {/* PACK ESSAI */}
                <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 hover:border-slate-600 transition-all flex flex-col">
                    <div className="mb-4"><span className="bg-slate-800 text-slate-300 px-3 py-1 rounded-full text-xs font-bold uppercase">Découverte</span></div>
                    <h4 className="text-4xl font-black text-white mb-2">9,90€</h4>
                    <p className="text-orange-400 font-bold mb-6">20 Crédits</p>
                    <p className="text-sm text-slate-400 mb-8 flex-1">~0,50€ par post. Idéal pour tester.</p>
                    {/* METTRE TON PRICE ID ICI 👇 */}
                    <button onClick={() => handleStripeCheckout('price_1Su8ehDudJ7ge6mUAywi6UjK', 20)} className="w-full py-3 rounded-xl border border-slate-700 hover:bg-slate-800 text-white font-bold transition-all">Choisir</button>
                </div>

                {/* PACK ENTREPRENEUR */}
                <div className="bg-gradient-to-b from-slate-800 to-slate-900 border border-orange-500/50 rounded-3xl p-6 transform scale-105 shadow-2xl relative flex flex-col">
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-orange-500 text-white px-4 py-1 rounded-full text-xs font-bold uppercase shadow-lg">Meilleure Vente</div>
                    <h4 className="text-4xl font-black text-white mb-2 mt-4">29,00€</h4>
                    <p className="text-orange-400 font-bold mb-6">100 Crédits</p>
                    <p className="text-sm text-slate-300 mb-8 flex-1">~0,29€ par post. Le choix des pros.</p>
                    {/* METTRE TON PRICE ID ICI 👇 */}
                    <button onClick={() => handleStripeCheckout('price_1Su8f2DudJ7ge6mUcZoukwWI', 100)} className="w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold transition-all shadow-lg">Choisir ce pack</button>
                </div>

                {/* PACK AGENCE */}
                <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 hover:border-slate-600 transition-all flex flex-col">
                    <div className="mb-4"><span className="bg-slate-800 text-slate-300 px-3 py-1 rounded-full text-xs font-bold uppercase">Agence</span></div>
                    <h4 className="text-4xl font-black text-white mb-2">69,00€</h4>
                    <p className="text-orange-400 font-bold mb-6">300 Crédits</p>
                    <p className="text-sm text-slate-400 mb-8 flex-1">~0,23€ par post. Volume intensif.</p>
                    {/* METTRE TON PRICE ID ICI 👇 */}
                    <button onClick={() => handleStripeCheckout('price_1Su8fGDudJ7ge6mUOCYBUhfh', 300)} className="w-full py-3 rounded-xl border border-slate-700 hover:bg-slate-800 text-white font-bold transition-all">Choisir</button>
                </div>
            </div>
            <p className="text-xs text-slate-500 mt-8">Paiement sécurisé par Stripe. Facture envoyée par email.</p>
        </div>

      </div>
    </main>
  );
}