"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase"; // Import ajouté

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [base64Image, setBase64Image] = useState<string | null>(null);
  
  // --- ÉTATS AJOUTÉS (SaaS) ---
  const [profile, setProfile] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [logoUploading, setLogoUploading] = useState(false);

  // Champs originaux
  const [city, setCity] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [tone, setTone] = useState("Standard");
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // UX
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showFeedback, setShowFeedback] = useState(false);
  const [emailCopied, setEmailCopied] = useState(false);

  const tones = [
    { id: "Standard", label: "🎯 Standard" },
    { id: "Luxe & Pro", label: "✨ Luxe" },
    { id: "Fun & Cool", label: "🤪 Fun" },
    { id: "Urgence", label: "🔥 Promo" },
  ];

  // --- LOGIQUE SAAS : SESSION & HISTORIQUE ---
  useEffect(() => {
    async function initSession() {
      let userId = localStorage.getItem("pictopost_user_id");
      let currentProfile;

      if (!userId) {
        const { data } = await supabase.from('profiles').insert([{ credits_remaining: 3 }]).select().single();
        if (data) {
          userId = data.id;
          localStorage.setItem("pictopost_user_id", userId!);
          currentProfile = data;
        }
      } else {
        const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
        currentProfile = data;
      }

      if (currentProfile) {
        setProfile(currentProfile);
        if (currentProfile.business_name) setBusinessName(currentProfile.business_name);
        if (currentProfile.business_city) setCity(currentProfile.business_city);
        fetchHistory(currentProfile.id);
      }
    }
    initSession();
  }, []);

  async function fetchHistory(uid: string) {
    const { data } = await supabase.from('draft_posts').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(6);
    if (data) setHistory(data);
  }

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    setLogoUploading(true);
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      try {
        const res = await fetch("/api/user/update-logo", {
          method: "POST",
          body: JSON.stringify({ userId: profile.id, logoBase64: reader.result })
        });
        const updated = await res.json();
        setProfile({ ...profile, logo_url: updated.logo_url });
        alert("Logo enregistré ! Il sera incrusté sur vos photos WhatsApp.");
      } catch (err) { alert("Erreur logo"); }
      finally { setLogoUploading(false); }
    };
  };

  useEffect(() => {
    if (loading) {
      setProgress(0);
      const interval = setInterval(() => {
        setProgress((prev) => (prev >= 90 ? prev : prev + 10));
      }, 500);
      return () => clearInterval(interval);
    } else {
      setProgress(100);
    }
  }, [loading]);

  const generatePosts = async (b64: string) => {
    if (profile && profile.credits_remaining <= 0) {
      alert("⚠️ Plus de crédits ! Liez votre WhatsApp ou passez en Pro.");
      setLoading(false);
      return;
    }
    if (b64.length > 4000000) {
      alert("L'image est trop lourde.");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: b64, city, tone, businessName, userId: profile?.id }),
      });
      if (!response.ok) throw new Error("Erreur génération.");
      const data = await response.json();
      setResult(data);
      if (profile) setProfile({...profile, credits_remaining: profile.credits_remaining - 1});
      fetchHistory(profile.id);
    } catch (error: any) {
      alert("Oups : " + error.message);
    } finally {
      setLoading(false);
    }
  };

  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          const MAX_WIDTH = 800;
          let width = img.width;
          let height = img.height;
          if (width > MAX_WIDTH) { height = height * (MAX_WIDTH / width); width = MAX_WIDTH; }
          canvas.width = width; canvas.height = height;
          ctx?.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.6));
        };
      };
    });
  };

  const processFile = async (file: File) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > 10 * 1024 * 1024) return alert("Photo trop lourde.");
    setImagePreview(URL.createObjectURL(file));
    setResult(null);
    setLoading(true);
    const compressedBase64 = await compressImage(file);
    setBase64Image(compressedBase64);
    generatePosts(compressedBase64);
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const copyToClipboard = (text: string, fieldId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const copyEmail = () => {
    navigator.clipboard.writeText("raventech75@gmail.com");
    setEmailCopied(true);
    setTimeout(() => setEmailCopied(false), 2000);
  };

  const CopyButton = ({ text, id }: { text: string, id: string }) => (
    <button 
      onClick={() => copyToClipboard(text, id)}
      className="absolute top-2 right-2 p-2 rounded-lg bg-black/50 hover:bg-orange-500/80 text-white transition-all text-xs flex items-center gap-1 backdrop-blur-md border border-white/10 z-20"
    >
      {copiedField === id ? <>✅ Copié</> : <>📋 Copier</>}
    </button>
  );

  return (
    <main className="min-h-screen font-sans text-white relative overflow-hidden bg-slate-950 selection:bg-orange-500 selection:text-white">
      <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 z-0"></div>
      <div className="absolute top-[-10%] left-[20%] w-[500px] h-[500px] rounded-full bg-orange-600/20 blur-[120px] pointer-events-none"></div>

      {/* HEADER SAAS : CRÉDITS / LOGO / WHATSAPP */}
      {profile && (
        <div className="relative z-50 flex flex-wrap justify-center gap-4 pt-6 animate-fade-in">
          <div className="bg-slate-900/80 border border-slate-800 backdrop-blur-md px-4 py-2 rounded-full flex items-center gap-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Crédits</span>
            <span className={`text-sm font-black ${profile.credits_remaining > 0 ? 'text-orange-500' : 'text-red-500'}`}>
              {profile.credits_remaining} restants
            </span>
          </div>
          
          <label className="cursor-pointer bg-slate-900/80 border border-slate-800 px-4 py-2 rounded-full text-xs font-bold hover:border-orange-500 transition-all flex items-center gap-2 backdrop-blur-md">
             <span>{logoUploading ? "⏳..." : profile.logo_url ? "✅ Logo OK" : "🖼️ Mon Logo"}</span>
             <input type="file" onChange={handleLogoUpload} className="hidden" accept="image/*" />
          </label>

          <a 
            href={`https://wa.me/14155238886?text=Lier%20mon%20compte%20${profile.id}`}
            className="bg-green-600/20 border border-green-500/50 hover:bg-green-600/30 text-green-400 px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center gap-2 shadow-lg"
          >
            <span>📲</span> {profile.whatsapp_number ? "WhatsApp Lié" : "Lier WhatsApp"}
          </a>
        </div>
      )}

      {/* BOUTON CONTACT */}
      <button onClick={() => setShowFeedback(true)} className="fixed top-6 right-6 z-50 bg-slate-900 border border-slate-700 hover:border-orange-500 text-slate-300 hover:text-white px-4 py-2 rounded-full text-sm font-bold shadow-xl transition-all">
        📩 Contact
      </button>

      {/* MODALE CONTACT */}
      {showFeedback && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
            <div className="bg-slate-900 border border-slate-700 rounded-3xl p-8 max-w-md w-full shadow-2xl relative text-center text-white">
                <button onClick={() => setShowFeedback(false)} className="absolute top-4 right-4 text-slate-500 hover:text-white">✕</button>
                <h2 className="text-2xl font-bold mb-4">Contact</h2>
                <div className="bg-black/50 border border-slate-800 rounded-xl p-4 flex items-center justify-between gap-4 mb-6 transition-colors">
                    <span className="text-orange-400 font-mono text-sm font-bold truncate">raventech75@gmail.com</span>
                    <button onClick={copyEmail} className="bg-slate-800 hover:bg-slate-700 text-white px-3 py-2 rounded-lg text-xs font-bold">{emailCopied ? "✅" : "📋"}</button>
                </div>
                <button onClick={() => setShowFeedback(false)} className="text-slate-500 hover:text-white text-sm underline">Fermer</button>
            </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 relative z-10">
        
        {/* HEADER TITRE */}
        <div className="text-center mb-10 space-y-4">
          <h1 className="text-6xl md:text-8xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-white via-orange-100 to-orange-400">
            Pictopost
          </h1>
          <p className="text-xl text-slate-400 max-w-2xl mx-auto font-light italic">
            L'intelligence artificielle au service de votre commerce local.
          </p>
        </div>

        {/* GUIDE D'ACTIVATION WHATSAPP */}
        {profile && !profile.whatsapp_number && !result && !loading && (
          <div className="max-w-md mx-auto mb-10 bg-slate-900/50 border border-slate-800 rounded-3xl p-6 backdrop-blur-md text-left animate-fade-in shadow-2xl">
            <h3 className="text-xs font-bold text-orange-500 mb-4 uppercase tracking-widest flex items-center gap-2">🚀 Activation WhatsApp</h3>
            <div className="space-y-4 text-[11px] text-slate-400 leading-relaxed">
              <div className="flex gap-3"><span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center font-bold text-white flex-none">1</span><p>Envoyez <code className="text-orange-400 font-bold">join [ton-code]</code> au numéro Twilio.</p></div>
              <div className="flex gap-3"><span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center font-bold text-white flex-none">2</span><p>Cliquez sur le bouton vert <span className="text-white font-bold">Lier WhatsApp</span> en haut.</p></div>
              <div className="flex gap-3"><span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center font-bold text-white flex-none">3</span><p>Appuyez sur <span className="text-white font-bold">Envoyer</span> pour synchroniser.</p></div>
            </div>
          </div>
        )}

        {/* ZONE CONFIG */}
        {!result && !loading && (
          <div className="max-w-3xl mx-auto mb-10 bg-slate-900/50 backdrop-blur-md p-8 rounded-3xl border border-slate-800 shadow-2xl animate-fade-in-up">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                <div className="col-span-1 md:col-span-3 text-left">
                     <label className="block text-slate-400 text-xs font-bold mb-2 uppercase tracking-wider">🏢 Nom du commerce</label>
                     <input type="text" placeholder="Ex: Le Braisé d'Or..." value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl py-3 px-4 focus:outline-none focus:border-orange-500 transition-all text-sm font-bold" />
                </div>
                <div className="text-left">
                    <label className="block text-slate-400 text-xs font-bold mb-2 uppercase tracking-wider">📍 Ville</label>
                    <input type="text" placeholder="Ex: Lyon..." value={city} onChange={(e) => setCity(e.target.value)} className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl py-3 px-4 focus:outline-none focus:border-orange-500 text-sm" />
                </div>
                <div className="col-span-2 text-left">
                    <label className="block text-slate-400 text-xs font-bold mb-2 uppercase tracking-wider">🎭 Objectif</label>
                    <div className="grid grid-cols-4 gap-2">
                        {tones.map(t => (
                          <button key={t.id} onClick={() => setTone(t.id)} className={`py-3 rounded-lg text-xs font-bold border transition-all ${tone === t.id ? "bg-orange-600 border-orange-500 text-white" : "bg-slate-950 border-slate-700 text-slate-500 hover:text-white"}`}>{t.label}</button>
                        ))}
                    </div>
                </div>
            </div>

            <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} className={`relative group border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer ${isDragging ? "border-orange-500 bg-orange-500/10" : "border-slate-700 hover:border-orange-400/50"}`}>
                <input type="file" accept="image/*" onChange={handleFileInput} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                <div className="flex flex-col items-center justify-center space-y-4 pointer-events-none">
                    <div className="p-4 rounded-full bg-slate-800"><span className="text-4xl">📸</span></div>
                    <p className="text-lg font-bold text-white">{isDragging ? "Lâchez ici !" : "Glissez une photo"}</p>
                </div>
            </div>
          </div>
        )}

        {/* LOADER */}
        {loading && imagePreview && (
           <div className="max-w-xl mx-auto flex flex-col items-center justify-center mt-8 bg-slate-900/50 p-8 rounded-3xl border border-slate-800">
             <div className="relative mb-6 w-32 h-32">
               <img src={imagePreview} className="w-full h-full object-cover rounded-xl border-2 border-slate-700 opacity-50" />
               <div className="absolute inset-0 flex items-center justify-center"><div className="animate-spin rounded-full h-10 w-10 border-t-2 border-orange-500"></div></div>
             </div>
             <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden border border-slate-700">
               <div className="bg-gradient-to-r from-orange-500 to-pink-600 h-full rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
             </div>
             <p className="text-orange-400 mt-4 font-mono text-xs uppercase tracking-widest">Optimisation Multi-réseaux...</p>
           </div>
        )}

        {/* RESULTATS INTEGRÉS */}
        {result && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-10 items-start pb-20 text-left">
            {/* TIKTOK */}
            <div className="group relative bg-black border border-slate-800 rounded-3xl overflow-hidden hover:border-orange-500/50 transition-all duration-500">
              <div className="h-1 w-full bg-gradient-to-r from-pink-500 via-red-500 to-yellow-500"></div>
              <div className="p-5">
                 <h2 className="text-xl font-bold mb-4 flex gap-2"><span className="text-pink-500">🎵</span> TikTok</h2>
                 <div className="relative aspect-[9/16] bg-slate-900 rounded-xl overflow-hidden mb-4"><img src={imagePreview!} className="w-full h-full object-cover opacity-80" /><div className="absolute inset-0 flex items-center justify-center p-4"><span className="bg-black/70 text-white font-black text-xl text-center px-4 py-2 transform -rotate-2 border-2 border-orange-500 shadow-lg">{result.tiktok.hook}</span></div></div>
                 <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 relative">
                     <p className="text-sm text-slate-300 font-medium mb-3 pr-8 leading-relaxed whitespace-pre-line">{result.tiktok.caption}</p>
                     <p className="text-xs font-bold text-cyan-400 font-mono">{result.tiktok.hashtags}</p>
                     <CopyButton text={`${result.tiktok.hook}\n\n${result.tiktok.caption}\n\n${result.tiktok.hashtags}`} id="tiktok" />
                 </div>
              </div>
            </div>

            {/* INSTA */}
            <div className="group relative bg-gradient-to-b from-slate-900 to-black border border-slate-800 rounded-3xl overflow-hidden hover:border-orange-500/50 transition-all">
              <div className="h-1 w-full bg-gradient-to-r from-orange-400 to-purple-600"></div>
              <div className="p-5">
                 <h2 className="text-xl font-bold mb-4 flex gap-2"><span className="text-orange-400">📸</span> Insta</h2>
                 <div className="aspect-square bg-slate-900 rounded-xl overflow-hidden mb-4"><img src={imagePreview!} className="w-full h-full object-cover" /></div>
                 <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 relative">
                    <h3 className="text-orange-400 font-bold text-sm mb-2">{result.instagram.title}</h3>
                    <p className="text-sm text-slate-300 mb-3 pr-8 whitespace-pre-line">{result.instagram.caption}</p>
                    <p className="text-xs text-slate-500">{result.instagram.hashtags}</p>
                    <CopyButton text={`${result.instagram.title}\n\n${result.instagram.caption}\n\n${result.instagram.hashtags}`} id="insta" />
                 </div>
              </div>
            </div>

            {/* GOOGLE BUSINESS PROFILE (NOUVEAU) */}
            <div className="group relative bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden hover:border-blue-500/50 transition-all">
               <div className="h-1 w-full bg-blue-600"></div>
               <div className="p-5">
                 <h2 className="text-xl font-bold mb-4 flex gap-2"><span className="text-blue-500">📍</span> Google Maps</h2>
                 <div className="bg-blue-900/20 p-4 rounded-xl border border-blue-500/30 mb-4 relative">
                    <p className="text-blue-400 text-[10px] font-bold uppercase mb-1 tracking-widest">Optimisé SEO Local</p>
                    <p className="text-sm text-white leading-relaxed whitespace-pre-line italic pr-8">{result.google.caption}</p>
                    <CopyButton text={result.google.caption} id="google" />
                 </div>
                 <div className="aspect-video bg-slate-900 rounded-lg overflow-hidden mb-4"><img src={imagePreview!} className="w-full h-full object-cover" /></div>
                 <button className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg text-xs uppercase tracking-widest">Publier sur Fiche Google</button>
               </div>
            </div>
          </div>
        )}

        {/* HISTORIQUE : MES DERNIÈRES CRÉATIONS */}
        {history.length > 0 && !result && !loading && (
          <div className="mt-20 text-left animate-fade-in-up">
            <h3 className="text-xl font-bold mb-6 flex items-center gap-2">📂 Mes dernières créations</h3>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              {history.map((post) => (
                <div key={post.id} className="aspect-square rounded-2xl overflow-hidden border border-slate-800 group relative shadow-2xl">
                  <img src={post.image_url} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                  <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center p-3 text-[10px] transition-all text-center">
                    <p className="font-bold text-orange-400 mb-1">{post.status === 'published' ? '✅ Publié' : '⏳ Brouillon'}</p>
                    <p className="text-slate-400 line-clamp-3 italic">"{post.caption}"</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* BARRE DE CONTRÔLE BASSE */}
        {result && (
            <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 flex gap-4 bg-slate-900/90 backdrop-blur-xl p-2 rounded-full border border-slate-700 shadow-2xl z-50">
                <button onClick={() => { setResult(null); setImagePreview(null); setBase64Image(null); }} className="px-6 py-3 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-all font-bold text-sm">🗑️ Effacer</button>
                <button onClick={() => generatePosts(base64Image!)} className="px-8 py-3 rounded-full bg-gradient-to-r from-orange-500 to-pink-600 hover:from-orange-400 hover:to-pink-500 text-white shadow-lg transition-all font-bold text-sm flex items-center gap-2">⚡️ Régénérer</button>
            </div>
        )}
      </div>
    </main>
  );
}