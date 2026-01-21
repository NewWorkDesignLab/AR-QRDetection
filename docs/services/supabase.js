import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

//const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
//const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const SUPABASE_URL = "https://nwhgpnpghhtnnuedddza.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_LsHgNqBcLJ7VAKrReAgL4g_NYD1gVmG";

// DEBUG - temporär
console.log('🔧 ENV Debug:', {
  url: SUPABASE_URL,
  key: SUPABASE_ANON_KEY ? 'Key vorhanden (' + SUPABASE_ANON_KEY.length + ' chars)' : 'FEHLT',
  allEnv: import.meta.env
});

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Supabase credentials fehlen! Prüfe .env Datei.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Lädt ein Modell anhand der ID
 */
export async function getModelById(id) {
  const { data, error } = await supabase
    .from('models')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.warn('⚠️ Model nicht gefunden:', id, error.message);
    return null;
  }
  
  console.log('✅ Model geladen:', data);
  return data;
}

/**
 * Lädt alle Modelle (für Debug/Admin)
 */
export async function getAllModels() {
  const { data, error } = await supabase
    .from('models')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('❌ Fehler beim Laden:', error.message);
    return [];
  }
  return data;
}

/**
 * Erstellt die öffentliche URL für eine Modell-Datei im Storage
 */
export function getModelFileUrl(path) {
  // Null/leer → kein Modell (Fallback-Würfel)
  if (!path) return null;
  
  // Bereits vollständige URL → direkt zurückgeben
  if (path.startsWith('http')) return path;
  
  // Lokaler Pfad (assets/...) → direkt zurückgeben
  if (path.startsWith('assets/')) return path;
  
  // Storage-Pfad → Supabase URL erstellen
  const { data } = supabase.storage
    .from('models')
    .getPublicUrl(path);
  
  console.log('📦 Storage URL:', data.publicUrl);
  return data.publicUrl;
}