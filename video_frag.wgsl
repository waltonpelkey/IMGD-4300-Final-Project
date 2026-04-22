@group(0) @binding(0) var<uniform> res: vec2f;
@group(0) @binding(1) var video_sampler: sampler;
@group(0) @binding(2) var<uniform> threshold: vec4f;
@group(1) @binding(0) var video_frame: texture_external;

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / res;
  let color = textureSampleBaseClampToEdge(video_frame, video_sampler, uv);
  let lightness = (max(max(color.r, color.g), color.b) + min(min(color.r, color.g), color.b)) * 0.5;
  let bw = select(0.0, 1.0, lightness >= threshold.x);
  return vec4f(bw, bw, bw, 1.0);
}
