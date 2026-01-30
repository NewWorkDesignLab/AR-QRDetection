/* eslint-disable no-undef */
const THREE = (globalThis && globalThis.THREE) ? globalThis.THREE : null;
if (!THREE) {
  console.error('THREE nicht gefunden. A-Frame muss vor diesem Modul geladen werden.');
}

/**
 * Interaction Outline Component (Shader-basiert)
 * 
 * Erstellt Silhouetten-Outlines mit Custom Shaders:
 * - Verwendet Vertex/Fragment Shader für Outline-Rendering
 * - Sehr performant auch bei vielen Meshes
 * - Konfigurierbare Dicke und Farbe
 * 
 * Events:
 * - interaction-start: Zeigt Outlines
 * - interaction-end: Versteckt Outlines
 * 
 * Verwendung:
 * <a-entity gltf-model="url(model.glb)" interaction-outline="color: #00ffff; thickness: 0.02"></a-entity>
 */

// ===== VERTEX SHADER (VERBESSERT) =====
const outlineVertexShader = `
  precision mediump float;
  uniform float thickness;
  
  void main() {
    // Position im View-Space berechnen
    vec3 displaced = position + normal * thickness;
    
    // In Clip-Space konvertieren
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced,1.0);
  }
`;

// ===== FRAGMENT SHADER =====
const outlineFragmentShader = `
  precision mediump float;
  uniform vec3 outlineColor;
  
  void main() {
    gl_FragColor = vec4(outlineColor, 1.0);
  }
`;

