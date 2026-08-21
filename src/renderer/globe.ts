'use strict';

/**
 * Interactive 3D Spinning Vector Globe
 * 
 * High-performance, canvas-based orthographic 3D globe with:
 * - Real continent landmass coastlines and regional coordinate pins
 * - Natural inertia drag & ambient spin matching mouse movement in both X & Y
 * - Spherical rotation interpolation (flyTo) to highlight chosen world regions accurately
 * - Glowing atmosphere, neon beacons, and pulse rings
 */

import { ScaleTraditionId, WORLD_REGIONS, WorldRegion } from './world-scales';

export interface GlobeOptions {
  container: HTMLElement;
  size?: number;
  initialRegion?: ScaleTraditionId;
  onSelectRegion?: (region: WorldRegion) => void;
}

interface Point3D {
  x: number;
  y: number;
  z: number;
}

// Major continent polygonal coordinate traces [lat, lon]
const CONTINENT_DATA: Array<[number, number][]> = [
  // 1. India & South Asia (Clear peninsular shape)
  [
    [35, 75], [34, 73], [32, 75], [28, 70], [24, 68], [22, 69], [20, 73], [15, 74], [10, 76],
    [8, 77.5], [10, 79.8], [13, 80.3], [16, 82], [21, 87], [22, 91], [27, 97], [29, 94],
    [28, 88], [30, 81], [35, 77], [35, 75]
  ],
  // Sri Lanka
  [
    [9.8, 80.2], [8.5, 79.8], [6, 80.5], [6, 81.8], [8.5, 81.5], [9.8, 80.2]
  ],
  // 2. East Asia & China
  [
    [53, 120], [48, 130], [42, 131], [39, 124], [35, 120], [31, 122], [22, 114], [21, 108],
    [22, 100], [28, 97], [36, 95], [45, 90], [50, 100], [53, 120]
  ],
  // 3. Japan
  [
    [45, 142], [41, 141], [35, 136], [31, 130], [33, 130], [36, 138], [43, 145], [45, 142]
  ],
  // 4. Southeast Asia
  [
    [20, 106], [16, 108], [10, 108], [8, 103], [1, 104], [6, 100], [14, 101], [20, 106]
  ],
  // 5. Middle East & Arabia / Egypt
  [
    [32, 35], [30, 48], [25, 56], [22, 59], [15, 53], [12, 44], [16, 42], [22, 38], [28, 34], [32, 35]
  ],
  // 6. Africa
  [
    [37, 10], [32, 32], [28, 34], [22, 38], [12, 44], [5, 48], [-5, 40], [-11, 40], [-26, 33],
    [-34, 18], [-34, 26], [-22, 14], [-5, 12], [4, 9], [6, -10], [14, -17], [28, -13], [36, -6], [37, 10]
  ],
  // 7. Europe
  [
    [71, 28], [60, 24], [55, 14], [54, 8], [47, 7], [43, 3], [36, -5], [37, -9],
    [43, -9], [48, -4], [53, 5], [58, 6], [62, 5], [70, 20], [71, 28]
  ],
  // 8. United Kingdom & Ireland
  [
    [58, -3], [55, -2], [51, 1], [50, -5], [54, -3], [58, -5], [58, -3]
  ],
  [
    [55, -6], [52, -6], [51, -10], [54, -10], [55, -6]
  ],
  // 9. North America
  [
    [70, -160], [65, -140], [60, -130], [50, -125], [38, -123], [30, -115], [23, -110],
    [16, -93], [20, -87], [29, -89], [25, -80], [35, -75], [44, -66], [50, -60],
    [60, -64], [70, -85], [72, -125], [70, -160]
  ],
  // 10. South America
  [
    [12, -72], [10, -62], [5, -52], [-5, -35], [-12, -37], [-23, -42], [-35, -53],
    [-55, -67], [-52, -75], [-40, -73], [-20, -70], [-5, -81], [5, -77], [12, -72]
  ],
  // 11. Australia
  [
    [-11, 142], [-15, 145], [-24, 153], [-33, 151], [-38, 145], [-35, 117], [-22, 114],
    [-15, 124], [-12, 132], [-11, 142]
  ]
];

