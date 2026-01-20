"use client";

import { useState, useEffect } from "react";
import { Analytics } from "@vercel/analytics/next"

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [base64Image, setBase64Image] = useState<string | null>(null);
  
  // Champs
  const [city, setCity] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [tone, setTone] = useState("Standard");
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // UX
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  
  // --- ÉTATS MODALE CONTACT ---
  const [showFeedback, setShowFeedback] = useState(false);
  const [emailCopied, setEmailCopied] = useState(false); // Pour le bouton copier l'email

  const tones = [
    { id: "Standard", label: "🎯 Standard" },
    { id: "Luxe & Pro", label: "✨ Luxe" },
    { id: "Fun & Cool", label: "🤪 Fun" },
    { id: "Urgence", label: "🔥 Promo" },
  ];

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
    setLoading(true);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: b64, city, tone, businessName }),
      });
      if (!response.ok) throw new Error("Erreur");
      const data = await response.json();
      setResult(data);
    } catch (error) {
      alert("Erreur: " + error);
    } finally {
      setLoading(false);
    }
  };

  const processFile = (file: File) => {
    if (!file || !file.type.startsWith("image/")) return;
    setImagePreview(URL.createObjectURL(file));
    setResult(null);
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      const base64 = reader.result as string;
      setBase64Image(base64);
      generatePosts(base64);
    };
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

  // --- NOUVELLE FONCTION COPIE EMAIL ---
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

      {/* BOUTON CONTACT (Haut Droite) */}
      <button 
        onClick={() => setShowFeedback(true)}
        className="fixed top-6 right-6 z-50 bg-slate-900 border border-slate-700 hover:border-orange-500 text-slate-300 hover:text-white px-4 py-2 rounded-full text-sm font-bold shadow-xl transition-all flex items-center gap-2 hover:scale-105"
      >
        <span>📩</span> <span className="hidden sm:inline">Contact / Idée</span>
      </button>

      {/* --- NOUVELLE MODALE CONTACT (SIMPLE) --- */}
      {showFeedback && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
            <div className="bg-slate-900 border border-slate-700 rounded-3xl p-8 max-w-md w-full shadow-2xl relative text-center">
                <button onClick={() => setShowFeedback(false)} className="absolute top-4 right-4 text-slate-500 hover:text-white">✕</button>
                
                <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">
                    📬
                </div>

                <h2 className="text-2xl font-bold mb-2 text-white">Contactez-nous</h2>
                <p className="text-slate-400 text-sm mb-6">
                    Une idée d'amélioration ? Un bug ? <br/>
                    Copiez notre adresse et écrivez-nous !
                </p>
                
                {/* BLOC EMAIL À COPIER */}
                <div className="bg-black/50 border border-slate-800 rounded-xl p-4 flex items-center justify-between gap-4 mb-6 group hover:border-orange-500/50 transition-colors">
                    <span className="text-orange-400 font-mono text-sm sm:text-base font-bold truncate">
                        raventech75@gmail.com
                    </span>
                    <button 
                        onClick={copyEmail}
                        className="bg-slate-800 hover:bg-slate-700 text-white px-3 py-2 rounded-lg text-xs font-bold transition-colors whitespace-nowrap"
                    >
                        {emailCopied ? "✅ Copié !" : "📋 Copier"}
                    </button>
                </div>
                
                <button 
                    onClick={() => setShowFeedback(false)}
                    className="text-slate-500 hover:text-white text-sm underline underline-offset-4"
                >
                    Fermer
                </button>
            </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 relative z-10">
        
        {/* HEADER */}
        <div className="text-center mb-10 space-y-4">
          <h1 className="text-6xl md:text-8xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-white via-orange-100 to-orange-400">
            Pictopost
          </h1>
          <p className="text-xl text-slate-400 max-w-2xl mx-auto font-light">
            L'outil secret des commerçants qui cartonnent sur les réseaux.
          </p>
        </div>

        {/* --- ZONE CONFIG --- */}
        {!result && !loading && (
          <div className="max-w-3xl mx-auto mb-10 bg-slate-900/50 backdrop-blur-md p-8 rounded-3xl border border-slate-800 shadow-2xl animate-fade-in-up">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                <div className="col-span-1 md:col-span-3">
                     <label className="block text-slate-400 text-xs font-bold mb-2 uppercase tracking-wider">🏢 Nom du commerce</label>
                     <input type="text" placeholder="Ex: Le Braisé d'Or..." value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl py-3 px-4 focus:outline-none focus:border-orange-500 transition-all text-sm font-bold placeholder-slate-700" />
                </div>
                <div>
                    <label className="block text-slate-400 text-xs font-bold mb-2 uppercase tracking-wider">📍 Ville</label>
                    <input type="text" placeholder="Ex: Lyon..." value={city} onChange={(e) => setCity(e.target.value)} className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl py-3 px-4 focus:outline-none focus:border-orange-500 text-sm" />
                </div>
                <div className="col-span-2">
                    <label className="block text-slate-400 text-xs font-bold mb-2 uppercase tracking-wider">🎭 Objectif</label>
                    <div className="grid grid-cols-4 gap-2">
                        {tones.map(t => (
                          <button key={t.id} onClick={() => setTone(t.id)} className={`py-3 rounded-lg text-xs font-bold border transition-all ${tone === t.id ? "bg-orange-600 border-orange-500 text-white" : "bg-slate-950 border-slate-700 text-slate-500 hover:text-white"}`}>
                             {t.label}
                          </button>
                        ))}
                    </div>
                </div>
            </div>

            <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} className={`relative group border-2 border-dashed rounded-2xl p-10 text-center transition-all duration-300 cursor-pointer ${isDragging ? "border-orange-500 bg-orange-500/10 scale-[1.02]" : "border-slate-700 hover:border-orange-400/50 hover:bg-slate-800/50"}`}>
                <input type="file" accept="image/*" onChange={handleFileInput} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                <div className="flex flex-col items-center justify-center space-y-4 pointer-events-none">
                    <div className={`p-4 rounded-full bg-slate-800 transition-transform ${isDragging ? "scale-110" : "group-hover:scale-110"}`}><span className="text-4xl">📸</span></div>
                    <p className="text-lg font-bold text-white">{isDragging ? "Lâchez tout !" : "Cliquez ou glissez une photo"}</p>
                </div>
            </div>
          </div>
        )}

        {/* LOADER */}
        {loading && imagePreview && (
           <div className="max-w-xl mx-auto flex flex-col items-center justify-center mt-8 animate-fade-in-up bg-slate-900/50 p-8 rounded-3xl border border-slate-800">
             <div className="relative mb-6 w-32 h-32">
               <img src={imagePreview} className="w-full h-full object-cover rounded-xl border-2 border-slate-700 opacity-50" />
               <div className="absolute inset-0 flex items-center justify-center"><div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-orange-500"></div></div>
             </div>
             <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden border border-slate-700">
               <div className="bg-gradient-to-r from-orange-500 to-pink-600 h-full rounded-full transition-all duration-300 ease-out" style={{ width: `${progress}%` }}></div>
             </div>
             <p className="text-orange-400 mt-4 font-mono text-xs animate-pulse tracking-widest uppercase">Rédaction par l'IA...</p>
           </div>
        )}

        {/* RESULTATS */}
        {result && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-10 items-start animate-slide-up pb-20">
            {/* TIKTOK */}
            <div className="group relative bg-black border border-slate-800 rounded-3xl overflow-hidden hover:border-orange-500/50 transition-all duration-500 shadow-2xl">
              <div className="h-1 w-full bg-gradient-to-r from-pink-500 via-red-500 to-yellow-500"></div>
              <div className="p-5">
                 <h2 className="text-xl font-bold text-white mb-4 flex gap-2"><span className="text-pink-500">🎵</span> TikTok</h2>
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
                 <h2 className="text-xl font-bold text-white mb-4 flex gap-2"><span className="text-orange-400">📸</span> Insta</h2>
                 <div className="aspect-square bg-slate-900 rounded-xl overflow-hidden mb-4"><img src={imagePreview!} className="w-full h-full object-cover" /></div>
                 <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 relative">
                    <h3 className="text-orange-400 font-bold text-sm mb-2">{result.instagram.title}</h3>
                    <p className="text-sm text-slate-300 mb-3 pr-8 whitespace-pre-line">{result.instagram.caption}</p>
                    <p className="text-xs text-slate-500">{result.instagram.hashtags}</p>
                    <CopyButton text={`${result.instagram.title}\n\n${result.instagram.caption}\n\n${result.instagram.hashtags}`} id="insta" />
                 </div>
              </div>
            </div>

            {/* FACEBOOK */}
            <div className="group relative bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden hover:border-blue-500/50 transition-all">
               <div className="h-1 w-full bg-blue-600"></div>
               <div className="p-5">
                 <h2 className="text-xl font-bold text-white mb-4 flex gap-2"><span className="text-blue-500">📘</span> Facebook</h2>
                 <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 relative mb-4">
                    <h3 className="font-bold text-white mb-2">{result.facebook.title}</h3>
                    <p className="text-sm text-slate-300 leading-relaxed italic pr-8 whitespace-pre-line">"{result.facebook.caption}"</p>
                    <CopyButton text={`${result.facebook.title}\n\n${result.facebook.caption}`} id="fb" />
                 </div>
                 <div className="aspect-video bg-slate-900 rounded-lg overflow-hidden mb-4"><img src={imagePreview!} className="w-full h-full object-cover" /></div>
                 <button className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg text-sm uppercase">{result.facebook.title.includes("CTA") ? "Réserver" : "En savoir plus"}</button>
               </div>
            </div>
          </div>
        )}

        {/* --- BARRE D'ACTION (REGENERATE) --- */}
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