AFRAME.registerComponent('interaction-outline', {
  schema: {
    color: { type: 'color', default: '#00ffff' },
    thickness: { type: 'number', default: 0.02 },
    autoShow: { type: 'boolean', default: false },
    maxOutlineSize: { type: 'number', default: 0 },
    enabled: { type: 'boolean', default: true }
  },

  init: function () {
    this.outlineMeshes = [];
    this.isVisible = false;
    this.modelLoaded = false;
    
    this.onModelLoaded = this.onModelLoaded.bind(this);
    this.onInteractionStart = this.onInteractionStart.bind(this);
    this.onInteractionEnd = this.onInteractionEnd.bind(this);
    
    this.el.addEventListener('model-loaded', this.onModelLoaded, { once: true });
    this.el.addEventListener('interaction-start', this.onInteractionStart);
    this.el.addEventListener('interaction-end', this.onInteractionEnd);
    
    console.log('[InteractionOutline] Shader-based component initialized');
  },

  onModelLoaded: function () {
    // Schutz vor mehrfachen Aufrufen
    if (this.modelLoaded) {
      console.log('[InteractionOutline] Model already loaded, skipping...');
      return;
    }
    this.modelLoaded = true;

    if (!this.data.enabled) {
      console.log('[InteractionOutline] Component disabled');
      return;
    }

    console.log('[InteractionOutline] Model loaded, generating shader outlines...');
    
    const mesh = this.el.getObject3D('mesh');
    
    if (!mesh) {
      console.warn('[InteractionOutline] No mesh found on entity');
      return;
    }
    if (mesh.userData.outlineMesh) {
      console.log('[InteractionOutline] Outlines already exist on this mesh, skipping...');
      return;
    }
    mesh.userData.outlineMesh = true;

    const root = this.el.getObject3D("mesh");
    
    let outlineCount = 0;
    root.traverse((node) => {
      if (!node.isMesh) return;
      if (node.userData.outlineMesh) return;
      if (node.userData.isOutline) return;
      
      this.createOutlineForMesh(node);
      outlineCount++;
      
    });
    
    console.log(`[InteractionOutline] Created ${this.outlineMeshes.length} shader outline(s) from ${outlineCount} meshes`);
    
    if (this.data.autoShow) {
      this.showOutlines();
    }
  },

  getMeshSize: function (mesh) {
    if (!mesh.geometry) return 0;
    
    const bbox = new THREE.Box3().setFromObject(mesh);
    const size = bbox.getSize(new THREE.Vector3());
    return Math.max(size.x, size.y, size.z);
  },

  createOutlineForMesh: function (mesh) {
    try {
      // Skip wenn keine Geometrie
      if (!mesh.geometry) {
        return;
      }

      // Optional: Größe checken
      const meshSize = this.getMeshSize(mesh);
      if (this.data.maxOutlineSize > 0 && meshSize > this.data.maxOutlineSize) {
        console.warn(
          `[InteractionOutline] Skipping outline for "${mesh.name}": too large (${meshSize.toFixed(2)})`
        );
        return;
      }

      // ✅ SHADER MATERIAL erstellen (mit besseren Einstellungen)
      const outlineMaterial = new THREE.ShaderMaterial({
        uniforms: {
          thickness: { value: this.data.thickness },
          outlineColor: { value: new THREE.Color(this.data.color) }
        },
        vertexShader: outlineVertexShader,
        fragmentShader: outlineFragmentShader,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        depthTest: true,
        transparent: false,
        wireframe: false
      });

      const outlineGeometry = mesh.geometry;
      
      // Outline-Mesh erstellen
      const outlineMesh = new THREE.Mesh(outlineGeometry, outlineMaterial);
      outlineMesh.userData.isOutline = true;
      
      outlineMesh.visible = false;
      outlineMesh.position.set(0, 0, 0);
      outlineMesh.rotation.set(0, 0, 0);
      outlineMesh.scale.set(1, 1, 1);
      outlineMesh.renderOrder = 10;
      
      // Castings deaktivieren für bessere Performance
      outlineMesh.castShadow = false;
      outlineMesh.receiveShadow = false;
      
      // Als Child hinzufügen
      mesh.add(outlineMesh);
      
      mesh.userData.outlineMesh = outlineMesh;
      mesh.userData.outlineMaterial = outlineMaterial;
      this.outlineMeshes.push({ mesh: outlineMesh, material: outlineMaterial });
      
    } catch (error) {
      console.error('[InteractionOutline] Error creating outline:', error);
    }
  },

  onInteractionStart: function () {
    this.showOutlines();
  },

  onInteractionEnd: function () {
    this.hideOutlines();
  },

  showOutlines: function () {
    if (this.isVisible) return;
    
    this.outlineMeshes.forEach(({ mesh }) => {
      mesh.visible = true;
    });
    
    this.isVisible = true;
    console.log('[InteractionOutline] Shader outlines shown');
  },

  hideOutlines: function () {
    if (!this.isVisible) return;
    
    this.outlineMeshes.forEach(({ mesh }) => {
      mesh.visible = false;
    });
    
    this.isVisible = false;
    console.log('[InteractionOutline] Shader outlines hidden');
  },

  update: function (oldData) {
    if (!this.data.enabled) return;

    // Farbe aktualisieren
    if (oldData.color !== this.data.color) {
      const newColor = new THREE.Color(this.data.color);
      this.outlineMeshes.forEach(({ material }) => {
        material.uniforms.outlineColor.value.copy(newColor);
      });
      console.log('[InteractionOutline] Color updated:', this.data.color);
    }

    // Dicke aktualisieren
    if (oldData.thickness !== this.data.thickness) {
      this.outlineMeshes.forEach(({ material }) => {
        material.uniforms.thickness.value = this.data.thickness;
      });
      console.log('[InteractionOutline] Thickness updated:', this.data.thickness);
    }
  },

  remove: function () {
    console.log('[InteractionOutline] Removing component...');
    
    this.el.removeEventListener('model-loaded', this.onModelLoaded);
    this.el.removeEventListener('interaction-start', this.onInteractionStart);
    this.el.removeEventListener('interaction-end', this.onInteractionEnd);
    
    this.outlineMeshes.forEach(({ mesh, material }) => {
      try {
        if (mesh.geometry) mesh.geometry.dispose();
        if (material) material.dispose();
        if (mesh.parent) mesh.parent.remove(mesh);
      } catch (e) {
        console.error('[InteractionOutline] Error during cleanup:', e);
      }
    });
    
    this.outlineMeshes = [];
    this.modelLoaded = false;
  }
});

export { /* Component registriert sich selbst bei A-Frame */ };