export class InteractiveGlobe {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private size: number;
  private radius: number;
  private cx: number;
  private cy: number;

  // Orientation angles in radians:
  // rotY: yaw (longitude). When rotY = -lng(rad), lng faces the viewer
  // rotX: pitch (latitude). When rotX = lat(rad), lat is vertically centered on screen
  private rotY = -1.378; // Initial yaw focused on India (~78.96°E)
  private rotX = 0.359;  // Initial pitch (~20.59°N)

  // Velocity for inertia
  private velY = 0.0018;
  private velX = 0;
  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private dragStartTime = 0;

  // Animation interpolation target
  private targetRotY: number | null = null;
  private targetRotX: number | null = null;
  private isInterpolating = false;

  private selectedRegionId: ScaleTraditionId = 'indian';
  private hoveredRegionId: ScaleTraditionId | null = null;
  private onSelectRegion?: (region: WorldRegion) => void;

  private animFrameId: number | null = null;
  private pulsePhase = 0;

  constructor(options: GlobeOptions) {
    this.size = options.size || 380;
    this.radius = Math.floor(this.size * 0.42);
    this.cx = this.size / 2;
    this.cy = this.size / 2;
    this.selectedRegionId = options.initialRegion || 'indian';
    this.onSelectRegion = options.onSelectRegion;

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.size * window.devicePixelRatio;
    this.canvas.height = this.size * window.devicePixelRatio;
    this.canvas.style.width = `${this.size}px`;
    this.canvas.style.height = `${this.size}px`;
    this.canvas.className = 'interactive-globe-canvas';
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    options.container.append(this.canvas);

    this.flyToRegion(this.selectedRegionId, false);
    this.attachEvents();
    this.startLoop();
  }

  public setSize(size: number) {
    this.size = size;
    this.radius = Math.floor(this.size * 0.42);
    this.cx = this.size / 2;
    this.cy = this.size / 2;
    this.canvas.width = this.size * window.devicePixelRatio;
    this.canvas.height = this.size * window.devicePixelRatio;
    this.canvas.style.width = `${this.size}px`;
    this.canvas.style.height = `${this.size}px`;
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  }

  public getSelectedRegion(): ScaleTraditionId {
    return this.selectedRegionId;
  }

  public selectRegion(regionId: ScaleTraditionId, triggerCallback = true) {
    this.selectedRegionId = regionId;
    this.flyToRegion(regionId, true);
    if (triggerCallback && this.onSelectRegion) {
      const region = WORLD_REGIONS.find((r) => r.id === regionId) || WORLD_REGIONS[0];
      this.onSelectRegion(region);
    }
  }

  public flyToRegion(regionId: ScaleTraditionId, animate = true) {
    this.selectedRegionId = regionId;
    const region = WORLD_REGIONS.find((r) => r.id === regionId);
    if (!region) return;

    // Convert lat/lng to target rotation angles:
    // Longitude: rotY = -lng in radians
    // Latitude: rotX = +lat in radians
    const targetY = -((region.lng * Math.PI) / 180);
    const targetX = ((region.lat * Math.PI) / 180);

    if (!animate) {
      this.rotY = targetY;
      this.rotX = Math.max(-1.2, Math.min(1.2, targetX));
      this.isInterpolating = false;
      return;
    }

    // Shortest angular distance wrap for smooth spherical flight
    let diffY = (targetY - this.rotY) % (Math.PI * 2);
    if (diffY > Math.PI) diffY -= Math.PI * 2;
    if (diffY < -Math.PI) diffY += Math.PI * 2;

    this.targetRotY = this.rotY + diffY;
    this.targetRotX = Math.max(-1.2, Math.min(1.2, targetX));
    this.isInterpolating = true;
  }

