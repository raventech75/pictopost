"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

export default function Home() {
  // =================================================================================
  // 1. ÉTATS
  // =================================================================================
  
  // Login / Auth
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginPhone, setLoginPhone] = useState("");
  const [authLoading, setAuthLoading] = useState(true); // Pour le chargement initial

  // App States
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [base64Image, setBase64Image] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  // User Data
  const [profile, setProfile] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [logoUploading, setLogoUploading] = useState(false);

  // Config
  const [businessName, setBusinessName] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [hours, setHours] = useState("");
  const [tone, setTone] = useState("Standard");

  // UX
  const [isDragging, setIsDragging] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // LISTE DES OBJECTIFS
  const tones = [
    { id: "Standard", label: "🎯 Standard (Efficace)" },
    { id: "Luxe", label: "✨ Luxe & Prestige (Immo/Bijoux)" },
    { id: "Promo", label: "🔥 Promo & Urgence (-50%)" },
    { id: "Fun", label: "🤪 Humour & Décalé (Resto/Bar)" },
    { id: "Storytelling", label: "📖 Storytelling (Artisan/Créateur)" },
    { id: "Educatif", label: "💡 Éducatif / Astuce (Coach/Expert)" },
    { id: "Influenceur", label: "🤳 Style Influenceur (Lifestyle)" },
    { id: "Minimaliste", label: "🌿 Minimaliste & Zen (Bien-être)" },
  ];

  // =================================================================================
  // 2. GESTION AUTHENTIFICATION (WHATSAPP WALL)
  // =================================================================================

  // Vérification au démarrage
  useEffect(() => {
    const storedPhone = localStorage.getItem("pictopost_phone");
    if (storedPhone) {
      handleLogin(storedPhone, true); // True = silencieux (auto-login)
    } else {
      setAuthLoading(false); // On affiche l'écran de login
    }
  }, []);

  // Nettoyer le numéro (enlève espaces, tirets, etc.)
  const sanitizePhone = (phone: string) => {
    return phone.replace(/[^0-9+]/g, '');
  };

  const handleLogin = async (phoneInput: string, isAuto: boolean = false) => {
    const cleanPhone = sanitizePhone(phoneInput);
    
    if (!cleanPhone || cleanPhone.length < 8) {
        if(!isAuto) alert("Veuillez entrer un numéro valide.");
        return;
    }

    if (!isAuto) setAuthLoading(true);

    try {
        // 1. On cherche si ce numéro existe déjà
        const { data: existingUser, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('whatsapp_number', cleanPhone)
            .single();

        let userId;

        if (existingUser) {
            // IL EXISTE : On le connecte
            console.log("Utilisateur trouvé :", existingUser.id);
            userId = existingUser.id;
        } else {
            // IL N'EXISTE PAS : On le crée
            console.log("Nouveau numéro, création du compte...");
            const { data: newUser, error: createError } = await supabase
                .from('profiles')
                .insert([
                    { 
                        whatsapp_number: cleanPhone,
                        credits_remaining: 5 // 🎁 5 CRÉDITS OFFERTS AU NOUVEAU NUMÉRO
                    }
                ])
                .select()
                .single();
            
            if (createError) throw createError;
            userId = newUser.id;
        }

        // 2. Sauvegarde locale et chargement
        localStorage.setItem("pictopost_phone", cleanPhone);
        await loadUserProfile(userId);
        setIsLoggedIn(true);

    } catch (err: any) {
        console.error("Erreur Login:", err);
        alert("Erreur de connexion : " + err.message);
        localStorage.removeItem("pictopost_phone"); // On nettoie si erreur
    } finally {
        setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("pictopost_phone");
    setIsLoggedIn(false);
    setProfile(null);
    setHistory([]);
    setLoginPhone("");
  };

  const loadUserProfile = async (uid: string) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).single();
    if (data) {
      setProfile(data);
      // On pré-remplit les champs si déjà sauvegardés
      if (data.business_name) setBusinessName(data.business_name);
      if (data.business_city) setCity(data.business_city);
      if (data.business_address) setAddress(data.business_address);
      if (data.business_hours) setHours(data.business_hours);
      fetchHistory(data.id);
    }
  };

  // =================================================================================
  // 3. FONCTIONS MÉTIER
  // =================================================================================

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file || !profile) return;
    setLogoUploading(true);
    const reader = new FileReader(); reader.readAsDataURL(file);
    reader.onload = async () => {
      try {
        const res = await fetch("/api/user/update-logo", { method: "POST", body: JSON.stringify({ userId: profile.id, logoBase64: reader.result }) });
        if(res.ok) {
            const updated = await res.json();
            setProfile({ ...profile, logo_url: updated.logo_url });
            alert("✅ Logo enregistré !");
        }
      } catch (err) { alert("Erreur upload"); } finally { setLogoUploading(false); }
    };
  };

  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader(); reader.readAsDataURL(file);
      reader.onload = (e) => {
        const img = new Image(); img.src = e.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement("canvas"); const ctx = canvas.getContext("2d");
          const MAX = 800; let w = img.width; let h = img.height;
          if (w > MAX) { h = h * (MAX / w); w = MAX; }
          canvas.width = w; canvas.height = h; ctx?.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.6));
        };
      };
    });
  };

  // ACHAT DE CRÉDITS
  const buyCredits = (packName: string, price: string) => {
    const monNumeroVendeur = "33612345678"; // ⚠️ METTRE TON NUMERO
    const message = `Bonjour, je souhaite acheter le ${packName} à ${price}. Mon numéro WhatsApp inscrit est : ${profile?.whatsapp_number}`;
    window.open(`https://wa.me/${monNumeroVendeur}?text=${encodeURIComponent(message)}`, "_blank");
  };

  const generatePosts = async (b64: string) => {
    if (profile && profile.credits_remaining <= 0) { 
        alert("⚠️ Crédits épuisés ! Regardez nos offres ci-dessous pour recharger."); 
        setLoading(false); 
        return; 
    }
    
    setLoading(true);
    try {
      if (profile) {
        await supabase.from('profiles').update({ 
            business_name: businessName, business_city: city, business_address: address, business_hours: hours 
        }).eq('id', profile.id);
      }

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: b64, city, tone, businessName, address, hours, userId: profile?.id }),
      });

      if (!response.ok) throw new Error("Erreur génération.");
      const data = await response.json(); 
      setResult(data);

      if (profile) {
          const { data: updated } = await supabase.from('profiles').select('*').eq('id', profile.id).single();
          if (updated) setProfile(updated);
          fetchHistory(profile.id);
      }
    } catch (error: any) { alert("Oups : " + error.message); } finally { setLoading(false); }
  };

  const processFile = async (file: File) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (profile && profile.credits_remaining <= 0) {
        document.getElementById("pricing-section")?.scrollIntoView({ behavior: "smooth" });
        return;
    }
    setImagePreview(URL.createObjectURL(file)); setResult(null); setLoading(true);
    const b64 = await compressImage(file); setBase64Image(b64); generatePosts(b64);
  };

  async function fetchHistory(uid: string) {
    const { data } = await supabase.from('draft_posts').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(6);
    if (data) setHistory(data);
  }

  // Utils
  useEffect(() => { if (loading) { setProgress(0); const i = setInterval(() => { setProgress((p) => (p >= 90 ? p : p + 10)); }, 500); return () => clearInterval(i); } else { setProgress(100); } }, [loading]);
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files?.[0]; if (f) processFile(f); };
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) processFile(f); };
  const copyToClipboard = (text: string, id: string) => { navigator.clipboard.writeText(text); setCopiedField(id); setTimeout(() => setCopiedField(null), 2000); };
  
  const CopyButton = ({ text, id }: { text: string, id: string }) => (
    <button onClick={() => copyToClipboard(text, id)} className="absolute top-2 right-2 p-2 rounded-lg bg-black/50 hover:bg-orange-500/80 text-white transition-all text-xs flex items-center gap-1 backdrop-blur-md border border-white/10 z-20">{copiedField === id ? <>✅</> : <>📋</>}</button>
  );

  // =================================================================================
  // 4. RENDU : ÉCRAN DE LOGIN VS APP
  // =================================================================================

  // ÉCRAN DE CHARGEMENT
  if (authLoading) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-orange-500"></div></div>;
  }

  // ÉCRAN DE LOGIN (WHATSAPP WALL)
  if (!isLoggedIn) {
    return (
        <main className="min-h-screen font-sans text-white relative overflow-hidden bg-slate-950 flex flex-col items-center justify-center px-4">
            <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 z-0"></div>
            <div className="absolute top-[-20%] left-[20%] w-[500px] h-[500px] rounded-full bg-orange-600/20 blur-[120px] pointer-events-none"></div>
            
            <div className="relative z-10 max-w-md w-full bg-slate-900/50 backdrop-blur-xl p-8 rounded-3xl border border-slate-800 shadow-2xl text-center">
                <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-br from-white via-orange-100 to-orange-400 mb-6">Pictopost</h1>
                
                <div className="mb-8">
                    <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">📞</div>
                    <h2 className="text-2xl font-bold mb-2">Connexion Rapide</h2>
                    <p className="text-slate-400 text-sm">Entrez votre numéro WhatsApp pour activer vos <span className="text-orange-400 font-bold">5 crédits offerts</span>.</p>
                </div>

                <div className="space-y-4">
                    <input 
                        type="tel" 
                        placeholder="Ex: 06 12 34 56 78" 
                        value={loginPhone}
                        onChange={(e) => setLoginPhone(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl py-4 px-6 text-center text-lg font-bold tracking-widest outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition-all placeholder:font-normal placeholder:tracking-normal"
                    />
                    <button 
                        onClick={() => handleLogin(loginPhone)}
                        className="w-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-400 hover:to-green-500 text-white font-bold py-4 rounded-xl text-lg shadow-lg transition-all transform hover:scale-[1.02]"
                    >
                        🚀 Démarrer Gratuitement
                    </button>
                    <p className="text-[10px] text-slate-500 mt-4">Nous utilisons ce numéro uniquement pour sauvegarder vos crédits.</p>
                </div>
            </div>
        </main>
    );
  }

  // APP PRINCIPALE
  return (
    <main className="min-h-screen font-sans text-white relative overflow-hidden bg-slate-950 selection:bg-orange-500 selection:text-white pb-20">
      <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 z-0"></div>

      {/* HEADER */}
      <div className="relative z-50 flex flex-col md:flex-row items-center justify-center gap-3 pt-6 px-4">
        {profile ? (
          <>
            <div className="flex gap-2">
                <div 
                    onClick={() => document.getElementById("pricing-section")?.scrollIntoView({ behavior: "smooth" })}
                    className={`border backdrop-blur-md px-4 py-2 rounded-full flex items-center gap-2 shadow-sm cursor-pointer transition-all ${profile.credits_remaining <= 0 ? "bg-red-500/20 border-red-500 hover:bg-red-500/40 animate-pulse" : "bg-slate-900/80 border-slate-800"}`}
                >
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      {profile.credits_remaining <= 0 ? "⚠️ RECHARGER" : "Crédits"}
                  </span>
                  <span className={`text-sm font-black ${profile.credits_remaining > 0 ? 'text-orange-500' : 'text-white'}`}>
                    {profile.credits_remaining}
                  </span>
                </div>
                
                <button onClick={handleLogout} className="bg-slate-900/80 border border-slate-800 px-3 py-2 rounded-full text-xs text-slate-500 hover:text-white transition-all">
                    Déconnexion
                </button>
            </div>
            
            <label className="cursor-pointer bg-slate-900/80 border border-slate-800 px-4 py-2 rounded-full text-xs font-bold hover:border-orange-500 transition-all flex items-center gap-2 backdrop-blur-md shadow-sm">
              <span>{logoUploading ? "⏳..." : profile.logo_url ? "✅ Logo OK" : "🖼️ Mon Logo"}</span>
              <input type="file" onChange={handleLogoUpload} className="hidden" accept="image/*" />
            </label>
          </>
        ) : (
          <div className="animate-pulse flex gap-4"><div className="h-9 w-24 bg-slate-800 rounded-full"></div></div>
        )}
      </div>

      <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 relative z-10">
        <div className="text-center mb-10 space-y-4">
          <h1 className="text-6xl md:text-8xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-white via-orange-100 to-orange-400">Pictopost</h1>
          <p className="text-xl text-slate-400 max-w-2xl mx-auto font-light italic">Votre Assistant Social Media IA.</p>
        </div>

        {/* ALERTE CRÉDITS */}
        {profile && profile.credits_remaining <= 0 && !loading && (
            <div className="max-w-xl mx-auto mb-8 bg-red-500/10 border border-red-500/50 p-4 rounded-2xl text-center">
                <h3 className="text-red-400 font-bold text-sm mb-1">🚫 Crédits épuisés</h3>
                <p className="text-slate-400 text-xs cursor-pointer underline" onClick={() => document.getElementById("pricing-section")?.scrollIntoView({ behavior: "smooth" })}>Voir les offres de recharge ↓</p>
            </div>
        )}

        {/* FORMULAIRE & UPLOAD */}
        {!result && !loading && profile && (
          <div className="max-w-3xl mx-auto mb-10 bg-slate-900/50 backdrop-blur-md p-8 rounded-3xl border border-slate-800 shadow-2xl animate-fade-in-up">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8 text-left">
                <div className="md:col-span-2">
                     <label className="text-slate-400 text-xs font-bold mb-2 uppercase block">🏢 Nom du commerce</label>
                     <input type="text" placeholder="Ex: Le Braisé d'Or..." value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl py-3 px-4 outline-none focus:border-orange-500 transition-all" />
                </div>
                <div className="md:col-span-2">
                    <label className="text-slate-400 text-xs font-bold mb-2 uppercase block">✨ Objectif & Ton</label>
                    <select value={tone} onChange={(e) => setTone(e.target.value)} className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl py-3 px-4 outline-none focus:border-orange-500 cursor-pointer appearance-none">
                        {tones.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                </div>
                <div>
                    <label className="text-slate-400 text-xs font-bold mb-2 uppercase block">📍 Ville</label>
                    <input type="text" placeholder="Ex: Lyon..." value={city} onChange={(e) => setCity(e.target.value)} className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl py-3 px-4 outline-none focus:border-orange-500" />
                </div>
                <div>
                    <label className="text-slate-400 text-xs font-bold mb-2 uppercase block">🏠 Adresse / Infos</label>
                    <input type="text" placeholder="12 rue de la Paix..." value={address} onChange={(e) => setAddress(e.target.value)} className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl py-3 px-4 outline-none focus:border-orange-500" />
                </div>
            </div>

            <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} className={`relative border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer ${isDragging ? "border-orange-500 bg-orange-500/10 scale-105" : "border-slate-700 hover:border-orange-400/50 hover:bg-slate-800/50"}`}>
                <input type="file" accept="image/*" onChange={handleFileInput} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                <div className="flex flex-col items-center gap-4 pointer-events-none">
                    <div className="p-4 rounded-full bg-slate-800 text-4xl shadow-lg">📸</div>
                    <p className="text-lg font-bold">Cliquez ou glissez une photo ici</p>
                    <p className="text-xs text-slate-500 uppercase tracking-widest font-mono">Coût : 1 crédit / image</p>
                </div>
            </div>
          </div>
        )}

        {/* LOADER */}
        {loading && imagePreview && (
           <div className="max-w-xl mx-auto flex flex-col items-center justify-center mt-8 bg-slate-900/50 p-8 rounded-3xl border border-slate-800 animate-fade-in-up">
             <div className="relative mb-6 w-32 h-32">
               <img src={imagePreview} className="w-full h-full object-cover rounded-xl border-2 border-slate-700 opacity-50" />
               <div className="absolute inset-0 flex items-center justify-center"><div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-orange-500"></div></div>
             </div>
             <p className="text-orange-400 mt-4 font-mono text-xs uppercase tracking-widest animate-pulse">L'IA analyse votre image...</p>
           </div>
        )}

        {/* RÉSULTATS */}
        {result && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-10 items-start pb-10 text-left animate-slide-up">
            <div className="group bg-black border border-slate-800 rounded-3xl overflow-hidden hover:border-slate-700 transition-colors">
              <div className="h-1 bg-gradient-to-r from-pink-500 to-yellow-500"></div>
              <div className="p-5">
                 <h2 className="font-bold mb-4 flex items-center gap-2"><span className="text-xl">🎵</span> TikTok</h2>
                 <p className="text-sm text-slate-300 whitespace-pre-line mb-4 leading-relaxed">{result.tiktok.caption}</p>
                 <CopyButton text={result.tiktok.caption} id="tiktok" />
              </div>
            </div>
            <div className="group bg-gradient-to-b from-slate-900 to-black border border-slate-800 rounded-3xl overflow-hidden hover:border-slate-700 transition-colors">
              <div className="h-1 bg-gradient-to-r from-orange-400 to-purple-600"></div>
              <div className="p-5">
                 <h2 className="font-bold mb-4 flex items-center gap-2"><span className="text-xl">📸</span> Insta</h2>
                 <p className="text-sm text-slate-300 whitespace-pre-line mb-4 leading-relaxed">{result.instagram.caption}</p>
                 <CopyButton text={result.instagram.caption} id="insta" />
              </div>
            </div>
            <div className="group bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden hover:border-slate-700 transition-colors">
               <div className="h-1 bg-blue-600"></div>
               <div className="p-5">
                 <h2 className="font-bold mb-4 flex items-center gap-2"><span className="text-xl">📍</span> Facebook</h2>
                 <p className="text-sm text-slate-300 whitespace-pre-line mb-4 leading-relaxed">{result.google.caption}</p>
                 <CopyButton text={result.google.caption} id="google" />
               </div>
            </div>
          </div>
        )}

        {/* BARRE D'ACTION */}
        {result && (
            <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 flex gap-4 bg-slate-900/90 backdrop-blur-xl p-2 rounded-full border border-slate-700 shadow-2xl z-50">
                <button 
                  onClick={() => { setResult(null); setImagePreview(null); setBase64Image(null); }} 
                  className="px-6 py-3 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-all font-bold text-sm flex items-center gap-2"
                >
                    <span>🗑️</span> Nouvelle Photo
                </button>
                <button 
                  onClick={() => generatePosts(base64Image!)} 
                  className="px-6 py-3 rounded-full bg-orange-600 hover:bg-orange-500 text-white transition-all font-bold text-sm flex items-center gap-2"
                  title="Coûte 1 crédit"
                >
                    <span>🔄</span> Régénérer (1 Crédit)
                </button>
            </div>
        )}

        {/* --- SECTION TARIFS --- */}
        <div id="pricing-section" className="mt-24 mb-20 text-center animate-fade-in-up">
            <h3 className="text-3xl font-black text-white mb-2">Recharger mes crédits 💎</h3>
            <p className="text-slate-400 mb-10">Pas d'abonnement caché. Payez seulement ce que vous utilisez.</p>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
                {/* PACK DÉCOUVERTE */}
                <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 hover:border-slate-600 transition-all flex flex-col">
                    <div className="mb-4"><span className="bg-slate-800 text-slate-300 px-3 py-1 rounded-full text-xs font-bold uppercase">Découverte</span></div>
                    <h4 className="text-4xl font-black text-white mb-2">9,90€</h4>
                    <p className="text-orange-400 font-bold mb-6">20 Crédits</p>
                    <ul className="text-sm text-slate-400 space-y-3 mb-8 flex-1 text-left px-4">
                        <li className="flex gap-2"><span>✅</span> ~0,50€ par post</li>
                        <li className="flex gap-2"><span>✅</span> Validité à vie</li>
                        <li className="flex gap-2"><span>✅</span> Support Email</li>
                    </ul>
                    <button onClick={() => buyCredits('Pack Découverte 20 Crédits', '9,90€')} className="w-full py-3 rounded-xl border border-slate-700 hover:bg-slate-800 text-white font-bold transition-all">Choisir</button>
                </div>

                {/* PACK POPULAIRE */}
                <div className="bg-gradient-to-b from-slate-800 to-slate-900 border border-orange-500/50 rounded-3xl p-6 transform scale-105 shadow-2xl relative flex flex-col">
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-orange-500 text-white px-4 py-1 rounded-full text-xs font-bold uppercase shadow-lg">Le plus vendu</div>
                    <h4 className="text-4xl font-black text-white mb-2 mt-4">29,00€</h4>
                    <p className="text-orange-400 font-bold mb-6">100 Crédits</p>
                    <ul className="text-sm text-slate-300 space-y-3 mb-8 flex-1 text-left px-4">
                        <li className="flex gap-2"><span>🔥</span> <b>~0,29€ par post</b> (Top rentabilité)</li>
                        <li className="flex gap-2"><span>✅</span> Idéal pour poster 3x/semaine</li>
                        <li className="flex gap-2"><span>✅</span> Support Prioritaire</li>
                    </ul>
                    <button onClick={() => buyCredits('Pack Pro 100 Crédits', '29,00€')} className="w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold transition-all shadow-lg">Choisir ce pack</button>
                </div>

                {/* PACK AGENCE */}
                <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 hover:border-slate-600 transition-all flex flex-col">
                    <div className="mb-4"><span className="bg-slate-800 text-slate-300 px-3 py-1 rounded-full text-xs font-bold uppercase">Intensif</span></div>
                    <h4 className="text-4xl font-black text-white mb-2">99,00€</h4>
                    <p className="text-orange-400 font-bold mb-6">500 Crédits</p>
                    <ul className="text-sm text-slate-400 space-y-3 mb-8 flex-1 text-left px-4">
                        <li className="flex gap-2"><span>✅</span> ~0,19€ par post</li>
                        <li className="flex gap-2"><span>✅</span> Pour les Agences / Quotidien</li>
                        <li className="flex gap-2"><span>✅</span> Analyse de logo incluse</li>
                    </ul>
                    <button onClick={() => buyCredits('Pack Agence 500 Crédits', '99,00€')} className="w-full py-3 rounded-xl border border-slate-700 hover:bg-slate-800 text-white font-bold transition-all">Choisir</button>
                </div>
            </div>
        </div>

      </div>
    </main>
  );
}