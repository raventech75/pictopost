"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

export default function Home() {
  // =================================================================================
  // 1. ÉTATS
  // =================================================================================
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [base64Image, setBase64Image] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  // User
  const [profile, setProfile] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [logoUploading, setLogoUploading] = useState(false);

  // Champs Configuration
  const [businessName, setBusinessName] = useState("");
  const [whatsapp, setWhatsapp] = useState(""); // NOUVEAU : Numéro du client
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [hours, setHours] = useState("");
  const [tone, setTone] = useState("Standard");

  // UX
  const [isDragging, setIsDragging] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [emailCopied, setEmailCopied] = useState(false);

  const tones = [
    { id: "Standard", label: "🎯 Standard" },
    { id: "Luxe & Pro", label: "✨ Luxe" },
    { id: "Fun & Cool", label: "🤪 Fun" },
    { id: "Urgence", label: "🔥 Promo" },
  ];

  // =================================================================================
  // 2. GESTION UTILISATEUR
  // =================================================================================

  useEffect(() => {
    const localId = localStorage.getItem("pictopost_user_id");
    if (localId) loadUserProfile(localId);
    else createGuestUser();
  }, []);

  const createGuestUser = async () => {
    try {
      const { data } = await supabase
        .from('profiles')
        .insert([{ credits_remaining: 5 }]) // ICI : ON MET 5 CRÉDITS AU DÉMARRAGE
        .select()
        .single();

      if (data) {
        localStorage.setItem("pictopost_user_id", data.id);
        loadUserProfile(data.id);
      }
    } catch (error) {
      console.error("Erreur création user", error);
    }
  };

  const loadUserProfile = async (uid: string) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).single();
    if (data) {
      setProfile(data);
      if (data.business_name) setBusinessName(data.business_name);
      if (data.whatsapp_number) setWhatsapp(data.whatsapp_number); // On charge son numéro
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
          canvas.width = w; canvas.height = h;
          ctx?.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.6));
        };
      };
    });
  };

  // Redirection vers TON WhatsApp pour acheter des crédits
  const handleRecharge = () => {
    // Remplace par TON numéro à toi pour recevoir les demandes
    const monNumeroVendeur = "33612345678"; 
    const message = `Bonjour, je souhaite recharger mon compte Pictopost (ID: ${profile?.id}). Quelles sont les formules ?`;
    window.open(`https://wa.me/${monNumeroVendeur}?text=${encodeURIComponent(message)}`, "_blank");
  };

  const generatePosts = async (b64: string) => {
    // VÉRIFICATION CRÉDITS
    if (profile && profile.credits_remaining <= 0) { 
        alert("⚠️ Vous n'avez plus de crédits ! Cliquez sur 'Recharger' pour continuer."); 
        setLoading(false); 
        return; 
    }
    
    setLoading(true);
    try {
      // SAUVEGARDE DES INFOS (Y compris le WhatsApp du client)
      if (profile) {
        await supabase.from('profiles').update({ 
            business_name: businessName, 
            whatsapp_number: whatsapp, // On sauvegarde son numéro
            business_city: city, 
            business_address: address, 
            business_hours: hours 
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
    // Si pas de crédits, on bloque tout de suite
    if (profile && profile.credits_remaining <= 0) {
        alert("⚠️ Crédits épuisés. Veuillez recharger.");
        return;
    }
    setImagePreview(URL.createObjectURL(file)); setResult(null); setLoading(true);
    const b64 = await compressImage(file); setBase64Image(b64); generatePosts(b64);
  };

  async function fetchHistory(uid: string) {
    const { data } = await supabase.from('draft_posts').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(6);
    if (data) setHistory(data);
  }

  // UX Utils
  useEffect(() => { if (loading) { setProgress(0); const i = setInterval(() => { setProgress((p) => (p >= 90 ? p : p + 10)); }, 500); return () => clearInterval(i); } else { setProgress(100); } }, [loading]);
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files?.[0]; if (f) processFile(f); };
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) processFile(f); };
  const copyToClipboard = (text: string, id: string) => { navigator.clipboard.writeText(text); setCopiedField(id); setTimeout(() => setCopiedField(null), 2000); };
  const copyEmail = () => { navigator.clipboard.writeText("raventech75@gmail.com"); setEmailCopied(true); setTimeout(() => setEmailCopied(false), 2000); };

  const CopyButton = ({ text, id }: { text: string, id: string }) => (
    <button onClick={() => copyToClipboard(text, id)} className="absolute top-2 right-2 p-2 rounded-lg bg-black/50 hover:bg-orange-500/80 text-white transition-all text-xs flex items-center gap-1 backdrop-blur-md border border-white/10 z-20">{copiedField === id ? <>✅</> : <>📋</>}</button>
  );

  return (
    <main className="min-h-screen font-sans text-white relative overflow-hidden bg-slate-950 selection:bg-orange-500 selection:text-white">
      <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 z-0"></div>

      {/* HEADER (Crédits + Logo) */}
      <div className="relative z-50 flex flex-col md:flex-row items-center justify-center gap-3 pt-6 px-4">
        {profile ? (
          <>
            <div 
                onClick={profile.credits_remaining <= 0 ? handleRecharge : undefined}
                className={`border backdrop-blur-md px-4 py-2 rounded-full flex items-center gap-2 shadow-sm cursor-pointer transition-all ${profile.credits_remaining <= 0 ? "bg-red-500/20 border-red-500 hover:bg-red-500/40 animate-pulse" : "bg-slate-900/80 border-slate-800"}`}
            >
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  {profile.credits_remaining <= 0 ? "⚠️ RECHARGER" : "Crédits"}
              </span>
              <span className={`text-sm font-black ${profile.credits_remaining > 0 ? 'text-orange-500' : 'text-white'}`}>
                {profile.credits_remaining}
              </span>
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

      <button onClick={() => setShowFeedback(true)} className="fixed bottom-6 right-6 z-50 bg-slate-900 border border-slate-700 hover:border-orange-500 text-slate-300 hover:text-white px-4 py-2 rounded-full text-sm font-bold shadow-xl transition-all">📩 Contact</button>

      {showFeedback && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
            <div className="bg-slate-900 border border-slate-700 rounded-3xl p-8 max-w-md w-full relative text-center text-white">
                <button onClick={() => setShowFeedback(false)} className="absolute top-4 right-4 text-slate-500 hover:text-white">✕</button>
                <h2 className="text-2xl font-bold mb-4">Contact</h2>
                <div className="bg-black/50 border border-slate-800 rounded-xl p-4 flex gap-4 mb-6 items-center justify-center"><span className="text-orange-400 font-mono text-sm font-bold">raventech75@gmail.com</span><button onClick={copyEmail} className="bg-slate-800 text-white px-3 py-1 rounded text-xs hover:bg-slate-700">{emailCopied ? "Copié !" : "Copier"}</button></div>
                <button onClick={() => setShowFeedback(false)} className="text-slate-500 hover:text-white text-sm underline">Fermer</button>
            </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 relative z-10">
        <div className="text-center mb-10 space-y-4">
          <h1 className="text-6xl md:text-8xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-white via-orange-100 to-orange-400">Pictopost</h1>
          <p className="text-xl text-slate-400 max-w-2xl mx-auto font-light italic">Votre Assistant Social Media IA.</p>
        </div>

        {/* ALERTE CRÉDITS ÉPUISÉS */}
        {profile && profile.credits_remaining <= 0 && !loading && (
            <div className="max-w-xl mx-auto mb-8 bg-red-500/10 border border-red-500/50 p-6 rounded-2xl text-center animate-bounce-short">
                <h3 className="text-red-400 font-bold text-lg mb-2">🚫 Crédits épuisés</h3>
                <p className="text-slate-300 text-sm mb-4">Vous avez utilisé vos 5 crédits offerts. Rechargez pour continuer à générer des posts viraux.</p>
                <button 
                    onClick={handleRecharge}
                    className="bg-red-500 hover:bg-red-600 text-white px-8 py-3 rounded-xl font-bold transition-all shadow-lg"
                >
                    💎 Recharger mes crédits
                </button>
            </div>
        )}

        {!result && !loading && profile && profile.credits_remaining > 0 && (
          <div className="max-w-3xl mx-auto mb-10 bg-slate-900/50 backdrop-blur-md p-8 rounded-3xl border border-slate-800 shadow-2xl animate-fade-in-up">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8 text-left">
                {/* NOM COMMERCE */}
                <div className="md:col-span-1">
                     <label className="text-slate-400 text-xs font-bold mb-2 uppercase block">🏢 Nom du commerce</label>
                     <input type="text" placeholder="Ex: Le Braisé d'Or..." value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl py-3 px-4 outline-none focus:border-orange-500 transition-all" />
                </div>
                {/* WHATSAPP CLIENT (Nouveau) */}
                <div className="md:col-span-1">
                     <label className="text-slate-400 text-xs font-bold mb-2 uppercase block">📞 Votre WhatsApp (Optionnel)</label>
                     <input type="text" placeholder="Ex: 06 12 34..." value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl py-3 px-4 outline-none focus:border-orange-500 transition-all" />
                </div>

                <div>
                    <label className="text-slate-400 text-xs font-bold mb-2 uppercase block">📍 Ville</label>
                    <input type="text" placeholder="Ex: Lyon..." value={city} onChange={(e) => setCity(e.target.value)} className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl py-3 px-4 outline-none focus:border-orange-500" />
                </div>
                <div>
                    <label className="text-slate-400 text-xs font-bold mb-2 uppercase block">🎭 Objectif</label>
                    <select value={tone} onChange={(e) => setTone(e.target.value)} className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl py-3 px-4 outline-none focus:border-orange-500 cursor-pointer">
                        {tones.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                </div>
                <div>
                    <label className="text-slate-400 text-xs font-bold mb-2 uppercase block">🏠 Adresse (Optionnel)</label>
                    <input type="text" placeholder="12 rue de la Paix..." value={address} onChange={(e) => setAddress(e.target.value)} className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl py-3 px-4 outline-none focus:border-orange-500" />
                </div>
                <div>
                    <label className="text-slate-400 text-xs font-bold mb-2 uppercase block">🕒 Horaires (Optionnel)</label>
                    <input type="text" placeholder="9h-19h..." value={hours} onChange={(e) => setHours(e.target.value)} className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl py-3 px-4 outline-none focus:border-orange-500" />
                </div>
            </div>

            <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} className={`relative border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer ${isDragging ? "border-orange-500 bg-orange-500/10 scale-105" : "border-slate-700 hover:border-orange-400/50 hover:bg-slate-800/50"}`}>
                <input type="file" accept="image/*" onChange={handleFileInput} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                <div className="flex flex-col items-center gap-4 pointer-events-none">
                    <div className="p-4 rounded-full bg-slate-800 text-4xl shadow-lg">📸</div>
                    <p className="text-lg font-bold">Cliquez ou glissez une photo ici</p>
                    <p className="text-xs text-slate-500">Coût: 1 crédit</p>
                </div>
            </div>
          </div>
        )}

        {loading && imagePreview && (
           <div className="max-w-xl mx-auto flex flex-col items-center justify-center mt-8 bg-slate-900/50 p-8 rounded-3xl border border-slate-800 animate-fade-in-up">
             <div className="relative mb-6 w-32 h-32">
               <img src={imagePreview} className="w-full h-full object-cover rounded-xl border-2 border-slate-700 opacity-50" />
               <div className="absolute inset-0 flex items-center justify-center"><div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-orange-500"></div></div>
             </div>
             <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden border border-slate-700"><div className="bg-gradient-to-r from-orange-500 to-pink-600 h-full rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div></div>
             <p className="text-orange-400 mt-4 font-mono text-xs uppercase tracking-widest animate-pulse">Création en cours...</p>
           </div>
        )}

        {result && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-10 items-start pb-20 text-left animate-slide-up">
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
                 <h2 className="font-bold mb-4 flex items-center gap-2"><span className="text-xl">📍</span> Google / FB</h2>
                 <p className="text-sm text-slate-300 whitespace-pre-line mb-4 leading-relaxed">{result.google.caption}</p>
                 <CopyButton text={result.google.caption} id="google" />
               </div>
            </div>
          </div>
        )}

        {history.length > 0 && !result && !loading && (
          <div className="mt-20 text-left animate-fade-in-up">
            <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-slate-400">📂 Mes dernières créations</h3>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              {history.map((post) => (
                <div key={post.id} className="aspect-square rounded-2xl overflow-hidden border border-slate-800 group relative">
                  <img src={post.image_url} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                </div>
              ))}
            </div>
          </div>
        )}

        {result && (
            <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 flex gap-4 bg-slate-900/90 backdrop-blur-xl p-2 rounded-full border border-slate-700 shadow-2xl z-50">
                <button onClick={() => { setResult(null); setImagePreview(null); setBase64Image(null); }} className="px-6 py-3 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-all font-bold text-sm flex items-center gap-2">
                    <span>🗑️</span> Effacer & Recommencer
                </button>
            </div>
        )}
      </div>
    </main>
  );
}