  private attachEvents() {
    const onPointerDown = (clientX: number, clientY: number) => {
      this.isDragging = true;
      this.isInterpolating = false;
      this.lastMouseX = clientX;
      this.lastMouseY = clientY;
      this.dragStartTime = Date.now();
      this.velX = 0;
      this.velY = 0;
    };

    const onPointerMove = (clientX: number, clientY: number) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      if (this.isDragging) {
        const dx = clientX - this.lastMouseX;
        const dy = clientY - this.lastMouseY;
        this.lastMouseX = clientX;
        this.lastMouseY = clientY;

        // Natural direct dragging:
        // Dragging right (dx > 0) spins the globe to the right (increasing rotY)
        this.velY = dx * 0.005;
        // Dragging down (dy > 0) tilts the globe down (increasing rotX)
        this.velX = dy * 0.005;

        this.rotY += this.velY;
        this.rotX = Math.max(-1.25, Math.min(1.25, this.rotX + this.velX));
      } else {
        // Hit-test region pins on hover
        this.checkHover(x, y);
      }
    };

    const onPointerUp = (clientX: number, clientY: number) => {
      if (!this.isDragging) return;
      this.isDragging = false;
      const dragDuration = Date.now() - this.dragStartTime;

      // If it was a quick click rather than a drag, check pin clicks
      if (dragDuration < 200) {
        const rect = this.canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        this.checkClick(x, y);
      }
    };

