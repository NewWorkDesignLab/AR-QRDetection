// Lade Supabase von CDN
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const supabaseUrl = "https://nwhgpnpghhtnnuedddza.supabase.co";
const supabaseKey = "sb_publishable_LsHgNqBcLJ7VAKrReAgL4g_NYD1gVmG";

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * ===== GET PROJECT BY QR CODE =====
 * QR codes resolve directly to projects via qr_code field
 */
export async function getProjectByQRCode(qrCode) {
  try {
    const cleanQrCode = qrCode?.toString().trim();
    console.log('[Supabase] Fetching project by QR code:', cleanQrCode);
    
    const { data, error } = await supabase
      .from('Project')
      // NEU: Call_To_Action via FK mitladen
      .select(`
        *,
        call_to_action (
          id,
          type,
          label,
          value
        )
      `)
      .eq('qr_code', cleanQrCode);

    if (error) {
      console.error('[Supabase] Error fetching project:', error);
      return null;
    }
    
    if (!data || data.length === 0) {
      console.warn('[Supabase] No project found for QR code:', cleanQrCode);
      return null;
    }

    const approvedProject = data.find(p => p.status === 'approved');
    
    if (!approvedProject) {
      console.warn('[Supabase] No approved project found');
      return data[0];
    }

    console.log('[Supabase] Project found:', approvedProject.title);
    console.log('[Supabase] CTA:', approvedProject.call_to_action); // NEU: Debug
    return approvedProject;
  } catch (err) {
    console.error('[Supabase] Exception:', err);
    return null;
  }
}

/**
 * ===== GET ACTIVE CONTENT FOR PROJECT =====
 * Via project.content_active
 */
export async function getProjectActiveContent(projectId) {
  try {
    console.log('[Supabase] Fetching active content for project:', projectId);

    if (!projectId) {
      console.warn('[Supabase] No project ID provided');
      return null;
    }

    const { data, error } = await supabase
      .from('Project')
      .select('content_active')
      .eq('id', projectId);

    if (error) {
      console.error('[Supabase] Error fetching project content_active:', error);
      return null;
    }

    if (!data || data.length === 0) {
      console.warn('[Supabase] Project not found');
      return null;
    }

    const project = data[0];
    const contentId = project.content_active;

    if (!contentId) {
      console.warn('[Supabase] No active content ID in project');
      return null;
    }

    const { data: contentData, error: contentError } = await supabase
      .from('Content')
      .select('*')
      .eq('id', contentId);

    if (contentError) {
      console.error('[Supabase] Error fetching content:', contentError);
      return null;
    }

    if (!contentData || contentData.length === 0) {
      console.warn('[Supabase] Content not found');
      return null;
    }

    const content = contentData[0];
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
      .from('Content')
      .select('*')
      .eq('id', contentId);

    if (error) {
      console.error('[Supabase] Error fetching content:', error);
      return null;
    }

    if (!data || data.length === 0) {
      console.warn('[Supabase] Content not found for ID:', contentId);
      return null;
    }

    const content = data[0];
    console.log('[Supabase] Content found:', content.name);
    return content;
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
  
  if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
    return fileUrl;
  }

  const storageUrl = `${supabaseUrl}/storage/v1/object/public/${fileUrl}`;
  return storageUrl;
}

/**
 * ===== DETECT MEDIA TYPE FROM CONTENT.TYPE =====
 * Nutzt das type enum aus der DB
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