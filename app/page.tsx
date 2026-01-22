"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [base64Image, setBase64Image] = useState<string | null>(null);
  
  // ÉTATS SAAS
  const [profile, setProfile] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [logoUploading, setLogoUploading] = useState(false);

  // CHAMPS
  const [businessName, setBusinessName] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [hours, setHours] = useState("");
  const [tone, setTone] = useState("Standard");
  
  // UX
  const [copiedField, setCopiedField] = useState<string | null>(null);
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

  // --- 1. INITIALISATION & GESTION RETOUR FACEBOOK ---
  useEffect(() => {
    async function initSession() {
      // Vérifier le retour de connexion Facebook (OAuth)
      const { data: { session } } = await supabase.auth.getSession();
      
      let userId = localStorage.getItem("pictopost_user_id");

      // CAS A : RETOUR DE FACEBOOK (On a le token !)
      if (session && session.provider_token) {
        let { data: userProfile } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        
        if (!userProfile) {
          // Création profil si nouveau
          const { data: newProfile } = await supabase.from('profiles').insert([{ 
            id: session.user.id, 
            credits_remaining: 3,
            facebook_access_token: session.provider_token // On sauve le token FB
          }]).select().single();
          userProfile = newProfile;
        } else {
          // Mise à jour du token existant
          await supabase.from('profiles').update({ 
            facebook_access_token: session.provider_token 
          }).eq('id', session.user.id);
        }

        // On bascule sur cet ID authentifié
        userId = session.user.id;
        localStorage.setItem("pictopost_user_id", userId);
        
        // On cherche automatiquement les pages et compte Insta
        fetchSocialAccounts(session.provider_token, userId);
      }

      // CAS B : NAVIGATION NORMALE (INVITÉ)
      if (!userId) {
        const { data } = await supabase.from('profiles').insert([{ credits_remaining: 3 }]).select().single();
        if (data) {
          userId = data.id;
          localStorage.setItem("pictopost_user_id", userId);
        }
      }

      // Chargement final
      if (userId) {
        const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
        if (data) {
          setProfile(data);
          if (data.business_name) setBusinessName(data.business_name);
          if (data.business_city) setCity(data.business_city);
          if (data.business_address) setAddress(data.business_address);
          if (data.business_hours) setHours(data.business_hours);
          fetchHistory(data.id);
        }
      }
    }
    initSession();
  }, []);

  // --- RÉCUPÉRATION AUTO DES ID FACEBOOK/INSTAGRAM ---
  const fetchSocialAccounts = async (token: string, uid: string) => {
    try {
      // 1. Récupérer les pages
      const resPages = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${token}`);
      const dataPages = await resPages.json();
      
      if (dataPages.data && dataPages.data.length > 0) {
        const page = dataPages.data[0]; // On prend la première page gérée
        
        // 2. Récupérer le compte Instagram lié
        const resIg = await fetch(`https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account,access_token&access_token=${token}`);
        const dataIg = await resIg.json();

        // 3. Sauvegarder tout dans Supabase
        const updates: any = {
            facebook_page_id: page.id,
            facebook_access_token: dataIg.access_token || token // Token de page (meilleur) ou user
        };

        if (dataIg.instagram_business_account) {
            updates.instagram_business_id = dataIg.instagram_business_account.id;
            updates.instagram_access_token = token; // Le token user suffit souvent pour Insta via Graph
        }

        await supabase.from('profiles').update(updates).eq('id', uid);
        
        // Rafraichir l'interface
        const { data: refreshed } = await supabase.from('profiles').select('*').eq('id', uid).single();
        setProfile(refreshed);
        alert("✅ Réseaux sociaux connectés avec succès !");
      }
    } catch (e) { console.error("Erreur social", e); }
  };

  const handleSocialLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'facebook',
      options: {
        redirectTo: window.location.origin,
        scopes: 'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish'
      },
    });
  };

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
        alert("Logo enregistré !");
      } catch (err) { alert("Erreur logo"); }
      finally { setLogoUploading(false); }
    };
  };

  useEffect(() => {
    if (loading) {
      setProgress(0);
      const interval = setInterval(() => { setProgress((prev) => (prev >= 90 ? prev : prev + 10)); }, 500);
      return () => clearInterval(interval);
    } else { setProgress(100); }
  }, [loading]);

  const generatePosts = async (b64: string) => {
    if (profile && profile.credits_remaining <= 0) { alert("⚠️ Crédits épuisés !"); setLoading(false); return; }
    setLoading(true);
    try {
      await supabase.from('profiles').update({ business_name: businessName, business_city: city, business_address: address, business_hours: hours }).eq('id', profile.id);
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: b64, city, tone, businessName, address, hours, userId: profile?.id }),
      });
      if (!response.ok) throw new Error("Erreur génération.");
      const data = await response.json();
      setResult(data);
      const { data: updated } = await supabase.from('profiles').select('*').eq('id', profile.id).single();
      if (updated) setProfile(updated);
      fetchHistory(profile.id);
    } catch (error: any) { alert("Oups : " + error.message); }
    finally { setLoading(false); }
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
          ctx?.drawImage(img, 0, 0, w, h); resolve(canvas.toDataURL("image/jpeg", 0.6));
        };
      };
    });
  };

  const processFile = async (file: File) => {
    if (!file || !file.type.startsWith("image/")) return;
    setImagePreview(URL.createObjectURL(file)); setResult(null); setLoading(true);
    const b64 = await compressImage(file); setBase64Image(b64); generatePosts(b64);
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files?.[0]; if (f) processFile(f); };
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) processFile(f); };
  const copyToClipboard = (text: string, fieldId: string) => { navigator.clipboard.writeText(text); setCopiedField(fieldId); setTimeout(() => setCopiedField(null), 2000); };
  const copyEmail = () => { navigator.clipboard.writeText("raventech75@gmail.com"); setEmailCopied(true); setTimeout(() => setEmailCopied(false), 2000); };

  const CopyButton = ({ text, id }: { text: string, id: string }) => (
    <button onClick={() => copyToClipboard(text, id)} className="absolute top-2 right-2 p-2 rounded-lg bg-black/50 hover:bg-orange-500/80 text-white transition-all text-xs flex items-center gap-1 backdrop-blur-md border border-white/10 z-20">
      {copiedField === id ? <>✅ Copié</> : <>📋 Copier</>}
    </button>
  );

  return (
    <main className="min-h-screen font-sans text-white relative overflow-hidden bg-slate-950 selection:bg-orange-500 selection:text-white">
      <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 z-0"></div>
      <div className="absolute top-[-10%] left-[20%] w-[500px] h-[500px] rounded-full bg-orange-600/20 blur-[120px] pointer-events-none"></div>

      {/* HEADER SAAS */}
      <div className="relative z-50 flex flex-wrap justify-center gap-4 pt-6 animate-fade-in min-h-[60px]">
        {profile ? (
          <>
            <div className="bg-slate-900/80 border border-slate-800 backdrop-blur-md px-4 py-2 rounded-full flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Crédits</span>
              <span className={`text-sm font-black ${profile.credits_remaining > 0 ? 'text-orange-500' : 'text-red-500'}`}>
                {profile.credits_remaining}
              </span>
            </div>
            
            <label className="cursor-pointer bg-slate-900/80 border border-slate-800 px-4 py-2 rounded-full text-xs font-bold hover:border-orange-500 transition-all flex items-center gap-2 backdrop-blur-md">
              <span>{logoUploading ? "⏳..." : profile.logo_url ? "✅ Logo OK" : "🖼️ Mon Logo"}</span>
              <input type="file" onChange={handleLogoUpload} className="hidden" accept="image/*" />
            </label>

            <a href={`https://wa.me/14155238886?text=Lier%20mon%20compte%20${profile.id}`} className="bg-green-600/20 border border-green-500/50 hover:bg-green-600/30 text-green-400 px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center gap-2 shadow-lg">
              <span>📲</span> {profile.whatsapp_number ? "WhatsApp Lié" : "Lier WhatsApp"}
            </a>
          </>
        ) : (
          <div className="animate-pulse flex gap-4"><div className="h-9 w-24 bg-slate-800 rounded-full"></div></div>
        )}
      </div>

      <button onClick={() => setShowFeedback(true)} className="fixed top-6 right-6 z-50 bg-slate-900 border border-slate-700 hover:border-orange-500 text-slate-300 hover:text-white px-4 py-2 rounded-full text-sm font-bold shadow-xl transition-all">📩 Contact</button>

      {showFeedback && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
            <div className="bg-slate-900 border border-slate-700 rounded-3xl p-8 max-w-md w-full shadow-2xl relative text-center text-white">
                <button onClick={() => setShowFeedback(false)} className="absolute top-4 right-4 text-slate-500 hover:text-white">✕</button>
                <h2 className="text-2xl font-bold mb-4">Contact</h2>
                <div className="bg-black/50 border border-slate-800 rounded-xl p-4 flex gap-4 mb-6"><span className="text-orange-400 font-mono text-sm font-bold">raventech75@gmail.com</span><button onClick={copyEmail} className="bg-slate-800 text-white px-3 py-1 rounded text-xs">Copier</button></div>
                <button onClick={() => setShowFeedback(false)} className="text-slate-500 hover:text-white text-sm underline">Fermer</button>
            </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 relative z-10">
        <div className="text-center mb-10 space-y-4">
          <h1 className="text-6xl md:text-8xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-white via-orange-100 to-orange-400">Pictopost</h1>
          <p className="text-xl text-slate-400 max-w-2xl mx-auto font-light italic">Votre Assistant Social Media IA.</p>
        </div>

        {!result && !loading && (
          <div className="max-w-3xl mx-auto mb-10 bg-slate-900/50 backdrop-blur-md p-8 rounded-3xl border border-slate-800 shadow-2xl animate-fade-in-up">
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8 text-left">
                <div className="md:col-span-2">
                     <label className="text-slate-400 text-xs font-bold mb-2 uppercase block">🏢 Nom du commerce</label>
                     <input type="text" placeholder="Le Braisé d'Or..." value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl py-3 px-4 outline-none focus:border-orange-500 transition-all" />
                </div>
                <div>
                    <label className="text-slate-400 text-xs font-bold mb-2 uppercase block">📍 Ville</label>
                    <input type="text" placeholder="Lyon..." value={city} onChange={(e) => setCity(e.target.value)} className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl py-3 px-4 outline-none focus:border-orange-500" />
                </div>
                <div>
                    <label className="text-slate-400 text-xs font-bold mb-2 uppercase block">🎭 Objectif</label>
                    <select value={tone} onChange={(e) => setTone(e.target.value)} className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl py-3 px-4 outline-none focus:border-orange-500">
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

            {/* --- BOUTON CONNEXION FACEBOOK / INSTAGRAM --- */}
            <div className="mb-8 p-6 bg-blue-600/10 border border-blue-500/30 rounded-2xl text-center">
                {profile?.instagram_business_id ? (
                    <div className="flex flex-col gap-2 items-center justify-center text-green-400 font-bold">
                        <span className="flex items-center gap-2 text-lg">✅ Réseaux Connectés</span>
                        <span className="text-xs opacity-70 font-mono bg-green-900/30 px-2 py-1 rounded">ID: {profile.instagram_business_id}</span>
                        <button onClick={handleSocialLogin} className="text-[10px] text-blue-400 underline hover:text-white mt-2">Mettre à jour la connexion</button>
                    </div>
                ) : (
                    <div>
                        <h3 className="text-blue-400 text-sm font-bold uppercase mb-2">Automatisation Instagram & Facebook</h3>
                        <p className="text-xs text-slate-400 mb-4 max-w-md mx-auto">Connectez votre page Facebook Pro pour permettre à notre IA de publier automatiquement vos posts (via Make).</p>
                        <button 
                            onClick={handleSocialLogin}
                            className="bg-[#1877F2] hover:bg-[#166fe5] text-white px-6 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-3 mx-auto transition-all shadow-lg hover:shadow-blue-500/20"
                        >
                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.791-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                            Se connecter avec Facebook
                        </button>
                    </div>
                )}
            </div>

            <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} className={`relative border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer ${isDragging ? "border-orange-500 bg-orange-500/10" : "border-slate-700 hover:border-orange-400/50"}`}>
                <input type="file" accept="image/*" onChange={handleFileInput} className="absolute inset-0 opacity-0 cursor-pointer" />
                <div className="flex flex-col items-center gap-4 pointer-events-none">
                    <div className="p-4 rounded-full bg-slate-800 text-4xl">📸</div>
                    <p className="text-lg font-bold">Cliquez ou glissez une photo</p>
                </div>
            </div>
          </div>
        )}

        {loading && imagePreview && (
           <div className="max-w-xl mx-auto flex flex-col items-center justify-center mt-8 bg-slate-900/50 p-8 rounded-3xl border border-slate-800">
             <div className="relative mb-6 w-32 h-32">
               <img src={imagePreview} className="w-full h-full object-cover rounded-xl border-2 border-slate-700 opacity-50" />
               <div className="absolute inset-0 flex items-center justify-center"><div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-orange-500"></div></div>
             </div>
             <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden border border-slate-700"><div className="bg-gradient-to-r from-orange-500 to-pink-600 h-full rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div></div>
             <p className="text-orange-400 mt-4 font-mono text-xs uppercase tracking-widest">Optimisation...</p>
           </div>
        )}

        {result && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-10 items-start pb-20 text-left">
            <div className="group bg-black border border-slate-800 rounded-3xl overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-pink-500 to-yellow-500"></div>
              <div className="p-5">
                 <h2 className="font-bold mb-4">🎵 TikTok</h2>
                 <p className="text-sm text-slate-300 whitespace-pre-line mb-2">{result.tiktok.caption}</p>
                 <CopyButton text={result.tiktok.caption} id="tiktok" />
              </div>
            </div>
            <div className="group bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-orange-400 to-purple-600"></div>
              <div className="p-5">
                 <h2 className="font-bold mb-4">📸 Insta</h2>
                 <p className="text-sm text-slate-300 whitespace-pre-line mb-2">{result.instagram.caption}</p>
                 <CopyButton text={result.instagram.caption} id="insta" />
              </div>
            </div>
            <div className="group bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden">
               <div className="h-1 bg-blue-600"></div>
               <div className="p-5">
                 <h2 className="font-bold mb-4">📍 Google</h2>
                 <p className="text-sm text-slate-300 whitespace-pre-line mb-2">{result.google.caption}</p>
                 <CopyButton text={result.google.caption} id="google" />
               </div>
            </div>
          </div>
        )}

        {history.length > 0 && !result && !loading && (
          <div className="mt-20 text-left animate-fade-in-up">
            <h3 className="text-xl font-bold mb-6 flex items-center gap-2">📂 Mes créations</h3>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              {history.map((post) => (
                <div key={post.id} className="aspect-square rounded-2xl overflow-hidden border border-slate-800 group relative">
                  <img src={post.image_url} className="w-full h-full object-cover group-hover:scale-110 transition-transform" />
                </div>
              ))}
            </div>
          </div>
        )}

        {result && (
            <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 flex gap-4 bg-slate-900/90 backdrop-blur-xl p-2 rounded-full border border-slate-700 shadow-2xl z-50">
                <button onClick={() => { setResult(null); setImagePreview(null); setBase64Image(null); }} className="px-6 py-3 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-all font-bold text-sm">🗑️ Effacer</button>
            </div>
        )}
      </div>
    </main>
  );
}