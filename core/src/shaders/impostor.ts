import { Effect } from "@babylonjs/core";

const SPHERE_VERTEX = `
    precision highp float;

    // Attributes
    attribute vec3 position;
    attribute vec2 uv;
    // Instanced Attributes
    attribute vec4 instanceData; // x, y, z, radius
    attribute vec4 instanceColor;        // r, g, b, a
    attribute vec4 instanceStyle;        // visible, reveal highlight, pick-hidden, reserved
    attribute vec4 instancePickingColor; // r, g, b, a (Encoded ID)

    // Uniforms
    uniform mat4 worldViewProjection;
    uniform mat4 view;
    uniform mat4 projection;
    uniform float atomOutline;
    
    // Varyings
    varying vec2 vUV;
    varying vec4 vColor;
    varying vec4 vStyle;
    varying vec4 vPickingColor;
    varying vec3 vSphereCenter; // View space
    varying float vSphereRadius;
    varying float vOuterRadius;
    varying vec3 vViewPosition; // View space position of the quad fragment

    void main() {
        vec3 centerWorld = instanceData.xyz;
        float radius = instanceData.w;
        float outerRadius = radius * (1.0 + max(atomOutline, 0.0));

        // Calculate view space center
        vec4 centerView4 = view * vec4(centerWorld, 1.0);
        vec3 centerView = centerView4.xyz;
        
        // Billboard logic in View Space
        // Quad vertices are usually -0.5 to 0.5. 
        // We scale by radius * 2 to cover diameter.
        
        vec3 offset = position * (outerRadius * 2.0);
        
        // The Quad is axis aligned in View Space (facing camera -Z)
        vec3 posView = centerView + offset;
        
        gl_Position = projection * vec4(posView, 1.0);
        
        vUV = uv;
        vColor = instanceColor;
        vStyle = instanceStyle;
        vPickingColor = instancePickingColor;
        vSphereCenter = centerView;
        vSphereRadius = radius;
        vOuterRadius = outerRadius;
        vViewPosition = posView; 
    }
`;