    this.canvas.addEventListener('mousedown', (e) => onPointerDown(e.clientX, e.clientY));
    window.addEventListener('mousemove', (e) => onPointerMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', (e) => onPointerUp(e.clientX, e.clientY));

    this.canvas.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length > 0) onPointerDown(e.touches[0].clientX, e.touches[0].clientY);
      },
      { passive: true }
    );
    window.addEventListener(
      'touchmove',
      (e) => {
        if (e.touches.length > 0) onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
      },
      { passive: true }
    );
    window.addEventListener(
      'touchend',
      (e) => {
        if (e.changedTouches.length > 0) onPointerUp(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
      },
      { passive: true }
    );
  }

  private checkHover(x: number, y: number) {
    let found: ScaleTraditionId | null = null;
    for (const region of WORLD_REGIONS) {
      const p = this.projectLatLng(region.lat, region.lng);
      if (p && p.z > 0.05) {
        const dist = Math.hypot(p.x - x, p.y - y);
        if (dist < 22) {
          found = region.id;
          break;
        }
      }
    }
    this.hoveredRegionId = found;
    this.canvas.style.cursor = found ? 'pointer' : this.isDragging ? 'grabbing' : 'grab';
  }

  private checkClick(x: number, y: number) {
    for (const region of WORLD_REGIONS) {
      const p = this.projectLatLng(region.lat, region.lng);
      if (p && p.z > 0.05) {
        const dist = Math.hypot(p.x - x, p.y - y);
        if (dist < 26) {
          this.selectRegion(region.id);
          return;
        }
      }
    }
  }

  /**
   * Projects a (lat, lng) point on Earth onto the 2D orthographic canvas plane
   */
  private projectLatLng(lat: number, lng: number): (Point3D & { screenX: number; screenY: number }) | null {
    const phi = (lat * Math.PI) / 180;
    const lambda = (lng * Math.PI) / 180;

    // 3D unit sphere coordinates:
    // x0: East (+), West (-)
    // y0: North (negative for canvas screen Y), South (positive)
    // z0: Front (+), Back (-)
    const x0 = Math.cos(phi) * Math.sin(lambda);
    const y0 = -Math.sin(phi);
    const z0 = Math.cos(phi) * Math.cos(lambda);

    // Rotate around Y axis (longitude / yaw):
    const cosY = Math.cos(this.rotY);
    const sinY = Math.sin(this.rotY);
    const x1 = x0 * cosY + z0 * sinY;
    const y1 = y0;
    const z1 = -x0 * sinY + z0 * cosY;

    // Rotate around X axis (latitude / pitch):
    const cosX = Math.cos(this.rotX);
    const sinX = Math.sin(this.rotX);
    const x2 = x1;
    const y2 = y1 * cosX + z1 * sinX;
    const z2 = -y1 * sinX + z1 * cosX;

    const screenX = this.cx + x2 * this.radius;
    const screenY = this.cy + y2 * this.radius;

    return { x: screenX, y: screenY, z: z2, screenX, screenY };
  }

  private startLoop() {
    const render = () => {
      this.updatePhysics();
      this.draw();
      this.animFrameId = requestAnimationFrame(render);
    };
    this.animFrameId = requestAnimationFrame(render);
  }

  private updatePhysics() {
    this.pulsePhase += 0.04;

    if (this.isInterpolating && this.targetRotY !== null && this.targetRotX !== null) {
      const ease = 0.085;
      this.rotY += (this.targetRotY - this.rotY) * ease;
      this.rotX += (this.targetRotX - this.rotX) * ease;

      if (Math.abs(this.targetRotY - this.rotY) < 0.001 && Math.abs(this.targetRotX - this.rotX) < 0.001) {
        this.rotY = this.targetRotY;
        this.rotX = this.targetRotX;
        this.isInterpolating = false;
        this.targetRotY = null;
        this.targetRotX = null;
      }
    } else if (!this.isDragging) {
      // Natural inertia & ambient rotation
      this.velY *= 0.94;
      this.velX *= 0.94;

      if (Math.abs(this.velY) < 0.0005) {
        this.velY = 0.0016; // gentle ambient orbit
      }
      this.rotY += this.velY;
      this.rotX = Math.max(-1.2, Math.min(1.2, this.rotX + this.velX));
    }
  }

  private draw() {
    const { ctx, cx, cy, radius, size } = this;
    ctx.clearRect(0, 0, size, size);

    // 1. Background space & atmospheric outer glow
    const atmGlow = ctx.createRadialGradient(cx, cy, radius * 0.85, cx, cy, radius * 1.28);
    atmGlow.addColorStop(0, 'rgba(56, 189, 248, 0.09)');
    atmGlow.addColorStop(0.5, 'rgba(74, 222, 128, 0.04)');
    atmGlow.addColorStop(1, 'transparent');
    ctx.fillStyle = atmGlow;
    ctx.fillRect(0, 0, size, size);

    // 2. Globe Dark Sphere Base (Deep Space Ocean)
    const oceanGrad = ctx.createRadialGradient(
      cx - radius * 0.35,
      cy - radius * 0.35,
      radius * 0.1,
      cx,
      cy,
      radius
    );
    oceanGrad.addColorStop(0, '#151f2d');
    oceanGrad.addColorStop(0.7, '#0c131d');
    oceanGrad.addColorStop(1, '#060a0f');

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = oceanGrad;
    ctx.fill();
    ctx.clip(); // Clip everything to sphere boundary

    // 3. Latitude & Longitude Grids (Wireframe)
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.08)';
    ctx.lineWidth = 1;

    // Latitudes
    for (let lat = -60; lat <= 60; lat += 30) {
      ctx.beginPath();
      let started = false;
      for (let lng = -180; lng <= 180; lng += 6) {
        const p = this.projectLatLng(lat, lng);
        if (p && p.z > -0.05) {
          if (!started) {
            ctx.moveTo(p.x, p.y);
            started = true;
          } else {
            ctx.lineTo(p.x, p.y);
          }
        } else {
          started = false;
        }
      }
      ctx.stroke();
    }

    // Longitudes
    for (let lng = -180; lng < 180; lng += 30) {
      ctx.beginPath();
      let started = false;
      for (let lat = -80; lat <= 80; lat += 6) {
        const p = this.projectLatLng(lat, lng);
        if (p && p.z > -0.05) {
          if (!started) {
            ctx.moveTo(p.x, p.y);
            started = true;
          } else {
            ctx.lineTo(p.x, p.y);
          }
        } else {
          started = false;
        }
      }
      ctx.stroke();
    }

    // 4. Draw Continents & Landmasses with fill & outline
    for (const polygon of CONTINENT_DATA) {
      ctx.beginPath();
      let started = false;

      for (let i = 0; i < polygon.length; i += 1) {
        const [lat, lng] = polygon[i];
        const p = this.projectLatLng(lat, lng);
        if (p && p.z > -0.05) {
          if (!started) {
            ctx.moveTo(p.x, p.y);
            started = true;
          } else {
            ctx.lineTo(p.x, p.y);
          }
        } else {
          started = false;
        }
      }

      ctx.fillStyle = 'rgba(74, 222, 128, 0.20)';
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.65)';
      ctx.lineWidth = 1.4;
      ctx.fill();
      ctx.stroke();
    }

    // 5. Shading / 3D Specular Limb
    const lightGrad = ctx.createRadialGradient(
      cx - radius * 0.4,
      cy - radius * 0.4,
      radius * 0.2,
      cx,
      cy,
      radius
    );
    lightGrad.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
    lightGrad.addColorStop(0.6, 'transparent');
    lightGrad.addColorStop(1, 'rgba(0, 0, 0, 0.70)');
    ctx.fillStyle = lightGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore(); // Exit sphere clipping

    // 6. Atmosphere Border Ring
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 7. Draw Regional Markers & Interactive Beacons
    for (const region of WORLD_REGIONS) {
      const p = this.projectLatLng(region.lat, region.lng);
      if (!p || p.z <= 0.05) continue; // Hidden on back side of globe

      const isSelected = region.id === this.selectedRegionId;
      const isHovered = region.id === this.hoveredRegionId;
      const depthAlpha = Math.max(0.4, Math.min(1, p.z));

      // Radiant pulse rings for selected region
      if (isSelected) {
        const pulseR = 8 + (Math.sin(this.pulsePhase) + 1) * 6;
        ctx.beginPath();
        ctx.arc(p.x, p.y, pulseR, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(74, 222, 128, ${(0.8 * depthAlpha).toFixed(2)})`;
        ctx.lineWidth = 2;
        ctx.stroke();

        const pulseR2 = 6 + ((this.pulsePhase * 8) % 18);
        ctx.beginPath();
        ctx.arc(p.x, p.y, pulseR2, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(56, 189, 248, ${(0.6 * depthAlpha).toFixed(2)})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      // Center Beacon Pin
      ctx.beginPath();
      const dotRadius = isSelected ? 6.5 : isHovered ? 5.5 : 4.0;
      ctx.arc(p.x, p.y, dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = isSelected
        ? '#4ade80'
        : isHovered
          ? '#38bdf8'
          : 'rgba(255, 255, 255, 0.85)';
      ctx.shadowColor = isSelected ? '#4ade80' : '#38bdf8';
      ctx.shadowBlur = isSelected ? 12 : 6;
      ctx.fill();
      ctx.shadowBlur = 0; // reset shadow

      // Flag & Title Badge above selected or hovered pin
      if (isSelected || isHovered) {
        ctx.save();
        ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
        const labelText = `${region.flag} ${region.name}`;
        const textMetrics = ctx.measureText(labelText);
        const paddingX = 8;
        const boxW = textMetrics.width + paddingX * 2;
        const boxH = 22;
        const boxX = Math.max(10, Math.min(size - boxW - 10, p.x - boxW / 2));
        const boxY = Math.max(15, p.y - 30);

        // Tooltip Background Pill
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxW, boxH, 6);
        ctx.fillStyle = isSelected ? 'rgba(15, 23, 42, 0.94)' : 'rgba(15, 23, 42, 0.88)';
        ctx.fill();
        ctx.strokeStyle = isSelected ? '#4ade80' : '#38bdf8';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Tooltip Text
        ctx.fillStyle = isSelected ? '#4ade80' : '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, boxX + boxW / 2, boxY + boxH / 2);
        ctx.restore();
      }
    }
  }

  public destroy() {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.canvas.remove();
  }
}
