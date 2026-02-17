import { createClient } from '@supabase/supabase-js';

//const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
//const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabaseUrl = "https://nwhgpnpghhtnnuedddza.supabase.co";
const supabaseKey = "sb_publishable_LsHgNqBcLJ7VAKrReAgL4g_NYD1gVmG";

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * ===== GET PROJECT BY QR CODE =====
 * QR codes resolve directly to projects via qr_code field
 */
export async function getProjectByQRCode(qrCode) {
  try {
    console.log('[Supabase] Fetching project by QR code:', qrCode);
    
    const { data, error } = await supabase
      .from('Project')
      .select('*')
      .eq('qr_code', qrCode)
      .eq('status', 'approved')
      .single();

    if (error) {
      console.error('[Supabase] Error fetching project:', error);
      return null;
    }

    console.log('[Supabase] Project found:', data.title);
    return data;
  } catch (err) {
    console.error('[Supabase] Exception:', err);
    return null;
  }
}

/**
 * ===== GET ACTIVE CONTENT FOR PROJECT =====
 * Via Project_Contents join table, aber wir nutzen project.content_active
 */
export async function getProjectActiveContent(projectId) {
  try {
    console.log('[Supabase] Fetching active content for project:', projectId);

    // Hole das aktive Content-Item aus projects.content_active
    const { data: project, error: projError } = await supabase
      .from('projects')
      .select('content_active')
      .eq('id', projectId)
      .single();

    if (projError || !project?.content_active) {
      console.warn('[Supabase] No active content ID found');
      return null;
    }

    // Hole das Content-Item
    const { data: content, error: contentError } = await supabase
      .from('content')
      .select('*')
      .eq('id', project.content_active)
      .single();

    if (contentError) {
      console.error('[Supabase] Error fetching content:', contentError);
      return null;
    }

    console.log('[Supabase] Content loaded:', content.name);
    return content;
  } catch (err) {
    console.error('[Supabase] Exception:', err);
    return null;
  }
}

/**
 * ===== GET CONTENT BY ID =====
 * Direkte Content-Abfrage
 */
export async function getContentById(contentId) {
  try {
    console.log('[Supabase] Fetching content by ID:', contentId);

    const { data, error } = await supabase
      .from('content')
      .select('*')
      .eq('id', contentId)
      .single();

    if (error) {
      console.error('[Supabase] Error fetching content:', error);
      return null;
    }

    console.log('[Supabase] Content found:', data.name);
    return data;
  } catch (err) {
    console.error('[Supabase] Exception:', err);
    return null;
  }
}

/**
 * ===== GET FILE URL FROM STORAGE =====
 * Supabase Storage URLs sind bereits public und absolut
 */
export function getModelFileUrl(fileUrl) {
  if (!fileUrl) return null;
  
  // Wenn bereits absolute URL, return as-is
  if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
    return fileUrl;
  }

  // Fallback: Baue Storage-URL
  const storageUrl = `${supabaseUrl}/storage/v1/object/public/${fileUrl}`;
  return storageUrl;
}

/**
 * ===== DETECT MEDIA TYPE FROM CONTENT.TYPE =====
 * Nutzt das type enum aus der DB statt Datei-Extension
 */
export function getMediaTypeFromContentType(dbType) {
  if (!dbType) return null;

  switch (dbType.toLowerCase()) {
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'model-3d':
      return 'model';
    case 'audio':
      return 'audio';
    default:
      return null;
  }
}