const SPHERE_FRAGMENT = `
precision highp float;
#ifdef GL_EXT_frag_depth
#extension GL_EXT_frag_depth : enable
#endif

// Uniforms
uniform mat4 projection;
uniform float uPickingEnabled; // 1.0 = Picking Mode

// Lighting Uniforms (MUST be view-space, normalized)
uniform vec3 lightDir;
uniform float lightAmbient;
uniform float lightDiffuse;
uniform float lightSpecular;
uniform float lightSpecularPower;
uniform vec3 backgroundColor;
uniform float atomShadingMode; // 0 = lit, 1 = illustrative, 2 = flat
uniform float atomOutline;

// Varyings
varying vec2 vUV;
varying vec4 vColor;
varying vec4 vStyle;
varying vec4 vPickingColor;
varying vec3 vSphereCenter; // View-space center
varying float vSphereRadius;
varying float vOuterRadius;

void main() {
    if (vColor.a < 0.01) discard;
    // Map uv [0,1] -> [-1,1]
    vec2 coord = vUV * 2.0 - 1.0;

    vec2 radial = coord * vOuterRadius;
    float radialDistance = length(radial);
    if (radialDistance > vOuterRadius) discard;
    float aa = max(fwidth(radialDistance), vSphereRadius * 0.002);
    float outlineMask = atomOutline > 0.001
        ? smoothstep(vSphereRadius - aa, vSphereRadius + aa, radialDistance)
        : 0.0;
    float hitRadius = outlineMask > 0.5 ? vOuterRadius : vSphereRadius;
    float normalizedR2 = dot(radial, radial) / (hitRadius * hitRadius);
    float z = sqrt(max(0.0, 1.0 - normalizedR2));

    // Determine Handedness from Projection Matrix (col 2, row 3)
    // LHS: 1.0, RHS: -1.0
    float orientation = (projection[2][3] > 0.0) ? -1.0 : 1.0;

    // Surface point on sphere in VIEW space
    vec3 P = vec3(
        vSphereCenter.x + radial.x,
        vSphereCenter.y + radial.y,
        vSphereCenter.z + z * hitRadius * orientation
    );

    // Depth Correction
    float surfaceZ = P.z;

    float clipZ = projection[2][2] * surfaceZ + projection[3][2];
    float clipW = projection[2][3] * surfaceZ + projection[3][3];
    float ndcZ = clipZ / clipW;
    float depth = (ndcZ + 1.0) * 0.5;

    #ifdef GL_EXT_frag_depth
    gl_FragDepthEXT = depth;
    #else
    gl_FragDepth = depth;
    #endif

    // Picking Mode Output
    if (uPickingEnabled > 0.5) {
        if (vStyle.x < 0.5 && vStyle.z < 0.5) discard;
        gl_FragColor = vPickingColor;
        return;
    }

    // Representation visibility is evaluated after picking. This lets the
    // skeletal model keep its invisible atom topology fully interactive.
    if (vStyle.x < 0.5 && vStyle.y < 0.5) discard;

    // Normal Rendering
    // View-space normal consistent with P
    vec3 normal = normalize(P - vSphereCenter);

    // Lighting vectors in VIEW space
    vec3 L = normalize(lightDir);
    vec3 V = normalize(-P); // from surface point to camera (origin)
    float diffuse = max(dot(normal, L), 0.0);

    // Blinn-Phong specular (more stable than reflect)
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(normal, H), 0.0), lightSpecularPower) * lightSpecular;

    vec3 finalColor;
    if (atomShadingMode < 0.5) {
        finalColor = vColor.rgb * (lightAmbient + diffuse * lightDiffuse) + vec3(1.0) * spec;
    } else if (atomShadingMode < 1.5) {
        vec3 key = normalize(vec3(-0.45, 0.55, 0.72));
        float illustrationLight = smoothstep(-0.2, 0.9, dot(normal, key));
        float highlight = pow(max(dot(normal, normalize(key + V)), 0.0), 28.0);
        finalColor = vColor.rgb * mix(0.62, 1.12, illustrationLight)
            + vec3(1.0) * highlight * 0.18;
    } else {
        finalColor = vColor.rgb;
    }

    if (outlineMask > 0.001) {
        float backgroundLuma = dot(backgroundColor, vec3(0.2126, 0.7152, 0.0722));
        vec3 outlineColor = backgroundLuma > 0.42
            ? vColor.rgb * 0.16
            : mix(vColor.rgb, vec3(1.0), 0.72);
        finalColor = mix(finalColor, outlineColor, outlineMask);
    }
    gl_FragColor = vec4(finalColor, vColor.a);
}
`;

const BOND_VERTEX = `
    precision highp float;

    // Attributes
    attribute vec3 position;
    attribute vec2 uv;
    // Instanced Attributes
    attribute vec4 instanceData0; // center xyz, radius
    attribute vec4 instanceData1; // dir xyz, length
    attribute vec4 instanceColor0; // r, g, b, a
    attribute vec4 instanceColor1; // r, g, b, a
    attribute vec4 instanceSplit;  // split offset (x)
    attribute vec4 instancePickingColor; // r, g, b, a

    // Uniforms
    uniform mat4 view;
    uniform mat4 projection;
    uniform float bondOutline;

    // Varyings
    varying vec2 vUV;
    varying vec4 vColor0;
    varying vec4 vColor1;
    varying vec4 vPickingColor;
    varying float vSplit;
    varying vec3 vCenterView;
    varying vec3 vDirView;
    varying float vRadius;
    varying float vOuterRadius;
    varying float vHalfLen;
    varying vec3 vPosView;

    void main() {
        vec3 centerWorld = instanceData0.xyz;
        float radius = instanceData0.w;
        float outerRadius = radius * (1.0 + max(bondOutline, 0.0));
        vec3 dirWorld = instanceData1.xyz;
        float bondLen = instanceData1.w;

        vec3 centerView = (view * vec4(centerWorld, 1.0)).xyz;
        vec3 dirView = normalize((view * vec4(dirWorld, 0.0)).xyz);
        vec3 viewDir = normalize(-centerView);

        vec3 right = normalize(cross(dirView, viewDir));
        if (length(right) < 1e-6) {
            right = normalize(cross(dirView, vec3(0.0, 1.0, 0.0)));
        }

        float halfLen = bondLen * 0.5;

        vec3 posView = centerView
            + right * (position.x * outerRadius * 2.0)
            + dirView * (position.y * (bondLen + outerRadius * 2.0));

        gl_Position = projection * vec4(posView, 1.0);

        vUV = uv;
        vColor0 = instanceColor0;
        vColor1 = instanceColor1;
        vPickingColor = instancePickingColor;
        vSplit = instanceSplit.x;
        vCenterView = centerView;
        vDirView = dirView;
        vRadius = radius;
        vOuterRadius = outerRadius;
        vHalfLen = halfLen;
        vPosView = posView;
    }
`;

