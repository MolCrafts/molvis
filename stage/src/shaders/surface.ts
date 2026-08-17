import { Effect } from "@babylonjs/core";

const SURFACE_VERTEX = `
precision highp float;

attribute vec3 position;
attribute vec3 normal;
attribute vec3 barycentric;

uniform mat4 world;
uniform mat4 worldViewProjection;
uniform mat4 view;

varying vec3 vBarycentric;
varying vec3 vNormalView;
varying vec3 vViewPosition;

void main() {
    vec4 worldPosition = world * vec4(position, 1.0);
    vViewPosition = (view * worldPosition).xyz;
    vNormalView = normalize((view * world * vec4(normal, 0.0)).xyz);
    vBarycentric = barycentric;
    gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const SURFACE_FRAGMENT = `
precision highp float;
#extension GL_OES_standard_derivatives : enable

uniform vec3 surfaceColor;
uniform vec3 backgroundColor;
uniform vec3 lightDir;
uniform float opacity;
uniform float surfaceStyle; // 0 solid, 1 mesh, 2 contour, 3 dot
uniform float contourSpacing;

varying vec3 vBarycentric;
varying vec3 vNormalView;
varying vec3 vViewPosition;

vec3 adaptiveInk(vec3 base) {
    float backgroundLuma = dot(backgroundColor, vec3(0.2126, 0.7152, 0.0722));
    return backgroundLuma > 0.42 ? base * 0.12 : mix(base, vec3(1.0), 0.78);
}

float contourLine(float depth) {
    float spacing = max(contourSpacing, 0.01);
    float coordinate = depth / spacing;
    float phase = fract(coordinate);
    float distanceToLine = min(phase, 1.0 - phase);
    float width = max(fwidth(coordinate) * 1.25, 0.012);
    return 1.0 - smoothstep(0.0, width, distanceToLine);
}

void main() {
    vec3 N = normalize(vNormalView);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(-vViewPosition);
    vec3 L = normalize(lightDir);
    float diffuse = max(dot(N, L), 0.0);
    float rim = pow(1.0 - max(dot(N, V), 0.0), 2.0);
    vec3 shaded = surfaceColor * (0.48 + diffuse * 0.58) + vec3(1.0) * rim * 0.08;
    vec3 ink = adaptiveInk(surfaceColor);

    if (surfaceStyle < 0.5) {
        gl_FragColor = vec4(shaded, opacity);
        return;
    }

    if (surfaceStyle < 1.5) {
        vec3 width = fwidth(vBarycentric);
        vec3 antialiased = smoothstep(vec3(0.0), width * 1.35, vBarycentric);
        float edge = 1.0 - min(min(antialiased.x, antialiased.y), antialiased.z);
        vec3 color = mix(surfaceColor * 0.72, ink, edge);
        float alpha = opacity * mix(0.14, 1.0, edge);
        gl_FragColor = vec4(color, alpha);
        return;
    }

    float line = contourLine(abs(vViewPosition.z));
    if (surfaceStyle < 2.5) {
        vec3 color = mix(surfaceColor * 0.82, ink, line);
        float alpha = opacity * mix(0.2, 1.0, line);
        gl_FragColor = vec4(color, alpha);
        return;
    }

    // Round screen-space stipples are admitted only along view-depth
    // contour bands, so the pattern remains a genuine rotating 3-D surface.
    vec2 cell = mod(gl_FragCoord.xy, 5.0) - vec2(2.5);
    float stipple = 1.0 - smoothstep(1.15, 1.8, length(cell));
    if (stipple * line < 0.3) discard;
    gl_FragColor = vec4(mix(surfaceColor, ink, 0.55), opacity * stipple);
}
`;

const CLOUD_VERTEX = `
precision highp float;

attribute vec3 position;
attribute vec4 color;
uniform mat4 worldViewProjection;
uniform float pointSize;
varying vec4 vColor;

void main() {
    gl_Position = worldViewProjection * vec4(position, 1.0);
    gl_PointSize = pointSize;
    vColor = color;
}
`;

const CLOUD_FRAGMENT = `
precision highp float;
varying vec4 vColor;

void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float radius2 = dot(p, p);
    if (radius2 > 1.0) discard;
    float edge = 1.0 - smoothstep(0.72, 1.0, radius2);
    gl_FragColor = vec4(vColor.rgb, vColor.a * edge);
}
`;

let registered = false;

export function registerSurfaceShaders(): void {
  if (registered) return;
  Effect.ShadersStore.molvisSurfaceVertexShader = SURFACE_VERTEX;
  Effect.ShadersStore.molvisSurfaceFragmentShader = SURFACE_FRAGMENT;
  Effect.ShadersStore.molvisCloudVertexShader = CLOUD_VERTEX;
  Effect.ShadersStore.molvisCloudFragmentShader = CLOUD_FRAGMENT;
  registered = true;
}
