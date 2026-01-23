"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

export default function Home() {
  // =================================================================================
  // 1. ÉTATS DE L'APPLICATION
  // =================================================================================
  
  // États de chargement et résultats
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [base64Image, setBase64Image] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  // États Utilisateur (SaaS)
  const [profile, setProfile] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [logoUploading, setLogoUploading] = useState(false);

  // Champs du formulaire
  const [businessName, setBusinessName] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [hours, setHours] = useState("");
  const [tone, setTone] = useState("Standard");

  // États UX (Design)
  const [isDragging, setIsDragging] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [emailCopied, setEmailCopied] = useState(false);

  // Options pour le menu déroulant
  const tones = [
    { id: "Standard", label: "🎯 Standard" },
    { id: "Luxe & Pro", label: "✨ Luxe" },
    { id: "Fun & Cool", label: "🤪 Fun" },
    { id: "Urgence", label: "🔥 Promo" },
  ];

  // =================================================================================
  // 2. GESTION DE L'AUTHENTIFICATION (CŒUR DU SYSTÈME)
  // =================================================================================

useEffect(() => {
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log("🔔 Changement d'état Auth :", event);

      if (session) {
        const userId = session.user.id;
        localStorage.setItem("pictopost_user_id", userId);

        // 1. ON CHARGE LE PROFIL IMMÉDIATEMENT (Pour que l'affichage soit instantané)
        await loadUserProfile(userId);

        // 2. SI RETOUR FACEBOOK, ON SAUVEGARDE LES TOKENS EN ARRIÈRE-PLAN
        if (session.provider_token) {
          console.log("✅ Token Facebook détecté, sauvegarde en background...");
          saveSocialTokens(userId, session.provider_token).then(() => {
             // Une fois fini, on recharge juste pour être sûr d'avoir les badges verts
             loadUserProfile(userId);
          });
        }
      } else {
        // Mode Invité
        const localId = localStorage.getItem("pictopost_user_id");
        if (localId) loadUserProfile(localId);
        else createGuestUser();
      }
    });

    return () => { authListener.subscription.unsubscribe(); };
  }, []);

  // --- Sauvegarde des Tokens Facebook & Instagram dans Supabase ---
  const saveSocialTokens = async (uid: string, token: string) => {
    try {
        // 1. Sauvegarde du Token principal Facebook
        const { data: existing } = await supabase.from('profiles').select('id').eq('id', uid).single();
        
        if (!existing) {
             // Si le profil n'existe pas, on le crée
             await supabase.from('profiles').insert([{ 
                 id: uid, 
                 credits_remaining: 3, 
                 facebook_access_token: token 
             }]);
        } else {
             // Sinon on met à jour le token
             await supabase.from('profiles').update({ 
                 facebook_access_token: token 
             }).eq('id', uid);
        }

        // 2. Interrogation de l'API Facebook pour trouver les Pages gérées
        const resPages = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${token}`);
        const dataPages = await resPages.json();
        
        if (dataPages.data && dataPages.data.length > 0) {
            const page = dataPages.data[0]; // On prend la première page trouvée
            console.log("📄 Page trouvée :", page.name);

            // 3. Interrogation de la Page pour trouver le compte Instagram lié
            const resIg = await fetch(`https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account,access_token&access_token=${token}`);
            const dataIg = await resIg.json();

            // Préparation des données à sauvegarder
            const updates: any = {
                facebook_page_id: page.id,
                facebook_access_token: dataIg.access_token || token 
            };

            if (dataIg.instagram_business_account) {
                console.log("📸 Compte Instagram Business trouvé !");
                updates.instagram_business_id = dataIg.instagram_business_account.id;
                updates.instagram_access_token = token; 
            }

            // 4. Enregistrement final en base de données
            await supabase.from('profiles').update(updates).eq('id', uid);
            
            // 5. Rafraîchissement de l'interface
            await loadUserProfile(uid);
            
            // 6. Nettoyage de l'URL (pour enlever le token visible)
            window.history.replaceState({}, document.title, "/");
            alert("✅ Vos réseaux sociaux ont été connectés avec succès !");
        }
    } catch (e) {
        console.error("❌ Erreur sauvegarde tokens :", e);
        alert("Erreur lors de la connexion aux réseaux sociaux.");
    }
  };

  // --- Création d'un profil Invité ---
  const createGuestUser = async () => {
    const { data } = await supabase.from('profiles').insert([{ credits_remaining: 3 }]).select().single();
    if (data) {
      localStorage.setItem("pictopost_user_id", data.id);
      loadUserProfile(data.id);
    }
  };

  // --- Chargement des données du profil ---
  const loadUserProfile = async (uid: string) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).single();
    if (data) {
      setProfile(data);
      // Remplissage automatique des champs si déjà remplis par le passé
      if (data.business_name) setBusinessName(data.business_name);
      if (data.business_city) setCity(data.business_city);
      if (data.business_address) setAddress(data.business_address);
      if (data.business_hours) setHours(data.business_hours);
      
      // Chargement de l'historique des posts
      fetchHistory(data.id);
    }
  };

  // =================================================================================
  // 3. FONCTIONS MÉTIER (UPLOAD, GÉNÉRATION, ETC.)
  // =================================================================================

  // Gestion du clic sur le bouton "Se connecter avec Facebook"
  const handleSocialLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'facebook',
      options: {
        // C'est ici qu'on force le retour sur le site de production
        redirectTo: 'https://pictopost.vercel.app', 
        scopes: 'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish'
      },
    });
  };

  // Chargement de l'historique des images
  async function fetchHistory(uid: string) {
    const { data } = await supabase.from('draft_posts')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(6);
      
    if (data) {
        setHistory(data);
    }
  }

  // Gestion de l'upload du Logo
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    
    setLogoUploading(true);
    
    // Lecture du fichier
    const reader = new FileReader();
    reader.readAsDataURL(file);
    
    reader.onload = async () => {
      try {
        // Envoi à l'API (assurez-vous que l'API /api/user/update-logo existe, sinon ça simulera)
        const res = await fetch("/api/user/update-logo", {
          method: "POST",
          body: JSON.stringify({ userId: profile.id, logoBase64: reader.result })
        });
        
        if (res.ok) {
            const updated = await res.json();
            setProfile({ ...profile, logo_url: updated.logo_url });
            alert("✅ Logo enregistré avec succès !");
        } else {
             // Fallback si l'API n'est pas encore prête
             alert("Logo uploadé (simulation)");
        }
      } catch (err) {
        console.error(err);
        alert("Erreur lors de l'upload du logo.");
      } finally {
        setLogoUploading(false);
      }
    };
  };

  // Compression d'image via Canvas (Pour éviter d'envoyer des fichiers trop lourds à l'IA)
  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (e) => {
        const img = new Image();
        img.src = e.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          
          const MAX_WIDTH = 800; // Largeur max
          let width = img.width;
          let height = img.height;

          // Calcul du ratio
          if (width > MAX_WIDTH) {
            height = height * (MAX_WIDTH / width);
            width = MAX_WIDTH;
          }

          canvas.width = width;
          canvas.height = height;
          
          // Dessin dans le canvas (redimensionnement)
          ctx?.drawImage(img, 0, 0, width, height);
          
          // Export en JPG qualité 60%
          const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
          resolve(dataUrl);
        };
      };
    });
  };

  // Génération des posts via l'API
  const generatePosts = async (b64: string) => {
    // Vérification des crédits
    if (profile && profile.credits_remaining <= 0) {
      alert("⚠️ Vous n'avez plus de crédits ! Veuillez recharger.");
      setLoading(false);
      return;
    }
    
    setLoading(true);
    
    try {
      // 1. Mise à jour des infos business avant de générer
      await supabase.from('profiles').update({ 
          business_name: businessName, 
          business_city: city, 
          business_address: address, 
          business_hours: hours 
      }).eq('id', profile.id);

      // 2. Appel à l'IA
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
            imageBase64: b64, 
            city, 
            tone, 
            businessName, 
            address, 
            hours, 
            userId: profile?.id 
        }),
      });

      if (!response.ok) throw new Error("Erreur lors de la génération.");
      
      const data = await response.json();
      setResult(data);
      
      // 3. Mise à jour du solde de crédits affiché
      const { data: updated } = await supabase.from('profiles').select('*').eq('id', profile.id).single();
      if (updated) setProfile(updated);
      
      // 4. Mise à jour de l'historique
      fetchHistory(profile.id);
      
    } catch (error: any) {
      alert("Oups, une erreur est survenue : " + error.message);
    } finally {
      setLoading(false);
    }
  };

  // Traitement du fichier sélectionné
  const processFile = async (file: File) => {
    if (!file || !file.type.startsWith("image/")) {
        alert("Veuillez sélectionner une image valide.");
        return;
    }
    
    // Affichage immédiat de la prévisualisation
    setImagePreview(URL.createObjectURL(file));
    setResult(null);
    setLoading(true);
    
    // Compression
    const b64 = await compressImage(file);
    setBase64Image(b64);
    
    // Lancement de la génération
    generatePosts(b64);
  };

  // Barre de progression simulée
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

  // --- Gestionnaires d'événements Drag & Drop ---
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  // --- Utilitaires Copie Presse-papier ---
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

  // Composant Bouton Copier
  const CopyButton = ({ text, id }: { text: string, id: string }) => (
    <button 
        onClick={() => copyToClipboard(text, id)} 
        className="absolute top-2 right-2 p-2 rounded-lg bg-black/50 hover:bg-orange-500/80 text-white transition-all text-xs flex items-center gap-1 backdrop-blur-md border border-white/10 z-20"
    >
      {copiedField === id ? <>✅ Copié</> : <>📋 Copier</>}
    </button>
  );

  // =================================================================================
  // 4. RENDU GRAPHIQUE (HTML/JSX)
  // =================================================================================

  return (
    <main className="min-h-screen font-sans text-white relative overflow-hidden bg-slate-950 selection:bg-orange-500 selection:text-white">
      {/* --- BACKGROUND EFFECTS --- */}
      <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 z-0"></div>
      <div className="absolute top-[-10%] left-[20%] w-[500px] h-[500px] rounded-full bg-orange-600/20 blur-[120px] pointer-events-none"></div>

    {/* HEADER RESPONSIVE : Vertical sur mobile, Horizontal sur Ordi */}
      <div className="relative z-50 flex flex-col md:flex-row items-center justify-center gap-3 pt-6 animate-fade-in min-h-[60px] px-4">
        {profile ? (
          <>
            {/* 1. Compteur Crédits */}
            <div className="bg-slate-900/80 border border-slate-800 backdrop-blur-md px-4 py-2 rounded-full flex items-center gap-2 shadow-sm w-full md:w-auto justify-center">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Crédits</span>
              <span className={`text-sm font-black ${profile.credits_remaining > 0 ? 'text-orange-500' : 'text-red-500'}`}>
                {profile.credits_remaining}
              </span>
            </div>
            
            {/* 2. Upload Logo */}
            <label className="cursor-pointer bg-slate-900/80 border border-slate-800 px-4 py-2 rounded-full text-xs font-bold hover:border-orange-500 transition-all flex items-center gap-2 backdrop-blur-md shadow-sm w-full md:w-auto justify-center">
              <span>{logoUploading ? "⏳..." : profile.logo_url ? "✅ Logo OK" : "🖼️ Mon Logo"}</span>
              <input type="file" onChange={handleLogoUpload} className="hidden" accept="image/*" />
            </label>

            {/* 3. Bouton WhatsApp */}
            <a 
                href={`https://wa.me/14155238886?text=Lier%20mon%20compte%20${profile.id}`} 
                target="_blank" 
                className="bg-green-600/20 border border-green-500/50 hover:bg-green-600/30 text-green-400 px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center gap-2 shadow-lg w-full md:w-auto justify-center"
            >
              <span>📲</span> {profile.whatsapp_number ? "WhatsApp Lié" : "Lier WhatsApp"}
            </a>
          </>
        ) : (
          <div className="animate-pulse flex gap-4"><div className="h-9 w-24 bg-slate-800 rounded-full"></div></div>
        )}
      </div>

      {/* --- BOUTON CONTACT FLOTTANT --- */}
      <button 
        onClick={() => setShowFeedback(true)} 
        className="fixed top-6 right-6 z-50 bg-slate-900 border border-slate-700 hover:border-orange-500 text-slate-300 hover:text-white px-4 py-2 rounded-full text-sm font-bold shadow-xl transition-all"
      >
          📩 Contact
      </button>

      {/* --- MODAL CONTACT --- */}
      {showFeedback && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
            <div className="bg-slate-900 border border-slate-700 rounded-3xl p-8 max-w-md w-full shadow-2xl relative text-center text-white">
                <button onClick={() => setShowFeedback(true)} className="fixed bottom-6 right-6 md:top-6 md:right-6 md:bottom-auto z-50 bg-slate-900 border border-slate-700 hover:border-orange-500 text-slate-300 hover:text-white px-4 py-2 rounded-full text-sm font-bold shadow-xl transition-all">✕</button>
                <h2 className="text-2xl font-bold mb-4">Contact</h2>
                <div className="bg-black/50 border border-slate-800 rounded-xl p-4 flex gap-4 mb-6 items-center justify-between">
                    <span className="text-orange-400 font-mono text-sm font-bold">raventech75@gmail.com</span>
                    <button onClick={copyEmail} className="bg-slate-800 hover:bg-slate-700 text-white px-3 py-1 rounded text-xs transition-colors">
                        {emailCopied ? "Copié !" : "Copier"}
                    </button>
                </div>
                <button onClick={() => setShowFeedback(false)} className="text-slate-500 hover:text-white text-sm underline">Fermer</button>
            </div>
        </div>
      )}

      {/* --- CONTENU PRINCIPAL --- */}
      <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 relative z-10">
        
        {/* TITRE */}
        <div className="text-center mb-10 space-y-4">
          <h1 className="text-6xl md:text-8xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-white via-orange-100 to-orange-400 drop-shadow-sm">
            Pictopost
          </h1>
          <p className="text-xl text-slate-400 max-w-2xl mx-auto font-light italic">
            Votre Assistant Social Media IA.
          </p>
        </div>

        {/* --- FORMULAIRE ET UPLOAD --- */}
        {!result && !loading && (
          <div className="max-w-3xl mx-auto mb-10 bg-slate-900/50 backdrop-blur-md p-8 rounded-3xl border border-slate-800 shadow-2xl animate-fade-in-up">
            
            {/* CHAMPS DE SAISIE */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8 text-left">
                <div className="md:col-span-2">
                     <label className="text-slate-400 text-xs font-bold mb-2 uppercase block">🏢 Nom du commerce</label>
                     <input type="text" placeholder="Le Braisé d'Or..." value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl py-3 px-4 outline-none focus:border-orange-500 transition-all placeholder:text-slate-700" />
                </div>
                <div>
                    <label className="text-slate-400 text-xs font-bold mb-2 uppercase block">📍 Ville</label>
                    <input type="text" placeholder="Lyon..." value={city} onChange={(e) => setCity(e.target.value)} className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl py-3 px-4 outline-none focus:border-orange-500 placeholder:text-slate-700" />
                </div>
                <div>
                    <label className="text-slate-400 text-xs font-bold mb-2 uppercase block">🎭 Objectif</label>
                    <select value={tone} onChange={(e) => setTone(e.target.value)} className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl py-3 px-4 outline-none focus:border-orange-500">
                        {tones.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                </div>
                <div>
                    <label className="text-slate-400 text-xs font-bold mb-2 uppercase block">🏠 Adresse (Optionnel)</label>
                    <input type="text" placeholder="12 rue de la Paix..." value={address} onChange={(e) => setAddress(e.target.value)} className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl py-3 px-4 outline-none focus:border-orange-500 placeholder:text-slate-700" />
                </div>
                <div>
                    <label className="text-slate-400 text-xs font-bold mb-2 uppercase block">🕒 Horaires (Optionnel)</label>
                    <input type="text" placeholder="9h-19h..." value={hours} onChange={(e) => setHours(e.target.value)} className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl py-3 px-4 outline-none focus:border-orange-500 placeholder:text-slate-700" />
                </div>
            </div>

            {/* BOUTON CONNEXION FACEBOOK */}
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

            {/* ZONE DRAG & DROP */}
            <div 
                onDragOver={handleDragOver} 
                onDragLeave={handleDragLeave} 
                onDrop={handleDrop} 
                className={`relative border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer ${isDragging ? "border-orange-500 bg-orange-500/10" : "border-slate-700 hover:border-orange-400/50"}`}
            >
                <input type="file" accept="image/*" onChange={handleFileInput} className="absolute inset-0 opacity-0 cursor-pointer" />
                <div className="flex flex-col items-center gap-4 pointer-events-none">
                    <div className="p-4 rounded-full bg-slate-800 text-4xl">📸</div>
                    <p className="text-lg font-bold">Cliquez ou glissez une photo</p>
                </div>
            </div>
          </div>
        )}

        {/* --- ÉCRAN DE CHARGEMENT --- */}
        {loading && imagePreview && (
           <div className="max-w-xl mx-auto flex flex-col items-center justify-center mt-8 bg-slate-900/50 p-8 rounded-3xl border border-slate-800">
             <div className="relative mb-6 w-32 h-32">
               <img src={imagePreview} className="w-full h-full object-cover rounded-xl border-2 border-slate-700 opacity-50" />
               <div className="absolute inset-0 flex items-center justify-center"><div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-orange-500"></div></div>
             </div>
             <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden border border-slate-700">
                 <div className="bg-gradient-to-r from-orange-500 to-pink-600 h-full rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
             </div>
             <p className="text-orange-400 mt-4 font-mono text-xs uppercase tracking-widest">L'IA analyse votre image...</p>
           </div>
        )}

        {/* --- RÉSULTATS GÉNÉRÉS --- */}
        {result && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-10 items-start pb-20 text-left">
            {/* TIKTOK */}
            <div className="group bg-black border border-slate-800 rounded-3xl overflow-hidden shadow-xl hover:shadow-orange-500/10 transition-all duration-300 hover:-translate-y-1">
              <div className="h-1 bg-gradient-to-r from-pink-500 to-yellow-500"></div>
              <div className="p-5">
                 <h2 className="font-bold mb-4 flex items-center gap-2 text-pink-500">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/></svg>
                    TikTok
                 </h2>
                 <p className="text-sm text-slate-300 whitespace-pre-line mb-4 leading-relaxed">{result.tiktok.caption}</p>
                 <div className="relative h-8"><CopyButton text={result.tiktok.caption} id="tiktok" /></div>
              </div>
            </div>
            
            {/* INSTAGRAM (Mis en avant) */}
            <div className="group bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl shadow-purple-500/10 transition-all duration-300 scale-105 z-10 border-t-purple-500/50">
              <div className="h-1 bg-gradient-to-r from-orange-400 to-purple-600"></div>
              <div className="p-5">
                 <h2 className="font-bold mb-4 flex items-center gap-2 text-purple-400">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg>
                    Instagram
                 </h2>
                 <p className="text-sm text-slate-300 whitespace-pre-line mb-4 leading-relaxed">{result.instagram.caption}</p>
                 <div className="relative h-8"><CopyButton text={result.instagram.caption} id="insta" /></div>
              </div>
            </div>

            {/* GOOGLE */}
            <div className="group bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl hover:shadow-orange-500/10 transition-all duration-300 hover:-translate-y-1">
               <div className="h-1 bg-blue-600"></div>
               <div className="p-5">
                 <h2 className="font-bold mb-4 flex items-center gap-2 text-blue-400">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
                    Google Business
                 </h2>
                 <p className="text-sm text-slate-300 whitespace-pre-line mb-4 leading-relaxed">{result.google.caption}</p>
                 <div className="relative h-8"><CopyButton text={result.google.caption} id="google" /></div>
               </div>
            </div>
          </div>
        )}

        {/* --- HISTORIQUE DES CRÉATIONS --- */}
        {history.length > 0 && !result && !loading && (
          <div className="mt-20 text-left animate-fade-in-up">
            <h3 className="text-xl font-bold mb-6 flex items-center gap-2 border-b border-slate-800 pb-2">
                📂 Mes dernières créations
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              {history.map((post) => (
                <div key={post.id} className="aspect-square rounded-2xl overflow-hidden border border-slate-800 group relative cursor-pointer">
                  <img src={post.image_url} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="text-xs font-bold text-white bg-slate-900/80 px-2 py-1 rounded">Revoir</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* --- BOUTON RESET (FLOTTANT) --- */}
        {result && (
            <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 flex gap-4 bg-slate-900/90 backdrop-blur-xl p-2 rounded-full border border-slate-700 shadow-2xl z-50">
                <button 
                    onClick={() => { setResult(null); setImagePreview(null); setBase64Image(null); }} 
                    className="px-6 py-3 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-all font-bold text-sm flex items-center gap-2"
                >
                    <span>🗑️</span> Effacer & Recommencer
                </button>
            </div>
        )}
      </div>
    </main>
  );
}