const BOND_FRAGMENT = `
precision highp float;
#ifdef GL_EXT_frag_depth
#extension GL_EXT_frag_depth : enable
#endif

varying vec2 vUV;
varying vec4 vColor0;
varying vec4 vColor1;
varying vec4 vPickingColor;
varying float vSplit;
varying vec3 vCenterView;
varying vec3 vDirView;
varying float vRadius;
varying float vOuterRadius;
varying float vHalfLen;
varying vec3 vPosView;

uniform mat4 projection;
uniform float uPickingEnabled; // 1.0 = Picking

// Lighting Uniforms (MUST be view-space, normalized)
uniform vec3 lightDir;
uniform float lightAmbient;
uniform float lightDiffuse;
uniform float lightSpecular;
uniform float lightSpecularPower;
uniform vec3 backgroundColor;
uniform float bondShadingMode; // 0 = lit, 1 = illustrative, 2 = flat
uniform float bondOutline;

bool intersectFiniteCylinder(
    vec3 D,
    vec3 A,
    float radius,
    out float bestT,
    out vec3 bestNormal,
    out float bestS
) {
    vec3 CO = -vCenterView;
    vec3 dPerp = D - A * dot(D, A);
    vec3 mPerp = CO - A * dot(CO, A);

    float a = dot(dPerp, dPerp);
    if (a < 1e-6) return false;

    float b = 2.0 * dot(dPerp, mPerp);
    float c = dot(mPerp, mPerp) - radius * radius;

    float disc = b * b - 4.0 * a * c;
    if (disc < 0.0) return false;

    float sqrtDisc = sqrt(disc);
    float tNear = (-b - sqrtDisc) / (2.0 * a);
    float tFar = (-b + sqrtDisc) / (2.0 * a);
    bestT = 1.0e20;
    bestNormal = vec3(0.0);
    bestS = 0.0;

    // Curved wall candidates.
    if (tNear > 0.0) {
        vec3 candidate = D * tNear;
        float candidateS = dot(candidate - vCenterView, A);
        if (abs(candidateS) <= vHalfLen) {
            bestT = tNear;
            bestS = candidateS;
            bestNormal = normalize(candidate - (vCenterView + A * candidateS));
        }
    }
    if (tFar > 0.0 && tFar < bestT) {
        vec3 candidate = D * tFar;
        float candidateS = dot(candidate - vCenterView, A);
        if (abs(candidateS) <= vHalfLen) {
            bestT = tFar;
            bestS = candidateS;
            bestNormal = normalize(candidate - (vCenterView + A * candidateS));
        }
    }

    // Flat circular end caps. They matter for tube/wire styles where atoms do
    // not cover the endpoints, and also remove the old jagged open-cylinder
    // silhouette at oblique camera angles.
    float capDenominator = dot(D, A);
    if (abs(capDenominator) > 1.0e-6) {
        for (int capIndex = 0; capIndex < 2; capIndex++) {
            float capSign = capIndex == 0 ? -1.0 : 1.0;
            vec3 capCenter = vCenterView + A * (capSign * vHalfLen);
            float capT = dot(capCenter, A) / capDenominator;
            if (capT > 0.0 && capT < bestT) {
                vec3 candidate = D * capT;
                vec3 radial = candidate - capCenter;
                if (dot(radial, radial) <= radius * radius) {
                    bestT = capT;
                    bestS = capSign * vHalfLen;
                    bestNormal = A * capSign;
                }
            }
        }
    }

    return bestT < 1.0e19;
}

void main() {
    if (vColor0.a < 0.01) discard;
    // Ray from camera (origin) through this fragment position in view space.
    vec3 D = normalize(vPosView);
    vec3 A = normalize(vDirView);

    float outerT;
    vec3 outerNormal;
    float outerS;
    if (!intersectFiniteCylinder(D, A, vOuterRadius, outerT, outerNormal, outerS)) {
        discard;
    }

    float innerT;
    vec3 innerNormal;
    float innerS;
    bool innerHit = intersectFiniteCylinder(D, A, vRadius, innerT, innerNormal, innerS);
    if (uPickingEnabled > 0.5 && !innerHit) discard;

    bool outlineOnly = bondOutline > 0.001 && !innerHit;
    float bestT = innerHit ? innerT : outerT;
    vec3 bestNormal = innerHit ? innerNormal : outerNormal;
    float bestS = innerHit ? innerS : outerS;
    vec3 P = D * bestT;             // hit point in VIEW space
    float s = bestS;

    // Depth
    float clipZ = projection[2][2] * P.z + projection[3][2];
    float clipW = projection[2][3] * P.z + projection[3][3];
    float ndcZ = clipZ / clipW;
    float depth = (ndcZ + 1.0) * 0.5;

    #ifdef GL_EXT_frag_depth
    gl_FragDepthEXT = depth;
    #else
    gl_FragDepth = depth;
    #endif

    // Picking Mode Output
    if (uPickingEnabled > 0.5) {
        gl_FragColor = vPickingColor;
        return;
    }

    // Normal Rendering
    vec3 normal = normalize(bestNormal);

    // Lighting vectors in VIEW space
    vec3 L = normalize(lightDir);
    vec3 V = normalize(-P); // from hit point to camera (origin)
    float diffuse = max(dot(normal, L), 0.0);

    // Blinn-Phong specular
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(normal, H), 0.0), lightSpecularPower) * lightSpecular;

    vec4 vColor = (s < vSplit) ? vColor0 : vColor1;
    vec3 finalColor;
    if (bondShadingMode < 0.5) {
        finalColor = vColor.rgb * (lightAmbient + diffuse * lightDiffuse) + vec3(1.0) * spec;
    } else if (bondShadingMode < 1.5) {
        float illustrationLight = smoothstep(-0.35, 0.9, normal.x * -0.45 + normal.y * 0.7 + normal.z * 0.55);
        finalColor = vColor.rgb * mix(0.58, 1.1, illustrationLight);
    } else {
        finalColor = vColor.rgb;
    }

    if (outlineOnly) {
        float backgroundLuma = dot(backgroundColor, vec3(0.2126, 0.7152, 0.0722));
        vec3 outlineColor = backgroundLuma > 0.42
            ? vColor.rgb * 0.16
            : mix(vColor.rgb, vec3(1.0), 0.72);
        finalColor = outlineColor;
    }

    gl_FragColor = vec4(finalColor, vColor.a);
}

`;

let registered = false;

export function registerImpostorShaders(): void {
  if (registered) return;
  Effect.ShadersStore.sphereImpostorVertexShader = SPHERE_VERTEX;
  Effect.ShadersStore.sphereImpostorFragmentShader = SPHERE_FRAGMENT;
  Effect.ShadersStore.bondImpostorVertexShader = BOND_VERTEX;
  Effect.ShadersStore.bondImpostorFragmentShader = BOND_FRAGMENT;
  registered = true;
}
