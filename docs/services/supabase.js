import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * ===== GET PROJECT BY SLUG (QR Resolution) =====
 * QR codes resolve to projects, not directly to content
 */
export async function getProjectBySlug(slug) {
  try {
    console.log('[Supabase] Fetching project by slug:', slug);
    
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('qr_code', slug)
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
 * Holt das aktive Content-Item aus der Project_Contents Join-Tabelle
 */
export async function getProjectActiveContent(projectId) {
  try {
    console.log('[Supabase] Fetching active content for project:', projectId);

    // Variante 1: content_active ist direkt in projects gespeichert
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
 * ===== GET MODEL (Legacy) =====
 * Fallback für alte Struktur, wird zu getContentById umgewandelt
 */
export async function getModelById(stationId) {
  // Versuche zuerst, es als Content-ID zu interpretieren
  const content = await getContentById(stationId);
  if (content) {
    return {
      id: content.id,
      title: content.name,
      description: content.description,
      model_url: content.file_url, // Mapping für alte API
      type: content.type,
      scale: 1.0, // Default, DB speichert das noch separat?
      thumbnail_url: content.thumbnail_url,
      meta: {}
    };
  }

  // Fallback: Versuche als Project-Slug
  const project = await getProjectBySlug(stationId);
  if (project) {
    const activeContent = await getProjectActiveContent(project.id);
    if (activeContent) {
      return {
        id: activeContent.id,
        title: activeContent.name,
        description: activeContent.description,
        model_url: activeContent.file_url,
        type: activeContent.type,
        scale: activeContent.scale || 1.0,
        thumbnail_url: activeContent.thumbnail_url,
        meta: {}
      };
    }
  }

  return null;
}

/**
 * ===== GET FILE URL FROM STORAGE =====
 * Supabase Storage URLs sind bereits public und absolute
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